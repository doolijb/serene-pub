/** `messages` pages the asking widget's own window: cursor, limit and channel go to the server. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerMessages, channelOfAsk, type MessagesPageAsk } from "./messages"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

const row = (id: number, extra: Record<string, unknown> = {}) => ({
	id,
	sessionId: 1,
	role: "character",
	content: `line ${id}`,
	channel: "main",
	embeddingModel: "x",
	embedTextHash: "y",
	...extra
})

function pager(reply: { rows: Record<string, unknown>[]; nextCursor?: string; error?: string }) {
	const asks: MessagesPageAsk[] = []
	return { asks, deps: { messagesPage: async (ask: MessagesPageAsk) => (asks.push(ask), reply) } }
}

describe("answerMessages", () => {
	test("pages the asking widget's own window: cursor, limit and channel go to the server, rows come back projected", async () => {
		const { asks, deps } = pager({ rows: [row(3), row(4)], nextCursor: "3" })
		const got = await answerMessages({ cursor: "5", limit: 2, channel: "main" }, deps, { owner: "core", channels: [] })
		expect(asks).toEqual([{ beforeId: 5, limit: 2, channel: "main" }])
		expect(got.nextCursor).toBe("3")
		expect(got.rows.map((r) => r.id)).toEqual([3, 4])
		// Host-only columns never reach a widget.
		expect(Object.keys(got.rows[0]!)).not.toContain("embeddingModel")
	})

	test("the first ask names no cursor; the last page carries no nextCursor", async () => {
		const { asks, deps } = pager({ rows: [row(1)] })
		const got = await answerMessages({}, deps, { owner: "core", channels: [] })
		expect(asks).toEqual([{}])
		expect(got).toEqual({ rows: [expect.objectContaining({ id: 1 })] })
	})

	test("a cursor that is not a message id is refused in words, before any ask", async () => {
		const { asks, deps } = pager({ rows: [] })
		await expect(answerMessages({ cursor: "abc" }, deps)).rejects.toThrow(/cursor must be the last page's nextCursor/)
		expect(asks).toEqual([])
	})

	test("the server's refusal is the widget's refusal, in its words", async () => {
		const { deps } = pager({ rows: [], error: "This session is not yours to read." })
		await expect(answerMessages({}, deps)).rejects.toThrow("This session is not yours to read.")
	})

	test("anyone may ask: a plugin's widget passes the askers guard", async () => {
		expect(WIDGET_REQUEST_ASKERS.messages).toBe("any")
		const { deps } = pager({ rows: [row(9)] })
		const ask = guardWidgetRequests((async (_k: string, p: unknown, from: unknown) =>
			answerMessages(p as never, deps, from as never)) as WidgetRequestHandler)
		const got = await ask("messages", {}, { widgetId: "acme:x", owner: "acme" })
		expect(got.rows.map((r) => r.id)).toEqual([9])
	})
})

describe("channelOfAsk", () => {
	test("a widget declaring one channel reads it when it names none; declaring several reads every one", () => {
		expect(channelOfAsk({}, { owner: "acme", channels: ["main"] })).toEqual({ channel: "main" })
		expect(channelOfAsk({}, { owner: "acme", channels: ["main", "sanctum"] })).toEqual({})
		expect(channelOfAsk({}, { owner: "core", channels: ["sanctum"] })).toEqual({ channel: "sanctum" })
	})

	test("a plugin's widget is held to its declared channels, a lane of one included; core's is not", () => {
		expect(channelOfAsk({ channel: "sanctum" }, { owner: "acme", channels: ["main"] })).toEqual({
			refused: "'messages' reads only the channels this widget declares (main), not 'sanctum'"
		})
		expect(channelOfAsk({ channel: "main:2" }, { owner: "acme", channels: ["main"] })).toEqual({ channel: "main:2" })
		expect(channelOfAsk({ channel: "sanctum" }, { owner: "core", channels: ["main"] })).toEqual({ channel: "sanctum" })
		// A plugin's widget declaring no channels reads what it names.
		expect(channelOfAsk({ channel: "main" }, { owner: "acme" })).toEqual({ channel: "main" })
	})
})
