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
	parseChatFile,
	normalizeTimestamp,
	mapGroupReplyStrategy
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

describe("parseChatFile", () => {
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

		const result = await parseChatFile(filePath)

		expect(result?.header.character_name).toBe("Aria")
		expect(result?.messages).toHaveLength(2)
		expect(result?.messages[1].mes).toBe("hello!")
	})

	test("returns null for a missing file instead of throwing", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		const result = await parseChatFile(path.join(dir, "missing.jsonl"))
		expect(result).toBeNull()
		errorSpy.mockRestore()
	})

	test("returns null when a line isn't valid JSON", async () => {
		const filePath = path.join(dir, "bad.jsonl")
		await fsPromises.writeFile(filePath, "{not json")

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		const result = await parseChatFile(filePath)
		expect(result).toBeNull()
		errorSpy.mockRestore()
	})
})

describe("normalizeTimestamp", () => {
	test("passes numeric epoch millis through to Date", () => {
		const date = normalizeTimestamp(1704067200000)
		expect(date.getTime()).toBe(1704067200000)
	})

	test("parses SillyTavern's \"YYYY-MM-DD @HHh MMm SSs MSms\" format", () => {
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
	test.each([
		["manual", "MANUAL"],
		["natural_order", "NATURAL"],
		["list_order", "ORDERED"],
		["pooled_order", "ORDERED"],
		[undefined, "ORDERED"],
		["some_unknown_strategy", "ORDERED"]
	])("maps %s to %s", (input, expected) => {
		expect(mapGroupReplyStrategy(input)).toBe(expected)
	})
})
