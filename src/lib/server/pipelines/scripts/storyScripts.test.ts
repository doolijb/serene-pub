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

/** 🚧 One change, as the reckoning's one grammar answers it (S1): every member, empty text for none. */
const change = (d: Record<string, unknown>) => ({
	owner: "character:4",
	changes: "attribute",
	attribute: "",
	entryType: "",
	op: "add",
	value: "",
	name: "",
	reason: "it happened",
	...d
})
const entry = (entryType: string, name: string, op = "add") => change({ changes: "entry", entryType, name, op })

/** A reply schema as `ruleset-resolve` publishes it — the rules' attributes and entry types (here, Freeform's two). */
const replySchema = (attributes: string[], entryTypes: string[]) => ({
	type: "object",
	properties: {
		message: { type: "string" },
		changes: {
			type: "array",
			items: {
				type: "object",
				properties: {
					attribute: { type: "string", enum: [...attributes, ""] },
					entryType: { type: "string", enum: [...entryTypes, ""] },
					op: { type: "string", enum: ["add", "set", "remove"] }
				}
			}
		}
	}
})
const FREEFORM = replySchema([], ["things", "conditions"])

describe("the reckoning, by mode (S1: the rules' own change grammar)", () => {
	it("Review carries the rules' entries as their own list instead of dropping them", async () => {
		const out = await run(RECKON, {
			json: { changes: [entry("things", "Rope"), entry("conditions", "Tired")], clock: [], place: [] },
			modes: { attributes: "review", conditions: "full" },
			state: {},
			ruleset: { rigour: "prose" },
			schema: FREEFORM
		})
		expect(out.ruled).toEqual([{ owner: "character:4", op: "add", changes: "entry", entryType: "conditions", name: "Tired", reason: "it happened" }])
		expect(out.ruledHeld).toEqual([expect.objectContaining({ entryType: "things", name: "Rope" })])
	})

	it("what the rules keep goes to the handler, Full and Review split; what they keep nothing of is written in words", async () => {
		const out = await run(RECKON, {
			json: {
				changes: [
					change({ attribute: "nerve", op: "spend", value: "2" }),
					change({ attribute: "mood", op: "set", value: "grim" }),
					change({ attribute: "hp", op: "spend", value: "3" }),
					entry("troubles", "Poisoned")
				],
				clock: [],
				place: []
			},
			modes: { attributes: "full", conditions: "review" },
			state: { cast: { byId: { "4": { hp: 10 } } } },
			// The inlet's ruleset: its attributes (here a pool of its own) and its entry types, tagged.
			ruleset: { rigour: "scripts", attributes: [{ id: "nerve", kind: "pool", tags: ["resource"] }], entryTypes: [{ id: "troubles", tags: ["condition"] }] },
			schema: replySchema(["nerve"], ["troubles"])
		})
		expect(out.ruled).toEqual([{ owner: "character:4", op: "spend", changes: "attribute", attribute: "nerve", value: 2, reason: "it happened" }])
		expect(out.ruledHeld).toEqual([expect.objectContaining({ entryType: "troubles", name: "Poisoned" })])
		expect(out.words).toEqual([
			{ owner: "character:4", slot: "mood", value: "grim" },
			{ owner: "character:4", slot: "hp", value: 7 }
		])
		expect(out.owners).toEqual(["character:4"])
	})

	it("an attribute the rules only borrow is the sheets' — written in words, as the reply schema leaves it out", async () => {
		const out = await run(RECKON, {
			json: { changes: [change({ attribute: "hp", op: "spend", value: "3" }), change({ attribute: "might", op: "add", value: "1" })], clock: [], place: [] },
			modes: { attributes: "full" },
			state: { cast: { byId: { "4": { hp: 9 } } } },
			// Its own attribute (not in a reply schema: the rules are not installed), and one it borrows.
			ruleset: { rigour: "prose", attributes: [{ id: "hp", kind: "number", tags: [], borrowed: true }, { id: "might", kind: "number", tags: [] }] },
			schema: null
		})
		expect(out.words).toEqual([{ owner: "character:4", slot: "hp", value: 6 }])
		expect(out.ruled).toEqual([expect.objectContaining({ attribute: "might", op: "add", value: 1 })])
	})

	it("a thing the lorebook keeps as an item becomes an item line, so its supply is checked", async () => {
		const out = await run(RECKON, {
			json: { changes: [entry("things", "The Crown"), entry("things", "Rope")], clock: [], place: [] },
			modes: { attributes: "full" },
			state: {},
			ruleset: { rigour: "prose" },
			schema: FREEFORM,
			supply: [{ entryId: 31, name: "the crown", supply: "unique", remaining: 0 }]
		})
		expect(out.words).toEqual([{ owner: "character:4", entryId: 31, delta: 1 }])
		expect(out.ruled).toEqual([expect.objectContaining({ name: "Rope" })])
	})

	it("a duty Off drops its changes; a change naming nothing is dropped", async () => {
		const out = await run(RECKON, {
			json: { changes: [entry("conditions", "Tired"), change({ attribute: "" }), entry("things", "")], clock: [], place: [] },
			modes: { attributes: "full", conditions: "off" },
			state: {},
			ruleset: { rigour: "prose" },
			schema: FREEFORM
		})
		expect(out.ruled).toBeNull()
		expect(out.ruledHeld).toBeNull()
		expect(out.words).toBeNull()
	})
})

