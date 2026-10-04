// scripts/dist-layout.js
//
// The one description of what a portable release looks like once extracted.
// bundle-dist.js builds it, check-dist-size.js measures it, create-executables.js
// renders the files it needs, and .github/workflows/release.yml zips it and
// writes its checksum. The frozen contract this mirrors is §C1/§C7/§C12 of the
// desktop-distribution plan; the server's updater (src/lib/server/updater/)
// and the Go launcher (launcher/) read the same names.
//
// A staging directory keeps its versioned, per-target name so several targets
// can be built side by side in dist/ and so release.yml can still find the one
// it just built:
//
//     dist/serene-pub-<version>-<target>/      <- staging, never shipped
//       serene-pub/                            <- the ONLY entry that is zipped
//
// Windows / Linux                              macOS
//     serene-pub/                                  serene-pub/
//       Serene Pub.exe | serene-pub  launcher        Serene Pub.app/          swap unit
//       app/                         swap unit         Contents/Info.plist
//         node | node.exe                              Contents/MacOS/serene-pub   launcher
//         serene-pub-window[.exe]    window helper     Contents/Resources/favicon.icns
//         build/ node_modules/ drizzle/                Contents/Resources/app/     payload
//         package.json                               run.sh   (-> the bundle's app/run.sh)
//         run.sh | run.cmd           bare entrypoint LICENSE README.md NOTICE.md
//       LICENSE README.md NOTICE.md                  INSTRUCTIONS.txt .env.example
//       INSTRUCTIONS.txt .env.example
//       install-desktop-shortcut.sh (Linux)
//
// Decisions encoded here:
//
// 1. The zipped directory is UNVERSIONED. The archive keeps its version in its
//    filename, but its single top-level entry is plain `serene-pub`. That
//    stops the double-nesting extractors produced when both carried the
//    version, and it makes "extract the new zip over your old folder" a valid
//    manual upgrade — safe only because nothing user-owned lives in the
//    install folder (.env and the database are in the OS data directory,
//    src/lib/server/config/preloadEnv.js).
//
// 2. Everything that IS the application lives in ONE directory — the swap
//    unit: `app/` on Windows/Linux, the whole `Serene Pub.app` on macOS. The
//    launcher replaces the application by renaming the swap unit aside and
//    moving a freshly downloaded one into place. On Windows/Linux the launcher
//    therefore lives OUTSIDE app/ (it is replaced separately, by itself); on
//    macOS it is inside the bundle because a bundle has to carry its own
//    executable, and the bundle is swapped (and re-signed) as one unit.
//
// 3. The window helper lives INSIDE the payload: it is version-locked to the
//    app, and keeping it there means it updates with the app and never needs
//    the launcher's self-replacement dance.

import crypto from "crypto"
import fs from "fs"
import path from "path"

/** The single top-level entry inside the release archive. */
export const BUNDLE_DIR_NAME = "serene-pub"

/** The payload directory's name inside the extracted folder / .app bundle. */
export const APP_DIR_NAME = "app"

/** macOS ships the payload inside the .app bundle rather than beside it. */
export const MACOS_APP_BUNDLE_NAME = "Serene Pub.app"

/** The bundle's CFBundleExecutable — the launcher, on macOS. */
export const MACOS_BUNDLE_EXECUTABLE = "serene-pub"

/** CFBundleIconFile, in Contents/Resources. */
export const MACOS_ICON_FILE = "favicon.icns"

/** The targets the launcher is built for (§C7) — and so the only ones that
 * can be bundled: a release without its launcher is not a release. */
export const LAUNCHER_TARGETS = [
	"linux-x64",
	"windows-x64",
	"macos-x64",
	"macos-arm64"
]

/** @param {string} targetName */
export function targetPlatform(targetName) {
	if (targetName.startsWith("macos")) return "darwin"
	if (targetName.startsWith("windows")) return "win32"
	return "linux"
}

/**
 * The launcher's file name, exactly as launcher/build.mjs writes it into
 * dist/launcher/<target>/ (§C7) — and, on Windows/Linux, its name at the top
 * of the extracted folder.
 *
 * @param {string} targetName
 */
export function launcherFileName(targetName) {
	return targetPlatform(targetName) === "win32"
		? "Serene Pub.exe"
		: "serene-pub"
}

/** @param {string} targetName */
export function windowHelperFileName(targetName) {
	return targetPlatform(targetName) === "win32"
		? "serene-pub-window.exe"
		: "serene-pub-window"
}

/**
 * Where launcher/build.mjs leaves its two binaries for a target (§C7).
 *
 * @param {string} distDir the repo's dist/
 * @param {string} targetName
 */
