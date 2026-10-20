/**
 * 🚧 Dungeon Crawler's round script (`core:script:turn/select@1`,
 * PLAN-dungeon-crawler-2026-10-14 feature 17) — its decision table, run in
 * the real QuickJS sandbox the turn-scripted strategy's `select` point uses:
 * `selection` bound, the settings document on `ctx.session`.
 */

import { describe, it, expect } from "vitest"
import { runScriptSource } from "$lib/server/pipelines/scripts/host"
import { sentSinceReply } from "$lib/server/pipelines/runtime/speakerRotation"
import {
	DUNGEON_CRAWLER_ANNEX_KEYS,
	DUNGEON_CRAWLER_ROUND_SCRIPT
} from "@serene-pub/core-catalog"

type Seat = {
	seatId: number
	seatName?: string | null
	seatUserId?: number | null
	persona?: { id: number; name: string; userId?: number | null } | null
	removedAt?: string | null
}

const seat = (s: Seat) => ({
	persona: null,
	seatName: null,
	seatUserId: null,
	enabled: true,
	position: 0,
	removedAt: null,
	absorbedAliases: [],
	...s
})

const selection = {
	order: [],
	candidates: [],
	lastSpeaker: null,
	sinceUser: 0
}

async function decide(
	seats: Seat[],
	round?: unknown,
	voiceEntries: unknown[] = [],
	sentSinceReply: Record<string, string[]> = {},
	world?: unknown
) {
	const core: Record<string, unknown> = {}
	if (world !== undefined) core[DUNGEON_CRAWLER_ANNEX_KEYS.progress] = world
	const annex = Object.keys(core).length ? { core } : {}
	const r = await runScriptSource({
		source: DUNGEON_CRAWLER_ROUND_SCRIPT.source,
		vars: { selection: { ...selection, voiceEntries, sentSinceReply } },
		extras: {
			session: {
				annex,
				cast: { sessionCharacters: [], sessionPersonas: seats.map(seat), envoys: [] }
			}
		},
		seedLabel: "test:dc-round",
		nowMs: 1_000_000
	})
	expect(r).toMatchObject({ ok: true })
	return (r as { value: { order: unknown[]; candidates: unknown[] } }).value
}

const STORY = [{ ref: null, via: "voice" }]
const ann = { seatId: 1, seatName: "Ann the Bold", seatUserId: 10 }
const bo = { seatId: 2, seatName: "Bo", seatUserId: 11 }

