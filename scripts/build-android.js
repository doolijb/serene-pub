#!/usr/bin/env node

/**
 * Build script for Android APK
 * Prepares Serene Pub bundle and packages it into Android assets
 */

import fs from "fs"
import path from "path"
import { execFileSync } from "child_process"
import crypto from "crypto"
import { fileURLToPath } from "url"
import {
	pruneAndroidAssets,
	dirSizeBytes,
	ANDROID_ASSETS_THRESHOLD_MB
} from "./prune-dist.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rootDir = path.resolve(__dirname, "..")
const androidDir = path.join(rootDir, "android")
const assetsDir = path.join(androidDir, "app/src/main/assets/serene-pub")
const libnodeDir = path.join(androidDir, "app/src/main/cpp/libnode")
const buildDir = path.join(rootDir, "build")
const nodeModulesDir = path.join(rootDir, "node_modules")
const drizzleDir = path.join(rootDir, "drizzle")

console.log("🤖 Building Serene Pub for Android...")

// 1. Clean assets directory
if (fs.existsSync(assetsDir)) {
	console.log("Cleaning assets directory...")
	fs.rmSync(assetsDir, { recursive: true, force: true })
}
fs.mkdirSync(assetsDir, { recursive: true })

// 2. Copy build output
console.log("Copying build files...")
copyRecursive(buildDir, path.join(assetsDir, "build"))

// copyRecursive only warns (doesn't throw) on a missing source directory, so
// a missing/stale `npm run build` output would otherwise silently produce an
// assets bundle with no server entrypoint at all — one that "successfully"
// packages into an APK and only fails at runtime on-device, deep inside
// NodeService, as a confusing "app entrypoint not found" with no indication
// the actual cause was a skipped build step here.
const assetsMain = path.join(assetsDir, "build/index.js")
if (!fs.existsSync(assetsMain)) {
	console.error(
		`Error: ${assetsMain} was not created — is ${buildDir} missing or stale? Run \`npm run build\` first.`
	)
	process.exit(1)
}

// 3. Copy node_modules (production only)
//
// This is a verbatim copy, so it inherits whatever is in the working tree —
// including dev dependencies and any stale package npm no longer tracks. CI
// runs `npm install --omit=dev` beforehand; a local build will not have, which
// is why the prune step below (and the size guard after it) matter locally too.
console.log("Copying node_modules...")
copyRecursive(nodeModulesDir, path.join(assetsDir, "node_modules"))

if (fs.readdirSync(path.join(assetsDir, "node_modules")).length === 0) {
	console.error(
		`Error: ${path.join(assetsDir, "node_modules")} is empty — is ${nodeModulesDir} missing? Run \`npm install\` first.`
	)
	process.exit(1)
}

// 4. static/ is NOT copied separately — build/client already contains
// everything SvelteKit put there from static/ at build time (the same
// dedup applied to scripts/bundle-dist.js's desktop bundling), and
// userSettings.ts's getDefaultBackgrounds() reads build/client first with a
// static/ fallback for exactly this reason.

// 5. Copy drizzle migrations
console.log("Copying database migrations...")
copyRecursive(drizzleDir, path.join(assetsDir, "drizzle"))

// 5b. Strip everything the on-device runtime can never read.
//
// Without this the assets tree ships the whole local-embedding stack —
// onnxruntime's native binaries for five desktop platform/arch combinations,
// none of which Android can load — plus source maps and type declarations.
// See pruneAndroidAssets for why each rule is safe.
const beforeBytes = dirSizeBytes(assetsDir)
console.log("Pruning assets...")
pruneAndroidAssets(assetsDir)
const afterBytes = dirSizeBytes(assetsDir)
const mb = (b) => (b / 1024 / 1024).toFixed(1)
console.log(
	`Assets: ${mb(beforeBytes)} MB -> ${mb(afterBytes)} MB (removed ${mb(beforeBytes - afterBytes)} MB)`
)

// The entrypoint must still be there — a pruning rule that over-matches would
// otherwise only surface as a runtime failure deep inside NodeService.
if (!fs.existsSync(assetsMain)) {
	console.error(
		`Error: pruning removed ${assetsMain} — this is a bug in pruneAndroidAssets.`
	)
	process.exit(1)
}

