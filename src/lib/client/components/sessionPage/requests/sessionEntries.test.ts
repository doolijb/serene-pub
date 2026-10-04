/**
 * `session-entries` pages the session's lore through the page's own
 * `entries:sessionEntries`: `titleOrKey` becomes the socket's `query` (R5),
 * the reply is copied into `SessionEntryV1`, and each ask takes ITS reply —
 * never a reply that lost a race, another panel's or another tab's.
 */
import { describe, expect, test } from "vitest"
import { createPendingAsks } from "./pendingAsks"
import {
	answerSessionEntries,
	hearSessionEntries,
	sessionEntriesReplyKey,
	tokenedEntriesRead,
	type SessionEntriesRead
} from "./sessionEntries"

type Response = Sockets.Entries.SessionEntries.Response

const row = (id: number, over: Partial<Sockets.Entries.SessionEntries.Row> = {}) => ({
	id,
	typeId: "core:entry/lore",
	title: `Entry ${id}`,
	keys: ["k"],
	off: false,
	pinned: false,
	timesJudged: 2,
	timesIncluded: 1,
	lastJudgedAt: "2026-09-25T10:00:00.000Z",
	lastIncluded: true,
	lastReason: "keyword",
	lastRank: 1,
	...over
})

function reading(reply: Partial<Response> = {}) {
	const asked: unknown[] = []
	const read: SessionEntriesRead = async (ask) => {
		asked.push(ask)
		return { sessionId: ask.sessionId, rows: [], total: 0, ...reply } as Response
	}
	return { asked, read }
}

describe("answerSessionEntries", () => {
	test("asks for the page's own session, with titleOrKey as the socket's query", async () => {
		const { asked, read } = reading({ lorebookId: 4, bookName: "Vale", rows: [row(1)], total: 1, offset: 0 })
		const out = await answerSessionEntries(
			{ titleOrKey: "  dragon ", sort: "rank", filter: "pinned", offset: 25, limit: 25 },
			7,
			read
		)
		expect(asked).toEqual([{ sessionId: 7, query: "dragon", sort: "rank", filter: "pinned", offset: 25, limit: 25 }])
		expect(out).toEqual({ lorebookId: 4, bookName: "Vale", ownerOnly: false, rows: [row(1)], total: 1, offset: 0 })
	})

	test("an empty search asks for everything, and the defaults are the server's", async () => {
		const { asked, read } = reading()
		await answerSessionEntries({ titleOrKey: "   " }, 7, read)
		await answerSessionEntries(undefined, 7, read)
		expect(asked).toEqual([
			{ sessionId: 7, offset: 0 },
			{ sessionId: 7, offset: 0 }
		])
	})

	test("typeIds narrows to entry types — an item picker's first ask (phase 3c); an empty list is every type", async () => {
		const { asked, read } = reading({ lorebookId: 4, rows: [row(3, { typeId: "core:entry/item" })], total: 1 })
		const out = await answerSessionEntries({ typeIds: ["core:entry/item"], sort: "name", limit: 25 }, 7, read)
		await answerSessionEntries({ typeIds: [] }, 7, read)
		expect(asked).toEqual([
			{ sessionId: 7, sort: "name", typeIds: ["core:entry/item"], offset: 0, limit: 25 },
			{ sessionId: 7, offset: 0 }
		])
		expect(out.rows.map((r) => r.typeId)).toEqual(["core:entry/item"])
		await expect(answerSessionEntries({ typeIds: "core:entry/item" }, 7, read)).rejects.toThrow(/list of entry type ids/)
		await expect(answerSessionEntries({ typeIds: ["core:entry/item", 3] }, 7, read)).rejects.toThrow(/list of entry type ids/)
		expect(asked).toHaveLength(2)
	})

	test("the reply is copied into SessionEntryV1: nothing else rides through", async () => {
		const extra = { ...row(2), vectors: [0.1], content: "secret" }
		const { read } = reading({ lorebookId: 4, rows: [extra as never], total: 1 })
		const out = await answerSessionEntries({}, 7, read)
		expect(out.rows).toEqual([row(2)])
		expect(Object.keys(out)).not.toContain("sessionId")
		expect(Object.keys(out)).not.toContain("request")
	})

	test("says whose book it is when the viewer is not its owner, and null when the session reads into none", async () => {
		expect(await answerSessionEntries({}, 7, reading({ lorebookId: 4, ownerOnly: true }).read)).toEqual({
			lorebookId: 4,
			ownerOnly: true,
			rows: [],
			total: 0,
			offset: 0
		})
		expect(await answerSessionEntries({ offset: 50 }, 7, reading({ lorebookId: null }).read)).toMatchObject({
			lorebookId: null,
			offset: 50
		})
	})

	test("refuses, in words, a malformed ask and a page with no session — and the server's refusal", async () => {
		const { asked, read } = reading()
		await expect(answerSessionEntries({ query: "dragon" }, 7, read)).rejects.toThrow(/searches with 'titleOrKey'/)
		await expect(answerSessionEntries({ titleOrKey: 3 }, 7, read)).rejects.toThrow(/as text/)
		await expect(answerSessionEntries({ sort: "newest" }, 7, read)).rejects.toThrow(/sorts by/)
		await expect(answerSessionEntries({ filter: "read" }, 7, read)).rejects.toThrow(/filters by/)
		await expect(answerSessionEntries({ offset: -1 }, 7, read)).rejects.toThrow(/offset of 0 or more/)
		await expect(answerSessionEntries({ limit: 0 }, 7, read)).rejects.toThrow(/limit of 1 or more/)
		await expect(answerSessionEntries({}, null, read)).rejects.toThrow(/no session/)
		expect(asked).toEqual([])
		await expect(answerSessionEntries({}, 7, reading({ error: "Session not found." }).read)).rejects.toThrow(
			"Session not found."
		)
	})
})

