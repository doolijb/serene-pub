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

/** A Map-backed Storage: this environment's own is not one. */
function memoryStorage() {
	const m = new Map<string, string>()
	return {
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => void m.set(k, String(v)),
		removeItem: (k: string) => void m.delete(k),
		clear: () => m.clear()
	}
}

beforeEach(() => {
	vi.stubGlobal("localStorage", memoryStorage())
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	target = document.createElement("div")
	document.body.append(target)
	mountNotice(false)
})

/** Mounts the notice as an administrator or a member (`userCtx`). */
function mountNotice(isAdmin: boolean) {
	if (app) unmount(app)
	target.innerHTML = ""
	client.emits.length = 0
	app = mount(RagNotice, {
		target,
		props: { sessionId: 7, totalMessages: 40 },
		context: new Map([["userCtx", { user: { id: 1, isAdmin } }]])
	})
	flushSync()
}

afterEach(() => {
	if (app) unmount(app)
	app = null
	vi.unstubAllGlobals()
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
			"12 of 40 lorebook entries are indexed. The rest are waiting to be indexed."
		)
	})

	test("names the model when the entries were indexed with another", () => {
		reply(counts(5, 0, 5))
		expect(text()).toContain(
			"Lorebook entries were indexed with a different model and need re-indexing with test-model."
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

/**
 * The notice offers the press its sentence names (less-confusing H2), and
 * only to an administrator: the server refuses `vectorization:addToQueue` to
 * anyone else, and Admin is theirs alone.
 */
describe("what the notice offers", () => {
	const pressNamed = (pattern: RegExp) =>
		[...target.querySelectorAll("button, a")].find((el) =>
			pattern.test(el.textContent ?? "")
		) as HTMLElement | undefined

	test("Re-index now queues the session when its entries need re-indexing", () => {
		mountNotice(true)
		reply(counts(5, 0, 5))
		const reindex = pressNamed(/re-index now/i)
		expect(reindex, "a Re-index now press").toBeTruthy()
		expect(pressNamed(/prioritize/i)).toBeUndefined()
		reindex!.click()
		flushSync()
		expect(
			client.emits.find((e) => e.event === "vectorization:addToQueue")
				?.payload
		).toEqual({ sessionId: 7 })
	})

	test("links an administrator to set up search by meaning when nothing is indexed", () => {
		mountNotice(true)
		reply(counts(4, 4))
		const setup = pressNamed(/set up search by meaning/i)
		expect(setup?.tagName).toBe("A")
		expect(setup?.getAttribute("href")).toBe("/admin/defaults")
		expect(pressNamed(/prioritize in queue/i)).toBeTruthy()
	})

	test("a member gets the sentence and nothing to queue or set up", () => {
		reply(counts(5, 0, 5))
		expect(text()).toContain("need re-indexing")
		expect(pressNamed(/re-index|prioritize|set up/i)).toBeUndefined()
	})
})

/**
 * Once a session, then an icon (polish parity L1, 2026-10-24): the line shows
 * the first time this device opens a session it applies to; after that it is
 * an icon in the composer's footer that opens the line again.
 */
describe("once a session, then an icon", () => {
	const showButton = () =>
		target.querySelector<HTMLButtonElement>('button[aria-label="Show the indexing notice"]')
	const collapseButton = () =>
		target.querySelector<HTMLButtonElement>('button[aria-label="Collapse the indexing notice"]')

	test("the first open shows the line; the next open of that session shows the icon", () => {
		reply(counts(4, 4))
		expect(text()).toContain("Lorebook entries aren't indexed yet")
		expect(showButton()).toBeNull()
		// The session opens again (a fresh mount, as a page load).
		mountNotice(false)
		reply(counts(4, 4))
		expect(text()).not.toContain("Lorebook entries aren't indexed yet")
		const icon = showButton()!
		expect(icon, "an icon stands for the notice").toBeTruthy()
		expect(icon.getAttribute("aria-expanded")).toBe("false")
		expect(icon.getAttribute("title")).toContain("Lorebook entries aren't indexed yet")
		icon.click()
		flushSync()
		expect(text()).toContain("Lorebook entries aren't indexed yet")
	})

	test("collapsing the line makes it the icon at once", () => {
		reply(counts(40, 28))
		const collapse = collapseButton()!
		expect(collapse.getAttribute("aria-expanded")).toBe("true")
		collapse.click()
		flushSync()
		expect(text()).not.toContain("Indexing 12 of 40")
		expect(showButton()).toBeTruthy()
	})

	test("another session's notice is still unread", () => {
		reply(counts(4, 4))
		if (app) unmount(app)
		target.innerHTML = ""
		app = mount(RagNotice, {
			target,
			props: { sessionId: 8, totalMessages: 40 },
			context: new Map([["userCtx", { user: { id: 1, isAdmin: false } }]])
		})
		flushSync()
		reply(counts(4, 4))
		expect(text()).toContain("Lorebook entries aren't indexed yet")
	})
})
