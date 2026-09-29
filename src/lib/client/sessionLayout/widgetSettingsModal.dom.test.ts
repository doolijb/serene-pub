/**
 * A widget's settings open in ONE app-level modal (owner ruling 2026-09-27),
 * not in a card inside the widget's box: the gear the widget wears on the
 * editor's Settings tab opens a labelled dialog portalled to the body, Escape
 * closes it, and focus goes back to the gear.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import WidgetStyleOverlay from "./WidgetStyleOverlay.svelte"
import WidgetSettingsModal from "./WidgetSettingsModal.svelte"
import {
	closeWidgetSettings,
	openWidgetSettings,
	widgetSettingsModal,
	widgetSettingsTitle
} from "./widgetSettingsModal.svelte"
import { setWidgetStyleMode } from "$lib/client/stores/widgetStyles.svelte"

describe("widgetSettingsModal store", () => {
	afterEach(() => {
		closeWidgetSettings()
		document.body.innerHTML = ""
	})

	test("titles the modal with the widget's name", () => {
		expect(widgetSettingsTitle("Conversation")).toBe(
			"Conversation settings"
		)
		expect(widgetSettingsTitle("  ")).toBe("Widget settings")
	})

	test("one modal: opening another widget replaces the first", () => {
		const modal = widgetSettingsModal()
		openWidgetSettings({ widgetId: "a", label: "A" })
		openWidgetSettings({ widgetId: "b", label: "B" })
		expect(modal.current?.widgetId).toBe("b")
		expect(modal.isOpenFor("a")).toBe(false)
		expect(modal.current?.mount).toBe("remote")
	})

	test("close hands back the control that opened it, if still on the page", () => {
		const gear = document.createElement("button")
		document.body.append(gear)
		openWidgetSettings({ widgetId: "a", label: "A" }, gear)
		expect(closeWidgetSettings()).toBe(gear)
		expect(widgetSettingsModal().current).toBeNull()

		openWidgetSettings({ widgetId: "a", label: "A" }, gear)
		gear.remove()
		expect(closeWidgetSettings()).toBeNull()
	})
})

describe("the gear opens the modal", () => {
	let apps: ReturnType<typeof mount>[] = []
	let box: HTMLElement

	beforeEach(() => {
		setWidgetStyleMode(true)
		box = document.createElement("section")
		box.className = "widget-box"
		document.body.append(box)
		apps.push(
			mount(WidgetStyleOverlay, {
				target: box,
				props: { widgetId: "messages", label: "Conversation" }
			})
		)
		const modalHost = document.createElement("div")
		document.body.append(modalHost)
		apps.push(mount(WidgetSettingsModal, { target: modalHost }))
		flushSync()
	})

	afterEach(() => {
		for (const app of apps) unmount(app)
		apps = []
		setWidgetStyleMode(false)
		closeWidgetSettings()
		document.body.innerHTML = ""
	})

	async function settle() {
		flushSync()
		await tick()
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
	}

	function gear(): HTMLButtonElement {
		const el = box.querySelector<HTMLButtonElement>(
			'button[aria-haspopup="dialog"]'
		)
		if (!el) throw new Error("no gear in the widget box")
		return el
	}

	function dialog(): HTMLElement | null {
		return document.querySelector<HTMLElement>('[role="dialog"]')
	}

	test("the widget box holds only the gear, never the settings form", () => {
		expect(gear().getAttribute("aria-label")).toBe(
			"Open Conversation settings"
		)
		expect(box.querySelector("select, input, textarea")).toBeNull()
		expect(box.textContent).not.toContain("Style")
	})

	test("pressing the gear opens a labelled dialog outside the widget box", async () => {
		gear().focus()
		gear().click()
		await settle()
		const d = dialog()
		expect(d).not.toBeNull()
		expect(box.contains(d)).toBe(false)
		const labelId = d!.getAttribute("aria-labelledby")
		expect(labelId).toBeTruthy()
		expect(document.getElementById(labelId!)?.textContent?.trim()).toBe(
			"Conversation settings"
		)
		// The style section lives in the modal now.
		expect(d!.textContent).toContain("Style")
	})

	test("Escape closes it and focus returns to the gear", async () => {
		const g = gear()
		g.focus()
		g.click()
		await settle()
		expect(widgetSettingsModal().isOpenFor("messages")).toBe(true)
		const d = dialog()!
		d.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true
			})
		)
		await settle()
		expect(widgetSettingsModal().current).toBeNull()
		expect(document.activeElement).toBe(g)
	})

	test("the Close button closes it and returns focus to the gear", async () => {
		const g = gear()
		g.focus()
		g.click()
		await settle()
		const close = [...dialog()!.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Close"
		)
		expect(close).toBeTruthy()
		close!.click()
		await settle()
		expect(widgetSettingsModal().current).toBeNull()
		expect(document.activeElement).toBe(g)
	})

	test("Escape backs out of the style editor before it closes the modal", async () => {
		const g = gear()
		g.focus()
		g.click()
		await settle()
		const newBtn = [...dialog()!.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "New"
		)
		newBtn!.click()
		await settle()
		expect(dialog()!.querySelector("textarea")).not.toBeNull()
		dialog()!.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true
			})
		)
		await settle()
		expect(widgetSettingsModal().isOpenFor("messages")).toBe(true)
		expect(dialog()!.querySelector("textarea")).toBeNull()
		dialog()!.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Escape",
				bubbles: true,
				cancelable: true
			})
		)
		await settle()
		expect(widgetSettingsModal().current).toBeNull()
	})
})
