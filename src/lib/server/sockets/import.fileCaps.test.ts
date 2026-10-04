/**
 * The SillyTavern folder import reads the same ceilings as the one-file doors
 * (lorebooks plan S4): a World Info file is measured on disk before it is read
 * and parsed, and a character file's JSON before it is decoded and parsed.
 *
 * The oversized files are SPARSE — `truncate` sets their length without
 * writing a byte — so a 33 MB fixture costs no disk and, refused by its size,
 * no memory.
 */
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { IMPORT_FILE_CAPS } from "$lib/shared/imports/fileCaps"

vi.mock("$lib/server/db", () => ({ db: {} }))

let dir: string
beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-st-caps-"))
})
afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true })
})

async function sparse(name: string, bytes: number): Promise<string> {
	const file = path.join(dir, name)
	await fs.writeFile(file, "")
	await fs.truncate(file, bytes)
	return file
}

describe("a SillyTavern World Info file", () => {
	test("past the lorebook ceiling is refused before it is read", async () => {
		const { readWorldInfoFile } = await import("./import")
		const file = await sparse(
			"huge.json",
			IMPORT_FILE_CAPS.lorebookBytes + 1
		)
		// Unreadable: a read would fail with EACCES, not the sentence, so the
		// sentence proves the size was checked before any read.
		await fs.chmod(file, 0o000)
		await expect(readWorldInfoFile(file)).rejects.toThrow(
			"This lorebook file is 33 MB, larger than the 32 MB Serene Pub will read."
		)
	})

	test("under it is read as before", async () => {
		const { readWorldInfoFile } = await import("./import")
		const file = path.join(dir, "small.json")
		await fs.writeFile(
			file,
			JSON.stringify({
				name: "Small",
				entries: { "0": { key: ["a"], content: "b" } }
			})
		)
		expect((await readWorldInfoFile(file)).name).toBe("Small")
	})
})

describe("a SillyTavern character file", () => {
	test("whose JSON is past the card-JSON ceiling is never parsed", async () => {
		const { readCharacterFile } = await import(
			"$lib/server/utils/sillyTavernParsers"
		)
		const file = await sparse(
			"huge-card.json",
			IMPORT_FILE_CAPS.cardJsonBytes + 1
		)
		const parse = vi.spyOn(JSON, "parse")
		vi.spyOn(console, "error").mockImplementation(() => {})
		expect(await readCharacterFile(file)).toBeNull()
		expect(
			parse.mock.calls.filter(
				([t]) => typeof t === "string" && t.length > 1024
			).length
		).toBe(0)
		vi.restoreAllMocks()
	})
})

describe("a SillyTavern character file", () => {
	test("past the card-file ceiling is left out before it is read", async () => {
		// Read whole before: only the JSON inside was measured (S4 review).
		const { readCharacterFile } = await import(
			"$lib/server/utils/sillyTavernParsers"
		)
		const file = await sparse(
			"huge-card.png",
			IMPORT_FILE_CAPS.cardBytes + 1
		)
		await fs.chmod(file, 0o000)
		const logged = vi.spyOn(console, "error").mockImplementation(() => {})
		expect(await readCharacterFile(file)).toBeNull()
		expect(
			String(logged.mock.calls[0]?.[1]?.message ?? logged.mock.calls[0])
		).toBe(
			"This card file is 65 MB, larger than the 64 MB Serene Pub will read."
		)
		vi.restoreAllMocks()
	})

	test("whose JSON holds more than the item ceiling is never parsed", async () => {
		const { readCharacterFile } = await import(
			"$lib/server/utils/sillyTavernParsers"
		)
		const file = path.join(dir, "many-items.json")
		await fs.writeFile(
			file,
			`{"data":{"name":"Many","x":[${Array(1_000_001).fill("0").join(",")}]}}`
		)
		const parse = vi.spyOn(JSON, "parse")
		vi.spyOn(console, "error").mockImplementation(() => {})
		expect(await readCharacterFile(file)).toBeNull()
		expect(
			parse.mock.calls.filter(
				([t]) => typeof t === "string" && t.length > 1024
			).length
		).toBe(0)
		vi.restoreAllMocks()
	})
})
