/**
 * The member form's draft: it remembers what it was built from, follows the
 * row only while clean, and both halves of a diff are one shape (#106).
 */
import { describe, expect, test } from "vitest"
import { changedFields } from "$lib/shared/lorebooks/amendments"
import {
	draftFollowsRow,
	emptyOwnTimbre,
	memberDraftOf,
	memberPatch,
	sameMemberDraft,
	type MemberRow
} from "./memberDraft"
import type { CastRow } from "../castPool"

const atY10: CastRow = {
	id: 3,
	name: "Maren",
	aliases: ["the innkeeper"],
	summary: "Keeps the Gull.",
	nodeState: "active",
	nodeVisibility: "normal",
	spriteSet: null
}
/** The same member read at a later moment: an amendment moved her state. */
const atY20: CastRow = { ...atY10, nodeState: "deceased" }

describe("memberDraftOf / memberPatch", () => {
	test("normalises the row the way the form writes it", () => {
		const draft = memberDraftOf({ id: 1, nodeState: null, summary: null })
		expect(draft.nodeState).toBe("active")
		expect(draft.nodeVisibility).toBe("normal")
		expect(memberPatch(draft, false)).toEqual({
			summary: null,
			nodeState: "active",
			nodeVisibility: "normal",
			spriteSet: null,
			timbre: null,
			postHistoryInstructions: null,
			creatorNotes: null,
			likeness: null,
			name: "",
			aliases: [],
			description: null,
			personality: null,
			scenario: null,
			firstMessage: null,
			alternateGreetings: [],
			groupOnlyGreetings: [],
			exampleDialogues: null
		})
	})

	const owned: MemberRow = {
		...atY10,
		postHistoryInstructions: "Keep it short.",
		creatorNotes: {
			text: "Notes.",
			lang: "en",
			variants: { fr: "Notes (fr)." }
		},
		likeness: { imageMediaId: 9, prompt: "red coat" }
	}

	test("post-history instructions, creator notes and likeness round-trip, variants kept", () => {
		const patch = memberPatch(memberDraftOf(owned), true)
		expect(patch.postHistoryInstructions).toBe("Keep it short.")
		expect(patch.creatorNotes).toEqual({
			text: "Notes.",
			lang: "en",
			variants: { fr: "Notes (fr)." }
		})
		expect(patch.likeness).toEqual({ imageMediaId: 9, prompt: "red coat" })
	})

	test("a draft with the flag off still sends its kept value", () => {
		const draft = memberDraftOf({
			...owned,
			retold: { postHistoryInstructions: false }
		})
		const patch = memberPatch(draft, true)
		expect(patch.postHistoryInstructions).toBe("Keep it short.")
		expect(patch.retold).toEqual({})
		const on = memberDraftOf({
			...owned,
			retold: { postHistoryInstructions: true, likeness: true }
		})
		expect(memberPatch(on, true).retold).toEqual({
			postHistoryInstructions: true,
			likeness: true
		})
	})

	test("no change, no patch; an edit to one of them is a change", () => {
		const pristine = memberDraftOf(owned)
		expect(sameMemberDraft(memberDraftOf(owned), pristine, true)).toBe(true)
		expect(
			sameMemberDraft(
				{
					...pristine,
					likeness: { ...pristine.likeness, negative: "hat" }
				},
				pristine,
				true
			)
		).toBe(false)
	})

	test("a card-less member's patch carries their own three too", () => {
		const patch = memberPatch(memberDraftOf(owned), false)
		expect(patch.postHistoryInstructions).toBe("Keep it short.")
		expect(patch).not.toHaveProperty("retold")
	})

	test("a carded member's patch carries their aliases but not the card's name (#114)", () => {
		const patch = memberPatch(memberDraftOf(atY10), true)
		expect(patch).not.toHaveProperty("name")
		expect(patch.aliases).toEqual(["the innkeeper"])
	})

	test("an alias added to a carded member makes the draft dirty", () => {
		const pristine = memberDraftOf(atY10)
		const draft = { ...pristine, aliases: [...pristine.aliases, "Mar"] }
		expect(sameMemberDraft(draft, pristine, true)).toBe(false)
	})
})

describe("draftFollowsRow — the draft follows the moment while clean", () => {
	test("a clean draft re-reads a row that moved", () => {
		const pristine = memberDraftOf(atY10)
		expect(
			draftFollowsRow({
				draft: { ...pristine },
				pristine,
				row: atY20,
				linked: false
			})
		).toBe(true)
	})

	test("a dirty draft is left alone", () => {
		const pristine = memberDraftOf(atY10)
		expect(
			draftFollowsRow({
				draft: { ...pristine, summary: "Typed" },
				pristine,
				row: atY20,
				linked: false
			})
		).toBe(false)
	})

	test("a row that did not move is no reason to re-seed", () => {
		const pristine = memberDraftOf(atY10)
		expect(
			draftFollowsRow({
				draft: { ...pristine },
				pristine,
				row: { ...atY10 },
				linked: false
			})
		).toBe(false)
	})
})

