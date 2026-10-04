/**
 * The layout editor's Start from pane on both editors (brief 4 of
 * `PLAN-layout-one-format-2026-09-28`).
 *
 * Every verb that REPLACES this session's layout — a card, Reset to genre
 * default layout (the phone bar's icon-only chip too), Start again from "X"
 * and Start from scratch — asks first, in a Skeleton dialog that says what
 * it replaces, and copies only on yes. The cards are grouped by who brought
 * them; the pane heads with where the layout started from and, when that
 * source moved since the copy, the **Updated** offer. Save as new layout is
 * its own button with a name and an optional description.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { createRawSnippet, flushSync, mount, tick, unmount } from "svelte"
import * as Icons from "@lucide/svelte"
import LayoutEditorToolbar from "./LayoutEditorToolbar.svelte"
import MobileLayoutEditor from "./MobileLayoutEditor.svelte"

type Preset = Sockets.Sessions.LayoutPreset

function preset(over: Partial<Preset> & { id: number; name: string }): Preset {
	return {
		genreId: "core:genre/adventure",
		origin: "core",
		slug: over.name.toLowerCase().replace(/\W+/g, "-"),
		description: null,
		pluginId: null,
		pluginName: null,
		isGenreDefault: false,
		visibility: "shared",
		mine: false,
		authorName: null,
		isNewSessionLayout: false,
		layout: {},
		layoutUpdatedAt: "2026-09-29T00:00:00.000Z",
		...over
	}
}

const DEFAULT = preset({ id: 1, name: "Adventure", slug: "default", isGenreDefault: true })
const CINEMATIC = preset({ id: 2, name: "Cinematic" })
const BOARD = preset({
	id: 3,
	name: "Wide board",
	origin: "plugin",
	pluginId: "showcase.battleship",
	pluginName: "Battleship",
	description: "The board across the middle."
})
const MINE = preset({
	id: 4,
	name: "Lighthouse table",
	origin: "user",
	visibility: "private",
	mine: true,
	authorName: "Wren"
})
const SHARED = preset({ id: 5, name: "Harbour", origin: "user", authorName: "Ash" })
const PRESETS = [DEFAULT, CINEMATIC, BOARD, MINE, SHARED]

const picture = createRawSnippet(() => ({ render: () => `<span class="pv"></span>` }))

const apps: ReturnType<typeof mount>[] = []
afterEach(() => {
	for (const app of apps.splice(0)) unmount(app)
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

const text = (el: Element | null | undefined) =>
	el?.textContent?.replace(/\s+/g, " ").trim() ?? ""
const buttons = () => [...document.querySelectorAll("button")]
const buttonNamed = (name: string) =>
	buttons().find((b) => text(b) === name || b.getAttribute("aria-label") === name)
/** The open dialog, if any: a closed one stays mounted, hidden, as `closed`. */
const dialog = () =>
	document.querySelector(
		'[role=alertdialog][data-state="open"], [data-save-as][data-state="open"]'
	)
const confirmButton = () =>
	document.querySelector<HTMLButtonElement>("[data-layout-confirm] [data-confirm-yes]")
const cancelButton = () =>
	document.querySelector<HTMLButtonElement>("[data-layout-confirm] [data-confirm-no]")

async function click(el: Element | null | undefined) {
	expect(el, "the control is on screen").toBeTruthy()
	;(el as HTMLElement).click()
	await settle()
}

/** A card's `⋯` menu trigger (brief 6b). */
const menuTrigger = (name: string) => buttonNamed(`Actions for “${name}”`)
/** The items of the one open menu. */
const openItems = () =>
	[...document.querySelectorAll<HTMLElement>("[role=menuitem]")].filter(
		(i) => i.closest("[role=menu]")?.getAttribute("data-state") === "open"
	)
async function menuOf(name: string): Promise<string[]> {
	await click(menuTrigger(name))
	const items = openItems().map((i) => text(i))
	document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
	await settle()
	return items
}
/**
 * Choose a menu item as a pointer does: press, then click. The menu acts on
 * the item the press highlighted (a real click always brings its press).
 */
async function choose(name: string, item: string) {
	await click(menuTrigger(name))
	const el = openItems().find((i) => text(i) === item)
	expect(el, `the menu offers "${item}"`).toBeTruthy()
	el!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
	await click(el)
}