describe("the reckoning's crib writes the call's schema (S1)", () => {
	const session = { sessionId: 1, cast: { sessionCharacters: [{ character: { id: 4, name: "Brannoc" } }] } }
	const state = {
		slots: [
			{ id: "core:slot/hp@1", key: "hp", type: "integer" },
			{ id: "core:slot/mood@1", key: "mood", type: "enum" },
			{ id: "core:slot/inventory@1", key: "inventory", type: "list" },
			{ id: "core:slot/whisper@1", key: "whisper", type: "text", earshot: "holder" },
			{ id: "acme.pack:slot/nerve@1", key: "nerve", type: "integer" }
		],
		world: {},
		cast: { byId: {} }
	}
	it("the rules' words and the sheets' own, by duty, in the subset every backend compiles", async () => {
		const out = await run(RECKON_CRIB, {
			session,
			state,
			reply: "Brannoc steps forward.",
			blocks: {},
			ruleset: { rigour: "mechanics", entryTypes: [{ id: "troubles", tags: ["condition"] }, { id: "boons", tags: ["boon"] }] },
			modes: { attributes: "full", conditions: "review" },
			places: [],
			schema: replySchema(["nerve"], ["troubles", "boons"])
		})
		const item = out.schema.properties.changes.items
		expect(item.properties.owner.enum).toEqual(["world", "character:4"])
		// The rules' attribute first, then the sheets' words — never a list, never a value only its holder hears.
		expect(item.properties.attribute.enum).toEqual(["nerve", "hp", "mood", ""])
		expect(item.properties.entryType.enum).toEqual(["boons", "troubles", ""])
		expect(item.properties.changes.enum).toEqual(["attribute", "entry"])
		// No nulls anywhere: a grammar-compiling backend takes it as it is.
		expect(JSON.stringify(out.schema)).not.toContain("null")
		expect(out.schema.required).toEqual(["changes", "clock", "place"])
		expect(out.fields.canChange).toContain("nerve, hp, mood")
		expect(out.fields.canChange).toContain("kept as troubles")
		expect(out.fields.rigourLine).toContain("propose no check")
	})

	it("a duty Off leaves its words out of the grammar", async () => {
		const out = await run(RECKON_CRIB, {
			session,
			state,
			reply: "x",
			blocks: {},
			ruleset: { rigour: "prose", entryTypes: [{ id: "conditions", tags: ["condition"] }] },
			modes: { attributes: "off", conditions: "full" },
			places: [],
			schema: replySchema([], ["conditions"])
		})
		const item = out.schema.properties.changes.items
		expect(item.properties.attribute.enum).toEqual([""])
		expect(item.properties.entryType.enum).toEqual(["conditions", ""])
		expect(item.properties.changes.enum).toEqual(["entry"])
	})
})

