/**
 * `change-sprite` opens the sprite picker for a settled character line the
 * viewer may control — the controls' own rule, held again: a request is not a grant.
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerChangeSprite, type SpriteLine } from "./changeSprite"
import { guardWidgetRequests } from "./askers"
import type { WidgetRequestHandler } from "$lib/shared/widgets/context"

type Line = SpriteLine & { id: number; mine: boolean }
const lines: Line[] = [
	{ id: 1, characterId: 7, mine: true },
	{ id: 2, characterId: null, mine: true },
	{ id: 3, characterId: 7, isNarratorResponse: true, mine: true },
	{ id: 4, characterId: 7, isGenerating: true, mine: true },
	{ id: 5, characterId: 7, mine: false }
]

function page() {
	const picked: number[] = []
	return {
		picked,
		deps: {
			findMessage: (id: number) => lines.find((m) => m.id === id),
			canControl: (m: Line) => m.mine,
			showSpritePicker: (m: Line) => picked.push(m.id)
		}
	}
}

describe("answerChangeSprite", () => {
	test("opens the picker on a settled character line the viewer controls", () => {
		const { picked, deps } = page()
		answerChangeSprite({ messageId: 1 }, deps)
		expect(picked).toEqual([1])
	})

	test.each([2, 3, 4, 5, 99])("refuses line %i in words", (messageId) => {
		const { picked, deps } = page()
		expect(() => answerChangeSprite({ messageId }, deps)).toThrow("that line's sprite is not yours to change")
		expect(picked).toEqual([])
	})

	test("anyone may ask: the guard passes a plugin's widget on; the control rule is the answer's", async () => {
		expect(WIDGET_REQUEST_ASKERS["change-sprite"]).toBe("any")
		const { picked, deps } = page()
		const ask = guardWidgetRequests((async (_k: string, p: unknown) => answerChangeSprite(p, deps)) as WidgetRequestHandler)
		await ask("change-sprite", { messageId: 1 }, { widgetId: "acme:x", owner: "acme" })
		await expect(ask("change-sprite", { messageId: 5 }, { widgetId: "acme:x", owner: "acme" })).rejects.toThrow(
			"not yours to change"
		)
		expect(picked).toEqual([1])
	})
})
