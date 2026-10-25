/**
 * 🚧 The rules library under a book (PLAN-lorebook-kinds §C, ruling 10, lane
 * C2): "lorebooks can show the items still owned by the compendium, but they
 * are hidden by default, when shown they are read only. On edit, they are
 * imported."
 *
 * Mounted the way the workspace mounts a pool lens (`LensMountFixture`): the
 * **Vis Itineris library** chip is drawn only where the book's rules have a
 * library for the list, and is off in a fresh set of filters; on, the
 * library's pieces list read only with their badge (a piece the book holds a
 * copy of is left out); opening one reads it, and **Edit a copy** asks the
 * server for the copy and opens it.
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
vi.mock("$lib/client/components/lorebookForms/LoreContentField.svelte", () => ({
	default: () => {}
}))
vi.mock("$lib/client/components/graph/GraphVisualization.svelte", () => ({
	default: () => {}
}))

import "@serene-pub/core-catalog"
import { getRuleset, i18nText } from "@serene-pub/sdk"
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
	listScope,
	type LoreRoute,
	type LoreScope
} from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "../loreRoute.svelte"
import { openBookTime } from "../time/bookTime.svelte"
import { BookRelationships } from "../relationships.svelte"
import { staticBookData, type BookAccess } from "../bookData.svelte"
import { emptyFilters, type PoolFilters } from "../poolFilter"
import { BOOK_ENTRY_TYPES } from "../scopes"
import { rememberRulesLists } from "../sections/derivedPiece"
import type { BookLibrary } from "../libraryRows"
import LensMountFixture from "./LensMountFixture.svelte"
import { lensDescriptor } from "./registry"
import type { LensBench } from "./types"

const BOOK = 9
const rules = getRuleset("core:ruleset/vis-itineris@1")!
const rep = rules.repertoires.find((r) => r.id === "weapons")!
const WEAPONS_ID = "core:entry/vis-itineris.weapons"
const WEAPONS = {
	typeId: WEAPONS_ID,
	label: i18nText(rep.label) ?? "Weapons",
	repertoireId: "weapons",
	piece: rep.piece,
	libraryRows: 2
}

const LIBRARY: BookLibrary = {
	name: "Vis Itineris library",
	source: { document: "SRD 5.2.1", licence: "CC-BY-4.0" },
	rows: [
		{
			typeId: WEAPONS_ID,
			repertoireId: "weapons",
			id: "longsword",
			version: "1.1.0",
			piece: { name: "Longsword", description: "A knight's blade." }
		},
		{
			typeId: WEAPONS_ID,
			repertoireId: "weapons",
			id: "dagger",
			version: "1.1.0",
			piece: { name: "Dagger", description: "Short and quick." }
		}
	]
}

/** The book's own copy of the dagger, which stands in the library's place. */
const DAGGER_COPY = {
	id: 31,
	lorebookId: BOOK,
	typeId: WEAPONS_ID,
	name: "Dagger",
	content: "Short and quick.",
	keys: ["dagger"],
	enabled: true,
	constant: false,
	archived: false,
	position: 1,
	branchId: null,
	derivedFrom: {
		compendium: "vis-itineris",
		piece: "dagger",
		version: "1.1.0"
	}
}

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
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}

function bookWith(
	access: BookAccess,
	library: BookLibrary | null,
	weapons: any[] = [DAGGER_COPY]
) {
	const rawRows: Record<string, any[]> = Object.fromEntries(
		BOOK_ENTRY_TYPES.map((t) => [t, []])
	)
	rawRows[WEAPONS_ID] = weapons
	return staticBookData(() => ({
		lorebookId: BOOK,
		rawRows: rawRows as any,
		cast: [],
		scenes: [],
		allScenes: [],
		suggestions: [],
		duplicates: [],
		rulesLists: [WEAPONS],
		library,
		bookAccess: access
	}))
}