function toolbar(over: Record<string, unknown> = {}) {
	const calls = {
		startFrom: vi.fn(),
		resetLayout: vi.fn(),
		savePreset: vi.fn((..._a: unknown[]) => true),
		saveChanges: vi.fn((..._a: unknown[]) => true),
		onDeletePreset: vi.fn(),
		onPresetUsage: vi.fn(),
		onRenamePreset: vi.fn(),
		onShareLayout: vi.fn(),
		onCloneLayout: vi.fn(),
		onSetNewSessionLayout: vi.fn()
	}
	const props = $state<Record<string, unknown>>({
		editTab: "presets",
		genreName: "Adventure",
		isGuest: false,
		isAdmin: false,
		insetStart: 0,
		height: 0,
		presets: PRESETS,
		startedFrom: null,
		startedFromUpdated: false,
		startAgainFrom: null,
		mainWidgetTitle: "Messages",
		presetUsage: null,
		presetPicture: picture,
		styleableWidgets: [],
		trayWidgets: [],
		trayIcon: () => Icons.Box,
		armedId: null,
		dragOverZone: null,
		onTrayDragStart: () => {},
		draggedId: () => null,
		removeWidget: () => {},
		simTier: null,
		setSimTier: () => {},
		railPreview: false,
		simGrid: false,
		simNarrow: false,
		onCancel: () => {},
		onDone: () => {},
		...calls,
		...over
	})
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(mount(LayoutEditorToolbar, { target: host, props: props as any }))
	return { props, calls }
}

const frame = { cols: 1, rows: 1, items: [] }
function phone(over: Record<string, unknown> = {}) {
	const calls = {
		startFrom: vi.fn(),
		resetLayout: vi.fn(),
		savePreset: vi.fn((..._a: unknown[]) => true),
		saveChanges: vi.fn((..._a: unknown[]) => true),
		onDeletePreset: vi.fn(),
		onPresetUsage: vi.fn(),
		onRenamePreset: vi.fn(),
		onShareLayout: vi.fn(),
		onCloneLayout: vi.fn(),
		onSetNewSessionLayout: vi.fn()
	}
	const props = $state<Record<string, unknown>>({
		genreName: "Adventure",
		isGuest: false,
		isAdmin: false,
		presetUsage: null,
		editArranged: {},
		leftPreview: { frame, units: [] },
		rightPreview: { frame, units: [] },
		middlePreview: { frame, units: [] },
		simTier: null,
		simWidth: null,
		simSnapshot: null,
		leftZoneId: "left",
		rightZoneId: "right",
		groupOpen: {},
		groupKey: (side: string, key: string) => `${side}:${key}`,
		inst: () => undefined,
		iconOf: () => Icons.Box,
		middleWidgetIcon: () => Icons.Box,
		widgetLabel: (id: string) => id,
		trayWidgets: [],
		trayIcon: () => Icons.Box,
		addWidget: () => null,
		duplicateWidget: () => null,
		removeWidget: () => {},
		floorNoteOf: () => null,
		presets: PRESETS,
		startedFrom: null,
		startedFromUpdated: false,
		startAgainFrom: null,
		mainWidgetTitle: "Messages",
		onCancel: () => {},
		onDone: () => {},
		presetPicture: picture,
		...calls,
		...over
	})
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(mount(MobileLayoutEditor, { target: host, props: props as any }))
	return { props, calls }
}

