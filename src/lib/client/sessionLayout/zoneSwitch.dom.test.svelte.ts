/** The zone switch: hidden when off, one button per available zone, pressed follows shown, roving arrows select. */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import ZoneSwitch from "./ZoneSwitch.svelte"
import { SessionZones } from "./sessionZones.svelte"

const apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

function render(
	on = true,
	available: ("left" | "middle" | "right")[] = ["left", "middle", "right"]
) {
	const zones = new SessionZones()
	zones.publish({ switchOn: on, available, opening: "middle" })
	apps.push(mount(ZoneSwitch, { target: document.body, props: { zones } }))
	flushSync()
	return zones
}
const buttons = () => [
	...document.querySelectorAll<HTMLButtonElement>("[role=group] button")
]
const labels = () => buttons().map((b) => b.textContent?.trim())

describe("ZoneSwitch", () => {
	test("hidden when off", () => {
		render(false)
		expect(document.querySelector("[role=group]") === null).toBe(true)
	})

	test("only available zones are drawn, in order", () => {
		render(true, ["left", "right"])
		expect(labels()).toEqual(["Left", "Right"])
	})

	test("the group has an accessible name", () => {
		render()
		expect(
			document.querySelector("[role=group]")!.getAttribute("aria-label")
		).toBe("Zone shown")
	})

	test("one available zone: the switch is off", () => {
		render(true, ["middle"])
		expect(document.querySelector("[role=group]") === null).toBe(true)
	})

	test("aria-pressed follows shown", () => {
		render()
		expect(buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual([
			"false",
			"true",
			"false"
		])
	})

	test("click shows", () => {
		const zones = render()
		buttons()[2].click()
		flushSync()
		expect(zones.shown).toBe("right")
		expect(buttons().map((b) => b.getAttribute("aria-pressed"))).toEqual([
			"false",
			"false",
			"true"
		])
	})

	test("ArrowRight wraps, moves focus and selects", () => {
		const zones = render()
		buttons()[1].focus()
		buttons()[1].dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
		)
		flushSync()
		expect(zones.shown).toBe("right")
		expect(document.activeElement === buttons()[2]).toBe(true)
		buttons()[2].dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
		)
		flushSync()
		expect(zones.shown).toBe("left")
		expect(document.activeElement === buttons()[0]).toBe(true)
	})

	test("one tab stop: the pressed button", () => {
		render()
		expect(buttons().map((b) => b.getAttribute("tabindex"))).toEqual([
			"-1",
			"0",
			"-1"
		])
	})
})
