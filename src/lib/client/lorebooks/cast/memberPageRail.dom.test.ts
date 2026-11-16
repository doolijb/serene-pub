/**
 * The member page draws a cast member's versions on the same rail an entry
 * has, in a book that keeps a timeline. Save writes the version selected;
 * the page opens on the version in force at the book's present; selecting a
 * version moves the moment bar. With the Timeline off nothing of it is drawn.
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
const FORK = 7
const PRESENT = { year: 10, month: null, day: null }
const BRANCHES: Sockets.Amendments.Branch[] = [
	{
		id: FORK,
		lorebookId: BOOK,
		name: "Fork",
		forkedFromBranchId: null,
		forkYear: null,
		forkMonth: null,
		forkDay: null
	}
]

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
	summary: string,
	over: Partial<Sockets.Amendments.CastRow> = {}
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
		fields: { summary },
		columns: columns({ summary }),
		historyEntryId: null,
		writeOrder: id,
		sourceSessionId: null,
		sourceSessionName: null,
		createdAt: "",
		updatedAt: "",
		...over
	}
}

/** Beginning, Y2 (a session's), Y3, two at Y6, and one on a line main does not read. */
const ROWS = [
	change(34, 2, "A session's words.", {
		sourceSessionId: 3,
		sourceSessionName: "Night watch"
	}),
	change(31, 3, "Words at Y3."),
	change(32, 6, "Words at Y6a."),
	change(33, 6, "Words at Y6b."),
	change(35, 4, "Words on another line.", { branchId: 9 })
]

const SERVER = {
	id: BIANCA,
	binding: "{{char:1}}",
	lorebookId: BOOK,
	baseVersionId: 30,
	castVersionId: 33,
	name: "Bianca",
	characterId: null,
	character: null,
	summary: "Words at Y6b.",
	retold: {},
	baseColumns: columns({ summary: "Base words." }),
	cardVersion: null,
	cardCurrentVersion: null,
	behindCard: false
}

let client: ReturnType<typeof makeClientSocket>
let store: BookRelationships
let close: () => void
let app: ReturnType<typeof mount> | null = null
let changes: Sockets.Amendments.CastRow[] = []

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	openBookTime.open(BOOK)
	openBookTime.setBranches(BOOK, BRANCHES)
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

/**
 * Mounts the page as the shell does. The page's moment is the route's, as the
 * shell hands it down, so a selection that moves the bar is read back.
 */
async function mountMember(
	serverRow: Record<string, unknown>,
	rows: Sockets.Amendments.CastRow[],
	opts: {
		moment?: string
		line?: number | null
		bookAccess?: "owner" | "shared"
		timelineEnabled?: boolean
	} = {}
) {
	changes = rows
	const line = lineOf(opts.line ?? null, BRANCHES)
	loreRoute.set({
		lorebookId: BOOK,
		scope: "cast",
		castId: BIANCA,
		...(opts.moment ? { moment: opts.moment } : {}),
		...(opts.line != null ? { branch: opts.line } : {})
	})
	const resolveCast = <T extends { id: number }>(
		list: readonly T[],
		write?: { castId: number; fields: Record<string, unknown> }
	) => {
		const byMember = groupAmendments(changes, "castId")
		const at = { moment: parseMoment(loreRoute.route.moment), line }
		return list.map((row) => {
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
	}
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
				bookAccess: opts.bookAccess ?? "owner",
				timelineEnabled: opts.timelineEnabled ?? true
			})),
			lorebookId: BOOK,
			mode: "desk",
			hasUnsavedChanges: false,
			presences: [],
			line,
			get moment() {
				return loreRoute.route.moment
			},
			resolveCast,
			castAmendmentsFor: (id: number) =>
				groupAmendments(changes, "castId").get(id) ?? []
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

const norm = (s: string | null | undefined) =>
	(s ?? "").replace(/\s+/g, " ").trim()
const bodyText = () => norm(document.body.textContent)
const sent = (event: string) => client.emits.filter((e) => e.event === event)
const rail = () => document.body.querySelector("[data-version-rail]")
const railKeys = () =>
	[
		...(rail()?.querySelectorAll<HTMLElement>("[data-version-key]") ?? [])
	].map((b) => b.getAttribute("data-version-key"))
