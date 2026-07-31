import { describe, expect, test } from "vitest"
import extract from "png-chunks-extract"
import text from "png-chunk-text"
import { PNG } from "pngjs"
import { CharacterCard } from "@lenml/char-card-reader"
import {
	parseCharacterCard,
	parseCharacterCardFromBase64,
	buildCharacterCardV3,
	embedCharacterCardInPng,
	getRobustSpecV3Data,
	validatePngChunkLengths
} from "./characterCardParser"

const minimalCardJson = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: {
		name: "Test Character",
		description: "A test description",
		personality: "Friendly",
		scenario: "A test scenario",
		first_mes: "Hello!",
		mes_example: "",
		creator_notes: "",
		system_prompt: "",
		post_history_instructions: "",
		alternate_greetings: [],
		tags: ["test"],
		creator: "",
		character_version: "",
		extensions: {}
	}
}

const cardJsonWithLorebook = {
	...minimalCardJson,
	data: {
		...minimalCardJson.data,
		character_book: {
			name: "Test Lorebook",
			description: "",
			extensions: {},
			entries: [
				{
					keys: ["trigger"],
					content: "Some lore",
					extensions: {},
					enabled: true,
					insertion_order: 0
				}
			]
		}
	}
}

/** A real, CRC-valid 1x1 PNG — built with pngjs rather than a hand-copied
 * base64 blob, since png-chunks-extract enforces CRC checks that most
 * hand-crafted "minimal PNG" snippets found online don't actually satisfy. */
function makeTestPngBuffer(): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data[0] = 255
	png.data[1] = 255
	png.data[2] = 255
	png.data[3] = 255
	return PNG.sync.write(png)
}

function buildTestCharacterPng(cardData: unknown): Buffer {
	return embedCharacterCardInPng(makeTestPngBuffer(), cardData)
}

describe("parseCharacterCard", () => {
	test("parses a JSON character card buffer", async () => {
		const buffer = Buffer.from(JSON.stringify(minimalCardJson), "utf-8")
		const result = await parseCharacterCard(buffer)

		expect(result.card.name).toBe("Test Character")
		expect(result.card.personality).toBe("Friendly")
		expect(result.card.scenario).toBe("A test scenario")
		expect(result.card.first_message).toBe("Hello!")
	})

	test("extracts the embedded lorebook when present", async () => {
		const buffer = Buffer.from(
			JSON.stringify(cardJsonWithLorebook),
			"utf-8"
		)
		const result = await parseCharacterCard(buffer)

		expect(result.lorebook).toBeDefined()
		expect(result.lorebook?.name).toBe("Test Lorebook")
		expect(result.lorebook?.entries).toHaveLength(1)
		expect(result.lorebook?.entries[0].keys).toEqual(["trigger"])
	})

	test("has no lorebook when the card doesn't embed one", async () => {
		const buffer = Buffer.from(JSON.stringify(minimalCardJson), "utf-8")
		const result = await parseCharacterCard(buffer)

		expect(result.lorebook).toBeUndefined()
	})

	test("parses a PNG character card with an embedded tEXt chunk", async () => {
		const png = buildTestCharacterPng(minimalCardJson)
		const result = await parseCharacterCard(png)

		expect(result.card.name).toBe("Test Character")
	})

	test("throws on garbage input", async () => {
		const buffer = Buffer.from("not a character card", "utf-8")
		await expect(parseCharacterCard(buffer)).rejects.toThrow()
	})

	test("has no lorebook for a V1 card with no book at all, despite the package always returning a placeholder object for it", async () => {
		const buffer = Buffer.from(
			JSON.stringify({ char_name: "Aria", description: "..." }),
			"utf-8"
		)
		const result = await parseCharacterCard(buffer)

		expect(result.lorebook).toBeUndefined()
	})

	test("still detects an embedded lorebook using the legacy object-keyed-by-index entries shape", async () => {
		const buffer = Buffer.from(
			JSON.stringify({
				char_name: "Aria",
				description: "...",
				character_book: {
					name: "Legacy Book",
					entries: {
						"0": { keys: ["trigger"], content: "Some lore" }
					}
				}
			}),
			"utf-8"
		)
		const result = await parseCharacterCard(buffer)

		expect(result.lorebook).toBeDefined()
	})
})

describe("parseCharacterCardFromBase64", () => {
	test("decodes base64 then parses like parseCharacterCard", async () => {
		const base64 = Buffer.from(
			JSON.stringify(minimalCardJson),
			"utf-8"
		).toString("base64")
		const result = await parseCharacterCardFromBase64(base64)

		expect(result.card.name).toBe("Test Character")
	})
})

