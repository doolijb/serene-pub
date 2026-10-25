/**
 * 🚧 Dungeon Crawler's story-turn scripts in the real QuickJS sandbox
 * (`runScriptSource`). Since 2026-10-16 the checks are the ruleset handler's
 * (`core:task/ruleset-resolve@1`, `rulesets/resolve.ts`); what the genre
 * still rolls is death's door, on the label-seeded stream — the same label
 * rolls the same face, on any thread, any replay. The decision tables with
 * `Math.random` stubbed run in the SDK suite
 * (`sdk-tests/dungeonCrawlerStory.test.ts`); the turn itself, end to end, in
 * `sockets/sessions.dungeonCrawler.int.test.ts`.
 */

import { describe, it, expect } from "vitest"
import { runScriptSource } from "$lib/server/pipelines/scripts/host"
import {
	DUNGEON_CRAWLER_ANNEX_KEYS as K,
	DUNGEON_CRAWLER_BOOKS_SCRIPT,
	DUNGEON_CRAWLER_DOOR_SCRIPT,
	DUNGEON_CRAWLER_LEDGER_SCRIPT,
	DUNGEON_CRAWLER_PLAN_SCRIPT,
	DUNGEON_CRAWLER_REST_SCRIPT,
	DUNGEON_CRAWLER_RULESET_FIELDS_SCRIPT,
	DUNGEON_CRAWLER_SHEET_SCRIPT,
	DUNGEON_CRAWLER_TURN_SCRIPT,
	rulesetGistOf
} from "@serene-pub/core-catalog"
import { getRuleset } from "@serene-pub/sdk"

/** 🚧 Vis Itineris as the host lays it on the inlet (S4, lane G3, 2026-10-23): its id, rigour, settings and gist. */
const ruleset = {
	id: "core:ruleset/vis-itineris@1",
	rigour: "scripts",
	settings: {},
	chance: true,
	...rulesetGistOf(getRuleset("core:ruleset/vis-itineris@1")! as never, {})
}

const run = async (source: string, value: unknown, seedLabel = "test:dc-story") => {
	const r = await runScriptSource({ source, vars: { value }, extras: {}, seedLabel, nowMs: 1 })
	expect(r, JSON.stringify(r).slice(0, 400)).toMatchObject({ ok: true })
	return (r as { value: any }).value
}

// Mira's sheet is applied: her hero is made (🚧 a named seat not made is not in the round, the 100-turn walk's P0-5).
const PROGRESS = { shape: "dungeon", built: true, here: "The Sunken Gate", heroes: { "user:1": { name: "Mira", made: true } } }
const session = {
	sessionId: 7,
	ownerUserId: 1,
	guests: [],
	cast: { sessionPersonas: [{ seatId: 4, seatUserId: 1, seatName: "Mira", persona: null, removedAt: null }], characters: [] },
	annex: { core: { [K.lanes]: { "user:1": "parley" }, [K.progress]: PROGRESS } }
}
const state = {
	world: { difficulty: "fair", "crawl-time": "1-01-01 08:00" },
	cast: { byId: { "player_seat:4": { hp: 12, level: 1, location: "The Sunken Gate" } } },
	// The seat's full health: its hp slot's configuration in force (`set-stat-config@1`).
	configs: { "player_seat:4": { "core:slot/hp@1": { min: 0, max: 15 } } }
}
const places = { entries: [{ id: 50, name: "The Sunken Gate", content: "Wet stone.", links: [] }] }
const story = [{ id: 11, role: "user", content: "I climb the wall.", speaker: "player-seat:4" }]
const blank = { owner: "", op: "add", slot: "", repertoire: "", piece: "", value: "", check: "", against: 0, reason: "" }
const PLAN = {
	deltas: [{ ...blank, owner: "player-seat:4", op: "use", check: "skill.athletics", against: 12, reason: "climb" }],
	world: { rooms: [{ id: "hall", name: "The Hall", description: "Pillars.", exits: ["The Sunken Gate"] }], npcs: [], leads: [], goalProgress: "none", notes: "" },
	clock: { minutes: 30 },
	narratorBrief: "Mira climbs.",
	roundSummary: "Mira tried the wall.",
	secrets: []
}
const applied = (text: string, rigour = "scripts") => ({
	blocks: { outcomes: { text: `- ${text}` } },
	facts: { rigour },
	outcomes: [{ owner: "player-seat:4", kind: "effect", text }],
	explain: [],
	rejected: []
})

