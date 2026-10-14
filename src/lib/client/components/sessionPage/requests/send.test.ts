/**
 * `send` sends a line through the page's composer — core's own composer, or
 * 🚧 a plugin's widget holding the write grant on the channel it names (D4).
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

	test("🚧 a plugin's send (D4) is asked again here: the write grant on a channel this session has", () => {
		const { did, deps } = page()
		const plugin = { widgetId: "acme:dice", owner: "acme", grants: ["channel:ooc:write"] }
		// Not granted the write on the channel it names: refused, nothing drafted.
		expect(() => answerSend({ content: "4", channel: "main", personaId: null }, deps, plugin)).toThrow(
			"not granted the write grant 'channel:main:write'"
		)
		// The read scope, the permission key: neither is the write.
		for (const grants of [["channel:ooc"], ["widget:channel:ooc:write"]])
			expect(() => answerSend({ content: "4", channel: "ooc", personaId: null }, deps, { ...plugin, grants })).toThrow(
				/write grant 'channel:ooc:write'/
			)
		// A channel this session lacks never falls back to the composer's.
		expect(() =>
			answerSend({ content: "4", channel: "nowhere", personaId: null }, deps, { ...plugin, grants: ["channel:nowhere:write"] })
		).toThrow("not one of this session's channels")
		expect(() => answerSend({ content: "4", personaId: null }, deps, plugin)).toThrow("not one of this session's channels")
		// As the viewer's current persona, and none of the viewer's uploads.
		expect(() => answerSend({ content: "4", channel: "ooc", personaId: 9 }, deps, plugin)).toThrow(/current persona/)
		expect(() => answerSend({ content: "4", channel: "ooc", personaId: null, trayItemIds: ["a"] }, deps, plugin)).toThrow(
			/no tray items/
		)
		expect(did).toEqual([])
		// Granted: sent on that channel.
		answerSend({ content: "rolled 4", channel: "ooc", personaId: null }, deps, plugin)
		expect(did).toEqual(["draft rolled 4", "channel ooc", "send"])
	})
})

/** Through the page's door (`guardWidgetRequests`) — the SDK's askers table, D4's once the SDK is rebuilt. */
describe("send behind the askers table", () => {
	test("🚧 D4: a plugin's send opens behind the channel write grant, on a channel it declares", async () => {
		expect(WIDGET_REQUEST_ASKERS.send).toEqual({ scope: "channel", write: true })
		const { did, deps } = page()
		const ask = guardWidgetRequests((async (_k: string, p: unknown, from: never) =>
			answerSend(p, deps, from)) as WidgetRequestHandler)
		const params = { content: "hi", personaId: null, channel: "ooc" }
		const acme = { widgetId: "acme:x", owner: "acme", channels: ["ooc"] }
		// No write grant: refused at the door, nothing drafted.
		await expect(ask("send", params, { ...acme, grants: ["channel:ooc"] })).rejects.toThrow(
			"not granted the write grant 'channel:ooc:write'"
		)
		// Granted the write on a channel it did not declare: refused at the door.
		await expect(
			ask("send", { ...params, channel: "main" }, { ...acme, grants: ["channel:main:write"] })
		).rejects.toThrow("'main', which is not one of this widget's channels")
		expect(did).toEqual([])
		// Declared and granted: answered.
		await ask("send", params, { ...acme, grants: ["channel:ooc:write"] })
		expect(did).toEqual(["draft hi", "channel ooc", "send"])
		// Core's own composer, as ever.
		await ask("send", { ...params, channel: "main" }, { widgetId: "composer", owner: "core" })
		expect(did.slice(3)).toEqual(["draft hi", "channel main", "send"])
	})
})
