/**
 * 🚧 The History door's time controls with the book's Timeline switch off:
 * no next-date button, no compile in an entry's scene list, no Scenes tab in
 * the inspector. On, each is as it was. ⚠ No DOM node is ever handed to
 * `expect`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success() {}, error() {}, info() {}, warning() {} }
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({ emit: () => {}, on: () => {}, off: () => {} })
}))
// The Fires tab (open first) asks the interest context for its preview.
vi.mock("$lib/client/sockets/interest.svelte", async (original) => ({
	...(await original<Record<string, unknown>>()),
	getInterestContext: () => ({
		useInterest: () => {},
		declareInterest: () => () => {},
		requestWithInterest: () => {}
	})
}))
vi.mock("./poolContext", () => ({
	getLorePoolCtx: () => ({
		scenesOf: () => [],
		compileActivityOf: () => undefined,
		openCompile: () => {},
		openProcess: () => {},
		onNavigateToGraph: undefined,
		bindingForTag: () => null,
		reading: { sessionId: null, sessionName: null }
	})
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { bookDataContext, staticBookData } from "../bookData.svelte"
import { SECTION_DESCRIPTORS } from "./index"
import HistoryListActions from "./HistoryListActions.svelte"
import HistorySceneList from "./HistorySceneList.svelte"
import EntryInspector from "./EntryInspector.svelte"

let app: ReturnType<typeof mount> | null = null
beforeEach(() => {
	setSocket({
		connected: true,
		id: "t",
		on() {},
		off() {},
		emit() {}
	} as never)
	setInterestUser({ id: 1, isAdmin: false })
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

function show(
	component: any,
	props: Record<string, unknown>,
	timelineEnabled: boolean
) {
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(component, {
		target: host,
		props,
		context: bookDataContext(
			staticBookData(() => ({ lorebookId: 3, timelineEnabled }))
		)
	})
	flushSync()
}
const norm = (s: string | null | undefined) =>
	(s ?? "").replace(/\s+/g, " ").trim()
const nextDate = () =>
	document.querySelector('button[aria-label="Add the next date in sequence"]')

describe("Add the next date in sequence", () => {
	test("on: drawn", () => {
		show(HistoryListActions, { sources: [] }, true)
		expect(!!nextDate()).toBe(true)
	})
	test("off: not drawn", () => {
		show(HistoryListActions, { sources: [] }, false)
		expect(!!nextDate()).toBe(false)
	})
})

describe("an entry's scene list", () => {
	const entry = { id: 5, unfiledSceneCount: 2 }
	test("on: Compile to Entry is drawn", () => {
		show(HistorySceneList, { entry }, true)
		expect(norm(document.body.textContent)).toContain("Compile to Entry")
	})
	test("off: no compile control", () => {
		show(HistorySceneList, { entry }, false)
		expect(norm(document.body.textContent)).not.toContain(
			"Compile to Entry"
		)
	})
})

describe("the inspector's Scenes tab", () => {
	const door = SECTION_DESCRIPTORS.find((d) => d.id === "history")!
	const source = { id: 5, year: 1, month: null, day: null }
	const props = {
		lorebookId: 3,
		item: door.toPoolItem(source),
		source,
		door,
		pool: [],
		onOpenItem: () => {}
	}
	const tabs = () =>
		[...document.querySelectorAll("[data-lore-inspector-tab]")].map((t) =>
			t.getAttribute("data-lore-inspector-tab")
		)
	test("on: offered for a history entry", () => {
		show(EntryInspector, props, true)
		expect(tabs()).toContain("scenes")
	})
	test("off: not offered; the other tabs stay", () => {
		show(EntryInspector, props, false)
		expect(tabs()).not.toContain("scenes")
		expect(tabs()).toContain("fires")
		expect(tabs()).toContain("references")
	})
})
