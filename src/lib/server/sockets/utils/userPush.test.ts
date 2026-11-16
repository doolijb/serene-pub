import { beforeEach, describe, expect, test, vi } from "vitest"

const select = vi.fn()
vi.mock("$lib/server/db", () => ({
	db: {
		select: (...a: unknown[]) => {
			select(...a)
			return {
				from: () => ({
					where: () => ({ limit: async () => [{ isAdmin: false }] })
				})
			}
		}
	}
}))

import { installUserPush, pushToUser } from "./userPush"

function fakeIo(users: Record<number, Array<{ id: string; user?: any }>>) {
	const emitted: Array<{ room: string; event: string; payload: any }> = []
	const sockets = new Map<string, any>()
	const rooms = new Map<string, Set<string>>()
	for (const [uid, list] of Object.entries(users)) {
		if (!list.length) continue
		rooms.set(`user_${uid}`, new Set(list.map((s) => s.id)))
		for (const s of list) sockets.set(s.id, s)
	}
	const io = {
		sockets: { adapter: { rooms }, sockets },
		to: (room: string) => ({
			emit: (event: string, payload: any) =>
				emitted.push({ room, event, payload })
		})
	}
	return { io: io as any, emitted }
}

const flush = () => new Promise((r) => setTimeout(r, 10))

describe("userPush", () => {
	beforeEach(() => select.mockClear())

	test("no socket in the room: no query, thunk never called", async () => {
		const { io, emitted } = fakeIo({})
		installUserPush(io)
		const thunk = vi.fn(() => ({ a: 1 }))
		pushToUser(5, "some:event", thunk)
		await flush()
		expect(select).not.toHaveBeenCalled()
		expect(thunk).not.toHaveBeenCalled()
		expect(emitted).toEqual([])
	})

	test("a connected user's admin flag comes from the socket, no query", async () => {
		const { io, emitted } = fakeIo({
			1: [{ id: "a", user: { id: 1, isAdmin: true } }]
		})
		installUserPush(io)
		pushToUser(1, "some:event", { x: 1 })
		await flush()
		expect(select).not.toHaveBeenCalled()
		expect(emitted).toEqual([
			{ room: "user_1", event: "some:event", payload: { x: 1 } }
		])
	})

	test("falls back to the query when no socket carries a user", async () => {
		const { io, emitted } = fakeIo({ 1: [{ id: "a" }] })
		installUserPush(io)
		pushToUser(1, "some:event", { x: 1 })
		await flush()
		expect(select).toHaveBeenCalledTimes(1)
		expect(emitted).toHaveLength(1)
	})

	test("pushes to one user arrive in call order; users are independent", async () => {
		const { io, emitted } = fakeIo({
			1: [{ id: "a", user: { id: 1 } }],
			2: [{ id: "b", user: { id: 2 } }]
		})
		installUserPush(io)
		let release!: () => void
		const slow = new Promise<void>((r) => (release = r))
		pushToUser(1, "e", async () => {
			await slow
			return "first"
		})
		pushToUser(1, "e", "second")
		pushToUser(2, "e", "other")
		await flush()
		// user 2 was not held up by user 1's slow payload
		expect(emitted.map((e) => e.payload)).toEqual(["other"])
		release()
		await flush()
		expect(emitted.map((e) => e.payload)).toEqual([
			"other",
			"first",
			"second"
		])
	})
})