function benchAt(route: LoreRoute, filters: PoolFilters): LensBench {
	return {
		route,
		mode: "desk",
		line: lineOf(null, []),
		moment: null,
		branchName: null,
		bookPool: [],
		castItems: [],
		bookLinks: [],
		filters,
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
	[INTEREST_CONTEXT]: interestContextValue()
}

let client: ReturnType<typeof makeClientSocket>
let store: BookRelationships
let close: () => void
let app: ReturnType<typeof mount> | null = null
let bench: LensBench

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	openBookTime.open(BOOK)
	store = new BookRelationships(client as any)
	close = store.open(BOOK)
	rememberRulesLists([WEAPONS])
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

async function mountAt(opts: {
	access?: BookAccess
	weapons?: any[]
	library?: BookLibrary | null
	libraryOn?: boolean
	scope?: LoreScope
}) {
	const route: LoreRoute = {
		lorebookId: BOOK,
		scope: opts.scope ?? listScope(WEAPONS_ID),
		lens: "list"
	}
	loreRoute.set(route)
	bench = benchAt(route, {
		...emptyFilters(),
		library: opts.libraryOn ?? false
	})
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(LensMountFixture, {
		target,
		props: {
			store,
			data: bookWith(
				opts.access ?? "owner",
				opts.library ?? LIBRARY,
				opts.weapons
			),
			contexts: CONTEXTS,
			lens: lensDescriptor("list"),
			lorebookId: BOOK,
			bench,
			hasUnsavedChanges: false
		}
	})
	await settle()
}

const chipButton = () =>
	document.querySelector<HTMLButtonElement>("[data-library-chip] button")
const rowKeys = () =>
	[...document.querySelectorAll("[data-entry-row]")].map((el) =>
		el.getAttribute("data-entry-key")
	)
const buttonNamed = (re: RegExp) =>
	[...document.querySelectorAll("button")].find((b) =>
		re.test(
			`${b.textContent ?? ""} ${b.getAttribute("title") ?? ""} ${b.getAttribute("aria-label") ?? ""}`
		)
	) ?? null

describe("the ‹Rules› library chip", () => {
	test("is drawn, off, where the rules have a library for the list", async () => {
		await mountAt({})
		const chip = chipButton()
		expect(chip).not.toBeNull()
		expect(chip!.textContent).toContain("Vis Itineris library")
		expect(chip!.getAttribute("aria-pressed")).toBe("false")
		// Off: the book's own rows only.
		expect(rowKeys()).toEqual(["entry#31"])
	})

	test("is not drawn for rules with no library", async () => {
		await mountAt({ library: { name: null, source: null, rows: [] } })
		expect(chipButton()).toBeNull()
	})

	test("is not drawn in a list the library has nothing for", async () => {
		await mountAt({ scope: "world" })
		expect(chipButton()).toBeNull()
	})

	test("a list with nothing of its own offers the library in its place", async () => {
		await mountAt({ weapons: [] })
		const offer = document.querySelector("[data-library-offer]")
		expect(offer?.textContent?.replace(/\s+/g, " ")).toContain(
			"2 are ready in the Vis Itineris library."
		)
		offer!.querySelector("button")!.click()
		await settle()
		expect(bench.applyFilters).toHaveBeenCalledWith(
			expect.objectContaining({ library: true })
		)
	})

	test("pressing it turns the library on", async () => {
		await mountAt({})
		chipButton()!.click()
		await settle()
		expect(bench.applyFilters).toHaveBeenCalledWith(
			expect.objectContaining({ library: true })
		)
	})
})

describe("library rows, while the chip is on", () => {
	test("list read only with their badge, leaving out a piece the book holds a copy of", async () => {
		await mountAt({ libraryOn: true })
		expect(chipButton()!.getAttribute("aria-pressed")).toBe("true")
		const keys = rowKeys()
		expect(keys).toContain("entry#31")
		expect(keys).toContain(`library#${WEAPONS_ID}/longsword`)
		expect(keys).not.toContain(`library#${WEAPONS_ID}/dagger`)
		const row = document.querySelector(
			`[data-entry-key="library#${WEAPONS_ID}/longsword"]`
		)
		expect(
			row?.querySelector("[data-library-badge]")?.textContent
		).toContain("Vis Itineris library")
		// No row menu: nothing of the book's to change on it.
		expect(buttonNamed(/More actions for Longsword/)).toBeNull()
		expect(buttonNamed(/More actions for Dagger/)).not.toBeNull()
	})

	test("opening one reads it, and Edit a copy asks for the copy and opens it", async () => {
		await mountAt({ libraryOn: true })
		document
			.querySelector<HTMLElement>(
				`[data-entry-key="library#${WEAPONS_ID}/longsword"] [data-entry-pick]`
			)!
			.click()
		await settle()
		const editor = document.querySelector("[data-lore-editor]")
		expect(editor?.textContent).toContain("Longsword")
		expect(
			editor?.querySelector("[data-lore-save-state]")?.textContent
		).toContain("Vis Itineris library")
		const fields = document.querySelector<HTMLFieldSetElement>(
			"fieldset[data-lore-read-only]"
		)
		expect(fields?.disabled).toBe(true)
		expect(
			document.querySelector("[data-library-source]")?.textContent
		).toContain("SRD 5.2.1 · CC-BY-4.0")
		expect(buttonNamed(/^\s*Save\b/)).toBeNull()

		const copy = document.querySelector<HTMLButtonElement>(
			"[data-library-edit-copy]"
		)
		expect(copy?.textContent).toContain("Edit a copy")
		copy!.click()
		await settle()
		const sent = client.emits.find(
			(e) => e.event === "entries:copyFromLibrary"
		)
		expect(sent?.payload).toEqual({
			lorebookId: BOOK,
			branchId: null,
			typeId: WEAPONS_ID,
			pieceId: "longsword"
		})

		client.dispatch("entries:copyFromLibrary", {
			entry: {
				...DAGGER_COPY,
				id: 32,
				name: "Longsword",
				content: "A knight's blade.",
				derivedFrom: {
					compendium: "vis-itineris",
					piece: "longsword",
					version: "1.1.0"
				}
			},
			copied: true
		})
		await settle()
		expect(loreRoute.route.entryId).toBe(32)
	})

	test("a reader of a shared book reads them with no action", async () => {
		await mountAt({ access: "shared", libraryOn: true })
		expect(rowKeys()).toContain(`library#${WEAPONS_ID}/longsword`)
		document
			.querySelector<HTMLElement>(
				`[data-entry-key="library#${WEAPONS_ID}/longsword"] [data-entry-pick]`
			)!
			.click()
		await settle()
		expect(
			document.querySelector("[data-lore-editor]")?.textContent
		).toContain("Longsword")
		expect(document.querySelector("[data-library-edit-copy]")).toBeNull()
	})
})
