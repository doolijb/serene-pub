/**
 * **Planned turns** (Lair character turns, owner ruling 2026-09-30): the
 * narrator strategy reads the standing turn plan off the history and prepares
 * one entry per character turn not yet taken, `via: 'plan'`.
 *
 * A row a planner wrote carries `turnPlan` (`create-message@1`'s port, stored
 * as `metadata.turnPlan`, projected onto the history row). The plan stands
 * until a person's line on `main` is newer than it, or one of its turns was
 * stopped (R34: a Stop ends the round). While it stands it has answered the
 * person's line, so `main` prepares no own-voice entry beside it.
 */
import { describe, expect, it } from "vitest"
import {
	narratorEntries,
	standingTurnPlan,
	type RotationMessage
} from "$lib/server/pipelines/runtime/speakerRotation"

const VERITY = "character:11"
const BRASK = "character:12"

const person = (content = "Down the shaft."): RotationMessage =>
	({ role: "user", content, channel: "main" }) as RotationMessage
const planRow = (turns: string[]): RotationMessage =>
	({
		role: "assistant",
		channel: "sanctum",
		speaker: "envoy:castellan",
		turnPlan: { turns, plan: { beats: ["They go down."] } }
	}) as RotationMessage
const line = (characterId: number, extra: Partial<RotationMessage> = {}): RotationMessage =>
	({ role: "assistant", channel: "main", characterId, ...extra }) as RotationMessage

describe("the standing turn plan prepares each character turn in order", () => {
	it("prepares every named delver, in the plan's order, and no own-voice entry on main", () => {
		expect(narratorEntries([person(), planRow([VERITY, BRASK])])).toEqual([
			{ ref: VERITY, via: "plan" },
			{ ref: BRASK, via: "plan" }
		])
	})

	it("drops a turn once its delver has spoken on main after the plan", () => {
		expect(narratorEntries([person(), planRow([VERITY, BRASK]), line(11)])).toEqual([
			{ ref: BRASK, via: "plan" }
		])
		expect(narratorEntries([person(), planRow([VERITY, BRASK]), line(11), line(12)])).toEqual([])
	})

	it("counts a line spoken BEFORE the plan as no turn of it", () => {
		expect(narratorEntries([line(11), person(), planRow([VERITY])])).toEqual([
			{ ref: VERITY, via: "plan" }
		])
	})

	it("is superseded by a person's line on main: the own voice is due again", () => {
		expect(narratorEntries([person(), planRow([VERITY, BRASK]), line(11), person("Wait.")])).toEqual([
			{ ref: null, via: "voice" }
		])
	})

	it("ends when one of its turns was stopped (a Stop ends the round)", () => {
		expect(
			narratorEntries([person(), planRow([VERITY, BRASK]), line(11, { stopped: true } as any)])
		).toEqual([])
	})

	it("a plan naming nobody stands and prepares nothing — it answered the line", () => {
		expect(narratorEntries([person(), planRow([])])).toEqual([])
	})

	it("a Sanctum line beside a standing plan is answered first, the turns after it", () => {
		const talk = { role: "user", content: "Is the hall wet?", channel: "sanctum" } as RotationMessage
		expect(narratorEntries([person(), planRow([VERITY]), talk])).toEqual([
			{ ref: null, via: "voice", channel: "sanctum" },
			{ ref: VERITY, via: "plan" }
		])
	})

	it("a hidden plan row plans nothing", () => {
		const hidden = { ...planRow([VERITY]), isHidden: true } as RotationMessage
		expect(narratorEntries([person(), hidden])).toEqual([{ ref: null, via: "voice" }])
	})

	it("rows that carry no plan leave the narrator strategy exactly as it was", () => {
		expect(narratorEntries([person()])).toEqual([{ ref: null, via: "voice" }])
		expect(narratorEntries([person(), line(11)])).toEqual([])
	})
})

describe("standingTurnPlan", () => {
	it("names the row that stands, with its turns", () => {
		const rows = [person(), planRow([VERITY, BRASK])]
		expect(standingTurnPlan(rows)?.turns).toEqual([VERITY, BRASK])
		expect(standingTurnPlan(rows)?.index).toBe(1)
	})

	it("answers null when a person spoke on main after the newest plan", () => {
		expect(standingTurnPlan([planRow([VERITY]), person()])).toBeNull()
	})

	it("answers the plan standing before a given row (a re-voice reads the plan it was played from)", () => {
		const rows = [
			person(),
			{ ...planRow([VERITY]), id: 2 },
			{ ...line(11), id: 3 },
			{ ...person("On."), id: 4 },
			{ ...planRow([BRASK]), id: 5 }
		] as RotationMessage[]
		expect(standingTurnPlan(rows, 3)?.turns).toEqual([VERITY])
		expect(standingTurnPlan(rows)?.turns).toEqual([BRASK])
	})
})
