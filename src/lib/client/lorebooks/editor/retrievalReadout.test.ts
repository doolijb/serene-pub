/**
 * The editor's shared run readout — its socket half.
 *
 * Three properties, every one of which fails silently if it regresses:
 *
 *   1. **The `pipelines:runExplain` pair is held on the interest registry**,
 *      not on the raw socket — one listener per event name, declared on the
 *      first `open` and released only by the last `close`. The refcount is the
 *      whole point: several editors are mounted on one readout, and an `off`
 *      from the first one to unmount would have blinded the rest.
 *   2. **The run's account reaches the readout through it.** The registry fans
 *      a payload out to its subscribers, so a key that is spelled or released
 *      wrongly does not throw — the Read in line simply never appears.
 *   3. **`entries:recentDecisions` is held SCOPED, and the key follows the
 *      book.** The readout is asked about one book-and-session pair at a time;
 *      a reader opening another book has to release the key it held and take
 *      the new one, or the marks go on saying what the previous book's run
 *      did. Nothing at all is held before a book is named.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { isScopedEvent } from "$lib/shared/sockets/interest"

/** The live socket both the registry and the readout read. */
let socket: ReturnType<typeof makeSocket> | null = null

vi.mock("$app/environment", () => ({ dev: false, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => socket
}))

type Listener = (payload: any) => void

/** The same shape `sockets/interest.test.ts` drives the registry with. */
function makeSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		emits: [] as Array<{ event: string; payload: any }>,
		listeners,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event)
			if (!arr) return
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
			if (arr.length === 0) listeners.delete(event)
		},
		once() {},
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

/** A fresh module graph, so the singleton readout and the registry start empty. */
async function loadReadout() {
	vi.resetModules()
	return (await import("./retrievalReadout.svelte")).retrievalReadout
}

/** Lets the microtask-debounced eager interest sync run. */
const settle = () => Promise.resolve()

/** The key list of the most recent interest sync, or null if none was sent. */
function lastSyncKeys(): string[] | null {
	const syncs = (socket?.emits ?? []).filter(
		(e) => e.event === "interest:sync"
	)
	return syncs.length ? syncs[syncs.length - 1].payload.keys : null
}

/** Everything but the registry's own syncs. */
function requests() {
	return (socket?.emits ?? []).filter((e) => e.event !== "interest:sync")
}

const row = (
	over: Partial<Sockets.Pipelines.RetrievalRow> & { id: number }
): Sockets.Pipelines.RetrievalRow => ({
	key: `worldLore:${over.id}`,
	source: "worldLore",
	sourceLabel: "World lore",
	title: `Entry ${over.id}`,
	outcome: "included",
	verdict: "It fitted the budget.",
	marker: "keyword",
	markerKind: "keyword",
	criteria: [],
	...over
})

beforeEach(() => {
	socket = makeSocket()
})

afterEach(() => {
	socket = null
	vi.restoreAllMocks()
})

describe("open / close", () => {
	test("declares the run-explain pair and takes one listener per event", async () => {
		const readout = await loadReadout()
		readout.open(socket as any)
		await settle()

		expect(socket!.listenerCount("pipelines:runExplain")).toBe(1)
		expect(socket!.listenerCount("pipelines:runExplain:error")).toBe(1)
		const keys = lastSyncKeys()!
		expect(keys).toContain("pipelines:runExplain")
		expect(keys).toContain("pipelines:runExplain:error")

		// No book has been named yet, so there is no decisions key to hold.
		expect(socket!.listenerCount("entries:recentDecisions")).toBe(0)
		expect(keys.some((k) => k.startsWith("entries:recentDecisions"))).toBe(
			false
		)

		readout.close(socket as any)
	})

	test("a second editor adds nothing, and only the last close releases", async () => {
		const readout = await loadReadout()
		readout.open(socket as any)
		readout.open(socket as any)
		await settle()
		expect(socket!.listenerCount("pipelines:runExplain")).toBe(1)

		readout.close(socket as any)
		await settle()
		// One editor is still mounted on it: the interest stands.
		expect(socket!.listenerCount("pipelines:runExplain")).toBe(1)
		expect(lastSyncKeys()).toContain("pipelines:runExplain")

		readout.close(socket as any)
		await settle()
		expect(socket!.listenerCount("pipelines:runExplain")).toBe(0)
		expect(socket!.listenerCount("pipelines:runExplain:error")).toBe(0)
		expect(lastSyncKeys()).toEqual([])
	})

	test("re-opening after the last close declares again", async () => {
		const readout = await loadReadout()
		readout.open(socket as any)
		readout.close(socket as any)
		readout.open(socket as any)
		await settle()

		expect(socket!.listenerCount("pipelines:runExplain")).toBe(1)
		expect(lastSyncKeys()).toContain("pipelines:runExplain")

		readout.close(socket as any)
	})
})

