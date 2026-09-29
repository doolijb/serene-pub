/**
 * The member form's draft: it remembers what it was built from, follows the
 * row only while clean, and both halves of a diff are one shape (#106).
 */
import { describe, expect, test } from "vitest"
import { changedFields } from "$lib/shared/lorebooks/amendments"
import {
	draftFollowsRow,
	memberDraftOf,
	memberPatch,
	sameMemberDraft
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
			name: "",
			aliases: []
		})
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
