import { describe, expect, it, test } from "vitest"
import { parseChannel, WIDGET_SCOPED_SECTIONS } from "@serene-pub/sdk"
import {
	deriveChrome,
	eventInScope,
	findAction,
	makeInvoke,
	projectActions,
	SCOPED_SECTION_CONTEXT_KEYS,
	scopeMessages,
	WidgetMessageFeed,
	type ActionsV1,
	type PlacementInput,
	type WidgetAction,
	type WidgetEvent,
	type WidgetVerbs
} from "./context"
import type { ActionDispatch } from "./invokeAction"

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
			padding: false,
			card: false
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

/* ── real placement (the grid threads geometry now) ──────────────────────── */

/* ── the event bus ───────────────────────────────────────────────────────── */

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

/* ── the action venues and `invoke` (plans/29 R-15; U5c) ─────────────────── */

describe("actions.v1 and invoke", () => {
	const roll: WidgetAction = {
		key: "roll",
		specSlug: "acme:spec/roll",
		name: "Roll",
		slash: "acme.roll",
		quick: false,
		audience: { see: ["participant"], act: ["owner"] },
		venue: "widget",
		origin: "attachment",
		floor: false,
		canAct: true,
		itemGated: false,
		isNew: true
	}
	const edit: WidgetAction = {
		...roll,
		key: "edit",
		specSlug: "core",
		name: "Edit",
		slash: "edit",
		quick: true,
		venue: "message",
		origin: "core",
		floor: true,
		itemGated: true,
		isNew: false
	}
	const venues: ActionsV1 = {
		widget: { primary: [], overflow: [roll] },
		message: { primary: [edit], overflow: [] }
	}
	/** The widget "dice"'s `invoke` over these venues, as the wire derives it. */
	const invokeOf = (
		actions: ActionsV1,
		calls: unknown[][],
		dispatch?: Partial<ActionDispatch>
	): WidgetVerbs["invoke"] =>
		makeInvoke(() => projectActions(actions), (...a) => calls.push(a), "dice", dispatch)

	it("is empty when the host has no list", () => {
		expect(projectActions(undefined)).toEqual({})
	})

	it("projects a detached copy of every venue, primary and overflow", () => {
		const projected = projectActions(venues)
		expect(projected).toEqual(venues)
		expect(projected.widget!.overflow[0]).not.toBe(roll)
		expect(findAction(projected, "roll")?.specSlug).toBe("acme:spec/roll")
		expect(findAction(projected, "nope")).toBeUndefined()
	})

	it("invoke resolves a key to its declaration and routes it through action, identity in hand (W1)", () => {
		const calls: unknown[][] = []
		const invoke = invokeOf(venues, calls)
		invoke("roll")
		invoke("acme:spec/roll#roll", { messageId: 7, payload: { text: "x" } })
		expect(calls).toEqual([
			["roll", undefined, undefined, "acme:spec/roll#roll", undefined],
			["roll", 7, { text: "x" }, "acme:spec/roll#roll", undefined]
		])
	})

	it("invoke carries the block a form's press answers through to the fire (U5d)", () => {
		const calls: unknown[][] = []
		invokeOf(venues, calls)("roll", { messageId: 7, blockId: "blk-2" })
		// Fifth argument, the same slot `action`'s `blockId` has occupied all
		// along: a widget drawing a message's form presses it by identity like
		// any other action instead of dropping back to the deprecated verb.
		expect(calls).toEqual([
			["roll", 7, undefined, "acme:spec/roll#roll", "blk-2"]
		])
	})

	it("invoke('extend') routes to the host's extend handler, never to the function fire (W4)", () => {
		const cont: WidgetAction = {
			...edit,
			key: "extend",
			name: "Extend",
			slash: "extend",
			venue: "extra"
		}
		const calls: unknown[][] = []
		const extended: unknown[] = []
		const invoke = invokeOf({ ...venues, extra: { primary: [], overflow: [cont] } }, calls, {
			core: { extend: (args) => extended.push(args) }
		})
		invoke("extend", { messageId: 9 })
		invoke("core#extend")
		expect(extended).toEqual([{ messageId: 9 }, undefined])
		// `sessions:fireAction` refuses `extend` by name; nothing
		// reached `action`.
		expect(calls).toEqual([])
	})

	it("a contributed action goes to the host's OWN fire, with the subject, the values and the block", () => {
		// The one route: a widget's press is handed to the dispatch the page
		// threaded down — whose `fire` is the page's own `fireOfferedAction`, which
		// names the run and opens the narrator's modal — and NOT to a second
		// fire derived from `action` here. A press inside a widget is the same
		// press as the chip beside it or it is a lesser one.
		const calls: unknown[][] = []
		const fired: unknown[][] = []
		const extended: unknown[] = []
		const cont: WidgetAction = {
			...edit,
			key: "extend",
			name: "Extend",
			slash: "extend",
			venue: "extra"
		}
		const invoke = invokeOf({ ...venues, extra: { primary: [], overflow: [cont] } }, calls, {
			core: { extend: (args) => extended.push(args) },
			fire: (a, args) => fired.push([a, args])
		})
		invoke("roll", {
			messageId: 7,
			payload: { text: "x" },
			blockId: "blk-2"
		})
		// The whole declaration, so the fire can name its identity (W1), and
		// every field of `WidgetInvokeArgs` alongside it.
		expect(fired).toEqual([
			[
				{ ...roll },
				{ messageId: 7, payload: { text: "x" }, blockId: "blk-2" }
			]
		])
		// A core verb still goes to the core half of the same bag.
		invoke("core#extend", { messageId: 9 })
		expect(extended).toEqual([{ messageId: 9 }])
		expect(fired).toHaveLength(1)
		// Neither half touched the generic `action` verb.
		expect(calls).toEqual([])
	})

	it("a core verb the host wired no handler for is refused by name, not fired as a function", () => {
		const calls: unknown[][] = []
		expect(() => invokeOf(venues, calls)("edit", { messageId: 7 })).toThrow(
			/'core#edit' is one of core's verbs and this host wired no handler for it/
		)
		expect(calls).toEqual([])
	})

	it("findAction takes an identity, and a bare key only while one action carries it (S7)", () => {
		const twin: WidgetAction = { ...roll, specSlug: "chariot:spec/roll", slash: "chariot.roll" }
		const shared: ActionsV1 = {
			widget: { primary: [twin], overflow: [roll] },
			// The same declaration listed at a second venue is one action.
			composer: { primary: [], overflow: [roll] }
		}
		expect(findAction(shared, "acme:spec/roll#roll")?.specSlug).toBe("acme:spec/roll")
		expect(findAction(shared, "chariot:spec/roll#roll")?.specSlug).toBe("chariot:spec/roll")
		expect(findAction(shared, "acme:spec/roll#nope")).toBeUndefined()
		expect(() => findAction(shared, "roll")).toThrow(
			/action key "roll" is carried by 2 actions here — name one: chariot:spec\/roll#roll, acme:spec\/roll#roll/
		)
		expect(findAction(venues, "roll")?.specSlug).toBe("acme:spec/roll")
	})

	it("invoke refuses a key no venue lists — a widget cannot fire what the session does not offer", () => {
		const calls: unknown[][] = []
		expect(() => invokeOf(venues, calls)("summon-dragon")).toThrow(
			/widget "dice" invoked action "summon-dragon", which no venue of this session lists/
		)
		expect(calls).toEqual([])
	})

})

describe("scoped sections come off the SDK's one table", () => {
	test("every scope in the table but lore and persona has a page context to supply it", () => {
		expect(Object.keys(SCOPED_SECTION_CONTEXT_KEYS).sort()).toEqual(["characters", "session:full", "session:state"])
		for (const scope of Object.keys(SCOPED_SECTION_CONTEXT_KEYS))
			expect(Object.hasOwn(WIDGET_SCOPED_SECTIONS, scope)).toBe(true)
	})
})