// The ceiling assumes a production-only dependency tree, which is what CI
// produces (`npm install --omit=dev` runs before this script). A developer
// building locally almost always has dev dependencies installed — worth ~190MB
// here — so enforcing the ceiling against that would fail every local build for
// a reason that has nothing to do with what ships. Detect that case and report
// it instead of failing.
const devDepNames = Object.keys(
	JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"))
		.devDependencies ?? {}
)
const presentDevDeps = devDepNames.filter((name) =>
	fs.existsSync(path.join(assetsDir, "node_modules", name))
)
const overCeiling = afterBytes / 1024 / 1024 > ANDROID_ASSETS_THRESHOLD_MB

if (overCeiling && presentDevDeps.length > 0) {
	console.warn(
		`Warning: assets are ${mb(afterBytes)} MB, over the ${ANDROID_ASSETS_THRESHOLD_MB} MB ceiling, but ` +
			`${presentDevDeps.length} dev dependencies are present (e.g. ${presentDevDeps.slice(0, 3).join(", ")}).\n` +
			`         This is a development tree; a release build runs \`npm install --omit=dev\` first and will be much smaller.\n` +
			`         Skipping the size check. Run \`npm install --omit=dev\` before this script to check the real shipping size.`
	)
} else if (overCeiling) {
	console.error(
		`Error: Android assets are ${mb(afterBytes)} MB, over the ${ANDROID_ASSETS_THRESHOLD_MB} MB ceiling.\n` +
			`No dev dependencies are present, so this is what would actually ship.\n` +
			`Inspect with:\n` +
			`  du -sh ${path.relative(rootDir, assetsDir)}/node_modules/* | sort -rh | head -20\n` +
			`If the growth is deliberate, raise ANDROID_ASSETS_THRESHOLD_MB in scripts/prune-dist.js.`
	)
	process.exit(1)
}

// 6. Fetch a genuine Bionic-targeted libnode.so + Node headers and place them
// where android/app/src/main/cpp/CMakeLists.txt expects them. The official
// nodejs.org Linux ARM64 build is linked against glibc (ELF interpreter
// /lib/ld-linux-aarch64.so.1) which doesn't exist on Android — execve() on
// it fails with ENOENT on the interpreter itself, not the file, regardless
// of where it's placed or how its permissions are set. That build cannot run
// on Android under any packaging scheme.
//
// nodejs-mobile compiles Node specifically for Android via the NDK, producing
// a real Bionic shared library, and Node is embedded in-process via
// node::Start() (see android/app/src/main/cpp/node-bridge.cpp) rather than
// spawned as a subprocess.
//
// The build used is Digital Democracy's reproducible "recipe" fork
// (digidem/nodejs-mobile), not upstream nodejs-mobile: upstream's last
// release is Node 18.20.4, and this app needs Node 24 (it crashed at startup
// on 18 — AbortSignal.any, Promise.withResolvers, Array.fromAsync, …). The
// "full" variant is configured --with-intl=small-icu, so Intl (English locale
// data) and Unicode regex property escapes (\p{L}) work natively — the old
// nodejs-mobile was intl=none and needed a preloaded polyfill. Its libnode.so
// is linked with 16 KB-aligned LOAD segments (Android 15+). The zip is laid
// out as bin/<abi>/libnode.so + include/node/, exactly what CMakeLists.txt
// reads, so the two needed paths are extracted straight into libnodeDir.
//
// Pinned by URL AND sha256 (which is also GitHub's own published digest for
// the asset). The zip is cached under android/.cache/ and re-verified on every
// run; to build from a mirror, drop the same file there. See docs/android.md
// "Runtime" for the provenance record.
const NODEJS_MOBILE = {
	version: "24.20.0-0",
	url: "https://github.com/digidem/nodejs-mobile/releases/download/v24.20.0-0/nodejs-mobile-android-24.20.0-0.zip",
	sha256: "f5ffbaf4f2679fa9180b0758c637c2f8fc8828300f95129badf213a028fb37bb",
	nodeMajor: 24
}
const ANDROID_ABI = "arm64-v8a"

console.log(
	`Fetching Node.js runtime for Android (nodejs-mobile ${NODEJS_MOBILE.version})...`
)
const cacheDir = path.join(androidDir, ".cache/nodejs-mobile")
const zipPath = path.join(
	cacheDir,
	path.basename(new URL(NODEJS_MOBILE.url).pathname)
)

