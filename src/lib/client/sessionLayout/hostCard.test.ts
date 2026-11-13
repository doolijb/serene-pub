import { describe, expect, test } from "vitest"
import { HOST_CARD_CLASS } from "./hostCard"
import { withHostCard, UNPLACED, projectLayout } from "$lib/shared/widgets/context"

describe("the host card", () => {
	test("is one class string", () => {
		expect(HOST_CARD_CLASS.includes("rounded-lg")).toBe(true)
	})
})

describe("withHostCard — what the widget is told", () => {
	test("carded: card, background and wrapper on, title bar unless withheld", () => {
		const c = projectLayout(withHostCard(UNPLACED, true)).chrome
		expect(c).toMatchObject({ card: true, background: true, wrapper: true, titleBar: true })
		expect(projectLayout(withHostCard(UNPLACED, true, false)).chrome.titleBar).toBe(false)
	})
	test("flush: the host paints nothing", () => {
		const pinned = { ...UNPLACED, pinned: true }
		const c = projectLayout(withHostCard(pinned, false)).chrome
		expect(c).toMatchObject({ card: false, background: false, wrapper: false, titleBar: false })
	})
	test("no placement is the unplaced one, told its card", () => {
		const p = withHostCard(undefined, true)
		expect(p.zone).toEqual(UNPLACED.zone)
		expect(p.chrome?.card).toBe(true)
	})
	test("an untold placement is flush", () => {
		expect(projectLayout(UNPLACED).chrome.card).toBe(false)
	})
})
