/**
 * The ruleset handler, wave 3 (W3-A) and the W2 fixes (2026-10-17): timed
 * pieces on the calendar and on references, turns as rounds, the game
 * master's block and holder-only fields per acting holder, bridges, the
 * budget port's fitted shape, the offer gate for a slot a ruleset owns and a
 * foreign repertoire's degrade, spending a counted piece, one fold of every
 * modify, and checking ruleset settings.
 */

import { beforeAll, describe, expect, test } from "vitest"
import "@serene-pub/core-catalog"
import { defineBridge, getRepertoire, getRuleset, type RulesetDecl, type StoryCalendar } from "@serene-pub/sdk"
import { addStoryMinutes, runApply, runResolve } from "./engine"
import { elapsedInUnits } from "./resolve"
import { fitContextBlocks } from "./budget"
import { normaliseSlotRef } from "./common"
import { countsAsRound, roundsSince } from "./rounds"
import { checkedRulesetSettings, offerableSlot, RulesetSettingsRefusal, withoutForeignRepertoire } from "./settings"
import { DEFENSE, GEAR, HP, STR, TRIAL, declareTrial } from "./trialRuleset.testkit"
import type { EngineInput, HeldPiece, OwnerView, RulesetMode } from "./types"

const VIS_ITINERIS = "core:ruleset/vis-itineris@1"
const STORY = "core:ruleset/freeform@1"
const MOOD = "core:slot/mood@1"
const CONDITIONS = "test:slot/w3-conditions@1"
const CREATURES = "test:slot/w3-creatures@1"

let visItineris: RulesetDecl
let trial: RulesetDecl
beforeAll(() => {
	visItineris = getRuleset(VIS_ITINERIS)!
	trial = declareTrial().decl
})

const piece = (props: Record<string, unknown>): HeldPiece => ({
	key: String(props.name).toLowerCase(),
	props: { description: "", ...props } as HeldPiece["props"],
	count: 1,
	form: "inline",
	item: { kind: "inline", description: "", ...props } as HeldPiece["item"]
})

function owner(key: string, name: string, over: Partial<OwnerView> = {}): OwnerView {
	const id = Number(key.split(":")[1])
	return {
		key,
		owner: { kind: "session_cast", id },
		name,
		stats: [],
		repertoires: [],
		custom: [],
		bag: {},
		...over
	}
}

type Moment = EngineInput & { mode?: RulesetMode }

const input = (over: Partial<Moment>): Moment => ({
	ruleset: visItineris,
	rigour: "mechanics",
	mode: "resolve",
	owners: [],
	actions: {},
	deltas: [],
	elapsed: 0,
	ties: [],
	turn: 4,
	...over
})

/** The moment a test names: resolve, apply, or advance (apply with no deltas). */
const runEngine = ({ mode = "resolve", ...i }: Moment) =>
	mode === "resolve" ? runResolve(i) : runApply(mode === "advance" ? { ...i, deltas: [] } : i)

const conditions = () => getRepertoire(`${VIS_ITINERIS}#conditions`)!

/** Thirty-day months: day 30 rolls into the next month. */
const CALENDAR: StoryCalendar = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 30 }
	]
} as StoryCalendar

