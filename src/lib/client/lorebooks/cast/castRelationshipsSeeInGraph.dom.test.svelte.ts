/**
 * 🚧 Advanced controls (★adv-D-1, 2026-11-10): the Graph lens is hidden while
 * the person's switch is off, so its door, *See in graph*, is only drawn when
 * the cast board hands one in.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import CastRelationships from "./CastRelationships.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

function render(onSeeInGraph?: () => void) {
	app = mount(CastRelationships, {
		target: document.body,
		props: {
			rows: [],
			inStory: 0,
			laterLabel: () => null,
			isNew: () => false,
			onKeep: () => {},
			onSeeInGraph
		}
	})
	flushSync()
}

const seeInGraph = () =>
	[...document.querySelectorAll("button")].find((b) =>
		(b.textContent ?? "").includes("See in graph")
	) ?? null

describe("See in graph under advanced controls", () => {
	test("no door handed in (switch off): no button", () => {
		render()
		expect(seeInGraph() === null).toBe(true)
	})

	test("a door handed in (switch on): the button opens it", () => {
		const open = vi.fn()
		render(open)
		const button = seeInGraph()
		expect(button === null).toBe(false)
		button!.click()
		expect(open).toHaveBeenCalledTimes(1)
	})
})
