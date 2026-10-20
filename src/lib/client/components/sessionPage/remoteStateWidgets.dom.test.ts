/**
 * Parity (R21): core's remote World State and Stats draw what the native
 * widgets drew for the same session — the same slots, labels, values,
 * controls and states — and every edit reaches the page's state store as
 * the same `state:set`.
 *
 * The page's real state store is seeded as the server answers it, and the
 * remote is posted the page's projection of it (`projectSessionState`),
 * built from `@serene-pub/core-catalog`'s module and mounted in core's box by
 * the SDK's harness; its `set-attribute-value` is answered by the page's own
 * handler. What the native widgets drew for the same seeds was recorded by
 * this test while they still existed (native and remote side by side,
 * `nativeStateWidgets.recorded.ts`), before they were deleted (R79).
 *
 * Deliberate differences, each asserted below: the remote says it is
 * loading before the first read (the native said "nothing declares stats");
 * the native's Enter on a number field threw (its bound value is a number)
 * and wrote nothing, the remote's writes; a refused write is only the asking
 * widget's line (R77); required and retired slots are marked (a retired
 * slot is not editable); a pick that matches nothing says "Nothing in this
 * session matches" — since W7 a pick may name the world or a place, not
 * only a cast member.
 *
 * W7 (2026-10-11): World State is Stats now — an alias — so the last block
 * mounts STATS with World State's settings and holds it to what the native
 * World State drew, then draws every owner, the groups, bars and a strip.
 *
 * F2 (2026-10-11): a stat's **stat trail** — opened from the button beside
 * it, asked through the page's own `stat-trail` answer, readable by a guest
 * — is the last block.
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import type { SessionStateV1 } from "@serene-pub/sdk"
import { projectSessionState } from "./projections/sessionState"
import { answerSetAttributeValue } from "./requests/setAttributeValue"
import { answerStatTrail, type StatTrailRead } from "./requests/statTrail"
import { NATIVE_DREW } from "./nativeStateWidgets.recorded"

const wire = vi.hoisted(() => ({
	handlers: new Map<string, Set<(data: unknown) => void>>(),
	emitted: [] as Array<[string, unknown]>
}))

vi.mock("$lib/client/sockets/typedSocket", () => ({ typedSocketOrNull: () => ({}) }))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declare = (key: string, handler: (data: unknown) => void) => {
		const event = key.split("#")[0]
		const set = wire.handlers.get(event) ?? new Set()
		set.add(handler)
		wire.handlers.set(event, set)
		return () => set.delete(handler)
	}
	return {
		declareInterest: declare,
		requestWithInterest: (event: string, params: unknown, handler: (data: unknown) => void) => {
			declare(event, handler)
			wire.emitted.push([event, params])
			return () => {}
		}
	}
})

const { openSessionState, sessionState } = await import("$lib/client/state/sessionState.svelte")

const SESSION = 7
const CORE_CATALOG = realpathSync(resolve("node_modules/@serene-pub/core-catalog"))
const id = (key: string) => `core:slot/${key}@1`
const slot = (key: string, type: Sockets.State.SlotDescriptor["type"], extra: Partial<Sockets.State.SlotDescriptor> = {}) => ({
	slotId: id(key),
	key,
	qualifiedKey: `core.${key}`,
	label: key[0].toUpperCase() + key.slice(1),
	type,
	appliesTo: [] as ("cast" | "world")[],
	...extra
})

/** The server's answer to `state:get`, as the store hears it. */
function stateGet(over: { slots?: readonly Sockets.State.SlotDescriptor[]; castValues?: boolean } = {}) {
	return {
		sessionId: SESSION,
		state: {
			world: { "core.weather": "rain", "core.lit": true, "core.omen": "grey", "core.danger": 3 },
			cast: over.castValues === false ? {} : { mira: { "core.hp": 14, "core.gold": 30 } }
		},
		slots: [...(over.slots ?? [
			slot("weather", "enum", { description: "Sky" }),
			slot("lit", "boolean"),
			slot("omen", "text"),
			slot("danger", "integer"),
			slot("tension", "derived"),
			slot("hp", "integer"),
			slot("gold", "integer")
		])],
		owners: [
			{
				key: "world",
				kind: "session" as const,
				id: SESSION,
				label: "World",
				configs: {
					[id("weather")]: { of: ["clear", "rain", "storm"] },
					[id("lit")]: {},
					[id("omen")]: {},
					[id("danger")]: { min: 0, max: 5 },
					[id("tension")]: {}
				}
			},
			{ key: "mira", kind: "session_cast" as const, id: 11, label: "Mira", configs: { [id("hp")]: { min: 0, max: 20 }, [id("gold")]: {} } },
			{ key: "bram", kind: "session_cast" as const, id: 12, label: "Bram", configs: { [id("hp")]: { min: 0, max: 20 } } }
		]
	}
}

