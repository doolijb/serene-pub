/**
 * The interest gate where it actually lives: `sockets/index.ts`'s `emitToUser`
 * and `utils/broadcastHelpers.ts`, driven through the real `connectSockets`.
 *
 * `GATED_EVENTS` is empty in phase 1 — that is what makes the migration free of
 * a dark period — so these tests mock the shared module to gate two invented
 * events and leave the real set alone. `./language` is mocked as well, purely
 * as a seam: it is the smallest registration function in the application (one
 * handler, no side effects), so standing in for it is the cheapest way to get
 * hold of the `emitToUser` a real handler would be handed, and to register
 * handlers of our own through the real `register`.
 *
 * Two hazards are pinned here.
 *
 * **Auth boundary.** A gated event is delivered per socket, and each copy is
 * redacted from the RECIPIENT's `socket.user` — the rule a read-shaped surface
 * once escaped (`connections/visibility.ts`). A payload carrying connection
 * identity reaches a non-admin without it and an administrator with it, on the
 * same code path.
 *
 * **Ordering.** There are no acks: the client syncs, then requests, on one
 * ordered connection, and the server's sync handler stores the set with nothing
 * awaited ahead of it. The last test fires both listeners back to back without
 * awaiting between them and asserts the reply was already delivered — which is
 * false the moment anybody puts an `await` in front of that assignment.
 */
import { afterEach, describe, expect, test, vi } from "vitest"

const GATED_PUSH = "gated:push"
const GATED_REQUEST = "gated:request"
const GATED_BOOM = "gated:boom"
/** Gated AND scoped — the phase-3 shape, invented here like the rest. */
const GATED_SCOPED = "gated:scoped"
const UNGATED_PUSH = "ungated:push"
const GENERIC_ERROR = "An error occurred while processing your request."

const seam = vi.hoisted(() => {
	/** `gated:boom:error` is gated ON PURPOSE — see the `:error` test. */
	const GATED_EVENTS = new Set([
		"gated:push",
		"gated:boom",
		"gated:boom:error",
		"gated:scoped"
	])
	/** The invented event's scope, in the shape the real table's entries take. */
	const SCOPED_EVENTS = new Map<string, (payload: any) => unknown>([
		["gated:scoped", (payload: any) => payload?.sessionId]
	])
	/** Each connected socket's own `emitToUser`, by socket id. */
	const emitters = new Map<string, (event: string, data: any) => any>()
	const handlers = [
		{
			event: "gated:request",
			handler: async (_socket: any, params: any, emitToUser: any) => {
				emitToUser("gated:push", params?.data ?? { ok: true })
			}
		},
		{
			event: "gated:boom",
			handler: async () => {
				throw new Error("boom")
			}
		}
	]
	return { GATED_EVENTS, SCOPED_EVENTS, emitters, handlers }
})

vi.mock("$lib/shared/sockets/interest", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("$lib/shared/sockets/interest")>()
	return {
		...actual,
		GATED_EVENTS: seam.GATED_EVENTS,
		isGatedEvent: (event: string) => seam.GATED_EVENTS.has(event),
		SCOPED_EVENTS: seam.SCOPED_EVENTS,
		isScopedEvent: (event: string) =>
			seam.SCOPED_EVENTS.has(event) || actual.isScopedEvent(event),
		// The invented event's scope, falling through to the real table for
		// every event the application actually has one for.
		scopeOfPayload: (event: string, payload: any) => {
			const extract = seam.SCOPED_EVENTS.get(event)
			if (!extract) return actual.scopeOfPayload(event, payload)
			const raw = extract(payload)
			return raw == null ? null : String(raw)
		}
	}
})

vi.mock("./language", () => ({
	registerLanguageHandlers: (
		socket: any,
		emitToUser: (event: string, data: any) => any,
		register: (socket: any, handler: any, emit: any) => void
	) => {
		seam.emitters.set(socket.id, emitToUser)
		for (const handler of seam.handlers)
			register(socket, handler, emitToUser)
	}
}))

