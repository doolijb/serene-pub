/**
 * The cast board's writes: an amendment names its line and waits for its own
 * row (#105), a masked base save says which amendment wins (#113), the delete
 * dialog asks about private lore (ruling 4, #6, #108), and an undo says what
 * it could not put back.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const handlers = new Map<string, (data: any) => void>()

vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (data: any) => void) => {
		handlers.set(key, handler)
		return () => handlers.delete(key)
	}
}))

import {
	castAmendmentParams,
	castMaskedWarning,
	deleteMemberCopy,
	deletedMemberToast,
	fileCastAmendment,
	isOurCastAmendment,
	undoMergeToast
} from "./castSave"

const target = { lorebookId: 4, castId: 9, branchId: 7 }

function list(
	cast: Array<Partial<Sockets.Amendments.CastRow> & { id: number }>,
	lorebookId = 4
): Sockets.Amendments.List.Response {
	return {
		lorebookId,
		entries: [],
		cast: cast.map((c) => ({
			castId: 9,
			lorebookId,
			branchId: 7,
			personalPosition: null,
			year: 3,
			month: null,
			day: null,
			fields: {},
			historyEntryId: null,
			createdAt: "",
			updatedAt: "",
			...c
		})),
		presences: [],
		branches: []
	}
}

beforeEach(() => handlers.clear())

describe("castAmendmentParams — a cast amendment names its line (#105)", () => {
	test("carries the branch being read, and main as null", () => {
		expect(
			castAmendmentParams(target, { year: 3, fields: { nodeState: "missing" } })
		).toEqual({
			lorebookId: 4,
			castId: 9,
			branchId: 7,
			year: 3,
			month: null,
			day: null,
			fields: { nodeState: "missing" }
		})
		expect(
			castAmendmentParams(
				{ ...target, branchId: null },
				{ year: 3, fields: {} }
			).branchId
		).toBeNull()
	})
})

describe("isOurCastAmendment", () => {
	const params = castAmendmentParams(target, {
		year: 3,
		fields: { nodeState: "missing" }
	})

	test("a new row for this member, line, date and fields is ours", () => {
		expect(
			isOurCastAmendment(
				list([{ id: 2, fields: { nodeState: "missing" } }]),
				params,
				new Set([1])
			)
		).toBe(true)
	})

	test("a row already seen, or on another line, is not", () => {
		const row = { id: 2, fields: { nodeState: "missing" } }
		expect(isOurCastAmendment(list([row]), params, new Set([2]))).toBe(false)
		expect(
			isOurCastAmendment(
				list([{ ...row, branchId: null }]),
				params,
				new Set()
			)
		).toBe(false)
	})

	test("another book's list is not", () => {
		expect(
			isOurCastAmendment(
				list([{ id: 2, fields: { nodeState: "missing" } }], 5),
				params,
				new Set()
			)
		).toBe(false)
	})
})

describe("fileCastAmendment", () => {
	test("emits on the line being read and waits for its own row", async () => {
		const emits: any[] = []
		const socket = { emit: (event: string, p: any) => emits.push({ event, p }) }
		const done = fileCastAmendment(
			socket as any,
			target,
			{ year: 3, fields: { characterId: null } },
			[1]
		)
		expect(emits).toHaveLength(1)
		expect(emits[0].event).toBe("amendments:create")
		expect(emits[0].p).toMatchObject({ castId: 9, branchId: 7 })
		// Somebody else's write: keep waiting.
		handlers.get("amendments:list#4")!(list([{ id: 1 }]))
		handlers.get("amendments:list#4")!(
			list([{ id: 1 }, { id: 2, fields: { characterId: null } }])
		)
		const reply = await done
		expect(reply.cast.map((c) => c.id)).toEqual([1, 2])
	})

	test("a refusal rejects with the server's sentence", async () => {
		const done = fileCastAmendment(
			{ emit: () => {} } as any,
			target,
			{ year: 3, fields: {} },
			[]
		)
		handlers.get("amendments:create:error")!({ error: "Not in this book." })
		await expect(done).rejects.toThrow("Not in this book.")
	})
})

describe("castMaskedWarning — a base save an amendment still overrides (#113)", () => {
	test("names the field and the amendment's date", () => {
		const w = castMaskedWarning([
			{ field: "nodeState", amendment: { year: 20, month: null, day: null } },
			{ field: "summary", amendment: { year: 20, month: null, day: null } }
		])
		expect(w?.title).toMatch(/amendment still wins/)
		expect(w?.description).toMatch(/still sets the state and the summary/)
		expect(w?.description).toMatch(/20/)
	})

	test("nothing masked is no warning", () => {
		expect(castMaskedWarning([])).toBeNull()
	})
})

describe("deleteMemberCopy — ruling 4: the dialog asks", () => {
	const check = (open: number, archived = 0, referenced = false) => ({
		lorebookId: 9,
		nodeId: 1,
		referencedByMergeLog: referenced,
		privateLoreCount: open,
		archivedPrivateLoreCount: archived
	})

	test("never claims their lore is deleted by the plain delete (#108)", () => {
		const copy = deleteMemberCopy({
			name: "Maren",
			linked: true,
			relationshipCount: 2,
			check: check(0)
		})
		expect(copy.message).not.toMatch(/\blore\b/)
		expect(copy.message).toMatch(/all 2 relationships/)
		// A16: their tags become their name.
		expect(copy.message).toMatch(/their name stays as plain text/)
		expect(copy.message).toMatch(/character card is not touched/)
		expect(copy.lore).toBeNull()
	})

	test("private lore makes it a question, with the counts and the disclosure", () => {
		const copy = deleteMemberCopy({
			name: "Maren",
			linked: false,
			relationshipCount: 0,
			check: check(3, 1)
		})
		expect(copy.lore?.lead).toBe(
			"Maren has 3 lore entries private to them, and 1 archived."
		)
		expect(copy.lore?.keepDetail).toMatch(/unassigned, and the narrator can see/)
		expect(copy.lore?.removeDetail).toMatch(/all 4 entries, the archived ones/)
	})

	test("archived-only lore is still asked about", () => {
		const copy = deleteMemberCopy({
			name: "Maren",
			linked: false,
			relationshipCount: 0,
			check: check(0, 2)
		})
		expect(copy.lore?.lead).toBe(
			"Maren has 2 archived lore entries private to them."
		)
	})

	test("no question until the counts are in", () => {
		expect(
			deleteMemberCopy({
				name: "Maren",
				linked: false,
				relationshipCount: 0,
				check: null
			}).lore
		).toBeNull()
	})

	test("a merge record naming them is said", () => {
		expect(
			deleteMemberCopy({
				name: "Maren",
				linked: false,
				relationshipCount: 0,
				check: check(0, 0, true)
			}).mergeWarning
		).toMatch(/undo/)
	})

	test("the done toast counts the lore that went", () => {
		expect(deletedMemberToast("Maren", 0)).toBe("Maren deleted")
		expect(deletedMemberToast("Maren", 1)).toBe(
			"Maren deleted, with 1 lore entry"
		)
	})
})

describe("undoMergeToast — what an undo could not put back", () => {
	const restoredNode = { name: "Maren" } as any

	test("a whole undo is a success", () => {
		const t = undoMergeToast({
			restoredNode,
			unrestoredLinkCount: 0,
			unrestoredMovedLinkCount: 0,
			unrestoredStoryCount: 0,
			unrestoredTextCount: 0
		})
		expect(t.kind).toBe("success")
		expect(t.description).toBe('"Maren" restored.')
	})

	test("a partial undo is a warning that names both counts", () => {
		const t = undoMergeToast({
			restoredNode,
			unrestoredLinkCount: 2,
			unrestoredMovedLinkCount: 0,
			unrestoredStoryCount: 1,
			unrestoredTextCount: 0
		})
		expect(t.kind).toBe("warning")
		expect(t.description).toMatch(/2 relationships could not be put back/)
		expect(t.description).toMatch(
			/1 dated change, placement, stat or stat sheet of theirs could not be put back: the line, session or sheet it belonged to has been deleted since/
		)
	})

	test("a moved link that could not go back says it stays with the member kept", () => {
		const one = undoMergeToast({
			restoredNode,
			unrestoredLinkCount: 1,
			unrestoredMovedLinkCount: 1,
			unrestoredStoryCount: 0,
			unrestoredTextCount: 0
		})
		expect(one.kind).toBe("warning")
		expect(one.description).toBe(
			'"Maren" restored. 1 relationship could not be put back: one end, or the line it was on, has been deleted since, or a relationship made since already says the same. It is still on the member "Maren" was merged into.'
		)
		const some = undoMergeToast({
			restoredNode,
			unrestoredLinkCount: 3,
			unrestoredMovedLinkCount: 2,
			unrestoredStoryCount: 0,
			unrestoredTextCount: 0
		})
		expect(some.description).toMatch(
			/3 relationships could not be put back: .*\. 2 of them are still on the member "Maren" was merged into\.$/
		)
		const deleted = undoMergeToast({
			restoredNode,
			unrestoredLinkCount: 2,
			unrestoredMovedLinkCount: 0,
			unrestoredStoryCount: 0,
			unrestoredTextCount: 0
		})
		expect(deleted.description).not.toMatch(/still on the member/)
	})

	test("lore edited since the merge keeps the survivor's tag, and says so (A16)", () => {
		const t = undoMergeToast({
			restoredNode,
			unrestoredLinkCount: 0,
			unrestoredMovedLinkCount: 0,
			unrestoredStoryCount: 0,
			unrestoredTextCount: 2
		})
		expect(t.kind).toBe("warning")
		expect(t.description).toMatch(
			/2 pieces of lore edited since the merge still name the member they were merged into/
		)
	})
})
