/**
 * Stage only (the shell's Ctrl/⌘ + ., `panelsCtx.stageOnly`): the two pure
 * decisions ./stageOnly makes for the live session layout — whether it is on,
 * and which middle unit is the conversation's. The live layout marks every
 * other unit `data-stage-hidden` from these; nothing is unmounted or written.
 */
import { describe, expect, test } from "vitest"
import { primaryUnitKey, stageOnlyActive } from "./stageOnly"
import { stageOf } from "./placementRules"

describe("stageOnly helpers", () => {
	test("on only when the shell asks for it at desktop width", () => {
		expect(stageOnlyActive({ stageOnly: true }, true)).toBe(true)
		expect(stageOnlyActive({ stageOnly: true }, false)).toBe(false)
		expect(stageOnlyActive({ stageOnly: false }, true)).toBe(false)
		expect(stageOnlyActive(undefined, true)).toBe(false)
	})

	test("the primary's unit, a group holding it included; none hides nothing", () => {
		const units = [
			{ key: "scene-portraits", memberIds: ["scene-portraits"] },
			{ key: "g1", memberIds: ["notes", "messages"] }
		]
		expect(primaryUnitKey(units, "messages")).toBe("g1")
		expect(primaryUnitKey(units, "board")).toBeNull()
	})

	test("the conversation in a side: the stage is that side, and the middle hides nothing of its own", () => {
		// Brief 7a (QE (1)): Stage only draws the log wherever it sits. The
		// middle holds no unit with it, so the middle's own rule answers null
		// and the side's mount is drawn as the stage instead.
		const middle = [{ key: "world-state", memberIds: ["world-state"] }]
		const pick = stageOf({
			middle: ["world-state"],
			left: ["stats", "messages"],
			right: [],
			claims: new Map(),
			primaryId: "messages"
		})
		expect(pick).toEqual({ id: "messages", zone: "left" })
		expect(primaryUnitKey(middle, pick!.id)).toBeNull()
	})
})
