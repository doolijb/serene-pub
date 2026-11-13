/**
 * The pure half of the character versions writer: a card row → a card
 * profile, and a cast member row + its parent card profile → its own values
 * and `follows`. `memberProfileOf` must read as `layerMemberAsRead` does.
 */
import { describe, expect, it } from "vitest"
import { cardProfileOf, memberProfileOf } from "./versions"
import {
	emptyCharacterProfile,
	type CharacterProfileV1
} from "$lib/shared/characters/profile"

type CardArg = Parameters<typeof cardProfileOf>[0]
type MemberArg = Parameters<typeof memberProfileOf>[0]

const card = (over: Partial<CardArg> = {}): CardArg => ({
	name: "Ada",
	nickname: null,
	aliases: [],
	summary: null,
	description: "A mathematician.",
	personality: null,
	scenario: null,
	firstMessage: null,
	alternateGreetings: [],
	groupOnlyGreetings: null,
	exampleDialogues: [],
	postHistoryInstructions: null,
	creatorNotes: null,
	creatorNotesMultilingual: null,
	strokes: [],
	avatarMediaId: null,
	extensions: {},
	...over
})

const member = (over: Partial<MemberArg> = {}): MemberArg => ({
	name: "Ada",
	aliases: [],
	summary: null,
	description: null,
	personality: null,
	scenario: null,
	firstMessage: null,
	alternateGreetings: [],
	exampleDialogues: null,
	faceMediaId: null,
	retold: {},
	ownName: null,
	ownNickname: null,
	timbre: null,
	spriteSet: null,
	...over
})

/** A parent card profile with solo greetings, one group-only. */
const parent = (
	over: Partial<CharacterProfileV1> = {}
): CharacterProfileV1 => ({
	...emptyCharacterProfile(),
	name: "Ada",
	description: "A mathematician.",
	greetings: [
		{ text: "Hello." },
		{ text: "Hi." },
		{ text: "Hey." },
		{ text: "All hands.", groupOnly: true }
	],
	...over
})

describe("cardProfileOf", () => {
	it("merges the greetings: opener, alternates (empty kept), group-only marked", () => {
		const p = cardProfileOf(
			card({
				firstMessage: "Hello.",
				alternateGreetings: ["Hi.", "", "Hey."],
				groupOnlyGreetings: ["All hands."]
			})
		)
		expect(p.greetings).toEqual([
			{ text: "Hello." },
			{ text: "Hi." },
			{ text: "" },
			{ text: "Hey." },
			{ text: "All hands.", groupOnly: true }
		])
	})

	it("skips an empty opener", () => {
		const p = cardProfileOf(
			card({ firstMessage: "", alternateGreetings: ["Hi."] })
		)
		expect(p.greetings).toEqual([{ text: "Hi." }])
	})

	it("merges the creator notes, keeps the main note's language and drops its repeat from the variants", () => {
		const p = cardProfileOf(
			card({
				creatorNotes: "Notes.",
				creatorNotesMultilingual: { en: "Notes.", fr: "Notes (fr)." }
			})
		)
		expect(p.creatorNotes).toEqual({
			text: "Notes.",
			lang: "en",
			variants: { fr: "Notes (fr)." }
		})
		expect(
			cardProfileOf(
				card({
					creatorNotes: "Notes.",
					creatorNotesMultilingual: { fr: "Notes (fr)." }
				})
			).creatorNotes
		).toEqual({ text: "Notes.", variants: { fr: "Notes (fr)." } })
		expect(cardProfileOf(card()).creatorNotes).toBeNull()
	})

	it("lifts likeness and timbre out of the extensions and drops an emptied serenepub", () => {
		const extensions = {
			serenepub: {
				likeness: { prompt: "tall" },
				timbre: { voice: "calm" }
			},
			other: 1
		}
		const p = cardProfileOf(card({ extensions }))
		expect(p.likeness).toEqual({ prompt: "tall" })
		expect(p.timbre).toEqual({ voice: "calm" })
		expect(p.extensions).toEqual({ other: 1 })
		// The input is not mutated.
		expect(extensions.serenepub.likeness).toEqual({ prompt: "tall" })
	})

	it("keeps the other serenepub keys, and has null likeness and timbre without them", () => {
		const p = cardProfileOf(
			card({
				extensions: {
					serenepub: { timbre: { voice: "v" }, keep: true }
				}
			})
		)
		expect(p.extensions).toEqual({ serenepub: { keep: true } })
		expect(p.likeness).toBeNull()
		const bare = cardProfileOf(card())
		expect(bare.timbre).toBeNull()
		expect(bare.likeness).toBeNull()
		expect(bare.spriteSet).toBeNull()
	})

	it("carries the plain fields, with the avatar as the face", () => {
		const p = cardProfileOf(
			card({
				nickname: "A",
				aliases: ["Countess"],
				summary: "S",
				personality: "P",
				scenario: "C",
				exampleDialogues: ["<START>x"],
				postHistoryInstructions: "post",
				avatarMediaId: 7
			})
		)
		expect(p).toMatchObject({
			name: "Ada",
			nickname: "A",
			aliases: ["Countess"],
			summary: "S",
			personality: "P",
			scenario: "C",
			exampleDialogues: ["<START>x"],
			postHistoryInstructions: "post",
			faceMediaId: 7
		})
	})
})

