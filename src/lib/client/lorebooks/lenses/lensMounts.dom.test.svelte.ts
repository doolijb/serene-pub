/**
 * Every lens in the registry renders through its mount, the way the
 * workspace mounts it (`LensMountFixture`), and reads only the book lists its
 * descriptor declares (`reads`). Lenses that share a mount keep the screen
 * when switched between — the list keeps its scroll and its split, the
 * canvas its layout — and the lens row is drawn from the registry.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}))
// Heavy editors and the canvas renderer: what is under test is which screen
// a lens mounts, not what the screen's widgets draw.
vi.mock("$lib/client/components/lorebookForms/LoreContentField.svelte", () => ({
	default: () => {}
}))
vi.mock("$lib/client/components/graph/GraphVisualization.svelte", () => ({
	default: () => {}
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import {
	emptyRoute,
	LORE_LENSES,
	type LoreLens,
	type LoreRoute,
	type LoreScope
} from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "../loreRoute.svelte"
import { openBookTime } from "../time/bookTime.svelte"
import { BookRelationships } from "../relationships.svelte"
import { staticBookData, type BookData } from "../bookData.svelte"
import { emptyFilters } from "../poolFilter"
import { BOOK_ENTRY_TYPES } from "../scopes"
import LensRow from "../LensRow.svelte"
import LensMountFixture from "./LensMountFixture.svelte"
import { lensDescriptor, LORE_LENS_REGISTRY } from "./registry"
import type { LensBench, LensReads } from "./types"

const BOOK = 9

type Listener = (payload: any) => void
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		}
	}
}

const LISTS: readonly LensReads[] = [
	"rows",
	"rawRows",
	"cast",
	"scenes",
	"allScenes",
	"suggestions",
	"duplicates"
]

/** A loaded, empty book that writes down which of its lists were read. */
function recordingBook(): { data: BookData; reads: Set<string> } {
	const reads = new Set<string>()
	const rawRows = Object.fromEntries(BOOK_ENTRY_TYPES.map((t) => [t, []]))
	const base = staticBookData(() => ({
		lorebookId: BOOK,
		rawRows,
		cast: [],
		scenes: [],
		allScenes: [],
		suggestions: [],
		duplicates: []
	}))
	const data = new Proxy(base, {
		get(target, key, receiver) {
			if (typeof key === "string" && (LISTS as readonly string[]).includes(key))
				reads.add(key)
			return Reflect.get(target, key, receiver)
		}
	})
	return { data, reads }
}

function benchAt(route: LoreRoute): LensBench {
	return {
		route,
		mode: "desk",
		line: lineOf(null, []),
		moment: null,
		branchName: null,
		bookPool: [],
		castItems: [],
		bookLinks: [],
		filters: emptyFilters(),
		readInKeys: null,
		decisions: null,
		runRelationships: null,
		timeSession: null,
		presences: [],
		livesMembers: [],
		queue: null,
		focusField: null,
		suggestionsRequest: null,
		onSaved: undefined,
		resolveRows: (rows) => [...rows],
		resolveCast: (rows) => [...rows],
		amendmentsFor: () => [],
		castAmendmentsFor: () => [],
		openLens: vi.fn(),
		openMember: vi.fn(),
		applyFilters: vi.fn(),
		leaveQueue: vi.fn()
	}
}

/** The contexts the lens screens read from the app's shell. */
const CONTEXTS = {
	systemSettingsCtx: { capabilityDefaults: {} },
	openSessionCtx: {
		sessionId: null,
		lorebookId: null,
		sessionName: null,
		lorebookBranchId: null,
		storyClock: null,
		isOwner: false
	},
	sceneSummarizesCtx: {
		activities: [],
		reviewSceneId: null,
		setReviewSceneId: () => {}
	},
	compileEntriesCtx: {
		activities: [],
		reviewActivityId: null,
		setReviewActivityId: () => {},
		dismiss: () => {}
	},
	userCtx: { user: { id: 1, isAdmin: false } },
	graphBuildsCtx: { reopenLorebookId: null, buildFor: () => null },
	panelsCtx: { digest: {} }
}

