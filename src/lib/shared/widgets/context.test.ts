import { describe, expect, it, test } from "vitest"
import { parseChannel } from "@serene-pub/sdk"
import {
	buildNativeContext,
	createWidgetEventBus,
	deriveChrome,
	eventInScope,
	projectLayout,
	projectWidgetData,
	scopeMessages,
	WidgetMessageFeed,
	type PlacementInput,
	type ProjectInput,
	type WidgetEvent,
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

	/**
	 * Lanes (ruling 2026-09-09). A panel declares a **channel** — a slug — and
	 * a channel's lanes are runtime, so the declaration cannot enumerate them:
	 * the cell-phone panel showing five conversations declares `text-messages`
	 * once and gets all five. A panel that wants exactly one says `slug:n`.
	 */
	const laned = [
		{ id: 1, channel: "text-messages" },
		{ id: 2, channel: "text-messages:2" },
		{ id: 3, channel: "text-messages:3" },
		{ id: 4, channel: "text-messagesX:2" },
		{ id: 5, channel: "main" }
	]
	test("a declared slug is the whole channel — every lane under it", () => {
		expect(
			scopeMessages(laned, ["text-messages"]).map((m) => m.id),
			"a panel declaring the cell-phone channel saw one of its conversations"
		).toEqual([1, 2, 3])
	})
	test("a declared `slug:n` is that lane alone", () => {
		expect(scopeMessages(laned, ["text-messages:2"]).map((m) => m.id)).toEqual(
			[2]
		)
		// Lane 1 is the bare slug in the column, so `slug:1` has to find it.
		expect(scopeMessages(laned, ["text-messages:1"]).map((m) => m.id)).toEqual(
			[1]
		)
	})
	test("a channel whose slug merely looks alike is a different channel", () => {
		expect(
			scopeMessages(laned, ["text-messages"]).map((m) => m.id)
		).not.toContain(4)
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
		expect(d.settings.v1).toEqual({})
	})

	test("settings reach the widget as a base section of their own", () => {
		const d = projectWidgetData(base({ settings: { lane: 3 } }))
		expect(d.settings.v1).toEqual({ lane: 3 })
		// A detached copy: the host goes on owning its object.
		expect(d.settings.v1).not.toBe(base().settings)
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

/* ── real placement (the grid threads geometry now) ──────────────────────── */

describe("projectWidgetData — a REAL placement", () => {
	/** Map in the right zone: 4 cols × 20 rows, sitting at row 15, 5 tall. */
	const map = placement({
		zone: { columns: 4, column: 1, rows: 20, row: 15 },
		box: {
			cols: 4,
			rows: 5,
			edges: { top: false, right: true, bottom: false, left: true }
		},
		tier: "compact"
	})

	it("carries the widget's own cell geometry, not a single-widget default", () => {
		const l = projectWidgetData(base({ placement: map })).layout.v1
		expect(l.zone).toEqual({ columns: 4, column: 1, rows: 20, row: 15 })
		expect(l.box.cols).toBe(4)
		expect(l.box.rows).toBe(5)
	})

	it("edges say which zone edges the box touches", () => {
		const l = projectWidgetData(base({ placement: map })).layout.v1
		expect(l.box.edges).toEqual({
			top: false,
			right: true,
			bottom: false,
			left: true
		})
	})

	it("tier is the width class of THIS widget's box", () => {
		expect(
			projectWidgetData(base({ placement: map })).layout.v1.tier
		).toBe("compact")
		expect(
			projectWidgetData(
				base({ placement: placement({ tier: "wide" }) })
			).layout.v1.tier
		).toBe("wide")
	})

	it("projectLayout is the ONE builder both deliveries feed from", () => {
		// Field-for-field identity is the contract (native == frame minus the
		// iframe), so the frame's `{t:"layout"}` must not be a second copy of
		// this maths.
		expect(projectLayout(map)).toEqual(
			projectWidgetData(base({ placement: map })).layout.v1
		)
	})
})

/* ── the event bus ───────────────────────────────────────────────────────── */

describe("createWidgetEventBus", () => {
	const created = (id: number): WidgetEvent => ({
		kind: "message:created",
		channel: "main",
		slug: "main",
		lane: 1,
		messageId: id
	})

	it("delivers to subscribers of that kind only", () => {
		const bus = createWidgetEventBus()
		const got: WidgetEvent[] = []
		const other: WidgetEvent[] = []
		bus.on("message:created", (e) => got.push(e))
		bus.on("channel:activated", (e) => other.push(e))
		bus.emit(created(1))
		expect(got).toHaveLength(1)
		expect(other).toHaveLength(0)
	})

	it("`*` receives every kind", () => {
		const bus = createWidgetEventBus()
		const all: string[] = []
		bus.on("*", (e) => all.push(e.kind))
		bus.emit(created(1))
		bus.emit({ kind: "channel:activated", channel: "map", slug: "map", lane: 1 })
		expect(all).toEqual(["message:created", "channel:activated"])
	})

	it("returns an unsubscribe that actually stops delivery", () => {
		const bus = createWidgetEventBus()
		const got: number[] = []
		const off = bus.on("message:created", (e) => got.push((e as any).messageId))
		bus.emit(created(1))
		off()
		bus.emit(created(2))
		expect(got).toEqual([1])
	})

	it("unsubscribing twice is a no-op, and never removes someone else", () => {
		const bus = createWidgetEventBus()
		const a: number[] = []
		const b: number[] = []
		const offA = bus.on("message:created", (e) => a.push((e as any).messageId))
		bus.on("message:created", (e) => b.push((e as any).messageId))
		offA()
		offA()
		bus.emit(created(3))
		expect(a).toEqual([])
		expect(b).toEqual([3])
	})

	it("a subscriber that throws cannot stop the others", () => {
		const bus = createWidgetEventBus()
		const got: number[] = []
		bus.on("message:created", () => {
			throw new Error("widget blew up")
		})
		bus.on("message:created", (e) => got.push((e as any).messageId))
		expect(() => bus.emit(created(4))).not.toThrow()
		expect(got).toEqual([4])
	})

	it("unsubscribing DURING an emit doesn't skip the next subscriber", () => {
		const bus = createWidgetEventBus()
		const got: string[] = []
		const off = bus.on("message:created", () => {
			got.push("a")
			off()
		})
		bus.on("message:created", () => got.push("b"))
		bus.emit(created(5))
		expect(got).toEqual(["a", "b"])
	})
})

/* ── message:created, per widget ─────────────────────────────────────────── */

describe("WidgetMessageFeed", () => {
	it("seeds silently — a backlog is history, not an arrival", () => {
		const feed = new WidgetMessageFeed()
		expect(feed.take([{ id: 1 }, { id: 2 }])).toEqual([])
	})

	it("emits `message:created` for each newly-landed message", () => {
		const feed = new WidgetMessageFeed()
		feed.take([{ id: 1 }])
		const evs = feed.take([{ id: 1 }, { id: 2, channel: "main" }])
		expect(evs).toEqual([
			{
				kind: "message:created",
				channel: "main",
				slug: "main",
				lane: 1,
				messageId: 2
			}
		])
	})

	it("takes the channel apart, canonically (lane 1 is the bare slug)", () => {
		const feed = new WidgetMessageFeed()
		feed.take([])
		const [a, b] = feed.take([
			{ id: 7, channel: "text-messages:3" },
			{ id: 8, channel: "text-messages:1" }
		])
		expect(a).toMatchObject({ channel: "text-messages:3", slug: "text-messages", lane: 3 })
		expect(b).toMatchObject({ channel: "text-messages", slug: "text-messages", lane: 1 })
	})

	it("an unlabeled message is main lane 1", () => {
		const feed = new WidgetMessageFeed()
		feed.take([])
		expect(feed.take([{ id: 9 }])[0]).toMatchObject({
			channel: "main",
			slug: "main",
			lane: 1
		})
	})

	it("re-emits nothing when the same list is re-projected", () => {
		const feed = new WidgetMessageFeed()
		feed.take([{ id: 1 }])
		feed.take([{ id: 1 }, { id: 2 }])
		expect(feed.take([{ id: 1 }, { id: 2 }])).toEqual([])
	})

	it("an UPDATE (same id, new content) is not a creation", () => {
		const feed = new WidgetMessageFeed()
		feed.take([{ id: 1, content: "a" }])
		expect(feed.take([{ id: 1, content: "ab" }])).toEqual([])
	})

	it("ignores a message with no numeric id — nothing to name", () => {
		const feed = new WidgetMessageFeed()
		feed.take([])
		expect(feed.take([{ channel: "main" }])).toEqual([])
	})
})

/* ── session-level events, scoped to a widget's channels ─────────────────── */

describe("eventInScope", () => {
	const activated = (channel: string): WidgetEvent => ({
		kind: "channel:activated",
		channel,
		slug: parseChannel(channel).slug,
		lane: parseChannel(channel).lane
	})

	it("a widget declaring nothing hears every channel", () => {
		expect(eventInScope(activated("map"), [])).toBe(true)
	})

	it("a declared slug is the whole channel — every lane under it", () => {
		expect(eventInScope(activated("phone:5"), ["phone"])).toBe(true)
	})

	it("a declared `slug:n` is that lane alone", () => {
		expect(eventInScope(activated("phone:5"), ["phone:2"])).toBe(false)
		expect(eventInScope(activated("phone"), ["phone:1"])).toBe(true)
	})

	it("an event with no channel at all is in scope (it is not channel news)", () => {
		expect(eventInScope({ kind: "generation:start" }, ["phone"])).toBe(true)
	})
})
