// scripts/bundle-dist.js
// Bundles app and launcher for each OS into
// ./dist/serene-pub-<version>-<os>/serene-pub/ — see scripts/dist-layout.js for
// why the shipped directory is unversioned and why the payload sits under
// app/.

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import child_process from "child_process"

import pkg from "../package.json" with { type: "json" }
import { pruneDist } from "./prune-dist.js"
import { appDir, bundleRootDir } from "./dist-layout.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const version = pkg.version
const distDir = path.resolve(__dirname, "../dist")
const buildDir = path.resolve(__dirname, "../build")
// Top-level docs, copied beside the app/ payload rather than into it — they
// are for the person who extracted the folder, not for the runtime.
// KEYBINDINGS.md used to be listed here and no longer exists in the repo; the
// copy loop skips missing files silently, so it was a dead entry rather than a
// build failure.
const filesToCopy = ["LICENSE", "README.md", "NOTICE.md"]

function copyRecursive(src, dest) {
	// existsSync follows symlinks, so a dangling one is skipped here rather
	// than throwing further down.
	if (!fs.existsSync(src)) return
	// statSync, not lstatSync: npm installs a `file:` dependency as a SYMLINK
	// to a directory (this repo has several — @serene-pub/* point at the
	// sibling SDK checkout), and lstat reports those as not-a-directory, so
	// the copy fell through to copyFileSync and died with EISDIR. A shipped
	// node_modules has to contain real files anyway: a symlink out of the
	// bundle is dangling the moment the zip is extracted on another machine.
	if (fs.statSync(src).isDirectory()) {
		fs.mkdirSync(dest, { recursive: true })
		for (const file of fs.readdirSync(src)) {
			copyRecursive(path.join(src, file), path.join(dest, file))
		}
	} else {
		fs.copyFileSync(src, dest)
	}
}

// Whitelist for packages with UNKNOWN license but known to be MIT
const LICENSE_WHITELIST = [
	{ name: "json-bignum", version: "0.0.3" },
	{ name: "xmlhttprequest-ssl", version: "2.1.2" },
	{ name: "@img/sharp-libvips-linux-x64", version: "1.2.4" },
	{ name: "@img/sharp-libvips-linuxmusl-x64", version: "1.2.4" },
	{ name: "@img/sharp-libvips-darwin-arm64", version: "1.2.4" },
	{ name: "@img/sharp-libvips-darwin-x64", version: "1.2.4" },
	{ name: "@img/sharp-darwin-arm64", version: "0.34.5" },
	{ name: "@img/sharp-darwin-x64", version: "0.34.5" },
	{ name: "@img/sharp-linux-x64", version: "0.34.5" },
	{ name: "@img/sharp-linux-arm64", version: "0.34.5" },
	{ name: "@img/sharp-win32-x64", version: "0.34.5" },
	{ name: "@img/sharp-win32-arm64", version: "0.34.5" },
	{ name: "json-schema", version: "0.4.0" },
	{ name: "type-fest", version: "0.13.1" }
]

function isWhitelisted(name, version) {
	return LICENSE_WHITELIST.some(
		(pkg) => pkg.name === name && pkg.version === version
	)
}

