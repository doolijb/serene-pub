/**
 * "Teach it" in the retrieval test sets a mark through `entries:setMarks`
 * (plan A14), as the session's lore widget does: one mark, never a whole
 * entry save, answered as the picked session reads the entry — and a mark a
 * dated amendment still decides there says so.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const handlers = new Map<string, (data: any) => void>()

vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (data: any) => void) => {
		handlers.set(key, handler)
		return () => handlers.delete(key)
	}
}))

import { markHeldLine, marksAsRead, teachButtons, teachMark } from "./teachMarks"

beforeEach(() => handlers.clear())

/** A socket that keeps what was sent. */
function sender() {
	const emits: { event: string; p: any }[] = []
	return { emits, socket: { emit: (event: string, p: unknown) => emits.push({ event, p }) } }
}

describe("teachMark", () => {
	test("sends the one mark, for the picked session, tokened, and settles only on the reply carrying its token", async () => {
		const { emits, socket } = sender()
		const done = teachMark(socket as any, { entryId: 4, sessionId: 12, mark: "off" })
		expect(emits).toEqual([
			{ event: "entries:setMarks", p: { entryId: 4, off: true, sessionId: 12, request: expect.any(String) } }
		])
		const request = emits[0]!.p.request
		// Another entry's reply is not this one's, nor is another tab's for this
		// entry: that one is as ITS session reads the entry.
		handlers.get("entries:setMarks")!({ entryId: 5, off: true, pinned: false, request: "elsewhere:1" })
		handlers.get("entries:setMarks")!({ entryId: 4, off: false, pinned: false, request: "elsewhere:2" })
		handlers.get("entries:setMarks")!({ entryId: 4, off: true, pinned: false, request })
		await expect(done).resolves.toEqual({ held: null, marks: { off: true, pinned: false } })
	})

	test("a mark an amendment still decides answers with the sentence that says so", async () => {
		const { emits, socket } = sender()
		const done = teachMark(socket as any, { entryId: 4, sessionId: 12, mark: "pinned" })
		handlers.get("entries:setMarks")!({
			entryId: 4,
			off: false,
			pinned: false,
			heldBy: { field: "constant", date: { year: 3, month: null, day: null }, label: "Year 3", amendmentId: 2 },
			request: emits[0]!.p.request
		})
		await expect(done).resolves.toEqual({
			held: "Saved to the entry, but an amendment dated Year 3 still decides whether it is pinned in this session. Edit or delete that amendment to change it from then on.",
			marks: { off: false, pinned: false }
		})
	})

	test("the server's refusal carrying this ask's token is the rejection", async () => {
		const { emits, socket } = sender()
		const done = teachMark(socket as any, { entryId: 4, sessionId: null, mark: "off" })
		handlers.get("entries:setMarks:error")!({ entryId: 5, error: "Not yours.", request: "elsewhere:1" })
		handlers.get("entries:setMarks:error")!({ entryId: 4, error: "Session not found.", request: "elsewhere:2" })
		handlers.get("entries:setMarks:error")!({
			entryId: 4,
			error: "Entry not found or access denied.",
			request: emits[0]!.p.request
		})
		await expect(done).rejects.toThrow("Entry not found or access denied.")
	})
})

describe("marksAsRead", () => {
	test("asks the session's reading of this one entry, tokened, and answers its marks", async () => {
		const { emits, socket } = sender()
		const done = marksAsRead(socket as any, { entryId: 4, sessionId: 12 })
		expect(emits).toEqual([
			{
				event: "entries:sessionEntries",
				p: { sessionId: 12, entryIds: [4], limit: 1, request: expect.any(String) }
			}
		])
		const request = emits[0]!.p.request
		// The lore widget's own read, or another tab's, is not this one.
		handlers.get("entries:sessionEntries")!({ sessionId: 12, rows: [], total: 0, request: "widget:1" })
		handlers.get("entries:sessionEntries")!({
			sessionId: 12,
			lorebookId: 3,
			rows: [{ id: 4, off: false, pinned: true }],
			total: 1,
			request
		})
		await expect(done).resolves.toEqual({ off: false, pinned: true })
	})

	test("an entry the session does not read, or a book that is not the asker's, has no marks there", async () => {
		const { emits, socket } = sender()
		const absent = marksAsRead(socket as any, { entryId: 4, sessionId: 12 })
		handlers.get("entries:sessionEntries")!({ sessionId: 12, lorebookId: 3, rows: [], total: 0, request: emits[0]!.p.request })
		await expect(absent).resolves.toBeNull()
		const theirs = marksAsRead(socket as any, { entryId: 4, sessionId: 12 })
		handlers.get("entries:sessionEntries")!({ sessionId: 12, lorebookId: 3, ownerOnly: true, rows: [], total: 0, request: emits[1]!.p.request })
		await expect(theirs).resolves.toBeNull()
	})

	test("the refusal carrying its token is the rejection", async () => {
		const { emits, socket } = sender()
		const done = marksAsRead(socket as any, { entryId: 4, sessionId: 12 })
		handlers.get("entries:sessionEntries:error")!({ sessionId: 12, request: "widget:1", error: "Nope." })
		handlers.get("entries:sessionEntries:error")!({ sessionId: 12, request: emits[0]!.p.request, error: "Session not found." })
		await expect(done).rejects.toThrow("Session not found.")
	})
})

describe("teachButtons", () => {
	test("follow the marks as the session reads the entry, never the base row's", () => {
		// Pinned there by an amendment, whatever the entry itself says.
		expect(teachButtons({ off: false, pinned: true })).toEqual({
			pin: { disabled: true, title: "Already pinned in this session" },
			off: { disabled: false, title: "Switch it off, so no turn reads it in" }
		})
		expect(teachButtons({ off: true, pinned: false })).toEqual({
			pin: { disabled: false, title: "Pin it, so every turn reads it in" },
			off: { disabled: true, title: "Already off in this session" }
		})
	})

	test("with the session's reading not known, neither is held back", () => {
		for (const unknown of [undefined, null])
			expect(teachButtons(unknown)).toEqual({
				pin: { disabled: false, title: "Pin it, so every turn reads it in" },
				off: { disabled: false, title: "Switch it off, so no turn reads it in" }
			})
	})
})

describe("markHeldLine", () => {
	test("names the mark and the date, and where", () => {
		expect(markHeldLine(undefined, null)).toBeNull()
		expect(
			markHeldLine(
				{ field: "enabled", date: { year: 3, month: 1, day: 2 }, label: "Year 3, Thaw 2", amendmentId: 1 },
				null
			)
		).toBe(
			"Saved to the entry, but an amendment dated Year 3, Thaw 2 still decides whether it is off on main. Edit or delete that amendment to change it from then on."
		)
	})
})
