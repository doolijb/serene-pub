/**
 * 🚧 The turn tally (R51, R52; lane F1, 2026-10-21): every line is a turn of
 * its lane, by its speaker; a round ends once every active speaker — the turn
 * order's seats and every person who spoke — has had a turn.
 */
import { describe, expect, it } from "vitest"
import { NARRATOR_SPEAKER, publishedTurns, readTurnTally, speakerKey, tallyTurn, type LaneTally } from "./turnTally"

const P = "character:9" // the member's persona
const A = "character:4"
const B = "character:5"

/** Note lines in order on the story's lane; `seats` is the turn order's after each. */
function play(lines: Array<{ speaker: string; person?: boolean; seats: string[] }>) {
	let lane: LaneTally | undefined
	const ended: Array<{ at: number; round: number; speakers: string[] }> = []
	const steps = lines.map((l, i) => {
		const step = tallyTurn(lane, { messageId: 100 + i, turn: i + 1, speaker: l.speaker, person: !!l.person }, l.seats)
		lane = step.next
		if (step.roundEnded) ended.push({ at: i + 1, ...step.roundEnded })
		return step
	})
	return { steps, ended, lane: lane! }
}

describe("rounds (R52) — every active speaker has had a turn", () => {
	it("one to one: the person's line never closes the round; the reply does", () => {
		const { ended, steps } = play([
			{ speaker: P, person: true, seats: [P, A] },
			{ speaker: A, seats: [P, A] },
			{ speaker: P, person: true, seats: [P, A] },
			{ speaker: A, seats: [P, A] }
		])
		expect(ended).toEqual([
			{ at: 2, round: 1, speakers: [P, A] },
			{ at: 4, round: 2, speakers: [P, A] }
		])
		expect(steps[1]!.turnsBy).toEqual({ [P]: 1, [A]: 1 })
		expect(steps[2]!.round).toBe(2)
	})

	it("a group: the round waits for every seated character", () => {
		const seats = [P, A, B]
		const { ended } = play([
			{ speaker: P, person: true, seats },
			{ speaker: A, seats },
			{ speaker: B, seats },
			{ speaker: P, person: true, seats }
		])
		expect(ended).toEqual([{ at: 3, round: 1, speakers: [P, A, B] }])
	})

	it("a narrator genre with nobody seated: the prepared narrator turn holds the round open", () => {
		const { ended } = play([
			{ speaker: "user:1", person: true, seats: [NARRATOR_SPEAKER] },
			{ speaker: NARRATOR_SPEAKER, seats: [] },
			{ speaker: "user:1", person: true, seats: [NARRATOR_SPEAKER] },
			{ speaker: NARRATOR_SPEAKER, seats: [] }
		])
		expect(ended.map((e) => e.at)).toEqual([2, 4])
	})

	it("characters on their own (no person): the round ends when each seated one has spoken", () => {
		const seats = [A, B]
		const { ended } = play([
			{ speaker: A, seats },
			{ speaker: B, seats },
			{ speaker: A, seats }
		])
		expect(ended.map((e) => e.at)).toEqual([2])
	})

	it("a second person joins mid-round: they are active once they speak", () => {
		const { ended } = play([
			{ speaker: P, person: true, seats: [P, A] },
			{ speaker: "user:2", person: true, seats: [P, A] },
			{ speaker: A, seats: [P, A] }
		])
		expect(ended).toEqual([{ at: 3, round: 1, speakers: [P, "user:2", A] }])
	})
})

describe("turns (R51)", () => {
	it("a line already noted counts nothing — a regenerate ends its turn under the same number", () => {
		const first = tallyTurn(undefined, { messageId: 10, turn: 1, speaker: A, person: false }, null)
		const again = tallyTurn(first.next, { messageId: 10, turn: 1, speaker: A, person: false }, null)
		expect(again.counted).toBe(false)
		expect(again.next).toBe(first.next)
		expect(again.turnsBy).toEqual({ [A]: 1 })
	})

	it("a lane with no rounds counts every turn by speaker", () => {
		let lane: LaneTally | undefined
		for (const [i, who] of [A, B, A].entries()) lane = tallyTurn(lane, { messageId: i + 1, turn: i + 1, speaker: who, person: false }, null).next
		expect(lane).toMatchObject({ turn: 3, lastSpeaker: A, turnsBy: { [A]: 2, [B]: 1 } })
		expect(lane!.round).toBeUndefined()
	})

	it("narration is the narrator's turn", () => {
		expect(speakerKey(null)).toBe(NARRATOR_SPEAKER)
		expect(speakerKey(A)).toBe(A)
	})

	it("reads back what was stored, and publishes the story's lane", () => {
		const tally = { v: 1, lanes: { main: { turn: 7, lastMessageId: 70, lastSpeaker: A, turnsBy: { [A]: 1 }, spoke: [A], persons: [], round: 3 } } }
		expect(readTurnTally({ turnTally: tally })).toEqual(tally)
		expect(publishedTurns({ turnTally: tally })).toEqual({ turn: 7, round: 3, lastSpeaker: A, turnsBy: { [A]: 1 } })
		expect(publishedTurns({})).toEqual({ turn: 0, round: 1, lastSpeaker: null, turnsBy: {} })
		expect(readTurnTally({ turnTally: "garbage" })).toEqual({ v: 1, lanes: {} })
	})
})
