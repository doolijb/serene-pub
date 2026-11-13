/**
 * 🚧 Advanced controls (2026-11-10): the lens track leaves Graph and Lives
 * out while the switch is off, in the desk track and in the compact popout.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import LensTrack from "./LensTrack.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const OFF = ["list", "cards", "tree", "time", "places"]
const ALL = ["list", "cards", "tree", "graph", "time", "lives", "places"]
const lenses = () =>
	[...document.querySelectorAll<HTMLElement>("[data-lore-lens]")].map(
		(b) => b.dataset.loreLens
	)

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

describe("LensTrack under advanced controls", () => {
	test("desk track: off is five lenses, on is all seven", async () => {
		app = mount(LensTrack, {
			target: document.body,
			props: { value: "list", advancedControls: false, onselect: () => {} }
		})
		await settle()
		expect(lenses()).toEqual(OFF)
	})

	test("desk track: on shows all seven", async () => {
		app = mount(LensTrack, {
			target: document.body,
			props: { value: "list", advancedControls: true, onselect: () => {} }
		})
		await settle()
		expect(lenses()).toEqual(ALL)
	})

	test("desk track flips without a remount", async () => {
		const state = $state({ advanced: false })
		app = mount(LensTrack, {
			target: document.body,
			props: {
				value: "list",
				get advancedControls() {
					return state.advanced
				},
				onselect: () => {}
			}
		})
		await settle()
		expect(lenses()).toEqual(OFF)
		state.advanced = true
		await settle()
		expect(lenses()).toEqual(ALL)
		state.advanced = false
		await settle()
		expect(lenses()).toEqual(OFF)
	})

	test("compact popout rows follow the switch", async () => {
		for (const [advanced, want] of [
			[false, OFF],
			[true, ALL]
		] as const) {
			app = mount(LensTrack, {
				target: document.body,
				props: {
					value: "list",
					advancedControls: advanced,
					compact: true,
					onselect: () => {}
				}
			})
			await settle()
			expect(lenses()).toEqual(want)
			unmount(app)
			app = null
			document.body.innerHTML = ""
		}
	})
})
