// scripts/bundle-dist.js
// Bundles the app and its launcher for one target into
// ./dist/serene-pub-<version>-<target>/serene-pub/ — see scripts/dist-layout.js
// for the layout and why it is shaped that way.
//
// Usage:
//   node scripts/bundle-dist.js <target> [--launcher-dir <dir>]
//       Needs, beforehand: npm run build; node launcher/build.mjs --target
//       <target> … --out dist/launcher/<target> (the default --launcher-dir);
//       node scripts/create-executables.js <target>; the target's Node
//       runtime at ./node or ./node.exe.
//   node scripts/bundle-dist.js --checksum <zip>
//       Writes <zip>.sha256 beside it in the format the updater verifies
//       (dist-layout.js checksumLine). One implementation for all three
//       runners, so no shell's encoding/line-ending defaults can leak in.

import fs from "fs"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"

import pkg from "../package.json" with { type: "json" }
import { pruneDist } from "./prune-dist.js"
import { applyOnnxRuntimeOverride } from "./onnxRuntimeOverride.js"
import {
	appDir,
	bundleRootDir,
	generatedAssetsDir,
	launcherDestPath,
	launcherFileName,
	launcherOutputDir,
	macosBundleDir,
	MACOS_ICON_FILE,
	targetPlatform,
	windowHelperDestPath,
	windowHelperFileName,
	writeChecksumFile
} from "./dist-layout.js"
import { isAcceptableLicense, isWhitelisted } from "./licenseExpression.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const version = pkg.version
const repoRoot = path.resolve(__dirname, "..")
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
	// statSync, not lstatSync: a linked package is a SYMLINK to a directory
	// (`npm run sdk:link` points @serene-pub/* at the sibling SDK checkout),
	// and lstat reports those as not-a-directory, so
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

// The targets a release can be bundled for — exactly the ones the launcher is
// built for (dist-layout.js LAUNCHER_TARGETS). linux-arm64/ppc64, linux-arm,
// windows-arm64 and linux-ia32 used to be listed too, but none had a working
// CI row and none has a launcher build, and a bundle without its launcher is
// refused (see placeLauncher).
const targets = [
	{ name: "linux-x64", platform: "linux", arch: "x64" },
	{ name: "macos-x64", platform: "darwin", arch: "x64" },
	{ name: "macos-arm64", platform: "darwin", arch: "arm64" },
	{ name: "windows-x64", platform: "win32", arch: "x64" }
]

/**
 * Copy `src` to `dest`, creating parents; 0755 when `executable` (POSIX
 * targets only — Windows has no mode bits, and Compress-Archive writes none).
 */
function placeFile(src, dest, executable) {
	fs.mkdirSync(path.dirname(dest), { recursive: true })
	fs.copyFileSync(src, dest)
	if (executable) fs.chmodSync(dest, 0o755)
}

/**
 * The Windows bundle's own text files — run.cmd, INSTRUCTIONS.txt and
 * .env.example — always ship with CRLF line endings, whatever the checkout
 * gave us. git stores them with LF, so a Linux build box and a Windows runner
 * (core.autocrlf) would otherwise ship different bytes; cmd.exe misparses
 * labels and multi-line blocks in an LF batch file.
 */
export const WINDOWS_CRLF_FILES =
	/(\.(cmd|bat)|^INSTRUCTIONS\.txt|^\.env\.example)$/

/** placeFile for a text file, rewritten to CRLF line endings. */
function placeCrlf(src, dest) {
	fs.mkdirSync(path.dirname(dest), { recursive: true })
	fs.writeFileSync(
		dest,
		fs.readFileSync(src, "utf8").replace(/\r?\n/g, "\r\n")
	)
}

/**
 * The launcher outputs for a target, as launcher/build.mjs writes them (§C7).
 * Throws — naming the command that makes them — when either is missing. There
 * is deliberately no shim fallback: a release whose double-click start is a
 * shell script instead of the launcher would look like it works and then have
 * no tray, no window and no update path.
 *
 * @param {string} launcherDir dist/launcher/<target>
 * @param {string} targetName
 */