const current = () =>
	rail()?.querySelector("[aria-current]")?.getAttribute("data-version-key") ??
	null
const railButton = (key: string) =>
	rail()!.querySelector<HTMLButtonElement>(`[data-version-key="${key}"]`)!
/** The page's own buttons: the date dialogs stay in the DOM, closed. */
const button = (name: string) =>
	[...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) =>
			norm(b.textContent) === name &&
			!b.closest('[data-testid="version-date-dialog"]')
	)
/** A button of the selected version's head, not of an Elsewhere row. */
const headButton = (name: string) =>
	[
		...document.body.querySelectorAll<HTMLButtonElement>(
			"[data-version-head] button"
		)
	].find((b) => norm(b.textContent) === name)
const summary = () =>
	document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
		'[id^="castSummary"]'
	)!
async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
	el.value = v
	el.dispatchEvent(new Event("input", { bubbles: true }))
	await settle()
}
const addButtons = () => [
	...document.body.querySelectorAll<HTMLButtonElement>(
		'button[aria-label^="Add a version"]'
	)
]
/** The date dialog that has a confirm button of this name (the rail's own is closed and empty). */
function dialogWith(confirm: string) {
	return [
		...document.body.querySelectorAll('[data-testid="version-date-dialog"]')
	].find((d) =>
		[...d.querySelectorAll("button")].some(
			(b) => norm(b.textContent) === confirm
		)
	) as HTMLElement | undefined
}
async function pickDate(dialog: HTMLElement, year: string) {
	await typeInto(
		dialog.querySelector<HTMLInputElement>('input[type="number"]')!,
		year
	)
}
const dialogButton = (dialog: HTMLElement, name: string) =>
	[...dialog.querySelectorAll("button")].find(
		(b) => norm(b.textContent) === name
	)!

function listWith(
	cast: Sockets.Amendments.CastRow[],
	extra: Record<string, unknown> = {}
) {
	changes = cast
	return {
		lorebookId: BOOK,
		entries: [],
		cast,
		presences: [],
		branches: BRANCHES,
		laterVersions: { changed: 0, kept: 0 },
		...extra
	}
}

describe("the rail", () => {
	test("lists From the beginning, then the dated versions in the reader's order, with a chip and read at this date at a shared date", async () => {
		await mountMember(SERVER, ROWS)
		expect(railKeys().slice(0, 5)).toEqual([
			"beginning",
			"v:34",
			"v:31",
			"v:32",
			"v:33"
		])
		expect(bodyText()).toContain("From the beginning")
		expect(norm(railButton("v:33").textContent)).toContain(
			"at every point in their life"
		)
		expect(norm(railButton("v:33").textContent)).toContain(
			"read at this date"
		)
		expect(norm(railButton("v:32").textContent)).not.toContain(
			"read at this date"
		)
	})

	test("opens at now on main on the version whose id is the row's castVersionId", async () => {
		await mountMember(SERVER, ROWS)
		expect(current()).toBe("v:33")
		expect(summary().value).toBe("Words at Y6b.")
	})

	test("selecting a version moves the moment and shows its words", async () => {
		await mountMember(SERVER, ROWS)
		railButton("v:31").click()
		await settle()
		expect(loreRoute.route.moment).toBe("Y3")
		expect(current()).toBe("v:31")
		expect(summary().value).toBe("Words at Y3.")
		railButton("beginning").click()
		await settle()
		expect(loreRoute.route.moment).toBe("Y1")
		expect(current()).toBe("beginning")
		expect(summary().value).toBe("Base words.")
	})

	test("a second node at a shared date stays selected while the moment is the one it set", async () => {
		await mountMember(SERVER, ROWS)
		railButton("v:32").click()
		await settle()
		expect(loreRoute.route.moment).toBe("Y6")
		expect(current()).toBe("v:32")
		expect(summary().value).toBe("Words at Y6a.")
	})

	test("an Elsewhere row is listed", async () => {
		await mountMember(SERVER, ROWS)
		expect(
			document.body.querySelector('[data-version-elsewhere="35"]')
		).not.toBeNull()
	})
})

