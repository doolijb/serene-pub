/**
 * 🚧 Unprompted turns (`core:task/turn-unprompted@1`, lane 2 of
 * PLAN-genre-restructure, 2026-10-19): the voices group's tasks over a
 * prepared order — at most one entry at its head, once the round is over,
 * each voice once a round.
 */
import { describe, it, expect } from "vitest"
import { unpromptedEntries, type TurnCandidate, type TurnEntry } from "./speakerRotation"

const cand = (ref: string, kind = "character", position = 0): TurnCandidate =>
	({ ref, kind, name: ref, position }) as TurnCandidate
const ash = cand("character:1")
const bram = cand("character:2", "character", 1)
const me = cand("character:9", "persona", 2)
const candidates = [ash, bram, me]

const user = { role: "user", personaId: 9 }
const said = (characterId: number) => ({ role: "assistant", characterId })
const narration = { role: "assistant", isNarratorResponse: true }

const ON = { "side-cast": "full", "narrator-interjections": "full" }
const NARRATE = "core:spec/story-narrate#narrate"

describe("unpromptedEntries", () => {
	it("passes the order through while both tasks are off", () => {
		const order: TurnEntry[] = []
		expect(unpromptedEntries(order, candidates, [user, said(1), said(2)] as never, {})).toEqual([])
		expect(unpromptedEntries(order, candidates, [user, said(1), said(2)] as never, { "side-cast": "off" })).toEqual([])
	})

	it("waits for the round: an AI entry still to fire, or nobody answered yet, adds nothing", () => {
		const pending: TurnEntry[] = [{ ref: "character:2", via: "strategy" }]
		expect(unpromptedEntries(pending, candidates, [user, said(1)] as never, ON)).toEqual(pending)
		expect(unpromptedEntries([], candidates, [user] as never, ON)).toEqual([])
	})

	it("after the round: a character who did not speak last speaks up, earliest first", () => {
		const out = unpromptedEntries([], candidates, [user, said(1), said(2)] as never, ON, { narrate: NARRATE })
		expect(out).toEqual([{ ref: "character:1", via: "unprompted" }])
	})

	it("a person's own entry stays behind the unprompted one", () => {
		const mine: TurnEntry[] = [{ ref: "character:9", via: "strategy" }]
		const out = unpromptedEntries(mine, candidates, [user, said(1), said(2)] as never, ON)
		expect(out[0]).toEqual({ ref: "character:1", via: "unprompted" })
		expect(out[1]).toEqual(mine[0])
	})

	it("once a character has spoken twice, the narrator's line comes next, then nothing", () => {
		const twice = [user, said(1), said(2), said(1)]
		expect(unpromptedEntries([], candidates, twice as never, ON, { narrate: NARRATE })).toEqual([
			{ ref: null, via: "unprompted", subject: NARRATE }
		])
		expect(unpromptedEntries([], candidates, [...twice, narration] as never, ON, { narrate: NARRATE })).toEqual([])
	})

	it("with one character, side cast has nobody else; the narrator still may", () => {
		const solo = [ash, me]
		expect(unpromptedEntries([], solo, [user, said(1)] as never, ON, { narrate: NARRATE })).toEqual([
			{ ref: null, via: "unprompted", subject: NARRATE }
		])
		expect(unpromptedEntries([], solo, [user, said(1)] as never, { "side-cast": "full" })).toEqual([])
	})

	it("the person's next line opens a new round with nothing unprompted prepared", () => {
		const after = [user, said(1), said(2), said(1), narration, { role: "user", personaId: 9 }]
		expect(unpromptedEntries([], candidates, after as never, ON, { narrate: NARRATE })).toEqual([])
	})

	it("a side channel's lines are not the round", () => {
		const elsewhere = [user, { ...said(1), channel: "sanctum" }]
		expect(unpromptedEntries([], candidates, elsewhere as never, ON)).toEqual([])
	})
})