// Acceptable licenses for redistribution with AGPL app
const ACCEPTABLE_LICENSES = [
	// SIL Open Font License — the standard permissive licence for fonts, and
	// what @fontsource/* ships under. Not needed by CI, which runs
	// `npm install --production` before bundling so dev dependencies are gone
	// by the time the check below scans node_modules. It matters when running
	// `npm run dist` locally with dev dependencies installed, where
	// @fontsource/fira-mono (a devDependency) is otherwise reported as an
	// unacceptable licence and aborts the bundle.
	"ofl-1.1",
	"mit",
	"isc",
	"bsd-2-clause",
	"bsd-3-clause",
	"0bsd",
	"wtfpl",
	"apache-2.0",
	"afl-2.1",
	"afl-2.1 or bsd-3-clause",
	"agpl-3.0",
	"agpl-3.0-only",
	"agpl-3.0-or-later",
	"lgpl-3.0",
	"lgpl-3.0-only",
	"lgpl-3.0-or-later",
	"blueoak-1.0.0",
	"bsd",
	"bsd-2-clause or mit or apache-2.0",
	"bsd-2-clause or mit",
	"bsd-3-clause or mit",
	"bsd-2-clause or mit or apache-2.0",
	"apache-2.0 or mit",
	"apache-2.0 or bsd-3-clause",
	"apache-2.0 or mit or bsd-3-clause",
	"apache-2.0 or mit or bsd-2-clause",
	"mit or wtfpl",
	"mit or bsd-2-clause",
	"mit or bsd-3-clause",
	"mit or apache-2.0",
	"mit or isc",
	"isc or mit",
	"0bsd or mit",
	"bsd-2-clause or mit or apache-2.0",
	"bsd-3-clause or mit or apache-2.0",
	"bsd-3-clause or mit or apache-2.0",
	"bsd-2-clause or mit or apache-2.0",
	"bsd-3-clause or mit or apache-2.0",
	"bsd-2-clause or mit",
	"bsd-3-clause or mit",
	"bsd-2-clause or apache-2.0",
	"bsd-3-clause or apache-2.0",
	"bsd-2-clause or bsd-3-clause",
	"bsd-3-clause or bsd-2-clause",
	"public domain",
	"unlicense",
	"cc0-1.0",
	"cc0",
	"0bsd",
	"bsd-2-clause-freebsd",
	"bsd-3-clause-clear",
	"bsd-3-clause-new",
	"bsd-3-clause-revised",
	"bsd-3-clause-simplified",
	"bsd-3-clause-modified",
	"bsd-3-clause",
	"bsd-2-clause",
	"bsd",
	"wtfpl",
	"isc",
	"mit",
	"apache-2.0",
	"agpl-3.0",
	"agpl-3.0-only",
	"agpl-3.0-or-later",
	"bsd-2-clause or mit or apache-2.0",
	"bsd-3-clause or mit or apache-2.0",
	"bsd-2-clause or mit",
	"bsd-3-clause or mit",
	"bsd-2-clause or apache-2.0",
	"bsd-3-clause or apache-2.0",
	"bsd-2-clause or bsd-3-clause",
	"bsd-3-clause or bsd-2-clause",
	"public domain",
	"unlicense",
	"cc0-1.0",
	"cc0",
	"0bsd",
	"bsd-2-clause-freebsd",
	"bsd-3-clause-clear",
	"bsd-3-clause-new",
	"bsd-3-clause-revised",
	"bsd-3-clause-simplified",
	"bsd-3-clause-modified",
	"bsd-3-clause",
	"bsd-2-clause",
	"bsd",
	"python-2.0",
	"lgpl-3.0",
	"lgpl-3.0-only",
	"lgpl-3.0-or-later",
	"lgpl-3.0 or later",
	"apache-2.0 and lgpl-3.0-or-later",
	"apache-2.0 and lgpl-3.0",
	"apache-2.0 or lgpl-3.0-or-later",
	"mpl-2.0"
]

function isAcceptableLicense(license, name, version) {
	if (!license) return false
	// Handle license objects and arrays from package.json
	if (typeof license === "object") {
		if (Array.isArray(license)) {
			license = license
				.map((l) => (typeof l === "string" ? l : l.type || ""))
				.join(" or ")
		} else {
			license = license.type || license.license || ""
		}
	}
	// Special case: whitelist
	if (isWhitelisted(name, version)) return true
	// npm SPDX dual/multi-license expressions are sometimes wrapped in a
	// single pair of outer parens, e.g. "(MPL-2.0 OR Apache-2.0)" — unwrap
	// that first so the blanket parenthetical-notes removal below (meant for
	// trailing annotations like "MIT (see LICENSE)") doesn't delete the
	// entire license expression and leave nothing to check.
	let cleaned = String(license).trim()
	if (/^\(.*\)$/.test(cleaned)) {
		cleaned = cleaned.slice(1, -1)
	}
	// Remove parentheses and whitespace, split on OR/AND/||/&&
	// Normalize some common noise and lowercase
	cleaned = cleaned
		.replace(/\s*\(.*?\)\s*/g, "") // remove remaining parenthesized notes
		.replace(/\s*license:\s*/i, "")
		.replace(/\s*the\s*/i, "")
		.toLowerCase()
	const parts = cleaned
		.split(/\s*(or|and|\|\||&&|,|\/)\s*/i)
		.filter((s) => s && !["or", "and", "||", "&&", "/"].includes(s))
	// If all parts are in the allowlist, it's acceptable
	return (
		parts.length > 0 &&
		parts.every((l) => ACCEPTABLE_LICENSES.includes(l.trim()))
	)
}