// A genuine V1 (TavernAI) card: no spec/spec_version/data wrapper at all,
// flat fields, char_name instead of name. Real V1 files are exactly this
// shape (no `spec`/`data`), which CharacterCard.from_json's own type
// signature doesn't actually reflect (it demands a full CharRawData with
// spec/spec_version/data) — the `as any` casts below match how the real
// import handlers feed it arbitrary parsed JSON.
const v1CardJson: any = {
	char_name: "Aria",
	description: "A brave adventurer",
	personality: "Bold and curious",
	scenario: "A fantasy world",
	first_mes: "Hello there!",
	mes_example: "<START>",
	tags: ["fantasy", "oc"]
}

describe("getRobustSpecV3Data", () => {
	test("recovers tags for a V1 card, which card.toSpecV3() alone drops", () => {
		const card = CharacterCard.from_json(v1CardJson)

		// Confirms the underlying package bug this function works around —
		// if this ever starts failing, the package fixed it upstream and
		// this whole workaround (and test) can be deleted.
		expect(card.toSpecV3().data.tags).toEqual([])

		const data = getRobustSpecV3Data(card)
		expect(data.tags).toEqual(["fantasy", "oc"])
	})

	test("still extracts core fields correctly for a V1 card", () => {
		const card = CharacterCard.from_json(v1CardJson)
		const data = getRobustSpecV3Data(card)

		expect(data.name).toBe("Aria")
		expect(data.description).toBe("A brave adventurer")
		expect(data.personality).toBe("Bold and curious")
		expect(data.scenario).toBe("A fantasy world")
		expect(data.first_mes).toBe("Hello there!")
	})

	test("omits creation_date/modification_date rather than the literal string 'unknown'", () => {
		const card = CharacterCard.from_json(v1CardJson)
		const data = getRobustSpecV3Data(card)

		expect(data.creation_date).toBeUndefined()
		expect(data.modification_date).toBeUndefined()
	})

	test("recovers alternate_greetings when a card carries them without full V2/V3 wrapping", () => {
		const card = CharacterCard.from_json({
			...v1CardJson,
			alternate_greetings: ["Hi!", "Hey there!"]
		})
		const data = getRobustSpecV3Data(card)
		expect(data.alternate_greetings).toEqual(["Hi!", "Hey there!"])
	})

	test("uses card.toSpecV3()'s own values unmodified for a real V2 card", () => {
		const card = CharacterCard.from_json(minimalCardJson)
		const data = getRobustSpecV3Data(card)
		expect(data.name).toBe("Test Character")
		expect(data.tags).toEqual(["test"])
	})

	test("throws rather than producing an 'unknown'-named character for valid JSON that isn't a character card", () => {
		// Syntactically valid JSON, but none of the fields a character card
		// would have — the underlying package's getters silently default
		// name/description/etc to the literal string "unknown" for this
		// rather than failing, which previously let this import as a
		// garbage "unknown" character with no validation error at all.
		const card = CharacterCard.from_json({
			this_is: "not a character card"
		} as any)
		expect(() => getRobustSpecV3Data(card)).toThrow(
			/no character name was found/
		)
	})

	test("preserves a real card whose actual name is literally 'unknown'", () => {
		const card = CharacterCard.from_json({
			...minimalCardJson,
			data: { ...minimalCardJson.data, name: "unknown" }
		})
		const data = getRobustSpecV3Data(card)
		expect(data.name).toBe("unknown")
	})
})