export function requireLauncherOutputs(launcherDir, targetName) {
	const launcher = path.join(launcherDir, launcherFileName(targetName))
	const helper = path.join(launcherDir, windowHelperFileName(targetName))
	const missing = [launcher, helper].filter((f) => !fs.existsSync(f))
	if (missing.length) {
		throw new Error(
			`launcher outputs missing for ${targetName}:\n` +
				missing.map((f) => `  ${f}`).join("\n") +
				`\nBuild them first: node launcher/build.mjs --target ${targetName} ` +
				`--version <version> --channel <channel> --commit <sha> --out ${launcherDir}`
		)
	}
	return { launcher, helper }
}

/**
 * Place the launcher and the window helper per §C1: the launcher at the top
 * of the extracted folder (Windows/Linux) or as the bundle's
 * CFBundleExecutable (macOS); the window helper inside the payload.
 *
 * @param {object} args
 * @param {string} args.targetName
 * @param {string} args.stageDir dist/serene-pub-<version>-<target>
 * @param {string} args.launcherDir dist/launcher/<target>
 */
export function placeLauncher({ targetName, stageDir, launcherDir }) {
	const { launcher, helper } = requireLauncherOutputs(launcherDir, targetName)
	const posix = targetPlatform(targetName) !== "win32"
	placeFile(launcher, launcherDestPath(stageDir, targetName), posix)
	placeFile(helper, windowHelperDestPath(stageDir, targetName), posix)
}

/**
 * Everything in the release EXCEPT the heavy payload (build/, node_modules/,
 * drizzle/, the Node runtime, package.json): the launcher and window helper,
 * the top-level docs, the platform's generated files, the macOS bundle's
 * skeleton and the bare entrypoint. Starts from an empty stage directory.
 * Split out of main() so bundle-dist.test.ts can assert the layout per
 * target against stub launcher binaries, without a build.
 *
 * @param {object} args
 * @param {string} args.targetName
 * @param {string} args.stageDir dist/serene-pub-<version>-<target>
 * @param {string} args.repoRoot
 * @param {string} args.launcherDir dist/launcher/<target>
 * @param {string} args.generatedDir dist/generated/<target>
 */
export function assembleShell({
	targetName,
	stageDir,
	repoRoot,
	launcherDir,
	generatedDir
}) {
	const platform = targetPlatform(targetName)
	const posix = platform !== "win32"
	const assetsDir = path.join(repoRoot, "dist-assets")
	const platformDir = path.join(assetsDir, targetName.split("-")[0])
	const bundleRoot = bundleRootDir(stageDir)
	const payloadDir = appDir(stageDir, targetName)

	// Fail before touching anything when an input is missing.
	requireLauncherOutputs(launcherDir, targetName)
	const generated =
		platform === "darwin"
			? ["Info.plist", MACOS_ICON_FILE]
			: platform === "linux"
				? ["install-desktop-shortcut.sh"]
				: []
	const missingGenerated = generated.filter(
		(f) => !fs.existsSync(path.join(generatedDir, f))
	)
	if (missingGenerated.length) {
		throw new Error(
			`generated files missing for ${targetName}: ${missingGenerated.join(", ")} in ${generatedDir}\n` +
				`Render them first: node scripts/create-executables.js ${targetName}`
		)
	}

	if (fs.existsSync(stageDir))
		fs.rmSync(stageDir, { recursive: true, force: true })
	fs.mkdirSync(payloadDir, { recursive: true })

	// ── The launcher and window helper (§C1) ─────────────────────────────
	placeLauncher({ targetName, stageDir, launcherDir })

	// ── What the user sees when they extract ─────────────────────────────
	// Docs at the top level, outside the swap unit: they are for the person
	// who extracted the folder. The launcher refreshes them from an update's
	// payload after a successful swap (§C8 step 8).
	for (const file of [...filesToCopy, ".env.example", "INSTRUCTIONS.txt"]) {
		const src =
			file === ".env.example"
				? path.join(assetsDir, ".env.example")
				: file === "INSTRUCTIONS.txt"
					? path.join(platformDir, "INSTRUCTIONS.txt")
					: path.join(repoRoot, file)
		// The shipped .env.example is a checked-in file (it used to be a
		// heredoc in release.yml that drifted from the repo's own). It sits at
		// the top level because a legacy .env is looked for at the install
		// root (preloadEnv.js, via SERENE_PUB_INSTALL_ROOT); its own text
		// points the reader at the OS data directory, which is better still.
		if (!fs.existsSync(src)) continue
		if (!posix && WINDOWS_CRLF_FILES.test(file))
			placeCrlf(src, path.join(bundleRoot, file))
		else placeFile(src, path.join(bundleRoot, file), false)
	}

	if (platform === "linux") {
		// Writes a .desktop entry on the user's machine — an entry cannot be
		// produced at build time, because the spec requires absolute paths and
		// the only absolute path a build machine knows is its own.
		placeFile(
			path.join(generatedDir, "install-desktop-shortcut.sh"),
			path.join(bundleRoot, "install-desktop-shortcut.sh"),
			true
		)
	}

	if (platform === "darwin") {
		const contents = path.join(macosBundleDir(stageDir), "Contents")
		placeFile(
			path.join(generatedDir, "Info.plist"),
			path.join(contents, "Info.plist"),
			false
		)
		placeFile(
			path.join(generatedDir, MACOS_ICON_FILE),
			path.join(contents, "Resources", MACOS_ICON_FILE),
			false
		)
		// Portable only: a terminal shortcut that exec's the bundle's bare
		// entrypoint. Outside the bundle, so it never touches the signature.
		placeFile(
			path.join(platformDir, "run.sh"),
			path.join(bundleRoot, "run.sh"),
			true
		)
	}

	// ── The bare entrypoint ──────────────────────────────────────────────
	// Starts the Node server and nothing else. Lives with the payload because
	// it is version-locked to it (it knows where build/index.js and the
	// bundled runtime are), and is the supported way to run headless, from a
	// service unit, or while debugging.
	const appAssetsDir = path.join(platformDir, "app")
	for (const runFile of fs
		.readdirSync(appAssetsDir)
		.filter((f) => f.startsWith("run."))) {
		if (!posix && WINDOWS_CRLF_FILES.test(runFile)) {
			placeCrlf(
				path.join(appAssetsDir, runFile),
				path.join(payloadDir, runFile)
			)
			continue
		}
		placeFile(
			path.join(appAssetsDir, runFile),
			path.join(payloadDir, runFile),
			posix && runFile.endsWith(".sh")
		)
	}

	return { bundleRoot, payloadDir }
}

