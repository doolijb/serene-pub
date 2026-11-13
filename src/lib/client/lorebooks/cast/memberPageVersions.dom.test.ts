/**
 * The member page reads VERSIONS (B2): a link and an unlink at a present show
 * correctly. The server's row is the version in force at the book's present
 * on main; `baseColumns` is what the member read before its first change; each
 * Changes row carries its whole version in `columns`.
 *
 * ⚠ The chosen tab is module state of `CastWorkspace` and so outlives each
 * mount: every test picks the Member tab it starts from.
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

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { groupAmendments } from "$lib/shared/lorebooks/amendments"
import { lineOf } from "$lib/shared/lorebooks/lineReading"
import { emptyRoute } from "$lib/shared/lorebooks/loreRoute"
import { loreRoute } from "../loreRoute.svelte"
import { openBookTime } from "../time/bookTime.svelte"
import { parseMoment } from "../time/moment"
import { BookRelationships } from "../relationships.svelte"
import CastWorkspaceFixture from "../CastWorkspaceFixture.svelte"
import { staticBookData } from "../bookData.svelte"
import { afterBaseWrite, readCastVersion } from "./castVersionRead"

const BOOK = 5
const BIANCA = 10
const PRESENT = { year: 10, month: null, day: null }
const line = lineOf(null, [])

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

const CARD = {
	id: 7,
	userId: 1,
	name: "Bianca",
	isPersona: false,
	description: "The card's description.",
	personality: "",
	scenario: "",
	firstMessage: "",
	alternateGreetings: [],
	exampleDialogues: []
}

/** A cast version in column names; card-less by default. */
function columns(
	over: Partial<Sockets.Lorebooks.CastVersionColumns> = {}
): Sockets.Lorebooks.CastVersionColumns {
	return {
		name: "Bianca",
		aliases: [],
		summary: null,
		description: null,
		personality: null,
		scenario: null,
		firstMessage: null,
		alternateGreetings: [],
		groupOnlyGreetings: [],
		exampleDialogues: null,
		faceMediaId: null,
		postHistoryInstructions: null,
		creatorNotes: null,
		likeness: null,
		retold: {},
		ownName: null,
		ownNickname: null,
		timbre: null,
		spriteSet: null,
		nodeState: "active",
		nodeVisibility: "normal",
		characterId: null,
		...over
	}
}

function change(
	id: number,
	year: number,
	cols: Sockets.Lorebooks.CastVersionColumns
): Sockets.Amendments.CastRow {
	return {
		id,
		castId: BIANCA,
		lorebookId: BOOK,
		branchId: null,
		personalPosition: null,
		year,
		month: null,
		day: null,
		fields: {},
		columns: cols,
		historyEntryId: null,
		createdAt: "",
		updatedAt: ""
	}
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

/** Mounts the page as the shell does: the server's row, and the shell's resolver over the Changes rows. */
async function mountMember(
	serverRow: Record<string, unknown>,
	changes: Sockets.Amendments.CastRow[],
	moment?: string,
	book: { bookAccess?: "owner" | "shared" | "admin" } = {}
) {
	loreRoute.set({ lorebookId: BOOK, scope: "cast", castId: BIANCA })
	const byMember = groupAmendments(changes, "castId")
	const at = { moment: parseMoment(moment), line }
	const resolveCast = <T extends { id: number }>(
		rows: readonly T[],
		write?: { castId: number; fields: Record<string, unknown> }
	) =>
		rows.map((row) => {
			const overlays = byMember.get(row.id) ?? []
			const after =
				write?.castId === row.id
					? afterBaseWrite(row as any, overlays, write.fields)
					: { row, overlays }
			return readCastVersion(
				after.row as any,
				after.overlays,
				at,
				PRESENT
			) as T
		})
	const target = document.createElement("div")
	document.body.append(target)
	app = mount(CastWorkspaceFixture, {
		target,
		context: new Map<string, unknown>([
			["userCtx", { user: { id: 1, isAdmin: false } }]
		]),
		props: {
			store,
			data: staticBookData(() => ({
				lorebookId: BOOK,
				cast: [serverRow] as any,
				rawRows: {},
				scenes: [],
				...book
			})),
			lorebookId: BOOK,
			mode: "desk",
			hasUnsavedChanges: false,
			presences: [],
			line,
			moment,
			resolveCast,
			castAmendmentsFor: (id: number) => byMember.get(id) ?? []
		}
	})
	await settle()
	client.dispatch("characters:list", { characterList: [CARD] })
	await settle()
	;[
		...document.querySelectorAll<HTMLButtonElement>(
			'[data-cast-member-page] [role="tab"]'
		)
	]
		.find((t) => /^Member/.test(t.textContent ?? ""))
		?.click()
	await settle()
}

const text = (el: Element | null | undefined) =>
	(el?.textContent ?? "").replace(/\s+/g, " ").trim()
const summary = () =>
	document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
		'[id^="castSummary"]'
	)!.value
