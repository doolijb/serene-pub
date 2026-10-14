/**
 * Core's remote Places widget (PLAN-core-widgets W4) — the built module
 * (`@serene-pub/core-catalog/components/places.js`) mounted through the
 * SDK's component harness in core's box, posted the sections its
 * declaration reads and the session's state it is granted, and answered as
 * the session page answers it: one `session-places` for the places and the
 * ways, `open-lore` for a place's entry. The list draws a row per place
 * (Here, the faces of who stands there, the ways out); the map is the shared
 * map canvas (squares, arrows, Here ringed), whose square opens the place's
 * detail.
 */
import { afterAll, describe, expect, test } from "vitest"
import { createRequire } from "node:module"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import type { SessionPlacesV1, SessionStateV1, ViewerV1 } from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"

const require = createRequire(import.meta.url)
const BUILT = require.resolve("@serene-pub/core-catalog/components/places.js")
const CORE_CATALOG = BUILT.replace(/\/dist\/components\/places\.js$/, "")
const DECL = CORE_WIDGETS.find((w) => w.id === "places")!

const VIEWER: ViewerV1 = { userId: 10, isAdmin: false, isGuest: false }
const LOC = "core:slot/location@1"

const ANSWER: SessionPlacesV1 = {
	lorebookId: 4,
	asOf: null,
	places: [
		{
			id: 1,
			name: "The Guardroom",
			category: "Upper floor",
			tint: 1,
			linked: []
		},
		{
			id: 2,
			name: "The Drowned Hall",
			category: "Cellars",
			tint: 0,
			linked: []
		},
		{
			id: 3,
			name: "The Crypt",
			category: "Cellars",
			tint: 0,
			linked: [
				{
					kind: "cast",
					id: 5,
					name: "Verity",
					says: "Verity keeps The Crypt."
				}
			]
		}
	],
	ways: [
		{
			id: 10,
			from: 1,
			to: 2,
			bothWays: true,
			name: "the rusted iron door",
			fromSays: "The rusted iron door leads north to The Drowned Hall.",
			toSays: "The rusted iron door leads south to The Guardroom."
		},
		{
			id: 11,
			from: 2,
			to: 3,
			bothWays: false,
			name: null,
			fromSays: "Leads down to The Crypt.",
			toSays: null
		}
	]
}

/** The world in the Guardroom; Mira in the Hall; the Crypt holding a key. */
const STATE: SessionStateV1 = {
	sessionId: 1,
	loaded: true,
	error: null,
	resolved: {
		world: { "core.location": { entryId: 1, name: "The Guardroom" } },
		cast: { mira: { "core.location": { entryId: 2 } } },
		locations: {
			"place:3": {
				"core.inventory": [{ entryId: 9, name: "Rusty key", count: 2 }]
			}
		}
	},
	slots: [
		{
			slotId: LOC,
			key: "location",
			qualifiedKey: "core.location",
			label: "Location",
			type: "text",
			appliesTo: ["world", "cast"]
		},
		{
			slotId: "core:slot/inventory@1",
			key: "inventory",
			qualifiedKey: "core.inventory",
			label: "Inventory",
			type: "list",
			appliesTo: ["location"]
		}
	] as SessionStateV1["slots"],
	owners: [
		{
			key: "world",
			kind: "session",
			id: 1,
			label: "World",
			configs: { [LOC]: {} }
		},
		{
			key: "mira",
			kind: "session_cast",
			id: 11,
			label: "Mira",
			configs: { [LOC]: {} }
		},
		{
			key: "place:3",
			kind: "session_location",
			id: 3,
			label: "The Crypt",
			configs: { "core:slot/inventory@1": {} }
		}
	]
}

type Asked = { kind: string; params: unknown }
const views: MountedComponent[] = []

async function mountPlaces(
	o: {
		answer?: SessionPlacesV1 | (() => SessionPlacesV1)
		settings?: Record<string, unknown>
		state?: SessionStateV1
		refuse?: Record<string, string>
		grants?: ("lore" | "session:state")[]
	} = {}
) {
	const asked: Asked[] = []
	const answer = o.answer ?? ANSWER
	const view = await mountComponent({
		entry: BUILT,
		root: CORE_CATALOG,
		owner: "core",
		timeoutMs: 60_000,
		reads: DECL.reads,
		...(o.grants ? { grants: o.grants } : {}),
		context: {
			settings: o.settings ?? {},
			viewer: VIEWER,
			scoped: { session_state: o.state ?? STATE }
		},
		requests: (kind, params) => {
			asked.push({ kind, params })
			if (o.refuse?.[kind]) throw new Error(o.refuse[kind])
			if (kind === "session-places")
				return typeof answer === "function" ? answer() : answer
			if (kind === "open-lore") return undefined
			throw new Error(`not asked: ${kind}`)
		}
	})
	views.push(view)
	await view.settle()
	return { view, asked }
}

