import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as os from "os"
import * as path from "path"
import encode from "png-chunks-encode"
import extract from "png-chunks-extract"
import text from "png-chunk-text"
import { PNG } from "pngjs"
import {
	extractCharacterFromPNG,
	readCharacterFile,
	parseSillyTavernChatFile,
	listSillyTavernPersonas,
	normalizeTimestamp,
	mapGroupReplyStrategy,
	authorsNoteFromChatMetadata
} from "./sillyTavernParsers"

const minimalCardJson = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: { name: "PNG Character", description: "from a png" }
}

/** A real, CRC-valid 1x1 PNG — see characterCardParser.test.ts for why this
 * is built with pngjs rather than a hand-copied base64 blob. */
function makeTestPngBuffer(): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data[0] = 255
	png.data[1] = 255
	png.data[2] = 255
	png.data[3] = 255
	return PNG.sync.write(png)
}

function buildCharacterPng(keyword: "chara" | "ccv3", data: unknown): Buffer {
	const pngBuffer = makeTestPngBuffer()
	const chunks = extract(pngBuffer)
	const base64Data = Buffer.from(JSON.stringify(data), "utf-8").toString(
		"base64"
	)
	const textChunk = text.encode(keyword, base64Data)
	const iendIndex = chunks.findIndex((c) => c.name === "IEND")
	chunks.splice(iendIndex, 0, textChunk)
	return Buffer.from(encode(chunks))
}

describe("extractCharacterFromPNG", () => {
	test("extracts a v2 'chara' chunk", async () => {
		const png = buildCharacterPng("chara", minimalCardJson)
		const result = await extractCharacterFromPNG(png)

		expect(result?.data.name).toBe("PNG Character")
	})

	test("extracts a v3 'ccv3' chunk", async () => {
		const png = buildCharacterPng("ccv3", minimalCardJson)
		const result = await extractCharacterFromPNG(png)

		expect(result?.data.name).toBe("PNG Character")
	})

	test("finds the card past an earlier tEXt chunk (a Stable Diffusion `parameters`)", async () => {
		const png = buildCharacterPng("chara", minimalCardJson)
		const chunks = extract(png)
		const ihdr = chunks.findIndex((c) => c.name === "IHDR")
		chunks.splice(ihdr + 1, 0, text.encode("parameters", "a lighthouse, Steps: 20"))
		const result = await extractCharacterFromPNG(Buffer.from(encode(chunks)))

		expect(result?.data.name).toBe("PNG Character")
	})

	test("returns null when there's no tEXt chunk", async () => {
		const pngBuffer = makeTestPngBuffer()
		const result = await extractCharacterFromPNG(pngBuffer)

		expect(result).toBeNull()
	})

	test("returns null (not throw) on a corrupt buffer", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		const result = await extractCharacterFromPNG(Buffer.from("not a png"))
		expect(result).toBeNull()
		errorSpy.mockRestore()
	})
})

describe("readCharacterFile", () => {
	let dir: string

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "st-import-test-"))
	})

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true })
	})

	test("reads a PNG character card from disk", async () => {
		const filePath = path.join(dir, "character.png")
		await fsPromises.writeFile(
			filePath,
			buildCharacterPng("chara", minimalCardJson)
		)

		const result = await readCharacterFile(filePath)
		expect(result?.data.name).toBe("PNG Character")
	})

	test("reads a JSON character card from disk", async () => {
		const filePath = path.join(dir, "character.json")
		await fsPromises.writeFile(filePath, JSON.stringify(minimalCardJson))

		const result = await readCharacterFile(filePath)
		expect(result?.data.name).toBe("PNG Character")
	})

	test("returns null for a missing file instead of throwing", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		const result = await readCharacterFile(path.join(dir, "missing.json"))
		expect(result).toBeNull()
		errorSpy.mockRestore()
	})
})

describe("parseSillyTavernChatFile", () => {
	let dir: string

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "st-import-test-"))
	})

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true })
	})

	test("parses a header line followed by message lines (SillyTavern JSONL format)", async () => {
		const filePath = path.join(dir, "chat.jsonl")
		const header = {
			user_name: "User",
			character_name: "Aria",
			create_date: "2024-01-01 @00h 00m 00s 000ms"
		}
		const messages = [
			{ name: "User", is_user: true, send_date: 1, mes: "hi" },
			{ name: "Aria", is_user: false, send_date: 2, mes: "hello!" }
		]
		const lines = [header, ...messages].map((l) => JSON.stringify(l))
		await fsPromises.writeFile(filePath, lines.join("\n"))

		const result = await parseSillyTavernChatFile(filePath)

		expect(result?.header.character_name).toBe("Aria")
		expect(result?.messages).toHaveLength(2)
		expect(result?.messages[1].mes).toBe("hello!")
	})

	test("returns null for a missing file instead of throwing", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		const result = await parseSillyTavernChatFile(path.join(dir, "missing.jsonl"))
		expect(result).toBeNull()
		errorSpy.mockRestore()
	})

	test("refuses a damaged line in a sentence that names it, never reading past it", async () => {
		const filePath = path.join(dir, "bad.jsonl")
		await fsPromises.writeFile(
			filePath,
			'{"user_name":"User"}\n\n{"name":"Aria","mes":"hi"}\n{not json\n'
		)
		await expect(parseSillyTavernChatFile(filePath)).rejects.toThrow(
			"Line 4 of the chat file is not valid JSON, so the chat was not imported."
		)
	})

	test("an empty file is no chat", async () => {
		const filePath = path.join(dir, "empty.jsonl")
		await fsPromises.writeFile(filePath, "\n\n")
		expect(await parseSillyTavernChatFile(filePath)).toBeNull()
	})

	test("keeps every line of a headerless group chat as a message", async () => {
		const filePath = path.join(dir, "group.jsonl")
		const messages = [
			{ name: "User", is_user: true, send_date: 1, mes: "hi all" },
			{ name: "Aria", is_user: false, send_date: 2, mes: "hello!" }
		]
		await fsPromises.writeFile(
			filePath,
			messages.map((l) => JSON.stringify(l)).join("\n") + "\n"
		)

		const result = await parseSillyTavernChatFile(filePath)

		expect(result?.messages.map((m) => m.mes)).toEqual(["hi all", "hello!"])
		expect(result?.header.user_name).toBe("")
	})
})