describe("each ask takes its own reply (the stale-reply token)", () => {
	function page() {
		const sent: Sockets.Entries.SessionEntries.Params[] = []
		let hear: ((r: Response) => void) | null = null
		const asks = createPendingAsks<Sockets.Entries.SessionEntries.Params, Response>({
			emit: (p) => sent.push(p),
			listen: (onReply) => {
				hear = onReply
				return () => (hear = null)
			},
			keyOf: sessionEntriesReplyKey,
			timeout: "no answer"
		})
		return { sent, asks, read: tokenedEntriesRead(asks, "t"), hear: (r: Response) => hear?.(r) }
	}

	test("a reply that lost the race answers its own ask, never the newer one", async () => {
		const { sent, read, hear } = page()
		const older = answerSessionEntries({ titleOrKey: "dr" }, 7, read)
		const newer = answerSessionEntries({ titleOrKey: "dragon" }, 7, read)
		expect(sent.map((s) => s.request)).toEqual(["t:1", "t:2"])
		hear({ sessionId: 7, rows: [row(2)], total: 1, offset: 0, request: "t:2" })
		hear({ sessionId: 7, rows: [row(1), row(2)], total: 2, offset: 0, request: "t:1" })
		expect((await newer).rows.map((r) => r.id)).toEqual([2])
		expect((await older).rows.map((r) => r.id)).toEqual([1, 2])
	})

	test("another panel's, another tab's or an untokened reply answers nothing here", async () => {
		const { asks, read, hear } = page()
		const mine = answerSessionEntries({}, 7, read)
		hear({ sessionId: 7, rows: [row(9)], total: 1, request: "native:4" })
		hear({ sessionId: 7, rows: [row(9)], total: 1 })
		expect(asks.size).toBe(1)
		hear({ sessionId: 7, rows: [row(1)], total: 1, request: "t:1" })
		expect((await mine).rows.map((r) => r.id)).toEqual([1])
		expect(asks.size).toBe(0)
	})
})

describe("a refused read settles its ask with the server's sentence", () => {
	function page() {
		let reply: ((r: Response) => void) | null = null
		let refusal: ((r: Sockets.Entries.SessionEntries.ErrorResponse) => void) | null = null
		const asks = createPendingAsks<Sockets.Entries.SessionEntries.Params, Response>({
			emit: () => {},
			listen: hearSessionEntries({
				reply: (cb) => {
					reply = cb
					return () => (reply = null)
				},
				refusal: (cb) => {
					refusal = cb
					return () => (refusal = null)
				}
			}),
			keyOf: sessionEntriesReplyKey,
			timeout: "the lore entries did not arrive: the server did not answer",
			timeoutMs: 50
		})
		return {
			asks,
			read: tokenedEntriesRead(asks, "t"),
			refuse: (r: Sockets.Entries.SessionEntries.ErrorResponse) => refusal?.(r),
			listening: () => reply !== null && refusal !== null
		}
	}

	test("the refusal naming the ask rejects it in the server's words, not the timeout's", async () => {
		const { asks, read, refuse, listening } = page()
		const mine = answerSessionEntries({}, 7, read)
		expect(listening()).toBe(true)
		refuse({ sessionId: 7, request: "t:1", error: "The session's lore could not be read." })
		await expect(mine).rejects.toThrow("The session's lore could not be read.")
		expect(asks.size).toBe(0)
		expect(listening()).toBe(false)
	})

	test("a refusal naming no ask of this page settles nothing", async () => {
		const { asks, read, refuse } = page()
		const mine = answerSessionEntries({}, 7, read)
		refuse({ sessionId: 7, request: "native:4", error: "Not yours." })
		refuse({ sessionId: 7, error: "Not yours either." })
		expect(asks.size).toBe(1)
		await expect(mine).rejects.toThrow(/did not arrive/)
	})
})
