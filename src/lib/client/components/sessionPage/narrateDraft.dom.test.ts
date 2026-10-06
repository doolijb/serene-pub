/**
 * `/narrate <text>` on the page (genre uplift C2 follow-up, 2026-09-29): the
 * branch of `fireOfferedAction` that fires a directed narration straight from
 * the composer, and the answer that spends — or keeps — its draft.
 *
 * Core's composer is the BUILT module, mounted by the SDK's harness in core's
 * box, with Chat's Narrate in its palette. The page's half is its own
 * helpers, as `+page.svelte` wires them: `routePress` and `narrateDirectly`
 * on the press, then the page's `createNarrations` — the same bodies its
 * press and its two `useInterest` handlers run, over this test's state (the
 * page's wiring of them is pinned from its source). The answer travels the real road
 * back: the page declares its two keys on the REAL client interest registry
 * (as its `useInterest` calls do), the registry's `interest:sync` is what the
 * server's gate is handed (the real `interestSync` handler), the gate's own
 * `interestedSockets` decides delivery exactly as `emitToUser` asks it for a
 * gated push, and the push is dispatched down the client socket to whatever
 * the registry installed.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { readFileSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { mountComponent, type MountedComponent } from "@serene-pub/cli/testing"
import { componentParitySections } from "@serene-pub/conformance"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))
vi.mock("$lib/client/sockets/socketInstance", () => ({ getSocket: () => client }))

import {
	_resetInterestForTests,
	declareInterest,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { createTypedSocket } from "$lib/client/sockets/typedSocket"
import { interestSync, interestedSockets, type InterestSocket } from "$lib/server/sockets/interest"
import { isGatedEvent, scopeOfPayload } from "$lib/shared/sockets/interest"
import { NARRATE_ACTION } from "$lib/shared/actions/identity"
import {
	createNarrations,
	narrateDirectly,
	nextDraftWrite,
	routePress,
	type DraftWrite,
	type ListedCollects,
	type NarratorRequest
} from "./collects"
import { answerDraft } from "./requests/draft"

const CORE_CATALOG = realpathSync(resolve(process.cwd(), "node_modules/@serene-pub/core-catalog"))
const PAGE_SOURCE = resolve(process.cwd(), "src/routes/sessions/[id]/+page.svelte")
const FIELD = "sp-composer-field"
const SESSION_ID = 42
const USER = { id: 1, isAdmin: false }
const ANSWER = "sessions:fireNarratorResponse"
const ERROR = "sessions:fireNarratorResponse:error"

/** Chat's Narrate, as its listing carries it (`core-catalog/src/narrate.ts`). */
const NARRATE_COLLECTS: ListedCollects = {
	text: {
		need: "optional",
		label: "What should happen next?",
		placeholder: "The storm breaks over the harbour.",
		ifEmpty: "The narrator decides."
	}
}
const PALETTE = [
	{
		key: "narrate",
		specSlug: "core:spec/chat-narrate",
		name: "Narrate",
		slash: "narrate",
		collects: NARRATE_COLLECTS,
		audience: { act: ["owner"] },
		canAct: true,
		isNew: false,
		venue: "composer",
		enabled: true
	}
]

type Listener = (payload: any) => void
/** The browser's socket: what the registry listens on, and what the page emits on. */
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-1",
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
		/** The server pushing an event down this socket. */
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}
let client: ReturnType<typeof makeClientSocket>

/**
 * The server's side of this tab: the socket the gate walks, holding whatever
 * the tab's last `interest:sync` said — handed to the real sync handler.
 */
const serverSocket: InterestSocket = { id: "tab-1", interest: new Set(), user: USER }
const io = {
	sockets: {
		adapter: { rooms: new Map([[`user_${USER.id}`, new Set(["tab-1"])]]) },
		sockets: new Map([["tab-1", serverSocket]])
	}
}
async function syncToServer() {
	const syncs = client.emits.filter((e) => e.event === "interest:sync")
	await interestSync.handler(serverSocket as any, syncs.at(-1)!.payload, () => {})
}

/**
 * The server's `emitToUser` for plain data, down to the delivery: an ungated
 * event (every `:error`) goes to the user's room — this tab; a gated one only
 * to the sockets whose declared keys want it, at the payload's scope.
 */