describe("timed pieces", () => {
	const poisoned = (spent?: number) =>
		piece({ name: "Poisoned", duration: { units: "round", value: 2, expiry: "elapsed", ...(spent ? { spent } : {}) } })
	const ann = (p: HeldPiece) => owner("character:1", "Ann", { repertoires: [{ slotId: CONDITIONS, repertoire: conditions(), pieces: [p] }] })

	test("a condition lasting 2 rounds counts down, then ends", () => {
		const first = runEngine(input({ mode: "advance", elapsed: 1, owners: [ann(poisoned())] }))
		expect(first.outcomes).toEqual([])
		// Time passing is ONE `set` of the list per repertoire (2026-10-18):
		// a remove+add pair on one slot in one batch lost the add.
		expect(first.changes.map((c) => c.op)).toEqual(["set"])
		expect(((first.changes[0]!.value as any[])[0] as any).duration).toMatchObject({ units: "round", value: 2, spent: 1 })

		const second = runEngine(input({ mode: "advance", elapsed: 1, owners: [ann(poisoned(1))] }))
		expect(second.changes).toEqual([expect.objectContaining({ slotId: CONDITIONS, op: "set", value: [] })])
		expect(second.outcomes[0]!.text).toBe("Ann: Poisoned ends")

		expect(runEngine(input({ mode: "advance", elapsed: 2, owners: [ann(poisoned())] })).outcomes[0]!.text).toBe("Ann: Poisoned ends")
		// At prose nothing is counted.
		expect(runEngine(input({ rigour: "prose", mode: "advance", elapsed: 5, owners: [ann(poisoned())] })).changes).toEqual([])
	})

	test("a condition lasting 1 hour of story time ends on the calendar — across a month's real end", () => {
		const start = { year: 5, month: 1, day: 30, hour: 23, minute: 30 }
		// Real month lengths: 30 Thaw 23:30 + 60 minutes is 1 Bloom 00:30.
		expect(addStoryMinutes(start, 60, CALENDAR)).toEqual({ year: 5, month: 2, day: 1, hour: 0, minute: 30 })
		const blessed = piece({ name: "Blessed", duration: { units: "hour", value: 1, startedAt: { clock: start } } })
		const owners = [ann(blessed)]
		const clock = { now: start, calendar: CALENDAR }
		// 300 rounds of 6 seconds: half an hour — still running.
		expect(runEngine(input({ mode: "advance", elapsed: 300, owners, clock })).changes).toEqual([])
		// 600 rounds: the hour is up.
		const done = runEngine(input({ mode: "advance", elapsed: 600, owners, clock }))
		expect(done.outcomes[0]!.text).toBe("Ann: Blessed ends")
		// Already past its end when the session's clock reads later.
		const later = runEngine(input({ mode: "apply", owners, clock: { now: { year: 5, month: 2, day: 1, hour: 1, minute: 0 }, calendar: CALENDAR } }))
		expect(later.outcomes[0]!.text).toBe("Ann: Blessed ends")
	})

	test("a timed piece added in play carries when it started", () => {
		const clock = { now: { year: 5, month: 1, day: 3, hour: 9, minute: 0 }, calendar: CALENDAR }
		const out = runEngine(
			input({
				mode: "apply",
				owners: [owner("character:1", "Ann", { repertoires: [{ slotId: CONDITIONS, repertoire: conditions(), pieces: [] }] })],
				deltas: [
					{ owner: "character:1", repertoire: "conditions", op: "add", piece: { name: "Frightened", description: "Shaking.", duration: { units: "round", value: 3 } } }
				],
				clock,
				turn: 7
			})
		)
		expect((out.changes[0]!.items![0] as any).duration.startedAt).toEqual({ turn: 7, clock: { year: 5, month: 1, day: 3, hour: 9, minute: 0 } })
	})
})

describe("earshot", () => {
	const secret = { slotId: "test:slot/w3-secret@1", selector: "secret", type: "text", label: "Secret", holderOnly: true }
	const pair = () => [
		owner("character:1", "Ann", { stats: [{ ...secret, value: "she stole the key" }] }),
		owner("character:2", "Bram", { stats: [{ ...secret, value: "he owes the guild" }] })
	]

	test("several holders acting: each one's holder-only fields render in a block of their own", () => {
		const out = runEngine(input({ ruleset: trial, owners: pair() }))
		expect(out.blocks.sheet?.text ?? "").not.toContain("stole")
		expect(Object.keys(out.blocks.holders!)).toEqual(["character:1", "character:2"])
		expect(out.blocks.holders!["character:1"]!.text).toContain("Secret: she stole the key")
		expect(out.blocks.holders!["character:1"]!.text).not.toContain("guild")
		expect(out.blocks.holders!["character:2"]!.text).toContain("Secret: he owes the guild")
	})

	test("a holder's own view reads theirs inline and no one else's", () => {
		const out = runEngine(input({ ruleset: trial, owners: pair(), viewer: "character:2" }))
		expect(out.blocks.sheet!.text).toContain("Secret: he owes the guild")
		expect(out.blocks.sheet!.text).not.toContain("stole")
		expect(out.blocks.holders).toBeUndefined()
	})

	test("game-master pieces render in the gm block, and only in the owner's or game master's view", () => {
		const goblin = piece({ name: "Goblin", description: "Small and spiteful.", level: 1, ac: 13, hp: 7 })
		const place = owner("character:3", "Ann", {
			repertoires: [{ slotId: CREATURES, repertoire: getRepertoire(`${VIS_ITINERIS}#creatures`)!, pieces: [goblin] }]
		})
		const players = runEngine(input({ owners: [place], actions: { "*": "goblin" } }))
		expect(players.blocks.gm).toBeUndefined()
		expect(JSON.stringify(players.blocks)).not.toContain("Goblin")
		const gm = runEngine(input({ owners: [place], viewer: "gm" }))
		expect(gm.blocks.gm!.text).toContain("Goblin — Small and spiteful.")
		expect(gm.blocks.gm!.text).toMatch(/^For the game master only/)
	})
})