describe("desktop: the Start from pane", () => {
	test("groups the cards: genre default layout, Serene Pub's, each plugin's, yours, shared with you", async () => {
		toolbar()
		await settle()
		const groups = [...document.querySelectorAll("[data-preset-group]")]
		expect(
			groups.map((g) => [
				text(g.querySelector("[data-preset-group-label]")),
				[...g.querySelectorAll("[data-preset-card]")].map((c) =>
					Number(c.getAttribute("data-preset-card"))
				)
			])
		).toEqual([
			["Genre default layout", [1]],
			["From Serene Pub", [2]],
			["From Battleship", [3]],
			["Your layouts", [4]],
			["Shared with you", [5]]
		])
		// A layout shared by someone else says whose it is.
		expect(text(document.querySelector('[data-preset-card="5"]'))).toContain("by Ash")
		expect(text(document.querySelector('[data-preset-card="4"]'))).not.toContain("by")
	})

	test("heads with where this session's layout started from", async () => {
		const { props } = toolbar({ startedFrom: BOARD, startAgainFrom: BOARD })
		await settle()
		const line = () => text(document.querySelector("[data-layout-provenance]"))
		expect(line()).toBe("Started from “Wide board” (from Battleship)")
		// The card it started from is marked, as the current one.
		expect(
			document.querySelector('[data-preset-card="3"]')?.getAttribute("aria-current")
		).toBe("true")
		props.startedFrom = MINE
		await settle()
		expect(line()).toBe("Started from your layout “Lighthouse table”")
		props.startedFrom = null
		await settle()
		expect(line()).toBe("Your own layout")
	})

	test("an Updated source: the chip on its card, the sentence, and Start again from it", async () => {
		const { calls } = toolbar({
			startedFrom: BOARD,
			startAgainFrom: BOARD,
			startedFromUpdated: true
		})
		await settle()
		expect(text(document.querySelector('[data-preset-card="3"]'))).toContain("Updated")
		expect(text(document.querySelector('[data-preset-card="4"]'))).not.toContain("Updated")
		const notice = document.querySelector("[data-layout-updated]")
		expect(text(notice)).toContain(
			"Battleship has updated “Wide board” since this session copied it."
		)
		await click(notice?.querySelector("button"))
		expect(calls.startFrom).not.toHaveBeenCalled()
		expect(text(dialog())).toContain("Start again from “Wide board”?")
		await click(confirmButton())
		expect(calls.startFrom).toHaveBeenCalledWith(3)
	})

	test("Start from scratch asks first, says every widget goes back to its defaults, and copies only on yes", async () => {
		const { calls } = toolbar()
		await settle()
		await click(document.querySelector('[data-copy-verb="scratch"]'))
		expect(calls.startFrom).not.toHaveBeenCalled()
		expect(text(dialog())).toContain("Start from scratch?")
		expect(text(dialog())).toContain(
			"Every widget's settings and style go back to their defaults."
		)
		await click(cancelButton())
		expect(calls.startFrom).not.toHaveBeenCalled()
		expect(dialog()).toBeNull()

		await click(document.querySelector('[data-copy-verb="scratch"]'))
		await click(confirmButton())
		expect(calls.startFrom).toHaveBeenCalledWith(null)
	})

	test("Reset to genre default layout and a card both ask before replacing the layout", async () => {
		const { calls } = toolbar()
		await settle()
		await click(document.querySelector('[data-copy-verb="reset"]'))
		expect(calls.resetLayout).not.toHaveBeenCalled()
		expect(text(dialog())).toContain("Reset to the genre default layout?")
		await click(confirmButton())
		expect(calls.resetLayout).toHaveBeenCalledTimes(1)

		await click(document.querySelector('[data-preset-card="4"]'))
		expect(calls.startFrom).not.toHaveBeenCalled()
		expect(text(dialog())).toContain("Start from “Lighthouse table”?")
		expect(text(dialog())).toContain(
			"This replaces this session's layout with a copy of “Lighthouse table”."
		)
		await click(confirmButton())
		expect(calls.startFrom).toHaveBeenCalledWith(4)
	})

	test("Save as new layout is its own button, with a name and an optional description", async () => {
		const { calls } = toolbar()
		await settle()
		// No name box in the pane until asked for.
		expect(document.querySelector(".editor-panel input")).toBeNull()
		await click(buttonNamed("Save as new layout"))
		const name = document.querySelector<HTMLInputElement>("[data-save-as-name]")!
		const description = document.querySelector<HTMLTextAreaElement>(
			"[data-save-as-description]"
		)!
		expect(name).toBeTruthy()
		expect(description).toBeTruthy()
		name.value = "Harbour watch"
		name.dispatchEvent(new Event("input", { bubbles: true }))
		description.value = "Stats left, lore right."
		description.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		await click(document.querySelector("[data-save-as-save]"))
		expect(calls.savePreset).toHaveBeenCalledWith("Harbour watch", "Stats left, lore right.")
	})

	test("deleting your layout asks in a dialog, with what it touches", async () => {
		const { props, calls } = toolbar()
		await settle()
		await choose("Lighthouse table", "Delete")
		expect(calls.onPresetUsage).toHaveBeenCalledWith(4)
		expect(text(dialog())).toContain("Delete “Lighthouse table”?")
		expect(text(dialog())).toContain("Checking where it is used…")
		expect(confirmButton()!.disabled).toBe(true)
		props.presetUsage = { id: 4, sessions: 2, newSessionLayoutUsers: 2 }
		await settle()
		expect(text(dialog())).toContain("Sessions that started from it keep their layout.")
		expect(text(dialog())).toContain(
			"2 people use it for new sessions; they'll get the genre default layout instead."
		)
		await click(confirmButton())
		expect(calls.onDeletePreset).toHaveBeenCalledWith(4)
	})

	test("a usage answer that failed does not hold the delete: it says it could not check, and may go ahead", async () => {
		const { props, calls } = toolbar()
		await settle()
		await choose("Lighthouse table", "Delete")
		props.presetUsage = { id: 4, sessions: 0, newSessionLayoutUsers: 0, unknown: true }
		await settle()
		expect(text(dialog())).not.toContain("Checking where it is used…")
		expect(text(dialog())).toContain("Sessions that started from it keep their layout.")
		expect(text(dialog())).toContain(
			"Couldn't check whether anyone uses it for new sessions; anyone who does gets the genre default layout instead."
		)
		expect(confirmButton()!.disabled).toBe(false)
		await click(confirmButton())
		expect(calls.onDeletePreset).toHaveBeenCalledWith(4)
	})

	test("Start from scratch clears every widget's settings and style, so its confirm is drawn in error; a copy's is the primary", async () => {
		toolbar()
		await settle()
		await click(document.querySelector('[data-copy-verb="scratch"]'))
		expect(confirmButton()!.className).toContain("preset-filled-error-500")
		await click(cancelButton())
		await click(document.querySelector('[data-preset-card="2"]'))
		expect(confirmButton()!.className).toContain("preset-filled-primary-500")
	})
})