function push(event: string, payload: any): boolean {
	if (isGatedEvent(event)) {
		const wanted = interestedSockets(io as any, USER.id, event, scopeOfPayload(event, payload))
		if (!wanted.some((s) => s.id === "tab-1")) return false
	}
	client.dispatch(event, payload)
	return true
}

/** The page, as far as the composer's draft and a narration go. */
class Page {
	newMessage = ""
	draft: DraftWrite = { content: "", write: 0 }
	view!: MountedComponent
	toasts: Array<{ title: string; description?: string }> = []
	unlanded: NarratorRequest | null = null
	releases: Array<() => void> = []
	/** The page's `createNarrations`, lent this page's state as `+page.svelte` lends its own. */
	narrations = createNarrations({
		sessionId: () => SESSION_ID,
		draft: () => this.newMessage,
		writeDraft: (content) => this.writeDraft(content),
		keepUnlanded: (press) => (this.unlanded = press),
		say: (error) => this.toasts.push({ title: "Narrate", description: error }),
		send: (params) => createTypedSocket().emit(ANSWER, params)
	})
	get pending() {
		return this.narrations.pending
	}
	/**
	 * Opened on a kept draft, as a reload opens the session: the field shows
	 * only what the page writes (typing is the composer's own until the next
	 * write), so a field assertion is meaningful only after a write.
	 */
	constructor(saved = "") {
		if (saved) this.writeDraft(saved)
	}
	writeDraft(content: string) {
		this.newMessage = content
		this.draft = nextDraftWrite(this.draft, content)
	}
	dossier() {
		const sections = componentParitySections() as { scoped: { session_full: Record<string, any> } }
		const full = sections.scoped.session_full
		return {
			...full,
			composer: { ...full.composer, draft: this.draft, personas: [], personaId: null, palette: PALETTE }
		}
	}
	async open() {
		// The page's two `useInterest` declarations, on the real registry.
		this.releases.push(
			declareInterest<typeof ANSWER>(ANSWER, this.narrations.answered),
			declareInterest<typeof ERROR>(ERROR, this.narrations.error)
		)
		const sections = componentParitySections() as Record<string, any>
		this.view = await mountComponent({
			root: CORE_CATALOG,
			entry: "dist/components/messages.js",
			owner: "core",
			coreConversation: true,
			timeoutMs: 60_000,
			requests: (kind, params) => {
				if (kind === "draft") return answerDraft(params, { setDraft: (c) => (this.newMessage = c) })
				return new Promise(() => {})
			},
			context: { ...sections, scoped: { session_full: this.dossier() } } as never
		})
		await this.quiet()
		return this
	}
	async quiet() {
		await new Promise((r) => setTimeout(r, 400))
		await this.view.settle()
	}
	field() {
		return this.view.query(FIELD)!.getAttribute("value")
	}
	/** Enter, and the page's `fireOfferedAction` for the composer's press. */
	async enter() {
		await this.view.dispatch(FIELD, "key", { key: "Enter", shift: false })
		await this.quiet()
		const inv = this.view.invoked.at(-1)!
		const listed = PALETTE.find((a) => `${a.specSlug}#${a.key}` === inv.key)
		const route = routePress(listed, inv.text !== undefined ? { text: inv.text } : undefined, inv.key)
		const direction = narrateDirectly(inv.key, route)
		// The composer's press is the draft's (`supplied.fromDraft`).
		if (direction) this.narrations.directed(direction, true)
		return route
	}
	/** Re-render with the page's draft, as its dossier push does. */
	async redraw() {
		await this.view.push("scoped", { session_full: this.dossier() } as never)
		await this.quiet()
	}
	async close() {
		this.releases.splice(0).forEach((r) => r())
		await this.view.unmount()
	}
}

