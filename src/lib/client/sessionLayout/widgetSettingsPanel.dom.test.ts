/**
 * Every control in a widget's settings modal writes when it is changed — the
 * choice lists too (seen live 2026-09-28).
 *
 * The panel wrote on the DOM `change` event bubbling out of the form. A text
 * box and a checkbox fire one; a choice list (`Select`, a zag combobox) never
 * does — it reports through `onValueChange` — so picking the Messages widget's
 * Composer, Composer position, Message order, Face beside each line or Who is
 * due next changed the box on screen and wrote nothing. The pick only reached
 * the session by riding along with the next text or checkbox edit, and was
 * lost on close.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import WidgetSettingsPanel from "./WidgetSettingsPanel.svelte"
import {
	setWidgetSettingDecls,
	setWidgetSettingValues,
	setWidgetSettingsWriter
} from "$lib/client/stores/widgetSettings.svelte"

describe("the settings panel writes every control", () => {
	let app: ReturnType<typeof mount> | null = null
	let host: HTMLElement
	let writes: Array<Record<string, Record<string, unknown>>> = []

	beforeEach(() => {
		writes = []
		setWidgetSettingDecls({
			messages: {
				id: "messages",
				title: "Messages",
				settings: {
					composer: {
						type: "enum",
						label: "Composer",
						of: ["classic", "minimal", "writer"],
						default: "classic"
					}
				}
			}
		})
		setWidgetSettingValues({})
		setWidgetSettingsWriter((next) => {
			writes.push(next)
			setWidgetSettingValues(next)
		})
		host = document.createElement("div")
		document.body.append(host)
		app = mount(WidgetSettingsPanel, {
			target: host,
			props: { widgetId: "messages" }
		})
		flushSync()
	})

	afterEach(() => {
		if (app) unmount(app)
		app = null
		setWidgetSettingsWriter(null)
		setWidgetSettingDecls({})
		document.body.innerHTML = ""
	})

	async function settle() {
		flushSync()
		await tick()
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
	}

	test("picking a choice writes it", async () => {
		const trigger = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Show Composer options"]'
		)
		expect(trigger).not.toBeNull()
		trigger!.click()
		await settle()
		const option = [
			...document.querySelectorAll<HTMLElement>('[role="option"]')
		].find((o) => o.textContent?.trim() === "Minimal")
		expect(option).toBeTruthy()
		option!.click()
		await settle()
		expect(writes.at(-1)).toEqual({ messages: { composer: "minimal" } })
	})

	test("the Messages widget's Card is a backing mode, and picking one writes it", async () => {
		// note 18: Auto / On / Off in place of the host card's checkbox.
		expect(host.querySelector("#sf-hostCard")).toBeNull()
		const trigger = host.querySelector<HTMLButtonElement>(
			'button[aria-label="Show Card options"]'
		)
		expect(trigger).not.toBeNull()
		trigger!.click()
		await settle()
		const option = [
			...document.querySelectorAll<HTMLElement>('[role="option"]')
		].find((o) => o.textContent?.trim() === "Off")
		expect(option).toBeTruthy()
		option!.click()
		await settle()
		expect(writes.at(-1)).toEqual({ messages: { backingMode: "off" } })
	})

	test("a checkbox still writes on its own change", async () => {
		// Any other widget keeps the host card's checkbox.
		if (app) unmount(app)
		setWidgetSettingDecls({ notes: { id: "notes", title: "Notes" } })
		app = mount(WidgetSettingsPanel, {
			target: host,
			props: { widgetId: "notes" }
		})
		flushSync()
		const card = host.querySelector<HTMLInputElement>("#sf-hostCard")
		expect(card).not.toBeNull()
		card!.click()
		await settle()
		expect(writes.at(-1)).toEqual({ notes: { hostCard: true } })
	})
})
