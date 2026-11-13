import { describe, expect, test } from "vitest"
import type { CharacterRow } from "$lib/shared/characters/characterRows"
import {
	chipsOf,
	copyAsk,
	reachLine,
	rowDoor,
	rowGroups,
	rowLead
} from "./characterRowsView"

function row(over: Partial<CharacterRow> = {}): CharacterRow {
	return {
		rowKey: "card:1",
		hasCard: true,
		cardId: 1,
		castMemberId: null,
		cardIsMine: true,
		shownName: "Brix",
		nickname: null,
		summary: "A synthetic.",
		face: null,
		reach: { lorebookCount: 0, lorebook: null },
		hasOwnWords: false,
		isFavorite: false,
		isPersona: false,
		isDefaultPersona: false,
		embeddingModel: null,
		folderId: null,
		isSharedWithMe: false,
		ownerName: null,
		readableMember: null,
		tags: [],
		...over
	}
}
const member = (over: Partial<CharacterRow> = {}) =>
	row({
		rowKey: "member:9",
		hasCard: false,
		cardId: null,
		castMemberId: 9,
		cardIsMine: false,
		reach: {
			lorebookCount: 1,
			lorebook: {
				id: 4,
				name: "Vale",
				sessionId: null,
				sessionName: null
			}
		},
		...over
	})
const shared = (over: Partial<CharacterRow> = {}) =>
	row({ cardIsMine: false, isSharedWithMe: true, ownerName: "Ana", ...over })
const other = (over: Partial<CharacterRow> = {}) =>
	row({ cardIsMine: false, ...over })

describe("reachLine", () => {
	test("none", () => {
		expect(reachLine(row())).toBe("Not in a lorebook yet")
	})
	test("one book", () => {
		expect(reachLine(member())).toBe("In Vale")
	})
	test("one session's notes", () => {
		const r = member({
			reach: {
				lorebookCount: 1,
				lorebook: {
					id: 4,
					name: "x",
					sessionId: 2,
					sessionName: "Crawl 4b"
				}
			}
		})
		expect(reachLine(r)).toBe("In Crawl 4b's notes")
	})
	test("a session's notes with no session name", () => {
		const r = member({
			reach: {
				lorebookCount: 1,
				lorebook: { id: 4, name: "x", sessionId: 2, sessionName: null }
			}
		})
		expect(reachLine(r)).toBe("In a session's notes")
	})
	test("one with the lorebook missing", () => {
		expect(
			reachLine(row({ reach: { lorebookCount: 1, lorebook: null } }))
		).toBe("In 1 lorebook")
	})
	test("many", () => {
		expect(
			reachLine(row({ reach: { lorebookCount: 3, lorebook: null } }))
		).toBe("In 3 lorebooks")
	})
})

describe("rowLead", () => {
	test("summary, or who shared it", () => {
		expect(rowLead(row())).toBe("A synthetic.")
		expect(rowLead(shared())).toBe("From Ana")
		expect(rowLead(shared({ ownerName: null }))).toBe("Shared with you")
	})
})

describe("rowDoor", () => {
	const rm = { castMemberId: 5, lorebookId: 6 }
	test("own and shared cards open as cards", () => {
		expect(rowDoor(row())).toEqual({ kind: "card", cardId: 1 })
		expect(rowDoor(shared())).toEqual({ kind: "card", cardId: 1 })
	})
	test("another's card opens its readable member, or nothing", () => {
		expect(rowDoor(other({ readableMember: rm }))).toEqual({
			kind: "member",
			lorebookId: 6,
			castId: 5
		})
		expect(rowDoor(other())).toBeNull()
	})
	test("a member's row opens its member", () => {
		expect(rowDoor(member())).toEqual({
			kind: "member",
			lorebookId: 4,
			castId: 9
		})
		expect(
			rowDoor(member({ reach: { lorebookCount: 0, lorebook: null } }))
		).toBeNull()
	})
})

describe("copyAsk", () => {
	test("each kind of row", () => {
		expect(copyAsk(row())).toBeNull()
		expect(copyAsk(shared())).toEqual({ characterId: 1 })
		expect(
			copyAsk(
				other({ readableMember: { castMemberId: 5, lorebookId: 6 } })
			)
		).toEqual({ castMemberId: 5 })
		expect(copyAsk(other())).toBeNull()
		expect(copyAsk(member())).toEqual({ castMemberId: 9 })
	})
})

describe("rowGroups", () => {
	const folders = [
		{ id: 2, name: "B" },
		{ id: 1, name: "A" },
		{ id: 3, name: "Empty" }
	]
	test("places rows and keeps order", () => {
		const rows = [
			row({ rowKey: "a", folderId: 1 }),
			row({ rowKey: "b", folderId: 2 }),
			row({ rowKey: "c" }),
			member({ rowKey: "d" }),
			shared({ rowKey: "e" }),
			row({ rowKey: "f", folderId: 1 }),
			row({ rowKey: "g", folderId: 99 }),
			other({ rowKey: "h" })
		]
		const g = rowGroups(rows, folders)
		const keys = (rs: CharacterRow[]) => rs.map((r) => r.rowKey)
		expect(g.folders.map((f) => f.folder.id)).toEqual([2, 1])
		expect(keys(g.folders[0].rows)).toEqual(["b"])
		expect(keys(g.folders[1].rows)).toEqual(["a", "f"])
		expect(keys(g.ungrouped)).toEqual(["c", "g"])
		expect(keys(g.onlyInLorebooks)).toEqual(["d", "h"])
		expect(keys(g.shared)).toEqual(["e"])
	})
})

describe("chipsOf", () => {
	test("Card then tags", () => {
		expect(chipsOf(row())).toEqual({ first: "Card", rest: [] })
		const tags = [
			{ name: "x", colorPreset: null },
			{ name: "y", colorPreset: null }
		]
		expect(chipsOf(row({ tags }))).toEqual({
			first: "Card",
			rest: ["x", "y"]
		})
	})
	test("a member's row has none", () => {
		expect(chipsOf(member())).toEqual({ first: null, rest: [] })
	})
})
