/**
 * `set-entry-marks` sets an entry's Off and Pin marks through the page's
 * `entries:setMarks`, resolving with both marks as they now stand; the
 * server's refusal (on its `:error` event) is this request's own rejection.
 * Each ask is tokened, and only the answer carrying its token settles it.
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
	const write: EntryMarksWrite = entryMarksWrite(asks, "page")
	/** The server's answer to the newest ask: it echoes that ask's token. */
	const answer = (r: Response) => hear?.({ ...r, request: sent.at(-1)?.request })
	return { sent, asks, write, hear: (r: Response) => hear?.(r), answer }
}

describe("answerSetEntryMarks", () => {
	test("sends only the marks asked for, and resolves with both as they now stand", async () => {
		const { sent, write, answer } = page()
		const pinned = answerSetEntryMarks({ entryId: 5, pinned: true }, 12, write)
		// The page's own session: the server answers as that session reads the entry.
		expect(sent).toEqual([{ entryId: 5, pinned: true, sessionId: 12, request: "page:1" }])
		answer({ entryId: 5, off: false, pinned: true })
		await expect(pinned).resolves.toEqual({ off: false, pinned: true })

		const both = answerSetEntryMarks({ entryId: 5, off: true, pinned: false }, 12, write)
		expect(sent.at(-1)).toEqual({ entryId: 5, off: true, pinned: false, sessionId: 12, request: "page:2" })
		answer({ entryId: 5, off: true, pinned: false })
		await expect(both).resolves.toEqual({ off: true, pinned: false })
	})

	test("a mark a dated amendment still decides resolves with which mark and from when, in the widget's words", async () => {
		const { write, answer } = page()
		const ask = answerSetEntryMarks({ entryId: 5, off: true }, 12, write)
		answer({
			entryId: 5,
			off: false,
			pinned: false,
			heldBy: { field: "enabled", date: { year: 3, month: 2, day: null }, label: "Year 3, Thaw", amendmentId: 9 }
		})
		await expect(ask).resolves.toEqual({ off: false, pinned: false, heldBy: { mark: "off", date: "Year 3, Thaw" } })
	})

	test("a page with no session asks without one", async () => {
		const { sent, write, answer } = page()
		const ask = answerSetEntryMarks({ entryId: 5, pinned: true }, null, write)
		expect(sent).toEqual([{ entryId: 5, pinned: true, request: "page:1" }])
		answer({ entryId: 5, off: false, pinned: true })
		await expect(ask).resolves.toEqual({ off: false, pinned: true })
	})

	test("the server's refusal is this request's rejection, and another ask's reply is not its answer", async () => {
		const { asks, write, hear, answer } = page()
		const ask = answerSetEntryMarks({ entryId: 5, off: true }, 12, write)
		hear({ entryId: 6, off: true, pinned: false, request: "page:9" })
		expect(asks.size).toBe(1)
		answer({ entryId: 5, error: "Entry not found or access denied." })
		await expect(ask).rejects.toThrow("Entry not found or access denied.")
	})

	test("two asks for one entry each take their own reply, whichever lands first", async () => {
		const { write, hear } = page()
		const first = answerSetEntryMarks({ entryId: 5, off: true }, 12, write)
		const second = answerSetEntryMarks({ entryId: 5, pinned: true }, 12, write)
		hear({ entryId: 5, off: true, pinned: true, request: "page:2" })
		hear({ entryId: 5, off: true, pinned: false, request: "page:1" })
		await expect(first).resolves.toEqual({ off: true, pinned: false })
		await expect(second).resolves.toEqual({ off: true, pinned: true })
	})

	test("another tab's answer for the same entry — read by its own session — settles nothing here; this ask's own token does", async () => {
		const { sent, asks, write, hear } = page()
		const ask = answerSetEntryMarks({ entryId: 5, off: true }, 12, write)
		const token = sent.at(-1)!.request
		expect(typeof token).toBe("string")
		// Another tab, another session, the same entry: its marks and its held note are not this session's.
		hear({
			entryId: 5,
			off: false,
			pinned: false,
			heldBy: { field: "enabled", date: { year: 3, month: null, day: null }, label: "Year 3", amendmentId: 9 },
			request: "another-tab:1"
		})
		hear({ entryId: 5, off: true, pinned: false })
		expect(asks.size).toBe(1)
		hear({ entryId: 5, off: true, pinned: false, request: token })
		await expect(ask).resolves.toEqual({ off: true, pinned: false })
	})

	test("refuses, in words, before anything is sent", async () => {
		const { sent, write } = page()
		await expect(answerSetEntryMarks({ off: true }, 12, write)).rejects.toThrow(/needs an entryId/)
		await expect(answerSetEntryMarks({ entryId: 5 }, 12, write)).rejects.toThrow(/needs a mark to set/)
		await expect(answerSetEntryMarks({ entryId: 5, off: "yes" }, 12, write)).rejects.toThrow(/'off' as true or false/)
		await expect(answerSetEntryMarks({ entryId: 5, pinned: 1 }, 12, write)).rejects.toThrow(/'pinned' as true or false/)
		expect(sent).toEqual([])
	})
})