describe("bridges", () => {
	test("Story's mood, bridged onto Vis Itineris, adds to an attack", () => {
		// Declared through `defineBridge` with no predicate, it applies
		// whenever the field is carried.
		const always = defineBridge({ field: MOOD, ruleset: VIS_ITINERIS, effects: [{ verb: "modify", target: "attack.melee", value: 1 }] })
		const fighter = (mood?: string) =>
			owner("character:1", "Ann", { custom: mood ? [{ slotId: MOOD, label: "Mood", value: mood }] : [] })
		const attack = (o: OwnerView, bridges = [always]) =>
			runEngine(
				input({
					mode: "apply",
					owners: [o],
					deltas: [{ owner: "character:1", op: "hit", check: "attack.melee", against: 10 }],
					random: () => 0.5,
					bridges
				})
			).explain.find((e) => e.target === "character:1.attack.melee")!.text
		expect(attack(fighter("hopeful"))).toBe("d20 11 + 1 (Mood) = 12 vs 10")
		expect(attack(fighter())).toBe("d20 11 vs 10")
		// A bridge onto another ruleset is not this one's.
		expect(attack(fighter("hopeful"), [{ ...always, ruleset: STORY }])).toBe("d20 11 vs 10")

		// A bridge's predicate may name its own field by its bare key (the SDK
		// admits it, W3-S); the host reads the field's value under that key,
		// so the bridge holds only when it should.
		const onHope = defineBridge({
			field: MOOD,
			ruleset: VIS_ITINERIS,
			effects: [{ verb: "modify", target: "attack.melee", value: 1, predicate: { path: "mood", equals: "hopeful" } }]
		})
		expect(attack(fighter("hopeful"), [onHope])).toBe("d20 11 + 1 (Mood) = 12 vs 10")
		expect(attack(fighter("wary"), [onHope])).toBe("d20 11 vs 10")
	})
})

describe("budget port", () => {
	test("fitted blocks: the port's records, at the depth each landed on, dropped ones left out", () => {
		const ann = owner("character:1", "Ann", {
			stats: [
				{ slotId: STR, selector: "str", type: "integer", value: 3, label: "Strength" },
				{ slotId: HP, selector: "hp", type: "integer", value: 20, label: "Health" },
				{ slotId: DEFENSE, selector: "defense", type: "derived", value: undefined, derive: "owner.str | plus: 10", label: "Defense" }
			],
			repertoires: [
				{
					slotId: GEAR,
					repertoire: getRepertoire(`${TRIAL}#weapons`)!,
					pieces: [piece({ name: "Longsword", description: "A long blade with a story behind it.", equipped: true })]
				}
			]
		})
		const out = runEngine(input({ ruleset: trial, owners: [ann] }))
		const roomy = fitContextBlocks(out.blocks, 10_000)
		expect(roomy.map((b) => b.key)).toEqual(Object.keys(out.blocks))
		for (const b of roomy) {
			expect(Object.keys(b).sort()).toEqual(["depth", "depths", "key", "priority", "text", "tokens"])
			expect(b.depths[b.depth]).toEqual({ text: b.text, tokens: expect.any(Number) })
		}
		const tight = fitContextBlocks(out.blocks, out.blocks.voice!.tokens + 2)
		expect(tight.map((b) => b.key)).toContain("voice")
		expect(tight.length).toBeLessThan(roomy.length)
		// The port's own records go round the same way.
		expect(fitContextBlocks(roomy, 10_000)).toEqual(roomy)
		// Counted in the run's tokens when its tokenizer is handed in: one token a word.
		const words = (t: string) => t.split(/\s+/).filter(Boolean).length
		const counted = fitContextBlocks(out.blocks, 10_000, words)
		expect(counted.find((b) => b.key === "voice")!.tokens).toBe(words(out.blocks.voice!.text))
	})
})