describe("the diff is against the draft as BUILT, not the row as it reads now", () => {
	test("a dirty draft left behind by a moment move writes only what was typed", () => {
		// Built at Y10, summary edited, then the moment moved to Y20 where an
		// amendment says deceased. Diffing against the Y20 row would write
		// `nodeState: "active"` — a value the author never touched.
		const pristine = memberDraftOf(atY10)
		const draft = { ...pristine, summary: "Left the Gull." }
		const fields = changedFields(
			memberPatch(draft, false),
			memberPatch(pristine, false)
		)
		expect(fields).toEqual({ summary: "Left the Gull." })
		const againstRow = changedFields(
			memberPatch(draft, false),
			memberPatch(memberDraftOf(atY20), false)
		)
		expect(againstRow).toHaveProperty("nodeState", "active")
	})

	test("sameMemberDraft ignores whitespace the patch trims", () => {
		const a = memberDraftOf(atY10)
		expect(sameMemberDraft(a, { ...a, summary: "Keeps the Gull.  " }, false)).toBe(
			true
		)
	})
})

describe("retold fields — the member's own words for the card's (PLAN cast-retold-fields)", () => {
	const carded: CastRow = {
		...atY10,
		characterId: 9,
		description: "A tired innkeeper.",
		alternateGreetings: ["Rooms are two silver."],
		retold: { description: true }
	}

	test("the draft reads the member's columns and flags", () => {
		const draft = memberDraftOf(carded)
		expect(draft.description).toBe("A tired innkeeper.")
		expect(draft.personality).toBe("")
		expect(draft.alternateGreetings).toEqual(["Rooms are two silver."])
		expect(draft.faceMediaId).toBeNull()
		expect(draft.retold).toEqual({ description: true })
	})

	test("a card-less member's patch carries its own words, empty text as null, and no retold fields", () => {
		const draft = {
			...memberDraftOf({ ...carded, characterId: null }),
			alternateGreetings: ["Rooms are two silver.", ""],
			groupOnlyGreetings: ["Welcome, all of you."]
		}
		const patch = memberPatch(draft, false)
		expect(patch).toMatchObject({
			description: "A tired innkeeper.",
			personality: null,
			scenario: null,
			firstMessage: null,
			alternateGreetings: ["Rooms are two silver.", ""],
			groupOnlyGreetings: ["Welcome, all of you."],
			exampleDialogues: null
		})
		for (const key of ["retold", "faceMediaId", "ownName", "ownNickname"])
			expect(patch).not.toHaveProperty(key)
	})

	test("a card-less draft is dirty when its description or a greeting changed, and the patch differs only there", () => {
		const pristine = memberDraftOf({ ...carded, characterId: null })
		expect(sameMemberDraft({ ...pristine }, pristine, false)).toBe(true)

		const described = { ...pristine, description: "A rested innkeeper." }
		expect(sameMemberDraft(described, pristine, false)).toBe(false)
		expect(
			changedFields(
				memberPatch(described, false),
				memberPatch(pristine, false)
			)
		).toEqual({ description: "A rested innkeeper." })

		const greeted = {
			...pristine,
			alternateGreetings: [...pristine.alternateGreetings, ""]
		}
		expect(sameMemberDraft(greeted, pristine, false)).toBe(false)
		expect(
			changedFields(
				memberPatch(greeted, false),
				memberPatch(pristine, false)
			)
		).toEqual({ alternateGreetings: ["Rooms are two silver.", ""] })
	})

	test("a carded member's patch keys and their order are unchanged", () => {
		expect(Object.keys(memberPatch(memberDraftOf(carded), true))).toEqual([
			"summary",
			"nodeState",
			"nodeVisibility",
			"spriteSet",
			"aliases",
			"timbre",
			"postHistoryInstructions",
			"creatorNotes",
			"likeness",
			"ownName",
			"ownNickname",
			"description",
			"personality",
			"scenario",
			"firstMessage",
			"alternateGreetings",
			"groupOnlyGreetings",
			"exampleDialogues",
			"faceMediaId",
			"retold"
		])
	})

	test("a carded member's patch carries every retold field, empty text as null", () => {
		const patch = memberPatch(memberDraftOf(carded), true)
		expect(patch).toMatchObject({
			description: "A tired innkeeper.",
			personality: null,
			scenario: null,
			firstMessage: null,
			alternateGreetings: ["Rooms are two silver."],
			exampleDialogues: null,
			faceMediaId: null,
			retold: { description: true }
		})
	})

	test("switching a field off keeps the member's text in the patch", () => {
		const pristine = memberDraftOf(carded)
		const draft = { ...pristine, retold: { description: false } }
		const fields = changedFields(
			memberPatch(draft, true),
			memberPatch(pristine, true)
		)
		expect(fields).toEqual({ retold: {} })
	})

	test("false and absent flags are one shape", () => {
		const a = memberDraftOf({ ...carded, retold: { face: false } })
		const b = memberDraftOf({ ...carded, retold: {} })
		expect(sameMemberDraft(a, b, true)).toBe(true)
	})

	test("an empty greeting is kept as typed (a swipe), and an untouched draft is clean", () => {
		const pristine = memberDraftOf(carded)
		expect(sameMemberDraft({ ...pristine }, pristine, true)).toBe(true)
		const draft = {
			...pristine,
			alternateGreetings: [...pristine.alternateGreetings, ""]
		}
		expect(sameMemberDraft(draft, pristine, true)).toBe(false)
		expect(memberPatch(draft, true).alternateGreetings).toEqual([
			...pristine.alternateGreetings,
			""
		])
	})

	test("a clean draft follows a row whose retold text moved", () => {
		const pristine = memberDraftOf(carded)
		expect(
			draftFollowsRow({
				draft: { ...pristine },
				pristine,
				row: { ...carded, description: "Older now." },
				linked: true
			})
		).toBe(true)
	})

	test("a face picked makes the draft dirty and writes the face and the flag", () => {
		const pristine = memberDraftOf(carded)
		const draft = {
			...pristine,
			faceMediaId: 41,
			retold: { ...pristine.retold, face: true }
		}
		expect(
			changedFields(memberPatch(draft, true), memberPatch(pristine, true))
		).toEqual({ faceMediaId: 41, retold: { description: true, face: true } })
	})
})

