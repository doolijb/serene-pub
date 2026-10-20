/**
 * Stage only (the shell's Ctrl/⌘ + ., `panelsCtx.stageOnly`): the two pure
 * decisions ./stageOnly makes for the live session layout — whether it is on,
 * and which PANEL is the conversation's (PLAN-session-panels-2026-10-14). The
 * live layout marks every other panel `data-stage-hidden` from these; nothing
 * is unmounted or written.
 */
import { describe, expect, test } from "vitest"
import { resolveDrawn } from "@serene-pub/sdk"
import { stageOnlyActive, stagePanelOf } from "./stageOnly"
import { stageOf } from "./placementRules"

describe("stageOnly helpers", () => {
	test("on only when the shell asks for it at desktop width", () => {
		expect(stageOnlyActive({ stageOnly: true }, true)).toBe(true)
		expect(stageOnlyActive({ stageOnly: true }, false)).toBe(false)
		expect(stageOnlyActive({ stageOnly: false }, true)).toBe(false)
		expect(stageOnlyActive(undefined, true)).toBe(false)
	})

	test("the stage's panel, a panel holding it as a second tab included; none hides nothing", () => {
		const d = resolveDrawn(
			{
				panels: {
					version: 1,
					left: [],
					right: [],
					middle: {
						above: [{ key: "s", tabs: ["scene-portraits"] }],
						primary: { key: "p1", tabs: ["notes", "messages"] },
						below: []
					}
				}
			},
			{ inline: 1300 }
		)
		const middle = [...d.middle.above, d.middle.primary, ...d.middle.below]
		expect(stagePanelOf(middle, "messages")).toBe("p1")
		expect(stagePanelOf(middle, "board")).toBeNull()
		expect(stagePanelOf(middle, null)).toBeNull()
	})

	test("the conversation in a side: the stage is that side's panel, and the middle hides nothing of its own", () => {
		// Brief 7a (QE (1)): Stage only draws the log wherever it sits. The
		// middle holds no panel with it, so the middle's own rule answers null
		// and the side's mount is drawn as the stage instead.
		const d = resolveDrawn(
			{
				panels: {
					version: 1,
					left: [
						{ key: "a", tabs: ["stats"] },
						{ key: "b", tabs: ["messages"] }
					],
					right: [],
					middle: { above: [], primary: { key: "p1", tabs: ["world-state"] }, below: [] }
				}
			},
			{ inline: 1300 }
		)
		const pick = stageOf({
			middle: ["world-state"],
			left: ["stats", "messages"],
			right: [],
			claims: new Map(),
			primaryId: "messages"
		})
		expect(pick).toEqual({ id: "messages", zone: "left" })
		expect(stagePanelOf([d.middle.primary], pick!.id)).toBeNull()
		expect(stagePanelOf(d.left.panels, pick!.id)).toBe("b")
	})

	test("no conversation anywhere (R-B): Stage only draws the primary panel, whatever it holds", () => {
		const d = resolveDrawn(
			{
				panels: {
					version: 1,
					left: [{ key: "a", tabs: ["stats"] }],
					right: [],
					middle: {
						above: [{ key: "s", tabs: ["scene-portraits"] }],
						primary: { key: "p1", tabs: ["places", "notes"] },
						below: []
					}
				}
			},
			{ inline: 1300 }
		)
		const middle = [...d.middle.above, d.middle.primary, ...d.middle.below]
		const pick = stageOf({
			middle: d.middle.primary.tabs.map((t) => t.instanceId),
			left: ["stats"],
			right: [],
			claims: new Map(),
			primaryId: "messages"
		})
		expect(pick).toEqual({ id: "places", zone: "middle" })
		expect(stagePanelOf(middle, pick!.id)).toBe("p1")
	})
})
