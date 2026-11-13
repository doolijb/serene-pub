import { describe, expect, test } from "vitest"
import type * as schema from "$lib/server/db/schema"
import {
	followsCardFields,
	layerMemberAsRead,
	layerVersionAsRead,
	type CardRowForReading,
	type MemberRowForReading
} from "./memberAsRead"

function member(over: Partial<MemberRowForReading> = {}): MemberRowForReading {
	return {
		id: 7,
		lorebookId: 3,
		characterId: 11,
		linkedCardId: 11,
		name: "Maren (synced)",
		aliases: ["Mar"],
		summary: "A smith.",
		description: "Member description.",
		personality: "Member personality.",
		scenario: "Member scenario.",
		firstMessage: "Member hello.",
		alternateGreetings: ["Member other hello."],
		exampleDialogues: "<START>\nA: hi\n<START>\nB: bye",
		faceMediaId: 900,
		ownName: null,
		ownNickname: null,
		retold: {},
		timbre: null,
		spriteSet: null,
		...over
	}
}

function card(over: Partial<CardRowForReading> = {}): CardRowForReading {
	return {
		id: 11,
		name: "Maren",
		nickname: "Mare",
		description: "Card description.",
		personality: "Card personality.",
		scenario: "Card scenario.",
		firstMessage: "Card hello.",
		alternateGreetings: ["Card other hello."],
		exampleDialogues: ["Card dialogue one", "Card dialogue two"],
		groupOnlyGreetings: ["Card group hello."],
		avatarMediaId: 500,
		extensions: {},
		...over
	}
}

const noSets = { member: [], card: [] }
const set = (id: number, name: string, position = 0, isDefault = false) => ({
	id,
	name,
	position,
	isDefault
})

describe("followsCardFields", () => {
	test("every field follows the card when nothing is retold", () => {
		expect(followsCardFields({})).toEqual([
			"description",
			"personality",
			"scenario",
			"firstMessage",
			"alternateGreetings",
			"exampleDialogues",
			"face",
			"postHistoryInstructions",
			"creatorNotes",
			"likeness"
		])
		expect(followsCardFields(null)).toEqual(followsCardFields(undefined))
	})
	test("retold fields drop out, in canonical order; false flags still follow", () => {
		expect(
			followsCardFields({
				face: true,
				description: true,
				scenario: false
			})
		).toEqual([
			"personality",
			"scenario",
			"firstMessage",
			"alternateGreetings",
			"exampleDialogues",
			"postHistoryInstructions",
			"creatorNotes",
			"likeness"
		])
	})
})