describe("own names in the draft (§0-D)", () => {
	const linkedRow: CastRow = {
		id: 1,
		characterId: 10,
		character: { name: "Verity", nickname: "Vee" }
	}

	test("a row lacking the fields reads as Use from card on (null)", () => {
		const d = memberDraftOf(linkedRow)
		expect(d.ownName).toBeNull()
		expect(d.ownNickname).toBeNull()
	})

	test("a stored empty nickname reads as off and blank; a null reads as on", () => {
		expect(
			memberDraftOf({ ...linkedRow, ownNickname: "" }).ownNickname
		).toBe("")
		expect(
			memberDraftOf({ ...linkedRow, ownNickname: null }).ownNickname
		).toBeNull()
		expect(memberDraftOf({ ...linkedRow, ownName: "" }).ownName).toBeNull()
	})

	test("on patches null; off and blank nickname patches an empty string", () => {
		const d = memberDraftOf(linkedRow)
		expect(memberPatch(d, true).ownName).toBeNull()
		expect(memberPatch(d, true).ownNickname).toBeNull()
		expect(memberPatch({ ...d, ownNickname: "" }, true).ownNickname).toBe(
			""
		)
		expect(memberPatch({ ...d, ownNickname: "  " }, true).ownNickname).toBe(
			""
		)
	})

	test("sameMemberDraft tells a null nickname from an empty one", () => {
		const d = memberDraftOf(linkedRow)
		expect(sameMemberDraft(d, { ...d, ownNickname: "" }, true)).toBe(false)
		expect(sameMemberDraft(d, { ...d, ownNickname: null }, true)).toBe(true)
	})

	test("a linked patch carries them; null stays null, text is trimmed", () => {
		const d = memberDraftOf({ ...linkedRow, ownName: "Veritas" })
		expect(memberPatch(d, true).ownName).toBe("Veritas")
		expect(memberPatch(d, true).ownNickname).toBeNull()
		expect(memberPatch({ ...d, ownName: "  " }, true).ownName).toBe("")
		expect(memberPatch({ ...d, ownName: " Ash " }, true).ownName).toBe("Ash")
	})

	test("a background patch has no own fields", () => {
		const d = memberDraftOf({ id: 2, name: "Tam" })
		const patch = memberPatch(d, false)
		expect("ownName" in patch).toBe(false)
		expect("ownNickname" in patch).toBe(false)
	})
})

describe("the member's own voice", () => {
	const voiced: MemberRow = {
		id: 4,
		name: "Tam",
		timbre: { description: "a low alto", language: "en" }
	}

	test("no stored timbre reads as null; a stored one as a draft", () => {
		expect(memberDraftOf({ id: 4 }).timbre).toBeNull()
		expect(memberDraftOf(voiced).timbre?.description).toBe("a low alto")
	})

	test("the patch carries it; null is the card's", () => {
		expect(memberPatch(memberDraftOf({ id: 4 }), false).timbre).toBeNull()
		expect(memberPatch(memberDraftOf(voiced), false).timbre).toEqual({
			description: "a low alto",
			language: "en"
		})
	})

	test("an own voice with nothing in it writes null", () => {
		const d = { ...memberDraftOf({ id: 4 }), timbre: emptyOwnTimbre() }
		expect(memberPatch(d, false).timbre).toBeNull()
		expect(sameMemberDraft(d, memberDraftOf({ id: 4 }), false)).toBe(true)
	})

	test("a changed voice is a different draft; changed back is the same", () => {
		const d = memberDraftOf(voiced)
		const typed = { ...d, timbre: { ...d.timbre!, description: "a bass" } }
		expect(sameMemberDraft(d, typed, false)).toBe(false)
		expect(sameMemberDraft(d, memberDraftOf(voiced), false)).toBe(true)
		expect(sameMemberDraft(d, { ...d, timbre: null }, false)).toBe(false)
	})
})
