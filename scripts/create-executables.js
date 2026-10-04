#!/usr/bin/env node
// scripts/create-executables.js
//
// Renders the per-target files a release needs that cannot be checked in as
// they are, into dist/generated/<target>/ (scripts/dist-layout.js →
// generatedAssetsDir). It used to write shims (a .bat, a bash "Serene Pub", a
// macOS stub script) and ICON_SETUP.txt hand-conversion notes INTO
// dist-assets/, which is how generated files ended up committed. Now:
//
//   dist-assets/   templates and hand-written sources only (never written to)
//   dist/          everything generated (gitignored)
//
// The launcher itself is not made here — launcher/build.mjs builds it (Go),
// and scripts/bundle-dist.js places it. What is left is template
// substitution and the macOS icon:
//
//   macos-*    Info.plist          from dist-assets/macos/Info.plist.in
//              favicon.icns        from static/icon-x{16,32,256,512,1024}.png
//   linux-x64  install-desktop-shortcut.sh
//                                  from dist-assets/linux/install-desktop-shortcut.sh.in
//   windows-*  nothing: the .exe's icon and version resource are embedded by
//              launcher/build.mjs (goversioninfo).
//
// One version source: package.json.
//
// Usage: node scripts/create-executables.js [<target> ...]   (default: all
// launcher targets)

import fs from "fs"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"

import {
	generatedAssetsDir,
	LAUNCHER_TARGETS,
	launcherFileName,
	MACOS_BUNDLE_EXECUTABLE,
	MACOS_ICON_FILE,
	targetPlatform
} from "./dist-layout.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, "..")

/**
 * Where the Linux desktop entry's Icon= points, relative to the install root.
 * build/client is where SvelteKit copies static/, so this is the web app's
 * own icon, inside the payload (stable path; matches the installed version).
 */
export const LINUX_ICON_RELATIVE_PATH = "app/build/client/icon-x256.png"

/**
 * Substitute `@KEY@` placeholders. Throws on a placeholder with no value, so a
 * template that grows a new one fails the build instead of shipping the
 * literal text.
 *
 * @param {string} text
 * @param {Record<string, string>} vars
 */
export function renderTemplate(text, vars) {
	const out = text.replace(/@([A-Z][A-Z0-9_]*)@/g, (match, key) => {
		if (!(key in vars)) {
			throw new Error(`template placeholder ${match} has no value`)
		}
		return vars[key]
	})
	return out
}

/** Escape a value for an XML text node. */
function xmlEscape(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
}

/**
 * "0.6.1-rc-2" → "0.6.1". Bundle versions must be dotted integers.
 *
 * @param {string} version
 */
export function baseVersion(version) {
	const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
	if (!m) throw new Error(`not a semver version: ${version}`)
	return `${m[1]}.${m[2]}.${m[3]}`
}

/**
 * The PNG's pixel size, from its IHDR chunk.
 *
 * @param {Buffer} png
 */
