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
 * slot is not editable).
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest"
import { realpathSync } from "node:fs"
import { resolve } from "node:path"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import type { SessionStateV1 } from "@serene-pub/sdk"
import { projectSessionState } from "./projections/sessionState"
import { answerSetAttributeValue } from "./requests/setAttributeValue"
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
function drawn(root: Element) {
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
		text(c.querySelector("header"))
	])
	return {
		widget: widget?.getAttribute("data-state-widget"),
		owner: widget?.getAttribute("data-owner-key") ?? null,
		alerts: [...root.querySelectorAll("[role='alert']")].map(text),
		cards,
		slots,
		empty: slots.length || cards.length ? null : text(widget)
	}
}

type Slug = "world-state" | "stats"

const remotes: MountedComponent[] = []
async function mountRemote(slug: Slug, settings: Record<string, unknown> = {}) {
	const view = await mountComponent({
		root: CORE_CATALOG,
		entry: `dist/components/${slug}.js`,
		owner: "core",
		timeoutMs: 60_000,
		context: {
			session: { id: SESSION, name: "Proof" },
			settings,
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
		const native = NATIVE_DREW[`${slug} ${JSON.stringify(settings)}`] as ReturnType<typeof drawn>
		expect(native.widget).toBe(slug)
		const remote = await mountRemote(slug, settings)
		expect(remote.refused).toEqual([])
		expect(drawn(remote.root)).toEqual(native)
	})
})

describe("the empty states", () => {
	test.each([
		["world-state", { slots: [] }],
		["stats", { slots: [] }],
		["stats", { castValues: false }]
	] as const)("%s %j", { timeout: 60_000 }, async (slug, over) => {
		serverSays("state:get", stateGet(over))
		const native = NATIVE_DREW[`${slug} ${JSON.stringify(over)}`] as ReturnType<typeof drawn>
		expect(native.empty).toBeTruthy()
		expect(drawn((await mountRemote(slug)).root)).toEqual(native)
	})

	test("world state with no world owner says what the native said", { timeout: 60_000 }, async () => {
		const answer = stateGet()
		serverSays("state:get", { ...answer, owners: answer.owners.filter((o) => o.key !== "world") })
		const native = NATIVE_DREW["world-state no world owner"] as ReturnType<typeof drawn>
		expect(native.empty).toMatch(/declares no stats to show here/)
		expect(drawn((await mountRemote("world-state")).root)).toEqual(native)
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
		expect(native.alerts).toEqual(["Could not read this session's state."])
		expect(drawn((await mountRemote("world-state")).root).alerts).toEqual(native.alerts)
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
		expect(gold.querySelector("button")?.hasAttribute("disabled")).toBe(true)
	})
})
