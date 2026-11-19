/**
 * The document view's speak-as list is the viewer's seats: a seat's person is
 * its `userId`, else its card's owner (lane gs-3a3a), so the session owner's
 * card seated for a guest is the guest's to speak as.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))
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

const { socket, listeners, listen } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	return {
		socket: { emit: () => {}, on: () => {}, off: () => {} },
		listeners,
		listen: (key: string, handler: (msg: any) => void) => {
			listeners.set(key, handler)
			return () => {
				if (listeners.get(key) === handler) listeners.delete(key)
			}
		}
	}
})
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: listen,
	useInterest: listen,
	requestWithInterest: () => () => {}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: () => {}, info: () => {}, success: () => {} }
}))

import ViewPage from "./[id]/+page.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	document.body.innerHTML = ""
})

describe("Speaking as", () => {
	test("lists the viewer's own seats by the seat's person, not only by card owner", async () => {
		app = mount(ViewPage, {
			target: document.body,
			context: new Map<string, unknown>([
				["userCtx", { user: { id: 2, isAdmin: false } }],
				["systemSettingsCtx", { settings: { isAccountsEnabled: true } }]
			])
		})
		flushSync()
		listeners.get("sessions:get#7")!({
			session: {
				id: 7,
				userId: 1,
				name: "The crawl",
				sessionMessages: [],
				sessionCharacters: [],
				sessionPersonas: [
					// The owner's card, seated for the guest.
					{ id: 1, personaId: 10, userId: 2, persona: { id: 10, name: "Orla", userId: 1 } },
					// The guest's own card.
					{ id: 2, personaId: 11, userId: 2, persona: { id: 11, name: "Tobin", userId: 2 } },
					// The owner's own seat: not the guest's.
					{ id: 3, personaId: 12, userId: 1, persona: { id: 12, name: "Dm", userId: 1 } },
					// A row from before `user_id`: its card's owner.
					{ id: 4, personaId: 13, userId: null, persona: { id: 13, name: "Old", userId: 2 } }
				],
				tags: []
			},
			pagination: { total: 0, hasMore: false }
		})
		await tick()
		flushSync()
		const options = [
			...document.querySelectorAll("#a11y-session-speaking-as option")
		].map((o) => o.textContent?.trim())
		expect(options).toEqual(["Orla", "Tobin", "Old"])
	})
})