describe("listSillyTavernPersonas", () => {
	test("names each persona from power_user.personas, keyed by avatar file", () => {
		const personas = listSillyTavernPersonas({
			power_user: {
				personas: {
					"user-default.png": "Jody",
					"1718000000000-Knight.png": "Sir Knight"
				},
				persona_descriptions: {
					"user-default.png": { description: "Me.", position: 0 },
					"1718000000000-Knight.png": { description: "A knight." },
					"orphan.png": { description: "No name entry." }
				}
			}
		})
		expect(personas).toEqual([
			{
				name: "Jody",
				avatar: "user-default.png",
				description: "Me.",
				position: 0
			},
			{
				name: "Sir Knight",
				avatar: "1718000000000-Knight.png",
				description: "A knight."
			},
			{ name: "orphan", avatar: "orphan.png", description: "No name entry." }
		])
	})

	test("is empty for a settings.json with no personas", () => {
		expect(listSillyTavernPersonas({})).toEqual([])
		expect(listSillyTavernPersonas(null)).toEqual([])
	})
})

describe("normalizeTimestamp", () => {
	test("passes numeric epoch millis through to Date", () => {
		const date = normalizeTimestamp(1704067200000)
		expect(date.getTime()).toBe(1704067200000)
	})

	test('parses SillyTavern\'s "YYYY-MM-DD @HHh MMm SSs MSms" format', () => {
		const date = normalizeTimestamp("2024-03-15 @14h 30m 45s 123ms")

		expect(date.getFullYear()).toBe(2024)
		expect(date.getMonth()).toBe(2) // 0-indexed: March
		expect(date.getDate()).toBe(15)
		expect(date.getHours()).toBe(14)
		expect(date.getMinutes()).toBe(30)
		expect(date.getSeconds()).toBe(45)
		expect(date.getMilliseconds()).toBe(123)
	})

	test("falls back to the native Date parser for other string formats", () => {
		const date = normalizeTimestamp("2024-03-15T14:30:45.123Z")
		expect(date.toISOString()).toBe("2024-03-15T14:30:45.123Z")
	})
})

describe("mapGroupReplyStrategy", () => {
	// Only `manual` becomes a rebind; every other activation strategy
	// inherits the respond spec's round robin (2026-09-21).
	test.each([
		// ST's own files carry the numeric enum: 0 natural, 1 list,
		// 2 manual, 3 pooled.
		[2, "core:task/turn-manual@1"],
		[0, null],
		[1, null],
		[3, null],
		["manual", "core:task/turn-manual@1"],
		["natural_order", null],
		["list_order", null],
		["pooled_order", null],
		[undefined, null],
		["some_unknown_strategy", null]
	])("maps %s to %s", (input, expected) => {
		expect(mapGroupReplyStrategy(input)).toBe(expected)
	})
})

describe("authorsNoteFromChatMetadata (AN1)", () => {
	test("maps ST's in-chat note onto a session's author's note", () => {
		expect(
			authorsNoteFromChatMetadata({
				note_prompt: "[It is raining.]",
				note_depth: 2,
				note_interval: 3,
				note_role: 1,
				note_position: 1
			})
		).toEqual({ note: { text: "[It is raining.]", depth: 2, interval: 3, role: "user" } })
	})

	test("takes ST's defaults for missing numbers, and the assistant role", () => {
		expect(authorsNoteFromChatMetadata({ note_prompt: "x", note_role: 2 })).toEqual({
			note: { text: "x", depth: 4, interval: 1, role: "assistant" }
		})
		expect(
			authorsNoteFromChatMetadata({ note_prompt: "x", note_interval: 0, note_depth: -2 })?.note
		).toMatchObject({ depth: 0, interval: 1, role: "system" })
	})

	test("a note placed outside the chat keeps its depth and says so", () => {
		const mapped = authorsNoteFromChatMetadata({ note_prompt: "x", note_position: 0, note_depth: 6 })
		expect(mapped?.note.depth).toBe(6)
		expect(mapped?.importNote).toMatch(/outside the chat.*6 messages before each reply/)
		expect(authorsNoteFromChatMetadata({ note_prompt: "x", note_position: 2 })?.importNote).toBeTruthy()
		expect(
			authorsNoteFromChatMetadata({ note_prompt: "x", note_position: 0, note_depth: 0 })?.importNote
		).toMatch(/now goes right before each reply/)
	})

	test("keeps the imported depth — the end is Serene Pub's default, not a rewrite (2026-10-03)", () => {
		expect(authorsNoteFromChatMetadata({ note_prompt: "x", note_depth: 4 })?.note.depth).toBe(4)
		expect(authorsNoteFromChatMetadata({ note_prompt: "x", note_depth: 0 })?.note.depth).toBe(0)
	})

	test("no note text, no note", () => {
		expect(authorsNoteFromChatMetadata({ note_prompt: "  ", note_depth: 2 })).toBeNull()
		expect(authorsNoteFromChatMetadata(undefined)).toBeNull()
		expect(authorsNoteFromChatMetadata({ world_info: "Vale" })).toBeNull()
	})
})