describe("offer gate (A20, PLAN §15)", () => {
	test("a slot a ruleset owns is offered only where that ruleset is played — the baseline too", () => {
		const owned = { rulesetOwned: VIS_ITINERIS }
		for (const from of ["baseline", "pick"] as const) {
			expect(offerableSlot(owned, [STORY], from)).toBe(false)
			expect(offerableSlot(owned, [VIS_ITINERIS], from)).toBe(true)
			expect(offerableSlot(owned, [STORY, VIS_ITINERIS], from)).toBe(true)
			expect(offerableSlot({}, [STORY], from)).toBe(true)
		}
		// A slot a mechanism keeps comes with the baseline, never as a pick.
		expect(offerableSlot({ pickable: false }, [VIS_ITINERIS], "pick")).toBe(false)
		expect(offerableSlot({ pickable: false }, [VIS_ITINERIS], "baseline")).toBe(true)
	})

	test("a foreign ruleset's repertoire is struck from a resolved config; the slot stays", () => {
		const gear = { repertoire: `${VIS_ITINERIS}#weapons`, max: 12 }
		expect(withoutForeignRepertoire(gear, [STORY])).toEqual({ max: 12 })
		expect(withoutForeignRepertoire(gear, [VIS_ITINERIS])).toBe(gear)
		expect(withoutForeignRepertoire({ min: 0 }, [STORY])).toEqual({ min: 0 })
	})
})

describe("🚧 the Story ruleset keeps things in words (owner ruling ★10, P2-6)", () => {
	const WEAPONS = "test:slot/w3-crawl-weapons@1"
	const POTIONS = "test:slot/w3-crawl-consumables@1"
	const parkedOwner = (weapons: unknown[] = [], potions: unknown[] = []) =>
		owner("character:1", "Pip", {
			custom: [
				{ slotId: WEAPONS, label: "Weapons", value: weapons as never, parked: { ruleset: VIS_ITINERIS, repertoire: "weapons" } },
				{ slotId: POTIONS, label: "Consumables", value: potions as never, parked: { ruleset: VIS_ITINERIS, repertoire: "consumables" } }
			]
		})
	test("a piece of a repertoire Story does not hold lands on its field as a name and a description — no numbers", () => {
		const story = getRuleset(STORY)!
		const out = runEngine(
			input({
				ruleset: story,
				rigour: "prose",
				mode: "apply",
				owners: [parkedOwner()],
				deltas: [
					{ owner: "character:1", repertoire: "weapons", op: "add", piece: "longsword", reason: "Fighter's kit" },
					{ owner: "character:1", repertoire: "weapons", op: "add", piece: { kind: "inline", name: "Second wind", description: "Catch your breath.", usesMax: 1 } }
				]
			})
		)
		expect(out.rejected).toEqual([])
		// Word items: a list that lost its repertoire holds words, never a piece.
		expect(out.changes.map((c) => c.items)).toEqual([[expect.stringMatching(/^Longsword — \S/)], ["Second wind — Catch your breath."]])
		expect(JSON.stringify(out.changes)).not.toMatch(/damage|usesMax|"dice"/)
		expect(out.outcomes.map((o) => o.text)).toEqual(["Pip gains Longsword", "Pip gains Second wind"])
	})

	test("spent or removed by name — a library row by its row's name — and told in words", () => {
		const story = getRuleset(STORY)!
		const potion = { kind: "compendium", compendiumId: VIS_ITINERIS, pieceId: "potion-of-healing", version: "1.1.0" }
		const out = runEngine(
			input({
				ruleset: story,
				rigour: "prose",
				mode: "apply",
				owners: [parkedOwner(["Rapier — Thin."], [potion])],
				deltas: [
					{ owner: "character:1", repertoire: "consumables", op: "spend", piece: "Potion of healing" },
					{ owner: "character:1", repertoire: "weapons", op: "remove", piece: "rapier" },
					{ owner: "character:1", repertoire: "weapons", op: "remove", piece: "Greataxe" }
				]
			})
		)
		expect(out.changes.map((c) => [c.slotId, c.op])).toEqual([
			[POTIONS, "remove"],
			[WEAPONS, "remove"]
		])
		expect(out.outcomes.map((o) => o.text)).toEqual(["Pip uses up Potion of healing", "Pip no longer has Rapier"])
		expect(out.rejected.map((r) => r.reason)).toEqual(["unknown-piece"])
		expect(out.outcomes.map((o) => o.text).join(" ")).not.toMatch(/\d/)
	})
})