beforeEach(() => {
	_resetInterestForTests()
	client = makeClientSocket()
	serverSocket.interest = new Set()
	setInterestUser(USER)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("C2 · /narrate <text> from the composer", () => {
	test("the page declares both keys bare and wires them, and its press, to createNarrations as this test does", () => {
		// The page's own source, so the keys and bodies driven below are the page's.
		const page = readFileSync(PAGE_SOURCE, "utf8")
		expect(page).toMatch(/useInterest<"sessions:fireNarratorResponse">\(\s*"sessions:fireNarratorResponse",\s*narrations\.answered\s*\)/)
		expect(page).toMatch(/useInterest<"sessions:fireNarratorResponse:error">\(\s*"sessions:fireNarratorResponse:error",\s*narrations\.error\s*\)/)
		expect(page).toMatch(/if \(direction\) narrations\.directed\(direction, !!supplied\?\.fromDraft\)/)
		// What the page lends it: its session, its draft, the modal's unlanded press.
		const wiring = page.match(/const narrations = createNarrations\(\{([\s\S]*?)\n\t\}\)/)?.[1] ?? ""
		expect(wiring).toMatch(/sessionId: \(\) => sessionId,/)
		expect(wiring).toMatch(/draft: \(\) => newMessage,/)
		expect(wiring).toMatch(/writeDraft: \(content\) => writeDraft\(content\),/)
		expect(wiring).toMatch(/keepUnlanded: \(press\) => \(narratorUnlandedPress = press\),/)
		expect(wiring).toMatch(/send: \(params\) => socket\.emit\("sessions:fireNarratorResponse", params\)/)
		expect(page).toMatch(/unlandedPress=\{narratorUnlandedPress\}/)
	})

	test("a switch of session clears the modal's unlanded press where it clears the draft", () => {
		// The page outlives a switch of session: a press unlanded on one
		// session must not open the next session's modal with its text and
		// speaker (a side character of its own). The reset is the page's.
		const page = readFileSync(PAGE_SOURCE, "utf8")
		const reset = page.match(/\/\/ Reset state when switching sessions\n([\s\S]*?)socket\.emit\("sessions:get"/)?.[1] ?? ""
		expect(reset).toMatch(/\bwriteDraft\(""\)/)
		expect(reset).toMatch(/\bnarratorUnlandedPress = null\b/)
	})

	test("fires the narration with the argument and spends the draft at once; the landed answer keeps it spent", async () => {
		const page = await new Page("/narrate the storm breaks").open()
		try {
			expect(page.field()).toBe("/narrate the storm breaks")
			const route = await page.enter()
			expect(page.view.invoked).toEqual([{ key: NARRATE_ACTION, text: "the storm breaks" }])
			expect(route).toEqual({ route: "fire", collected: { text: "the storm breaks" } })
			// The sync went out before the fire, carrying the page's key.
			const sent = client.emits.map((e) => e.event)
			expect(sent.indexOf("interest:sync")).toBeLessThan(sent.indexOf(ANSWER))
			expect(client.emits.find((e) => e.event === ANSWER)!.payload).toEqual({
				sessionId: SESSION_ID,
				instructions: "the storm breaks"
			})
			// Spent at the press (note 31): the composer empties while the run goes.
			await page.redraw()
			expect(page.newMessage).toBe("")
			expect(page.field()).toBe("")

			await syncToServer()
			expect(isGatedEvent(ANSWER)).toBe(true)
			expect(push(ANSWER, { sessionId: SESSION_ID, success: true })).toBe(true)
			await page.redraw()
			expect(page.newMessage).toBe("")
			expect(page.field()).toBe("")
			expect(page.pending).toEqual([])
		} finally {
			await page.close()
		}
	}, 120_000)

	test("without the page's key the gate holds the refusal back, and nothing is given back", async () => {
		const page = await new Page("/narrate the storm breaks").open()
		try {
			await page.enter()
			// A tab that never synced — the server holds no key for it.
			expect(push(ANSWER, { sessionId: SESSION_ID, success: false })).toBe(false)
			await page.redraw()
			expect(page.newMessage).toBe("")
			expect(page.field()).toBe("")
		} finally {
			await page.close()
		}
	}, 120_000)

	test("refused before its run: the page says why, and the draft comes back", async () => {
		const page = await new Page("/narrate the storm breaks").open()
		try {
			await page.enter()
			await syncToServer()
			const error = "A response is already generating in this session."
			// What the handler's refusal sends: the outcome, then the sentence.
			expect(push(ANSWER, { sessionId: SESSION_ID, success: false })).toBe(true)
			expect(isGatedEvent(ERROR)).toBe(false)
			expect(push(ERROR, { sessionId: SESSION_ID, error })).toBe(true)
			await page.redraw()
			expect(page.toasts).toEqual([{ title: "Narrate", description: error }])
			expect(page.newMessage).toBe("/narrate the storm breaks")
			expect(page.field()).toBe("/narrate the storm breaks")
			expect(page.pending).toEqual([])
		} finally {
			await page.close()
		}
	}, 120_000)
})
