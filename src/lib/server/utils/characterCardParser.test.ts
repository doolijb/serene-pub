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
	validatePngChunkLengths,
	readCharxContainer,
	isZipBuffer,
	CHARX_LIMITS,
	unimportedAssets,
	describeUnimportedAssets
} from "./characterCardParser"
import { zipSync, strToU8 } from "fflate"

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

	describe("includeAvatar option", () => {
		const avatarBytes = Buffer.from("fake-avatar-bytes")
		const cardJsonWithAvatar = {
			...minimalCardJson,
			data: {
				...minimalCardJson.data,
				avatar: `data:image/png;base64,${avatarBytes.toString("base64")}`
			}
		}

		test("decodes avatarBuffer by default when omitted", async () => {
			const buffer = Buffer.from(
				JSON.stringify(cardJsonWithAvatar),
				"utf-8"
			)
			const result = await parseCharacterCard(buffer)

			expect(result.avatarBuffer).toBeDefined()
			expect(result.avatarBuffer!.equals(avatarBytes)).toBe(true)
		})

		test("decodes avatarBuffer when includeAvatar is explicitly true", async () => {
			const buffer = Buffer.from(
				JSON.stringify(cardJsonWithAvatar),
				"utf-8"
			)
			const result = await parseCharacterCard(buffer, {
				includeAvatar: true
			})

			expect(result.avatarBuffer).toBeDefined()
			expect(result.avatarBuffer!.equals(avatarBytes)).toBe(true)
		})

		test("skips avatarBuffer entirely when includeAvatar is false, even though card.avatar is present", async () => {
			const buffer = Buffer.from(
				JSON.stringify(cardJsonWithAvatar),
				"utf-8"
			)
			const result = await parseCharacterCard(buffer, {
				includeAvatar: false
			})

			expect(result.avatarBuffer).toBeUndefined()
			// Everything else about the card is still parsed normally —
			// includeAvatar only affects avatarBuffer.
			expect(result.card.name).toBe("Test Character")
		})

		test("has no avatarBuffer either way when the card has no avatar field at all", async () => {
			const buffer = Buffer.from(JSON.stringify(minimalCardJson), "utf-8")

			const withDefault = await parseCharacterCard(buffer)
			expect(withDefault.avatarBuffer).toBeUndefined()

			const withExplicitTrue = await parseCharacterCard(buffer, {
				includeAvatar: true
			})
			expect(withExplicitTrue.avatarBuffer).toBeUndefined()
		})
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

describe("CHARX containers", () => {
	const v3Card = (assets?: unknown[]) => ({
		spec: "chara_card_v3",
		spec_version: "3.0",
		data: {
			name: "Charx Character",
			description: "Packed in a zip",
			first_mes: "Hello from a zip",
			tags: ["zipped"],
			character_book: {
				name: "Zip Book",
				entries: [
					{ keys: ["harbour"], content: "It burned.", enabled: true, insertion_order: 0 }
				]
			},
			...(assets ? { assets } : {})
		}
	})

	function makeCharx(
		card: unknown,
		extra: Record<string, Uint8Array> = {}
	): Buffer {
		return Buffer.from(
			zipSync({ "card.json": strToU8(JSON.stringify(card)), ...extra })
		)
	}

	test("detects the zip magic", () => {
		expect(isZipBuffer(makeCharx(v3Card()))).toBe(true)
		expect(isZipBuffer(makeTestPngBuffer())).toBe(false)
	})

	test("imports the card, its lorebook and the main icon as the avatar", async () => {
		const png = makeTestPngBuffer()
		const buffer = makeCharx(
			v3Card([
				{ type: "icon", uri: "embeded://assets/icon/images/2.png", name: "alt", ext: "png" },
				{ type: "icon", uri: "embeded://assets/icon/images/1.png", name: "main", ext: "png" },
				{ type: "emotion", uri: "embeded://assets/emotion/happy.png", name: "happy", ext: "png" }
			]),
			{
				"assets/icon/images/1.png": png,
				"assets/icon/images/2.png": strToU8("not the main icon")
			}
		)
		const parsed = await parseCharacterCard(buffer)
		const data = getRobustSpecV3Data(parsed.card)
		expect(data.name).toBe("Charx Character")
		expect(data.first_mes).toBe("Hello from a zip")
		expect(data.tags).toEqual(["zipped"])
		expect(parsed.lorebook?.entries).toHaveLength(1)
		expect(parsed.avatarBuffer?.equals(png)).toBe(true)
	})

	test("falls back to the first icon when none is named main", async () => {
		const png = makeTestPngBuffer()
		const { avatarBuffer } = await readCharxContainer(
			makeCharx(v3Card([{ type: "icon", uri: "embeded://a.png", name: "x", ext: "png" }]), {
				"a.png": png
			})
		)
		expect(avatarBuffer?.equals(png)).toBe(true)
	})

	test("tolerates the correctly spelled embedded:// scheme", async () => {
		const png = makeTestPngBuffer()
		const { avatarBuffer } = await readCharxContainer(
			makeCharx(v3Card([{ type: "icon", uri: "embedded://a.png", name: "main", ext: "png" }]), {
				"a.png": png
			})
		)
		expect(avatarBuffer?.equals(png)).toBe(true)
	})

	test("reads a data: URI icon", async () => {
		const png = makeTestPngBuffer()
		const uri = `data:image/png;base64,${png.toString("base64")}`
		const { avatarBuffer } = await readCharxContainer(
			makeCharx(v3Card([{ type: "icon", uri, name: "main", ext: "png" }]))
		)
		expect(avatarBuffer?.equals(png)).toBe(true)
	})

	test("never fetches a remote icon, and ccdefault: yields no avatar", async () => {
		for (const uri of ["https://example.com/a.png", "ccdefault:"]) {
			const { raw, avatarBuffer } = await readCharxContainer(
				makeCharx(v3Card([{ type: "icon", uri, name: "main", ext: "png" }]))
			)
			expect(raw.data.name).toBe("Charx Character")
			expect(avatarBuffer).toBeUndefined()
		}
	})

	test("an icon the card names but the zip lacks is simply absent", async () => {
		const { avatarBuffer } = await readCharxContainer(
			makeCharx(v3Card([{ type: "icon", uri: "embeded://missing.png", name: "main", ext: "png" }]))
		)
		expect(avatarBuffer).toBeUndefined()
	})

	test("includeAvatar false never inflates the icon", async () => {
		const parsed = await parseCharacterCard(
			makeCharx(v3Card([{ type: "icon", uri: "embeded://a.png", name: "main", ext: "png" }]), {
				"a.png": makeTestPngBuffer()
			}),
			{ includeAvatar: false }
		)
		expect(parsed.avatarBuffer).toBeUndefined()
	})

	test("a zip without card.json is refused with a readable error", async () => {
		const buffer = Buffer.from(zipSync({ "readme.txt": strToU8("hi") }))
		await expect(parseCharacterCard(buffer)).rejects.toThrow(/no card\.json/)
	})

	test("card.json that is not JSON is refused", async () => {
		const buffer = Buffer.from(zipSync({ "card.json": strToU8("{nope") }))
		await expect(readCharxContainer(buffer)).rejects.toThrow(/not valid JSON/)
	})

	test("a byte-order mark on card.json is tolerated", async () => {
		const buffer = Buffer.from(
			zipSync({ "card.json": strToU8("\uFEFF" + JSON.stringify(v3Card())) })
		)
		expect((await readCharxContainer(buffer)).raw.data.name).toBe("Charx Character")
	})

	test("an entry declaring more than the ceiling is refused before inflating", async () => {
		const prior = CHARX_LIMITS.cardJsonBytes
		CHARX_LIMITS.cardJsonBytes = 10
		try {
			await expect(readCharxContainer(makeCharx(v3Card()))).rejects.toThrow(/larger than/)
		} finally {
			CHARX_LIMITS.cardJsonBytes = prior
		}
	})

	test("a truncated zip is refused as unreadable", async () => {
		const buffer = makeCharx(v3Card()).subarray(0, 30)
		await expect(readCharxContainer(buffer)).rejects.toThrow(/could not be read/)
	})
})

describe("unimported card assets (V3 spec: alert when assets are not kept)", () => {
	test("counts everything except the main icon, by type", () => {
		const raw = {
			data: {
				assets: [
					{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" },
					{ type: "icon", uri: "embeded://b.png", name: "alt", ext: "png" },
					{ type: "emotion", uri: "embeded://joy.png", name: "joy", ext: "png" },
					{ type: "emotion", uri: "embeded://sad.png", name: "sad", ext: "png" },
					{ type: "background", uri: "embeded://bg.png", name: "main", ext: "png" },
					{ type: "x-risu-asset", uri: "__asset:4", name: "map", ext: "png" }
				]
			}
		}
		expect(unimportedAssets(raw)).toEqual({
			icon: 1,
			emotion: 2,
			background: 1,
			"x-risu-asset": 1
		})
	})

	test("counts RisuAI's older extension pairs", () => {
		const raw = {
			data: {
				extensions: {
					risuai: {
						emotions: [["joy", "AAAA"], ["sad", "BBBB"]],
						additionalAssets: [["map", "CCCC", "png"]]
					}
				}
			}
		}
		expect(unimportedAssets(raw)).toEqual({ emotion: 2, "x-risu-asset": 1 })
	})

	test("a card with only its main icon, or no assets, leaves nothing behind", () => {
		expect(
			unimportedAssets({
				data: { assets: [{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" }] }
			})
		).toBeUndefined()
		expect(unimportedAssets({ data: {} })).toBeUndefined()
		expect(unimportedAssets(undefined)).toBeUndefined()
	})

	test("describes the counts in one sentence", () => {
		expect(describeUnimportedAssets(undefined)).toBeUndefined()
		expect(describeUnimportedAssets({ emotion: 1 })).toBe(
			"The card's 1 emotion image was not imported, so exporting this character will leave it out."
		)
		expect(
			describeUnimportedAssets({ emotion: 12, background: 1, "x-risu-asset": 3 })
		).toBe(
			"The card's 12 emotion images, 1 background and 3 other assets were not imported, so exporting this character will leave them out."
		)
	})

	test("parseCharacterCard reports them for a CHARX", async () => {
		const buffer = Buffer.from(
			zipSync({
				"card.json": strToU8(
					JSON.stringify({
						spec: "chara_card_v3",
						spec_version: "3.0",
						data: {
							name: "Packed",
							description: "x",
							assets: [
								{ type: "icon", uri: "embeded://i.png", name: "main", ext: "png" },
								{ type: "emotion", uri: "embeded://joy.png", name: "joy", ext: "png" }
							]
						}
					})
				),
				"i.png": makeTestPngBuffer(),
				"joy.png": makeTestPngBuffer()
			})
		)
		const parsed = await parseCharacterCard(buffer)
		// Sprites are kept now (DESIGN-sprites §4): nothing left behind.
		expect(parsed.unimportedAssets).toBeUndefined()
		expect(parsed.sprites?.map((p) => p.label)).toEqual(["joy"])
		expect(parsed.avatarBuffer).toBeDefined()
	})
})

describe("card sprites (DESIGN-sprites §4)", () => {
	const card = (assets: unknown[], extensions: unknown = {}) => ({
		spec: "chara_card_v3",
		spec_version: "3.0",
		data: { name: "Sprited", description: "x", assets, extensions }
	})

	test("CHARX: emotion and expression assets land in the default set; x_sp_sprite keeps its set", async () => {
		const joy = makeTestPngBuffer()
		const plate = Buffer.from(makeTestPngBuffer())
		const buffer = Buffer.from(
			zipSync({
				"card.json": strToU8(
					JSON.stringify(
						card([
							{ type: "emotion", uri: "embeded://assets/emotion/images/0.png", name: "Joy", ext: "png" },
							{ type: "expression", uri: "embeded://assets/emotion/images/1.png", name: "anger", ext: "png" },
							{ type: "x_sp_sprite", uri: "embeded://assets/x/armour-stern.png", name: "Armour/Stern", ext: "png" },
							{ type: "emotion", uri: "https://example.com/sad.png", name: "sad", ext: "png" },
							{ type: "background", uri: "embeded://assets/background/images/0.png", name: "main", ext: "png" }
						])
					)
				),
				"assets/emotion/images/0.png": joy,
				"assets/emotion/images/1.png": plate,
				"assets/x/armour-stern.png": plate,
				"assets/background/images/0.png": plate
			})
		)
		const parsed = await parseCharacterCard(buffer)
		expect(parsed.sprites?.map((s) => [s.set ?? null, s.label])).toEqual([
			[null, "joy"],
			[null, "anger"],
			["armour", "stern"]
		])
		expect(parsed.sprites?.[0].bytes.equals(joy)).toBe(true)
		// The remote sprite and the background are left behind — and said so.
		expect(parsed.unimportedAssets).toEqual({ emotion: 1, background: 1 })
	})

	test("RisuAI PNG: __asset URIs resolve to chara-ext-asset_ chunks", async () => {
		const sprite = makeTestPngBuffer()
		const base = embedCharacterCardInPng(
			makeTestPngBuffer(),
			card([{ type: "emotion", uri: "__asset:3", name: "joy", ext: "png" }])
		)
		const chunks = extract(base)
		chunks.splice(
			chunks.length - 1,
			0,
			text.encode("chara-ext-asset_:3", sprite.toString("base64"))
		)
		const encode = (await import("png-chunks-encode")).default
		const buffer = Buffer.from(encode(chunks))
		const parsed = await parseCharacterCard(buffer)
		expect(parsed.sprites?.map((s) => s.label)).toEqual(["joy"])
		expect(parsed.sprites?.[0].bytes.equals(sprite)).toBe(true)
		expect(parsed.unimportedAssets).toBeUndefined()
	})

	test("older RisuAI pairs: raw base64 values become sprites", async () => {
		const sprite = makeTestPngBuffer()
		const json = card([], {
			risuai: { emotions: [["Happy", sprite.toString("base64")], ["", "x"]] }
		})
		const parsed = await parseCharacterCard(Buffer.from(JSON.stringify(json)))
		expect(parsed.sprites?.map((s) => s.label)).toEqual(["happy"])
		// The unlabelled pair is left behind and counted.
		expect(parsed.unimportedAssets).toEqual({ emotion: 1 })
	})

	test("includeAvatar: false skips sprite extraction too", async () => {
		const json = card([], { risuai: { emotions: [["joy", makeTestPngBuffer().toString("base64")]] } })
		const parsed = await parseCharacterCard(Buffer.from(JSON.stringify(json)), {
			includeAvatar: false
		})
		expect(parsed.sprites).toBeUndefined()
	})
})