function checkAllLicensesAcceptable(nodeModulesPath) {
	let problematic = []
	function checkDir(dir) {
		const entries = fs.readdirSync(dir, { withFileTypes: true })
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (entry.name.startsWith("@")) {
					checkDir(path.join(dir, entry.name))
				} else {
					const pkgPath = path.join(dir, entry.name, "package.json")
					if (fs.existsSync(pkgPath)) {
						try {
							const pkgData = JSON.parse(
								fs.readFileSync(pkgPath, "utf8")
							)
							const license = (
								pkgData.license || ""
							).toLowerCase()
							const name = pkgData.name || entry.name
							const version = pkgData.version || ""
							if (license === "unknown" || !license) {
								if (
									!isAcceptableLicense(license, name, version)
								) {
									if (!isWhitelisted(name, version)) {
										// Print a warning, but do not fail; user must manually verify
										console.warn(
											`WARNING: ${name}@${version} has UNKNOWN license. Please verify manually. (${pkgPath})`
										)
									}
								}
							} else if (
								!isAcceptableLicense(license, name, version)
							) {
								problematic.push({
									name,
									version,
									license: pkgData.license || "UNKNOWN",
									path: pkgPath
								})
							}
						} catch (e) {
							problematic.push({
								name: entry.name,
								version: "",
								license: "PARSE_ERROR",
								path: pkgPath
							})
						}
					}
				}
			}
		}
	}
	checkDir(nodeModulesPath)
	return problematic
}

// Define all target OS/arch combinations
const targets = [
	{ name: "linux-x64", platform: "linux", arch: "x64" },
	{ name: "linux-arm64", platform: "linux", arch: "arm64" },
	{ name: "linux-arm", platform: "linux", arch: "arm" },
	{ name: "linux-ia32", platform: "linux", arch: "ia32" },
	{ name: "linux-ppc64", platform: "linux", arch: "ppc64" },
	{ name: "macos-x64", platform: "darwin", arch: "x64" },
	{ name: "macos-arm64", platform: "darwin", arch: "arm64" },
	{ name: "windows-x64", platform: "win32", arch: "x64" },
	{ name: "windows-arm64", platform: "win32", arch: "arm64" }
]

// Accept a single target as a command-line argument
const argTarget = process.argv[2]
if (!argTarget) {
	console.error("Usage: node bundle-dist.js <target>")
	console.error("Valid targets:", targets.map((t) => t.name).join(", "))
	process.exit(1)
}
const target = targets.find((t) => t.name === argTarget)
if (!target) {
	console.error(`Invalid target: ${argTarget}`)
	console.error("Valid targets:", targets.map((t) => t.name).join(", "))
	process.exit(1)
}

