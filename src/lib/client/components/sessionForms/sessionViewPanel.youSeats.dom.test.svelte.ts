/**
 * Details › Cast lists under **You** the viewer's own seats only: a seat's
 * person is its `userId`, else its card's owner; a card-less seat by its name.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, socket } = vi.hoisted(() => ({
	listeners: new Map<string, (msg: any) => void>(),
	socket: { emit: vi.fn(), on: () => {}, off: () => {} }
}))

vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => listeners.delete(key)
	},
	requestWithInterest: () => () => {}
}))

import SessionViewPanel from "./SessionViewPanel.svelte"

const OWNER = 1
const GUEST = 2
const session = {
	id: 12,
	name: "The lighthouse",
	userId: OWNER,
	sessionCharacters: [
		{ character: { id: 1, name: "Wren" } },
		// A card-less character seat is the cast list's too, by its member's name.
		{ character: null, castMemberId: 31, removedAt: null },
		{ character: null, castMemberId: 32, removedAt: "2026-11-17" }
	],
	cardlessSeatShown: {
		31: { name: "Mira", nickname: null, faceMediaId: null },
		32: { name: "Left", nickname: null, faceMediaId: null }
	},
	sessionPersonas: [
		{ id: 1, userId: OWNER, persona: { id: 10, name: "Owner", userId: OWNER } },
		{ id: 2, userId: GUEST, persona: { id: 11, name: "Tobin", userId: GUEST } },
		{ id: 3, userId: GUEST, persona: null, seatName: "Wanderer" },
		{
			id: 4,
			userId: GUEST,
			removedAt: "2026-11-17",
			persona: { id: 12, name: "Gone", userId: GUEST }
		}
	],
	tags: []
}

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	document.body.innerHTML = ""
})

async function listUnder(viewer: number, title: string) {
	app = mount(SessionViewPanel, {
		target: document.body,
		context: new Map([["userCtx", { user: { id: viewer } }]]),
		props: {
			sessionId: 12,
			onOpen: () => {},
			onEdit: () => {},
			canEdit: true,
			isOwner: viewer === OWNER
		}
	})
	flushSync()
	await tick()
	for (const handler of listeners.values()) handler({ session })
	flushSync()
	await tick()
	const heading = [...document.querySelectorAll("p")].find(
		(p) => p.textContent?.trim() === title
	)
	return [...(heading?.nextElementSibling?.querySelectorAll("span.truncate") ?? [])].map(
		(s) => s.textContent?.trim()
	)
}

const youOf = (viewer: number) => listUnder(viewer, "You")

describe("Details › Cast, You", () => {
	test("Cast lists a seated card-less character by its member's name, after the carded ones", async () => {
		expect(await listUnder(OWNER, "Cast")).toEqual(["Wren", "Mira"])
	})
	test("the owner sees their own seat, not a guest's", async () => {
		expect(await youOf(OWNER)).toEqual(["Owner"])
	})
	test("a guest sees their own seats, a card-less one by its name", async () => {
		expect(await youOf(GUEST)).toEqual(["Tobin", "Wanderer"])
	})
})
