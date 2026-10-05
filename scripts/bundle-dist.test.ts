/**
 * The release layout (plan contract §C1/§C7/§C12), asserted per target
 * against stub launcher binaries — no build, no Go toolchain, no network.
 *
 * `assembleShell` is everything bundle-dist.js does except copying the heavy
 * payload (build/, node_modules/, drizzle/, the Node runtime), so these
 * tests see exactly the tree a release ships minus those. Inputs are the
 * repo's REAL dist-assets/ and top-level docs; only the launcher outputs and
 * the stage directory are fakes in a temp dir.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { spawnSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { assembleShell } from "./bundle-dist.js"
import {
	appDir,
	bundleRootDir,
	checksumFileName,
	checksumLine,
	launcherFileName,
	LAUNCHER_TARGETS,
	releaseZipName,
	swapUnitDir,
	windowHelperFileName,
	writeChecksumFile
} from "./dist-layout.js"
import {
	baseVersion,
	buildIcns,
	generateForTarget,
	LINUX_ICON_RELATIVE_PATH,
	pngSize,
	renderTemplate
} from "./create-executables.js"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const assetsDir = path.join(repoRoot, "dist-assets")
const staticDir = path.join(repoRoot, "static")

let tempRoot: string

beforeEach(() => {
	tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sp-bundle-dist-"))
})

afterEach(() => {
	fs.rmSync(tempRoot, { recursive: true, force: true })
})

/** Stub launcher outputs, as launcher/build.mjs would leave them. */
function stubLauncherDir(targetName: string): string {
	const dir = path.join(tempRoot, "launcher", targetName)
	fs.mkdirSync(dir, { recursive: true })
	for (const name of [
		launcherFileName(targetName),
		windowHelperFileName(targetName)
	]) {
		const file = path.join(dir, name)
		fs.writeFileSync(file, `stub ${name} for ${targetName}\n`)
		// Not executable: placement is what must make it so.
		fs.chmodSync(file, 0o644)
	}
	return dir
}

function assemble(targetName: string) {
	const launcherDir = stubLauncherDir(targetName)
	const generatedDir = path.join(tempRoot, "generated", targetName)
	generateForTarget({
		targetName,
		version: "0.6.1-rc-2",
		assetsDir,
		staticDir,
		outDir: generatedDir
	})
	const stageDir = path.join(
		tempRoot,
		"dist",
		`serene-pub-0.6.1-rc-2-${targetName}`
	)
	const result = assembleShell({
		targetName,
		stageDir,
		repoRoot,
		launcherDir,
		generatedDir
	})
	return { ...result, stageDir, launcherDir }
}

function entries(dir: string): string[] {
	return fs.readdirSync(dir).sort()
}

function mode(file: string): number {
	return fs.statSync(file).mode & 0o777
}

const TOP_LEVEL_DOCS = [
	".env.example",
	"INSTRUCTIONS.txt",
	"LICENSE",
	"NOTICE.md",
	"README.md"
]

/** What the retired shims and generated clutter were called. */
const RETIRED_ROOT_FILES = [
	"run.cmd",
	"Serene Pub",
	"Serene Pub.bat",
	"favicon.png",
	"ICON_SETUP.txt"
]