/** What each mount draws, by the root it stamps. */
function screenSelector(lens: LoreLens, scope: LoreScope): string {
	const d = lensDescriptor(lens)
	if (d.mount === "pool")
		return scope === "cast"
			? '[data-lore-section="cast"]'
			: `[data-lore-scope="${scope}"][data-lore-lens="${lens}"]`
	if (d.mount === "drawing") return `[data-lore-drawing="${d.drawing}"]`
	if (d.mount === "time") return '[data-lore-lens="time"]'
	return "[data-lore-lives]"
}

let client: ReturnType<typeof makeClientSocket>
let store: BookRelationships
let close: () => void
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	openBookTime.open(BOOK)
	store = new BookRelationships(client as any)
	close = store.open(BOOK)
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	close()
	loreRoute.set(emptyRoute())
	openBookTime.open(null)
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

/** One lens mounted at a scope; its props stay live for a switch. */
async function mountLens(lens: LoreLens, scope: LoreScope) {
	const route: LoreRoute = { lorebookId: BOOK, scope, lens }
	loreRoute.set(route)
	const book = recordingBook()
	const props = $state({
		store,
		data: book.data,
		contexts: CONTEXTS,
		lens: lensDescriptor(lens),
		lorebookId: BOOK,
		bench: benchAt(route),
		hasUnsavedChanges: false
	})
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(LensMountFixture, { target, props })
	await settle()
	return { props, reads: book.reads }
}

describe("every lens in the registry renders through its mount", () => {
	for (const lens of LORE_LENSES)
		for (const scope of ["world", "cast"] as const)
			test(`${lens} at ${scope}: draws its screen, reading only what it declares`, async () => {
				const { reads } = await mountLens(lens, scope)
				expect(
					document.querySelector(screenSelector(lens, scope)),
					screenSelector(lens, scope)
				).not.toBeNull()
				const declared = new Set(lensDescriptor(lens).reads)
				const undeclared = [...reads].filter(
					(r) => !declared.has(r as LensReads)
				)
				expect(undeclared, `${lens} reads lists it does not declare`).toEqual([])
			})
})

describe("lenses that share a mount keep the screen", () => {
	test("List → Cards → Tree redraws the same entry workspace, never a new one", async () => {
		const { props } = await mountLens("list", "world")
		const screen = document.querySelector("[data-lore-scope='world']")
		expect(screen?.getAttribute("data-lore-lens")).toBe("list")
		for (const next of ["cards", "tree"] as const) {
			props.lens = lensDescriptor(next)
			await settle()
			const now = document.querySelector("[data-lore-scope='world']")
			expect(now, next).toBe(screen)
			expect(now?.getAttribute("data-lore-lens")).toBe(next)
		}
	})

	test("Graph → Places keeps the canvas's screen and switches its drawing", async () => {
		const { props } = await mountLens("graph", "world")
		const screen = document.querySelector("[data-lore-drawing]")
		expect(screen?.getAttribute("data-lore-drawing")).toBe("relationships")
		props.lens = lensDescriptor("places")
		await settle()
		const now = document.querySelector("[data-lore-drawing]")
		expect(now).toBe(screen)
		expect(now?.getAttribute("data-lore-drawing")).toBe("places")
	})

	test("a lens with another mount draws a new screen", async () => {
		const { props } = await mountLens("list", "world")
		props.lens = lensDescriptor("time")
		await settle()
		expect(document.querySelector("[data-lore-scope='world']")).toBeNull()
		expect(document.querySelector('[data-lore-lens="time"]')).not.toBeNull()
	})
})

describe("LensRow — drawn from the registry", () => {
	test("one button per lens, in order, named, with its shortcut; the lens in force pressed", async () => {
		const onLens = vi.fn()
		const target = document.createElement("div")
		document.body.append(target)
		app = mount(LensRow, { target, props: { lens: "graph", onLens } })
		await settle()
		const buttons = [
			...document.querySelectorAll<HTMLButtonElement>("[data-lore-lens]")
		]
		expect(buttons.map((b) => b.dataset.loreLens)).toEqual([...LORE_LENSES])
		for (const [i, b] of buttons.entries()) {
			const d = LORE_LENS_REGISTRY[i]
			expect(b.textContent?.trim()).toBe(d.label)
			expect(b.getAttribute("aria-keyshortcuts")).toBe(d.shortcut)
			expect(b.title).toContain(d.label)
			expect(b.getAttribute("aria-pressed")).toBe(String(d.id === "graph"))
		}
		buttons[6].click()
		expect(onLens).toHaveBeenCalledWith("places")
	})
})
