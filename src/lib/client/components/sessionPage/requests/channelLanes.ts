/**
 * 🚧 `channel-lanes` (anyone may ask): the channel lanes under one channel —
 * the numbered conversations a channel carries (a phone's threads), as the
 * log shows them, from the server (`sessions:channelLanes`). A plugin's widget
 * that declares channels is held to them, like `messages`; who is in a lane is
 * the genre's to say (ruled 2026-10-12).
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"
import { channelOfAsk } from "./messages"

type Params = WidgetRequests["channel-lanes"]["params"]
type Result = WidgetRequests["channel-lanes"]["result"]
type From = Parameters<WidgetRequestHandler>[2]

/** What this answer needs of the page. */
export interface ChannelLanesDeps {
	channelLanes(ask: { channel: string }): Promise<{ lanes: Result["lanes"]; error?: string }>
}

/** Answer one `channel-lanes` with the lanes the log shows under that channel. */
export async function answerChannelLanes(params: Params | undefined, deps: ChannelLanesDeps, from?: Pick<From, "owner" | "channels">): Promise<Result> {
	const where = channelOfAsk(params, from)
	if ("refused" in where) throw new Error(where.refused.replace("'messages'", "'channel-lanes'"))
	if (!where.channel) throw new Error("'channel-lanes' needs a channel: the slug whose lanes to list")
	const reply = await deps.channelLanes({ channel: where.channel })
	if (reply.error) throw new Error(reply.error)
	return { lanes: reply.lanes }
}