const serverSays = (event: string, data: unknown) => {
	for (const h of wire.handlers.get(event) ?? []) h(data)
}
const settle = () => new Promise((r) => setTimeout(r, 20))

/** The page's projection of the store, as the remote is posted it. */
function section(): SessionStateV1 {
	const store = sessionState()
	return projectSessionState(
		{
			sessionId: store.sessionId,
			loaded: store.loaded,
			readError: store.readError,
			state: store.state,
			slots: store.slots.values(),
			owners: store.owners.values()
		},
		SESSION
	)
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? null
const percent = (el: Element | null) => {
	const m = /(\d+(?:\.\d+)?)%/.exec(el?.getAttribute("style") ?? "")
	return m ? Number(m[1]) : null
}

/** What a person sees of a state widget: whose, its lines, its cards, its slots. */
/**
 * Re-record the snapshot: `SP_RECORD_DREW=<file>` makes every recorded case
 * pass and writes what the remote drew to that JSON, which
 * `nativeStateWidgets.recorded.ts` is regenerated from. The recording was the
 * deleted natives' drawing (R79); since the sheet redesign (2026-10-18) it is
 * the remote's own regression snapshot.
 */
type Slug = "world-state" | "stats"

const RECORD = process.env.SP_RECORD_DREW
const recorded: Record<string, unknown> = {}
function record<T>(key: string, native: T, actual: T): T {
	if (!RECORD) return native
	recorded[key] = actual
	return actual
}
afterAll(async () => {
	if (!RECORD) return
	const { writeFileSync } = await import("node:fs")
	writeFileSync(RECORD, JSON.stringify(recorded, null, "\t"))
})

function drawn(root: Element, slug?: Slug) {
	const widget = root.querySelector("[data-state-widget]")
	const slots = [...root.querySelectorAll("[data-slot-id]")].map((s) => {
		const b = s.querySelector("button")
		return {
			id: s.getAttribute("data-slot-id"),
			type: s.getAttribute("data-slot-type"),
			label: text(s.querySelector("span")),
			title: s.querySelector("span")?.getAttribute("title"),
			button: text(b),
			aria: b?.getAttribute("aria-label") ?? null,
			pressed: b?.getAttribute("aria-pressed") ?? null,
			disabled: b?.hasAttribute("disabled") ?? null,
			fill: percent(s.querySelector('[data-widget-part~="stat-slot.fill"]'))
		}
	})
	const cards = [...root.querySelectorAll("section[data-owner-key]")].map((c) => [
		c.getAttribute("data-owner-key"),
		text(c.querySelector('[data-widget-part~="stats.card-name"]') ?? c.querySelector("header"))
	])
	return {
		// ⏳ World State mounts Stats' module (AUDIT B): the drawing keeps the alias's name.
		widget: slug ?? widget?.getAttribute("data-state-widget"),
		owner: widget?.getAttribute("data-owner-key") ?? null,
		alerts: [...root.querySelectorAll("[role='alert']")].map(text),
		cards,
		slots,
		empty: slots.length || cards.length ? null : text(widget)
	}
}


const remotes: MountedComponent[] = []
async function mountRemote(slug: Slug, settings: Record<string, unknown> = {}) {
	// ⏳ World State is Stats' module with the settings its alias implies
	// (AUDIT B, 2026-10-17): `owners: world`, the stored `layout` as the
	// arrangement, `strip` unsaid — what the app's settings reader does.
	const { layout, ...rest } = settings
	const implied =
		slug === "world-state" ? { owners: "world", arrangement: typeof layout === "string" ? layout : "strip", ...rest } : settings
	const view = await mountComponent({
		root: CORE_CATALOG,
		entry: `dist/components/stats.js`,
		owner: "core",
		timeoutMs: 60_000,
		context: {
			session: { id: SESSION, name: "Proof" },
			settings: implied,
			viewer: { userId: 1, isAdmin: false, isGuest: false },
			scoped: { session_state: section() }
		},
		requests: (kind, params) =>
			kind === "set-attribute-value" ? answerSetAttributeValue(params, sessionState(), SESSION) : undefined
	})
	remotes.push(view)
	return view
}

/** The `state:set` writes the store sent, without their per-tab request ids. */
const writes = () =>
	wire.emitted
		.filter(([event]) => event === "state:set")
		.map(([, p]) => {
			const { requestId: _id, ...rest } = p as Record<string, unknown>
			return rest
		})

beforeEach(() => {
	wire.emitted.length = 0
	openSessionState(null)
	openSessionState(SESSION)
	serverSays("state:get", stateGet())
})

afterAll(async () => {
	for (const view of remotes) await view.unmount()
})

describe.each([
	["world-state", {}],
	["world-state", { layout: "list", slots: "pick", pickSlots: ["Omen", "danger"] }],
	["stats", {}],
	["stats", { members: "all", density: "compact" }],
	["stats", { members: "pick", pickMembers: ["bram"] }],
	["stats", { members: "pick", pickMembers: ["nobody"] }]
] as const)("%s %j", (slug, settings) => {
	test("the remote draws what the native drew", { timeout: 60_000 }, async () => {
		const key = `${slug} ${JSON.stringify(settings)}`
		const native = NATIVE_DREW[key] as ReturnType<typeof drawn>
		if (!RECORD) expect(native.widget).toBe(slug)
		const remote = await mountRemote(slug, settings)
		expect(remote.refused).toEqual([])
		// DIFFERENCE (W7): a pick matching nothing no longer says "No cast member".
		const expected =
			"pickMembers" in settings && settings.pickMembers[0] === "nobody"
				? { ...native, empty: "Nothing in this session matches the names in this widget's settings." }
				: native
		const actual = drawn(remote.root, slug)
		expect(actual).toEqual(record(key, expected, actual))
	})
})

describe("the empty states", () => {
	test.each([
		["world-state", { slots: [] }],
		["stats", { slots: [] }],
		["stats", { castValues: false }]
	] as const)("%s %j", { timeout: 60_000 }, async (slug, over) => {
		serverSays("state:get", stateGet(over))
		const key = `${slug} ${JSON.stringify(over)}`
		const native = NATIVE_DREW[key] as ReturnType<typeof drawn>
		if (!RECORD) expect(native.empty).toBeTruthy()
		const actual = drawn((await mountRemote(slug)).root, slug)
		expect(actual).toEqual(record(key, native, actual))
	})

	test("world state with no world owner says what the native said", { timeout: 60_000 }, async () => {
		const answer = stateGet()
		serverSays("state:get", { ...answer, owners: answer.owners.filter((o) => o.key !== "world") })
		const native = NATIVE_DREW["world-state no world owner"] as ReturnType<typeof drawn>
		if (!RECORD) expect(native.empty).toMatch(/declares no stats to show here/)
		const actual = drawn((await mountRemote("world-state")).root, "world-state")
		expect(actual).toEqual(record("world-state no world owner", native, actual))
	})

	test("DIFFERENCE: before the first read the remote says it is loading — the native said nothing was declared", { timeout: 60_000 }, async () => {
		openSessionState(null)
		openSessionState(SESSION)
		const remote = await mountRemote("stats")
		expect(text(remote.query("[role='status']"))).toMatch(/Loading the cast's stats/)
		expect(text(remote.root)).not.toMatch(/Nothing in this session declares stats/)
	})
})

describe("a failed read", () => {
	test("is said as the native said it", { timeout: 60_000 }, async () => {
		serverSays("state:get:error", { sessionId: SESSION, error: "Could not read this session's state." })
		const native = NATIVE_DREW["world-state failed read"] as ReturnType<typeof drawn>
		if (!RECORD) expect(native.alerts).toEqual(["Could not read this session's state."])
		const actual = drawn((await mountRemote("world-state")).root, "world-state")
		expect(actual.alerts).toEqual(record("world-state failed read", native, actual).alerts)
	})
})

describe("every edit is the same state:set", () => {
	test("a toggle, an enum pick, a bar's Enter (clamped), an Escape that writes nothing", { timeout: 60_000 }, async () => {
		// What the native wrote for the same edits (recorded): the toggle and
		// the pick; its Enter on the number field threw and wrote nothing.
		const lit = { sessionId: SESSION, owner: { kind: "session", id: SESSION }, slotId: id("lit"), value: false }
		const weather = { sessionId: SESSION, owner: { kind: "session", id: SESSION }, slotId: id("weather"), value: "storm" }

		// The remote: the same edits, through its own controls.
		const remote = await mountRemote("world-state")
		const at = (key: string, sel = "") => `[data-slot-id="${id(key)}"] ${sel}`.trim()
		await remote.click(at("lit", "button"))
		await remote.dispatch(at("weather", "sp-menu"), "select", { value: "opt:storm" })
		await remote.click(at("danger", "button"))
		await remote.input(at("danger", "input"), "9")
		await remote.pressKey(at("danger", "input"), "Enter")
		await remote.click(at("danger", "button"))
		await remote.input(at("danger", "input"), "1")
		await remote.pressKey(at("danger", "input"), "Escape")
		await settle()
		expect(writes()).toEqual([
			lit,
			weather,
			{ sessionId: SESSION, owner: { kind: "session", id: SESSION }, slotId: id("danger"), value: 5 }
		])
	})

	test("a cast member's value is written as that cast member", { timeout: 60_000 }, async () => {
		const remote = await mountRemote("stats")
		await remote.click(`[data-owner-key="mira"] [data-slot-id="${id("hp")}"] button`)
		await remote.input(`[data-owner-key="mira"] [data-slot-id="${id("hp")}"] input`, "12")
		await remote.pressKey(`[data-owner-key="mira"] [data-slot-id="${id("hp")}"] input`, "Enter")
		await settle()
		expect(writes()).toEqual([
			{ sessionId: SESSION, owner: { kind: "session_cast", id: 11 }, slotId: id("hp"), value: 12 }
		])
	})
})

describe("R77: a refused write is the asking widget's own line", () => {
	test("the remote World State says it; the remote Stats beside it does not", { timeout: 60_000 }, async () => {
		const world = await mountRemote("world-state")
		const stats = await mountRemote("stats")
		await world.click(`[data-slot-id="${id("lit")}"] button`)
		const sent = wire.emitted.filter(([e]) => e === "state:set").at(-1)![1] as { requestId: string }
		serverSays("state:set:error", { sessionId: SESSION, requestId: sent.requestId, error: "You may not change the world here." })
		await world.settle()
		await stats.settle()
		expect(drawn(world.root).alerts).toEqual(["You may not change the world here."])
		expect(drawn(stats.root).alerts).toEqual([])
		// …and the store-wide line every native widget showed stays clear.
		expect(sessionState().error).toBeNull()
	})
})

describe("marked, where the native said nothing", () => {
	test("a required slot is marked; a retired one is greyed, marked and not editable", { timeout: 60_000 }, async () => {
		serverSays(
			"state:get",
			stateGet({
				slots: [slot("weather", "enum", { required: true }), slot("hp", "integer"), slot("gold", "integer", { retired: true })]
			})
		)
		const world = await mountRemote("world-state")
		expect(world.query(`[data-slot-id="${id("weather")}"] [data-widget-part~="stat-slot.required"]`)?.getAttribute("aria-label")).toBe("required")
		const stats = await mountRemote("stats")
		const gold = stats.query(`[data-owner-key="mira"] [data-slot-id="${id("gold")}"]`)!
		expect(gold.hasAttribute("data-retired")).toBe(true)
		// Read-only is words, never a disabled button (sheet redesign C9, 2026-10-18); the trail's button stays.
		expect(gold.querySelector('button:not([data-widget-part~="stats.trail-open"])') === null).toBe(true)
	})
})

/** The server's answer with a place in play (attributes phase 4): the harbor holds gold. */
function withPlace() {
	const answer = stateGet()
	return {
		...answer,
		state: { ...answer.state, locations: { byId: { "41": { "core.gold": 5 } } } },
		owners: [
			...answer.owners,
			{ key: "location:harbor", kind: "session_location" as const, id: 41, label: "Harbor", configs: { [id("gold")]: {} } },
			{ key: "location:crypt", kind: "session_location" as const, id: 42, label: "Crypt", configs: { [id("gold")]: {} } }
		]
	}
}

describe("W7: World State is Stats — one widget for every owner's state", () => {
	test.each([
		[{}, { owners: "world", arrangement: "strip" }],
		[
			{ layout: "list", slots: "pick", pickSlots: ["Omen", "danger"] },
			{ owners: "world", arrangement: "list", slots: "pick", pickSlots: ["Omen", "danger"] }
		]
	] as const)("Stats in World State's settings %j draws what the native World State drew", { timeout: 60_000 }, async (was, settings) => {
		const native = NATIVE_DREW[`world-state ${JSON.stringify(was)}`] as ReturnType<typeof drawn>
		const remote = await mountRemote("stats", settings)
		expect(remote.refused).toEqual([])
		// Recorded under World State's key by the alias case above: compared, never re-recorded here.
		expect(drawn(remote.root)).toEqual({ ...native, widget: "stats" })
		expect(remote.query("[data-state-widget]")?.getAttribute("data-arrangement")).toBe(settings.arrangement)
	})

	test("owners all: a head per kind — world, cast, places — and a card per owner", { timeout: 60_000 }, async () => {
		serverSays("state:get", withPlace())
		const remote = await mountRemote("stats", { owners: "all", castScope: "all" })
		const groups = [...remote.root.querySelectorAll('[data-widget-part~="stats.group"]')].map((g) => [
			g.getAttribute("data-owner-group"),
			text(g.querySelector('[data-widget-part~="stats.group-head"]'))
		])
		expect(groups).toEqual([
			["world", "World"],
			["cast", "Cast"],
			["places", "Places"]
		])
		// The crypt holds nothing in play, so it is not drawn.
		expect(drawn(remote.root).cards).toEqual([
			["world", "World"],
			["mira", "Mira"],
			["bram", "Bram"],
			["location:harbor", "Harbor"]
		])
	})

	test("slots bars: only the numbers with a floor and a ceiling", { timeout: 60_000 }, async () => {
		const remote = await mountRemote("stats", { owners: "all", slots: "bars" })
		expect(drawn(remote.root).slots.map((s) => [s.id, s.fill])).toEqual([
			[id("danger"), 60],
			[id("hp"), 70]
		])
	})

	test("arrangement strip: the world's slots bare, each other owner a named line, every slot compact", { timeout: 60_000 }, async () => {
		serverSays("state:get", withPlace())
		const remote = await mountRemote("stats", { owners: "all", arrangement: "strip" })
		expect(remote.query("[data-state-widget]")?.getAttribute("data-arrangement")).toBe("strip")
		expect(remote.root.querySelectorAll('[data-widget-part~="stats.card"]').length).toBe(0)
		const lines = [...remote.root.querySelectorAll('[data-widget-part~="stats.strip"]')].map((l) => [
			l.getAttribute("data-owner-key"),
			text(l.querySelector('[data-widget-part~="stats.strip-name"]'))
		])
		expect(lines).toEqual([
			["mira", "Mira"],
			["location:harbor", "Harbor"]
		])
		expect(remote.query(`[data-slot-id="${id("weather")}"]`)?.closest('[data-widget-part~="stats.strip"]')).toBeNull()
		const rows = [...remote.root.querySelectorAll('[data-widget-part~="stat-slot.root"]')]
		expect(rows.length).toBeGreaterThan(0)
		expect(rows.every((r) => r.getAttribute("data-density") === "compact")).toBe(true)
	})

	test("owners places: each place in play, its valued stats only; an edit is written as the place", { timeout: 60_000 }, async () => {
		serverSays("state:get", withPlace())
		const remote = await mountRemote("stats", { owners: "places" })
		const seen = drawn(remote.root)
		expect(seen.cards).toEqual([["location:harbor", "Harbor"]])
		expect(seen.slots.map((s) => s.id)).toEqual([id("gold")])
		const gold = `[data-owner-key="location:harbor"] [data-slot-id="${id("gold")}"]`
		await remote.click(`${gold} button`)
		await remote.input(`${gold} input`, "7")
		await remote.pressKey(`${gold} input`, "Enter")
		await settle()
		expect(writes()).toEqual([
			{ sessionId: SESSION, owner: { kind: "session_location", id: 41 }, slotId: id("gold"), value: 7 }
		])
	})
})

describe("F2: a stat's trail, from the button beside it", () => {
	test("opened, it asks the page for that owner's slot in the page's session, and lists the changes newest first — for a guest too", { timeout: 60_000 }, async () => {
		const asked: unknown[] = []
		const read: StatTrailRead = async (ask) => {
			asked.push(ask)
			return {
				sessionId: ask.sessionId,
				trail: {
					changes: [
						{ messageId: 21, at: Date.UTC(2026, 9, 1, 10), from: 20, to: 17, by: "model" },
						{ messageId: 24, at: Date.UTC(2026, 9, 1, 11), from: 17, to: 14, by: "user" }
					]
				}
			}
		}
		const view = await mountComponent({
			root: CORE_CATALOG,
			entry: "dist/components/stats.js",
			owner: "core",
			timeoutMs: 60_000,
			context: {
				session: { id: SESSION, name: "Proof" },
				settings: {},
				viewer: { userId: 2, isAdmin: false, isGuest: true },
				scoped: { session_state: section() }
			},
			requests: (kind, params) => (kind === "stat-trail" ? answerStatTrail(params as never, SESSION, read) : undefined)
		})
		remotes.push(view)
		const hp = `[data-owner-key="mira"] [data-slot-id="${id("hp")}"]`
		const button = view.query(`${hp} [data-widget-part~="stats.trail-open"]`)
		expect(button?.getAttribute("aria-label")).toBe("How Hp changed")
		// The row keeps the control where it was: the trail is the row's last piece.
		expect(view.query(hp)?.lastElementChild?.getAttribute("data-widget-part")).toBe("stats.trail")
		expect(asked).toEqual([])
		await view.dispatch(`${hp} sp-popover`, "open-change", { open: true })
		await settle()
		expect(asked).toEqual([
			{ sessionId: SESSION, owner: { kind: "session_cast", id: 11 }, slotId: id("hp"), limit: 20 }
		])
		const rows = view.queryAll(`${hp} [data-widget-part~="stats.trail-row"]`)
		expect(rows.map((r) => [r.getAttribute("data-message-id"), text(r.querySelector('[data-widget-part~="stats.trail-value"]'))])).toEqual([
			["24", "17 → 14"],
			["21", "20 → 17"]
		])
		expect(text(rows[0]!.querySelector('[data-widget-part~="stats.trail-by"]'))).toMatch(/^Edited · /)
		expect(text(view.query(`${hp} [data-widget-part~="stats.trail-head"]`))).toBe("Hp · Mira")
		// Nothing was written: reading a trail is not an edit.
		expect(writes()).toEqual([])
	})

	test("a refusal is said in the popover, never as the widget's alert; with trail off there is no button", { timeout: 60_000 }, async () => {
		const read: StatTrailRead = async (ask) => ({ sessionId: ask.sessionId, error: "This session is not one you are in." })
		const view = await mountComponent({
			root: CORE_CATALOG,
			entry: "dist/components/stats.js",
			owner: "core",
			timeoutMs: 60_000,
			context: {
				session: { id: SESSION, name: "Proof" },
				settings: { owners: "world" },
				viewer: { userId: 1, isAdmin: false, isGuest: false },
				scoped: { session_state: section() }
			},
			requests: (kind, params) => (kind === "stat-trail" ? answerStatTrail(params as never, SESSION, read) : undefined)
		})
		remotes.push(view)
		const weather = `[data-slot-id="${id("weather")}"]`
		// A derived stat has no trail to show.
		expect(view.query(`[data-slot-id="${id("tension")}"] [data-widget-part~="stats.trail-open"]`)).toBeNull()
		await view.dispatch(`${weather} sp-popover`, "open-change", { open: true })
		await settle()
		expect(text(view.query(`${weather} [data-widget-part~="stats.trail-note"][role="alert"]`))).toBe(
			"This session is not one you are in."
		)
		expect(view.query('[data-widget-part~="stats.alert"]')).toBeNull()
		await view.push("settings", { owners: "world", trail: false })
		expect(view.queryAll('[data-widget-part~="stats.trail-open"]').length).toBe(0)
	})
})

describe("🚧 another player's seat is drawn, never edited (2026-10-16)", () => {
	test("Ann's sheet has no live controls for Bo; Bo's own does", { timeout: 60_000 }, async () => {
		const base = stateGet()
		serverSays("state:get", {
			...base,
			state: {
				...base.state,
				cast: { byId: { "player_seat:1": { "core.hp": 9 }, "player_seat:2": { "core.hp": 4 } } }
			},
			owners: [
				base.owners[0],
				{ key: "player_seat:1", kind: "player_seat" as const, id: 1, label: "Ann", editable: false, configs: { [id("hp")]: { min: 0, max: 10 } } },
				{ key: "player_seat:2", kind: "player_seat" as const, id: 2, label: "Bo", editable: true, configs: { [id("hp")]: { min: 0, max: 10 } } }
			]
		})
		expect(section().owners.find((o) => o.label === "Ann")?.editable).toBe(false)
		const remote = await mountRemote("stats")
		const hp = (key: string) =>
			remote.query<HTMLButtonElement>(`[data-owner-key="${key}"] [data-slot-id="${id("hp")}"] button:not([data-widget-part~="stats.trail-open"])`)
		// Not hers to write: Ann's row is words, no button at all (C9); Bo's own is live.
		expect(hp("player_seat:1") === null).toBe(true)
		expect(hp("player_seat:2")?.disabled).toBe(false)
		expect(remote.query(`[data-owner-key="player_seat:1"] [data-slot-id="${id("hp")}"] input`) === null).toBe(true)
		await settle()
		expect(writes()).toEqual([])
	})
})

describe("🚧 Q1-3: the sheet stays whole on a live update (PLAN-dc-after-walk2, the walk's N8)", () => {
	test("Armour class is still drawn after a `state:changed` re-read and a write's own reply", { timeout: 60_000 }, async () => {
		const base = stateGet()
		const seat = (hp: number) => ({
			...base,
			state: { ...base.state, cast: { byId: { "player_seat:1": { "core.hp": hp } } } },
			owners: [
				base.owners[0],
				{
					key: "player_seat:1",
					kind: "player_seat" as const,
					id: 1,
					label: "Ann",
					seat: true,
					derived: [{ key: "armour-class", label: "Armour class", value: 15 }],
					configs: { [id("hp")]: { min: 0, max: 10 } }
				}
			]
		})
		serverSays("state:get", seat(9))
		const remote = await mountRemote("stats", { owners: "seats" })
		const armour = () => text(remote.query('[data-derived="armour-class"] [data-widget-part~="stat-slot.line"]'))
		expect(armour()).toBe("15")
		// A live story update: the store re-reads on `state:changed`, the
		// server answers, and the page posts the new section.
		wire.emitted.length = 0
		serverSays("state:changed", { sessionId: SESSION })
		expect(wire.emitted.some(([event]) => event === "state:get")).toBe(true)
		serverSays("state:get", seat(6))
		await remote.push("scoped", { session_state: section() })
		expect(armour()).toBe("15")
		// A write's own reply carries the values alone: the owners — and their derived rows — stand.
		serverSays("state:set", { sessionId: SESSION, state: seat(5).state })
		await remote.push("scoped", { session_state: section() })
		expect(armour()).toBe("15")
		expect(section().owners.find((o) => o.key === "player_seat:1")?.derived).toEqual([
			{ key: "armour-class", label: "Armour class", value: 15 }
		])
	})
})