describe("layerMemberAsRead: carded", () => {
	test("followsCard is right for post-history instructions, creator notes and likeness", () => {
		const r = layerMemberAsRead(
			member({ retold: { postHistoryInstructions: true } }),
			card(),
			noSets,
			[]
		)
		expect(r.followsCard).not.toContain("postHistoryInstructions")
		expect(r.followsCard).toContain("creatorNotes")
		expect(r.followsCard).toContain("likeness")
	})

	test("nothing retold: every text field is the card's", () => {
		const r = layerMemberAsRead(member(), card(), noSets, ["hero"])
		expect(r).toMatchObject({
			castMemberId: 7,
			lorebookId: 3,
			linkedCardId: 11,
			activeCardId: 11,
			cardless: false,
			name: "Maren",
			nickname: "Mare",
			shownName: "Mare",
			description: "Card description.",
			personality: "Card personality.",
			scenario: "Card scenario.",
			firstMessage: "Card hello.",
			alternateGreetings: ["Card other hello."],
			exampleDialogues: ["Card dialogue one", "Card dialogue two"],
			groupOnlyGreetings: ["Card group hello."],
			faceMediaId: 500,
			tags: ["hero"]
		})
		expect(r.followsCard).toHaveLength(10)
		// The member's own aliases and summary are always the member's.
		expect(r.aliases).toEqual(["Mar"])
		expect(r.summary).toBe("A smith.")
	})

	test.each([
		["description", "description", "Member description."],
		["personality", "personality", "Member personality."],
		["scenario", "scenario", "Member scenario."],
		["firstMessage", "firstMessage", "Member hello."]
	] as const)("a retold %s reads the member's", (flag, key, text) => {
		const r = layerMemberAsRead(
			member({ retold: { [flag]: true } }),
			card(),
			noSets,
			[]
		)
		expect(r[key]).toBe(text)
		expect(r.followsCard).not.toContain(flag)
		// The other prose fields still read the card.
		expect(r.description === "Card description.").toBe(
			flag !== "description"
		)
	})

	test("a retold field with an empty member column reads empty, not the card's", () => {
		const r = layerMemberAsRead(
			member({ retold: { scenario: true }, scenario: null }),
			card(),
			noSets,
			[]
		)
		expect(r.scenario).toBe("")
	})

	test("retold alternateGreetings reads the member's list; a false flag reads the card's", () => {
		expect(
			layerMemberAsRead(
				member({ retold: { alternateGreetings: true } }),
				card(),
				noSets,
				[]
			).alternateGreetings
		).toEqual(["Member other hello."])
		expect(
			layerMemberAsRead(
				member({ retold: { alternateGreetings: false } }),
				card(),
				noSets,
				[]
			).alternateGreetings
		).toEqual(["Card other hello."])
	})

	test("retold example dialogues are the member's text split into dialogues", () => {
		const r = layerMemberAsRead(
			member({ retold: { exampleDialogues: true } }),
			card(),
			noSets,
			[]
		)
		expect(r.exampleDialogues).toEqual(["A: hi", "B: bye"])
		expect(r.followsCard).not.toContain("exampleDialogues")
	})

	test("retelling the first message or the other greetings clears the card's group-only greetings", () => {
		for (const flag of ["firstMessage", "alternateGreetings"] as const) {
			const r = layerMemberAsRead(
				member({ retold: { [flag]: true } }),
				card(),
				noSets,
				[]
			)
			expect(r.groupOnlyGreetings).toEqual([])
		}
		// Retelling something else leaves them.
		expect(
			layerMemberAsRead(
				member({ retold: { description: true } }),
				card(),
				noSets,
				[]
			).groupOnlyGreetings
		).toEqual(["Card group hello."])
	})

	test("a card with no group-only greetings reads []", () => {
		expect(
			layerMemberAsRead(
				member(),
				card({ groupOnlyGreetings: null }),
				noSets,
				[]
			).groupOnlyGreetings
		).toEqual([])
	})

	test("own name and nickname win over the card's; each reads through on its own", () => {
		const both = layerMemberAsRead(
			member({ ownName: "Marenne", ownNickname: "Nenne" }),
			card(),
			noSets,
			[]
		)
		expect(both).toMatchObject({
			name: "Marenne",
			nickname: "Nenne",
			shownName: "Nenne"
		})
		const nameOnly = layerMemberAsRead(
			member({ ownName: "Marenne" }),
			card(),
			noSets,
			[]
		)
		expect(nameOnly).toMatchObject({
			name: "Marenne",
			nickname: "Mare",
			shownName: "Mare"
		})
		// An own empty nickname means no nickname in this book.
		const noNick = layerMemberAsRead(
			member({ ownNickname: "" }),
			card(),
			noSets,
			[]
		)
		expect(noNick).toMatchObject({
			name: "Maren",
			nickname: null,
			shownName: "Maren"
		})
	})

	test("the face: the member's while retold and set, else the card's avatar", () => {
		expect(
			layerMemberAsRead(
				member({ retold: { face: true } }),
				card(),
				noSets,
				[]
			).faceMediaId
		).toBe(900)
		expect(
			layerMemberAsRead(member(), card(), noSets, []).faceMediaId
		).toBe(500)
		expect(
			layerMemberAsRead(
				member({ retold: { face: true }, faceMediaId: null }),
				card(),
				noSets,
				[]
			).faceMediaId
		).toBe(500)
		expect(
			layerMemberAsRead(
				member(),
				card({ avatarMediaId: null }),
				noSets,
				[]
			).faceMediaId
		).toBeNull()
	})

	test("the active card can differ from the linked card", () => {
		const r = layerMemberAsRead(
			member({ characterId: 12, linkedCardId: 11 }),
			card({ id: 12, name: "Maren old" }),
			noSets,
			[]
		)
		expect(r).toMatchObject({
			activeCardId: 12,
			linkedCardId: 11,
			name: "Maren old"
		})
	})
})

