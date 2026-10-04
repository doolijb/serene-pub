/**
 * The RAG notice speaks for what Search by meaning searches: the session
 * lorebook's entries (plan A1, `SEMANTIC_SEARCH_SOURCES`).
 *
 * Messages, characters and personas are embedded by the queue but never found
 * by meaning, so a backlog of them is not something RAG is waiting on. A notice
 * that counted them said "RAG can't surface them" about text it never
 * searches, and stayed up over a fully indexed lorebook.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import RagNotice from "./RagNotice.svelte"

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

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null
let target: HTMLElement

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	target = document.createElement("div")
	document.body.append(target)
	app = mount(RagNotice, {
		target,
		props: { sessionId: 7, totalMessages: 40 }
	})
	flushSync()
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

const counts = (total: number, nullCount: number, staleCount = 0) => ({
	total,
	nullCount,
	staleCount,
	readyCount: total - nullCount - staleCount
})

/** The server's reply, as the notice's request handler receives it. */
function reply(lorebook: ReturnType<typeof counts> | null, extra: object = {}) {
	client.dispatch("vectorization:checkRagStatus", {
		applicable: true,
		lorebook,
		queueRunning: true,
		activeModelName: "test-model",
		ragIgnored: false,
		canHide: true,
		...extra
	})
	flushSync()
}

const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? ""

describe("the RAG notice", () => {
	test("asks for the session's status once mounted", () => {
		expect(
			client.emits.filter(
				(e) => e.event === "vectorization:checkRagStatus"
			)
		).toHaveLength(1)
	})

	test("stays quiet over a fully indexed lorebook, whatever else is unembedded", () => {
		// The shape the server sent before the notice was narrowed, with a
		// message backlog beside a ready lorebook: nothing here is RAG's to wait on.
		reply(counts(3, 0), {
			messages: counts(30, 30),
			characters: counts(2, 2),
			personas: counts(1, 1)
		})
		expect(text()).toBe("")
	})

	test("names lorebook entries, and only them, when none is embedded", () => {
		reply(counts(4, 4))
		expect(text()).toContain(
			"Lorebook entries aren't indexed yet, so Search by meaning can't find them."
		)
		expect(text()).not.toMatch(/messages|characters|personas/i)
	})

	test("calls the feature by the name the settings give it", () => {
		// "Search by meaning" is the label the user sees on the switch; the
		// notice says the same, never the jargon beside it.
		for (const [lorebook, extra] of [
			[counts(4, 4), {}],
			[counts(5, 0, 5), {}],
			[counts(40, 28), {}],
			[counts(4, 4), { ragIgnored: true }]
		] as const) {
			reply(lorebook, extra)
			expect(text()).not.toMatch(/\bRAG\b/)
		}
	})

	test("counts only the entries while indexing", () => {
		reply(counts(40, 28))
		expect(text()).toContain("Indexing 12 of 40 lorebook entries.")
	})

	test("with the queue not running, says the rest are waiting — never that it is paused", () => {
		// Nothing can pause the queue; "not running" is idle between scans or
		// waiting on a model, so "Queue paused." was never true.
		reply(counts(40, 28), { queueRunning: false })
		expect(text()).not.toMatch(/paused/i)
		expect(text()).not.toContain("Indexing 12 of 40")
		expect(text()).toContain(
			"12 of 40 lorebook entries are indexed. The rest are waiting in the embedding queue."
		)
	})

	test("names the model when the entries were embedded with another", () => {
		reply(counts(5, 0, 5))
		expect(text()).toContain(
			"Lorebook entries were embedded with a different model and need re-indexing with test-model."
		)
	})

	test("says nothing for a session with no lorebook", () => {
		reply(null)
		expect(text()).toBe("")
	})
})

/**
 * "Ignore for this session" only hides the notice: `ragIgnored` is read by the
 * notice and nothing else, so Search by meaning keeps searching the lorebook.
 * So the wording must not say "RAG is off for this session".
 */
describe("hiding the notice for a session", () => {
	test("offers to hide the notice, not to turn search off", () => {
		reply(counts(4, 4))
		const button = [...target.querySelectorAll("button")].find((b) =>
			/hide/i.test(b.textContent ?? "")
		)
		expect(button, "a button that says it hides the notice").toBeTruthy()
		expect(button!.getAttribute("title") ?? "").not.toMatch(/ignore rag/i)
		expect(button!.getAttribute("title") ?? "").toMatch(/still/i)
	})

	test("says the notice is hidden and the search still runs", () => {
		reply(counts(4, 4), { ragIgnored: true })
		expect(text()).not.toMatch(/RAG is off/i)
		expect(text()).toContain("Notice hidden for this session.")
		expect(text()).toContain("Search by meaning still runs.")
		const show = [...target.querySelectorAll("button")].find((b) =>
			/show/i.test(b.textContent ?? "")
		)
		expect(show, "a way to show the notice again").toBeTruthy()
	})
})

describe("the hidden line", () => {
	test("stays away when nothing is waiting to be indexed", () => {
		// A hidden notice over a fully indexed book hides nothing, so there is
		// nothing to say it is hidden, and nothing to show again.
		reply(counts(40, 0), { ragIgnored: true })
		expect(text()).toBe("")
	})
})

/**
 * Hiding is the session owner's: it hides the notice for everyone in the
 * session, and the server refuses anyone else (`canHide` says which).
 */
describe("a guest's notice", () => {
	const buttonNamed = (pattern: RegExp) =>
		[...target.querySelectorAll("button")].find((b) =>
			pattern.test(b.textContent ?? "")
		)

	test("offers no way to hide it", () => {
		reply(counts(4, 4), { canHide: false })
		expect(text()).toContain("Lorebook entries")
		expect(buttonNamed(/hide/i)).toBeUndefined()
	})

	test("shows nothing once the owner has hidden it", () => {
		reply(counts(4, 4), { canHide: false, ragIgnored: true })
		expect(text()).toBe("")
	})

	test("a refused hide leaves the button usable", () => {
		reply(counts(4, 4))
		const hide = buttonNamed(/hide/i)!
		hide.click()
		flushSync()
		expect(
			client.emits.some(
				(e) => e.event === "vectorization:setSessionRagIgnored"
			)
		).toBe(true)
		client.dispatch("vectorization:setSessionRagIgnored:error", {
			error: "Only the session's owner can hide or show this notice."
		})
		flushSync()
		expect(buttonNamed(/hide/i)!.disabled).toBe(false)
	})
})