describe("Describe new places, in the reckoning", () => {
	const places = [{ id: 7, name: "The Gatehouse", links: [] }]
	const answer = (name: string) => ({
		changes: [],
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

	it("the crib never carries a value only its holder hears (earshot holder: the Lair's whisper)", async () => {
		const out = await run(RECKON_CRIB, {
			session: { sessionId: 1, cast: { sessionCharacters: [{ character: { id: 4, name: "Brannoc" } }] } },
			state: {
				slots: [
					{ id: "core:slot/hp@1", key: "hp" },
					{ id: "core:slot/whisper@1", key: "whisper", earshot: "holder" }
				],
				world: {},
				cast: { byId: { "4": { hp: 20, core_hp: 20, whisper: "the east door is a lie", core_whisper: "the east door is a lie" } } }
			},
			reply: "Brannoc steps forward.",
			blocks: {},
			ruleset: {},
			modes: { attributes: "full" }
		})
		expect(out.crib).toContain("Brannoc [character:4]: hp: 20; core_hp: 20")
		expect(out.crib).not.toContain("the east door is a lie")
		expect(out.crib).not.toContain("whisper")
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

	it("🚧 Notice when the scene moves on: asked only when the check is due, its lines numbered (sprint 2)", async () => {
		const base = {
			session: { cast: { sessionCharacters: [{ character: { id: 4, name: "Rell" } }] } },
			state: {},
			modes: { "scene-moved-on": "full" },
			check: { due: true, channel: "main", lines: [11, 12] },
			history: [
				{ id: 11, role: "user", content: "We pay and leave." },
				{ id: 12, role: "assistant", characterId: 4, content: "The road north is empty." }
			]
		}
		const on = await run(SWEEP_CRIB, base)
		expect(on.brief).toContain("sceneMovedOn:")
		expect(on.crib).toContain("[1] A player: We pay and leave.")
		expect(on.crib).toContain("[2] Rell: The road north is empty.")
		expect((await run(SWEEP_CRIB, { ...base, check: { due: false, why: "x" } })).brief).not.toContain("sceneMovedOn")
		expect((await run(SWEEP_CRIB, { ...base, modes: { "scene-moved-on": "off" } })).brief).not.toContain("sceneMovedOn")
	})

	it("🚧 the new scene lands on the check's own line, by the duty's mode; out of range or not moved, nothing (sprint 2)", async () => {
		const empty = { summary: { name: "", content: "" }, lore: [], cast: [], worldState: [], relationships: [], scenes: [], goals: "" }
		const check = { due: true, channel: "main", lines: [11, 12] }
		const json = (over: object = {}) => ({ ...empty, sceneMovedOn: { moved: true, line: 2, reason: "they left the inn", ...over } })
		const cue = { at: 12, channel: "main", reason: "they left the inn" }
		const full = await run(SWEEP, { json: json(), modes: { "scene-moved-on": "full" }, check })
		expect(full.sceneCueFull).toEqual(cue)
		expect(full.sceneCueReview).toBeUndefined()
		const review = await run(SWEEP, { json: json(), modes: { "scene-moved-on": "review" }, check })
		expect(review.sceneCueReview).toEqual(cue)
		expect(review.sceneCueFull).toBeUndefined()
		const none = (out: any) => {
			expect(out.sceneCueFull).toBeUndefined()
			expect(out.sceneCueReview).toBeUndefined()
		}
		const modes = { "scene-moved-on": "full" }
		none(await run(SWEEP, { json: json({ line: 3 }), modes, check }))
		none(await run(SWEEP, { json: json({ line: 0 }), modes, check }))
		none(await run(SWEEP, { json: json({ moved: false }), modes, check }))
		none(await run(SWEEP, { json: json({ reason: "" }), modes, check }))
		none(await run(SWEEP, { json: json(), modes, check: { due: false, why: "x" } }))
		none(await run(SWEEP, { json: json(), modes: { "scene-moved-on": "off" }, check }))
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
