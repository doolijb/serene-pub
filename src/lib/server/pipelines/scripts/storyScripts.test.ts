/**
 * 🚧 The Story genre's after-the-reply scripts in the real QuickJS sandbox
 * (`runScriptSource`) — lane 2 of PLAN-genre-restructure (2026-10-19): what
 * each background task's mode does to the reckoning's and the sweep's
 * answers, and the *Read the scene* gate.
 */

import { describe, it, expect } from "vitest"
import { runScriptSource } from "$lib/server/pipelines/scripts/host"
import { CORE_SCRIPTS } from "@serene-pub/core-catalog"

const source = (seedKey: string) => {
	const s = CORE_SCRIPTS.find((c) => c.seedKey === seedKey)
	expect(s, `${seedKey} is seeded`).toBeTruthy()
	return (s as { source: string }).source
}
const run = async (seedKey: string, value: unknown) => {
	const r = await runScriptSource({ source: source(seedKey), vars: { value }, extras: {}, seedLabel: "test:story", nowMs: 1 })
	expect(r, JSON.stringify(r)).toMatchObject({ ok: true })
	return (r as { value: any }).value
}

const RECKON = "core:script/story-reckon"
const RECKON_CRIB = "core:script/story-reckon-crib"
const SWEEP = "core:script/story-sweep"
const SWEEP_CRIB = "core:script/story-sweep-crib"
const SCENE = "core:script/story-scene-reading"

const delta = (d: Record<string, unknown>) => ({
	owner: "character:4",
	op: "add",
	slot: "",
	repertoire: "",
	piece: "",
	value: "",
	check: "",
	against: 0,
	reason: "it happened",
	...d
})

describe("the reckoning, by mode", () => {
	it("Review carries pieces as their own list instead of dropping them", async () => {
		const out = await run(RECKON, {
			json: {
				deltas: [
					delta({ repertoire: "things", piece: "Rope" }),
					delta({ repertoire: "conditions", piece: "Tired" })
				],
				clock: [],
				place: []
			},
			modes: { attributes: "review", conditions: "full" },
			state: {},
			ruleset: { rigour: "prose" }
		})
		expect(out.pieces).toEqual([expect.objectContaining({ repertoire: "conditions", piece: "Tired" })])
		expect(out.piecesReview).toEqual([expect.objectContaining({ repertoire: "things", piece: "Rope" })])
	})

	it("at scripts rigour, Full and Review split between apply and propose", async () => {
		const out = await run(RECKON, {
			json: { deltas: [delta({ slot: "hp", op: "spend", value: "2" }), delta({ repertoire: "conditions", piece: "Poisoned" })], clock: [], place: [] },
			modes: { attributes: "full", conditions: "review" },
			state: {},
			ruleset: { rigour: "scripts" }
		})
		expect(out.scripts).toHaveLength(1)
		expect(out.scriptsReview).toEqual([expect.objectContaining({ piece: "Poisoned" })])
		expect(out.pieces).toBeNull()
	})

	it("a thing the lorebook keeps as an item becomes an item line, so its supply is checked", async () => {
		const out = await run(RECKON, {
			json: {
				deltas: [delta({ repertoire: "things", piece: "The Crown", op: "add", value: "1" }), delta({ repertoire: "things", piece: "Rope" })],
				clock: [],
				place: []
			},
			modes: { attributes: "full" },
			state: {},
			ruleset: { rigour: "prose" },
			supply: [{ entryId: 31, name: "the crown", supply: "unique", remaining: 0 }]
		})
		expect(out.words).toEqual([{ owner: "character:4", entryId: 31, delta: 1 }])
		expect(out.pieces).toEqual([expect.objectContaining({ piece: "Rope" })])
	})

	it("a task Off drops its deltas", async () => {
		const out = await run(RECKON, {
			json: { deltas: [delta({ repertoire: "conditions", piece: "Tired" })], clock: [], place: [] },
			modes: { attributes: "full", conditions: "off" },
			state: {},
			ruleset: { rigour: "prose" }
		})
		expect(out.pieces).toBeNull()
		expect(out.piecesReview).toBeNull()
	})
})