const retoldBlock = () => document.querySelector("[data-cast-retold]")
const descriptionField = () =>
	document.querySelector<HTMLElement>('[data-retold-field="description"]')

describe("a link at the present", () => {
	// Before the link: card-less, in their own words. At Y10 (the present) they are linked.
	const base = columns({
		summary: "Base words.",
		description: "Own description."
	})
	const changes = [
		change(31, 3, columns({ summary: "Words at Y3." })),
		change(
			33,
			10,
			columns({
				name: null,
				summary: "Words at the link.",
				description: "Own description.",
				characterId: 7,
				retold: {}
			})
		)
	]
	const server = {
		id: BIANCA,
		binding: "{{char:1}}",
		lorebookId: BOOK,
		castVersionId: 33,
		name: "Bianca",
		characterId: 7,
		character: CARD,
		summary: "Words at the link.",
		description: "Own description.",
		retold: {},
		baseColumns: base,
		cardVersion: null,
		cardCurrentVersion: null,
		behindCard: false
	}

	test("at now the form reads the card's fields under From the card", async () => {
		await mountMember(server, changes)
		expect(retoldBlock()).not.toBeNull()
		expect(text(descriptionField())).toContain("Use from card")
		expect(
			descriptionField()!.querySelector<HTMLInputElement>(
				'input[type="checkbox"]'
			)!.checked
		).toBe(true)
		const area = descriptionField()!.querySelector("textarea")!
		expect(area.value).toBe("The card's description.")
		expect(area.disabled).toBe(true)
		expect(summary()).toBe("Words at the link.")
	})

	test("at an earlier moment the form reads the member's own words, card-less", async () => {
		await mountMember(server, changes, "Y4")
		expect(retoldBlock()).toBeNull()
		expect(summary()).toBe("Words at Y3.")
		await settle()
	})

	test("before their first change they read the base version", async () => {
		await mountMember(server, changes, "Y1")
		expect(retoldBlock()).toBeNull()
		expect(summary()).toBe("Base words.")
	})
})

describe("an unlink at the present", () => {
	// Carded until Y10; the unlink wrote the card's words into a card-less version.
	const base = columns({
		name: null,
		summary: "Base words.",
		characterId: 7,
		retold: {}
	})
	const changes = [
		change(
			41,
			3,
			columns({ name: null, summary: "Carded at Y3.", characterId: 7 })
		),
		change(
			43,
			10,
			columns({
				summary: "The card's description.",
				description: "The card's description.",
				characterId: null
			})
		)
	]
	const server = {
		id: BIANCA,
		binding: "{{char:1}}",
		lorebookId: BOOK,
		castVersionId: 43,
		name: "Bianca",
		characterId: null,
		character: null,
		summary: "The card's description.",
		description: "The card's description.",
		retold: {},
		baseColumns: base,
		cardVersion: null,
		cardCurrentVersion: null,
		behindCard: false
	}

	test("at now the member is card-less, holding the card's words", async () => {
		await mountMember(server, changes)
		expect(retoldBlock()).toBeNull()
		expect(summary()).toBe("The card's description.")
		expect(
			document.querySelector<HTMLInputElement>('input[id^="castName"]')
				?.value ??
				text(document.querySelector("[data-cast-member-page] h3"))
		).toMatch(/Bianca/)
	})

	test("at an earlier moment they are carded again, the card's fields from the card", async () => {
		await mountMember(server, changes, "Y4")
		expect(retoldBlock()).not.toBeNull()
		expect(descriptionField()!.querySelector("textarea")!.value).toBe(
			"The card's description."
		)
		expect(summary()).toBe("Carded at Y3.")
	})
})

describe("the Update offer on the member page", () => {
	const carded = (extra: Record<string, unknown>) => ({
		id: BIANCA,
		binding: "{{char:1}}",
		lorebookId: BOOK,
		castVersionId: 1,
		name: "Bianca",
		characterId: 7,
		character: CARD,
		retold: {},
		baseColumns: null,
		cardVersion: { id: 1, number: 1, label: "1.0" },
		cardCurrentVersion: { id: 2, number: 2, label: "1.1" },
		behindCard: true,
		...extra
	})

	test("shown when the member is behind its card", async () => {
		await mountMember(carded({}), [])
		const offer = document.querySelector("[data-card-update-offer]")
		expect(offer).not.toBeNull()
		expect(text(offer)).toBe(
			"On card v1.0; the card is on v1.1. Update Bianca to card v1.1"
		)
	})

	test("not shown when the member is on the current version", async () => {
		await mountMember(carded({ behindCard: false }), [])
		expect(document.querySelector("[data-card-update-offer]")).toBeNull()
	})

	test("not shown without a current version to offer", async () => {
		await mountMember(carded({ cardCurrentVersion: null }), [])
		expect(document.querySelector("[data-card-update-offer]")).toBeNull()
	})

	test("not shown to a reader who cannot edit the book", async () => {
		await mountMember(carded({}), [], undefined, { bookAccess: "shared" })
		expect(document.querySelector("[data-card-update-offer]")).toBeNull()
	})
})
