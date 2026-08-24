import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs"
import path from "path"
import os from "os"

// getDefaultBackgrounds/resolveBackgroundImagePath are pure/filesystem-only —
// stub out $lib/server/db so importing this module doesn't try to open the
// real app database (and hit its cross-process lock) just to run these.
vi.mock("$lib/server/db", () => ({ db: {} }))

import {
	getDefaultBackgrounds,
	resolveBackgroundImagePath
} from "./userSettings"

describe("resolveBackgroundImagePath", () => {
	test("rewrites a known default's legacy .jpg path to .webp", () => {
		expect(
			resolveBackgroundImagePath(
				"/backgrounds/defaults/rustic-pub_nikola-jovanovic-QGPmWrclELg-unsplash.jpg"
			)
		).toBe(
			"/backgrounds/defaults/rustic-pub_nikola-jovanovic-QGPmWrclELg-unsplash.webp"
		)
	})

	test("leaves an already-.webp default path untouched", () => {
		const p =
			"/backgrounds/defaults/rustic-pub_nikola-jovanovic-QGPmWrclELg-unsplash.webp"
		expect(resolveBackgroundImagePath(p)).toBe(p)
	})

	test("leaves a user-uploaded (non-default) background path untouched", () => {
		const p = "/backgrounds/uploads/some-user-photo.jpg"
		expect(resolveBackgroundImagePath(p)).toBe(p)
	})

	test("leaves an SVG default path untouched", () => {
		const p = "/backgrounds/defaults/midnight-aurora.svg"
		expect(resolveBackgroundImagePath(p)).toBe(p)
	})

	test("passes through null/undefined", () => {
		expect(resolveBackgroundImagePath(null)).toBeNull()
		expect(resolveBackgroundImagePath(undefined)).toBeNull()
	})
})

describe("getDefaultBackgrounds", () => {
	let tmpDir: string
	let cwdSpy: ReturnType<typeof vi.spyOn>
	let warnSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-bg-test-"))
		cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	afterEach(() => {
		cwdSpy.mockRestore()
		warnSpy.mockRestore()
		fs.rmSync(tmpDir, { recursive: true, force: true })
		vi.doUnmock("$app/environment")
		vi.resetModules()
	})

	function writeManifest(root: string, files: string[]) {
		const dir = path.join(tmpDir, root, "backgrounds", "defaults")
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(files))
	}

	// The function branches on $app/environment's `dev` flag, which vitest's
	// sveltekit() plugin resolves statically at import time — a plain
	// `vi.mock` can't toggle that per test, so each case here mocks it via
	// `vi.doMock` + a fresh `vi.resetModules()`/dynamic import instead of
	// using the static top-level import.
	async function getDefaultBackgroundsWithDev(devValue: boolean) {
		vi.doMock("$app/environment", () => ({ dev: devValue }))
		vi.resetModules()
		const mod = await import("./userSettings")
		return mod.getDefaultBackgrounds()
	}

	describe("in dev (vite dev)", () => {
		test("reads only from static/, ignoring a stale build/client manifest", async () => {
			writeManifest("static", ["bar.webp"])
			writeManifest("build/client", ["stale.jpg"])
			const result = await getDefaultBackgroundsWithDev(true)
			expect(result).toEqual(["/backgrounds/defaults/bar.webp"])
			expect(warnSpy).not.toHaveBeenCalled()
		})

		test("returns an empty array when static/ has no manifest", async () => {
			writeManifest("build/client", ["stale.jpg"])
			const result = await getDefaultBackgroundsWithDev(true)
			expect(result).toEqual([])
		})
	})

	describe("in production", () => {
		test("reads from build/client when present, without warning", async () => {
			writeManifest("build/client", ["foo.webp"])
			const result = await getDefaultBackgroundsWithDev(false)
			expect(result).toEqual(["/backgrounds/defaults/foo.webp"])
			expect(warnSpy).not.toHaveBeenCalled()
		})

		test("falls back to static/ and warns when build/client's manifest is missing", async () => {
			writeManifest("static", ["bar.webp"])
			const result = await getDefaultBackgroundsWithDev(false)
			expect(result).toEqual(["/backgrounds/defaults/bar.webp"])
			expect(warnSpy).toHaveBeenCalledTimes(1)
			expect(warnSpy.mock.calls[0][0]).toMatch(/fell back to/)
		})

		test("returns an empty array when neither manifest exists", async () => {
			expect(await getDefaultBackgroundsWithDev(false)).toEqual([])
		})
	})
})
