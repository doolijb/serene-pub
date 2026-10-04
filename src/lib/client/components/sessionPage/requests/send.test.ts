/**
 * `send` sends a line through the page's composer — core's own composer only;
 * a plugin's widget writes through its own actions, never as the viewer's line.
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerSend } from "./send"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

function page(sends = true) {
	const did: string[] = []
	return {
		did,
		deps: {
			setDraft: (c: string) => did.push(`draft ${c}`),
			channels: ["main", "ooc"],
			setChannel: (c: string) => did.push(`channel ${c}`),
			switchPersona: (id: number) => did.push(`persona ${id}`),
			send: (ids: string[]) => (did.push(ids.length ? `send ${ids.join(",")}` : "send"), sends)
		}
	}
}

describe("answerSend", () => {
	test("drafts, takes the channel and persona, then sends", () => {
		const { did, deps } = page()
		answerSend({ content: "hi", channel: "ooc", personaId: 4 }, deps)
		expect(did).toEqual(["draft hi", "channel ooc", "persona 4", "send"])
	})

	test("tray items ride with the line, de-duplicated; anything not an id is dropped", () => {
		const { did, deps } = page()
		answerSend({ content: "", trayItemIds: ["a", "b", "a", 7, ""] }, deps)
		expect(did).toEqual(["draft ", "send a,b"])
	})

	test("a channel the session lacks and a persona that is not a number are ignored", () => {
		const { did, deps } = page()
		answerSend({ content: "hi", channel: "nowhere", personaId: null }, deps)
		expect(did).toEqual(["draft hi", "send"])
	})

	test("the composer refusing is the widget's refusal, in words — and the draft stays", () => {
		const { did, deps } = page(false)
		expect(() => answerSend({ content: "kept" }, deps)).toThrow("the line was not sent")
		expect(did).toEqual(["draft kept", "send"])
	})

	test("core only: a plugin's widget is refused in words and nothing is drafted", async () => {
		expect(WIDGET_REQUEST_ASKERS.send).toBe("core")
		const { did, deps } = page()
		const ask = guardWidgetRequests((async (_k: string, p: unknown) => answerSend(p, deps)) as WidgetRequestHandler)
		const params = { content: "hi", personaId: null, channel: "main" }
		await expect(ask("send", params, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"only core's own widgets ask 'send'"
		)
		expect(did).toEqual([])
		await ask("send", params, { widgetId: "composer", owner: "core" })
		expect(did).toEqual(["draft hi", "channel main", "send"])
	})
})