/**
 * Guards the CLI entry point so importing this module for its exports (for a
 * test) does not also run the build.
 */
const isMain =
	!!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

async function main() {
	const args = process.argv.slice(2)
	if (args[0] === "--checksum") {
		if (!args[1]) {
			console.error("Usage: node bundle-dist.js --checksum <zip>")
			process.exit(1)
		}
		const out = await writeChecksumFile(path.resolve(args[1]))
		process.stdout.write(fs.readFileSync(out, "ascii"))
		return
	}
	const argTarget = args[0]
	const launcherFlag = args.indexOf("--launcher-dir")
	const launcherDirArg =
		launcherFlag >= 0 && args[launcherFlag + 1]
			? path.resolve(args[launcherFlag + 1])
			: undefined
	if (!argTarget || argTarget.startsWith("--")) {
		console.error(
			"Usage: node bundle-dist.js <target> [--launcher-dir <dir>] | --checksum <zip>"
		)
		console.error("Valid targets:", targets.map((t) => t.name).join(", "))
		process.exit(1)
	}
	const target = targets.find((t) => t.name === argTarget)
	if (!target) {
		console.error(`Invalid target: ${argTarget}`)
		console.error("Valid targets:", targets.map((t) => t.name).join(", "))
		process.exit(1)
	}

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
		//              gets zipped.
		//   payloadDir bundleRoot/app (or, on macOS, Contents/Resources/app in
		//              the .app bundle) — everything that IS the application.
		const stageDir = path.join(
			distDir,
			`serene-pub-${version}-${target.name}`
		)
		const { bundleRoot, payloadDir } = assembleShell({
			targetName: target.name,
			stageDir,
			repoRoot,
			launcherDir:
				launcherDirArg ?? launcherOutputDir(distDir, target.name),
			generatedDir: generatedAssetsDir(distDir, target.name)
		})
		const isWindows = target.platform === "win32"

		// ── The payload ────────────────────────────────────────────────────

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

		// Intel macOS only: onnxruntime-node ships no darwin/x64 binary after
		// 1.23.2, so that bundle carries 1.23.2 in place of the pinned runtime
		// (scripts/onnxRuntimeOverride.js). Before pruneDist, which then strips
		// every other platform's binary from it as usual.
		applyOnnxRuntimeOverride(payloadDir, target)

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
}

if (isMain) {
	main()
}