;(async () => {
	try {
		// 1. License check
		console.log("Checking licenses...")
		const problematic = checkAllLicensesAcceptable(
			path.resolve(__dirname, "../node_modules")
		)
		if (problematic.length > 0) {
			console.error("Unacceptable licenses found:")
			for (const p of problematic) {
				console.error(
					`  ${p.name}@${p.version}: ${p.license} (${p.path})`
				)
			}
			process.exit(1)
		}

		// 2. Create dist bundle
		//
		// Three directories, three jobs (scripts/dist-layout.js explains why):
		//   stageDir   dist/serene-pub-<version>-<target> — versioned and
		//              per-target so several targets coexist and release.yml can
		//              still find the one it just built. Never shipped.
		//   bundleRoot stageDir/serene-pub — the single, UNVERSIONED entry that
		//              gets zipped, so extracting yields serene-pub/ exactly once
		//              and "extract over your old folder" is a valid upgrade.
		//   payloadDir bundleRoot/app (or, on macOS, the same thing inside the
		//              .app bundle's Resources) — everything that IS the
		//              application, in one directory a future updater can replace
		//              with a single rename.
		const stageDir = path.join(
			distDir,
			`serene-pub-${version}-${target.name}`
		)
		const bundleRoot = bundleRootDir(stageDir)
		const payloadDir = appDir(stageDir, target.name)
		if (fs.existsSync(stageDir))
			fs.rmSync(stageDir, { recursive: true, force: true })
		fs.mkdirSync(payloadDir, { recursive: true })

		const platformDir = path.resolve(
			__dirname,
			`../dist-assets/${target.name.split("-")[0]}`
		)
		const isWindows = target.platform === "win32"

		// ── What the user sees when they extract ────────────────────────────
		// Docs and launchers, at the top level, outside the payload: they are
		// for the person who extracted the folder, and the launcher in
		// particular has to survive the payload being swapped underneath it.

		// Platform-specific executables and icons. The macOS .app bundle is
		// copied here too, before the payload is written inside it.
		for (const file of fs.readdirSync(platformDir)) {
			// run.* is the forwarder (copied below, needs chmod), app/ holds the
			// bare entrypoint that belongs in the payload, and INSTRUCTIONS.txt
			// is copied separately.
			if (
				file.startsWith("run.") ||
				file === "app" ||
				file === "INSTRUCTIONS.txt"
			) {
				continue
			}
			// A .desktop entry cannot be produced at build time: the spec
			// requires absolute Exec=/Icon=/Path= values, and the only absolute
			// path a build machine knows is its own. Shipping one anyway is what
			// this repo used to do — every Linux release carried an entry
			// pointing into the CI runner's filesystem. install-desktop-shortcut.sh
			// writes a correct entry on the user's machine instead, so nothing
			// with a baked-in path is allowed into the bundle even if one is
			// left lying around in dist-assets/.
			if (file.endsWith(".desktop")) {
				console.warn(
					`Skipping ${file}: a .desktop entry's absolute paths are only valid on the machine that wrote them (install-desktop-shortcut.sh writes one after extraction).`
				)
				continue
			}

			const srcPath = path.join(platformDir, file)
			const destPath = path.join(bundleRoot, file)

			if (fs.lstatSync(srcPath).isDirectory()) {
				// Copy directories recursively (like .app bundles)
				copyRecursive(srcPath, destPath)
				console.log(`Copied directory: ${file}`)
			} else {
				fs.copyFileSync(srcPath, destPath)

				// Make executables executable on Unix platforms
				if (
					!isWindows &&
					(file === "Serene Pub" || file.endsWith(".sh"))
				) {
					fs.chmodSync(destPath, 0o755)
				}
				console.log(`Copied file: ${file}`)
			}
		}

		// The thin forwarder into the payload — the path people bookmark, pin
		// and put in shortcuts, kept working across an update that replaces
		// everything under it. A later phase swaps it for a compiled launcher.
		for (const runFile of fs
			.readdirSync(platformDir)
			.filter((f) => f.startsWith("run."))) {
			const dest = path.join(bundleRoot, runFile)
			fs.copyFileSync(path.join(platformDir, runFile), dest)
			if (!isWindows && runFile.endsWith(".sh")) {
				fs.chmodSync(dest, 0o755)
			}
		}

		// Copy LICENSE, README, etc.
		for (const file of filesToCopy) {
			if (fs.existsSync(path.resolve(__dirname, "..", file))) {
				fs.copyFileSync(
					path.resolve(__dirname, "..", file),
					path.join(bundleRoot, file)
				)
			}
		}

		// Copy platform-specific instructions
		const instrFile = path.join(platformDir, "INSTRUCTIONS.txt")
		if (fs.existsSync(instrFile)) {
			fs.copyFileSync(
				instrFile,
				path.join(bundleRoot, "INSTRUCTIONS.txt")
			)
		}

		// The shipped .env.example. This used to be generated inline by a
		// heredoc in .github/workflows/release.yml, which meant desktop users
		// got a four-variable file that had drifted far from the repo's own
		// .env.example and never mentioned any hosting setting at all. Keeping
		// it as a checked-in file is the only way the two stay in sync.
		//
		// It belongs at the top level, not with the payload: a template has to
		// sit where the file it is a template FOR is read from, and the legacy
		// .env is looked for at the install root first (preloadEnv.js, via the
		// SERENE_PUB_INSTALL_ROOT the entrypoint exports). It is also the only
		// placement that survives an update, since app/ is replaced wholesale.
		// The file's own text points the reader at the OS data directory, which
		// is better still.
		const envExample = path.resolve(
			__dirname,
			"../dist-assets/.env.example"
		)
		if (fs.existsSync(envExample)) {
			fs.copyFileSync(envExample, path.join(bundleRoot, ".env.example"))
		}

		// ── The payload ────────────────────────────────────────────────────

		// The bare entrypoint: starts the Node server and nothing else. Lives
		// with the payload because it is version-locked to it (it knows where
		// build/index.js and the bundled runtime are), and is the supported way
		// to run headless, from a service unit, or while debugging.
		const appAssetsDir = path.join(platformDir, "app")
		for (const runFile of fs
			.readdirSync(appAssetsDir)
			.filter((f) => f.startsWith("run."))) {
			const dest = path.join(payloadDir, runFile)
			fs.copyFileSync(path.join(appAssetsDir, runFile), dest)
			if (!isWindows && runFile.endsWith(".sh")) {
				fs.chmodSync(dest, 0o755)
			}
		}

		// Copy build. static/ is NOT copied separately — build/client already
		// contains everything SvelteKit put there from static/ at build time,
		// so a second copy was pure duplication (see userSettings.ts's
		// manifest-path fallback for the one runtime reader that used to
		// depend on the static/ copy specifically).
		copyRecursive(buildDir, path.join(payloadDir, "build"))

		// Copy node_modules (assuming it's already prepared for this target)
		copyRecursive(
			path.resolve(__dirname, "../node_modules"),
			path.join(payloadDir, "node_modules")
		)

		// Copy drizzle migrations folder. drizzle.config.ts resolves it as the
		// relative "./drizzle", so it has to sit beside build/ in whatever
		// directory the entrypoint cd's into.
		copyRecursive(
			path.resolve(__dirname, "../drizzle"),
			path.join(payloadDir, "drizzle")
		)

		// Copy Node.js binary for the target platform
		const nodeSrcName = isWindows ? "node.exe" : "node"
		const nodeSrcPath = path.resolve(__dirname, "..", nodeSrcName)
		const nodeDestPath = path.join(payloadDir, nodeSrcName)

		if (fs.existsSync(nodeSrcPath)) {
			fs.copyFileSync(nodeSrcPath, nodeDestPath)
			if (!isWindows) {
				fs.chmodSync(nodeDestPath, 0o755)
			}
			console.log(`Copied Node.js binary: ${nodeSrcName}`)
		} else {
			console.warn(`Warning: Node.js binary not found at ${nodeSrcPath}`)
		}

		// Strip known-dead weight from the assembled copy — never touches the
		// developer's real node_modules/build/drizzle, only the payload's
		// copies.
		console.log("Pruning dist...")
		pruneDist(payloadDir, target)

		// Write minimal package.json. Beside build/ and node_modules/, where
		// Node resolves it: it is what makes build/index.js load as ESM.
		fs.writeFileSync(
			path.join(payloadDir, "package.json"),
			JSON.stringify(
				{
					type: "module",
					name: pkg.name,
					version: pkg.version,
					description: pkg.description,
					license: pkg.license
				},
				null,
				2
			)
		)

		console.log(
			`Distributable generated in dist/${path.basename(stageDir)}/${path.basename(bundleRoot)}`
		)
	} catch (err) {
		console.error("Bundle process failed:", err)
		process.exit(1)
	}
})()