describe("linux-x64 layout", () => {
	test("launcher at the root, window helper and bare entrypoint in app/, no forwarders", () => {
		const { bundleRoot, payloadDir, launcherDir } = assemble("linux-x64")

		expect(entries(bundleRoot)).toEqual(
			[
				...TOP_LEVEL_DOCS,
				"app",
				"install-desktop-shortcut.sh",
				"serene-pub"
			].sort()
		)
		for (const retired of [...RETIRED_ROOT_FILES, "run.sh"]) {
			expect(fs.existsSync(path.join(bundleRoot, retired))).toBe(false)
		}

		const launcher = path.join(bundleRoot, "serene-pub")
		expect(fs.readFileSync(launcher)).toEqual(
			fs.readFileSync(path.join(launcherDir, "serene-pub"))
		)
		expect(mode(launcher)).toBe(0o755)
		expect(mode(path.join(bundleRoot, "install-desktop-shortcut.sh"))).toBe(
			0o755
		)

		expect(entries(payloadDir)).toEqual(["run.sh", "serene-pub-window"])
		expect(mode(path.join(payloadDir, "serene-pub-window"))).toBe(0o755)
		expect(mode(path.join(payloadDir, "run.sh"))).toBe(0o755)
		expect(swapUnitDir(path.dirname(bundleRoot), "linux-x64")).toBe(
			payloadDir
		)
	})

	test("the bare entrypoint exports the extracted folder as the install root", () => {
		const { bundleRoot, payloadDir } = assemble("linux-x64")
		const seen = fakeRuntime(payloadDir)
		const r = spawnSync("sh", [path.join(payloadDir, "run.sh")], {
			encoding: "utf8"
		})
		expect(r.status).toBe(0)
		expect(fs.readFileSync(seen, "utf8").trim()).toBe(
			fs.realpathSync(bundleRoot)
		)
	})
})

describe("windows-x64 layout", () => {
	test("Serene Pub.exe at the root, helper and run.cmd in app/, no .bat or run.cmd forwarder", () => {
		const { bundleRoot, payloadDir } = assemble("windows-x64")

		expect(entries(bundleRoot)).toEqual(
			[...TOP_LEVEL_DOCS, "Serene Pub.exe", "app"].sort()
		)
		for (const retired of RETIRED_ROOT_FILES) {
			expect(fs.existsSync(path.join(bundleRoot, retired))).toBe(false)
		}
		expect(entries(payloadDir)).toEqual([
			"run.cmd",
			"serene-pub-window.exe"
		])
	})

	test("run.cmd, INSTRUCTIONS.txt and .env.example ship with CRLF line endings; the docs do not", () => {
		const { bundleRoot, payloadDir } = assemble("windows-x64")
		const read = (p: string) => fs.readFileSync(p, "utf8")
		for (const f of [
			path.join(payloadDir, "run.cmd"),
			path.join(bundleRoot, "INSTRUCTIONS.txt"),
			path.join(bundleRoot, ".env.example")
		]) {
			const text = read(f)
			expect(text).toContain("\r\n")
			expect(text.replace(/\r\n/g, "")).not.toContain("\n")
		}
		expect(read(path.join(bundleRoot, "README.md"))).not.toContain("\r\n")
	})
})

describe.each(["macos-x64", "macos-arm64"])("%s layout", (targetName) => {
	test("the .app is the swap unit: launcher, plist, icon and payload inside it", () => {
		const { bundleRoot, payloadDir, stageDir, launcherDir } =
			assemble(targetName)

		expect(entries(bundleRoot)).toEqual(
			[...TOP_LEVEL_DOCS, "Serene Pub.app", "run.sh"].sort()
		)
		for (const retired of RETIRED_ROOT_FILES) {
			expect(fs.existsSync(path.join(bundleRoot, retired))).toBe(false)
		}

		const app = path.join(bundleRoot, "Serene Pub.app")
		expect(swapUnitDir(stageDir, targetName)).toBe(app)
		expect(entries(path.join(app, "Contents"))).toEqual([
			"Info.plist",
			"MacOS",
			"Resources"
		])
		expect(entries(path.join(app, "Contents", "MacOS"))).toEqual([
			"serene-pub"
		])
		const launcher = path.join(app, "Contents", "MacOS", "serene-pub")
		expect(mode(launcher)).toBe(0o755)
		expect(fs.readFileSync(launcher)).toEqual(
			fs.readFileSync(path.join(launcherDir, "serene-pub"))
		)
		// No forwarder copy inside the bundle any more.
		expect(entries(path.join(app, "Contents", "Resources"))).toEqual([
			"app",
			"favicon.icns"
		])
		expect(payloadDir).toBe(appDir(stageDir, targetName))
		expect(entries(payloadDir)).toEqual(["run.sh", "serene-pub-window"])
		expect(mode(path.join(payloadDir, "serene-pub-window"))).toBe(0o755)

		const plist = fs.readFileSync(
			path.join(app, "Contents", "Info.plist"),
			"utf8"
		)
		expect(plist).toMatch(
			/<key>CFBundleExecutable<\/key>\s*<string>serene-pub<\/string>/
		)
		expect(plist).toMatch(/<key>LSUIElement<\/key>\s*<true\/>/)
		expect(plist).toMatch(
			/<key>CFBundleIconFile<\/key>\s*<string>favicon\.icns<\/string>/
		)
		expect(plist).toMatch(
			/<key>CFBundleVersion<\/key>\s*<string>0\.6\.1<\/string>/
		)
		expect(plist).toMatch(
			/<key>SerenePubVersion<\/key>\s*<string>0\.6\.1-rc-2<\/string>/
		)
		expect(plist).not.toMatch(/@[A-Z_]+@/)
	})

	test("the root run.sh reaches the bundle's bare entrypoint, which exports the folder CONTAINING the .app as the install root", () => {
		const { bundleRoot, payloadDir } = assemble(targetName)
		const seen = fakeRuntime(payloadDir)
		const r = spawnSync("sh", [path.join(bundleRoot, "run.sh")], {
			encoding: "utf8"
		})
		expect(r.status).toBe(0)
		expect(fs.readFileSync(seen, "utf8").trim()).toBe(
			fs.realpathSync(bundleRoot)
		)
	})
})

