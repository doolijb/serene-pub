/** `channel-lanes` lists the channel lanes under one channel from the server, held to a plugin widget's declared channels. */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS, type ChannelLaneV1 } from "@serene-pub/sdk"
import { answerChannelLanes } from "./channelLanes"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

const lane = (channel: string, lane: number, id: number): ChannelLaneV1 => ({
	channel,
	slug: channel.split(":")[0]!,
	lane,
	count: 1,
	latest: { messageId: id, at: "2026-10-12T00:00:00.000Z", role: "character", characterId: 3 }
})

function server(reply: { lanes: ChannelLaneV1[]; error?: string }) {
	const asks: { channel: string }[] = []
	return { asks, deps: { channelLanes: async (ask: { channel: string }) => (asks.push(ask), reply) } }
}

describe("answerChannelLanes", () => {
	test("lists the lanes the log shows under the named channel, from the server", async () => {
		const { asks, deps } = server({ lanes: [lane("phone", 1, 4), lane("phone:2", 2, 9)] })
		const got = await answerChannelLanes({ channel: "phone" }, deps, { owner: "core", channels: [] })
		expect(asks).toEqual([{ channel: "phone" }])
		expect(got.lanes.map((l) => l.channel)).toEqual(["phone", "phone:2"])
	})

	test("a widget declaring one channel lists it when it names none; naming none otherwise is refused", async () => {
		const { asks, deps } = server({ lanes: [] })
		await answerChannelLanes({} as never, deps, { owner: "acme", channels: ["phone"] })
		expect(asks).toEqual([{ channel: "phone" }])
		await expect(answerChannelLanes({} as never, deps, { owner: "core", channels: [] })).rejects.toThrow(/needs a channel/)
	})

	test("a plugin's widget is held to the channels it declares, in words", async () => {
		const { asks, deps } = server({ lanes: [] })
		await expect(answerChannelLanes({ channel: "main" }, deps, { owner: "acme", channels: ["phone"] })).rejects.toThrow(
			"'channel-lanes' reads only the channels this widget declares (phone), not 'main'"
		)
		expect(asks).toEqual([])
	})

	test("the server's refusal is the widget's refusal; anyone may ask through the guard", async () => {
		const { deps } = server({ lanes: [], error: "This session is not yours to read." })
		await expect(answerChannelLanes({ channel: "phone" }, deps)).rejects.toThrow("This session is not yours to read.")
		expect(WIDGET_REQUEST_ASKERS["channel-lanes"]).toBe("any")
		const ok = server({ lanes: [lane("phone", 1, 1)] })
		const ask = guardWidgetRequests((async (_k: string, p: unknown, from: unknown) => answerChannelLanes(p as never, ok.deps, from as never)) as WidgetRequestHandler)
		expect((await ask("channel-lanes", { channel: "phone" }, { widgetId: "acme:x", owner: "acme" })).lanes).toHaveLength(1)
	})
})
