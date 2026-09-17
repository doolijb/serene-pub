/**
 * The interest registry (socket-interest plan, phase 1).
 *
 * Everything asserted here is a property the rest of the migration rests on,
 * and every one of them fails silently if it regresses:
 *
 *   1. **One raw listener per EVENT NAME.** The whole point of the registry is
 *      that a hundred views wanting `sessions:typing` cost one socket listener
 *      and one dispatch, not a hundred of each.
 *   2. **Release is exact and idempotent.** The last release must `off` with
 *      the SAME function reference — `off(event)` with no handler removes every
 *      listener for that event app-wide — and a second call must do nothing, or
 *      an unmount path that also runs on error revokes somebody else's later
 *      interest.
 *   3. **Restricted interest is refused for a non-admin** (ruling 6a): nothing
 *      listened for, nothing sent — and, while the user is still UNKNOWN, held
 *      rather than refused: both shells declare their standing keys at
 *      component init, which runs before `users:current` arrives, so a registry
 *      that read "unknown" as "non-admin" would refuse an admin's key
 *      permanently and leave the panel behind it dark forever.
 *   4. **The sync precedes the request** in `requestWithInterest` (ruling 3).
 *      That ordering is why the design needs no acks: the server's set already
 *      holds the key when the handler answers.
 *   4b. **Every typed `emit` flushes a pending sync first** — the same ordering,
 *      guaranteed by the transport instead of by each call site, so a view that
 *      declares interest and asks for the data in one flush is correct without
 *      remembering anything. It must stay free when nothing is pending: a
 *      fire-and-forget command must not send an interest packet.
 *   5. **A missing socket is survivable.** The registry outlives the socket's
 *      absence and catches up on connect; a reconnect resyncs the whole set.
 *
 * `environment: "node"` (vitest.config.ts) — the registry touches no DOM.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { INTEREST_SYNC_INTERVAL_MS } from "$lib/shared/sockets/interest"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("./socketInstance", () => ({ getSocket: () => socket }))

import {
	_resetInterestForTests,
	declareInterest,
	flushInterestSync,
	requestWithInterest,
	resyncOnConnect,
	setInterestUser,
	syncInterest
} from "./interest.svelte"
import { createTypedSocket } from "./typedSocket"

type Listener = (payload: any) => void

function makeSocket(connected = true) {
	const listeners = new Map<string, Listener[]>()
	return {
		connected,
		/** Every `emit` the registry made, in order. */
		emits: [] as Array<{ event: string; payload: any }>,
		/** Every `on` the registry made, in order. */
		ons: [] as Array<{ event: string; fn: Listener }>,
		/** Every `off` the registry made, in order. */
		offs: [] as Array<{ event: string; fn: Listener }>,
		listeners,
		on(event: string, fn: Listener) {
			this.ons.push({ event, fn })
			const arr = listeners.get(event) ?? []
			arr.push(fn)
			listeners.set(event, arr)
		},
		off(event: string, fn: Listener) {
			this.offs.push({ event, fn })
			const arr = listeners.get(event)
			if (!arr) return
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
			if (arr.length === 0) listeners.delete(event)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		/** The server pushing an event down this socket. */
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		},
		listenerCount(event: string) {
			return (listeners.get(event) ?? []).length
		}
	}
}

let socket: ReturnType<typeof makeSocket> | null = null

/** Lets the microtask-debounced eager sync run. */
const settle = () => Promise.resolve()

/** Every interest sync packet sent so far, newest last. */
function syncs() {
	return (socket?.emits ?? []).filter((e) => e.event === "interest:sync")
}

/** The key list of the most recent sync, or null if none was sent. */
function lastSyncKeys(): string[] | null {
	const all = syncs()
	return all.length === 0 ? null : all[all.length - 1].payload.keys
}

