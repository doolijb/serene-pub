/**
 * The package limits name their number and their variable (M0 P1), and
 * the MIME table answers the media extensions.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// The reader is fs-only, but its imports reach `$lib/server/db` through the
// plugin store; a stub keeps every re-import (vi.resetModules) from opening PGlite.
vi.mock("$lib/server/db", () => ({ db: {}, dbReady: Promise.resolve() }))
// Each case re-imports the module graph after an env change: give it the int budget.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const FIXTURE = resolve(process.cwd(), "src/lib/server/plugins/fixtures/unified-plugin")
const dirs: string[] = []

afterEach(async () => {
	delete process.env.SP_PLUGIN_FILES_MAX
	delete process.env.SP_PLUGIN_PACKAGE_MAX_MB
	vi.resetModules()
	for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function pkg(extra: (dir: string) => Promise<void> = async () => {}): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "sp-limits-"))
	dirs.push(dir)
	await cp(FIXTURE, dir, { recursive: true })
	await extra(dir)
	return dir
}

async function findings(mod: typeof import("./pluginPackage"), dir: string): Promise<string[]> {
	try {
		await mod.readPluginPackage(dir)
		return []
	} catch (e) {
		if (e instanceof mod.PluginPackageError) return e.findings
		throw e
	}
}

describe("package limits", () => {
	it("defaults to 512 MB and 10000 files", async () => {
		vi.resetModules()
		const mod = await import("./pluginPackage")
		expect(mod.PLUGIN_PACKAGE_MAX_MB).toBe(512)
		expect(mod.PLUGIN_FILES_MAX).toBe(10_000)
	})

	it("a non-positive or NaN value falls back to the default", async () => {
		process.env.SP_PLUGIN_FILES_MAX = "0"
		process.env.SP_PLUGIN_PACKAGE_MAX_MB = "abc"
		vi.resetModules()
		const mod = await import("./pluginPackage")
		expect(mod.PLUGIN_PACKAGE_MAX_MB).toBe(512)
		expect(mod.PLUGIN_FILES_MAX).toBe(10_000)
	})

	it("refuses too many files with the exact sentence", async () => {
		process.env.SP_PLUGIN_FILES_MAX = "2"
		vi.resetModules()
		const mod = await import("./pluginPackage")
		const dir = await pkg()
		const found = await findings(mod, dir)
		expect(found.some((f) => /^This package has \d+ files; this pub allows 2 \(SP_PLUGIN_FILES_MAX\)\. Nothing was installed\.$/.test(f))).toBe(true)
	})

	it("refuses too many megabytes with the exact sentence", async () => {
		process.env.SP_PLUGIN_PACKAGE_MAX_MB = "1"
		vi.resetModules()
		const mod = await import("./pluginPackage")
		const dir = await pkg(async (d) => {
			await mkdir(join(d, "ui"), { recursive: true })
			await writeFile(join(d, "ui/blob.bin"), Buffer.alloc(3 * 1024 * 1024, 1))
		})
		const found = await findings(mod, dir)
		expect(found.some((f) => /^This package is \d+ MB; this pub allows 1 MB \(SP_PLUGIN_PACKAGE_MAX_MB\)\. Nothing was installed\.$/.test(f))).toBe(true)
	})

	it("the sentences are verbatim", async () => {
		process.env.SP_PLUGIN_FILES_MAX = "2"
		process.env.SP_PLUGIN_PACKAGE_MAX_MB = "1"
		vi.resetModules()
		const mod = await import("./pluginPackage")
		expect(mod.packageTooManyFilesSentence(12_345)).toBe(
			"This package has 12,345 files; this pub allows 2 (SP_PLUGIN_FILES_MAX). Nothing was installed."
		)
		expect(mod.packageTooLargeSentence(60 * 1024 * 1024 + 1)).toBe(
			"This package is 61 MB; this pub allows 1 MB (SP_PLUGIN_PACKAGE_MAX_MB). Nothing was installed."
		)
	})

	it("mimeForUiPath answers each media extension", async () => {
		const { mimeForUiPath } = await import("./pluginPackage")
		expect(mimeForUiPath("a.mp3")).toBe("audio/mpeg")
		expect(mimeForUiPath("a.ogg")).toBe("audio/ogg")
		expect(mimeForUiPath("a.wav")).toBe("audio/wav")
		expect(mimeForUiPath("a.m4a")).toBe("audio/mp4")
		expect(mimeForUiPath("a.mp4")).toBe("video/mp4")
		expect(mimeForUiPath("a.webm")).toBe("video/webm")
		expect(mimeForUiPath("a.ttf")).toBe("font/ttf")
		expect(mimeForUiPath("a.avif")).toBe("image/avif")
		expect(mimeForUiPath("a.html")).toBe("text/html; charset=utf-8")
	})
})