describe("layerMemberAsRead: card-less", () => {
	const bare = member({
		characterId: null,
		linkedCardId: null,
		name: "Old Tom",
		retold: {},
		timbre: null
	})

	test("every text field is the member's own, whatever the flags", () => {
		for (const retold of [{}, { description: true, face: true }]) {
			const r = layerMemberAsRead({ ...bare, retold }, null, noSets, [
				"ignored"
			])
			expect(r).toMatchObject({
				cardless: true,
				activeCardId: null,
				linkedCardId: null,
				name: "Old Tom",
				nickname: null,
				shownName: "Old Tom",
				description: "Member description.",
				personality: "Member personality.",
				scenario: "Member scenario.",
				firstMessage: "Member hello.",
				alternateGreetings: ["Member other hello."],
				exampleDialogues: ["A: hi", "B: bye"],
				groupOnlyGreetings: [],
				followsCard: [],
				faceMediaId: 900,
				tags: []
			})
		}
	})

	test("null columns stay null, greetings and dialogues default empty", () => {
		const r = layerMemberAsRead(
			{
				...bare,
				description: null,
				personality: null,
				scenario: null,
				firstMessage: null,
				alternateGreetings: [],
				exampleDialogues: null,
				faceMediaId: null
			},
			null,
			noSets,
			[]
		)
		expect(r).toMatchObject({
			description: null,
			personality: null,
			scenario: null,
			firstMessage: null,
			alternateGreetings: [],
			exampleDialogues: [],
			faceMediaId: null
		})
	})

	test("an own name and nickname still apply", () => {
		const r = layerMemberAsRead(
			{ ...bare, ownName: "Thomas", ownNickname: "Tom" },
			null,
			noSets,
			[]
		)
		expect(r).toMatchObject({
			name: "Thomas",
			nickname: "Tom",
			shownName: "Tom"
		})
	})

	test("a card's sprite sets are not read without a card", () => {
		const r = layerMemberAsRead(
			bare,
			null,
			{
				member: [],
				card: [set(1, "calm")]
			},
			[]
		)
		expect(r.spriteSets).toEqual([])
		expect(r.spriteSetsFrom).toBeNull()
	})
})

describe("layerMemberAsRead: voice", () => {
	const cardVoice = {
		serenepub: { timbre: { description: "a warm alto", voice: "alto" } }
	}

	test("the member's timbre wins, normalised", () => {
		const r = layerMemberAsRead(
			member({
				timbre: {
					description: "gruff",
					settings: { speed: 1.2, bogus: 3 } as never
				}
			}),
			card({ extensions: cardVoice }),
			noSets,
			[]
		)
		expect(r.voiceFrom).toBe("member")
		expect(r.timbre).toEqual({
			description: "gruff",
			settings: { speed: 1.2 }
		})
	})

	test("else the card's timbre", () => {
		const r = layerMemberAsRead(
			member(),
			card({ extensions: cardVoice }),
			noSets,
			[]
		)
		expect(r.voiceFrom).toBe("card")
		expect(r.timbre).toEqual({ description: "a warm alto", voice: "alto" })
	})

	test("no member timbre and a card with none: no voice", () => {
		const r = layerMemberAsRead(member(), card(), noSets, [])
		expect(r.timbre).toBeNull()
		expect(r.voiceFrom).toBeNull()
	})

	test("card-less with no timbre: no voice; card-less with a timbre: the member's", () => {
		const bare = member({ characterId: null, linkedCardId: null })
		expect(layerMemberAsRead(bare, null, noSets, [])).toMatchObject({
			timbre: null,
			voiceFrom: null
		})
		expect(
			layerMemberAsRead(
				{ ...bare, timbre: { voice: "tom" } },
				null,
				noSets,
				[]
			)
		).toMatchObject({ timbre: { voice: "tom" }, voiceFrom: "member" })
	})
})

describe("layerMemberAsRead: sprite sets", () => {
	test("the member's own sets win, sorted by position then id", () => {
		const r = layerMemberAsRead(
			member({ spriteSet: "grim" }),
			card(),
			{
				member: [
					set(9, "grim", 1),
					set(5, "calm", 1, true),
					set(8, "x", 0)
				],
				card: [set(1, "card-set", 0, true)]
			},
			[]
		)
		expect(r.spriteSetsFrom).toBe("member")
		expect(r.spriteSets.map((s) => s.name)).toEqual(["x", "calm", "grim"])
		expect(r.spriteSet).toBe("grim")
	})

	test("else the active card's sets", () => {
		const r = layerMemberAsRead(
			member(),
			card(),
			{
				member: [],
				card: [set(2, "b", 1), set(1, "a", 0, true)]
			},
			[]
		)
		expect(r.spriteSetsFrom).toBe("card")
		expect(r.spriteSets).toEqual([
			{ id: 1, name: "a", isDefault: true, position: 0 },
			{ id: 2, name: "b", isDefault: false, position: 1 }
		])
	})

	test("none: [] and null", () => {
		const r = layerMemberAsRead(member(), card(), noSets, [])
		expect(r.spriteSets).toEqual([])
		expect(r.spriteSetsFrom).toBeNull()
		expect(r.spriteSet).toBeNull()
	})
})

type VersionRow = typeof schema.characterVersions.$inferSelect

