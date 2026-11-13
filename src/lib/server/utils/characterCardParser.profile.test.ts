/**
 * Card files and the character profile (cv-writers, plan §32 §2 with the
 * §33.1 delta): greetings and creator notes both ways. The reader path is the
 * import's (`parseCharacterCard` → `getRobustSpecV3Data` →
 * `characterFieldsFromParsedData` → `profileOfCardColumns`); the writer path is
 * the export's (`cardColumnsOfProfile` → `buildCharacterCardV3`).
 */
import { describe, expect, test, vi } from "vitest"
import { PNG } from "pngjs"

// `characterFieldsFromParsedData` lives in a socket module that imports the db
// and the sprite reader; this test touches neither.
vi.mock("$lib/server/db", () => ({ db: {}, dbReady: Promise.resolve() }))
vi.mock("$lib/server/sprites", () => ({
	listSpriteSets: async () => []
}))

import {
	buildCharacterCardV3,
	embedCharacterCardInPng,
	getRobustSpecV3Data,
	parseCharacterCard
} from "./characterCardParser"
import { buildCharx } from "$lib/server/sprites/charx"
import { characterFieldsFromParsedData } from "$lib/server/sockets/characters"
import {
	cardColumnsOfProfile,
	profileOfCardColumns
} from "$lib/server/characters/cardIO"
import type { CharacterProfileV1 } from "$lib/shared/characters/profile"

const UUID = "11111111-1111-4111-8111-111111111111"

function pngBuffer(): Buffer {
	const png = new PNG({ width: 1, height: 1 })
	png.data[0] = 255
	png.data[1] = 255
	png.data[2] = 255
	png.data[3] = 255
	return PNG.sync.write(png)
}

const bytesOf = (card: unknown) => Buffer.from(JSON.stringify(card), "utf8")

/** The reader path: a card file's bytes as a character profile. */
async function readProfile(bytes: Buffer): Promise<CharacterProfileV1> {
	const parsed = await parseCharacterCard(bytes)
	const data = getRobustSpecV3Data(parsed.card)
	return profileOfCardColumns(characterFieldsFromParsedData(data))
}

/** The writer path: a profile as the V3 card the export builds. */
function writeCard(profile: CharacterProfileV1) {
	return buildCharacterCardV3({
		...cardColumnsOfProfile(profile),
		uuid: UUID
	})
}

/** Same profile, but for the foreign `extensions`: the export adds `depth_prompt`, which the next import keeps. */
function expectSameCard(a: CharacterProfileV1, b: CharacterProfileV1) {
	expect({ ...a, extensions: {} }).toEqual({ ...b, extensions: {} })
}

const baseData = {
	name: "Verity",
	description: "A knight",
	personality: "",
	scenario: "",
	first_mes: "Hi",
	mes_example: "",
	creator_notes: "",
	system_prompt: "",
	post_history_instructions: "",
	alternate_greetings: ["Hello", ""],
	tags: [],
	creator: "",
	character_version: ""
}

const GREETINGS = [
	{ text: "Hi" },
	{ text: "Hello" },
	{ text: "" },
	{ text: "G", groupOnly: true }
]

const v2Card = {
	spec: "chara_card_v2",
	spec_version: "2.0",
	data: { ...baseData, extensions: { group_only_greetings: ["G"] } }
}
const v3Card = {
	spec: "chara_card_v3",
	spec_version: "3.0",
	data: { ...baseData, group_only_greetings: ["G"], extensions: {} }
}

const FILES: [string, () => Buffer][] = [
	["a V2 JSON card", () => bytesOf(v2Card)],
	["a V3 JSON card", () => bytesOf(v3Card)],
	[
		"a PNG with a chara chunk",
		() => embedCharacterCardInPng(pngBuffer(), v2Card)
	]
]

