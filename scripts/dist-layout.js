// scripts/dist-layout.js
//
// The one description of what a portable release looks like once extracted.
// bundle-dist.js builds it, check-dist-size.js measures it, and
// .github/workflows/release.yml zips it — before this module those three
// agreed only by coincidence.
//
// A staging directory keeps its versioned, per-target name so several targets
// can be built side by side in dist/ and so release.yml can still find the one
// it just built:
//
//     dist/serene-pub-<version>-<target>/     <- staging, never shipped
//       serene-pub/                           <- the ONLY entry that is zipped
//         app/                                <- the payload (see below)
//         run.sh | run.cmd                    <- thin forwarder into app/
//         LICENSE, README.md, INSTRUCTIONS.txt, favicon.png, launchers...
//
// Two deliberate decisions are encoded here:
//
// 1. The zipped directory is UNVERSIONED. The archive keeps its version in its
//    filename, but its single top-level entry is plain `serene-pub`. That
//    stops the double-nesting extractors produced when both carried the
//    version (serene-pub-v0.6.0-linux-x64/serene-pub-0.6.0-linux-x64/…), and
//    it makes "extract the new zip over your old folder" a valid manual
//    upgrade. That is only safe because nothing user-owned lives in the
//    install folder any more — .env and the database moved to the OS data
//    directory (src/lib/server/config/preloadEnv.js).
//
// 2. Everything that IS the application lives in ONE directory, `app/`. A
//    self-updater can then replace the application by renaming that directory
//    aside and moving a freshly downloaded one into place — an atomic swap
//    that only works if the payload is self-contained and the thing doing the
//    swapping lives outside it. The forwarder, the docs and (later) the
//    launcher binary are what stay outside.
//
// macOS keeps its .app bundle, so its payload goes at the bundle's own
// conventional location instead: Contents/Resources/app.

import path from "path"

/** The single top-level entry inside the release archive. */
export const BUNDLE_DIR_NAME = "serene-pub"

/** The payload directory's name inside the extracted folder / .app bundle. */
export const APP_DIR_NAME = "app"

/** macOS ships the payload inside the .app bundle rather than beside it. */
export const MACOS_APP_BUNDLE_NAME = "Serene Pub.app"

/**
 * The directory that gets zipped, inside a staging directory.
 *
 * @param {string} stageDir dist/serene-pub-<version>-<target>
 */
export function bundleRootDir(stageDir) {
	return path.join(stageDir, BUNDLE_DIR_NAME)
}

/**
 * Where build/, node_modules/, drizzle/, the bundled Node runtime and the bare
 * entrypoint go.
 *
 * @param {string} stageDir dist/serene-pub-<version>-<target>
 * @param {string} targetName eg. "linux-x64", "macos-arm64"
 */
export function appDir(stageDir, targetName) {
	const root = bundleRootDir(stageDir)
	return targetName.startsWith("macos")
		? path.join(
				root,
				MACOS_APP_BUNDLE_NAME,
				"Contents",
				"Resources",
				APP_DIR_NAME
			)
		: path.join(root, APP_DIR_NAME)
}