describe("Dungeon Crawler's story turn in QuickJS", () => {
	it("books, the ruleset fields, the plan check and the turn run in the sandbox", async () => {
		const books = await run(DUNGEON_CRAWLER_BOOKS_SCRIPT.source, { session, state, story, places, ruleset })
		expect(books.fresh).toBe(true)
		expect(books.owners).toEqual(["session:7", "player-seat:4", "location:50"])
		expect(books.actions).toEqual([{ owner: "player-seat:4", text: "I climb the wall." }])
		expect(books.brief).toMatch(/Mira \(player-seat:4, level 1, health 12\/15, at The Sunken Gate\)/)
		const fields = await run(DUNGEON_CRAWLER_RULESET_FIELDS_SCRIPT.source, { blocks: { voice: { text: "Dice are rolled for you." } }, facts: { rigour: "scripts" } })
		expect(fields.rulesetVoice).toBe("Dice are rolled for you.")
		const first = await run(DUNGEON_CRAWLER_PLAN_SCRIPT.source, { json: PLAN })
		expect(first.plan.deltas).toEqual([{ owner: "player-seat:4", op: "use", check: "skill.athletics", against: 12, reason: "climb" }])
		const turn = await run(DUNGEON_CRAWLER_TURN_SCRIPT.source, { books, first })
		expect(turn.deltas).toHaveLength(1)
	})

	it("death's door rolls on the seeded stream: the same label, the same face; the door's table holds", async () => {
		const books = await run(DUNGEON_CRAWLER_BOOKS_SCRIPT.source, { session, state, story, places, ruleset })
		const turn = { plan: (await run(DUNGEON_CRAWLER_PLAN_SCRIPT.source, { json: { ...PLAN, deltas: [] } })).plan }
		const after = { ...state, cast: { byId: { "player_seat:4": { hp: 0, level: 1, location: "The Sunken Gate" } } } }
		const input = { session, books, turn, applied: applied("Mira: Health −12"), after }
		const a = await run(DUNGEON_CRAWLER_DOOR_SCRIPT.source, input, "run-a:scripts:channel.story.door")
		const b = await run(DUNGEON_CRAWLER_DOOR_SCRIPT.source, input, "run-a:scripts:channel.story.door")
		expect(b.deaths).toEqual(a.deaths)
		const faces = new Set<number>()
		for (let i = 0; i < 12; i++) {
			const out = await run(DUNGEON_CRAWLER_DOOR_SCRIPT.source, input, `run-${i}:scripts:channel.story.door`)
			const d = out.deaths[0]
			faces.add(d.roll)
			expect(d.roll).toBeGreaterThanOrEqual(1)
			expect(d.roll).toBeLessThanOrEqual(20)
			expect(d.outcome).toBe(d.roll >= 10 ? "survives" : "dead")
			// 🚧 The fold opens on death's door (P4-7, 2026-10-18).
			expect(out.line).toMatch(/^\u2620 Mira at death's door: d20 \d+ vs DC 10 \u2014 (survives|dead)\n\u2684 Mira: Health \u221212$/)
		}
		expect(faces.size).toBeGreaterThan(1)
	})

	it("the ledger and Rest run in the sandbox: the world for the lorebook, a level's full health, no snapshot", async () => {
		const books = await run(DUNGEON_CRAWLER_BOOKS_SCRIPT.source, { session, state, story, places, ruleset })
		const turn = await run(DUNGEON_CRAWLER_TURN_SCRIPT.source, { books, first: await run(DUNGEON_CRAWLER_PLAN_SCRIPT.source, { json: PLAN }) })
		const ap = applied("Mira: Level +1")
		const after = { ...state, cast: { byId: { "player_seat:4": { hp: 12, level: 2, location: "The Sunken Gate" } } } }
		const door = await run(DUNGEON_CRAWLER_DOOR_SCRIPT.source, { session, books, turn, applied: ap, after })
		const ledger = await run(DUNGEON_CRAWLER_LEDGER_SCRIPT.source, { session, books, turn, door, applied: ap, after, state, row: 50 })
		// 🚧 What a level brings is the session's rules' (S4): the class's kit's level gain (no class: the first kit's).
		const gain = ruleset.kits!.byId[ruleset.kits!.order[0]!]!.levelHp
		expect(ledger.raises).toEqual([{ owner: "player-seat:4", slot: "core:slot/hp@1", config: { max: 15 + gain } }])
		expect(ledger.changes).toContainEqual({ owner: "player-seat:4", slot: "core:slot/hp@1", value: 12 + gain })
		expect(ledger.changes).toContainEqual({ owner: "world", slot: "core:slot/crawl-time@1", value: "1-01-01 08:30" })
		expect(ledger.places).toEqual([{ name: "The Hall", content: "Pillars.", links: [{ to: "The Sunken Gate", linkType: "leads to", reverseLinkType: "leads to" }] }])
		expect(ledger.progress.lastTelling.row).toBe(50)
		expect(ledger.progress.lastTurn).toBeUndefined()
		expect(ledger.travelogue).toBe("Mira tried the wall.")
		const rest = await run(DUNGEON_CRAWLER_REST_SCRIPT.source, { session, state, ruleset })
		// Rest heals to the seat's own max, the bar's number — not the slot's 20.
		expect(rest.changes[0]).toEqual({ owner: "player-seat:4", slot: "core:slot/hp@1", value: 15 })
		expect(rest.journal).toMatch(/^The party rests\. Day \d+, \d\d:\d\d → Day \d+, \d\d:\d\d\.$/)
	})

	it("the sheet hands out the class's kit, as pieces of the rules", async () => {
		const sheet = await run(DUNGEON_CRAWLER_SHEET_SCRIPT.source, {
			session: { ...session, annex: { core: { ...session.annex.core, [K.progress]: { ...PROGRESS, heroes: { "user:1": { name: "Mira", class: "Ranger" } } } } } },
			plan: { addressee: "user:1", currentName: "Mira" },
			json: { backstory: "" },
			state,
			ruleset
		})
		const weapons = sheet.kit.deltas.filter((d: any) => d.repertoire === "weapons")
		expect(weapons.map((d: any) => d.piece)).toEqual(["longbow", "spear"])
		expect(sheet.kit.owners).toEqual(["session:7", "player-seat:4"])
		expect(sheet.text).toMatch(/They carry: Longbow, Spear/)
	})
})
