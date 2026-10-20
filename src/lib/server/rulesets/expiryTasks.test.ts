/**
 * 🚧 *End what runs out* (`timed-expiry`) and *Track conditions*
 * (`conditions`) over the ruleset engine's timed expiry (lane 2 of
 * PLAN-genre-restructure, 2026-10-19): Off stops the countdown, Review holds
 * the ending for review, and a genre that declares neither runs as before.
 */
import { beforeAll, describe, expect, test } from "vitest"
import "@serene-pub/core-catalog"
import { getRepertoire, getRuleset, type RulesetDecl } from "@serene-pub/sdk"
import { runApply } from "./engine"
import { expiryOf } from "./resolve"
import type { EngineInput, HeldPiece, OwnerView } from "./types"

const VIS_ITINERIS = "core:ruleset/vis-itineris@1"
const CONDITIONS = "test:slot/lane2-conditions@1"
const GEAR = "test:slot/lane2-gear@1"

let visItineris: RulesetDecl
beforeAll(() => {
	visItineris = getRuleset(VIS_ITINERIS)!
})

const piece = (props: Record<string, unknown>): HeldPiece => ({
	key: String(props.name).toLowerCase(),
	props: { description: "", ...props } as HeldPiece["props"],
	count: 1,
	form: "inline",
	item: { kind: "inline", description: "", ...props } as HeldPiece["item"]
})
const poisoned = () => piece({ name: "Poisoned", duration: { units: "round", value: 1, expiry: "elapsed" } })
const torch = () => piece({ name: "Torch", duration: { units: "round", value: 1, expiry: "elapsed" } })

const ann = (): OwnerView => ({
	key: "character:1",
	owner: { kind: "session_cast", id: 1 },
	name: "Ann",
	stats: [],
	repertoires: [
		{ slotId: CONDITIONS, repertoire: getRepertoire(`${VIS_ITINERIS}#conditions`)!, pieces: [poisoned()] },
		{ slotId: GEAR, repertoire: getRepertoire(`${VIS_ITINERIS}#gear`)!, pieces: [torch()] }
	],
	custom: [],
	bag: {}
})

const advance = (expiry?: EngineInput["expiry"]) =>
	runApply({
		ruleset: visItineris,
		rigour: "mechanics",
		owners: [ann()],
		actions: {},
		deltas: [],
		elapsed: 1,
		ties: [],
		turn: 4,
		...(expiry ? { expiry } : {})
	})

describe("the session's tasks over timed expiry", () => {
	test("expiryOf reads the two tasks, and nothing for a genre that has neither", () => {
		expect(expiryOf({})).toBeUndefined()
		expect(expiryOf({ attributes: "full" })).toBeUndefined()
		expect(expiryOf({ "timed-expiry": "off" })).toEqual({ pieces: false, review: false })
		expect(expiryOf({ "timed-expiry": "review", conditions: "full" })).toEqual({ pieces: true, review: true, conditions: true })
		expect(expiryOf({ conditions: "off" })).toEqual({ conditions: false })
	})

	test("absent: both repertoires run out, as before", () => {
		const out = advance()
		expect(out.changes.map((c) => c.slotId).sort()).toEqual([CONDITIONS, GEAR].sort())
		expect(out.changes.every((c) => !c.held)).toBe(true)
	})

	test("End what runs out Off: nothing counts down or leaves", () => {
		const out = advance({ pieces: false })
		expect(out.changes).toEqual([])
		expect(out.outcomes).toEqual([])
	})

	test("End what runs out on Review: the ending is held", () => {
		const out = advance({ pieces: true, review: true })
		expect(out.changes).toHaveLength(2)
		expect(out.changes.every((c) => c.held === true)).toBe(true)
	})

	test("Track conditions Off: the conditions repertoire is left alone, the rest runs", () => {
		const out = advance({ pieces: true, conditions: false })
		expect(out.changes.map((c) => c.slotId)).toEqual([GEAR])
	})
})
