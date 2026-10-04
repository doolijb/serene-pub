/**
 * The screens half of the line conformance (`lineConformance.test.ts` runs the
 * shared readers). A shared reader agreeing with the rule proves nothing about
 * a screen that never calls it, or calls it with the wrong line: this mounts
 * the screen and reads what it draws, on every line of the shared case table
 * (`lineReading.cases.ts`).
 *
 * Covered here: the Cast member page (its links: the row count, the
 * Relationships panel). The member page's presences are
 * `cast/presencesPanel.dom.test.ts`. A screen that reads rows, links,
 * presences or amendments by line belongs here.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	flushSync,
	mount,
	tick,
	unmount,
	type ComponentProps
} from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import {
	lineOf,
	rowReadsOnLine,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import {
	CASE_BRANCHES,
	CASE_LINES,
	CASE_ROWS
} from "$lib/shared/lorebooks/lineReading.cases"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "./loreRoute.svelte"
import { openBookTime } from "./time/bookTime.svelte"
import { BookRelationships } from "./relationships.svelte"
import CastWorkspaceFixture from "./CastWorkspaceFixture.svelte"
import { staticBookData } from "./bookData.svelte"
import type CastWorkspace from "./CastWorkspace.svelte"
import type EntryWorkspace from "./EntryWorkspace.svelte"
import type PresencesPanel from "./cast/PresencesPanel.svelte"

const BOOK = 5
const VERITY = 10
const OREN = 11

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

/** Every case row is a tie between the two members, dated by its own history entry. */
const HISTORY = CASE_ROWS.filter((r) => r.date).map((r) => ({
	id: 100 + r.id,
	lorebookId: BOOK,
	typeId: HISTORY_TYPE_ID,
	branchId: r.branchId,
	name: `Y${r.date!.year}`,
	year: r.date!.year,
	month: r.date!.month ?? null,
	day: r.date!.day ?? null
}))
const TIES = CASE_ROWS.map((r) => ({
	id: r.id,
	lorebookId: BOOK,
	from: { kind: "cast", bindingId: VERITY },
	to: { kind: "cast", bindingId: OREN },
	fromNodeId: VERITY,
	toNodeId: OREN,
	fromEntryId: null,
	toEntryId: null,
	historyEntryId: r.date ? 100 + r.id : null,
	sceneId: null,
	branchId: r.branchId,
	relationshipType: `tie ${r.id}`,
	reverseRelationshipType: null,
	name: "",
	description: "",
	visibility: "acknowledged",
	status: "active",
	provenance: "manual",
	reason: null
}))
const MEMBERS = [
	{ id: VERITY, name: "Verity", binding: "{{char:1}}", characterId: null, character: null },
	{ id: OREN, name: "Oren", binding: "{{char:2}}", characterId: null, character: null }
]
const NODES = MEMBERS.map((m) => ({ id: m.id, name: m.name, parentNodeId: null }))

let client: ReturnType<typeof makeClientSocket>
let store: BookRelationships
let close: () => void
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	openBookTime.open(BOOK)
	openBookTime.setBranches(BOOK, CASE_BRANCHES as any)
	store = new BookRelationships(client as any)
	close = store.open(BOOK)
	store.load()
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

/** The member page on a line, with the book's lists answered. */
async function memberPageOn(line: Line) {
	loreRoute.set({ lorebookId: BOOK, scope: "cast", castId: VERITY })
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastWorkspaceFixture, {
		target,
		props: {
			store,
			// The cast and the history are the workspace's book data (B4).
			data: staticBookData(() => ({
				lorebookId: BOOK,
				cast: MEMBERS as any,
				rawRows: { [HISTORY_TYPE_ID]: HISTORY as any }
			})),
			lorebookId: BOOK,
			mode: "desk",
			hasUnsavedChanges: false,
			presences: [],
			line
		}
	})
	await settle()
	client.dispatch("narrativeGraph:list", {
		lorebookId: BOOK,
		nodes: NODES,
		relationships: TIES,
		relationshipCounts: { castToCast: TIES.length }
	})
	await settle()
}

/** The ties the Relationships panel lists, every one of them. */
async function panelTies(): Promise<number[]> {
	const more = [
		...document.querySelectorAll("[data-cast-relationships] button")
	].find((b) => /more/i.test(b.textContent ?? "")) as HTMLButtonElement | undefined
	more?.click()
	await settle()
	return [...document.querySelectorAll("[data-cast-edge]")]
		.map((li) => Number(li.getAttribute("data-cast-edge")))
		.sort((a, b) => a - b)
}

/** The count the member's row in the list says. */
function rowCount(): number {
	const row = document.querySelector(`[data-cast-id="${VERITY}"]`)
	const said = row?.textContent?.match(/(\d+) relationships?/)
	return said ? Number(said[1]) : 0
}

const canonical = (line: Line) =>
	CASE_ROWS.filter((r) => rowReadsOnLine(r, line, r.date))
		.map((r) => r.id)
		.sort((a, b) => a - b)

const READINGS = CASE_LINES.map((id) => ({
	name: id === null ? "main" : CASE_BRANCHES.find((b) => b.id === id)!.name,
	line: lineOf(id, CASE_BRANCHES)
}))

describe("the Cast member page reads its line's links", () => {
	for (const { name, line } of READINGS)
		test(`on ${name}: the row's count and the Relationships panel are the links the line reads`, async () => {
			await memberPageOn(line)
			const expected = canonical(line)
			expect(rowCount(), "the row's count").toBe(expected.length)
			expect(await panelTies(), "the panel").toEqual(expected)
		})

	test("the delete confirmation counts every line's: deleting a member takes them all", async () => {
		await memberPageOn(lineOf(1, CASE_BRANCHES))
		;(
			document.querySelector(
				'button[aria-label="Delete cast member"]'
			) as HTMLButtonElement
		).click()
		await settle()
		expect(document.body.textContent).toContain(
			`all ${TIES.length} relationships they are in`
		)
	})
})

describe("the Cast board reads the workspace's book (plan B4)", () => {
	test("it asks for none of the book's lists on mount: they are the workspace's", async () => {
		await memberPageOn(lineOf(null, CASE_BRANCHES))
		const asked = client.emits.map((e) => e.event)
		for (const event of [
			"lorebooks:bindingList",
			"entries:list",
			"bindingSuggestions:list",
			"narrativeGraph:duplicateCandidates"
		])
			expect(asked, event).not.toContain(event)
		// …and still draws the member it was handed.
		expect(document.querySelector(`[data-cast-id="${VERITY}"]`)).not.toBeNull()
	})
})

/**
 * A screen that reads by line is handed the shell's line, and cannot be
 * mounted without it: a missing line would read main while the reader is on
 * a branch — the way line scoping has already failed open (#80). A TYPE
 * check: `npm run check` refuses a screen whose `line` is optional.
 */
type Requires<P, K extends keyof P> = {} extends Pick<P, K> ? false : true
const castNeedsLine: Requires<ComponentProps<typeof CastWorkspace>, "line"> =
	true
const entryNeedsLine: Requires<
	ComponentProps<typeof EntryWorkspace>,
	"line"
> = true
const presencesNeedLine: Requires<
	ComponentProps<typeof PresencesPanel>,
	"line"
> = true

test("every screen that reads by line requires the shell's line", () => {
	expect([castNeedsLine, entryNeedsLine, presencesNeedLine]).toEqual([
		true,
		true,
		true
	])
})
