/**
 * `set-entry-marks` sets an entry's Off and Pin marks through the page's
 * `entries:setMarks`, resolving with both marks as they now stand; the
 * server's refusal (on its `:error` event) is this request's own rejection.
 */
import { describe, expect, test } from "vitest"
import { createPendingAsks } from "./pendingAsks"
import { answerSetEntryMarks, entryMarksReplyKey, entryMarksWrite, type EntryMarksWrite } from "./setEntryMarks"

type Response = Sockets.Entries.SetMarks.Response

function page() {
	const sent: Sockets.Entries.SetMarks.Params[] = []
	let hear: ((r: Response) => void) | null = null
	const asks = createPendingAsks<Sockets.Entries.SetMarks.Params, Response>({
		emit: (p) => sent.push(p),
		listen: (onReply) => {
			hear = onReply
			return () => (hear = null)
		},
		keyOf: entryMarksReplyKey,
		timeout: "no answer"
	})
	const write: EntryMarksWrite = entryMarksWrite(asks)
	return { sent, asks, write, hear: (r: Response) => hear?.(r) }
}

describe("answerSetEntryMarks", () => {
	test("sends only the marks asked for, and resolves with both as they now stand", async () => {
		const { sent, write, hear } = page()
		const pinned = answerSetEntryMarks({ entryId: 5, pinned: true }, write)
		expect(sent).toEqual([{ entryId: 5, pinned: true }])
		hear({ entryId: 5, off: false, pinned: true })
		await expect(pinned).resolves.toEqual({ off: false, pinned: true })

		const both = answerSetEntryMarks({ entryId: 5, off: true, pinned: false }, write)
		expect(sent.at(-1)).toEqual({ entryId: 5, off: true, pinned: false })
		hear({ entryId: 5, off: true, pinned: false })
		await expect(both).resolves.toEqual({ off: true, pinned: false })
	})

	test("the server's refusal is this request's rejection, and another entry's reply is not its answer", async () => {
		const { asks, write, hear } = page()
		const ask = answerSetEntryMarks({ entryId: 5, off: true }, write)
		hear({ entryId: 6, off: true, pinned: false })
		expect(asks.size).toBe(1)
		hear({ entryId: 5, error: "Entry not found or access denied." })
		await expect(ask).rejects.toThrow("Entry not found or access denied.")
	})

	test("two asks for one entry each take one reply, oldest first", async () => {
		const { write, hear } = page()
		const first = answerSetEntryMarks({ entryId: 5, off: true }, write)
		const second = answerSetEntryMarks({ entryId: 5, pinned: true }, write)
		hear({ entryId: 5, off: true, pinned: false })
		hear({ entryId: 5, off: true, pinned: true })
		await expect(first).resolves.toEqual({ off: true, pinned: false })
		await expect(second).resolves.toEqual({ off: true, pinned: true })
	})

	test("refuses, in words, before anything is sent", async () => {
		const { sent, write } = page()
		await expect(answerSetEntryMarks({ off: true }, write)).rejects.toThrow(/needs an entryId/)
		await expect(answerSetEntryMarks({ entryId: 5 }, write)).rejects.toThrow(/needs a mark to set/)
		await expect(answerSetEntryMarks({ entryId: 5, off: "yes" }, write)).rejects.toThrow(/'off' as true or false/)
		await expect(answerSetEntryMarks({ entryId: 5, pinned: 1 }, write)).rejects.toThrow(/'pinned' as true or false/)
		expect(sent).toEqual([])
	})
})
