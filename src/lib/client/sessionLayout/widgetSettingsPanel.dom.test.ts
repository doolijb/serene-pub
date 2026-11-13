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
import { setWidgetStylePinWriter } from "$lib/client/stores/widgetStyles.svelte"

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

	test("Reset carries its label, clears settings, and writes no style pin", async () => {
		setWidgetSettingValues({ messages: { composer: "minimal" } })
		await settle()
		const reset = host.querySelector<HTMLButtonElement>('button[aria-label="Reset settings"]')
		expect(reset).not.toBeNull()
		expect(reset!.textContent?.trim()).toBe("Reset")
		const pinWrites: unknown[] = []
		setWidgetStylePinWriter((next) => void pinWrites.push(next))
		reset!.click()
		await settle()
		setWidgetStylePinWriter(null)
		expect(writes.length).toBeGreaterThan(0)
		expect(writes.at(-1)!.messages ?? {}).toEqual({})
		expect(pinWrites).toEqual([])
	})

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

	test("the panel draws no per-widget Card or backing control (the layout's look owns it)", () => {
		expect(host.querySelector("#sf-hostCard") === null).toBe(true)
		expect(host.querySelector("#sf-backingMode") === null).toBe(true)
		expect(
			host.querySelector('button[aria-label="Show Card options"]') === null
		).toBe(true)
	})

	test("a checkbox still writes on its own change", async () => {
		if (app) unmount(app)
		setWidgetSettingDecls({
			notes: {
				id: "notes",
				title: "Notes",
				settings: { compact: { type: "boolean", label: "Compact" } }
			}
		})
		app = mount(WidgetSettingsPanel, {
			target: host,
			props: { widgetId: "notes" }
		})
		flushSync()
		const box = host.querySelector<HTMLInputElement>("#sf-compact")
		expect(box === null).toBe(false)
		box!.click()
		await settle()
		expect(writes.at(-1)).toEqual({ notes: { compact: true } })
	})
})