export function launcherOutputDir(distDir, targetName) {
	return path.join(distDir, "launcher", targetName)
}

/**
 * Where create-executables.js renders a target's generated files (Info.plist,
 * favicon.icns, install-desktop-shortcut.sh). Never dist-assets/: that
 * directory holds templates and hand-written sources only.
 *
 * @param {string} distDir the repo's dist/
 * @param {string} targetName
 */
export function generatedAssetsDir(distDir, targetName) {
	return path.join(distDir, "generated", targetName)
}

/**
 * The directory that gets zipped, inside a staging directory.
 *
 * @param {string} stageDir dist/serene-pub-<version>-<target>
 */
export function bundleRootDir(stageDir) {
	return path.join(stageDir, BUNDLE_DIR_NAME)
}

/**
 * The .app bundle (macOS only).
 *
 * @param {string} stageDir
 */
export function macosBundleDir(stageDir) {
	return path.join(bundleRootDir(stageDir), MACOS_APP_BUNDLE_NAME)
}

/**
 * The swap unit: what an update replaces in one rename (§C1).
 *
 * @param {string} stageDir
 * @param {string} targetName
 */
export function swapUnitDir(stageDir, targetName) {
	return targetPlatform(targetName) === "darwin"
		? macosBundleDir(stageDir)
		: path.join(bundleRootDir(stageDir), APP_DIR_NAME)
}

/**
 * Where build/, node_modules/, drizzle/, the bundled Node runtime, the window
 * helper and the bare entrypoint go.
 *
 * @param {string} stageDir dist/serene-pub-<version>-<target>
 * @param {string} targetName eg. "linux-x64", "macos-arm64"
 */
export function appDir(stageDir, targetName) {
	return targetPlatform(targetName) === "darwin"
		? path.join(
				macosBundleDir(stageDir),
				"Contents",
				"Resources",
				APP_DIR_NAME
			)
		: path.join(bundleRootDir(stageDir), APP_DIR_NAME)
}

/**
 * Where the launcher goes: the top of the extracted folder on Windows/Linux,
 * the bundle's CFBundleExecutable on macOS.
 *
 * @param {string} stageDir
 * @param {string} targetName
 */
export function launcherDestPath(stageDir, targetName) {
	return targetPlatform(targetName) === "darwin"
		? path.join(
				macosBundleDir(stageDir),
				"Contents",
				"MacOS",
				MACOS_BUNDLE_EXECUTABLE
			)
		: path.join(bundleRootDir(stageDir), launcherFileName(targetName))
}

/**
 * Where the window helper goes: inside the payload (§C1, §C9).
 *
 * @param {string} stageDir
 * @param {string} targetName
 */
export function windowHelperDestPath(stageDir, targetName) {
	return path.join(
		appDir(stageDir, targetName),
		windowHelperFileName(targetName)
	)
}

// ── Release assets (§C12) ──────────────────────────────────────────────────

/**
 * @param {string} tag the tag as pushed, e.g. "v0.6.1"
 * @param {string} targetName
 */
export function releaseZipName(tag, targetName) {
	return `serene-pub-${tag}-${targetName}.zip`
}

/** @param {string} zipName */
export function checksumFileName(zipName) {
	return `${zipName}.sha256`
}

/**
 * The checksum file's exact content: sha256sum's own format — 64 lowercase
 * hex, TWO spaces, the zip's bare file name, one LF. ASCII, no BOM, no CR,
 * on every OS (the updater parses it; `sha256sum -c` / `shasum -a 256 -c`
 * accept it).
 *
 * @param {string} hex
 * @param {string} zipName
 */
export function checksumLine(hex, zipName) {
	if (!/^[0-9a-f]{64}$/.test(hex)) {
		throw new Error(`not a lowercase sha256 hex digest: ${hex}`)
	}
	if (zipName.includes("/") || zipName.includes("\\")) {
		throw new Error(`checksum names the bare file, not a path: ${zipName}`)
	}
	return `${hex}  ${zipName}\n`
}

/**
 * Hash `zipPath` (streamed — release zips are ~200 MB) and write
 * `<zipPath>.sha256` beside it. Resolves to the checksum file's path.
 *
 * @param {string} zipPath
 * @returns {Promise<string>}
 */
export async function writeChecksumFile(zipPath) {
	const hash = crypto.createHash("sha256")
	await new Promise((resolve, reject) => {
		fs.createReadStream(zipPath)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", reject)
			.on("end", resolve)
	})
	const zipName = path.basename(zipPath)
	const out = path.join(path.dirname(zipPath), checksumFileName(zipName))
	fs.writeFileSync(out, checksumLine(hash.digest("hex"), zipName), {
		encoding: "ascii"
	})
	return out
}