describe("the decisions key", () => {
	/**
	 * The client half of a scope is worth nothing on its own: the registry
	 * fans a payload out to `event#scope` only when the SHARED table says
	 * where this event keeps its scope. A key declared here that the table
	 * does not know matches nothing at all, silently — so the table is
	 * asserted rather than assumed.
	 */
	test("the shared table knows where this event keeps its scope", () => {
		expect(isScopedEvent("entries:recentDecisions")).toBe(true)
	})

	test("is taken when a book is named, and follows it", async () => {
		const readout = await loadReadout()
		readout.open(socket as any)
		readout.ask(1, 2)
		await settle()

		expect(socket!.listenerCount("entries:recentDecisions")).toBe(1)
		expect(lastSyncKeys()).toContain("entries:recentDecisions#1")

		readout.ask(3, 2)
		await settle()
		const keys = lastSyncKeys()!
		expect(keys).toContain("entries:recentDecisions#3")
		expect(keys).not.toContain("entries:recentDecisions#1")
		// Still ONE raw listener: the registry keeps one per event name.
		expect(socket!.listenerCount("entries:recentDecisions")).toBe(1)

		readout.close(socket as any)
		await settle()
		expect(socket!.listenerCount("entries:recentDecisions")).toBe(0)
		expect(lastSyncKeys()).toEqual([])
	})

	test("another book's decisions are not delivered to this one", async () => {
		const readout = await loadReadout()
		readout.open(socket as any)
		readout.ask(1, 2)

		socket!.dispatch("entries:recentDecisions", {
			lorebookId: 9,
			sessionId: 2,
			runId: "run-elsewhere"
		})
		// Nothing was asked of that run: the key never matched.
		expect(requests().at(-1)).toEqual({
			event: "entries:recentDecisions",
			payload: { lorebookId: 1, sessionId: 2 }
		})

		readout.close(socket as any)
	})
})

describe("the run's account arrives through the registry", () => {
	test("a decision asks for the explanation, and its facts land", async () => {
		const readout = await loadReadout()
		readout.open(socket as any)
		readout.ask(1, 2)

		expect(requests()).toEqual([
			{
				event: "entries:recentDecisions",
				payload: { lorebookId: 1, sessionId: 2 }
			}
		])

		socket!.dispatch("entries:recentDecisions", {
			lorebookId: 1,
			sessionId: 2,
			runId: "run-1"
		})
		expect(requests().at(-1)).toEqual({
			event: "pipelines:runExplain",
			payload: { runId: "run-1" }
		})

		socket!.dispatch("pipelines:runExplain", {
			runId: "run-1",
			explanation: {
				rows: [
					row({ id: 7, tokens: 218, score: 0.9 }),
					row({ id: 8, score: 0.1 })
				],
				budget: { total: 900 }
			}
		})

		expect(readout.factsFor(1, 2, 7)).toMatchObject({
			rank: 1,
			of: 2,
			budget: 900,
			tokens: 218
		})
		// Another book's question is not answered out of this run.
		expect(readout.factsFor(9, 2, 7)).toEqual({})

		readout.close(socket as any)
	})

	test("a refusal stops the wait", async () => {
		const readout = await loadReadout()
		readout.open(socket as any)
		readout.ask(1, 2)
		socket!.dispatch("entries:recentDecisions", {
			lorebookId: 1,
			sessionId: 2,
			runId: "run-1"
		})
		socket!.dispatch("pipelines:runExplain", {
			runId: "run-1",
			explanation: { rows: [row({ id: 7 })] }
		})
		expect(readout.factsFor(1, 2, 7).rank).toBe(1)

		socket!.dispatch("pipelines:runExplain:error", {
			error: "That run could not be read."
		})
		expect(readout.factsFor(1, 2, 7)).toEqual({})

		readout.close(socket as any)
	})
})
