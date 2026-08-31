import { describe, expect, test } from "vitest"
import {
	buildNativeContext,
	deriveChrome,
	projectWidgetData,
	scopeMessages,
	type PlacementInput,
	type ProjectInput,
	type WidgetVerbs
} from "./context"

const placement = (over: Partial<PlacementInput> = {}): PlacementInput => ({
	zone: { columns: 3, column: 1, rows: 1, row: 1 },
	box: {
		cols: 4,
		rows: null,
		edges: { top: true, right: false, bottom: true, left: true }
	},
	tier: "cozy",
	pinned: false,
	collapsed: false,
	drawered: false,
	...over
})

const base = (over: Partial<ProjectInput> = {}): ProjectInput => ({
	session: { id: 42, name: "Test" },
	channels: [],
	messages: [{ id: 1 }, { id: 2, channel: "map" }, { id: 3, channel: "main" }],
	placement: placement(),
	...over
})

describe("scopeMessages", () => {
	const msgs = [
		{ id: 1 },
		{ id: 2, channel: "map" },
		{ id: 3, channel: "main" }
	]
	test("empty channels → the whole log", () => {
		expect(scopeMessages(msgs, [])).toHaveLength(3)
	})
	test("a lane → only that lane (default 'main' for unlabeled)", () => {
		expect(scopeMessages(msgs, ["main"]).map((m) => m.id)).toEqual([1, 3])
		expect(scopeMessages(msgs, ["map"]).map((m) => m.id)).toEqual([2])
	})
})

describe("deriveChrome", () => {
	test("grid-floating widget owns its own backdrop", () => {
		expect(deriveChrome(placement())).toEqual({
			background: false,
			wrapper: false,
			titleBar: false,
			padding: false
		})
	})
	test("pinned ⇒ host paints background + wrapper", () => {
		const c = deriveChrome(placement({ pinned: true }))
		expect(c.background).toBe(true)
		expect(c.wrapper).toBe(true)
	})
	test("drawered ⇒ host paints background + title bar", () => {
		const c = deriveChrome(placement({ drawered: true }))
		expect(c.background).toBe(true)
		expect(c.titleBar).toBe(true)
	})
	test("explicit chrome overrides the derivation", () => {
		const c = deriveChrome(placement({ pinned: true, chrome: { background: false } }))
		expect(c.background).toBe(false)
		expect(c.wrapper).toBe(true) // still derived
	})
})

describe("projectWidgetData", () => {
	test("base sections are always present and versioned under v1", () => {
		const d = projectWidgetData(base())
		expect(d.session.v1).toEqual({ id: 42, name: "Test" })
		expect(d.channels.v1).toEqual([])
		expect(d.messages.v1).toHaveLength(3)
		expect(d.layout.v1.tier).toBe("cozy")
		expect(d.props.v1).toEqual({})
	})

	test("messages are channel-scoped to the widget's lanes", () => {
		const d = projectWidgetData(base({ channels: ["map"] }))
		expect(d.messages.v1.map((m) => m.id)).toEqual([2])
	})

	test("null session name is normalized", () => {
		const d = projectWidgetData(base({ session: { id: 7 } }))
		expect(d.session.v1.name).toBeNull()
	})

	test("a scoped section is ABSENT without the grant", () => {
		const d = projectWidgetData(
			base({ scoped: { persona: { name: "P" } } }) // no grants
		)
		expect(d.persona).toBeUndefined()
	})

	test("a scoped section is ABSENT when granted but no source data", () => {
		const d = projectWidgetData(base({ grants: ["persona"] }))
		expect(d.persona).toBeUndefined()
	})

	test("a scoped section is present only when granted AND supplied", () => {
		const d = projectWidgetData(
			base({ grants: ["persona", "characters"], scoped: { persona: { name: "P" } } })
		)
		expect(d.persona?.v1).toEqual({ name: "P" })
		// characters granted but not supplied → still absent
		expect(d.characters).toBeUndefined()
	})

	test("projection is a copy — mutating inputs later can't leak in", () => {
		const input = base()
		const d = projectWidgetData(input)
		;(input.channels as string[]).push("map")
		input.placement.zone.column = 99
		expect(d.channels.v1).toEqual([])
		expect(d.layout.v1.zone.column).toBe(1)
	})
})

describe("buildNativeContext", () => {
	test("wraps data with identity + verbs", () => {
		const calls: string[] = []
		const ctx = buildNativeContext(
			base(),
			{ id: "messages", instanceId: "messages#1", title: "Messages" },
			{
				action: (fn) => calls.push(fn),
				request: (async () => undefined) as WidgetVerbs["request"],
				menu: async () => null,
				on: () => () => {}
			}
		)
		expect(ctx.protocol).toBe(1)
		expect(ctx.widget.id).toBe("messages")
		expect(ctx.session.v1.id).toBe(42)
		ctx.action("delete", 1)
		expect(calls).toEqual(["delete"])
	})
})