describe("ruleset settings, checked", () => {
	test("a preset by name fills every option; an unknown option, choice or preset is refused", () => {
		expect(checkedRulesetSettings(visItineris, {}, { preset: "Classic" })).toMatchObject({ degrees: "classic", bonuses: "classic", focus: "concentration" })
		expect(checkedRulesetSettings(visItineris, { degrees: "classic" }, { values: { focus: "sustain" } })).toEqual({ degrees: "classic", focus: "sustain" })
		expect(() => checkedRulesetSettings(visItineris, {}, { values: { luck: "high" } })).toThrow(RulesetSettingsRefusal)
		expect(() => checkedRulesetSettings(visItineris, {}, { values: { degrees: "tenfold" } })).toThrow(/not a choice for Degrees of success/)
		expect(() => checkedRulesetSettings(visItineris, {}, { preset: "gritty" })).toThrow(/no preset called "gritty"/)
	})
})

describe("the elapsed port, in the ruleset's own unit", () => {
	const ROUND = { unit: "round" as const, roundSeconds: 6 }
	const MINUTE = { unit: "minute" as const }
	const HOUR = { unit: "hour" as const }
	const DAY = { unit: "day" as const }

	test("a bare number is already in the ruleset's unit", () => {
		expect(elapsedInUnits(3, ROUND)).toEqual({ units: 3 })
		expect(elapsedInUnits(45, MINUTE)).toEqual({ units: 45 })
	})

	test("a span converts through the conventions (the Crawler's Rest: { minutes: 480 })", () => {
		expect(elapsedInUnits({ minutes: 480 }, HOUR)).toEqual({ units: 8 })
		expect(elapsedInUnits({ minutes: 480 }, MINUTE)).toEqual({ units: 480 })
		expect(elapsedInUnits({ minutes: 1 }, ROUND)).toEqual({ units: 10 })
		expect(elapsedInUnits({ minutes: 1 }, { unit: "round", roundSeconds: 10 })).toEqual({ units: 6 })
		expect(elapsedInUnits({ hours: 2 }, MINUTE)).toEqual({ units: 120 })
		expect(elapsedInUnits({ days: 1 }, HOUR)).toEqual({ units: 24 })
		expect(elapsedInUnits({ days: 2 }, DAY)).toEqual({ units: 2 })
		expect(elapsedInUnits({ rounds: 4 }, ROUND)).toEqual({ units: 4 })
		expect(elapsedInUnits({ rounds: 10 }, MINUTE)).toEqual({ units: 1 })
		// A round with no `roundSeconds` said is six seconds.
		expect(elapsedInUnits({ rounds: 10 }, { unit: "round" })).toEqual({ units: 10 })
		expect(elapsedInUnits({ minutes: 1 }, { unit: "round" })).toEqual({ units: 10 })
	})

	test("a span a clock-less unit cannot count passes no time, and says so", () => {
		const r = elapsedInUnits({ minutes: 480 }, { unit: "scene" })
		expect(r.units).toBe(0)
		expect(r.notCounted).toMatch(/scene/)
	})

	test("nothing positive, or not one span, is no time at all", () => {
		for (const raw of [undefined, null, 0, -3, Number.NaN, "480", [], {}, { minutes: 0 }, { minutes: -5 }, { minutes: "8" }, { minutes: 1, hours: 1 }, { weeks: 1 }])
			expect(elapsedInUnits(raw, MINUTE)).toEqual({ units: 0 })
	})
})

