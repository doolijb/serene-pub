/**
 * 🚧 Dungeon Crawler's script steps in the real QuickJS sandbox
 * (`runScriptSource`): each parses there and answers its decision table's
 * edges. The full tables run as plain functions in the SDK suite
 * (`sdk-tests/dungeonCrawler.test.ts`); the int test
 * (`sockets/sessions.dungeonCrawler.int.test.ts`) runs the lanes, interview,
 * sheet, genesis and books scripts on the real roads.
 */

import { describe, it, expect } from "vitest"
import { runScriptSource } from "$lib/server/pipelines/scripts/host"
import {
	CORE_SCRIPTS,
	DUNGEON_CRAWLER_ANNEX_KEYS as K,
	DUNGEON_CRAWLER_EDITS_SCRIPT,
	DUNGEON_CRAWLER_GENESIS_SCRIPT,
	DUNGEON_CRAWLER_INTERVIEW_SCRIPT,
	DUNGEON_CRAWLER_LANES_SCRIPT,
	DUNGEON_CRAWLER_SHAPE_SCRIPT,
	DUNGEON_CRAWLER_SHEET_SCRIPT,
	READ_PATH_SCRIPT,
	rulesetGistOf
} from "@serene-pub/core-catalog"
import { getRuleset } from "@serene-pub/sdk"
import { replySchemaOf } from "$lib/server/rulesets/replies"
import { jsonSchemaToGbnf, type JsonSchemaNode } from "$lib/server/connectionAdapters/jsonSchemaToGbnf"

/** 🚧 Vis Itineris as the host lays it on the inlet (S4, lane G3, 2026-10-23): the kits are its class rows, read at run time. */
const ruleset = { id: "core:ruleset/vis-itineris@1", rigour: "scripts", settings: {}, ...rulesetGistOf(getRuleset("core:ruleset/vis-itineris@1")! as never, {}) }

const run = async (source: string, value: unknown) => {
	const r = await runScriptSource({ source, vars: { value }, extras: {}, seedLabel: "test:dc", nowMs: 1 })
	expect(r).toMatchObject({ ok: true })
	return (r as { value: any }).value
}