describe("phone: the bar and the layouts sheet", () => {
	test("the icon-only Reset chip asks first", async () => {
		const { calls } = phone()
		await settle()
		await click(buttonNamed("Reset to genre default layout"))
		expect(calls.resetLayout).not.toHaveBeenCalled()
		expect(text(dialog())).toContain("Reset to the genre default layout?")
		await click(cancelButton())
		expect(calls.resetLayout).not.toHaveBeenCalled()
		await click(buttonNamed("Reset to genre default layout"))
		await click(confirmButton())
		expect(calls.resetLayout).toHaveBeenCalledTimes(1)
	})

	test("the sheet heads with the status line and groups the layouts; a card asks, then copies", async () => {
		const { calls } = phone({ startedFrom: MINE, startAgainFrom: MINE })
		await settle()
		await click(buttonNamed("Layouts"))
		expect(text(document.querySelector("[data-layout-provenance]"))).toBe(
			"Started from your layout “Lighthouse table”"
		)
		expect(
			[...document.querySelectorAll("[data-preset-group-label]")].map((g) => text(g))
		).toEqual([
			"Genre default layout",
			"From Serene Pub",
			"From Battleship",
			"Your layouts",
			"Shared with you"
		])
		// A layout's description rides its row down here.
		expect(text(document.querySelector('[data-preset-card="3"]'))).toContain(
			"The board across the middle."
		)
		await click(document.querySelector('[data-preset-card="2"]'))
		expect(calls.startFrom).not.toHaveBeenCalled()
		await click(confirmButton())
		expect(calls.startFrom).toHaveBeenCalledWith(2)
		// The sheet closes once the copy is asked for.
		expect(document.querySelector('[data-preset-card="2"]')).toBeNull()
	})

	test("a copy confirmed from the sheet hands focus back to the bar's Layouts button, not the page", async () => {
		phone()
		await settle()
		const layouts = buttonNamed("Layouts")!
		layouts.focus()
		await click(layouts)
		const card = document.querySelector<HTMLElement>('[data-preset-card="2"]')!
		card.focus()
		await click(card)
		confirmButton()!.focus()
		await click(confirmButton())
		await new Promise((r) => setTimeout(r, 50))
		await settle()
		expect(document.activeElement).toBe(buttonNamed("Layouts"))
	})

	test("Escape answers the question, not the sheet under it", async () => {
		const { calls } = phone()
		await settle()
		await click(buttonNamed("Layouts"))
		await click(document.querySelector('[data-preset-card="2"]'))
		expect(dialog()).not.toBeNull()
		cancelButton()!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
		)
		await settle()
		expect(dialog()).toBeNull()
		expect(calls.startFrom).not.toHaveBeenCalled()
		// The sheet it was asked from is still open.
		expect(document.querySelector('[data-preset-card="2"]')).not.toBeNull()
	})

	test("Start again and Start from scratch in the sheet ask first", async () => {
		const { calls } = phone({ startedFrom: MINE, startAgainFrom: MINE })
		await settle()
		await click(buttonNamed("Layouts"))
		await click(document.querySelector('[data-copy-verb="again"]'))
		expect(text(dialog())).toContain("Start again from “Lighthouse table”?")
		await click(confirmButton())
		expect(calls.startFrom).toHaveBeenCalledWith(4)

		await click(buttonNamed("Layouts"))
		await click(document.querySelector('[data-copy-verb="scratch"]'))
		expect(calls.startFrom).toHaveBeenCalledTimes(1)
		await click(confirmButton())
		expect(calls.startFrom).toHaveBeenLastCalledWith(null)
	})

	test("an Updated source marks the Layouts button", async () => {
		const { props } = phone({ startedFrom: BOARD, startAgainFrom: BOARD })
		await settle()
		expect(buttonNamed("Layouts")?.querySelector("[data-updated-dot]")).toBeNull()
		props.startedFromUpdated = true
		await settle()
		expect(
			buttons().find((b) => b.querySelector("[data-updated-dot]"))
		).toBeTruthy()
	})
})