import { connectSockets } from "./index"
import { emitToUserRedacted } from "./utils/broadcastHelpers"

const NON_ADMIN = { id: 2, username: "reader", isAdmin: false }
const ADMIN = { id: 3, username: "owner", isAdmin: true }

/** A payload that names a connection, in the shape a receipt carries one. */
const NAMES_A_CONNECTION = {
	message: "the run finished",
	connection: { id: 987654, name: "Basement Rig" }
}

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

	function connect(id: string, user: typeof NON_ADMIN) {
		// A multimap, because several modules hook "disconnect" on the same
		// socket and a Map keyed by event would quietly keep only the last.
		const listeners = new Map<string, Array<(msg?: any) => any>>()
		const socket: any = {
			id,
			user,
			pendingSetup: [],
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

		const fireSync = (event: string, msg?: any) => {
			for (const cb of listeners.get(event) ?? []) void cb(msg)
		}
		const disconnect = () => {
			fireSync("disconnect")
			registry.delete(id)
			rooms.get(`user_${user.id}`)?.delete(id)
		}
		live.push(disconnect)

		return {
			socket,
			/** The `emitToUser` this socket's handlers were handed. */
			emitToUser: seam.emitters.get(id)!,
			fire: (event: string, msg?: any) =>
				Promise.all((listeners.get(event) ?? []).map((cb) => cb(msg))),
			/** Invoked WITHOUT awaiting — what the ordering test needs. */
			fireSync,
			disconnect
		}
	}

	return {
		io,
		emits,
		connect,
		/**
		 * Several registration functions hook module singletons (the activity
		 * store, the task queue) and release them on disconnect. A socket left
		 * connected would fan the next test's broadcasts out to it.
		 */
		teardown: () => live.splice(0).forEach((off) => off())
	}
}

const harnesses: Array<{ teardown: () => void }> = []
function fresh() {
	const h = harness()
	harnesses.push(h)
	return h
}

const logged = vi.spyOn(console, "error").mockImplementation(() => {})
afterEach(() => {
	harnesses.splice(0).forEach((h) => h.teardown())
	seam.emitters.clear()
	logged.mockClear()
})

describe("a gated event", () => {
	test("runs no thunk and emits nothing when nobody declared it", () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)
		const thunk = vi.fn(async () => ({ rows: [1, 2, 3] }))

		// Skipping the emit alone would save nothing — the query is the cost,
		// which is the whole reason for the lazy form.
		const returned = client.emitToUser(GATED_PUSH, thunk)

		expect(thunk).not.toHaveBeenCalled()
		expect(h.emits).toEqual([])
		expect(returned).toBeUndefined()
	})

	test("reaches only the socket that declared it, not the whole room", async () => {
		const h = fresh()
		const listening = h.connect("s1", NON_ADMIN)
		const other = h.connect("s2", NON_ADMIN)

		await listening.fire("interest:sync", { keys: [GATED_PUSH] })

		// Emitted through the OTHER socket's helper: delivery follows who
		// declared the key, never who happened to trigger the cascade.
		other.emitToUser(GATED_PUSH, { rows: [1] })

		expect(h.emits).toEqual([
			{ target: "s1", event: GATED_PUSH, data: { rows: [1] } }
		])
	})

	test("is redacted for the non-admin who receives it", async () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)
		await client.fire("interest:sync", { keys: [GATED_PUSH] })

		client.emitToUser(GATED_PUSH, NAMES_A_CONNECTION)

		expect(h.emits).toHaveLength(1)
		const data = h.emits[0].data
		expect(data).not.toHaveProperty("connection")
		expect(JSON.stringify(data)).not.toContain("Basement Rig")
		// A redaction, not a blank: the rest of the payload survives.
		expect(data.message).toBe("the run finished")
	})

	test("still names the connection to an administrator", async () => {
		const h = fresh()
		const client = h.connect("s3", ADMIN)
		await client.fire("interest:sync", { keys: [GATED_PUSH] })

		client.emitToUser(GATED_PUSH, NAMES_A_CONNECTION)

		expect(h.emits[0].data.connection).toMatchObject({
			name: "Basement Rig"
		})
	})

	test("evaluates its thunk once, however many sockets want it", async () => {
		const h = fresh()
		const one = h.connect("s1", NON_ADMIN)
		const two = h.connect("s2", NON_ADMIN)
		await one.fire("interest:sync", { keys: [GATED_PUSH] })
		await two.fire("interest:sync", { keys: [GATED_PUSH] })

		const thunk = vi.fn(async () => ({ rows: [1] }))
		await one.emitToUser(GATED_PUSH, thunk)

		expect(thunk).toHaveBeenCalledTimes(1)
		expect(h.emits.map((e) => e.target)).toEqual(["s1", "s2"])
	})
})