describe("Save writes the selected version", () => {
	test("on From the beginning: updateBinding with the base id and only the changed fields", async () => {
		await mountMember(SERVER, ROWS)
		railButton("beginning").click()
		await settle()
		await typeInto(summary(), "New base words.")
		button("Save")!.click()
		await settle()
		const writes = sent("lorebooks:updateBinding")
		expect(writes).toHaveLength(1)
		expect(writes[0].payload).toEqual({
			lorebookBinding: { id: BIANCA, summary: "New base words." },
			castVersionId: 30
		})
		expect(sent("amendments:update")).toHaveLength(0)
	})

	test("on a dated version: amendments:update with its own fields plus the diff", async () => {
		await mountMember(SERVER, ROWS)
		railButton("v:31").click()
		await settle()
		const name = document.querySelector<HTMLInputElement>(
			'input[id^="castName"]'
		)!
		await typeInto(name, "Bianca B.")
		button("Save")!.click()
		await settle()
		const writes = sent("amendments:update")
		expect(writes).toHaveLength(1)
		expect(writes[0].payload).toEqual({
			lorebookId: BOOK,
			id: 31,
			subject: "cast",
			fields: { summary: "Words at Y3.", name: "Bianca B." }
		})
		expect(sent("lorebooks:updateBinding")).toHaveLength(0)
	})

	test("an own-name change goes in an updateBinding with no castVersionId, after the version write", async () => {
		const carded = {
			...SERVER,
			characterId: 7,
			character: CARD,
			baseColumns: columns({ name: null, characterId: 7 }),
			castVersionId: 30
		}
		await mountMember(carded, [])
		const flip = document.querySelector<HTMLInputElement>(
			`input[name="castOwnName-${BIANCA}-fromCard"]`
		)!
		const root = flip.closest<HTMLElement>("label, [data-scope]")!
		;(
			root.querySelector<HTMLElement>('[data-part="control"]') ?? root
		).click()
		await settle()
		await typeInto(
			document.querySelector<HTMLInputElement>(`#castOwnName-${BIANCA}`)!,
			"Bee"
		)
		await typeInto(summary(), "Words.")
		button("Save")!.click()
		await settle()
		const first = sent("lorebooks:updateBinding")
		expect(first).toHaveLength(1)
		expect(first[0].payload).toEqual({
			lorebookBinding: { id: BIANCA, summary: "Words." },
			castVersionId: 30
		})
		client.dispatch("lorebooks:updateBinding", {
			lorebookBinding: { id: BIANCA }
		})
		await settle()
		const writes = sent("lorebooks:updateBinding")
		expect(writes).toHaveLength(2)
		expect(writes[1].payload.lorebookBinding).toEqual({
			id: BIANCA,
			ownName: "Bee"
		})
		expect(writes[1].payload).not.toHaveProperty("castVersionId")
		expect(writes[1].payload).not.toHaveProperty("changeLaterVersions")
	})
})