export function pngSize(png) {
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
	if (
		png.length < 24 ||
		!png.subarray(0, 8).equals(signature) ||
		png.toString("ascii", 12, 16) !== "IHDR"
	) {
		throw new Error("not a PNG file")
	}
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

/**
 * ICNS element types that carry PNG data, and the pixel size each requires.
 * Modern macOS reads PNG payloads for all of these — it is what `iconutil`
 * itself writes — so no conversion tool is needed and the file is
 * byte-identical on every build host.
 */
const ICNS_SLOTS = [
	{ type: "icp4", px: 16, source: "icon-x16.png" },
	{ type: "icp5", px: 32, source: "icon-x32.png" },
	{ type: "ic11", px: 32, source: "icon-x32.png" }, // 16@2x
	{ type: "ic08", px: 256, source: "icon-x256.png" },
	{ type: "ic13", px: 256, source: "icon-x256.png" }, // 128@2x
	{ type: "ic09", px: 512, source: "icon-x512.png" },
	{ type: "ic14", px: 512, source: "icon-x512.png" }, // 256@2x
	{ type: "ic10", px: 1024, source: "icon-x1024.png" } // 512@2x
]

/**
 * Build an .icns from the repo's static/icon-x*.png set.
 *
 * Format: "icns" + u32be total length, then elements of 4-char type + u32be
 * element length (header included) + PNG bytes.
 *
 * @param {string} staticDir
 * @returns {Buffer}
 */
export function buildIcns(staticDir) {
	const elements = ICNS_SLOTS.map(({ type, px, source }) => {
		const png = fs.readFileSync(path.join(staticDir, source))
		const { width, height } = pngSize(png)
		if (width !== px || height !== px) {
			throw new Error(
				`${source} is ${width}x${height}; the ${type} icon slot needs ${px}x${px}`
			)
		}
		const header = Buffer.alloc(8)
		header.write(type, 0, 4, "ascii")
		header.writeUInt32BE(png.length + 8, 4)
		return Buffer.concat([header, png])
	})
	const body = Buffer.concat(elements)
	const header = Buffer.alloc(8)
	header.write("icns", 0, 4, "ascii")
	header.writeUInt32BE(body.length + 8, 4)
	return Buffer.concat([header, body])
}

/**
 * Render one target's generated files. Returns the paths written.
 *
 * @param {object} args
 * @param {string} args.targetName
 * @param {string} args.version package.json version
 * @param {string} args.assetsDir dist-assets/
 * @param {string} args.staticDir static/
 * @param {string} args.outDir dist/generated/<target>
 * @returns {string[]}
 */
export function generateForTarget({
	targetName,
	version,
	assetsDir,
	staticDir,
	outDir
}) {
	if (!LAUNCHER_TARGETS.includes(targetName)) {
		throw new Error(
			`no launcher is built for ${targetName}; valid: ${LAUNCHER_TARGETS.join(", ")}`
		)
	}
	fs.rmSync(outDir, { recursive: true, force: true })
	fs.mkdirSync(outDir, { recursive: true })
	const written = []
	const platform = targetPlatform(targetName)

	if (platform === "darwin") {
		const template = fs.readFileSync(
			path.join(assetsDir, "macos", "Info.plist.in"),
			"utf8"
		)
		const plist = renderTemplate(template, {
			BUNDLE_EXECUTABLE: xmlEscape(MACOS_BUNDLE_EXECUTABLE),
			ICON_FILE: xmlEscape(MACOS_ICON_FILE),
			BASE_VERSION: xmlEscape(baseVersion(version)),
			VERSION: xmlEscape(version)
		})
		const plistPath = path.join(outDir, "Info.plist")
		fs.writeFileSync(plistPath, plist)
		written.push(plistPath)

		const icnsPath = path.join(outDir, MACOS_ICON_FILE)
		fs.writeFileSync(icnsPath, buildIcns(staticDir))
		written.push(icnsPath)
	}

	if (platform === "linux") {
		const template = fs.readFileSync(
			path.join(assetsDir, "linux", "install-desktop-shortcut.sh.in"),
			"utf8"
		)
		const script = renderTemplate(template, {
			LAUNCHER_FILE: launcherFileName(targetName),
			ICON_PATH: LINUX_ICON_RELATIVE_PATH
		})
		const scriptPath = path.join(outDir, "install-desktop-shortcut.sh")
		fs.writeFileSync(scriptPath, script, { mode: 0o755 })
		fs.chmodSync(scriptPath, 0o755)
		written.push(scriptPath)
	}

	return written
}

const isMain =
	!!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
	const pkg = JSON.parse(
		fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
	)
	const requested = process.argv.slice(2)
	const targets = requested.length ? requested : LAUNCHER_TARGETS
	try {
		for (const targetName of targets) {
			const outDir = generatedAssetsDir(
				path.join(repoRoot, "dist"),
				targetName
			)
			const written = generateForTarget({
				targetName,
				version: pkg.version,
				assetsDir: path.join(repoRoot, "dist-assets"),
				staticDir: path.join(repoRoot, "static"),
				outDir
			})
			console.log(
				`${targetName}: ${written.length ? written.map((f) => path.relative(repoRoot, f)).join(", ") : "nothing to generate"}`
			)
		}
	} catch (err) {
		console.error(`create-executables: ${err.message}`)
		process.exit(1)
	}
}