beforeEach(() => {
	_resetInterestForTests()
	socket = makeSocket()
	setInterestUser({ id: 1, isAdmin: false })
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe("one raw listener per event", () => {
	test("two declares on one key install one listener and both are called", async () => {
		const seen: string[] = []
		declareInterest<"characters:list">("characters:list", () =>
			seen.push("a")
		)
		declareInterest<"characters:list">("characters:list", () =>
			seen.push("b")
		)

		expect(socket!.ons).toHaveLength(1)
		expect(socket!.ons[0].event).toBe("characters:list")

		socket!.dispatch("characters:list", { characters: [] })
		expect(seen).toEqual(["a", "b"])
	})

	test("a scoped key and its bare key share the event's one listener", () => {
		declareInterest<"sessions:typing">("sessions:typing", () => {})
		declareInterest<"sessions:typing">("sessions:typing#42", () => {})

		expect(socket!.ons).toHaveLength(1)
		expect(socket!.listenerCount("sessions:typing")).toBe(1)
	})
})

describe("release", () => {
	test("keeps the listener while another subscriber holds the key", () => {
		const releaseA = declareInterest<"characters:list">(
			"characters:list",
			() => {}
		)
		declareInterest<"characters:list">("characters:list", () => {})

		releaseA()
		expect(socket!.offs).toHaveLength(0)
		expect(socket!.listenerCount("characters:list")).toBe(1)
	})

	test("the last one offs with the SAME reference and drops the key", async () => {
		const releaseA = declareInterest<"characters:list">(
			"characters:list",
			() => {}
		)
		const releaseB = declareInterest<"characters:list">(
			"characters:list",
			() => {}
		)
		await settle()
		expect(lastSyncKeys()).toEqual(["characters:list"])

		releaseA()
		releaseB()

		expect(socket!.offs).toHaveLength(1)
		// The reference identity is the whole assertion: `off(event)` with no
		// handler would remove every listener for the event app-wide.
		expect(socket!.offs[0].fn).toBe(socket!.ons[0].fn)
		expect(socket!.listenerCount("characters:list")).toBe(0)

		await settle()
		expect(lastSyncKeys()).toEqual([])
	})

	test("is idempotent", () => {
		const release = declareInterest<"characters:list">(
			"characters:list",
			() => {}
		)
		const other = declareInterest<"characters:list">(
			"characters:list",
			() => {}
		)

		release()
		release()
		release()

		// The second and third calls must not have touched `other`'s interest.
		expect(socket!.offs).toHaveLength(0)
		expect(socket!.listenerCount("characters:list")).toBe(1)
		other()
		expect(socket!.offs).toHaveLength(1)
	})
})

describe("restricted interest", () => {
	test("a non-admin is refused: nothing listened for, nothing sent", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const handler = vi.fn()

		const release = declareInterest<"backups:list">("backups:list", handler)
		await settle()

		expect(socket!.ons).toHaveLength(0)
		expect(syncs()).toHaveLength(0)
		expect(warn).toHaveBeenCalledOnce()

		// The no-op release must be safe to call, twice.
		release()
		release()
		expect(socket!.offs).toHaveLength(0)
	})

	test("the same key works for an admin", async () => {
		setInterestUser({ id: 1, isAdmin: true })
		const handler = vi.fn()

		declareInterest<"backups:list">("backups:list", handler)
		await settle()

		expect(socket!.ons).toHaveLength(1)
		expect(lastSyncKeys()).toEqual(["backups:list"])

		socket!.dispatch("backups:list", { backups: [] })
		expect(handler).toHaveBeenCalledOnce()
	})

	test("requestWithInterest sends neither the sync nor the request", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {})

		requestWithInterest("backups:list", {} as any, () => {})

		expect(socket!.emits).toEqual([])
	})
})

