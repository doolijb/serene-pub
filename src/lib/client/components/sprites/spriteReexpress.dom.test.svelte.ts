/**
 * 🚧 *Re-express from neutral* on a contact-sheet tile (DESIGN-image-generation
 * §6.3): offered only where the tab says it may run — the pair's sheet says
 * `expressions`, the set has a neutral picture, and the tile is not neutral.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import SpriteContactSheet from "./SpriteContactSheet.svelte"
import type { ContactTile } from "./contactSheet"

let view: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (view) unmount(view)
	view = null
	document.body.innerHTML = ""
})

const TILES: ContactTile[] = [
	{ label: "joy", state: "attached", src: "/media/a?r=0", spriteId: 7 },
	{ label: "neutral", state: "attached", src: "/media/n?r=0", spriteId: 9 }
]

function render(canReexpress: (label: string) => boolean) {
	const calls: string[] = []
	view = mount(SpriteContactSheet, {
		target: document.body,
		props: {
			tiles: TILES,
			running: false,
			canMove: false,
			canReexpress,
			onReexpress: (l: string) => calls.push(l)
		}
	})
	flushSync()
	return calls
}

const trigger = (label: string) =>
	document.querySelector(
		`[aria-label="More actions for the ${label} sprite"]`
	) as HTMLButtonElement | null

const menuItem = (name: RegExp) =>
	[...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((el) =>
		name.test((el.textContent ?? "").trim())
	)

describe("Re-express from neutral on a tile", () => {
	test("hidden when the pair's sheet has no expressions", () => {
		render(() => false)
		expect(trigger("joy")).toBeNull()
		expect(trigger("neutral")).toBeNull()
		expect(menuItem(/Re-express from neutral/)).toBeUndefined()
	})

	test("offered on a non-neutral tile when the sheet says expressions", async () => {
		const calls = render((label) => label !== "neutral")
		expect(trigger("neutral")).toBeNull()
		const open = trigger("joy")
		expect(open).toBeTruthy()
		open!.click()
		flushSync()
		await tick()
		const item = menuItem(/Re-express from neutral/)
		expect(item).toBeTruthy()
		item!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
		item!.click()
		flushSync()
		await tick()
		expect(calls).toEqual(["joy"])
	})
})