describe("greetings in a card file", () => {
	test.each(FILES)(
		"%s reads as one merged list and exports back to the same one",
		async (_n, make) => {
			const profile = await readProfile(make())
			expect(profile.greetings).toEqual(GREETINGS)

			const out = writeCard(profile)
			expect(out.data.first_mes).toBe("Hi")
			expect(out.data.alternate_greetings).toEqual(["Hello", ""])
			expect((out.data as any).group_only_greetings).toEqual(["G"])
			// ⏳ the copy under extensions stays
			expect((out.data.extensions as any).group_only_greetings).toEqual([
				"G"
			])

			// stable: the exported card reads as the same profile
			const again = await readProfile(bytesOf(out))
			expect(again.greetings).toEqual(GREETINGS)
			expectSameCard(again, profile)
			// and from then on exactly
			expect(await readProfile(bytesOf(writeCard(again)))).toEqual(again)
		}
	)

	test("an empty first_mes with alternates keeps the alternates, and is stable on a second round", async () => {
		const card = {
			...v3Card,
			data: {
				...v3Card.data,
				first_mes: "",
				alternate_greetings: ["A", ""],
				group_only_greetings: []
			}
		}
		const profile = await readProfile(bytesOf(card))
		expect(profile.greetings).toEqual([{ text: "A" }, { text: "" }])

		const out = writeCard(profile)
		expect(out.data.first_mes).toBe("A")
		expect(out.data.alternate_greetings).toEqual([""])
		expect((out.data as any).group_only_greetings).toBeUndefined()
		const again = await readProfile(bytesOf(out))
		expect(again.greetings).toEqual(profile.greetings)
		expect(writeCard(again)).toEqual(out)
	})

	test("group_only_greetings is not kept among the profile's extensions", async () => {
		// the import plan reads it into the greetings and drops the key, whichever place it came from
		for (const card of [v2Card, v3Card]) {
			const profile = await readProfile(bytesOf(card))
			expect(profile.extensions).not.toHaveProperty(
				"group_only_greetings"
			)
		}
		const both = {
			...v3Card,
			data: {
				...v3Card.data,
				extensions: { group_only_greetings: ["G"], other: 1 }
			}
		}
		const profile = await readProfile(bytesOf(both))
		expect(profile.extensions).toEqual({ other: 1 })
		expect(profile.greetings.filter((g) => g.groupOnly)).toEqual([
			{ text: "G", groupOnly: true }
		])
	})
})

describe("creator notes in a card file", () => {
	const notesCard = {
		...v3Card,
		data: {
			...v3Card.data,
			creator_notes: "Hello",
			creator_notes_multilingual: { en: "Hello", fr: "Bonjour" }
		}
	}

	test("the main note keeps its language and the others are variants", async () => {
		const profile = await readProfile(bytesOf(notesCard))
		expect(profile.creatorNotes).toEqual({
			text: "Hello",
			lang: "en",
			variants: { fr: "Bonjour" }
		})
	})

	test("both fields are exported, the main note under its language", async () => {
		const profile = await readProfile(bytesOf(notesCard))
		const out = writeCard(profile)
		expect(out.data.creator_notes).toBe("Hello")
		expect((out.data as any).creator_notes_multilingual).toEqual({
			en: "Hello",
			fr: "Bonjour"
		})
		expect((await readProfile(bytesOf(out))).creatorNotes).toEqual(
			profile.creatorNotes
		)
	})

	test("a card with plain notes exports no multilingual map", async () => {
		const profile = await readProfile(
			bytesOf({
				...v3Card,
				data: { ...v3Card.data, creator_notes: "Plain" }
			})
		)
		const out = writeCard(profile)
		expect(out.data.creator_notes).toBe("Plain")
		expect(out.data).not.toHaveProperty("creator_notes_multilingual")
	})
})

describe("CHARX", () => {
	test("buildCharx writes the card the builder made, and it reads as the same profile", async () => {
		const profile = await readProfile(
			bytesOf({
				...v3Card,
				data: {
					...v3Card.data,
					creator_notes: "Hello",
					creator_notes_multilingual: { en: "Hello", fr: "Bonjour" }
				}
			})
		)
		const charx = await buildCharx({} as any, {
			characterId: 1,
			avatarMediaId: null,
			card: writeCard(profile)
		})
		const again = await readProfile(charx)
		expect(again.greetings).toEqual(GREETINGS)
		expect(again.creatorNotes).toEqual(profile.creatorNotes)
		expectSameCard(again, profile)
	})
})
