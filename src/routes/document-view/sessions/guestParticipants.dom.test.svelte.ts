/**
 * A guest's Edit session is the participants view (owner ruling G1,
 * 2026-11-16): the document view's openers read Participants for a non-owner,
 * and its edit route renders the participants view, not the owner's form.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
vi.mock("$env/dynamic/public", () => ({ env: {} }))
vi.mock("$app/navigation", () => ({
	replaceState: vi.fn(),
	goto: vi.fn(),
	pushState: vi.fn(),
	afterNavigate: vi.fn(),
	beforeNavigate: vi.fn(),
	onNavigate: vi.fn()
}))
vi.mock("$app/state", () => ({
	page: { url: new URL("http://localhost/"), state: {}, params: { id: "7" } }
}))

const { emitted, socket, listeners, listen } = vi.hoisted(() => {
	const emitted: Array<[string, any]> = []
	const listeners = new Map<string, (msg: any) => void>()
	return {
		emitted,
		socket: {
			emit: (event: string, payload: unknown) =>
				emitted.push([event, payload]),
			on: () => {},
			off: () => {}
		},
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	getInterestContext: () => ({
		requestWithInterest: (key: string, params: unknown, handler: any) => {
			listen(key, handler)
			emitted.push([key, params])
			return () => {}
		},
		useInterest: listen
	}),
	requestWithInterest: (key: string, params: unknown, handler: any) => {
		listen(key, handler)
		emitted.push([key, params])
		return () => {}
	}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))

import ListPage from "./+page.svelte"
import ViewPage from "./[id]/+page.svelte"
import EditPage from "./[id]/edit/+page.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	emitted.length = 0
	document.body.innerHTML = ""
})

const norm = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ")
const context = (viewerId: number) =>
	new Map<string, unknown>([
		["userCtx", { user: { id: viewerId, isAdmin: false } }],
		["systemSettingsCtx", { settings: { isAccountsEnabled: true } }]
	])

describe("the sessions list opener", () => {
	const row = (id: number, isOwner: boolean) => ({
		id,
		name: `Session ${id}`,
		canEdit: true,
		isOwner,
		isGuest: !isOwner,
		sessionCharacters: [],
		sessionPersonas: []
	})

	test("reads Edit for the owner and Participants for a guest", async () => {
		app = mount(ListPage, { target: document.body, context: context(1) })
		flushSync()
		listeners.get("sessions:list")!({
			sessionList: [row(1, true), row(2, false)]
		})
		await tick()
		flushSync()
		const links = (id: number) =>
			[...document.querySelectorAll(`a[href="/document-view/sessions/${id}/edit"]`)].map(
				(a) => norm(a.textContent).trim()
			)
		expect(links(1)).toEqual(["Edit"])
		expect(links(2)).toEqual(["Participants"])
	})
})

describe("the document view's edit route", () => {
	async function open(viewerId: number) {
		app = mount(EditPage, { target: document.body, context: context(viewerId) })
		flushSync()
		const msg = {
			session: {
				id: 7,
				userId: 1,
				name: "The crawl",
				scenario: "A long stair",
				genreId: "test:genre/crawl@1",
				genreFields: {},
				metadata: {},
				sessionCharacters: [],
				sessionPersonas: [],
				sessionGuests: [{ userId: 2, user: { id: 2, username: "guesty" } }],
				tags: []
			}
		}
		listeners.get("sessions:get#7")!(msg)
		await tick()
		flushSync()
		// A guest's form declares its own interest on the same key.
		listeners.get("sessions:get#7")!(msg)
		await tick()
		flushSync()
	}

	test("a guest gets the participants view: a Participants heading, no Session name field, nothing disabled", async () => {
		await open(2)
		expect(document.querySelector("h1")?.textContent?.trim()).toBe("Participants")
		expect(document.getElementById("a11y-session-name")).toBeNull()
		expect(document.querySelector("form input[disabled]")).toBeNull()
		expect(
			document.getElementById("session-panel-participants")?.getAttribute("aria-label")
		).toBe("Participants")
	})

	test("the owner keeps the whole form", async () => {
		await open(1)
		expect(document.querySelector("h1")?.textContent?.trim()).toBe("Edit session")
		expect(document.getElementById("a11y-session-name")).not.toBeNull()
	})
})

describe("the session page's opener", () => {
	test.each([
		[1, "Edit session"],
		[2, "Participants"]
	])("viewer %i sees %s", async (viewerId, words) => {
		app = mount(ViewPage, { target: document.body, context: context(viewerId) })
		flushSync()
		listeners.get("sessions:get#7")!({
			session: {
				id: 7,
				userId: 1,
				name: "The crawl",
				metadata: {},
				sessionMessages: [],
				sessionCharacters: [],
				sessionPersonas: [],
				sessionGuests: [],
				tags: []
			}
		})
		await tick()
		flushSync()
		const link = document.querySelector('a[href="/document-view/sessions/7/edit"]')
		expect(norm(link?.textContent).trim()).toBe(words)
	})
})