describe("memberProfileOf", () => {
	it("card-less: everything is own, nothing follows", () => {
		const { own, follows, mixedGreetings } = memberProfileOf(
			member({
				name: "Bo",
				aliases: ["B"],
				summary: "sum",
				description: "d",
				personality: "p",
				scenario: "s",
				firstMessage: "Hi.",
				alternateGreetings: ["Yo."],
				exampleDialogues: "<START>\nA: x\n<START>\nB: y",
				faceMediaId: 4,
				timbre: { voice: "v" },
				spriteSet: "set"
			}),
			null
		)
		expect(follows).toEqual([])
		expect(mixedGreetings).toBe(false)
		expect(own).toMatchObject({
			name: "Bo",
			nickname: null,
			aliases: ["B"],
			summary: "sum",
			description: "d",
			personality: "p",
			scenario: "s",
			greetings: [{ text: "Hi." }, { text: "Yo." }],
			exampleDialogues: ["A: x", "B: y"],
			faceMediaId: 4,
			timbre: { voice: "v" },
			spriteSet: "set",
			postHistoryInstructions: null,
			creatorNotes: null,
			strokes: [],
			likeness: null,
			extensions: {}
		})
	})

	it("card-less: an own name and own nickname win; an empty own nickname is none", () => {
		const a = memberProfileOf(
			member({ name: "Bo", ownName: " Bobby ", ownNickname: "B" }),
			null
		)
		expect(a.own.name).toBe("Bobby")
		expect(a.own.nickname).toBe("B")
		const b = memberProfileOf(member({ name: "Bo", ownNickname: "" }), null)
		expect(b.own.name).toBe("Bo")
		expect(b.own.nickname).toBeNull()
	})

	it("carded with nothing retold: everything follows but aliases, summary, sprite set", () => {
		const { own, follows, mixedGreetings } = memberProfileOf(
			member({ aliases: ["B"], summary: "sum", spriteSet: "set" }),
			parent()
		)
		expect(mixedGreetings).toBe(false)
		expect(own.aliases).toEqual(["B"])
		expect(own.summary).toBe("sum")
		expect(own.spriteSet).toBe("set")
		expect([...follows].sort()).toEqual(
			[
				"name",
				"nickname",
				"description",
				"personality",
				"scenario",
				"greetings",
				"exampleDialogues",
				"postHistoryInstructions",
				"creatorNotes",
				"strokes",
				"faceMediaId",
				"likeness",
				"timbre",
				"extensions"
			].sort()
		)
		expect(own.name).toBeNull()
		expect(own.greetings).toEqual([])
	})

	it.each(["description", "personality", "scenario"] as const)(
		'carded: retold %s is own (and ?? "")',
		(field) => {
			const a = memberProfileOf(
				member({ retold: { [field]: true }, [field]: "mine" }),
				parent()
			)
			expect(a.own[field]).toBe("mine")
			expect(a.follows).not.toContain(field)
			const b = memberProfileOf(
				member({ retold: { [field]: true }, [field]: null }),
				parent()
			)
			expect(b.own[field]).toBe("")
		}
	)

	it("carded: retold example dialogues are own, split by <START>", () => {
		const r = memberProfileOf(
			member({
				retold: { exampleDialogues: true },
				exampleDialogues: "<START>\nA: x\n<START>\nB: y"
			}),
			parent()
		)
		expect(r.own.exampleDialogues).toEqual(["A: x", "B: y"])
		expect(r.follows).not.toContain("exampleDialogues")
	})

	it("carded: own name and own nickname, one at a time; an empty own nickname is own", () => {
		const nameOnly = memberProfileOf(
			member({ ownName: " Bobby " }),
			parent()
		)
		expect(nameOnly.own.name).toBe("Bobby")
		expect(nameOnly.follows).not.toContain("name")
		expect(nameOnly.follows).toContain("nickname")

		const blankName = memberProfileOf(member({ ownName: "  " }), parent())
		expect(blankName.follows).toContain("name")

		const nick = memberProfileOf(member({ ownNickname: "B" }), parent())
		expect(nick.own.nickname).toBe("B")
		expect(nick.follows).not.toContain("nickname")
		expect(nick.follows).toContain("name")

		const none = memberProfileOf(member({ ownNickname: "" }), parent())
		expect(none.own.nickname).toBeNull()
		expect(none.follows).not.toContain("nickname")
	})

	it("carded: a retold face without a face id follows; with one it is own", () => {
		const without = memberProfileOf(
			member({ retold: { face: true }, faceMediaId: null }),
			parent()
		)
		expect(without.follows).toContain("faceMediaId")
		const withId = memberProfileOf(
			member({ retold: { face: true }, faceMediaId: 9 }),
			parent()
		)
		expect(withId.own.faceMediaId).toBe(9)
		expect(withId.follows).not.toContain("faceMediaId")
		const notRetold = memberProfileOf(member({ faceMediaId: 9 }), parent())
		expect(notRetold.follows).toContain("faceMediaId")
	})

	it("carded: an own timbre is own, normalised as the read does", () => {
		const r = memberProfileOf(member({ timbre: { voice: "v" } }), parent())
		expect(r.own.timbre).toEqual({ voice: "v" })
		expect(r.follows).not.toContain("timbre")
	})

	it("carded: both greetings retold → the member's list; the card's group-only ones are dropped", () => {
		const r = memberProfileOf(
			member({
				retold: { firstMessage: true, alternateGreetings: true },
				firstMessage: "Mine.",
				alternateGreetings: ["Mine too."]
			}),
			parent()
		)
		expect(r.own.greetings).toEqual([
			{ text: "Mine." },
			{ text: "Mine too." }
		])
		expect(r.follows).not.toContain("greetings")
		expect(r.mixedGreetings).toBe(false)
	})

	it("carded: only the opener retold → its opener + the card's other solo greetings", () => {
		const r = memberProfileOf(
			member({ retold: { firstMessage: true }, firstMessage: "Mine." }),
			parent()
		)
		expect(r.own.greetings).toEqual([
			{ text: "Mine." },
			{ text: "Hi." },
			{ text: "Hey." }
		])
		expect(r.follows).not.toContain("greetings")
		expect(r.mixedGreetings).toBe(true)
	})

	it("carded: only the alternates retold → the card's opener + the member's alternates", () => {
		const r = memberProfileOf(
			member({
				retold: { alternateGreetings: true },
				alternateGreetings: ["A1", "A2"]
			}),
			parent()
		)
		expect(r.own.greetings).toEqual([
			{ text: "Hello." },
			{ text: "A1" },
			{ text: "A2" }
		])
		expect(r.mixedGreetings).toBe(true)
	})
})