describe("held restricted interest", () => {
	/**
	 * The shells declare `taskQueue:update` (and the rest of their standing
	 * keys) at component init — before `users:current` has told anyone who this
	 * is. "Unknown" is not "non-admin": the key is held locally and kept off
	 * every sync until `setInterestUser` answers the question.
	 */
	beforeEach(() => {
		setInterestUser(null)
	})

	/** True while no sync packet has ever named the key. */
	function neverSent(key: string) {
		return syncs().every((e) => !e.payload.keys.includes(key))
	}

	test("is kept out of the sync while unknown, and sent once the user is an admin", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const handler = vi.fn()

		declareInterest<"taskQueue:update">("taskQueue:update", handler)
		await settle()

		expect(lastSyncKeys()).toEqual([])
		// Holding is not refusing — nothing to warn about yet.
		expect(warn).not.toHaveBeenCalled()

		setInterestUser({ id: 1, isAdmin: true })
		await settle()

		expect(lastSyncKeys()).toEqual(["taskQueue:update"])
		socket!.dispatch("taskQueue:update", { tasks: [] })
		expect(handler).toHaveBeenCalledOnce()
		expect(warn).not.toHaveBeenCalled()
	})

	test("is dropped, warning once, when the user turns out not to be an admin", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const handler = vi.fn()

		const release = declareInterest<"taskQueue:update">(
			"taskQueue:update",
			handler
		)
		await settle()

		setInterestUser({ id: 1, isAdmin: false })
		await settle()

		expect(neverSent("taskQueue:update")).toBe(true)
		expect(warn).toHaveBeenCalledOnce()

		socket!.dispatch("taskQueue:update", { tasks: [] })
		expect(handler).not.toHaveBeenCalled()

		// The release the caller is still holding is now a no-op — it must not
		// `off` a listener the drop already removed, nor anyone else's.
		const offs = socket!.offs.length
		release()
		release()
		expect(socket!.offs).toHaveLength(offs)
		expect(warn).toHaveBeenCalledOnce()
	})

	test("released while held, it is not sent when the user turns out to be an admin", async () => {
		const handler = vi.fn()

		const release = declareInterest<"taskQueue:update">(
			"taskQueue:update",
			handler
		)
		release()
		await settle()

		setInterestUser({ id: 1, isAdmin: true })
		await settle()

		expect(neverSent("taskQueue:update")).toBe(true)
		socket!.dispatch("taskQueue:update", { tasks: [] })
		expect(handler).not.toHaveBeenCalled()
	})

	test("a key that is not restricted is sent at once, user known or not", async () => {
		const handler = vi.fn()

		declareInterest<"characters:list">("characters:list", handler)
		await settle()

		expect(lastSyncKeys()).toEqual(["characters:list"])
		socket!.dispatch("characters:list", { characters: [] })
		expect(handler).toHaveBeenCalledOnce()
	})

	test("a logout re-holds an admin's restricted key instead of leaving it sent", async () => {
		setInterestUser({ id: 1, isAdmin: true })
		declareInterest<"taskQueue:update">("taskQueue:update", () => {})
		declareInterest<"characters:list">("characters:list", () => {})
		await settle()
		expect(lastSyncKeys()).toEqual(["taskQueue:update", "characters:list"])

		setInterestUser(null)
		await settle()

		// The sync that omits it is what takes it out of the server's set.
		expect(lastSyncKeys()).toEqual(["characters:list"])
	})
})