/**
 * A fake bundled runtime: app/node is a shell script that records the
 * SERENE_PUB_INSTALL_ROOT it was started with, and app/build/index.js exists
 * so the bare entrypoint's checks pass. Returns the record file's path.
 */
function fakeRuntime(payloadDir: string): string {
	const seen = path.join(tempRoot, "install-root.txt")
	fs.mkdirSync(path.join(payloadDir, "build"), { recursive: true })
	fs.writeFileSync(path.join(payloadDir, "build", "index.js"), "")
	fs.writeFileSync(
		path.join(payloadDir, "node"),
		`#!/bin/sh\nprintf '%s\\n' "$SERENE_PUB_INSTALL_ROOT" > '${seen}'\n`
	)
	fs.chmodSync(path.join(payloadDir, "node"), 0o755)
	return seen
}

describe("the paths the updater verifies in an extracted payload (§C5 step 4)", () => {
	test.each(LAUNCHER_TARGETS)("%s", (targetName) => {
		const { stageDir } = assemble(targetName)
		const rel = (p: string) =>
			path.relative(stageDir, p).split(path.sep).join("/")
		const launcher = targetName.startsWith("macos")
			? "serene-pub/Serene Pub.app/Contents/MacOS/serene-pub"
			: targetName.startsWith("windows")
				? "serene-pub/Serene Pub.exe"
				: "serene-pub/serene-pub"
		expect(fs.existsSync(path.join(stageDir, launcher))).toBe(true)
		const payload = targetName.startsWith("macos")
			? "serene-pub/Serene Pub.app/Contents/Resources/app"
			: "serene-pub/app"
		expect(rel(appDir(stageDir, targetName))).toBe(payload)
		expect(rel(bundleRootDir(stageDir))).toBe("serene-pub")
	})
})

