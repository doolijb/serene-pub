/**
 * A lorebook shared with the reader opens **read-only** (PLAN-private-messages
 * §6.7, ruled Q4): every lens renders, every write verb is hidden or
 * disabled. Each lens is mounted the way the workspace mounts it
 * (`LensMountFixture`) twice — as the owner, where the verb is there (so the
 * selector is known to find it), and as a reader, where it is not.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		warning: vi.fn()
	}
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
	interestContextValue,
	INTEREST_CONTEXT,
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
import { staticBookData, type BookAccess } from "../bookData.svelte"
import { emptyFilters } from "../poolFilter"
import { BOOK_ENTRY_TYPES } from "../scopes"
import LensMountFixture from "./LensMountFixture.svelte"
import { lensDescriptor } from "./registry"
import type { LensBench } from "./types"
import { WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

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


const ENTRY = {
	id: 5,
	lorebookId: BOOK,
	entryTypeId: WORLD_LORE_TYPE_ID,
	name: "The harbour",
	content: "Fog most mornings.",
	keys: [],
	enabled: true,
	constant: false,
	archived: false,
	position: 1,
	branchId: null
}

/** A loaded book with one world-lore entry, read as `access`. */
function bookAs(access: BookAccess) {
	const rawRows: Record<string, any[]> = Object.fromEntries(
		BOOK_ENTRY_TYPES.map((t) => [t, t === WORLD_LORE_TYPE_ID ? [ENTRY] : []])
	)
	return staticBookData(() => ({
		lorebookId: BOOK,
		rawRows: rawRows as any,
		cast: [],
		scenes: [],
		allScenes: [],
		suggestions: [],
		duplicates: [],
		bookAccess: access
	}))
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
	panelsCtx: { digest: {} },
	// The entry's inspector (Fire test) reads the app-wide interest context.
	[INTEREST_CONTEXT]: interestContextValue()
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

async function mountAs(
	access: BookAccess,
	lens: LoreLens,
	scope: LoreScope,
	extra: Partial<LoreRoute> = {}
) {
	const route: LoreRoute = { lorebookId: BOOK, scope, lens, ...extra }
	loreRoute.set(route)
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(LensMountFixture, {
		target,
		props: {
			store,
			data: bookAs(access),
			contexts: CONTEXTS,
			lens: lensDescriptor(lens),
			lorebookId: BOOK,
			bench: benchAt(route),
			hasUnsavedChanges: false
		}
	})
	await settle()
}

const buttonNamed = (re: RegExp) =>
	[...document.querySelectorAll("button")].find((b) =>
		re.test(
			`${b.textContent ?? ""} ${b.getAttribute("title") ?? ""} ${b.getAttribute("aria-label") ?? ""}`
		)
	) ?? null

/** Each lens's write verb, found by what it says. */
const VERBS: Array<{
	name: string
	lens: LoreLens
	scope: LoreScope
	find: () => Element | null
}> = [
	{
		name: "entries: New",
		lens: "list",
		scope: "world",
		find: () => buttonNamed(/^\s*New\b/)
	},
	{
		name: "time: New entry",
		lens: "time",
		scope: "history",
		find: () => buttonNamed(/New entry/)
	},
	{
		name: "cast: Add to the cast",
		lens: "list",
		scope: "cast",
		find: () => buttonNamed(/Add to the cast/)
	},
	{
		name: "cast: Suggestions",
		lens: "list",
		scope: "cast",
		find: () => document.querySelector("[data-cast-review-toggle]")
	},
	{
		name: "graph: Build",
		lens: "graph",
		scope: "world",
		find: () => document.querySelector("[data-graph-build]")
	}
]

describe("a shared book hides every lens's write verb", () => {
	for (const verb of VERBS) {
		test(`${verb.name}: offered to the owner`, async () => {
			await mountAs("owner", verb.lens, verb.scope)
			expect(verb.find()).not.toBeNull()
		})
		test(`${verb.name}: not offered to a reader`, async () => {
			await mountAs("shared", verb.lens, verb.scope)
			expect(verb.find()).toBeNull()
		})
	}
})

describe("an entry in a shared book reads", () => {
	test("the owner gets Save and the entry's ⋯", async () => {
		await mountAs("owner", "list", "world", { entryId: ENTRY.id })
		const editor = document.querySelector("[data-lore-editor]")
		expect(editor?.textContent).toContain("The harbour")
		expect(buttonNamed(/^\s*Save\b/)).not.toBeNull()
		expect(buttonNamed(/More actions for this entry/)).not.toBeNull()
		expect(document.querySelector("[data-lore-read-only]")).toBeNull()
	})

	test("a reader gets neither, and the fields are disabled", async () => {
		await mountAs("shared", "list", "world", { entryId: ENTRY.id })
		const editor = document.querySelector("[data-lore-editor]")
		expect(editor?.textContent).toContain("The harbour")
		expect(
			editor?.querySelector("[data-lore-save-state]")?.textContent
		).toContain("Read only")
		expect(buttonNamed(/^\s*Save\b/)).toBeNull()
		expect(buttonNamed(/More actions for this entry/)).toBeNull()
		const fields = document.querySelector("fieldset[data-lore-read-only]")
		expect(fields).not.toBeNull()
		expect((fields as HTMLFieldSetElement).disabled).toBe(true)
	})
})