/* ── brief 6b: the card menu, the new-session layout, Save changes to ── */

describe("desktop: the card menu", () => {
	test("every card has a menu; yours also offers share, rename and delete", async () => {
		toolbar()
		await settle()
		expect(await menuOf("Cinematic")).toEqual(["Use for new Adventure sessions", "Make a copy"])
		expect(await menuOf("Harbour")).toEqual(["Use for new Adventure sessions", "Make a copy"])
		expect(await menuOf("Lighthouse table")).toEqual([
			"Use for new Adventure sessions",
			"Make a copy",
			"Share with everyone on this pub",
			"Rename",
			"Delete"
		])
		// The genre default layout is what new sessions start from already.
		expect(await menuOf("Adventure")).toEqual(["Make a copy"])
	})

	test("the new-session layout wears the star: the genre default layout's until one is chosen", async () => {
		const { props } = toolbar()
		await settle()
		const starred = () =>
			[...document.querySelectorAll("[data-preset-card]")]
				.filter((c) => c.querySelector("[data-new-session-layout]"))
				.map((c) => Number(c.getAttribute("data-preset-card")))
		expect(starred()).toEqual([1])
		props.presets = PRESETS.map((p) => (p.id === 4 ? { ...p, isNewSessionLayout: true } : p))
		await settle()
		expect(starred()).toEqual([4])
		expect(
			document.querySelector('[data-preset-card="4"] [data-new-session-layout]')?.getAttribute("title")
		).toBe("New Adventure sessions start from this layout")
		expect(await menuOf("Lighthouse table")).toContain("Stop using for new sessions")
	})

	test("each item asks the page, once", async () => {
		const { props, calls } = toolbar()
		await settle()
		await choose("Cinematic", "Use for new Adventure sessions")
		expect(calls.onSetNewSessionLayout).toHaveBeenCalledWith(2)
		await choose("Harbour", "Make a copy")
		expect(calls.onCloneLayout).toHaveBeenCalledWith(5)
		await choose("Lighthouse table", "Share with everyone on this pub")
		expect(calls.onShareLayout).toHaveBeenCalledWith(4, "shared")
		props.presets = PRESETS.map((p) =>
			p.id === 4 ? { ...p, visibility: "shared", isNewSessionLayout: true } : p
		)
		await settle()
		await choose("Lighthouse table", "Stop sharing")
		expect(calls.onShareLayout).toHaveBeenLastCalledWith(4, "private")
		await choose("Lighthouse table", "Stop using for new sessions")
		expect(calls.onSetNewSessionLayout).toHaveBeenLastCalledWith(null)
		// None of these replaces this session's layout.
		expect(calls.startFrom).not.toHaveBeenCalled()
	})

	test("a guest in this session is offered no share control", async () => {
		toolbar({ isGuest: true })
		await settle()
		expect(await menuOf("Lighthouse table")).toEqual([
			"Use for new Adventure sessions",
			"Make a copy",
			"Rename",
			"Delete"
		])
	})

	test("Rename from the menu opens the name field on the card", async () => {
		const { calls } = toolbar()
		await settle()
		await choose("Lighthouse table", "Rename")
		const field = document.querySelector<HTMLInputElement>(".preset-rename")!
		expect(field).toBeTruthy()
		field.value = "Harbour lights"
		field.dispatchEvent(new Event("input", { bubbles: true }))
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
		await settle()
		expect(calls.onRenamePreset).toHaveBeenCalledWith(4, "Harbour lights")
	})
})