describe("refusals", () => {
	test("a missing launcher fails the bundle — no shim fallback — before the stage dir is touched", () => {
		const launcherDir = stubLauncherDir("linux-x64")
		fs.rmSync(path.join(launcherDir, "serene-pub"))
		const generatedDir = path.join(tempRoot, "generated", "linux-x64")
		generateForTarget({
			targetName: "linux-x64",
			version: "0.6.1",
			assetsDir,
			staticDir,
			outDir: generatedDir
		})
		const stageDir = path.join(tempRoot, "dist", "stage")
		fs.mkdirSync(stageDir, { recursive: true })
		fs.writeFileSync(path.join(stageDir, "sentinel"), "")
		expect(() =>
			assembleShell({
				targetName: "linux-x64",
				stageDir,
				repoRoot,
				launcherDir,
				generatedDir
			})
		).toThrow(/launcher\/build\.mjs --target linux-x64/)
		expect(fs.existsSync(path.join(stageDir, "sentinel"))).toBe(true)
	})

	test("a missing window helper fails the bundle too", () => {
		const launcherDir = stubLauncherDir("windows-x64")
		fs.rmSync(path.join(launcherDir, "serene-pub-window.exe"))
		expect(() =>
			assembleShell({
				targetName: "windows-x64",
				stageDir: path.join(tempRoot, "dist", "stage"),
				repoRoot,
				launcherDir,
				generatedDir: path.join(tempRoot, "generated", "windows-x64")
			})
		).toThrow(/serene-pub-window\.exe/)
	})

	test("missing generated files name the command that renders them", () => {
		expect(() =>
			assembleShell({
				targetName: "macos-arm64",
				stageDir: path.join(tempRoot, "dist", "stage"),
				repoRoot,
				launcherDir: stubLauncherDir("macos-arm64"),
				generatedDir: path.join(tempRoot, "generated", "nothing-here")
			})
		).toThrow(/create-executables\.js macos-arm64/)
	})
})

describe("dist-assets holds templates and sources only", () => {
	test("none of the formerly committed generated files are back", () => {
		const all: string[] = []
		const walk = (dir: string) => {
			for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
				const p = path.join(dir, e.name)
				all.push(path.relative(assetsDir, p))
				if (e.isDirectory()) walk(p)
			}
		}
		walk(assetsDir)
		for (const f of all) {
			const base = path.basename(f)
			expect(base).not.toBe("favicon.png")
			expect(base).not.toBe("ICON_SETUP.txt")
			expect(base).not.toMatch(/\.(bat|app|desktop|icns|ico)$/)
			expect(base).not.toBe("Serene Pub")
		}
		// The forwarders are retired; only the bare entrypoints and macOS's
		// terminal shim are left.
		expect(
			all.filter((f) => /(^|\/)run\.(sh|cmd)$/.test(f)).sort()
		).toEqual(
			[
				"linux/app/run.sh",
				"macos/app/run.sh",
				"macos/run.sh",
				"windows/app/run.cmd"
			].map((p) => p.split("/").join(path.sep))
		)
	})
})