/** A `character_versions` row with only the profile and the ids set. */
function version(over: Partial<VersionRow> = {}): VersionRow {
	return {
		id: 1,
		cardId: null,
		castMemberId: 7,
		number: null,
		label: null,
		parentVersionId: null,
		lorebookId: 3,
		branchId: null,
		year: null,
		month: null,
		day: null,
		historyEntryId: null,
		atHour: null,
		atMinute: null,
		personalPosition: null,
		sourceSessionId: null,
		sourceMessageId: null,
		writtenBy: null,
		note: null,
		liftedFromAmendmentId: null,
		validFromMessageId: null,
		writeOrder: 1,
		retiredOrder: null,
		name: null,
		nickname: null,
		aliases: [],
		summary: null,
		description: null,
		personality: null,
		scenario: null,
		greetings: [],
		exampleDialogues: [],
		postHistoryInstructions: null,
		creatorNotes: null,
		strokes: [],
		faceMediaId: null,
		likeness: null,
		timbre: null,
		spriteSet: null,
		extensions: {},
		nodeState: "active",
		nodeVisibility: "normal",
		follows: [],
		createdAt: new Date(0),
		updatedAt: new Date(0),
		...over
	}
}

const m = { id: 7, lorebookId: 3, characterId: 11 }

describe("layerVersionAsRead", () => {
	const parent = version({
		id: 50,
		cardId: 11,
		castMemberId: null,
		number: 2,
		label: "2.0",
		name: "Maren",
		nickname: "Mare",
		description: "Card description.",
		faceMediaId: 500,
		greetings: [{ text: "Card hello." }],
		timbre: { description: "card alto" }
	})

	test("followed fields come from the parent; the rest are the version's own", () => {
		const r = layerVersionAsRead(
			m,
			version({
				parentVersionId: 50,
				follows: [
					"name",
					"nickname",
					"description",
					"faceMediaId",
					"greetings"
				],
				description: "ignored",
				personality: "Own personality."
			}),
			parent,
			3,
			noSets,
			["smith"]
		)
		expect(r).toMatchObject({
			castVersionId: 1,
			cardVersion: { id: 50, number: 2, label: "2.0" },
			linkedCardId: 11,
			activeCardId: 11,
			cardless: false,
			behindCard: true,
			name: "Maren",
			shownName: "Mare",
			description: "Card description.",
			personality: "Own personality.",
			faceMediaId: 500,
			firstMessage: "Card hello.",
			tags: ["smith"],
			followsCard: [
				"description",
				"firstMessage",
				"alternateGreetings",
				"face"
			]
		})
	})

	test("behindCard is false at the card's highest number, and with no parent", () => {
		const v = version({ parentVersionId: 50, follows: ["name"] })
		expect(layerVersionAsRead(m, v, parent, 2, noSets, []).behindCard).toBe(
			false
		)
		const bare = layerVersionAsRead(
			m,
			version({ name: "Tom" }),
			null,
			null,
			noSets,
			["x"]
		)
		expect(bare).toMatchObject({
			cardless: true,
			activeCardId: null,
			cardVersion: null,
			behindCard: false,
			follows: [],
			followsCard: [],
			tags: [],
			name: "Tom"
		})
	})

	test("timbre: own over card unless followed; a parentless follower has none", () => {
		const own = layerVersionAsRead(
			m,
			version({ timbre: { description: "own" } }),
			null,
			null,
			noSets,
			[]
		)
		expect([own.voiceFrom, own.timbre]).toEqual([
			"member",
			{ description: "own" }
		])
		const followed = layerVersionAsRead(
			m,
			version({
				parentVersionId: 50,
				follows: ["timbre"],
				timbre: { description: "x" }
			}),
			parent,
			2,
			noSets,
			[]
		)
		expect([followed.voiceFrom, followed.timbre]).toEqual([
			"card",
			{ description: "card alto" }
		])
		const orphan = layerVersionAsRead(
			m,
			version({ follows: ["timbre"] }),
			null,
			null,
			noSets,
			[]
		)
		expect([orphan.voiceFrom, orphan.timbre]).toEqual([null, null])
	})

	test("sprite sets: the member's own, else the parent card's; none for a card-less member", () => {
		const cardSets = [set(2, "b", 1), set(1, "a", 0, true)]
		const v = version({ parentVersionId: 50 })
		expect(
			layerVersionAsRead(
				m,
				v,
				parent,
				2,
				{ member: [], card: cardSets },
				[]
			).spriteSetsFrom
		).toBe("card")
		expect(
			layerVersionAsRead(
				m,
				v,
				parent,
				2,
				{ member: [set(9, "own")], card: cardSets },
				[]
			).spriteSetsFrom
		).toBe("member")
		expect(
			layerVersionAsRead(
				m,
				version(),
				null,
				null,
				{ member: [], card: cardSets },
				[]
			).spriteSetsFrom
		).toBeNull()
	})
})
