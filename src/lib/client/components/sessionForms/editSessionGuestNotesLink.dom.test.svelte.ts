/**
 * 🚧 The *Open … in the lorebook* link under a brought-back seat (G2): a guest
 * has none to the session's notes; an attached lorebook's link stays.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, emitted, socket } = vi.hoisted(() => {
	const listeners = new Map<string, Array<(msg: any) => void>>()
	const emitted: Array<[string, any]> = []
	return {
		listeners,
		emitted,
		socket: {
			emit: (event: string, data: any) => {
				emitted.push([event, data])
			},
			on: () => {},
			off: () => {}
		}
	}
})

vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () => {
			const rest = (listeners.get(key) ?? []).filter((h) => h !== handler)
			if (rest.length) listeners.set(key, rest)
			else listeners.delete(key)
		}
	}
	return {
		declareInterest,
		useInterest: (key: string, handler: (msg: any) => void) =>
			declareInterest(key, handler),
		requestWithInterest: (
			event: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			socket.emit(event, params)
			return declareInterest(event, handler)
		}
	}
})

import EditSessionForm from "./EditSessionForm.svelte"

beforeAll(async () => {
	await import("../modals/CharacterSelectList.svelte")
})

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	emitted.length = 0
	document.body.innerHTML = ""
})

function deliver(key: string, msg: unknown) {
	const handlers = listeners.get(key)
	if (!handlers) throw new Error(`nothing listens on ${key}; have: ${[...listeners.keys()].join(", ")}`)
	for (const handler of handlers) handler(msg)
	flushSync()
}

const GENRE = "test:genre/crawl@1"

/** Session 7 is user 1's; Bryn (the viewer's own card, user 2's) fell and sits on the bench. */
async function openForm(viewerId: number, lorebookId: number | null) {
	app = mount(EditSessionForm, {
		target: document.body,
		props: { editSessionId: 7, showEditSessionForm: true },
		context: new Map<string, unknown>([
			["userCtx", { user: { id: viewerId, isAdmin: false } }],
			["systemSettingsCtx", { settings: { isAccountsEnabled: true } }]
		])
	})
	flushSync()
	deliver("sessions:genres", {
		genres: [{ genreId: GENRE, shape: { characters: { min: 0 }, personas: { min: 0 } } }]
	})
	deliver("sessions:get#7", {
		session: {
			id: 7,
			userId: 1,
			name: "The crawl",
			scenario: "",
			genreId: GENRE,
			genreFields: {},
			lorebookId,
			ownBookId: 8,
			sessionCharacters: [
				{
					id: 22,
					characterId: 4,
					character: { id: 4, name: "Bryn", userId: 2 },
					castMemberId: 9,
					isActive: false,
					fellInStory: true,
					removedAt: null
				}
			],
			sessionPersonas: [],
			sessionGuests: [],
			tags: []
		}
	})
	await tick()
	flushSync()
}

async function bringBackBryn() {
	const b = document.querySelector('button[aria-label="Bring back Bryn"]') as HTMLButtonElement | null
	expect(b === null).toBe(false)
	b!.click()
	flushSync()
	await tick()
	expect((document.body.textContent ?? "").replace(/\s+/g, " ")).toContain("They come back as they are")
}
const link = () =>
	[...document.querySelectorAll("a")].find((a) => a.textContent?.trim() === "Open Bryn in the lorebook")

describe("Edit Session — the cast-member link of a brought-back seat", () => {
	test("the owner on the session's notes: the link opens the notes", async () => {
		await openForm(1, null)
		await bringBackBryn()
		expect(link()?.getAttribute("href") ?? "").toContain("lore=8")
	})

	test("a guest on the session's notes: no link, the sentence stays", async () => {
		await openForm(2, null)
		await bringBackBryn()
		expect(link()).toBeUndefined()
	})

	test("a guest on an attached lorebook: the link stays", async () => {
		await openForm(2, 5)
		await bringBackBryn()
		expect(link()?.getAttribute("href") ?? "").toContain("lore=5")
	})
})
