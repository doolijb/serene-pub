/**
 * At a moment before a world lore entry's Beginning its row is dimmed; at or
 * after it, it is not.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$app/navigation", () => ({
	replaceState: vi.fn(),
	goto: vi.fn(),
	pushState: vi.fn(),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	onNavigate: vi.fn()
}))
vi.mock("$app/state", () => ({
	page: { url: new URL("http://localhost/"), state: {}, params: {} }
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warning: vi.fn()
	}
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	INTEREST_CONTEXT,
	_resetInterestForTests,
	interestContextValue,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "./loreRoute.svelte"
import { staticBookData } from "./bookData.svelte"
import { emptyFilters } from "./poolFilter"
import { SECTION_DESCRIPTORS, bookPoolItems } from "./sections"
import { timelineCursor } from "./timelineCursor.svelte"
import EntryWorkspaceFixture from "./EntryWorkspaceFixture.svelte"

const BOOK = 5
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	setSocket({
		connected: true,
		id: "tab-a",
		on() {},
		off() {},
		emit() {}
	} as never)
	setInterestUser({ id: 1, isAdmin: false })
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	timelineCursor.reset()
	loreRoute.set(emptyRoute())
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

const world = (id: number, name: string, year: number | null) => ({
	id,
	lorebookId: BOOK,
	typeId: WORLD_LORE_TYPE_ID,
	branchId: null,
	name,
	year,
	month: null,
	day: null,
	content: "x",
	keys: [],
	enabled: true
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

async function open() {
	const rawRows: Record<string, unknown[]> = {}
	for (const door of SECTION_DESCRIPTORS)
		if (door.kind && door.store === "entries") rawRows[door.kind] = []
	rawRows[WORLD_LORE_TYPE_ID] = [
		world(21, "Later", 5),
		world(22, "Same", 3),
		world(23, "Perpetual", null)
	]
	const descriptor = SECTION_DESCRIPTORS.find((d) => d.id === "all")!
	loreRoute.set({ lorebookId: BOOK, scope: "all" } as any)
	const data = staticBookData(
		() =>
			({
				lorebookId: BOOK,
				timelineEnabled: true,
				rawRows: rawRows as any,
				rows: rawRows as any,
				scenes: [] as any,
				allScenes: [] as any
			}) as any
	)
	;(data as any).loaded = () => true
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(EntryWorkspaceFixture, {
		target,
		context: new Map<string, unknown>([
			["panelsCtx", { digest: {} }],
			[
				"openSessionCtx",
				{ sessionId: null, lorebookId: null, isOwner: false }
			],
			["systemSettingsCtx", { settings: {}, capabilityDefaults: [] }],
			["userCtx", { user: { id: 1, isAdmin: false } }],
			["userSettingsCtx", { settings: { showAdvancedControls: false } }],
			[INTEREST_CONTEXT, interestContextValue()]
		]),
		props: {
			data,
			lorebookId: BOOK,
			descriptor,
			doors: SECTION_DESCRIPTORS,
			bookPool: bookPoolItems(rawRows as any, [] as any),
			bookLinks: [],
			line: lineOf(null, []),
			mode: "desk",
			hasUnsavedChanges: false,
			lens: "list",
			filters: emptyFilters(),
			readInKeys: null,
			decisions: null,
			onFilters: () => {}
		}
	})
	await settle()
}

const dimmed = (id: number) =>
	document
		.querySelector(`[data-entry-key="entry#${id}"]`)
		?.classList.contains("opacity-50") ?? null

describe("a dated entry at a moment", () => {
	test("before its Beginning it is dimmed; at or after it is not", async () => {
		timelineCursor.setPosition(30000, "Y3")
		await open()
		expect(dimmed(21)).toBe(true)
		expect(dimmed(22)).toBe(false)
		expect(dimmed(23)).toBe(false)
	})

	test("at now nothing is dimmed", async () => {
		await open()
		expect(dimmed(21)).toBe(false)
	})
})
