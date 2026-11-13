/** The inspector: a chosen tab's header, settings and style; else the layout's look; arm while chosen. */
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import type { PanelLayoutV2, PanelLook } from "@serene-pub/sdk"
import ArrangeInspector from "./ArrangeInspector.svelte"
import * as InspectorModule from "./ArrangeInspector.svelte"
import { setWidgetSettingDecls } from "$lib/client/stores/widgetSettings.svelte"
import { widgetStylesStore } from "$lib/client/stores/widgetStyles.svelte"

const panels: PanelLayoutV2 = {
	version: 2,
	left: [{ key: "p1", tabs: ["stats"] }],
	middle: [
		{ key: "p2", tabs: ["scene"] },
		{ key: "p3", tabs: ["messages#journal", "messages"] }
	],
	right: []
}
const look: PanelLook = { backing: "card", opacity: 100, gap: "comfortable" }
const titles: Record<string, string> = {
	"messages#journal": "Journal",
	messages: "Conversation"
}

type Props = {
	panels: PanelLayoutV2
	chosenId: string | null
	label: (id: string) => string
	kindLabel: (id: string) => string
	look: PanelLook
	onLook: (patch: Partial<PanelLook>) => void
}

/** The `<script module>` export, which the editor shim does not type. */
const ordinal = (
	InspectorModule as unknown as { ordinal: (n: number) => string }
).ordinal

const apps: ReturnType<typeof mount>[] = []
beforeEach(() => {
	setWidgetSettingDecls({
		"messages#journal": {
			id: "messages#journal",
			title: "Journal",
			settings: { compact: { type: "boolean", label: "Compact" } }
		}
	})
})
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	setWidgetSettingDecls({})
	document.body.innerHTML = ""
})

function render(chosenId: string | null) {
	const props = $state<Props>({
		panels,
		chosenId,
		label: (id) => titles[id] ?? id,
		kindLabel: (id) => (id.startsWith("messages") ? "Messages" : id),
		look,
		onLook: () => {}
	})
	apps.push(mount(ArrangeInspector, { target: document.body, props }))
	flushSync()
	return props
}
const text = () => document.body.textContent ?? ""
const title = () => document.querySelector("h2")?.textContent?.trim()

describe("ArrangeInspector", () => {
	test("nothing chosen shows the layout's look", () => {
		render(null)
		expect(title()).toBe("Layout settings")
		expect(document.querySelector('[role="radiogroup"]') === null).toBe(
			false
		)
	})

	test("a chosen tab shows its title, where it sits, and its settings", () => {
		render("messages#journal")
		expect(title()).toBe("Journal")
		expect(text()).toContain("Messages · Middle, 2nd panel")
		expect(document.querySelector(".wsx") === null).toBe(false)
		expect(document.querySelector('[role="radiogroup"]') === null).toBe(
			true
		)
	})

	test("an id that is not placed shows the layout's look", () => {
		render("ghost")
		expect(title()).toBe("Layout settings")
		expect(document.querySelector('[role="radiogroup"]') === null).toBe(
			false
		)
	})

	test("the chosen tab is armed while chosen and disarmed on clear", () => {
		const props = render("messages#journal")
		expect(widgetStylesStore().armed).toBe("messages#journal")
		props.chosenId = null
		flushSync()
		expect(widgetStylesStore().armed === null).toBe(true)
		expect(title()).toBe("Layout settings")
	})

	test("escape answers false when no style editor is open", () => {
		const props = $state<Props>({
			panels,
			chosenId: "messages#journal",
			label: (id) => id,
			kindLabel: (id) => id,
			look,
			onLook: () => {}
		})
		const app = mount(ArrangeInspector, {
			target: document.body,
			props
		}) as unknown as {
			escape: () => boolean
		}
		apps.push(app as ReturnType<typeof mount>)
		flushSync()
		expect(app.escape()).toBe(false)
	})
})

describe("ordinal", () => {
	test("English ordinals", () => {
		expect(
			[1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)
		).toEqual([
			"1st",
			"2nd",
			"3rd",
			"4th",
			"11th",
			"12th",
			"13th",
			"21st",
			"22nd",
			"23rd",
			"101st",
			"111th",
			"112th"
		])
	})
})