describe("a gated, scoped event", () => {
	test("plain data reaches the socket that declared that scope and no other", async () => {
		const h = fresh()
		const watching = h.connect("s1", NON_ADMIN)
		const elsewhere = h.connect("s2", NON_ADMIN)
		await watching.fire("interest:sync", { keys: [`${GATED_SCOPED}#42`] })
		await elsewhere.fire("interest:sync", { keys: [`${GATED_SCOPED}#9`] })

		// Two tabs of ONE user, which is the case a room emit cannot narrow:
		// per-socket delivery is what makes the scope mean anything here.
		watching.emitToUser(GATED_SCOPED, { sessionId: 42, rows: [1] })

		expect(h.emits.map((e) => e.target)).toEqual(["s1"])
	})

	test("a bare declaration still takes every scope", async () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)
		await client.fire("interest:sync", { keys: [GATED_SCOPED] })

		client.emitToUser(GATED_SCOPED, { sessionId: 42 })
		client.emitToUser(GATED_SCOPED, { sessionId: 9 })

		expect(h.emits.map((e) => e.data.sessionId)).toEqual([42, 9])
	})

	test("runs no thunk when nobody wants any scope of it", async () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)
		await client.fire("interest:sync", { keys: ["something:else"] })
		const thunk = vi.fn(async () => ({ sessionId: 42 }))

		await client.emitToUser(GATED_SCOPED, thunk)

		// The scope is not knowable before the query has run, so the gate asks
		// the weaker question — and the query is still skipped.
		expect(thunk).not.toHaveBeenCalled()
		expect(h.emits).toEqual([])
	})

	test("runs the thunk once for a socket that wants ONE scope", async () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)
		await client.fire("interest:sync", { keys: [`${GATED_SCOPED}#42`] })
		const thunk = vi.fn(async () => ({ sessionId: 42, rows: [1] }))

		await client.emitToUser(GATED_SCOPED, thunk)

		expect(thunk).toHaveBeenCalledTimes(1)
		expect(h.emits).toEqual([
			{
				target: "s1",
				event: GATED_SCOPED,
				data: { sessionId: 42, rows: [1] }
			}
		])
	})

	test("and delivers to nobody when what it built belongs to another scope", async () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)
		await client.fire("interest:sync", { keys: [`${GATED_SCOPED}#42`] })
		const thunk = vi.fn(async () => ({ sessionId: 9 }))

		await client.emitToUser(GATED_SCOPED, thunk)

		// The pre-check is a narrowing, never a promise: the exact scope is read
		// off the payload, and this socket asked for a different session.
		expect(thunk).toHaveBeenCalledTimes(1)
		expect(h.emits).toEqual([])
	})
})

describe("an ungated event", () => {
	test("is the room emit it has always been, synchronously", () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)

		// No interest declared, and none needed: everything outside
		// GATED_EVENTS keeps today's behaviour exactly. The assertion is made
		// before any await on purpose — the ~874 existing call sites do not
		// await this.
		const returned = client.emitToUser(UNGATED_PUSH, { rows: [1] })

		expect(returned).toBeUndefined()
		expect(h.emits).toEqual([
			{ target: "user_2", event: UNGATED_PUSH, data: { rows: [1] } }
		])
	})

	test("still evaluates a thunk, and redacts what it produced", async () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)
		const thunk = vi.fn(async () => NAMES_A_CONNECTION)

		await client.emitToUser(UNGATED_PUSH, thunk)

		expect(thunk).toHaveBeenCalledTimes(1)
		expect(h.emits).toHaveLength(1)
		expect(h.emits[0].target).toBe("user_2")
		expect(h.emits[0].data).not.toHaveProperty("connection")
	})
})

