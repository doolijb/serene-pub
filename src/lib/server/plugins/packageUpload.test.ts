/**
 * The package upload's pieces that need no database: the entry-name rule, the
 * body-limit parse and piece size, and the unpack from disk. They count
 * against the same limits as the package reader and say the same sentences.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { zipSync } from "fflate"

// The module's imports reach the app database and the socket registry; the
// unpack and the parse are pure and need neither.
vi.mock("$lib/server/db", () => ({ db: {} }))
vi.mock("$lib/server/auth/authenticateRequest", () => ({
	authenticateRequest: vi.fn()
}))
vi.mock("$lib/server/adminLogbook/record", () => ({
	logbookBegin: vi.fn(),
	logbookCommit: vi.fn()
}))
vi.mock("$lib/server/sockets/plugins", () => ({
	installPackageFromDir: vi.fn(),
	pluginPushIo: vi.fn(),
	PACKAGE_INSTALL_OFF_SENTENCE: "off"
}))

const enc = (s: string) => new TextEncoder().encode(s)
const MANIFEST = "dist/plugin/manifest.json"

let tmp: string

beforeEach(async () => {
	tmp = await fs.mkdtemp(path.join(os.tmpdir(), "laneP-pkgtest-"))
})

afterEach(async () => {
	vi.unstubAllEnvs()
	vi.resetModules()
	await fs.rm(tmp, { recursive: true, force: true })
})

const load = async () => {
	vi.resetModules()
	return import("./packageUpload")
}

async function writeZip(files: Record<string, Uint8Array>): Promise<string> {
	const file = path.join(tmp, "in.zip")
	await fs.writeFile(file, zipSync(files))
	return file
}

describe("safeEntryPath", () => {
	it("accepts plain relative names", async () => {
		const { safeEntryPath } = await load()
		expect(safeEntryPath("dist/plugin/manifest.json")).toBe(
			"dist/plugin/manifest.json"
		)
		expect(safeEntryPath("a.txt")).toBe("a.txt")
	})

	it("refuses absolute, drive, backslashed and dot-segment names", async () => {
		const { safeEntryPath } = await load()
		for (const bad of [
			"",
			"/etc/passwd",
			"C:\\x",
			"C:x",
			"a\\b",
			"../x",
			"a/../x",
			"./x",
			"a/./b",
			"a\0b"
		])
			expect(safeEntryPath(bad), JSON.stringify(bad)).toBeNull()
	})
})

describe("extractPackageZip", () => {
	it("unpacks a package with its manifest at the root", async () => {
		const { extractPackageZip } = await load()
		const zip = await writeZip({
			[MANIFEST]: enc("{}"),
			"dist/plugin/bundle.js": enc("x")
		})
		const out = path.join(tmp, "out")
		const root = await extractPackageZip(zip, out)
		expect(root).toBe(path.resolve(out))
		expect(await fs.readFile(path.join(root, MANIFEST), "utf8")).toBe("{}")
		expect(
			await fs.readFile(path.join(root, "dist/plugin/bundle.js"), "utf8")
		).toBe("x")
	})

	it("unwraps a single top folder", async () => {
		const { extractPackageZip } = await load()
		const zip = await writeZip({ [`my-plugin/${MANIFEST}`]: enc("{}") })
		const out = path.join(tmp, "out")
		const root = await extractPackageZip(zip, out)
		expect(root).toBe(path.join(path.resolve(out), "my-plugin"))
		expect(await fs.stat(path.join(root, MANIFEST))).toBeTruthy()
	})

	it("refuses names outside the folder before writing anything", async () => {
		const { extractPackageZip } = await load()
		const zip = await writeZip({
			[MANIFEST]: enc("{}"),
			"../evil.txt": enc("x")
		})
		const out = path.join(tmp, "out")
		await expect(extractPackageZip(zip, out)).rejects.toThrow(
			/outside its own folder/
		)
		await expect(fs.stat(path.join(out, MANIFEST))).rejects.toThrow()
		await expect(fs.stat(path.join(tmp, "evil.txt"))).rejects.toThrow()
	})

	it("refuses a symlink entry", async () => {
		const { extractPackageZip } = await load()
		const file = path.join(tmp, "link.zip")
		await fs.writeFile(
			file,
			zipSync({
				link: [
					enc("/etc/passwd"),
					{ attrs: (0o120777 << 16) >>> 0, os: 3 }
				]
			})
		)
		await expect(
			extractPackageZip(file, path.join(tmp, "out"))
		).rejects.toThrow(/outside its own folder/)
	})

	it("refuses a file that is not a zip", async () => {
		const { extractPackageZip } = await load()
		const file = path.join(tmp, "no.zip")
		await fs.writeFile(file, "this is not a zip file at all, just words")
		await expect(
			extractPackageZip(file, path.join(tmp, "out"))
		).rejects.toThrow(/^That file is not a readable zip: /)
	})

	it("refuses too many files with the package sentence", async () => {
		vi.stubEnv("SP_PLUGIN_FILES_MAX", "2")
		const { extractPackageZip } = await load()
		const { packageTooManyFilesSentence } = await import("./pluginPackage")
		const zip = await writeZip({
			"a.txt": enc("a"),
			"b.txt": enc("b"),
			"c.txt": enc("c")
		})
		const out = path.join(tmp, "out")
		await expect(extractPackageZip(zip, out)).rejects.toThrow(
			packageTooManyFilesSentence(3)
		)
		await expect(fs.stat(path.join(out, "a.txt"))).rejects.toThrow()
	})

	it("refuses too many inflated bytes with the package sentence", async () => {
		vi.stubEnv("SP_PLUGIN_PACKAGE_MAX_MB", "1")
		const { extractPackageZip } = await load()
		const { packageTooLargeSentence } = await import("./pluginPackage")
		const zip = await writeZip({
			"big.bin": new Uint8Array(2 * 1024 * 1024)
		})
		await expect(
			extractPackageZip(zip, path.join(tmp, "out"))
		).rejects.toThrow(packageTooLargeSentence(2 * 1024 * 1024))
	})
})

describe("parseBodySizeLimit", () => {
	it("reads bytes and K/M/G suffixes the way the adapter does", async () => {
		const { parseBodySizeLimit } = await load()
		expect(parseBodySizeLimit(undefined)).toBe(512 * 1024)
		expect(parseBodySizeLimit("")).toBe(512 * 1024)
		expect(parseBodySizeLimit("1000")).toBe(1000)
		expect(parseBodySizeLimit("512K")).toBe(512 * 1024)
		expect(parseBodySizeLimit("2m")).toBe(2 * 1024 * 1024)
		expect(parseBodySizeLimit("1G")).toBe(1024 ** 3)
		expect(parseBodySizeLimit("Infinity")).toBe(Infinity)
		expect(parseBodySizeLimit("lots")).toBe(512 * 1024)
	})
})

describe("pieceBytesFor", () => {
	it("leaves 16 KiB of headroom and clamps to 64 KiB..8 MiB", async () => {
		const { pieceBytesFor } = await load()
		expect(pieceBytesFor(512 * 1024)).toBe(496 * 1024)
		expect(pieceBytesFor(10)).toBe(64 * 1024)
		expect(pieceBytesFor(70 * 1024)).toBe(64 * 1024)
		expect(pieceBytesFor(2 * 1024 * 1024)).toBe(2 * 1024 * 1024 - 16 * 1024)
		expect(pieceBytesFor(1024 ** 3)).toBe(8 * 1024 * 1024)
		expect(pieceBytesFor(Infinity)).toBe(8 * 1024 * 1024)
	})
})