describe("memberProfileOf: post-history instructions, creator notes, likeness", () => {
	const NOTES = { text: "Mine.", variants: {} }
	const LIKE = { prompt: "tall, red coat" }
	const THREE = [
		"postHistoryInstructions",
		"creatorNotes",
		"likeness"
	] as const

	it("card-less: all three are own", () => {
		const { own, follows } = memberProfileOf(
			member({
				postHistoryInstructions: "Stay in voice.",
				creatorNotes: NOTES,
				likeness: LIKE
			}),
			null
		)
		expect(own.postHistoryInstructions).toBe("Stay in voice.")
		expect(own.creatorNotes).toEqual(NOTES)
		expect(own.likeness).toEqual(LIKE)
		expect(follows).toEqual([])
	})

	it("carded with the flags: own, whatever the value (?? null)", () => {
		const a = memberProfileOf(
			member({
				retold: {
					postHistoryInstructions: true,
					creatorNotes: true,
					likeness: true
				},
				postHistoryInstructions: "Stay in voice.",
				creatorNotes: NOTES,
				likeness: LIKE
			}),
			parent()
		)
		expect(a.own.postHistoryInstructions).toBe("Stay in voice.")
		expect(a.own.creatorNotes).toEqual(NOTES)
		expect(a.own.likeness).toEqual(LIKE)
		for (const f of THREE) expect(a.follows).not.toContain(f)
		const b = memberProfileOf(
			member({ retold: { postHistoryInstructions: true } }),
			parent()
		)
		expect(b.own.postHistoryInstructions).toBeNull()
	})

	it("carded without the flags follows them, keeping the same follows as a row without the keys", () => {
		const bare = memberProfileOf(member(), parent())
		const withValues = memberProfileOf(
			member({
				postHistoryInstructions: "Kept.",
				creatorNotes: NOTES,
				likeness: LIKE
			}),
			parent()
		)
		expect(withValues.follows).toEqual(bare.follows)
		for (const f of THREE) expect(bare.follows).toContain(f)
		expect(bare.follows).toEqual(
			expect.arrayContaining(["strokes", "extensions"])
		)
		expect(bare.own.postHistoryInstructions).toBeNull()
		expect(bare.follows.slice(-5)).toEqual([
			"postHistoryInstructions",
			"creatorNotes",
			"strokes",
			"likeness",
			"extensions"
		])
	})
})
