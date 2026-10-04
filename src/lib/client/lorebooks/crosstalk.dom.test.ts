/**
 * B8's crosstalk, the rest of it (lorebooks consolidation plan, wave 9).
 *
 * A reply the server sends to every tab of the user — and that several
 * surfaces in one tab wait on — is the asker's alone: it carries the asker's
 * `requestId`, and only the surface that sent it says how it went, opens what
 * it made or leaves its edit mode. Everything else only folds the change in.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const toaster = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	info: vi.fn(),
	warning: vi.fn()
}))
vi.mock("$lib/client/utils/toaster", () => ({ toaster }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import HistoryListActions from "./sections/HistoryListActions.svelte"
import CastDuplicatesPanel from "./cast/CastDuplicatesPanel.svelte"
import SessionWorkflowTab from "$lib/client/components/sessionPage/SessionWorkflowTab.svelte"
import SessionRetrievalPreview from "$lib/client/components/pipelines/workspace/SessionRetrievalPreview.svelte"

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

const BOOK = 7

let client: ReturnType<typeof makeClientSocket>
let apps: ReturnType<typeof mount>[] = []

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	for (const fn of Object.values(toaster)) fn.mockClear()
})

afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
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

function render(component: any, props: Record<string, unknown>) {
	const target = document.createElement("div")
	document.body.append(target)
	apps.push(mount(component, { target, props }))
	flushSync()
}

const sent = (event: string) => client.emits.filter((e) => e.event === event)

const historyRow = (id: number, year: number) => ({
	id,
	typeId: HISTORY_TYPE_ID,
	lorebookId: BOOK,
	year,
	month: null,
	day: null,
	content: "",
	keys: [],
	branchId: null
})

describe("the lorebook's Next date", () => {
	test("says only its own press; another surface's next date is not its news", async () => {
		render(HistoryListActions, { sources: [historyRow(1, 3)] })
		const press = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Add the next date in sequence"]'
		)!

		// The session page's press (or another tab's) lands first.
		client.dispatch("entries:iterateNext", {
			entry: historyRow(2, 4),
			requestId: "someone-else"
		})
		await settle()
		expect(toaster.success).not.toHaveBeenCalled()

		press.click()
		await settle()
		const ask = sent("entries:iterateNext")[0]!.payload
		expect(ask.requestId).toEqual(expect.any(String))
		expect(press.disabled).toBe(true)

		client.dispatch("entries:iterateNext", {
			entry: historyRow(3, 4),
			requestId: ask.requestId
		})
		await settle()
		expect(toaster.success).toHaveBeenCalledTimes(1)
		expect(press.disabled).toBe(false)
	})

	test("a refusal of its own stops the wait; another surface's refusal does not", async () => {
		render(HistoryListActions, { sources: [historyRow(1, 3)] })
		const press = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Add the next date in sequence"]'
		)!
		press.click()
		await settle()
		const ask = sent("entries:iterateNext")[0]!.payload

		client.dispatch("entries:iterateNext:error", {
			error: "Not this one.",
			requestId: "someone-else"
		})
		await settle()
		expect(press.disabled).toBe(true)

		client.dispatch("entries:iterateNext:error", {
			error: "The next entry could not be made.",
			requestId: ask.requestId
		})
		await settle()
		expect(press.disabled).toBe(false)
		expect(toaster.success).not.toHaveBeenCalled()
	})
})

describe("the session page's Start new history entry", () => {
	function place(onOpenEntry: (book: number, id: number) => void) {
		render(SessionWorkflowTab, {
			lorebookId: BOOK,
			branchId: null,
			sceneList: [],
			onOpenEntry
		})
		client.dispatch("entries:list", {
			lorebookId: BOOK,
			typeId: HISTORY_TYPE_ID,
			entryList: [historyRow(1, 3)]
		})
		flushSync()
	}

	test("the lorebook's Next date (here or in another tab) never navigates this page", async () => {
		const onOpenEntry = vi.fn()
		place(onOpenEntry)

		client.dispatch("entries:iterateNext", {
			entry: historyRow(2, 4),
			requestId: "the-lorebook-pool"
		})
		await settle()
		expect(onOpenEntry).not.toHaveBeenCalled()
		// …but the row joins the list: it is now the latest.
		expect(document.body.textContent).toContain("4")
	})

	test("its own press opens the entry it made, once", async () => {
		const onOpenEntry = vi.fn()
		place(onOpenEntry)
		const press = document.querySelector<HTMLButtonElement>(
			'button[title="Start new history entry"]'
		)!
		press.click()
		await settle()
		const ask = sent("entries:iterateNext")[0]!.payload
		client.dispatch("entries:iterateNext", {
			entry: historyRow(5, 4),
			requestId: ask.requestId
		})
		await settle()
		expect(onOpenEntry).toHaveBeenCalledTimes(1)
		expect(onOpenEntry).toHaveBeenCalledWith(BOOK, 5)
	})

	test("a refusal stops the spinner (it spun forever before)", async () => {
		place(vi.fn())
		const press = () =>
			document.querySelector<HTMLButtonElement>(
				'button[title="Start new history entry"]'
			)!
		press().click()
		await settle()
		expect(press().disabled).toBe(true)
		const ask = sent("entries:iterateNext")[0]!.payload
		client.dispatch("entries:iterateNext:error", {
			error: "The next entry could not be made.",
			requestId: ask.requestId
		})
		await settle()
		expect(press().disabled).toBe(false)
	})
})

describe("What would fire now", () => {
	test("an answer to another panel's press (the entry's Test) is not shown here", async () => {
		render(SessionRetrievalPreview, {
			sessionId: 9,
			content: "the harbour",
			personaId: null,
			disabledReason: null
		})
		const ask = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("What would fire now")
		)!
		ask.click()
		await settle()
		const mine = sent("pipelines:previewRetrieval")[0]!.payload

		const explanation = (note: string) => ({
			rows: [],
			notes: [note],
			warnings: [],
			bands: [],
			ranked: true,
			omitted: 0
		})
		client.dispatch("pipelines:previewRetrieval", {
			sessionId: 9,
			requestId: "the-entry-test",
			explanation: explanation("The Test panel's answer.")
		})
		await settle()
		expect(document.body.textContent).not.toContain("The Test panel's answer.")

		client.dispatch("pipelines:previewRetrieval:error", {
			error: "Another panel's refusal.",
			requestId: "the-entry-test"
		})
		await settle()
		expect(document.body.textContent).not.toContain("Another panel's refusal.")

		client.dispatch("pipelines:previewRetrieval", {
			sessionId: 9,
			requestId: mine.requestId,
			explanation: explanation("This panel's answer.")
		})
		await settle()
		expect(document.body.textContent).toContain("This panel's answer.")
	})
})

describe("the duplicates list", () => {
	const candidate = {
		bindingIdA: 11,
		bindingIdB: 12,
		nameA: "Maren",
		nameB: "Marren"
	}

	test("a merge made elsewhere is not toasted here; another book's is not even re-read", async () => {
		render(CastDuplicatesPanel, { lorebookId: BOOK })
		await settle()
		const asksBefore = sent("narrativeGraph:duplicateCandidates").length

		client.dispatch("narrativeGraph:mergeNode", {
			survivorNode: { id: 30, name: "Tobin", lorebookId: 99 }
		})
		await settle()
		expect(sent("narrativeGraph:duplicateCandidates").length).toBe(asksBefore)

		client.dispatch("narrativeGraph:mergeNode", {
			survivorNode: { id: 31, name: "Ines", lorebookId: BOOK }
		})
		await settle()
		expect(toaster.success).not.toHaveBeenCalled()
		expect(sent("narrativeGraph:duplicateCandidates").length).toBe(
			asksBefore + 1
		)
	})

	test("its own absorb says so once, when the server answers", async () => {
		render(CastDuplicatesPanel, { lorebookId: BOOK })
		await settle()
		client.dispatch("narrativeGraph:duplicateCandidates", {
			lorebookId: BOOK,
			candidates: [candidate]
		})
		await settle()
		const absorb = [...document.querySelectorAll("button")].find((b) =>
			/absorb/i.test(b.textContent ?? "")
		)!
		absorb.click()
		await settle()
		client.dispatch("narrativeGraph:mergeNode", {
			survivorNode: { id: 11, name: "Maren", lorebookId: BOOK }
		})
		await settle()
		expect(toaster.success).toHaveBeenCalledTimes(1)
		expect(toaster.success.mock.calls[0]![0]).toMatchObject({
			title: "Absorbed"
		})
	})

	test("an undo pressed elsewhere is not toasted; its own is", async () => {
		render(CastDuplicatesPanel, { lorebookId: BOOK })
		await settle()
		client.dispatch("narrativeGraph:listMergeLogs", {
			lorebookId: BOOK,
			mergeLogs: [
				{
					id: 5,
					survivorId: 12,
					survivorName: "Marren",
					absorbedName: "Maren",
					createdAt: new Date().toISOString()
				}
			]
		})
		await settle()
		const restored = {
			restoredNode: { id: 40, name: "Maren", lorebookId: BOOK },
			unrestoredLinkCount: 0,
			unrestoredMovedLinkCount: 0,
			unrestoredStoryCount: 0,
			unrestoredTextCount: 0
		}
		client.dispatch("narrativeGraph:undoMerge", {
			...restored,
			lorebookId: BOOK,
			mergeLogId: 5
		})
		await settle()
		expect(toaster.success).not.toHaveBeenCalled()

		const disclosure = [...document.querySelectorAll("button")].find((b) =>
			/Recent merges/.test(b.textContent ?? "")
		)!
		disclosure.click()
		await settle()
		const undo = [...document.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === "Undo"
		)!
		undo.click()
		await settle()
		expect(sent("narrativeGraph:undoMerge")[0]!.payload).toEqual({
			mergeLogId: 5
		})
		client.dispatch("narrativeGraph:undoMerge", {
			...restored,
			lorebookId: BOOK,
			mergeLogId: 5
		})
		await settle()
		expect(toaster.success).toHaveBeenCalledTimes(1)
	})
})
