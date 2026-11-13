/**
 * `characters:page` through the real gate and the real `connectSockets`: the
 * page answers the asking socket only, a socket that did not declare the key
 * hears nothing, and refusals (never gated) reach the asker regardless.
 * Only the read module and the db handle are mocked.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const read = vi.hoisted(() => {
	class CharacterRowsRefusal extends Error {}
	return {
		CharacterRowsRefusal,
		characterRowsPage: vi.fn(async (..._args: any[]) => ({
			rows: [{ rowKey: "card:1", shownName: "Ada" }],
			nextCursor: "c2"
		}))
	}
})

vi.mock("$lib/server/cast/characterRows", () => read)
vi.mock("$lib/server/db", () => ({
	db: { stub: true },
	dbReady: Promise.resolve(),
	getCryptoSecretKey: () => "characters-page-test-secret"
}))

import { connectSockets } from "./index"
import { isGatedEvent, isScopedEvent } from "$lib/shared/sockets/interest"

const ADMIN = { id: 1, username: "owner", isAdmin: true }
const SECOND_TAB = { id: 1, username: "owner", isAdmin: true }

/** The same fake io the interest-gate tests drive `connectSockets` with. */
function harness() {
	const rooms = new Map<string, Set<string>>()
	const registry = new Map<string, any>()
	const emits: Array<{ target: string; event: string; data: any }> = []
	let onConnect: ((socket: any) => void) | null = null

	const io: any = {
		on: (event: string, cb: (socket: any) => void) => {
			if (event === "connect") onConnect = cb
		},
		to: (target: string) => ({
			emit: (event: string, data: any) =>
				emits.push({ target, event, data })
		}),
		sockets: { adapter: { rooms }, sockets: registry }
	}

	connectSockets(io)

	const live: Array<() => void> = []

	function connect(id: string, user: typeof ADMIN) {
		// A multimap: several modules hook "disconnect" on the same socket.
		const listeners = new Map<string, Array<(msg?: any) => any>>()
		const socket: any = {
			id,
			user,
			pendingSetup: [],
			io,
			emit: () => {},
			disconnect: () => {},
			join: (room: string) => {
				const members = rooms.get(room) ?? new Set<string>()
				members.add(id)
				rooms.set(room, members)
			},
			on: (event: string, cb: (msg?: any) => any) => {
				listeners.set(event, [...(listeners.get(event) ?? []), cb])
			}
		}
		registry.set(id, socket)
		onConnect!(socket)

		const disconnect = () => {
			for (const cb of listeners.get("disconnect") ?? []) void cb()
			registry.delete(id)
			rooms.get(`user_${user.id}`)?.delete(id)
		}
		live.push(disconnect)

		return {
			socket,
			fire: (event: string, msg?: any) =>
				Promise.all((listeners.get(event) ?? []).map((cb) => cb(msg))),
			declare: (...keys: string[]) =>
				Promise.all(
					(listeners.get("interest:sync") ?? []).map((cb) =>
						cb({ keys })
					)
				),
			disconnect
		}
	}

	return {
		io,
		emits,
		connect,
		teardown: () => live.splice(0).forEach((f) => f())
	}
}

/** Replace a socket's emit with a recorder. */
function listen(s: { socket: any }) {
	const got: Array<{ event: string; data: any }> = []
	s.socket.emit = (event: string, data: any) => got.push({ event, data })
	return got
}

const harnesses: Array<{ teardown: () => void }> = []
function fresh() {
	const h = harness()
	harnesses.push(h)
	return h
}

beforeEach(() => {
	read.characterRowsPage.mockClear()
})
afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
})

describe("characters:page", () => {
	test("is gated, not scoped; its :error is not gated", () => {
		expect(isGatedEvent("characters:page")).toBe(true)
		expect(isScopedEvent("characters:page")).toBe(false)
		expect(isGatedEvent("characters:page:error")).toBe(false)
	})

	test("answers the asking socket only, with its requestId", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const two = h.connect("s2", SECOND_TAB)
		await one.declare("characters:page")
		await two.declare("characters:page")
		const got1 = listen(one)
		const got2 = listen(two)
		const filters = { hasCard: true }

		await one.fire("characters:page", {
			cursor: "c1",
			limit: 10,
			filters,
			requestId: "r1"
		})

		expect(got1).toEqual([
			{
				event: "characters:page",
				data: {
					rows: [{ rowKey: "card:1", shownName: "Ada" }],
					nextCursor: "c2",
					requestId: "r1"
				}
			}
		])
		expect(got2).toEqual([])
		expect(read.characterRowsPage).toHaveBeenCalledWith({ stub: true }, 1, {
			cursor: "c1",
			limit: 10,
			filters
		})
	})

	test("a socket that did not declare the key hears nothing", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		const got = listen(one)

		await one.fire("characters:page", { requestId: "r1" })

		expect(got).toEqual([])
	})

	test("a refusal answers the asker only, even undeclared", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)
		h.connect("s2", SECOND_TAB)
		read.characterRowsPage.mockRejectedValueOnce(
			new read.CharacterRowsRefusal("That folder is not yours.")
		)

		await one.fire("characters:page", { requestId: "r9" })

		expect(h.emits).toEqual([
			{
				target: "s1",
				event: "characters:page:error",
				data: { error: "That folder is not yours.", requestId: "r9" }
			}
		])
	})

	test("a missing requestId is refused and the read never runs", async () => {
		const h = fresh()
		const one = h.connect("s1", ADMIN)

		await one.fire("characters:page", { limit: 5 })

		expect(h.emits).toEqual([
			{
				target: "s1",
				event: "characters:page:error",
				data: { error: "Couldn't load the characters." }
			}
		])
		expect(read.characterRowsPage).not.toHaveBeenCalled()
	})
})
