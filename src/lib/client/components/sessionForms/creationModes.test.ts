import { describe, expect, test } from "vitest"
import { CREATION_MODE_WORDS, creationModeBlocker, followableSessions } from "./creationModes"

const row = (o: Record<string, unknown>) => ({ id: 1, isOwner: true, genreId: "g", lorebookId: 1, updatedAt: "2026-10-01T00:00:00Z", ...o }) as any

describe("followableSessions", () => {
	const rows = [
		row({ id: 1, updatedAt: "2026-10-01T00:00:00Z" }),
		row({ id: 2, updatedAt: "2026-10-03T00:00:00Z", lorebookId: null }),
		row({ id: 3, updatedAt: "2026-10-02T00:00:00Z" }),
		row({ id: 4, isOwner: false }),
		row({ id: 5, genreId: "other" }),
		row({ id: undefined })
	]
	test("branch: yours, of the genre, newest first", () => {
		expect(followableSessions(rows, { genreId: "g", mode: "branch" }).map((r) => r.id)).toEqual([2, 3, 1])
	})
	test("next chapter follows a session with no lorebook too: its world is its own book", () => {
		expect(followableSessions(rows, { genreId: "g", mode: "next-chapter" }).map((r) => r.id)).toEqual([2, 3, 1])
	})
})

describe("creationModeBlocker", () => {
	const base = { from: null, lorebookId: null, starterKit: null }
	test("each sentence", () => {
		expect(creationModeBlocker({ ...base, mode: "new-world" })).toBe("Choose the world to copy.")
		expect(creationModeBlocker({ ...base, mode: "branch" })).toBe("Choose the session to branch.")
		expect(creationModeBlocker({ ...base, mode: "next-chapter" })).toBe("Choose the session this one follows.")
	})
	test("null when satisfied", () => {
		expect(creationModeBlocker({ ...base, mode: "new" })).toBeNull()
		expect(creationModeBlocker({ ...base, mode: "new-world", lorebookId: 3 })).toBeNull()
		expect(creationModeBlocker({ ...base, mode: "new-world", starterKit: {} })).toBeNull()
		expect(creationModeBlocker({ ...base, mode: "branch", from: 9 })).toBeNull()
		expect(creationModeBlocker({ ...base, mode: "next-chapter", from: 9 })).toBeNull()
	})
})

test("CREATION_MODE_WORDS has the four keys", () => {
	expect(Object.keys(CREATION_MODE_WORDS).sort()).toEqual(["branch", "new", "new-world", "next-chapter"])
})