describe("the settings panel's sections", () => {
	let app: ReturnType<typeof mount> | null = null
	let host: HTMLElement
	let writes: Array<Record<string, Record<string, unknown>>> = []

	function open(widgetId: string) {
		host = document.createElement("div")
		document.body.append(host)
		app = mount(WidgetSettingsPanel, { target: host, props: { widgetId } })
		flushSync()
	}

	beforeEach(() => {
		writes = []
		setWidgetSettingDecls({
			log: {
				id: "log",
				title: "Log",
				settings: {
					channel: { type: "string", label: "Channel name", group: "Channel" },
					compact: { type: "boolean", label: "Compact" },
					showAvatars: { type: "boolean", label: "Faces", group: "Reading" },
					nextUp: { type: "boolean", label: "Who is due next", group: "Turns" },
					showTimestamps: { type: "boolean", label: "Times", group: "Reading" }
				}
			},
			notes: { id: "notes", title: "Notes" }
		})
		setWidgetSettingValues({})
		setWidgetSettingsWriter((next) => {
			writes.push(next)
			setWidgetSettingValues(next)
		})
	})

	afterEach(() => {
		if (app) unmount(app)
		app = null
		setWidgetSettingsWriter(null)
		setWidgetSettingDecls({})
		document.body.innerHTML = ""
	})

	const sectionsOf = () =>
		[...host.querySelectorAll<HTMLElement>("[data-settings-group]")].map((s) => ({
			heading: s.querySelector("h3")?.textContent?.trim(),
			labelled: document.getElementById(s.getAttribute("aria-labelledby") ?? "") ===
				s.querySelector("h3"),
			fields: [...s.querySelectorAll("input")].map((i) => i.id)
		}))

	test("one headed section per group, in declaration order, the group string verbatim; nothing folds", () => {
		open("log")
		expect(sectionsOf()).toEqual([
			{ heading: "Channel", labelled: true, fields: ["sf-channel"] },
			{ heading: "Reading", labelled: true, fields: ["sf-showAvatars", "sf-showTimestamps"] },
			{ heading: "Turns", labelled: true, fields: ["sf-nextUp"] }
		])
		expect(host.querySelector("details, summary")).toBeNull()
		// The heading is drawn once — the form under it does not repeat it.
		expect(
			[...host.querySelectorAll("p, h3")].filter((e) => e.textContent?.trim() === "Reading")
		).toHaveLength(1)
	})

	test("ungrouped fields come before every section, under no heading", () => {
		open("log")
		const compact = host.querySelector("#sf-compact")
		expect(compact).not.toBeNull()
		expect(compact!.closest("[data-settings-group]")).toBeNull()
		const first = host.querySelector("[data-settings-group]")!
		expect(
			compact!.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy()
	})

	test("a grouped field writes on its change like any other", async () => {
		open("log")
		host.querySelector<HTMLInputElement>("#sf-showAvatars")!.click()
		flushSync()
		await tick()
		expect(writes.at(-1)).toEqual({ log: { showAvatars: true } })
	})

	test("a widget with no groups draws no section and no fold", () => {
		open("notes")
		expect(host.querySelector("[data-settings-group]")).toBeNull()
		expect(host.querySelector("details")).toBeNull()
		expect(host.querySelector("#sf-hostCard") === null).toBe(true)
	})
})

describe("the Messages widget's Channel and Channel lane name their default", () => {
	let app: ReturnType<typeof mount> | null = null
	let host: HTMLElement
	let writes: Array<Record<string, Record<string, unknown>>> = []

	function open(
		stored: Record<string, Record<string, unknown>> = {},
		widgetId = "messages"
	) {
		setWidgetSettingValues(stored)
		host = document.createElement("div")
		document.body.append(host)
		app = mount(WidgetSettingsPanel, { target: host, props: { widgetId } })
		flushSync()
	}

	beforeEach(() => {
		writes = []
		setWidgetSettingDecls({
			messages: {
				id: "messages",
				title: "Messages",
				settings: {
					channel: {
						type: "string",
						label: "Channel",
						description: "Help.",
						group: "Channel",
						unset: { label: "Default (main)", other: "Another channel" }
					},
					channelLane: {
						type: "string",
						default: "",
						label: "Channel lane",
						group: "Channel",
						unset: { label: "Default (whole channel)", other: "Another lane" }
					},
					interleave: {
						type: "string",
						default: "",
						label: "Show another channel inline",
						group: "Channel",
						unset: { label: "Default (none)", other: "A channel" }
					}
				}
			},
			album: {
				id: "album",
				title: "Album",
				settings: {
					channel: {
						type: "string",
						label: "Channel",
						description: "Which channel.",
						unset: { label: "Default (every channel)", other: "One channel" }
					}
				}
			}
		})
		setWidgetSettingsWriter((next) => {
			writes.push(next)
			setWidgetSettingValues(next)
		})
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

	const input = (label: string) => host.querySelector(`input[aria-label="${label}"]`)

	test("with nothing stored, Channel reads Default (main) and Channel lane Default (whole channel), with no box", () => {
		open()
		const texts = [...host.querySelectorAll<HTMLInputElement>('input[role="combobox"]')]
			.map((i) => i.value)
			.filter((v) => /^(Default|Another)/.test(v))
		expect(texts).toEqual([
			"Default (main)",
			"Default (whole channel)",
			"Default (none)"
		])
		expect(input("Another channel")).toBeNull()
		expect(input("Another lane")).toBeNull()
		expect(input("A channel")).toBeNull()
		expect(host.querySelector("#sf-interleave")).toBeNull()
		expect(host.querySelector("#sf-channel")).toBeNull()
	})

	test("a stored slug shows Another channel with the slug in the box", () => {
		open({ messages: { channel: "sanctum" } })
		const combos = [...host.querySelectorAll<HTMLInputElement>('input[role="combobox"]')].map(
			(i) => i.value
		)
		expect(combos).toContain("Another channel")
		expect((input("Another channel") as HTMLInputElement).value).toBe("sanctum")
	})

	test("picking the default stores blank, so nothing is stored", async () => {
		open({ messages: { channel: "sanctum" } })
		host.querySelector<HTMLButtonElement>('button[aria-label="Show Channel options"]')!.click()
		await settle()
		const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
			(o) => o.textContent?.trim() === "Default (main)"
		)
		expect(option).toBeTruthy()
		option!.click()
		await settle()
		expect(writes.at(-1)).toEqual({})
	})

	test("committing a slug writes it", async () => {
		open()
		host.querySelector<HTMLButtonElement>('button[aria-label="Show Channel options"]')!.click()
		await settle()
		;[...document.querySelectorAll<HTMLElement>('[role="option"]')]
			.find((o) => o.textContent?.trim() === "Another channel")!
			.click()
		await settle()
		expect(writes).toHaveLength(0)
		const box = input("Another channel") as HTMLInputElement
		expect(box).not.toBeNull()
		box.value = "sanctum"
		box.dispatchEvent(new Event("change", { bubbles: true }))
		await settle()
		expect(writes.at(-1)).toEqual({ messages: { channel: "sanctum" } })
	})

	test("the box carries no placeholder; the description is drawn once, under the field", () => {
		open({ messages: { channel: "sanctum" } })
		expect((input("Another channel") as HTMLInputElement).placeholder).toBe("")
	})

	test("Show another channel inline reads Default (none) with no box, and a stored slug shows in the box", () => {
		open()
		expect(input("A channel")).toBeNull()
		unmount(app!)
		host.remove()
		open({ messages: { interleave: "table" } })
		const combos = [...host.querySelectorAll<HTMLInputElement>('input[role="combobox"]')].map(
			(i) => i.value
		)
		expect(combos).toContain("A channel")
		expect((input("A channel") as HTMLInputElement).value).toBe("table")
	})

	test("an Album's Channel draws its own named default, and picking it stores blank", async () => {
		open({ album: { channel: "sanctum" } }, "album")
		expect((input("One channel") as HTMLInputElement).value).toBe("sanctum")
		host.querySelector<HTMLButtonElement>('button[aria-label="Show Channel options"]')!.click()
		await settle()
		;[...document.querySelectorAll<HTMLElement>('[role="option"]')]
			.find((o) => o.textContent?.trim() === "Default (every channel)")!
			.click()
		await settle()
		expect(writes.at(-1)).toEqual({})
		expect(input("One channel")).toBeNull()
	})
})