try {
	fs.mkdirSync(cacheDir, { recursive: true })

	if (
		fs.existsSync(zipPath) &&
		sha256File(zipPath) !== NODEJS_MOBILE.sha256
	) {
		console.warn(
			`Warning: cached ${zipPath} does not match the pinned sha256 — downloading again.`
		)
		fs.rmSync(zipPath, { force: true })
	}
	if (!fs.existsSync(zipPath)) {
		const res = await fetch(NODEJS_MOBILE.url, { redirect: "follow" })
		if (!res.ok) {
			throw new Error(
				`download failed: HTTP ${res.status} for ${NODEJS_MOBILE.url}`
			)
		}
		const partial = `${zipPath}.partial`
		fs.writeFileSync(partial, Buffer.from(await res.arrayBuffer()))
		const actual = sha256File(partial)
		if (actual !== NODEJS_MOBILE.sha256) {
			fs.rmSync(partial, { force: true })
			throw new Error(
				`sha256 mismatch for ${NODEJS_MOBILE.url}\n  expected ${NODEJS_MOBILE.sha256}\n  actual   ${actual}\n` +
					`Refusing to use it. If the release was deliberately replaced, re-verify it and update the pin.`
			)
		}
		fs.renameSync(partial, zipPath)
	}
	console.log(
		`nodejs-mobile zip verified (sha256 ${NODEJS_MOBILE.sha256.slice(0, 12)}…)`
	)

	if (fs.existsSync(libnodeDir)) {
		fs.rmSync(libnodeDir, { recursive: true, force: true })
	}
	fs.mkdirSync(libnodeDir, { recursive: true })
	// Only the one shipped ABI (build.gradle's abiFilters) and the headers.
	execFileSync(
		"unzip",
		[
			"-q",
			"-o",
			zipPath,
			`bin/${ANDROID_ABI}/*`,
			"include/*",
			"-d",
			libnodeDir
		],
		{ stdio: "inherit" }
	)

	const libnode = path.join(libnodeDir, `bin/${ANDROID_ABI}/libnode.so`)
	const versionHeader = path.join(libnodeDir, "include/node/node_version.h")
	if (!fs.existsSync(libnode) || !fs.existsSync(versionHeader)) {
		throw new Error(
			`the zip did not contain bin/${ANDROID_ABI}/libnode.so and include/node/`
		)
	}
	const major = /#define NODE_MAJOR_VERSION (\d+)/.exec(
		fs.readFileSync(versionHeader, "utf8")
	)?.[1]
	if (Number(major) !== NODEJS_MOBILE.nodeMajor) {
		throw new Error(
			`expected Node ${NODEJS_MOBILE.nodeMajor} headers, found NODE_MAJOR_VERSION ${major}`
		)
	}

	console.log(
		"✅ libnode.so + Node headers extracted to android/app/src/main/cpp/libnode"
	)
} catch (error) {
	if (error?.code === "ENOENT" && error?.path === "unzip") {
		console.error(
			"Error: `unzip` is not installed; it is needed to extract the nodejs-mobile zip."
		)
	} else {
		console.error("Error fetching nodejs-mobile runtime:", error)
	}
	process.exit(1)
}

// 7. Create package.json for runtime
const runtimePackage = {
	type: "module",
	name: "serene-pub-android",
	// The app's own version, so the server reports the release it shipped in.
	version: JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version,
	private: true
}
fs.writeFileSync(
	path.join(assetsDir, "package.json"),
	JSON.stringify(runtimePackage, null, 2)
)

console.log("\n✅ Assets prepared successfully!")
console.log("\nNext steps:")
console.log("  cd android")
console.log("  ./gradlew assembleRelease")
console.log("\nOr for debug:")
console.log("  ./gradlew assembleDebug")

// Helper functions
function sha256File(file) {
	return crypto
		.createHash("sha256")
		.update(fs.readFileSync(file))
		.digest("hex")
}

function copyRecursive(src, dest) {
	if (!fs.existsSync(src)) {
		console.warn(`Warning: ${src} does not exist, skipping...`)
		return
	}

	// adapter-node's build output includes pre-compressed .gz/.br siblings
	// alongside the originals (e.g. robots.txt + robots.txt.gz) for HTTP
	// compression negotiation. Android's asset merger treats a file and its
	// compressed variant as the same logical resource and fails the build on
	// the "duplicate". There's no reason to ship them anyway — this is a
	// loopback-only on-device server, not bandwidth-constrained.
	if (/\.(gz|br)$/i.test(src)) {
		return
	}

	const stats = fs.statSync(src)
	if (stats.isDirectory()) {
		if (!fs.existsSync(dest)) {
			fs.mkdirSync(dest, { recursive: true })
		}
		const entries = fs.readdirSync(src, { withFileTypes: true })
		for (const entry of entries) {
			copyRecursive(
				path.join(src, entry.name),
				path.join(dest, entry.name)
			)
		}
	} else {
		fs.copyFileSync(src, dest)
	}
}
