/**
 * The Style section's own Reset (owner 2026-11-04, item 15): shown only while
 * the widget instance holds a style pin, it clears that pin through the pin
 * writer and never writes settings.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import WidgetStyleSection from "./WidgetStyleSection.svelte"
import {
	setWidgetStylePinWriter,
	setWidgetStylePins
} from "$lib/client/stores/widgetStyles.svelte"
import { setWidgetSettingsWriter } from "$lib/client/stores/widgetSettings.svelte"

describe("the Style section's Reset", () => {
	let app: ReturnType<typeof mount> | null = null
	let host: HTMLElement
	let pinWrites: Array<Record<string, unknown>> = []
	let settingsWrites: unknown[] = []

	beforeEach(() => {
		pinWrites = []
		settingsWrites = []
		setWidgetStylePins({})
		setWidgetStylePinWriter((next) => void pinWrites.push(next))
		setWidgetSettingsWriter((next) => void settingsWrites.push(next))
		host = document.createElement("div")
		document.body.append(host)
	})

	afterEach(() => {
		if (app) unmount(app)
		app = null
		setWidgetStylePinWriter(null)
		setWidgetSettingsWriter(null)
		setWidgetStylePins({})
		document.body.innerHTML = ""
	})

	async function open() {
		app = mount(WidgetStyleSection, {
			target: host,
			props: { widgetId: "messages", label: "Conversation" }
		})
		flushSync()
		await tick()
	}
	const reset = () =>
		host.querySelector<HTMLButtonElement>(
			'button[aria-label="Reset style"]'
		)

	test("without a pin there is nothing to reset", async () => {
		await open()
		expect(reset()).toBeNull()
	})

	test("with a pin it shows, clears the pin, and writes no settings", async () => {
		setWidgetStylePins({ messages: { id: 4, slug: "bubbles" } })
		await open()
		expect(reset()).not.toBeNull()
		expect(reset()!.textContent?.trim()).toBe("Reset")
		reset()!.click()
		flushSync()
		expect(pinWrites).toEqual([{}])
		expect(settingsWrites).toEqual([])
	})

	test("another instance's pin does not show it", async () => {
		setWidgetStylePins({ "messages#2": { id: 4, slug: "bubbles" } })
		await open()
		expect(reset()).toBeNull()
	})
})