describe("Save as a new version", () => {
	test("a taken date says so; confirm files the change at that date on the line being read", async () => {
		await mountMember(SERVER, ROWS)
		await typeInto(summary(), "Fresh words.")
		button("Save as a new version…")!.click()
		await settle()
		const dialog = dialogWith("Save")!
		expect(bodyText()).toContain(
			"What you changed starts at this date; the version shown stays as it is."
		)
		await pickDate(dialog, "3")
		expect(norm(dialog.textContent)).toContain(
			"Year 3 already has a version on this line. Saving changes that version."
		)
		await pickDate(dialog, "5")
		expect(norm(dialog.textContent)).not.toContain("already has a version")
		dialogButton(dialog, "Save").click()
		await settle()
		const creates = sent("amendments:create")
		expect(creates).toHaveLength(1)
		expect(creates[0].payload).toMatchObject({
			lorebookId: BOOK,
			castId: BIANCA,
			branchId: null,
			year: 5,
			fields: { summary: "Fresh words." }
		})
		client.dispatch(
			"amendments:list",
			listWith([
				...ROWS,
				change(40, 5, "Fresh words.", { writeOrder: 40 })
			])
		)
		await settle()
		expect(loreRoute.route.moment).toBe("Y5")
	})

	test("a date with only a session's version says nothing", async () => {
		await mountMember(SERVER, ROWS)
		await typeInto(summary(), "Fresh words.")
		button("Save as a new version…")!.click()
		await settle()
		const dialog = dialogWith("Save")!
		await pickDate(dialog, "2")
		expect(norm(dialog.textContent)).not.toContain("already has a version")
	})

	test("Cancel sends nothing and keeps the draft", async () => {
		await mountMember(SERVER, ROWS)
		await typeInto(summary(), "Fresh words.")
		button("Save as a new version…")!.click()
		await settle()
		dialogButton(dialogWith("Save")!, "Cancel").click()
		await settle()
		expect(sent("amendments:create")).toHaveLength(0)
		expect(summary().value).toBe("Fresh words.")
	})

	test("+ Add a version here is off, with its title, while the form is clean", async () => {
		await mountMember(SERVER, ROWS)
		const adds = addButtons()
		expect(adds.length).toBeGreaterThan(0)
		for (const b of adds) {
			expect(b.disabled).toBe(true)
			expect(b.getAttribute("title")).toBe(
				"Change something first: a version holds what differs from the one before."
			)
		}
		expect(button("Save as a new version…")!.disabled).toBe(true)
		await typeInto(summary(), "Fresh words.")
		for (const b of addButtons()) expect(b.disabled).toBe(false)
		expect(button("Save as a new version…")!.disabled).toBe(false)
	})

	test("an add button files the change at the date its dialog chose", async () => {
		await mountMember(SERVER, ROWS)
		await typeInto(summary(), "Fresh words.")
		addButtons().at(-1)!.click()
		await settle()
		const dialog = dialogWith("Add")!
		await pickDate(dialog, "9")
		dialogButton(dialog, "Add").click()
		await settle()
		const creates = sent("amendments:create")
		expect(creates).toHaveLength(1)
		expect(creates[0].payload).toMatchObject({
			castId: BIANCA,
			year: 9,
			fields: { summary: "Fresh words." }
		})
	})
})

describe("a version's date and deletion", () => {
	test("Change its date sends amendments:update with the date", async () => {
		await mountMember(SERVER, ROWS)
		railButton("v:31").click()
		await settle()
		headButton("Change its date")!.click()
		await settle()
		const dialog = dialogWith("Move")!
		await pickDate(dialog, "4")
		dialogButton(dialog, "Move").click()
		await settle()
		expect(sent("amendments:update")).toHaveLength(1)
		expect(sent("amendments:update")[0].payload).toEqual({
			lorebookId: BOOK,
			id: 31,
			subject: "cast",
			year: 4,
			month: null,
			day: null
		})
	})

	test("Delete this version asks with the cast sentence and sends amendments:delete", async () => {
		await mountMember(SERVER, ROWS)
		railButton("v:31").click()
		await settle()
		headButton("Delete this version")!.click()
		await settle()
		expect(bodyText()).toContain(
			"Delete the version dated Year 3? From then on Bianca reads as the version before it, and this version's edit history goes with it."
		)
		headButton("Delete")!.click()
		await settle()
		expect(sent("amendments:delete")).toHaveLength(1)
		expect(sent("amendments:delete")[0].payload).toEqual({
			lorebookId: BOOK,
			id: 31,
			subject: "cast"
		})
	})
})

describe("a version that is not the page's to change", () => {
	test("on a fork a main version says from main, offers Open on main, and its Save is off with the sentence", async () => {
		await mountMember(SERVER, ROWS, { line: FORK })
		expect(bodyText()).toContain("from main")
		expect(
			[...document.body.querySelectorAll("button")].some(
				(b) => norm(b.textContent) === "Open on main"
			)
		).toBe(true)
		const save = button("Save")!
		expect(save.disabled).toBe(true)
		expect(save.getAttribute("title")).toBe(
			"This version is main's; open it on main to change it."
		)
	})

	test("a session's version has no Change its date and its Save is off, but it can be deleted", async () => {
		await mountMember(SERVER, ROWS)
		railButton("v:34").click()
		await settle()
		expect(current()).toBe("v:34")
		expect(headButton("Change its date")).toBeUndefined()
		const save = button("Save")!
		expect(save.disabled).toBe(true)
		expect(save.getAttribute("title")).toBe(
			"A session wrote this version: it can be deleted here, not edited."
		)
		headButton("Delete this version")!.click()
		await settle()
		headButton("Delete")!.click()
		await settle()
		expect(sent("amendments:delete")).toHaveLength(1)
	})
})

