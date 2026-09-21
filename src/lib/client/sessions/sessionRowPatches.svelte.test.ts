/**
 * The session-row patch store — what `sessions:rowChanged` is allowed to do to
 * a list row.
 *
 * Three rules, and every one of them is a card that lies if it breaks:
 *
 *   1. **A push replaces, it does not merge.** Each one carries the row's whole
 *      state as of the read behind it, so the newest is the answer.
 *   2. **`lastMessage: null` CLEARS the quote.** Deleting or hiding the last
 *      visible message is the case this whole field shape exists for: the row
 *      has to come back looking like a session with nothing to show — the field
 *      absent, as `sessions:list` sends it — rather than keeping the deleted
 *      line on screen.
 *   3. **An unheard-of row is the same object back.** The store is layered over
 *      every row of a list that is mostly unmoved, so patching must not churn
 *      identities the `{#each}` keys and the derivations depend on.
 */
import { beforeEach, describe, expect, test } from "vitest"
import {
	applyRowChanged,
	clearRowPatches,
	patchedRow,
	sessionRowPatches
} from "./sessionRowPatches.svelte"

const line = (excerpt: string) => ({
	excerpt,
	speakerName: "Wren",
	isUser: false,
	createdAt: "2026-09-16T12:00:00.000Z"
})

const row = (extra: Record<string, unknown> = {}) =>
	({
		id: 7,
		name: "The Lantern Road",
		updatedAt: "2026-09-15",
		messageCount: 2,
		lastMessage: line("Somewhere down the right-hand road."),
		canEdit: true,
		isOwner: true,
		isGuest: false,
		...extra
	}) as any

beforeEach(() => clearRowPatches())

describe("sessionRowPatches", () => {
	test("a push replaces the row's count, quote and stamp", () => {
		applyRowChanged({
			sessionId: 7,
			messageCount: 3,
			lastMessage: line("And then the bell rang."),
			updatedAt: "2026-09-16"
		})
		const patched = patchedRow(row())
		expect(patched.messageCount).toBe(3)
		expect(patched.lastMessage!.excerpt).toBe("And then the bell rang.")
		expect(patched.updatedAt).toBe("2026-09-16")
		// The rest of the row is untouched — the push says nothing about it.
		expect(patched.name).toBe("The Lantern Road")
		expect(patched.isOwner).toBe(true)
	})

	test("the newest push wins outright, never merged into the one before", () => {
		applyRowChanged({
			sessionId: 7,
			messageCount: 3,
			lastMessage: line("And then the bell rang."),
			updatedAt: "2026-09-16"
		})
		applyRowChanged({
			sessionId: 7,
			messageCount: 4,
			lastMessage: line("Nobody answered it."),
			updatedAt: "2026-09-16"
		})
		const patched = patchedRow(row())
		expect(patched.messageCount).toBe(4)
		expect(patched.lastMessage!.excerpt).toBe("Nobody answered it.")
		expect(sessionRowPatches.size).toBe(1)
	})

	test("`lastMessage: null` removes the quote, as an empty session has none", () => {
		applyRowChanged({
			sessionId: 7,
			messageCount: 0,
			lastMessage: null,
			updatedAt: "2026-09-16"
		})
		const patched = patchedRow(row())
		expect(patched.lastMessage).toBeUndefined()
		// Absent, not present-and-null: every consumer reads `lastMessage ?`
		// as "has a line", and the list omits the field for the same reason.
		expect("lastMessage" in patched).toBe(false)
		expect(patched.messageCount).toBe(0)
	})

	test("a row nothing has been heard about comes back as the same object", () => {
		const original = row()
		expect(patchedRow(original)).toBe(original)

		// Another session's push is not this row's.
		applyRowChanged({
			sessionId: 8,
			messageCount: 9,
			lastMessage: null,
			updatedAt: "2026-09-16"
		})
		expect(patchedRow(original)).toBe(original)
	})

	test("a row with no id is left alone, and a malformed push is ignored", () => {
		const anonymous = row({ id: undefined })
		expect(patchedRow(anonymous)).toBe(anonymous)

		applyRowChanged(undefined)
		applyRowChanged(null)
		applyRowChanged({ messageCount: 1 } as any)
		expect(sessionRowPatches.size).toBe(0)
	})

	test("a fresh list clears every push it supersedes", () => {
		applyRowChanged({
			sessionId: 7,
			messageCount: 3,
			lastMessage: line("And then the bell rang."),
			updatedAt: "2026-09-16"
		})
		clearRowPatches()
		expect(sessionRowPatches.size).toBe(0)
		const original = row()
		expect(patchedRow(original)).toBe(original)
	})
})