describe("Dungeon Crawler's round script", () => {
	it("declares what it reads: the selection, and the session for the annex and the cast", () => {
		expect(DUNGEON_CRAWLER_ROUND_SCRIPT.typeId).toBe("core:script:turn/select@1")
		expect(DUNGEON_CRAWLER_ROUND_SCRIPT.varsIn).toEqual(["selection", "session"])
	})

	// The round annex key is gone (AUDIT C7, 2026-10-18): a declaration is a
	// line on Story since the Narrator's reply (`sentSinceReply.main`), by
	// the seat's reference or its person's.
	it.each([
		["nothing sent, one named seat", [ann], {}, []],
		["nobody declared", [ann, bo], { main: [] }, []],
		["one of two declared", [ann, bo], { main: ["user:10"] }, []],
		["both declared", [ann, bo], { main: ["user:10", "user:11"] }, STORY],
		["solo, declared", [ann], { main: ["user:10"] }, STORY],
		["no named seat, nobody to wait for", [], { main: [] }, []],
		["declared by player-seat ref", [ann], { main: ["player-seat:1"] }, STORY],
		["an unnamed seat does not hold the round", [ann, { seatId: 3, seatUserId: 12 }], { main: ["user:10"] }, STORY],
		["a departed seat does not hold the round", [ann, { ...bo, removedAt: "2026-10-01" }], { main: ["user:10"] }, STORY],
		[
			"a carded seat is named by its card and owned by the card's owner on an old row",
			[{ seatId: 4, persona: { id: 9, name: "Kesh", userId: 13 } }],
			{ main: ["user:13"] },
			STORY
		]
	])("%s", async (_label, seats, sent, order) => {
		const out = await decide(seats as Seat[], undefined, [], sent as Record<string, string[]>)
		expect(out.order).toEqual(order)
		// The rest of the selection is handed back as it came.
		expect(out.candidates).toEqual([])
	})

	it("answers each Planner lane whose newest row is a person's, round or no round", async () => {
		const voices = [
			{ ref: null, via: "voice" },
			{ ref: null, via: "voice", channel: "parley:2" },
			{ ref: null, via: "voice", channel: "parley" },
			{ ref: null, via: "voice", channel: "travelogue" },
			{ ref: "character:3", via: "plan", channel: "parley:3" }
		]
		const waiting = await decide([ann, bo], undefined, voices, { main: ["user:10"] })
		expect(waiting.order).toEqual([
			{ ref: null, via: "voice", channel: "parley:2" },
			{ ref: null, via: "voice", channel: "parley" }
		])
		const ready = await decide([ann], undefined, voices, { main: ["user:10"] })
		expect(ready.order[0]).toEqual({ ref: null, via: "voice" })
		expect(ready.order).toHaveLength(3)
	})

	/*
	 * The declaration as the rows say it (multiplayer lane, 2026-10-15): the
	 * host hands `sentSinceReply` — per channel, the seats that have written
	 * since its newest reply. Ownership is the seat's reference; the reset is
	 * the Narrator's reply itself (the host's window then holds nobody).
	 */
	it.each([
		["solo: one seat, one line on Story", [ann], { main: ["player-seat:1"] }, STORY],
		["two seats, one line", [ann, bo], { main: ["player-seat:1"] }, []],
		["two seats, both lines", [ann, bo], { main: ["player-seat:2", "player-seat:1"] }, STORY],
		["a line on a Planner lane is no declaration", [ann], { "parley:2": ["player-seat:1"] }, []],
		["somebody else's seat does not declare for mine", [ann, bo], { main: ["player-seat:2", "player-seat:9"] }, []],
		[
			"a carded seat declares by its card",
			[{ seatId: 4, persona: { id: 9, name: "Kesh", userId: 13 } }],
			{ main: ["character:9"] },
			STORY
		],
		["reset: the Narrator replied, the window is empty", [ann, bo], {}, []]
	])("%s", async (_label, seats, sent, order) => {
		const out = await decide(seats as Seat[], undefined, [], sent as Record<string, string[]>)
		expect(out.order).toEqual(order)
	})

	/*
	 * Out of the fight (join lane, 2026-10-15): a seat whose `fate` is `dead`,
	 * or `taken-out` until a Rest, gets no action from the story turn, so it
	 * does not hold the round. The script has no state; the books and Rest
	 * mirror the fates into the crawl's bookkeeping (`progress.fates`).
	 */
	it.each([
		["a dead seat does not hold the round", [ann, bo], { main: ["player-seat:1"] }, { "player-seat:2": "dead" }, STORY],
		["a taken-out seat does not hold the round", [ann, bo], { main: ["player-seat:1"] }, { "player-seat:2": "taken-out" }, STORY],
		["an alive seat still does", [ann, bo], { main: ["player-seat:1"] }, { "player-seat:2": "alive" }, []],
		["a fate for another seat changes nothing", [ann, bo], { main: ["player-seat:1"] }, { "player-seat:9": "dead" }, []],
		[
			"a carded seat's fate is read by its card",
			[ann, { seatId: 4, persona: { id: 9, name: "Kesh", userId: 13 } }],
			{ main: ["player-seat:1"] },
			{ "character:9": "dead" },
			STORY
		],
		["everyone dead: nobody to wait for, only Continue", [ann], {}, { "player-seat:1": "dead" }, []],
		// 🚧 P3-2 (the 100-turn walk, B15): everyone out of the fight, and one of them speaks — the round is played, and the story says why.
		["everyone out, and one speaks: the round is played", [ann], { main: ["player-seat:1"] }, { "player-seat:1": "taken-out" }, STORY],
		["no fates key: every named seat holds", [ann, bo], { main: ["player-seat:1"] }, undefined, []]
	])("%s", async (_label, seats, sent, fates, order) => {
		const world = fates === undefined ? {} : { fates }
		const out = await decide(seats as Seat[], { declared: [], skip: false }, [], sent as Record<string, string[]>, world)
		expect(out.order).toEqual(order)
	})

	/*
	 * 🚧 Made, not named (the 100-turn walk, B15/B16, P0-5): a seat counts
	 * once its character's sheet is applied — the crawl's hero stamped
	 * `made` (an older hero, by the backstory the sheet wrote). A crawl that
	 * keeps no heroes counts every named seat, as before.
	 */
	it.each([
		["a named seat still being made neither holds the round nor joins it", { "user:10": { name: "Ann", made: true }, "user:11": { name: "Bo" } }, STORY],
		["once made, it holds the round", { "user:10": { name: "Ann", made: true }, "user:11": { name: "Bo", made: true } }, []],
		["an older hero made by its sheet (a backstory) holds it too", { "user:10": { name: "Ann", made: true }, "user:11": { name: "Bo", backstory: "" } }, []]
	])("%s", async (_label, heroes, order) => {
		const out = await decide([ann, bo], undefined, [], { main: ["user:10"] }, { heroes })
		expect(out.order).toEqual(order)
	})
})

describe("the host's reading: sentSinceReply", () => {
	const row = (r: Record<string, unknown>) => ({ role: "user", channel: "main", ...r })
	it("the seats after each channel's newest reply, newest first, once; hidden rows and narration skipped", () => {
		expect(
			sentSinceReply([
				row({ speaker: "player-seat:9" }),
				row({ role: "assistant", speaker: "envoy:narrator" }),
				row({ speaker: "player-seat:1" }),
				row({ role: "assistant", isNarratorResponse: true, speaker: "envoy:planner" }),
				row({ personaId: 40 }),
				row({ speaker: "player-seat:1" }),
				row({ speaker: "player-seat:2", isHidden: true }),
				row({ channel: "parley:2", speaker: "player-seat:2" }),
				row({ content: "a line from no seat" })
			] as never)
		).toEqual({ main: ["player-seat:1", "character:40"], "parley:2": ["player-seat:2"] })
	})
	it("a channel whose newest row is a reply holds nobody", () => {
		expect(
			sentSinceReply([row({ speaker: "player-seat:1" }), row({ role: "assistant" })] as never)
		).toEqual({})
	})
})