describe("Describe new places, in the reckoning", () => {
	const places = [{ id: 7, name: "The Gatehouse", links: [] }]
	const answer = (name: string) => ({
		deltas: [],
		clock: [],
		place: [{ name, content: "A cold stone room.", ways: ["The Gatehouse", "The Well"] }]
	})

	it("a new place is filed with links to the places the book knows, the rest said in words", async () => {
		const out = await run(RECKON, { json: answer("The Crypt"), modes: { "places-on-move": "full" }, state: {}, ruleset: {}, places })
		expect(out.placeFull).toEqual({
			name: "The Crypt",
			content: "A cold stone room.\n\nWays out: The Well.",
			links: [{ to: 7, linkType: "leads to", reverseLinkType: "leads to" }]
		})
		expect(out.placeReview).toBeNull()
	})

	it("Review holds it; a known place is left as written; Off files nothing", async () => {
		expect((await run(RECKON, { json: answer("The Crypt"), modes: { "places-on-move": "review" }, state: {}, ruleset: {}, places })).placeReview).toBeTruthy()
		const known = await run(RECKON, { json: answer("the gatehouse"), modes: { "places-on-move": "full" }, state: {}, ruleset: {}, places })
		expect(known.placeFull).toBeNull()
		const off = await run(RECKON, { json: answer("The Crypt"), modes: { "places-on-move": "off" }, state: {}, ruleset: {}, places })
		expect(off.placeFull).toBeNull()
	})

	it("the crib asks for a place only while the task is on, naming the places already described", async () => {
		const on = await run(RECKON_CRIB, { session: { sessionId: 1, cast: {} }, state: {}, reply: "They went down.", blocks: {}, ruleset: {}, modes: { "places-on-move": "full" }, places })
		expect(on.fields.canChange).toContain("The Gatehouse")
		const off = await run(RECKON_CRIB, { session: { sessionId: 1, cast: {} }, state: {}, reply: "x", blocks: {}, ruleset: {}, modes: {}, places })
		expect(off.fields.canChange).toBe("nothing")
	})
})

describe("the sweep", () => {
	it("relationships are kept, cleaned, on Full and Review alike; Off drops them", async () => {
		const json = {
			summary: { name: "", content: "" },
			lore: [],
			cast: [],
			worldState: [],
			relationships: [{ from: "Ash", to: "Rell", how: "wary allies" }, { from: "Ash", to: "ash", how: "self" }, { from: "", to: "Rell", how: "x" }],
			scenes: [],
			goals: ""
		}
		expect((await run(SWEEP, { json, modes: { relationships: "review" } })).relationships).toEqual([{ from: "Ash", to: "Rell", how: "wary allies" }])
		expect((await run(SWEEP, { json, modes: { relationships: "full" } })).relationships).toHaveLength(1)
		expect((await run(SWEEP, { json, modes: { relationships: "off" } })).relationships).toBeUndefined()
	})

	it("the goals are asked for as a checklist that keeps what is already noted", async () => {
		const out = await run(SWEEP_CRIB, {
			session: { cast: {}, annex: { core: { "story-goals": "- [ ] Find the key" } } },
			state: {},
			modes: { goals: "full" }
		})
		expect(out.brief).toContain("- [x] the goal")
		expect(out.crib).toContain("- [ ] Find the key")
	})
})

describe("Read the scene", () => {
	it("hands the state and the places on only while the task is on", async () => {
		const state = { world: { location: "The Crypt" } }
		const places = [{ id: 7, name: "The Crypt" }]
		expect(await run(SCENE, { modes: { "scene-reading": "full" }, state, places })).toEqual({ state, places })
		expect(await run(SCENE, { modes: { "scene-reading": "off" }, state, places })).toEqual({ state: null, places: [] })
		expect(await run(SCENE, { modes: {}, state, places })).toEqual({ state: null, places: [] })
	})
})
