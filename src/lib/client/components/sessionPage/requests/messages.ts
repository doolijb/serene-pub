/**
 * 🚧 `messages` (anyone may ask): one page of the session's lines for the
 * asking widget — its OWN window, never the conversation's (D7 ruling A,
 * 2026-10-11). The request's `cursor` is the last page's `nextCursor`,
 * `limit` is clamped by the server, and `channel` is a channel string: a bare
 * slug is the whole channel, `slug:n` one lane. A widget that declares one
 * channel and names none reads that one; a plugin's widget that declares
 * channels is held to them, and refused in words outside them.
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import { projectMessageRow } from "@serene-pub/sdk"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"
import { declaredChannelsOf } from "./askers"

type Params = WidgetRequests["messages"]["params"]
type Result = WidgetRequests["messages"]["result"]
type From = Parameters<WidgetRequestHandler>[2]

/** What the page sends the server for one page, and what comes back. */
export interface MessagesPageAsk {
	beforeId?: number
	limit?: number
	channel?: string
}
export interface MessagesPageReply {
	rows: readonly Record<string, unknown>[]
	nextCursor?: string
	error?: string
}

/** What this answer needs of the page. */
export interface MessagesDeps {
	messagesPage(ask: MessagesPageAsk): Promise<MessagesPageReply>
}

/** Which channel this ask reads, or a refusal sentence. */
export function channelOfAsk(params: Params | undefined, from: Pick<From, "owner" | "channels"> | undefined): { channel?: string } | { refused: string } {
	const named = typeof params?.channel === "string" && params.channel.trim() ? params.channel.trim() : undefined
	const declared = from ? declaredChannelsOf(from as From) : []
	if (from?.owner !== "core" && declared.length) {
		if (named === undefined) return declared.length === 1 ? { channel: declared[0] } : {}
		const slug = named.split(":")[0]!
		if (!declared.includes(named) && !declared.includes(slug))
			return { refused: `'messages' reads only the channels this widget declares (${declared.join(", ")}), not '${named}'` }
		return { channel: named }
	}
	if (named === undefined && declared.length === 1) return { channel: declared[0] }
	return named === undefined ? {} : { channel: named }
}

/** Answer one `messages` with a page of the asking widget's own window. */
export async function answerMessages(params: Params | undefined, deps: MessagesDeps, from?: Pick<From, "owner" | "channels">): Promise<Result> {
	const where = channelOfAsk(params, from)
	if ("refused" in where) throw new Error(where.refused)
	const ask: MessagesPageAsk = { ...where }
	if (params?.cursor !== undefined) {
		const beforeId = Number(params.cursor)
		if (!Number.isInteger(beforeId)) throw new Error(`'messages' cursor must be the last page's nextCursor, not ${JSON.stringify(params.cursor)}`)
		ask.beforeId = beforeId
	}
	if (params?.limit !== undefined) ask.limit = Number(params.limit)
	const reply = await deps.messagesPage(ask)
	if (reply.error) throw new Error(reply.error)
	return {
		rows: reply.rows.map((r) => projectMessageRow(r)) as Result["rows"],
		...(reply.nextCursor ? { nextCursor: reply.nextCursor } : {})
	}
}
