/**
 * 🚧 (M2e) A provided book (comes with the pub or a plugin) is disabled by an
 * admin, never deleted: no Delete is drawn on it, while an admin's own
 * starter lorebook and an ordinary book keep theirs.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const socket = { emit: () => {}, on: () => {}, off: () => {} }
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: () => () => {},
	useInterest: () => {},
	requestWithInterest: () => () => {},
	getInterestContext: () => ({
		useInterest: () => {},
		declareInterest: () => () => {},
		requestWithInterest: () => () => {}
	})
}))

import BookSettings from "./BookSettings.svelte"
import LorebookListItem from "$lib/client/components/listItems/LorebookListItem.svelte"
import { isProvidedBook, primerRowLine } from "./starterKitCards"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

const props = (over: Record<string, unknown>) => ({
	lorebookId: 1,
	bookName: "Harbour",
	branchId: null,
	branchName: null,
	branches: [],
	present: null,
	onSetClock: () => {},
	counts: { entries: 0, places: 0, cast: 0 },
	rowsByType: {},
	scenes: [],
	relationships: 0,
	readingInto: null,
	primaryRuleset: null,
	loreWriteMode: null,
	hasUnsavedChanges: false,
	onClose: () => {},
	onImport: () => {},
	onDuplicate: () => {},
	onDelete: () => {},
	...over
})
const deletes = (over: Record<string, unknown>) => {
	app = mount(BookSettings, {
		target: document.body,
		props: props(over) as any
	})
	flushSync()
	return Array.from(document.querySelectorAll("button")).filter((b) =>
		/^Delete/.test(b.textContent?.trim() ?? "")
	).length
}

describe("Delete on a book's settings", () => {
	test("an ordinary book offers Delete", () => {
		expect(deletes({})).toBe(1)
	})
	test("a provided book offers none", () => {
		expect(deletes({ isProvided: true })).toBe(0)
	})
	test("an admin's starter lorebook keeps Delete starter lorebook", () => {
		expect(deletes({ isStarterKit: true })).toBe(1)
	})
	test("a provided starter lorebook (a primer row) offers none", () => {
		expect(deletes({ isStarterKit: true, isProvided: true })).toBe(0)
	})
	test("isProvidedBook reads the server's mark", () => {
		expect(isProvidedBook({ provided: { disabled: false } })).toBe(true)
		expect(isProvidedBook({})).toBe(false)
		expect(isProvidedBook(null)).toBe(false)
	})
})

describe("a primer row (the server's readOnly mark) reads read-only", () => {
	const settings = (over: Record<string, unknown>) => {
		app = mount(BookSettings, {
			target: document.body,
			props: props({
				isStarterKit: true,
				isProvided: true,
				...over
			}) as any
		})
		flushSync()
	}

	test("Book settings draws the line and Clone, and no edit control", () => {
		const onClone = vi.fn()
		settings({ readOnly: true, onClone })
		const line = document.querySelector("[data-book-settings-read-only]")
		expect(line?.textContent?.trim()).toBe(primerRowLine({ readOnly: { pluginName: null } }))
		// EditLorebookForm's own inputs, the rules and the clock are not drawn.
		expect(document.querySelector("form, input, textarea")).toBeNull()
		expect(document.querySelector("[data-book-settings-kit]")).toBeNull()
		const clone = document.querySelector<HTMLButtonElement>(
			"[data-book-settings-clone]"
		)
		expect(clone?.textContent?.trim()).toBe("Clone")
		clone!.click()
		expect(onClone).toHaveBeenCalledTimes(1)
		expect(
			Array.from(document.querySelectorAll("button")).filter((b) =>
				/^Delete/.test(b.textContent?.trim() ?? "")
			)
		).toHaveLength(0)
	})

	test("without the mark Book settings is unchanged", () => {
		settings({ isProvided: false })
		expect(
			document.querySelector("[data-book-settings-read-only]")
		).toBeNull()
		expect(document.querySelector("[data-book-settings-clone]")).toBeNull()
		expect(
			document.querySelector("[data-book-settings-kit]")
		).not.toBeNull()
	})

	const menuLabels = async (
		lorebook: Record<string, unknown>,
		onClone?: any
	) => {
		app = mount(LorebookListItem, {
			target: document.body,
			props: {
				lorebook: {
					id: 7,
					name: "Harbour",
					kind: "starter_kit",
					...lorebook
				},
				onclick: () => {},
				onOpenSettings: () => {},
				onDuplicate: () => {},
				onDelete: () => {},
				onClone
			} as any
		})
		flushSync()
		document
			.querySelector<HTMLButtonElement>(
				"button[aria-label='Lorebook options']"
			)!
			.click()
		await tick()
		flushSync()
		return Array.from(
			document.querySelectorAll<HTMLElement>("[role=menuitem]")
		).map((el) => el.textContent?.trim())
	}

	test("a primer row offers Clone, not Book settings, Duplicate or Delete", async () => {
		const labels = await menuLabels(
			{ readOnly: true, provided: { disabled: false } },
			() => {}
		)
		expect(labels).toContain("Clone")
		expect(labels).not.toContain("Book settings")
		expect(labels).not.toContain("Duplicate")
		expect(labels).not.toContain("Delete")
	})

	test("a row without the mark is unchanged", async () => {
		const labels = await menuLabels({}, () => {})
		expect(labels).toContain("Book settings")
		expect(labels).toContain("Duplicate")
		expect(labels).toContain("Delete")
		expect(labels).not.toContain("Clone")
	})
})