describe("desktop: the card menu, review round", () => {
	test("the genre default layout's card, once another is chosen, clears the choice", async () => {
		const { calls } = toolbar({
			presets: PRESETS.map((p) => (p.id === 4 ? { ...p, isNewSessionLayout: true } : p))
		})
		await settle()
		await choose("Adventure", "Use for new Adventure sessions")
		expect(calls.onSetNewSessionLayout).toHaveBeenCalledWith(null)
	})

	test("an admin's Stop sharing on someone else's layout asks first, naming whose it is", async () => {
		const { calls } = toolbar({ isAdmin: true })
		await settle()
		await choose("Harbour", "Stop sharing Ash's layout")
		expect(calls.onShareLayout).not.toHaveBeenCalled()
		expect(text(dialog())).toContain("Stop sharing “Harbour”?")
		expect(text(dialog())).toContain("Only Ash can share it again.")
		await click(cancelButton())
		expect(calls.onShareLayout).not.toHaveBeenCalled()
		await choose("Harbour", "Stop sharing Ash's layout")
		await click(confirmButton())
		expect(calls.onShareLayout).toHaveBeenCalledWith(5, "private")
	})

	test("Stop sharing your own layout needs no question: you can share it again", async () => {
		const { calls } = toolbar({
			isAdmin: true,
			presets: PRESETS.map((p) => (p.id === 4 ? { ...p, visibility: "shared" } : p))
		})
		await settle()
		await choose("Lighthouse table", "Stop sharing")
		expect(calls.onShareLayout).toHaveBeenCalledWith(4, "private")
		expect(dialog()).toBeNull()
	})

	test("a card is named by its name first; the star's words come after it", async () => {
		toolbar()
		await settle()
		const card = document.querySelector('[data-preset-card="1"]')
		expect(text(card).startsWith("Adventure")).toBe(true)
		expect(text(card)).toContain("New Adventure sessions start from this layout")
	})

	test("after a rename from the menu, focus is back on that card's menu button", async () => {
		const { calls } = toolbar()
		await settle()
		await choose("Lighthouse table", "Rename")
		const field = document.querySelector<HTMLInputElement>(".preset-rename")!
		field.value = "Harbour lights"
		field.dispatchEvent(new Event("input", { bubbles: true }))
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
		await settle()
		expect(calls.onRenamePreset).toHaveBeenCalledWith(4, "Harbour lights")
		expect(document.activeElement).toBe(menuTrigger("Lighthouse table"))
		// Escape too.
		await choose("Lighthouse table", "Rename")
		document
			.querySelector<HTMLInputElement>(".preset-rename")!
			.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
		await settle()
		expect(document.activeElement).toBe(menuTrigger("Lighthouse table"))
	})

	test("your shared layout is marked in the same words as on a phone", async () => {
		toolbar({ presets: PRESETS.map((p) => (p.id === 4 ? { ...p, visibility: "shared" } : p)) })
		await settle()
		expect(text(document.querySelector('[data-preset-card="4"] [data-shared-mark]'))).toBe("Shared")
	})
})