afterAll(async () => {
	for (const v of views) await v.unmount()
})

const part = (name: string) => `[data-widget-part~="places.${name}"]`
const map = (name: string) => `[data-widget-part~="map-canvas.${name}"]`
const text = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, " ").trim() ?? null

describe("core's remote Places", () => {
	test(
		"without the session:state grant: the places still list, nobody in them, and one line says why",
		{ timeout: 120_000 },
		async () => {
			const { view, asked } = await mountPlaces({ grants: ["lore"] })
			expect(asked).toEqual([{ kind: "session-places", params: {} }])
			const note = view.query(part("grant-note"))
			expect(note?.getAttribute("data-scope-not-granted")).toBe(
				"session:state"
			)
			expect(text(note)).toMatch(/not been granted/)
			expect(view.queryAll(part("row"))).toHaveLength(3)
			expect(view.queryAll(part("present"))).toHaveLength(0)
			// Granted after an admin's review: the line goes.
			await view.setGrants(["lore", "session:state"])
			await view.settle()
			expect(view.query(part("grant-note"))).toBeNull()
			expect(view.errors).toEqual([])
		}
	)

	test(
		"core's own copy holds the grant: no such line",
		{ timeout: 120_000 },
		async () => {
			const { view } = await mountPlaces()
			expect(view.query(part("grant-note"))).toBeNull()
		}
	)

	test(
		"the list: a row per place by category, Here on the world's place, faces where the cast stand, the ways out",
		{ timeout: 120_000 },
		async () => {
			const { view, asked } = await mountPlaces()
			expect(view.refused).toEqual([])
			expect(asked).toEqual([{ kind: "session-places", params: {} }])
			expect(text(view.query(part("headline")))).toBe("3 places · 2 ways")
			const rows = view.queryAll(part("row"))
			expect(
				rows.map((r) => [
					text(r.querySelector(part("name"))),
					text(r.querySelector(part("category"))),
					r.getAttribute("data-tint"),
					r.hasAttribute("data-here")
				])
			).toEqual([
				["The Drowned Hall", "Cellars", "0", false],
				["The Crypt", "Cellars", "0", false],
				["The Guardroom", "Upper floor", "1", true]
			])
			expect(text(rows[2]!.querySelector(part("here")))).toBe("Here")
			// Mira stands in the Hall: her face, said as who is here.
			const present = rows[0]!.querySelector(part("present"))!
			expect(present.getAttribute("aria-label")).toBe("Mira here")
			expect(
				present.querySelector("sp-avatar")?.getAttribute("ref")
			).toBe("character:11")
			expect(rows[1]!.querySelector(part("present"))).toBeNull()
			expect(text(rows[0]!.querySelector(part("ways")))).toBe(
				"→ The Guardroom, The Crypt"
			)
			expect(rows[1]!.querySelector(part("ways"))).toBeNull()
			expect(view.errors).toEqual([])
		}
	)

	test(
		"a row's press opens the place's entry in the lorebook",
		{ timeout: 120_000 },
		async () => {
			const { view, asked } = await mountPlaces()
			await view.click(view.queryAll(part("row-open"))[1]!)
			await view.settle()
			expect(asked.at(-1)).toEqual({
				kind: "open-lore",
				params: { lorebookId: 4, scope: "places", entryId: 3 }
			})
		}
	)

	test(
		"view: map draws the squares and the arrows, Here ringed, faces on squares; a square opens its detail",
		{ timeout: 120_000 },
		async () => {
			const { view, asked } = await mountPlaces({
				settings: { view: "map" }
			})
			expect(view.query(part("list"))).toBeNull()
			const nodes = view.queryAll(map("node"))
			expect(
				nodes.map((n) => n.getAttribute("data-node-id")).sort()
			).toEqual(["place:1", "place:2", "place:3"])
			const guard = view.query(`${map("node")}[data-node-id="place:1"]`)!
			expect(guard.hasAttribute("data-here")).toBe(true)
			expect(guard.querySelector(map("here"))).not.toBeNull()
			expect(guard.getAttribute("aria-label")).toBe(
				"The Guardroom, here, Upper floor"
			)
			expect(guard.getAttribute("style")).toMatch(
				/--sp-map-x: [\d.]+; --sp-map-y: [\d.]+/
			)
			const hall = view.query(`${map("node")}[data-node-id="place:2"]`)!
			expect(
				hall
					.querySelector(`${map("face")} sp-avatar`)
					?.getAttribute("ref")
			).toBe("character:11")
			const edges = view.queryAll(map("edge"))
			expect(
				edges.map((e) => [
					e.getAttribute("data-edge-id"),
					e.hasAttribute("data-both")
				])
			).toEqual([
				["way:10", true],
				["way:11", false]
			])
			expect(edges[0]!.getAttribute("style")).toMatch(
				/--sp-map-len: [\d.]+; --sp-map-angle: -?[\d.]+/
			)

			// A square: its detail — ways said from it, what is linked, its stats, Open entry.
			await view.click(`${map("node")}[data-node-id="place:3"]`)
			await view.settle()
			const detail = view.query(part("detail"))!
			expect(text(detail.querySelector(part("detail-name")))).toBe(
				"The Crypt"
			)
			expect(
				view
					.query(`${map("node")}[data-node-id="place:3"]`)
					?.getAttribute("aria-pressed")
			).toBe("true")
			expect(text(detail.querySelector(part("detail-none")))).toBe(
				"No way out of here yet."
			)
			expect(text(detail.querySelector(part("linked")))).toBe(
				"Verity keeps The Crypt."
			)
			expect(text(detail.querySelector(`${part("stats")} dt`))).toBe(
				"Inventory"
			)
			expect(text(detail.querySelector(`${part("stats")} dd`))).toBe(
				"Rusty key ×2"
			)
			await view.click(part("open"))
			await view.settle()
			expect(asked.at(-1)).toEqual({
				kind: "open-lore",
				params: { lorebookId: 4, scope: "places", entryId: 3 }
			})

			// The Hall: both ways said from it, and who is here.
			await view.click(`${map("node")}[data-node-id="place:2"]`)
			await view.settle()
			const hallDetail = view.query(part("detail"))!
			expect(
				[
					...hallDetail.querySelectorAll(`${part("detail-ways")} li`)
				].map(text)
			).toEqual([
				"The rusted iron door leads south to The Guardroom.",
				"Leads down to The Crypt."
			])
			expect(text(hallDetail.querySelector(part("detail-present")))).toBe(
				"Mira"
			)
			await view.click(part("close"))
			await view.settle()
			expect(view.query(part("detail"))).toBeNull()
		}
	)

	test(
		"the flip shows the map from a list, and back; zoom steps",
		{ timeout: 120_000 },
		async () => {
			const { view } = await mountPlaces()
			expect(text(view.query(part("flip")))).toBe("Show the map")
			await view.click(part("flip"))
			await view.settle()
			expect(view.queryAll(map("node"))).toHaveLength(3)
			expect(text(view.query(`${map("zoom")}[data-zoom="reset"]`))).toBe(
				"100%"
			)
			await view.click(`${map("zoom")}[data-zoom="in"]`)
			await view.settle()
			expect(text(view.query(`${map("zoom")}[data-zoom="reset"]`))).toBe(
				"125%"
			)
			expect(view.query(map("surface"))?.getAttribute("style")).toMatch(
				/--sp-map-zoom: 1\.25/
			)
			await view.click(part("flip"))
			await view.settle()
			expect(view.queryAll(part("row"))).toHaveLength(3)
		}
	)

	test(
		"categories narrow the places; highlight world draws no faces; showWays off writes no ways",
		{ timeout: 120_000 },
		async () => {
			const { view } = await mountPlaces({
				settings: {
					categories: ["cellars"],
					highlight: "world",
					showWays: false
				}
			})
			expect(
				view
					.queryAll(part("row"))
					.map((r) => text(r.querySelector(part("name"))))
			).toEqual(["The Drowned Hall", "The Crypt"])
			expect(text(view.query(part("headline")))).toBe(
				"2 of 3 places · 1 way"
			)
			expect(view.query(part("present"))).toBeNull()
			expect(view.query(part("ways"))).toBeNull()
		}
	)

	test(
		"the empty lines say why; a refused read is the widget's own line",
		{ timeout: 120_000 },
		async () => {
			const none = await mountPlaces({
				answer: { ...ANSWER, places: [], ways: [] }
			})
			expect(text(none.view.query(part("empty")))).toBe(
				"This book has no places yet."
			)
			const noBook = await mountPlaces({
				answer: { lorebookId: null, asOf: null, places: [], ways: [] }
			})
			expect(text(noBook.view.query(part("empty")))).toBe(
				"This session reads no lorebook."
			)
			const refused = await mountPlaces({
				refuse: {
					"session-places": "This session is not one you are in."
				}
			})
			expect(text(refused.view.query(part("alert")))).toBe(
				"Not read: This session is not one you are in."
			)
		}
	)

	test("the story moving asks again", { timeout: 120_000 }, async () => {
		let name = "The Guardroom"
		const { view, asked } = await mountPlaces({
			answer: () => ({
				...ANSWER,
				places: ANSWER.places.map((p) =>
					p.id === 1 ? { ...p, name } : p
				)
			})
		})
		name = "The Watch Room"
		await view.event({ kind: "story:moved" })
		await new Promise((r) => setTimeout(r, 300))
		await view.settle()
		expect(asked.filter((a) => a.kind === "session-places")).toHaveLength(2)
		expect(view.queryAll(part("name")).map(text)).toContain(
			"The Watch Room"
		)
	})
})