describe("buildCharacterCardV3", () => {
	test("maps a character's fields into CCv3 shape", () => {
		const built = buildCharacterCardV3({
			name: "Aria",
			description: "desc",
			personality: "kind",
			scenario: "scene",
			firstMessage: "hi",
			exampleDialogues: ["<START>ex1"],
			tags: ["fantasy", "oc"],
			creator: "jody",
			uuid: "the-uuid"
		})

		expect(built.spec).toBe("chara_card_v3")
		expect(built.spec_version).toBe("3.0")
		expect(built.data.name).toBe("Aria")
		expect(built.data.first_mes).toBe("hi")
		expect(built.data.tags).toEqual(["fantasy", "oc"])
		expect(built.data.mes_example).toBe("<START>ex1")
		expect(built.data.extensions.serenepub.uuid).toBe("the-uuid")
	})

	test("fills in empty-string/array defaults for missing optional fields", () => {
		const built = buildCharacterCardV3({ name: "Bare", uuid: "u1" })

		expect(built.data.description).toBe("")
		expect(built.data.alternate_greetings).toEqual([])
		expect(built.data.tags).toEqual([])
		expect(built.data.extensions.depth_prompt).toEqual({
			prompt: "",
			depth: 4,
			role: "system"
		})
	})

	test("joins a string[] exampleDialogues with <START> like SillyTavern's mes_example format", () => {
		const built = buildCharacterCardV3({
			name: "Multi",
			exampleDialogues: ["one", "two"],
			uuid: "u1"
		})

		expect(built.data.mes_example).toBe("one<START>two")
	})

	test("only includes source/group_only_greetings/serenepub aliases when non-empty, uuid always present", () => {
		const built = buildCharacterCardV3({ name: "Plain", uuid: "u1" })

		expect(built.data.extensions.source).toBeUndefined()
		expect(built.data.extensions.group_only_greetings).toBeUndefined()
		expect(built.data.extensions.serenepub).toEqual({ uuid: "u1" })

		const withExtras = buildCharacterCardV3({
			name: "Extras",
			source: ["https://example.com"],
			groupOnlyGreetings: ["group hi"],
			aliases: ["Nickname"],
			summary: "a summary",
			uuid: "u2"
		})
		expect(withExtras.data.extensions.source).toEqual([
			"https://example.com"
		])
		expect(withExtras.data.extensions.group_only_greetings).toEqual([
			"group hi"
		])
		expect(withExtras.data.extensions.serenepub).toEqual({
			uuid: "u2",
			aliases: ["Nickname"],
			summary: "a summary"
		})
	})

	test("omits character_book when no lorebook is given, includes it when one is", () => {
		const withoutBook = buildCharacterCardV3({ name: "NoBook", uuid: "u1" })
		expect(withoutBook.data).not.toHaveProperty("character_book")

		const lorebook = {
			name: "Book",
			description: "",
			extensions: {},
			entries: []
		}
		const withBook = buildCharacterCardV3({
			name: "HasBook",
			uuid: "u2",
			lorebook: lorebook as any
		})
		expect(withBook.data.character_book).toEqual(lorebook)
	})
})

describe("embedCharacterCardInPng / parseCharacterCard round-trip", () => {
	test("embedding then parsing recovers the same card data", async () => {
		const built = buildCharacterCardV3({
			name: "Round Trip",
			description: "round trip desc",
			uuid: "u1"
		})
		const png = buildTestCharacterPng(built)
		const parsed = await parseCharacterCard(png)

		expect(parsed.card.name).toBe("Round Trip")
		expect(parsed.card.description).toBe("round trip desc")
	})

	test("replaces an existing chara chunk rather than duplicating it", () => {
		const first = buildTestCharacterPng(
			buildCharacterCardV3({ name: "First", uuid: "u1" })
		)
		const second = embedCharacterCardInPng(
			first,
			buildCharacterCardV3({ name: "Second", uuid: "u2" })
		)

		const chunks = extract(second)
			.filter((c: any) => c.name === "tEXt")
			.filter((c: any) => {
				const decoded = text.decode(c.data)
				return decoded.keyword === "chara" || decoded.keyword === "ccv3"
			})

		expect(chunks).toHaveLength(1)
	})
})

describe("validatePngChunkLengths", () => {
	test("accepts a genuine, well-formed PNG", () => {
		expect(() => validatePngChunkLengths(makeTestPngBuffer())).not.toThrow()
	})

	test("rejects a non-PNG buffer", () => {
		expect(() =>
			validatePngChunkLengths(Buffer.from("not a png", "utf-8"))
		).toThrow("Invalid .png file header")
	})

	test("rejects a chunk that declares a length larger than the buffer — before png-chunks-extract would over-allocate for it", () => {
		const buffer = Buffer.from(makeTestPngBuffer())
		// First chunk's 4-byte length field starts right after the 8-byte
		// signature. Overwrite it with a huge declared length (~4GB) that
		// the actual (tiny, 1x1) test PNG doesn't remotely have.
		buffer.writeUInt32BE(0xfffffffe, 8)

		expect(() => validatePngChunkLengths(buffer)).toThrow(
			/larger than the file/
		)
	})

	test("rejects a buffer truncated mid-chunk-header", () => {
		const buffer = Buffer.from(makeTestPngBuffer()).subarray(0, 10)
		expect(() => validatePngChunkLengths(buffer)).toThrow(
			/truncated chunk header/
		)
	})
})