describe("desktop: Save changes to", () => {
	test("is offered only when this session started from a layout of yours", async () => {
		const { props } = toolbar({ startedFrom: CINEMATIC, startAgainFrom: CINEMATIC })
		await settle()
		const saveChanges = () =>
			buttons().find((b) => text(b).startsWith("Save changes to"))
		expect(saveChanges()).toBeUndefined()
		props.startedFrom = MINE
		props.startAgainFrom = MINE
		await settle()
		expect(text(saveChanges())).toBe("Save changes to “Lighthouse table”")
		props.startedFrom = SHARED
		props.startAgainFrom = SHARED
		await settle()
		expect(saveChanges()).toBeUndefined()
	})

	test("asks first, then saves into it", async () => {
		const { calls } = toolbar({ startedFrom: MINE, startAgainFrom: MINE })
		await settle()
		await click(buttonNamed("Save changes to “Lighthouse table”"))
		expect(calls.saveChanges).not.toHaveBeenCalled()
		expect(text(dialog())).toContain("Save changes to “Lighthouse table”?")
		expect(text(dialog())).toContain("Sessions that started from it keep their own layout.")
		await click(confirmButton())
		expect(calls.saveChanges).toHaveBeenCalledWith(4, false)
	})

	test("over a layout this session reads as Updated: warns, and offers Start again instead", async () => {
		const { calls } = toolbar({
			startedFrom: MINE,
			startAgainFrom: MINE,
			startedFromUpdated: true
		})
		await settle()
		await click(buttonNamed("Save changes to “Lighthouse table”"))
		expect(text(dialog())).toContain(
			"You have updated “Lighthouse table” since this session copied it."
		)
		expect(text(dialog())).toContain("Saving here replaces those changes with this session's layout.")
		expect(confirmButton()!.className).toContain("preset-filled-error-500")
		// The other way out: start again from it, which asks its own question.
		await click(document.querySelector("[data-layout-confirm] [data-confirm-alternative]"))
		expect(calls.saveChanges).not.toHaveBeenCalled()
		expect(text(dialog())).toContain("Start again from “Lighthouse table”?")
		await click(confirmButton())
		expect(calls.startFrom).toHaveBeenCalledWith(4)
		expect(calls.saveChanges).not.toHaveBeenCalled()

		// Asked again and answered yes: it saves over them, and says so.
		await click(buttonNamed("Save changes to “Lighthouse table”"))
		await click(confirmButton())
		expect(calls.saveChanges).toHaveBeenCalledWith(4, true)
	})
})

describe("phone: the card menu and Save changes to", () => {
	test("the sheet's rows carry the same menu", async () => {
		const { calls } = phone()
		await settle()
		await click(buttonNamed("Layouts"))
		await choose("Cinematic", "Use for new Adventure sessions")
		expect(calls.onSetNewSessionLayout).toHaveBeenCalledWith(2)
		// The genre default layout's row says it is what new sessions start from.
		expect(text(document.querySelector('[data-preset-card="1"]'))).toContain(
			"New Adventure sessions start from this layout"
		)
		await choose("Lighthouse table", "Delete")
		expect(calls.onPresetUsage).toHaveBeenCalledWith(4)
		expect(text(dialog())).toContain("Delete “Lighthouse table”?")
	})

	test("after Escape in a row's rename field, focus is back on that row's menu button", async () => {
		phone()
		await settle()
		await click(buttonNamed("Layouts"))
		await choose("Lighthouse table", "Rename")
		const field = document.querySelector<HTMLInputElement>("[data-preset-rename]")!
		expect(field).toBeTruthy()
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
		await settle()
		expect(document.activeElement).toBe(menuTrigger("Lighthouse table"))
	})

	test("a row of yours that is shared says so in the desktop card's words", async () => {
		phone({ presets: PRESETS.map((p) => (p.id === 4 ? { ...p, visibility: "shared" } : p)) })
		await settle()
		await click(buttonNamed("Layouts"))
		expect(text(document.querySelector('[data-preset-card="4"] [data-shared-mark]'))).toBe("Shared")
	})

	test("an admin's Stop sharing on someone else's row asks first", async () => {
		const { calls } = phone({ isAdmin: true })
		await settle()
		await click(buttonNamed("Layouts"))
		await choose("Harbour", "Stop sharing Ash's layout")
		expect(calls.onShareLayout).not.toHaveBeenCalled()
		expect(text(dialog())).toContain("Stop sharing “Harbour”?")
		await click(confirmButton())
		expect(calls.onShareLayout).toHaveBeenCalledWith(5, "private")
	})

	test("Save changes to in the sheet asks, then saves", async () => {
		const { calls } = phone({ startedFrom: MINE, startAgainFrom: MINE })
		await settle()
		await click(buttonNamed("Layouts"))
		await click(buttonNamed("Save changes to “Lighthouse table”"))
		expect(text(dialog())).toContain("Save changes to “Lighthouse table”?")
		await click(confirmButton())
		expect(calls.saveChanges).toHaveBeenCalledWith(4, false)
	})
})
