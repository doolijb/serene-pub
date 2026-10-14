/**
 * 🚧 The Sprites tab's contact sheet (I5), driven by a fake run: tiles wait
 * while the run draws, fill as pictures arrive, and once it ends offer Keep
 * and Redo — a label the run brought nothing for is an empty tile with Redo
 * only. Dragging one tile onto another moves that sprite to the other label.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import SpriteContactSheet from "./SpriteContactSheet.svelte"
import type { ContactTile } from "./contactSheet"

let view: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (view) unmount(view)
	view = null
	document.body.innerHTML = ""
})

/** A run in its props, so a test can move it along like the tab does. */
function render(initial: { tiles: ContactTile[]; running: boolean; canMove?: boolean }) {
	const calls: Array<[string, ...unknown[]]> = []
	const props = $state({
		...initial,
		statusText: "",
		percent: null as number | null,
		onKeep: (l: string) => calls.push(["keep", l]),
		onRedo: (l: string) => calls.push(["redo", l]),
		onRedoAll: () => calls.push(["redoAll"]),
		onMove: (id: number, to: string) => calls.push(["move", id, to]),
		onStop: () => calls.push(["stop"])
	})
	view = mount(SpriteContactSheet, { target: document.body, props })
	flushSync()
	return { props, calls }
}

const tile = (label: string) =>
	document.querySelector(`[data-testid="contact-tile"][data-label="${label}"]`) as HTMLElement
const button = (root: Element, name: RegExp) =>
	[...root.querySelectorAll("button")].find((b) =>
		name.test((b.getAttribute("aria-label") ?? b.textContent ?? "").trim())
	) as HTMLButtonElement | undefined

describe("the contact sheet", () => {
	test("tiles wait while the run draws, and offer nothing to press", () => {
		render({
			tiles: [
				{ label: "joy", state: "waiting" },
				{ label: "anger", state: "waiting" }
			],
			running: true
		})
		expect(tile("joy").dataset.state).toBe("waiting")
		expect(button(tile("joy"), /again/)).toBeUndefined()
		expect(button(document.body, /^Stop$/)).toBeTruthy()
		expect(document.querySelector('[data-testid="contact-sheet-count"]')?.textContent).toMatch(
			/0 of 2 filed/
		)
	})

	test("as the run ends, filed tiles offer Keep and Redo; an empty one offers Redo", () => {
		const { props, calls } = render({
			tiles: [
				{ label: "joy", state: "waiting" },
				{ label: "anger", state: "waiting" }
			],
			running: true
		})
		props.tiles = [
			{ label: "joy", state: "attached", src: "/media/a?r=0", spriteId: 7 },
			{ label: "anger", state: "missing" }
		]
		props.running = false
		flushSync()

		expect(tile("joy").querySelector("img")?.getAttribute("src")).toBe("/media/a?r=0")
		expect(button(tile("joy"), /Keep the joy/)).toBeTruthy()
		expect(button(tile("anger"), /Keep/)).toBeUndefined()
		button(tile("anger"), /Draw anger again/)!.click()
		button(tile("joy"), /Keep the joy/)!.click()
		button(document.body, /Redo all/)!.click()
		expect(calls).toEqual([["redo", "anger"], ["keep", "joy"], ["redoAll"]])
		expect(document.querySelector('[data-testid="contact-sheet-count"]')?.textContent).toMatch(
			/1 of 2 filed/
		)
	})

	test("dragging a tile onto another label moves that sprite", () => {
		const { calls } = render({
			tiles: [
				{ label: "joy", state: "attached", src: "/media/a?r=0", spriteId: 7 },
				{ label: "love", state: "attached", src: "/media/b?r=0", spriteId: 8 }
			],
			running: false,
			canMove: true
		})
		const img = tile("joy").querySelector("img")!
		expect(img.getAttribute("draggable")).toBe("true")
		img.dispatchEvent(new Event("dragstart", { bubbles: true }))
		flushSync()
		const over = new Event("dragover", { bubbles: true, cancelable: true })
		tile("love").dispatchEvent(over)
		tile("love").dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }))
		flushSync()
		expect(calls).toEqual([["move", 7, "love"]])
	})
})