describe("Dungeon Crawler's scripts in QuickJS", () => {
	it.each(CORE_SCRIPTS.filter((s) => s.typeId === "core:script:data/transform@1").map((s) => [s.seedKey, s]))(
		"%s runs on an empty document",
		async (_key, s) => {
			await run((s as { source: string }).source, {})
		}
	)

	it("the Planner's grammar compiles to GBNF under every shipped ruleset (G1 ★4: no null, no type unions)", async () => {
		const owners = [{ key: "session:1", name: "The world" }, { key: "character:1", name: "Ann" }]
		for (const id of ["core:ruleset/vis-itineris@1", "core:ruleset/wherewithal@1", "core:ruleset/freeform@1"]) {
			const decl = getRuleset(id)!
			const inlet = { id, rigour: id.includes("freeform") ? "prose" : "scripts", settings: {}, ...rulesetGistOf(decl as never, {}) }
			for (const want of ["turn", "edits", "genesis"]) {
				const schema = await run(DUNGEON_CRAWLER_SHAPE_SCRIPT.source, { shape: replySchemaOf(decl as never, owners), ruleset: inlet, want })
				expect(() => jsonSchemaToGbnf(schema as JsonSchemaNode), `${id} ${want}`).not.toThrow()
			}
		}
	})

	it("read-path reads a part, or null", async () => {
		expect(await run(READ_PATH_SCRIPT.source, { from: { a: { b: 2 } }, path: "a.b" })).toBe(2)
		expect(await run(READ_PATH_SCRIPT.source, { from: {}, path: "x.y" })).toBeNull()
	})

	it("edits land on the lane's player seat", async () => {
		const out = await run(DUNGEON_CRAWLER_EDITS_SCRIPT.source, {
			session: {
				ownerUserId: 1,
				// Two live seats: a solo table asks no standing order (§14).
				cast: { sessionPersonas: [{ seatId: 4, seatUserId: 7, seatName: "Bo", persona: null, removedAt: null }, { seatId: 5, seatUserId: 1, seatName: "Ann", persona: null, removedAt: null }] },
				channelLanes: { parley: { "user:7": "parley:2" } }, annex: { core: {} }
			},
			lane: "parley:2",
			json: { standingOrder: "follow", asks: [], deltas: [], rooms: [] }
		})
		expect(out.changes).toEqual([{ owner: "player-seat:4", slot: "core:slot/standing-order@1", value: "follow" }])
	})

	it("no change that changes nothing: the interview, the sheet and the edits judge against the state", async () => {
		const session = {
			ownerUserId: 1,
			cast: { sessionPersonas: [{ seatId: 4, seatUserId: 1, seatName: "Bo", persona: null, removedAt: null }] },
			channelLanes: { parley: { "user:1": "parley" } }, annex: { core: {} }
		}
		const state = { world: { difficulty: "fair" }, cast: { byId: { "player_seat:4": { "standing-order": "follow" } } } }
		const fair = await run(DUNGEON_CRAWLER_INTERVIEW_SCRIPT.source, { ruleset, session, state, referent: "difficulty", choice: "fair", addressee: "user:1" })
		expect(fair.worldChanges).toBeNull()
		const brutal = await run(DUNGEON_CRAWLER_INTERVIEW_SCRIPT.source, { ruleset, session, state, referent: "difficulty", choice: "brutal", addressee: "user:1" })
		expect(brutal.worldChanges).toEqual([{ owner: "world", slot: "core:slot/difficulty@1", value: "brutal" }])
		// A re-run over a seat the kit already wrote (no class: the fighter's —
		// d10 + Constitution 14's +2 = 12 health, its six scores): nothing to write.
		const kitted = {
			...state,
			cast: {
				byId: {
					"player_seat:4": {
						"standing-order": "follow",
						hp: 12,
						"itineris-strength": 16,
						"itineris-dexterity": 13,
						"itineris-constitution": 14,
						"itineris-intelligence": 8,
						"itineris-wisdom": 12,
						"itineris-charisma": 10,
						// 🚧 …and its trained skills (owner ruling ★4, after walk #3).
						"itineris-skill-training": ["athletics", "perception"]
					}
				}
			},
			configs: { "player_seat:4": { "core:slot/hp@1": { min: 0, max: 12 } } }
		}
		const sheet = await run(DUNGEON_CRAWLER_SHEET_SCRIPT.source, { ruleset,
			session, state: kitted, plan: { addressee: "user:1", currentName: "Bo" }, json: { hp: 20, backstory: "" }
		})
		// Level 1 and alive are what a fresh seat already reads; health, its max, the scores and the skills are the kit's already.
		expect(sheet.seatChanges).toBeNull()
		// The class's starting kit (no class: the fighter's) is the ruleset handler's to hand out.
		expect(sheet.kit.deltas.map((d: any) => d.piece).slice(0, 2)).toEqual(["longsword", "handaxe"])
		expect(sheet.healthConfig).toBeNull()
		// Full health is the kit's (2026-10-17), never the model's number: a max
		// that differs is configured, then filled.
		const hardy = await run(DUNGEON_CRAWLER_SHEET_SCRIPT.source, { ruleset,
			session,
			state: { ...state, configs: { "player_seat:4": { "core:slot/hp@1": { min: 0, max: 20 } } } },
			plan: { addressee: "user:1", currentName: "Bo" },
			json: { maxHp: 26, backstory: "" }
		})
		expect(hardy.healthConfig).toEqual({ max: 12 })
		expect(hardy.seatChanges).toContainEqual({ slot: "core:slot/hp@1", value: 12 })
		const edits = await run(DUNGEON_CRAWLER_EDITS_SCRIPT.source, {
			session, state, lane: "parley", json: { standingOrder: "follow" }
		})
		expect(edits.changes).toBeNull()
	})

	it("a character made once the world exists stands where the party is; what comes next is its own line", async () => {
		const out = await run(DUNGEON_CRAWLER_SHEET_SCRIPT.source, { ruleset,
			session: {
				ownerUserId: 1,
				cast: {
					sessionPersonas: [
						{ seatId: 6, seatUserId: 7, seatName: "Bo", persona: null, removedAt: null },
						{ seatId: 5, seatUserId: 1, seatName: "Ann", persona: null, removedAt: null }
					]
				},
				channelLanes: { parley: { "user:7": "parley:2" } }, annex: { core: { [K.progress]: { built: true } } }
			},
			// A newcomer stands where a living seat stands (A9): Ann, at The Hall.
			state: { world: {}, cast: { byId: { "player_seat:5": { fate: "alive", location: "The Hall" } } } },
			plan: { addressee: "user:7", currentName: "Bo" },
			json: { backstory: "" }
		})
		expect(out.seatChanges).toContainEqual({ slot: "core:slot/location@1", value: "The Hall" })
		expect(out.text).not.toMatch(/already out there/)
		expect(out.after).toMatch(/already out there/)
	})

	it("genesis puts every made character in the first room", async () => {
		const out = await run(DUNGEON_CRAWLER_GENESIS_SCRIPT.source, {
			session: {
				ownerUserId: 1,
				cast: { sessionPersonas: [{ seatId: 4, seatUserId: 1, seatName: null, persona: null, removedAt: null }] },
				annex: { core: {} }
			},
			sheet: { world: { shape: "dungeon" } },
			json: { goal: "Out.", rooms: [{ id: "gate", name: "The Gate", description: "", exits: [] }], npcs: [], leads: [], notes: "" },
			state: { world: {}, cast: { byId: {} } }
		})
		expect(out.world.built).toBe(true)
		expect(out.placements).toEqual([{ owner: "player-seat:4", slot: "core:slot/location@1", value: "The Gate" }])
		// The world itself is for the session's own lorebook: the place, written by the spec.
		expect(out.places).toEqual([{ name: "The Gate", content: "The Gate", links: [] }])
	})

	it("the opening brief ends each sentence once, whatever the model's own ended with (2026-10-16 walk)", async () => {
		const session = {
			ownerUserId: 1,
			cast: { sessionPersonas: [{ seatId: 4, seatUserId: 1, seatName: "Ann", persona: null, removedAt: null }] },
			annex: { core: {} }
		}
		const out = await run(DUNGEON_CRAWLER_GENESIS_SCRIPT.source, {
			session,
			sheet: { world: { shape: "dungeon" } },
			json: {
				goal: "Out.",
				rooms: [{ id: "gate", name: "The Sunken Gate", description: "Wet stone and a rusted portcullis.", exits: [] }],
				npcs: [],
				leads: ["A bell rings below."],
				notes: ""
			},
			state: { world: {}, cast: { byId: {} } }
		})
		expect(out.openingBrief).toBe(
			"Open the adventure in The Sunken Gate: Wet stone and a rusted portcullis. Start in the middle of something; " +
				"within a few lines the party should find, fight or meet something. Hint at: A bell rings below."
		)
		const bare = await run(DUNGEON_CRAWLER_GENESIS_SCRIPT.source, {
			session,
			sheet: { world: { shape: "dungeon" } },
			json: { goal: "Out.", rooms: [{ id: "gate", name: "The Gate", description: "Damp", exits: [] }], npcs: [], leads: ["Bells"], notes: "" },
			state: { world: {}, cast: { byId: {} } }
		})
		expect(bare.openingBrief).toMatch(/^Open the adventure in The Gate: Damp\. Start/)
		expect(bare.openingBrief).toMatch(/Hint at: Bells\.$/)
		expect(bare.openingBrief).not.toMatch(/\.\./)
	})

	it("a guest's welcome says where the world stands: the owner's to choose, being set up, or ready", async () => {
		const session = (world: unknown) => ({
			ownerUserId: 1,
			guests: [7],
			cast: { sessionPersonas: [] },
			channelLanes: { parley: { "user:1": "parley" } }, annex: { core: { ...(world ? { [K.progress]: world } : {}) } }
		})
		// 🚧 Nobody has answered yet: never "being set up" (the 100-turn walk, P0-4).
		const before = await run(DUNGEON_CRAWLER_LANES_SCRIPT.source, { session: session(null) })
		expect(before.greet[0].text).toMatch(/The session's owner chooses the world/)
		const underway = await run(DUNGEON_CRAWLER_LANES_SCRIPT.source, { session: session({ shape: "dungeon" }) })
		expect(underway.greet[0].text).toMatch(/being set up by the session's owner/)
		const after = await run(DUNGEON_CRAWLER_LANES_SCRIPT.source, { session: session({ built: true }) })
		expect(after.greet[0].text).not.toMatch(/being set up/)
		expect(after.greet[0].text).toMatch(/The world is ready/)
	})
})