describe("a thunk that rejects", () => {
	test("is logged and emits nothing, rather than becoming an unhandled rejection", async () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)

		await expect(
			client.emitToUser(UNGATED_PUSH, async () => {
				throw new Error("the query failed")
			})
		).resolves.toBeUndefined()

		expect(h.emits).toEqual([])
		expect(logged).toHaveBeenCalledTimes(1)
		expect(logged.mock.calls[0].join(" ")).toContain(UNGATED_PUSH)
	})

	test("does the same on the gated path", async () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)
		await client.fire("interest:sync", { keys: [GATED_PUSH] })

		await expect(
			client.emitToUser(GATED_PUSH, async () => {
				throw new Error("the query failed")
			})
		).resolves.toBeUndefined()

		expect(h.emits).toEqual([])
		expect(logged).toHaveBeenCalledTimes(1)
	})
})

describe("the generic {event}:error fallback", () => {
	test("reaches the room even when its own event is gated and unwanted", async () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)

		// Nothing is declared, and `gated:boom:error` is in this test's gated
		// set — so if the fallback went through the gate it would be silence,
		// which is the one failure a client waiting on a request cannot
		// recover from.
		await client.fire(GATED_BOOM, {})

		expect(h.emits).toEqual([
			{
				target: "user_2",
				event: `${GATED_BOOM}:error`,
				data: { error: GENERIC_ERROR }
			}
		])
	})
})

describe("ordering", () => {
	test("a sync and the request behind it need no ack", () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)

		// Exactly what Socket.IO does with two packets on one connection:
		// deliver the first listener, then the second, with nothing awaited in
		// between. `register` runs its gates synchronously and a call proceeds
		// synchronously into the handler, so the set is stored before the
		// request's handler emits — the whole reason there is no ack protocol.
		client.fireSync("interest:sync", { keys: [GATED_PUSH] })
		client.fireSync(GATED_REQUEST, { data: { rows: [7] } })

		expect(h.emits).toEqual([
			{ target: "s1", event: GATED_PUSH, data: { rows: [7] } }
		])
	})

	test("without the sync, that same request reaches nobody", () => {
		// The negative half: the test above would pass on a broken gate that
		// simply emitted to everyone.
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)

		client.fireSync(GATED_REQUEST, { data: { rows: [7] } })

		expect(h.emits).toEqual([])
	})
})

describe("broadcastHelpers", () => {
	test("skips a recipient with no interest and delivers to one with it", async () => {
		const h = fresh()
		const client = h.connect("s1", NON_ADMIN)
		await client.fire("interest:sync", { keys: [GATED_PUSH] })

		// To the SOCKET that declared it, not to the user's room (ruling 5) —
		// the same rule the per-socket emit above follows, applied to the
		// broadcast helpers as well.
		await emitToUserRedacted(h.io, NON_ADMIN.id, GATED_PUSH, { rows: [1] })
		expect(h.emits).toEqual([
			{ target: "s1", event: GATED_PUSH, data: { rows: [1] } }
		])

		// Somebody else's room, nobody in it: the fan-out's own gate, applied
		// per recipient because a user id is the only unit this helper has.
		h.emits.length = 0
		await emitToUserRedacted(h.io, 77, GATED_PUSH, { rows: [1] })
		expect(h.emits).toEqual([])
	})

	test("leaves an ungated broadcast exactly as it was", async () => {
		const h = fresh()
		await emitToUserRedacted(h.io, 77, UNGATED_PUSH, { rows: [1] })
		expect(h.emits).toEqual([
			{ target: "user_77", event: UNGATED_PUSH, data: { rows: [1] } }
		])
	})
})