describe("timing on references (A5)", () => {
	const loreAil = (overrides: Record<string, unknown>): HeldPiece => ({
		key: "hexed",
		props: { name: "Hexed", description: "A curse.", ...overrides } as HeldPiece["props"],
		count: 1,
		form: "lore",
		item: { kind: "lore", entryId: 9, overrides }
	})
	const holding = (p: HeldPiece) => owner("character:1", "Ann", { repertoires: [{ slotId: CONDITIONS, repertoire: conditions(), pieces: [p] }] })

	test("a lore piece's countdown is kept on its overrides, the entry untouched", () => {
		const out = runEngine(input({ mode: "advance", elapsed: 1, owners: [holding(loreAil({ duration: { units: "round", value: 2 } }))] }))
		expect(out.changes.map((c) => c.op)).toEqual(["set"])
		expect((out.changes[0]!.value as any[])[0]).toEqual({ kind: "lore", entryId: 9, overrides: { duration: { units: "round", value: 2, spent: 1 } } })
		const done = runEngine(input({ mode: "advance", elapsed: 1, owners: [holding(loreAil({ duration: { units: "round", value: 2, spent: 1 } }))] }))
		expect(done.outcomes[0]!.text).toBe("Ann: Hexed ends")
	})

	test("a library row added in play carries when it started, on its overrides", () => {
		const clock = { now: { year: 5, month: 1, day: 3, hour: 9, minute: 0 }, calendar: CALENDAR }
		const out = runEngine(
			input({
				mode: "apply",
				owners: [owner("character:1", "Ann", { repertoires: [{ slotId: CONDITIONS, repertoire: conditions(), pieces: [] }] })],
				deltas: [{ owner: "character:1", repertoire: "conditions", op: "add", piece: "Poisoned" }],
				clock,
				turn: 7
			})
		)
		const added = out.changes[0]!.items![0] as any
		expect(added).toMatchObject({ kind: "compendium", pieceId: "poisoned" })
		// The row's own duration with the start laid over it — never the row edited.
		expect(added.overrides.duration).toEqual({ units: "hour", value: 1, expiry: "elapsed", startedAt: { turn: 7, clock: clock.now } })
	})
})

describe("turns are rounds (A6)", () => {
	test("only a reply on the default channel counts; a player's line, a side channel's or a table line does not", () => {
		expect(countsAsRound({ role: "assistant", channel: "main" })).toBe(true)
		expect(countsAsRound({ role: "assistant" })).toBe(true)
		expect(countsAsRound({ role: "user", channel: "main" })).toBe(false)
		expect(countsAsRound({ role: "assistant", channel: "table" })).toBe(false)
		expect(countsAsRound({ role: "system", channel: "main" })).toBe(false)
		expect(roundsSince(3, 5)).toBe(2)
		expect(roundsSince(undefined, 5)).toBeNull()
	})

	test("a condition lasting 3 turns ends on the third round after it began", () => {
		const shaken = (turn: number) =>
			owner("character:1", "Ann", {
				repertoires: [
					{ slotId: CONDITIONS, repertoire: conditions(), pieces: [piece({ name: "Shaken", duration: { units: "turn", value: 3, startedAt: { turn: 2 } } })] }
				]
			})
		expect(runEngine(input({ mode: "advance", owners: [shaken(2)], turn: 4 })).outcomes).toEqual([])
		expect(runEngine(input({ mode: "advance", owners: [shaken(2)], turn: 5 })).outcomes[0]!.text).toBe("Ann: Shaken ends")
	})
})