describe("interest sync", () => {
	test("coalesces a tick's declares into one packet naming both keys", async () => {
		declareInterest<"characters:list">("characters:list", () => {})
		declareInterest<"characterFolders:list">(
			"characterFolders:list",
			() => {}
		)

		// Nothing yet — the debounce is what stops a screen mounting twenty
		// widgets from sending twenty packets.
		expect(syncs()).toHaveLength(0)

		await settle()

		expect(syncs()).toHaveLength(1)
		expect(lastSyncKeys()).toEqual([
			"characters:list",
			"characterFolders:list"
		])
	})

	test("is skipped while the socket is disconnected", async () => {
		socket!.connected = false
		declareInterest<"characters:list">("characters:list", () => {})
		await settle()
		expect(syncs()).toHaveLength(0)
	})

	test("is buffered ahead of a request made before connect", async () => {
		// socket.io queues every emit made before `connect` and sends the
		// queue in order, then fires the connect event — so a request that
		// beats the connect resync would reach the gate before its key. The
		// flush a typed emit performs must therefore queue the sync too,
		// in front of the request, even while the socket is not connected.
		socket!.connected = false
		declareInterest<"characters:list">("characters:list", () => {})
		flushInterestSync()
		expect(syncs()).toHaveLength(1)
		expect(lastSyncKeys()).toEqual(["characters:list"])
		// The microtask that was queued finds nothing left to send.
		await settle()
		expect(syncs()).toHaveLength(1)
	})

	test("resyncOnConnect sends the full set", async () => {
		declareInterest<"characters:list">("characters:list", () => {})
		declareInterest<"sessions:typing">("sessions:typing#42", () => {})
		await settle()
		socket!.emits.length = 0

		resyncOnConnect()

		expect(syncs()).toHaveLength(1)
		expect(lastSyncKeys()).toEqual([
			"characters:list",
			"sessions:typing#42"
		])
	})

	test("the periodic sync fires, and stops once nothing is held", () => {
		vi.useFakeTimers()

		const release = declareInterest<"characters:list">(
			"characters:list",
			() => {}
		)
		// Clears whatever the eager debounce did, whether or not this runner
		// fakes queueMicrotask — the assertion below is about the interval.
		vi.advanceTimersByTime(0)
		socket!.emits.length = 0

		vi.advanceTimersByTime(INTEREST_SYNC_INTERVAL_MS)
		expect(syncs()).toHaveLength(1)

		vi.advanceTimersByTime(INTEREST_SYNC_INTERVAL_MS)
		expect(syncs()).toHaveLength(2)

		release()
		vi.advanceTimersByTime(0)
		socket!.emits.length = 0

		vi.advanceTimersByTime(INTEREST_SYNC_INTERVAL_MS * 3)
		expect(syncs()).toHaveLength(0)
	})
})

describe("requestWithInterest", () => {
	test("sends the sync BEFORE the request, on the same socket", () => {
		const handler = vi.fn()

		requestWithInterest("characters:list", {} as any, handler)

		// Synchronously, with no await between them: Socket.IO delivers in
		// order and the server's sync handler stores the set without awaiting,
		// so the handler answering this request already sees the key.
		expect(socket!.emits.map((e) => e.event)).toEqual([
			"interest:sync",
			"characters:list"
		])
		expect(socket!.emits[0].payload.keys).toEqual(["characters:list"])

		socket!.dispatch("characters:list", { characters: [] })
		expect(handler).toHaveBeenCalledOnce()
	})

	test("its release ends the interest like any other", async () => {
		const release = requestWithInterest(
			"characters:list",
			{} as any,
			() => {}
		)
		release()
		await settle()

		expect(socket!.offs).toHaveLength(1)
		expect(lastSyncKeys()).toEqual([])
	})
})