describe("create-executables", () => {
	test("renderTemplate refuses a placeholder with no value", () => {
		expect(renderTemplate("a @X@ b", { X: "1" })).toBe("a 1 b")
		expect(() => renderTemplate("a @Y@", { X: "1" })).toThrow(/@Y@/)
	})

	test("baseVersion strips the suffix for the bundle's dotted-integer keys", () => {
		expect(baseVersion("0.6.1")).toBe("0.6.1")
		expect(baseVersion("0.6.1-rc-2")).toBe("0.6.1")
		expect(() => baseVersion("garbage")).toThrow()
	})

	test("buildIcns writes a well-formed ICNS of PNG elements at their slot sizes", () => {
		const icns = buildIcns(staticDir)
		expect(icns.toString("ascii", 0, 4)).toBe("icns")
		expect(icns.readUInt32BE(4)).toBe(icns.length)
		const seen: Record<string, number> = {}
		let off = 8
		while (off < icns.length) {
			const type = icns.toString("ascii", off, off + 4)
			const len = icns.readUInt32BE(off + 4)
			expect(len).toBeGreaterThan(8)
			const { width, height } = pngSize(icns.subarray(off + 8, off + len))
			expect(width).toBe(height)
			seen[type] = width
			off += len
		}
		expect(off).toBe(icns.length)
		expect(seen).toEqual({
			icp4: 16,
			icp5: 32,
			ic11: 32,
			ic08: 256,
			ic13: 256,
			ic09: 512,
			ic14: 512,
			ic10: 1024
		})
	})

	test("windows renders nothing (goversioninfo embeds icon + version in the .exe)", () => {
		const out = path.join(tempRoot, "gen-win")
		expect(
			generateForTarget({
				targetName: "windows-x64",
				version: "0.6.1",
				assetsDir,
				staticDir,
				outDir: out
			})
		).toEqual([])
	})

	test("a target without a launcher build is refused", () => {
		expect(() =>
			generateForTarget({
				targetName: "linux-arm64",
				version: "0.6.1",
				assetsDir,
				staticDir,
				outDir: path.join(tempRoot, "gen")
			})
		).toThrow(/no launcher/)
	})

	test("the rendered desktop-shortcut installer points Exec= at the launcher and Icon= into app/", () => {
		// An install root with a space and a dollar in it: Exec= quoting.
		const { bundleRoot } = assemble("linux-x64")
		const installRoot = path.join(tempRoot, "my $apps", "serene-pub")
		fs.mkdirSync(path.dirname(installRoot), { recursive: true })
		fs.renameSync(bundleRoot, installRoot)
		const xdg = path.join(tempRoot, "xdg")
		const r = spawnSync(
			"bash",
			[path.join(installRoot, "install-desktop-shortcut.sh")],
			{ encoding: "utf8", env: { ...process.env, XDG_DATA_HOME: xdg } }
		)
		expect(r.status).toBe(0)
		const entry = fs.readFileSync(
			path.join(xdg, "applications", "serene-pub.desktop"),
			"utf8"
		)
		const real = fs.realpathSync(installRoot)
		expect(entry).toContain(
			`Exec="${real.replace(/\$/g, "\\$")}/serene-pub"\n`
		)
		expect(entry).toContain(`Icon=${real}/${LINUX_ICON_RELATIVE_PATH}\n`)
		expect(entry).toContain(`Path=${real}\n`)
		expect(fs.existsSync(path.join(staticDir, "icon-x256.png"))).toBe(true)
	})
})

describe("release checksums (§C12)", () => {
	test("names", () => {
		expect(releaseZipName("v0.6.1", "linux-x64")).toBe(
			"serene-pub-v0.6.1-linux-x64.zip"
		)
		expect(checksumFileName("serene-pub-v0.6.1-linux-x64.zip")).toBe(
			"serene-pub-v0.6.1-linux-x64.zip.sha256"
		)
	})

	test("writeChecksumFile writes '<64 lowercase hex>  <zip name>\\n', ASCII, beside the zip", async () => {
		const zip = path.join(tempRoot, "serene-pub-v0.6.1-macos-arm64.zip")
		const bytes = crypto.randomBytes(3 * 1024 * 1024 + 17)
		fs.writeFileSync(zip, bytes)
		const out = await writeChecksumFile(zip)
		expect(out).toBe(`${zip}.sha256`)
		const raw = fs.readFileSync(out)
		const expected = crypto.createHash("sha256").update(bytes).digest("hex")
		expect(raw.toString("ascii")).toBe(
			`${expected}  serene-pub-v0.6.1-macos-arm64.zip\n`
		)
		// No BOM, no CR.
		expect(raw[0]).not.toBe(0xef)
		expect(raw.includes(0x0d)).toBe(false)
	})

	test.skipIf(spawnSync("sha256sum", ["--version"]).status !== 0)(
		"sha256sum -c accepts the file",
		async () => {
			const zip = path.join(tempRoot, "serene-pub-v0.6.1-linux-x64.zip")
			fs.writeFileSync(zip, "not really a zip")
			await writeChecksumFile(zip)
			const r = spawnSync(
				"sha256sum",
				["-c", "serene-pub-v0.6.1-linux-x64.zip.sha256"],
				{ cwd: tempRoot, encoding: "utf8" }
			)
			expect(r.status).toBe(0)
		}
	)

	test("checksumLine refuses an uppercase digest or a path", () => {
		const hex = "a".repeat(64)
		expect(() => checksumLine(hex.toUpperCase(), "x.zip")).toThrow()
		expect(() => checksumLine(hex, "dir/x.zip")).toThrow()
		expect(checksumLine(hex, "x.zip")).toBe(`${hex}  x.zip\n`)
	})
})
