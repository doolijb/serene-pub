/**
 * The page answers each request kind only for the widgets the SDK's askers
 * table names (F9): core's writes for core's widgets, a scoped read for a
 * widget holding its scope, 🚧 a plugin's write for a widget holding its
 * write grant (D4) — declined before any of the page's answer runs.
 */
import { describe, expect, test } from "vitest"
import { declaredChannelsOf, guardWidgetRequests, holdsWidgetGrant } from "./askers"
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
		await expect(ask("fire-turn", {}, { widgetId: "acme:x", owner: "acme", grants: ["channel:main:write"] })).rejects.toThrow(
			"only core's own widgets ask 'fire-turn'"
		)
		await expect(
			ask("switch-persona", { personaId: 2 }, { widgetId: "acme:x", owner: "acme", grants: ["session:state:write"] })
		).rejects.toThrow(/only core's own widgets/)
		expect(asked).toEqual([])
	})

	test("🚧 D4: a plugin's write needs its write grant — never the read — and a channel it declares", async () => {
		const { asked, ask } = guarded()
		const acme = { widgetId: "acme:x", owner: "acme" }
		const write = { owner: { kind: "session" as const, id: 1 }, slotId: "s", value: 1 }
		await expect(ask("set-attribute-value", write, { ...acme, grants: ["session:state"] })).rejects.toThrow(
			"not granted the write grant 'session:state:write'"
		)
		// The channels ride beside `from`, as the widget wire carries them.
		const send = { content: "hi", personaId: null, channel: "dice" }
		await expect(ask("send", send, { ...acme, grants: ["channel:dice:write"] } as never)).rejects.toThrow(
			"not one of this widget's channels"
		)
		await expect(ask("send", send, { ...acme, channels: ["dice"], grants: ["channel:dice"] } as never)).rejects.toThrow(
			"not granted the write grant 'channel:dice:write'"
		)
		expect(asked).toEqual([])
		await ask("set-attribute-value", write, { ...acme, grants: ["session:state:write"] })
		await ask("send", send, { ...acme, channels: ["dice"], grants: ["channel:dice:write"] } as never)
		await ask("draft", { content: "x" }, { ...acme, channels: ["dice"], grants: ["channel:dice:write"] } as never)
		expect(asked.map(([kind]) => kind)).toEqual(["set-attribute-value", "send", "draft"])
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

describe("holdsWidgetGrant and declaredChannelsOf (asked again by each write)", () => {
	test("core holds every grant; a plugin only a listed bare grant", () => {
		expect(holdsWidgetGrant(undefined, "session:state:write")).toBe(true)
		expect(holdsWidgetGrant({ widgetId: "stats", owner: "core" }, "session:state:write")).toBe(true)
		const acme = { widgetId: "acme:x", owner: "acme" }
		expect(holdsWidgetGrant(acme, "session:state:write")).toBe(false)
		expect(holdsWidgetGrant({ ...acme, grants: ["session:state"] }, "session:state:write")).toBe(false)
		expect(holdsWidgetGrant({ ...acme, grants: ["widget:session:state:write"] }, "session:state:write")).toBe(false)
		// A stored string's `includes` would match a substring: not a list, no grant.
		expect(holdsWidgetGrant({ ...acme, grants: "xsession:state:writex" as never }, "session:state:write")).toBe(false)
		expect(holdsWidgetGrant({ ...acme, grants: ["session:state:write"] }, "session:state:write")).toBe(true)
	})

	test("the declared channels are the text ones riding beside `from`, none when absent", () => {
		expect(declaredChannelsOf({ widgetId: "w", owner: "acme" })).toEqual([])
		expect(declaredChannelsOf({ widgetId: "w", owner: "acme", channels: ["dice", 4, "main"] } as never)).toEqual(["dice", "main"])
	})
})
