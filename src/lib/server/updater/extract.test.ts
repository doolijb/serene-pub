/**
 * Extraction of a release zip into update staging: modes survive, and nothing
 * — a `..` path, an absolute path, a link pointing out, a write through a link
 * — lands outside the destination.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { extractZip, safeEntryPath, UnsafeArchiveError } from "./extract"
import { buildZip, MODE_EXEC, MODE_LINK } from "./testing/zipWriter"

let tmp: string
let dest: string

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp-extract-"))
	dest = path.join(tmp, "out")
})
afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true })
})

function zipFile(entries: Parameters<typeof buildZip>[0]): string {
	const file = path.join(tmp, "in.zip")
	fs.writeFileSync(file, buildZip(entries))
	return file
}

const isWindows = process.platform === "win32"

describe("extractZip", () => {
	test("writes files and directories and restores Unix modes", async () => {
		const zip = zipFile([
			{ name: "serene-pub/" },
			{ name: "serene-pub/app/" },
			{ name: "serene-pub/app/node", data: "#!/bin/sh\n", mode: MODE_EXEC },
			{ name: "serene-pub/README.md", data: "hello" }
		])
		const result = await extractZip(zip, dest)
		expect(result.files).toBe(2)
		expect(fs.readFileSync(path.join(dest, "serene-pub/README.md"), "utf8")).toBe("hello")
		if (!isWindows) {
			expect(fs.statSync(path.join(dest, "serene-pub/app/node")).mode & 0o777).toBe(0o755)
			expect(fs.statSync(path.join(dest, "serene-pub/README.md")).mode & 0o777).toBe(0o644)
		}
	})

	test("an archive with no Unix attributes still extracts, with plain modes", async () => {
		const zip = zipFile([{ name: "serene-pub/a.txt", data: "x", dos: true }])
		await extractZip(zip, dest)
		expect(fs.existsSync(path.join(dest, "serene-pub/a.txt"))).toBe(true)
	})

	test.each([
		["../escape.txt"],
		["serene-pub/../../escape.txt"],
		["/etc/escape.txt"]
	])("refuses the zip-slip path %s and writes nothing outside", async (name) => {
		const zip = zipFile([
			{ name: "serene-pub/ok.txt", data: "ok" },
			{ name, data: "pwned" }
		])
		await expect(extractZip(zip, dest)).rejects.toBeInstanceOf(UnsafeArchiveError)
		expect(fs.existsSync(path.join(tmp, "escape.txt"))).toBe(false)
	})

	test.skipIf(isWindows)("keeps a symlink whose target stays inside", async () => {
		const zip = zipFile([
			{ name: "serene-pub/lib/real.js", data: "1" },
			{ name: "serene-pub/lib/link.js", data: "real.js", mode: MODE_LINK }
		])
		const result = await extractZip(zip, dest)
		expect(result.symlinks).toBe(1)
		expect(fs.readlinkSync(path.join(dest, "serene-pub/lib/link.js"))).toBe("real.js")
	})

	test.skipIf(isWindows).each([["../../outside"], ["/etc/passwd"]])(
		"refuses a symlink pointing out (%s)",
		async (target) => {
			const zip = zipFile([{ name: "serene-pub/evil", data: target, mode: MODE_LINK }])
			await expect(extractZip(zip, dest)).rejects.toThrow(/link that points outside/)
			expect(fs.existsSync(path.join(dest, "serene-pub/evil"))).toBe(false)
		}
	)

	test.skipIf(isWindows)("refuses to write through a link to a folder outside", async () => {
		// Every link in the archive is checked where it points, so the way out
		// is a link already sitting in the destination.
		const outside = path.join(tmp, "outside")
		fs.mkdirSync(outside)
		fs.mkdirSync(dest)
		fs.symlinkSync(outside, path.join(dest, "serene-pub"))
		const zip = zipFile([{ name: "serene-pub/x.txt", data: "x" }])
		await expect(extractZip(zip, dest)).rejects.toThrow(/outside its folder through a link/)
		expect(fs.existsSync(path.join(outside, "x.txt"))).toBe(false)
	})

	test("refuses a file named twice", async () => {
		const zip = zipFile([
			{ name: "serene-pub/a.txt", data: "1" },
			{ name: "serene-pub/a.txt", data: "2" }
		])
		await expect(extractZip(zip, dest)).rejects.toBeInstanceOf(UnsafeArchiveError)
	})

	test("refuses a file that is not a zip", async () => {
		const file = path.join(tmp, "in.zip")
		fs.writeFileSync(file, "not a zip at all")
		await expect(extractZip(file, dest)).rejects.toBeInstanceOf(UnsafeArchiveError)
	})
})

describe("safeEntryPath", () => {
	test("normalises separators and drops empty and dot parts", () => {
		expect(safeEntryPath("serene-pub\\app\\node")).toBe("serene-pub/app/node")
		expect(safeEntryPath("./serene-pub//a")).toBe("serene-pub/a")
	})
	test.each([["../a"], ["a/../../b"], ["/a"], ["C:/a"], ["C:a"], ["a\0b"], [""]])(
		"refuses %j",
		(name) => {
			expect(() => safeEntryPath(name)).toThrow(UnsafeArchiveError)
		}
	)
})