describe("spending a counted piece (A16)", () => {
	const pack = (props: Record<string, unknown>, count = 1): OwnerView => {
		const p = piece(props)
		return owner("character:1", "Ann", {
			repertoires: [{ slotId: GEAR, repertoire: getRepertoire(`${TRIAL}#weapons`)!, pieces: [{ ...p, count, item: { ...p.item, count } as HeldPiece["item"] }] }]
		})
	}
	const spend = (o: OwnerView) =>
		runEngine(input({ ruleset: trial, mode: "apply", owners: [o], deltas: [{ owner: "character:1", repertoire: "weapons", op: "spend", piece: "Dart" }] }))

	test("a stack loses one; only the last leaves", () => {
		const three = spend(pack({ name: "Dart" }, 3))
		expect(three.changes.map((c) => c.op)).toEqual(["remove", "add"])
		expect((three.changes[1]!.items![0] as any).count).toBe(2)
		expect(three.outcomes[0]!.text).toBe("Ann uses Dart; 2 left")
		const one = spend(pack({ name: "Dart" }))
		expect(one.changes.map((c) => c.op)).toEqual(["remove"])
	})

	test("uses run down before the piece does; a stack of single-use pieces is spent one at a time", () => {
		const wand = spend(pack({ name: "Dart", uses: 3 }))
		expect((wand.changes[1]!.items![0] as any).uses).toBe(2)
		const potions = spend(pack({ name: "Dart", uses: 1 }, 3))
		expect((potions.changes[1]!.items![0] as any)).toMatchObject({ uses: 1, count: 2 })
	})
})

describe("one fold of every modify (A17)", () => {
	const ann = () =>
		owner("character:1", "Ann", {
			stats: [
				{ slotId: STR, selector: "str", type: "integer", value: 3, label: "Strength" },
				{ slotId: DEFENSE, selector: "defense", type: "derived", value: undefined, derive: "owner.str | plus: 10", label: "Defense" }
			],
			custom: [{ slotId: MOOD, label: "Mood", value: "bold" }]
		})
	const bridge = (target: string) => defineBridge({ field: MOOD, ruleset: TRIAL, effects: [{ verb: "modify", target, value: 2 }] })

	test("a script's modify on a stat shows in the sheet's value, as a roll counts it", () => {
		const out = runEngine(
			input({
				ruleset: trial,
				owners: [ann()],
				scripted: { "character:1": { values: {}, modifies: [{ target: "str", value: 1, label: "Blessing", seedKey: "s" }], explain: [], failed: [] } }
			})
		)
		expect((out.facts.values as any)["character:1"].str).toBe(4)
		expect(out.blocks.sheet!.text).toContain("Strength: 4")
		expect(out.explain.map((e) => e.text)).toContain("3 (Strength) + 1 (Blessing) = 4")
	})

	test("a bridge's modify on a stat folds in after the derived phase", () => {
		const out = runEngine(input({ ruleset: trial, owners: [ann()], bridges: [bridge("str")] }))
		expect((out.facts.values as any)["character:1"]).toMatchObject({ str: 5, defense: 13 })
	})

	test("a modify on a worked-out value is skipped, and the trail says so", () => {
		const out = runEngine(input({ ruleset: trial, owners: [ann()], bridges: [bridge("defense")] }))
		expect((out.facts.values as any)["character:1"].defense).toBe(13)
		expect(out.explain.find((e) => e.target === "character:1.skipped")!.text).toBe(
			"Mood would change Defense, which is worked out from the sheet — skipped"
		)
	})
})

describe("one slot-reference normaliser (C3)", () => {
	const ann = () =>
		owner("character:1", "Ann", {
			stats: [{ slotId: HP, selector: "hp", type: "integer", value: 20, label: "Health" }],
			custom: [{ slotId: "core:slot/character-class@1", label: "Class", value: "Rogue" }]
		})
	test("a slot reads by its id, its bare key, any case, or its label", () => {
		expect(normaliseSlotRef("core:slot/HP@1")).toBe("hp")
		for (const slot of [HP, "hp", "HP", "Health", "health"]) {
			const out = runEngine(input({ ruleset: trial, mode: "apply", owners: [ann()], deltas: [{ owner: "character:1", slot, op: "add", value: -1 }] }))
			expect(out.changes).toEqual([expect.objectContaining({ slotId: HP, value: -1 })])
		}
		const cls = runEngine(input({ ruleset: trial, mode: "apply", owners: [ann()], deltas: [{ owner: "character:1", slot: "class", op: "set", value: "Bard" }] }))
		expect(cls.changes).toEqual([expect.objectContaining({ slotId: "core:slot/character-class@1", value: "Bard" })])
	})
})