describe("scoped fan-out", () => {
	test("a scoped subscriber sees only its own scope; the bare key sees all", () => {
		const scoped: number[] = []
		const bare: number[] = []

		declareInterest<"sessions:userTyping">(
			"sessions:userTyping#42",
			(d: any) => scoped.push(d.sessionId)
		)
		declareInterest<"sessions:userTyping">(
			"sessions:userTyping",
			(d: any) => bare.push(d.sessionId)
		)

		socket!.dispatch("sessions:userTyping", { sessionId: 42 })
		socket!.dispatch("sessions:userTyping", { sessionId: 7 })

		expect(scoped).toEqual([42])
		expect(bare).toEqual([42, 7])
	})

	test("a payload with no scope reaches only the bare key", () => {
		const scoped = vi.fn()
		const bare = vi.fn()

		declareInterest<"sessions:userTyping">("sessions:userTyping#42", scoped)
		declareInterest<"sessions:userTyping">("sessions:userTyping", bare)

		socket!.dispatch("sessions:userTyping", { characters: [] })

		expect(scoped).not.toHaveBeenCalled()
		expect(bare).toHaveBeenCalledOnce()
	})

	test("routes the streamed reply by the session on its message row", () => {
		// `sessionMessage`'s scope is NOT a `sessionId` beside the payload —
		// it is on the row inside it, which is why the extractor is a shared
		// table and not a convention. A registry that guessed here would hand
		// every session's chunks to every open session's page.
		const scoped: number[] = []
		const bare: number[] = []

		declareInterest<"sessionMessage">("sessionMessage#42", (d: any) =>
			scoped.push(d.sessionMessage.sessionId)
		)
		declareInterest<"sessionMessage">("sessionMessage", (d: any) =>
			bare.push(d.sessionMessage.sessionId)
		)

		socket!.dispatch("sessionMessage", {
			sessionMessage: { id: 1, sessionId: 42 }
		})
		socket!.dispatch("sessionMessage", {
			sessionMessage: { id: 2, sessionId: 7 }
		})
		// The shape the gate's fallback covers: no row at all, so no scope.
		socket!.dispatch("sessionMessage", { error: "nope" })

		expect(scoped).toEqual([42])
		expect(bare).toEqual([42, 7])
	})

	test("an event with no entry in the table has no scope at all", () => {
		// `sessions:userTyping` above is in the table; `characters:list` is
		// not, and a `sessionId` on its payload must not invent a key for it —
		// an event gains a scope by being listed, never by carrying a familiar
		// field.
		const scoped = vi.fn()
		const bare = vi.fn()

		declareInterest<"characters:list">("characters:list#42", scoped)
		declareInterest<"characters:list">("characters:list", bare)

		socket!.dispatch("characters:list", { sessionId: 42 })

		expect(scoped).not.toHaveBeenCalled()
		expect(bare).toHaveBeenCalledOnce()
	})

	test("routes a session reply by the id on the session itself", () => {
		// `sessions:get` answers with the session on `session.id` and carries no
		// `sessionId` field at all, so this is the shape every consumer of the
		// sessions family depends on: the session page, its edit form and the
		// sidebar's view panel each declare `sessions:get#<their id>` and read
		// one session's reply out of a channel the whole tab shares.
		const scoped: number[] = []
		const bare: number[] = []

		declareInterest<"sessions:get">("sessions:get#42", (d: any) =>
			scoped.push(d.session.id)
		)
		declareInterest<"sessions:get">("sessions:get", (d: any) =>
			bare.push(d.session.id)
		)

		socket!.dispatch("sessions:get", { session: { id: 42 } })
		socket!.dispatch("sessions:get", { session: { id: 7 } })

		expect(scoped).toEqual([42])
		expect(bare).toEqual([42, 7])
	})

	test("a not-found reply reaches the scope it was asked about, and no other", () => {
		// `{ session: null }` is the answer to "there is no such session". It has
		// no session to read an id off, so the server puts the requested id on
		// `sessionId` and the extractor falls through to it — which is what lets
		// a view declare ONLY `sessions:get#7` and still learn that 7 is gone
		// instead of sitting on its spinner. Without it such a view must also
		// hold the BARE key, and a bare key matches every other session's reply
		// too — which on the server means the gate passing for every id while
		// any of them is open.
		const seven = vi.fn()
		const eight = vi.fn()

		declareInterest<"sessions:get">("sessions:get#7", seven)
		declareInterest<"sessions:get">("sessions:get#8", eight)

		socket!.dispatch("sessions:get", { session: null, sessionId: 7 })

		expect(seven).toHaveBeenCalledOnce()
		expect(seven).toHaveBeenCalledWith({ session: null, sessionId: 7 })
		expect(eight).not.toHaveBeenCalled()
	})

	test("a reply with neither a session nor a sessionId reaches only the bare key", () => {
		// The scopeless payload is still possible — `SCOPED_EVENTS` must not
		// invent an id no server named — and the bare key is still what hears it.
		const scoped = vi.fn()
		const bare = vi.fn()

		declareInterest<"sessions:get">("sessions:get#42", scoped)
		declareInterest<"sessions:get">("sessions:get", bare)

		socket!.dispatch("sessions:get", { session: null })

		expect(scoped).not.toHaveBeenCalled()
		expect(bare).toHaveBeenCalledOnce()
	})
})

