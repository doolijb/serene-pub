import { describe, expect, test } from "vitest"
import extract from "png-chunks-extract"
import text from "png-chunk-text"
import { PNG } from "pngjs"
import {
	parseCharacterCard,
	parseCharacterCardFromBase64,
	buildCharacterCardV2,
	embedCharacterCardInPng
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
		const buffer = Buffer.from(JSON.stringify(cardJsonWithLorebook), "utf-8")
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

describe("buildCharacterCardV2", () => {
	test("maps a character's fields into CCv2 shape", () => {
		const built = buildCharacterCardV2({
			name: "Aria",
			description: "desc",
			personality: "kind",
			scenario: "scene",
			firstMessage: "hi",
			exampleDialogues: ["<START>ex1"],
			tags: ["fantasy", "oc"],
			creator: "jody"
		})

		expect(built.spec).toBe("chara_card_v2")
		expect(built.spec_version).toBe("2.0")
		expect(built.data.name).toBe("Aria")
		expect(built.data.first_mes).toBe("hi")
		expect(built.data.tags).toEqual(["fantasy", "oc"])
		expect(built.data.mes_example).toBe("<START>ex1")
	})

	test("fills in empty-string/array defaults for missing optional fields", () => {
		const built = buildCharacterCardV2({ name: "Bare" })

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
		const built = buildCharacterCardV2({
			name: "Multi",
			exampleDialogues: ["one", "two"]
		})

		expect(built.data.mes_example).toBe("one<START>two")
	})

	test("only includes source/group_only_greetings/serenepub extensions when non-empty", () => {
		const built = buildCharacterCardV2({ name: "Plain" })

		expect(built.data.extensions.source).toBeUndefined()
		expect(built.data.extensions.group_only_greetings).toBeUndefined()
		expect(built.data.extensions.serenepub).toEqual({})

		const withExtras = buildCharacterCardV2({
			name: "Extras",
			source: ["https://example.com"],
			groupOnlyGreetings: ["group hi"],
			aliases: ["Nickname"],
			summary: "a summary"
		})
		expect(withExtras.data.extensions.source).toEqual(["https://example.com"])
		expect(withExtras.data.extensions.group_only_greetings).toEqual([
			"group hi"
		])
		expect(withExtras.data.extensions.serenepub).toEqual({
			aliases: ["Nickname"],
			summary: "a summary"
		})
	})
})

describe("embedCharacterCardInPng / parseCharacterCard round-trip", () => {
	test("embedding then parsing recovers the same card data", async () => {
		const built = buildCharacterCardV2({
			name: "Round Trip",
			description: "round trip desc"
		})
		const png = buildTestCharacterPng(built)
		const parsed = await parseCharacterCard(png)

		expect(parsed.card.name).toBe("Round Trip")
		expect(parsed.card.description).toBe("round trip desc")
	})

	test("replaces an existing chara chunk rather than duplicating it", () => {
		const first = buildTestCharacterPng(
			buildCharacterCardV2({ name: "First" })
		)
		const second = embedCharacterCardInPng(
			first,
			buildCharacterCardV2({ name: "Second" })
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
