/**
 * The page answers each request kind only for the widgets the SDK's askers
 * table names (F9): core's writes for core's widgets, a scoped read for a
 * widget holding its scope — declined before any of the page's answer runs.
 */
import { describe, expect, test } from "vitest"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

function guarded() {
	const asked: Array<[string, unknown]> = []
	const answer = (async (kind: string, _params: unknown, from: unknown) => {
		asked.push([kind, from])
		return undefined
	}) as WidgetRequestHandler
	return { asked, ask: guardWidgetRequests(answer) }
}

describe("guardWidgetRequests", () => {
	test("a plugin's widget asking a core-only kind is refused, and the page's answer never runs", async () => {
		const { asked, ask } = guarded()
		await expect(
			ask("send", { content: "hi", personaId: null, channel: "main" }, { widgetId: "acme:x", owner: "acme" })
		).rejects.toThrow("only core's own widgets ask 'send'")
		await expect(
			ask("set-attribute-value", { owner: { kind: "session", id: 1 }, slotId: "s", value: 1 }, {
				widgetId: "acme:x",
				owner: "acme",
				grants: ["session:state"]
			})
		).rejects.toThrow(/only core's own widgets/)
		expect(asked).toEqual([])
	})

	test("session-entries needs the 'lore' grant — a bare scope, never the permission key", async () => {
		const { asked, ask } = guarded()
		await expect(ask("session-entries", {}, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(/'lore' scope/)
		await expect(
			ask("session-entries", {}, { widgetId: "acme:x", owner: "acme", grants: ["widget:lore"] })
		).rejects.toThrow(/'lore' scope/)
		expect(asked).toEqual([])
		await ask("session-entries", {}, { widgetId: "acme:x", owner: "acme", grants: ["lore"] })
		expect(asked.map(([kind]) => kind)).toEqual(["session-entries"])
	})

	test("core's own widgets ask anything; anyone asks an 'any' kind", async () => {
		const { asked, ask } = guarded()
		await ask("session-entries", {}, { widgetId: "lore-entries", owner: "core" })
		await ask("send", { content: "hi", personaId: null, channel: "main" }, { widgetId: "messages", owner: "core" })
		await ask("pick-turn", {}, { widgetId: "acme:x", owner: "acme" })
		expect(asked.map(([kind]) => kind)).toEqual(["session-entries", "send", "pick-turn"])
	})
})