describe("a throwing subscriber", () => {
	test("does not rob the next one of its payload", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {})
		const after = vi.fn()

		declareInterest<"characters:list">("characters:list", () => {
			throw new Error("boom")
		})
		declareInterest<"characters:list">("characters:list", after)

		socket!.dispatch("characters:list", { characters: [] })

		expect(after).toHaveBeenCalledOnce()
		expect(error).toHaveBeenCalledOnce()
	})
})

describe("no socket yet", () => {
	test("declaring does not throw, and connect catches it up", async () => {
		socket = null

		const handler = vi.fn()
		expect(() =>
			declareInterest<"characters:list">("characters:list", handler)
		).not.toThrow()
		await settle()

		socket = makeSocket()
		resyncOnConnect()

		expect(lastSyncKeys()).toEqual(["characters:list"])
		// The listener the registry could not attach is attached now.
		expect(socket.listenerCount("characters:list")).toBe(1)
		socket.dispatch("characters:list", { characters: [] })
		expect(handler).toHaveBeenCalledOnce()
	})

	test("a second connect does not attach the listener twice", () => {
		declareInterest<"characters:list">("characters:list", () => {})

		resyncOnConnect()
		resyncOnConnect()

		expect(socket!.listenerCount("characters:list")).toBe(1)
	})

	test("syncInterest alone is a no-op without a socket", () => {
		socket = null
		expect(() => syncInterest()).not.toThrow()
	})
})

describe("the typed socket flushes a pending sync", () => {
	/**
	 * Ruling 3 as a property of the transport. `createTypedSocket` is the real
	 * one — `getSocket` is mocked to the fake socket above — so what is asserted
	 * here is the guarantee every `socket.emit(...)` call site in the app relies
	 * on, not a re-implementation of it.
	 */
	test("a declare and a typed emit in ONE tick still send the sync first", () => {
		const handler = vi.fn()
		declareInterest<"characters:list">("characters:list", handler)
		// No await: the eager sync is still only queued on its microtask — the
		// one case where, without the flush, the request goes out first.
		createTypedSocket().emit("characters:list", {} as any)

		expect(socket!.emits.map((e) => e.event)).toEqual([
			"interest:sync",
			"characters:list"
		])
		expect(socket!.emits[0].payload.keys).toEqual(["characters:list"])
	})

	test("a typed emit with nothing pending sends no interest packet", async () => {
		declareInterest<"characters:list">("characters:list", () => {})
		await settle()
		expect(syncs()).toHaveLength(1)
		socket!.emits.length = 0

		createTypedSocket().emit("characters:list", {} as any)

		expect(syncs()).toHaveLength(0)
		expect(socket!.emits.map((e) => e.event)).toEqual(["characters:list"])
	})

	test("two flushes in one tick send one packet", () => {
		declareInterest<"characters:list">("characters:list", () => {})

		flushInterestSync()
		flushInterestSync()

		expect(syncs()).toHaveLength(1)
	})

	test("the queued microtask sends no second copy after a flush", async () => {
		declareInterest<"characters:list">("characters:list", () => {})

		flushInterestSync()
		expect(syncs()).toHaveLength(1)

		await settle()

		expect(syncs()).toHaveLength(1)
	})

	test("requestWithInterest still sends exactly one sync", async () => {
		requestWithInterest("characters:list", {} as any, () => {})
		await settle()

		expect(socket!.emits.map((e) => e.event)).toEqual([
			"interest:sync",
			"characters:list"
		])
	})

	test("a key declared AFTER a flush is still synced, on its own microtask", async () => {
		declareInterest<"characters:list">("characters:list", () => {})
		flushInterestSync()
		declareInterest<"characterFolders:list">(
			"characterFolders:list",
			() => {}
		)

		await settle()

		expect(lastSyncKeys()).toEqual([
			"characters:list",
			"characterFolders:list"
		])
	})
})