describe("unsaved edits", () => {
	test("selecting another version asks; Stay keeps the draft", async () => {
		await mountMember(SERVER, ROWS)
		await typeInto(summary(), "Half typed.")
		const asked = vi
			.spyOn(loreRoute, "confirmLeave")
			.mockResolvedValue(false)
		railButton("v:31").click()
		await settle()
		expect(asked).toHaveBeenCalledTimes(1)
		expect(current()).toBe("v:33")
		expect(summary().value).toBe("Half typed.")
		asked.mockResolvedValue(true)
		railButton("v:31").click()
		await settle()
		expect(current()).toBe("v:31")
		expect(summary().value).toBe("Words at Y3.")
		asked.mockRestore()
	})
})

describe("a read-only book", () => {
	test("the rail selects; there are no add buttons and no Save-as-new dialog", async () => {
		await mountMember(SERVER, ROWS, { bookAccess: "shared" })
		expect(rail()).not.toBeNull()
		railButton("v:31").click()
		await settle()
		expect(current()).toBe("v:31")
		expect(addButtons()).toHaveLength(0)
		expect(button("Save as a new version…")).toBeUndefined()
		expect(dialogWith("Save")).toBeUndefined()
	})
})

describe("Timeline off", () => {
	test("no rail, and Save sends updateBinding without castVersionId", async () => {
		await mountMember(SERVER, ROWS, { timelineEnabled: false })
		expect(rail()).toBeNull()
		expect(button("Save as a new version…")).toBeUndefined()
		await typeInto(summary(), "Plain edit.")
		button("Save")!.click()
		await settle()
		const writes = sent("lorebooks:updateBinding")
		expect(writes).toHaveLength(1)
		expect(writes[0].payload).not.toHaveProperty("castVersionId")
		expect(writes[0].payload.lorebookBinding).toMatchObject({
			id: BIANCA,
			summary: "Plain edit."
		})
	})
})

describe("the selected version's edit history", () => {
	const redlines = (versionId: number) => ({
		characterVersionId: versionId,
		cardId: 3,
		lorebookId: BOOK,
		canRestore: true,
		canClear: true,
		redlines: [91, 92].map((id) => ({
			id,
			amendmentId: null,
			version: null,
			cause: "save",
			who: "You",
			mine: true,
			at: new Date(Date.now() - id * 60_000).toISOString(),
			changes: [
				{
					field: "summary",
					kind: "text",
					before: "Old.",
					after: "New."
				}
			]
		}))
	})
	const askedFor = () =>
		sent("characterVersions:redlines").map(
			(e) => e.payload.characterVersionId
		)

	test("one ask for the shown version; its rows are drawn under that version only", async () => {
		await mountMember(SERVER, ROWS)
		expect(askedFor()).toEqual([33])
		client.dispatch("characterVersions:redlines", redlines(33))
		await settle()
		const under = (key: string) =>
			document.body.querySelectorAll(
				`[data-version-edits="${key}"] [data-redline-id]`
			).length
		expect(current()).toBe("v:33")
		expect(under("v:33")).toBe(2)
		expect(under("v:32")).toBe(0)
		expect(under("beginning")).toBe(0)
		expect(askedFor()).toEqual([33])
	})

	test("a Save asks again, for the same version", async () => {
		await mountMember({ ...SERVER, castVersionId: 30 }, [])
		expect(askedFor()).toEqual([30])
		await typeInto(summary(), "Saved words.")
		button("Save")!.click()
		await settle()
		client.dispatch("lorebooks:updateBinding", {
			lorebookBinding: { id: BIANCA }
		})
		await settle()
		expect(askedFor()).toEqual([30, 30])
	})

	test("no Save as of and no list of dated changes", async () => {
		await mountMember(SERVER, ROWS)
		expect(bodyText()).not.toContain("Save as of")
		expect(bodyText()).not.toContain("Change the member")
		expect(document.body.querySelector("[data-lore-amendments]")).toBeNull()
	})
})
