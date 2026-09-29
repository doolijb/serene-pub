/**
 * The state store's writes: a write a widget asked for owns its error (R77) —
 * the refusal is that write's rejection and never the store-wide `error` all
 * three state widgets show — while the native widgets' own writes keep the
 * store-wide line exactly as before. A reply settles the one write its
 * `requestId` names, whatever order replies arrive in and whichever tab they
 * came from. And a read's failure is kept apart as `readError`, what
 * `session_state.v1.error` says — only a failure of THIS session's read.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const wire = vi.hoisted(() => ({
	handlers: new Map<string, Set<(data: unknown) => void>>(),
	emitted: [] as Array<[string, unknown]>
}))

vi.mock("$lib/client/sockets/typedSocket", () => ({ typedSocketOrNull: () => ({}) }))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declare = (key: string, handler: (data: unknown) => void) => {
		const event = key.split("#")[0]
		const set = wire.handlers.get(event) ?? new Set()
		set.add(handler)
		wire.handlers.set(event, set)
		return () => set.delete(handler)
	}
	return {
		declareInterest: declare,
		requestWithInterest: (event: string, params: unknown, handler: (data: unknown) => void) => {
			declare(event, handler)
			wire.emitted.push([event, params])
			return () => {}
		}
	}
})

/** The server answering: every listener for the event hears it. */
const serverSays = (event: string, data: unknown) => {
	for (const h of wire.handlers.get(event) ?? []) h(data)
}

/** The `requestId` the last `state:set` went out with. */
const lastWriteId = (): string => {
	const sent = [...wire.emitted].reverse().find(([event]) => event === "state:set")
	return (sent?.[1] as { requestId: string }).requestId
}

/** What a promise has done so far, without waiting for it. */
function watch(p: Promise<void>) {
	const seen: { outcome: "pending" | "resolved" | "rejected"; error?: string } = { outcome: "pending" }
	p.then(
		() => (seen.outcome = "resolved"),
		(e: Error) => {
			seen.outcome = "rejected"
			seen.error = e.message
		}
	)
	return seen
}
const tick = () => new Promise((r) => setTimeout(r, 0))

const { openSessionState, sessionState } = await import("./sessionState.svelte")

beforeEach(() => {
	wire.emitted.length = 0
	openSessionState(null)
	openSessionState(7)
})

afterEach(() => {
	vi.useRealTimers()
})

const owner = { kind: "session" as const, id: 7 }
const resolved = { world: { weather: "sun" }, cast: {} }

describe("a widget's write owns its error (R77)", () => {
	test("its refusal rejects that write, and the store-wide error stays clear", async () => {
		const store = sessionState()
		const written = store.set(owner, "core:slot/weather@1", "rain", { ownError: true })
		expect(wire.emitted.at(-1)).toEqual([
			"state:set",
			{ sessionId: 7, owner, slotId: "core:slot/weather@1", value: "rain", requestId: expect.any(String) }
		])
		serverSays("state:set:error", { error: "Weather is one of: sun, snow.", requestId: lastWriteId() })
		await expect(written).rejects.toThrow("Weather is one of: sun, snow.")
		expect(store.error).toBeNull()
	})

	test("…and it resolves once written", async () => {
		const store = sessionState()
		const written = store.set(owner, "core:slot/weather@1", "sun", { ownError: true })
		serverSays("state:set", { sessionId: 7, state: resolved, requestId: lastWriteId() })
		await expect(written).resolves.toBeUndefined()
		expect(store.state.world).toEqual({ weather: "sun" })
	})

	test("a native widget's own write keeps the store-wide error, as it always has", async () => {
		const store = sessionState()
		const written = store.set(owner, "core:slot/weather@1", "hail")
		serverSays("state:set:error", { error: "Weather is one of: sun, snow.", requestId: lastWriteId() })
		await expect(written).rejects.toThrow()
		expect(store.error).toBe("Weather is one of: sun, snow.")
		expect(store.readError).toBeNull()
	})

	test("a write still waiting when the session changes is told so, never left hanging", async () => {
		const store = sessionState()
		const written = store.set(owner, "core:slot/weather@1", "sun", { ownError: true })
		openSessionState(8)
		await expect(written).rejects.toThrow(/session changed/)
	})
})

describe("a reply settles the one write its requestId names (K1)", () => {
	test("write #2's refusal arriving before write #1's reply settles each write as its own", async () => {
		const store = sessionState()
		const first = watch(store.set(owner, "core:slot/weather@1", "sun", { ownError: true }))
		const firstId = lastWriteId()
		const second = watch(store.set(owner, "core:slot/weather@1", "hail", { ownError: true }))
		const secondId = lastWriteId()
		expect(firstId).not.toBe(secondId)

		serverSays("state:set:error", { error: "Weather is one of: sun, snow.", requestId: secondId })
		await tick()
		expect(first.outcome).toBe("pending")
		expect(second).toEqual({ outcome: "rejected", error: "Weather is one of: sun, snow." })

		serverSays("state:set", { sessionId: 7, state: resolved, requestId: firstId })
		await tick()
		expect(first.outcome).toBe("resolved")
		expect(store.error).toBeNull()
	})

	test("another tab's reply and refusal settle nothing here — the reply still lands in the state", async () => {
		const store = sessionState()
		const mine = watch(store.set(owner, "core:slot/weather@1", "sun", { ownError: true }))
		serverSays("state:set", { sessionId: 7, state: resolved, requestId: "set-othertab-1" })
		serverSays("state:set:error", { error: "Weather is one of: sun, snow.", requestId: "set-othertab-2" })
		await tick()
		expect(mine.outcome).toBe("pending")
		// The other tab's writer heard its own refusal; this tab does not show it.
		expect(store.error).toBeNull()
		// …but a reply is still a fresh read of the session.
		expect(store.state.world).toEqual({ weather: "sun" })
	})

	test("a refusal naming no write at all is still said store-wide, and settles nothing", async () => {
		const store = sessionState()
		const mine = watch(store.set(owner, "core:slot/weather@1", "sun", { ownError: true }))
		serverSays("state:set:error", { error: "Set a new password to continue." })
		await tick()
		expect(mine.outcome).toBe("pending")
		expect(store.error).toBe("Set a new password to continue.")
	})
})

describe("a reply still owed after its caller was told (owed-replies)", () => {
	test("a write that timed out is rejected at 15s, and its late reply settles no later write", async () => {
		vi.useFakeTimers()
		const store = sessionState()
		const late = watch(store.set(owner, "core:slot/weather@1", "sun", { ownError: true }))
		const lateId = lastWriteId()
		await vi.advanceTimersByTimeAsync(15_001)
		expect(late).toEqual({ outcome: "rejected", error: "that write went unanswered" })

		const next = watch(store.set(owner, "core:slot/weather@1", "hail", { ownError: true }))
		const nextId = lastWriteId()
		serverSays("state:set", { sessionId: 7, state: resolved, requestId: lateId })
		await vi.advanceTimersByTimeAsync(0)
		expect(next.outcome).toBe("pending")

		serverSays("state:set:error", { error: "Weather is one of: sun, snow.", requestId: nextId })
		await vi.advanceTimersByTimeAsync(0)
		expect(next).toEqual({ outcome: "rejected", error: "Weather is one of: sun, snow." })
		// A widget's refusal is its own, late or not (R77).
		expect(store.error).toBeNull()
	})

	test("a widget's refusal arriving after its timeout never goes store-wide", async () => {
		vi.useFakeTimers()
		const store = sessionState()
		watch(store.set(owner, "core:slot/weather@1", "hail", { ownError: true }))
		const id = lastWriteId()
		await vi.advanceTimersByTimeAsync(15_001)
		serverSays("state:set:error", { error: "Weather is one of: sun, snow.", requestId: id })
		expect(store.error).toBeNull()
	})

	test("a native write's refusal arriving after its timeout is still said store-wide, once", async () => {
		vi.useFakeTimers()
		const store = sessionState()
		watch(store.set(owner, "core:slot/weather@1", "hail"))
		const id = lastWriteId()
		await vi.advanceTimersByTimeAsync(15_001)
		serverSays("state:set:error", { error: "Weather is one of: sun, snow.", requestId: id })
		expect(store.error).toBe("Weather is one of: sun, snow.")
		store.clearError()
		serverSays("state:set:error", { error: "Weather is one of: sun, snow.", requestId: id })
		expect(store.error).toBeNull()
	})

	test("a write abandoned by a session switch: its late refusal neither settles the next write nor shows", async () => {
		const store = sessionState()
		const old = watch(store.set(owner, "core:slot/weather@1", "hail", { ownError: true }))
		const oldId = lastWriteId()
		openSessionState(8)
		const next = watch(store.set({ kind: "session", id: 8 }, "core:slot/weather@1", "sun", { ownError: true }))
		const nextId = lastWriteId()
		serverSays("state:set:error", { error: "Weather is one of: sun, snow. (session 7)", requestId: oldId })
		await tick()
		expect(old.outcome).toBe("rejected")
		expect(next.outcome).toBe("pending")
		expect(store.error).toBeNull()
		serverSays("state:set", { sessionId: 8, state: resolved, requestId: nextId })
		await tick()
		expect(next.outcome).toBe("resolved")
	})
})

describe("a read's failure", () => {
	test("is kept as readError beside the store-wide error, and cleared by the next read", () => {
		const store = sessionState()
		serverSays("state:get:error", { error: "You cannot see this session.", sessionId: 7 })
		expect(store.readError).toBe("You cannot see this session.")
		expect(store.error).toBe("You cannot see this session.")
		serverSays("state:get", { sessionId: 7, state: { world: {}, cast: {} }, slots: [], owners: [] })
		expect(store.readError).toBeNull()
	})

	test("one naming another session — another tab's, or the session just left — is not this one's", () => {
		const store = sessionState()
		serverSays("state:get", { sessionId: 7, state: { world: {}, cast: {} }, slots: [], owners: [] })
		serverSays("state:get:error", { error: "Session not found.", sessionId: 9 })
		expect(store.readError).toBeNull()
		expect(store.error).toBeNull()
	})

	test("one naming no session is taken only while this tab's own read is out", () => {
		const store = sessionState()
		serverSays("state:get", { sessionId: 7, state: { world: {}, cast: {} }, slots: [], owners: [] })
		serverSays("state:get:error", { error: "An error occurred while processing your request." })
		expect(store.readError).toBeNull()
		// A read goes out (a change was broadcast), and fails with no session named.
		serverSays("state:changed", { sessionId: 7 })
		serverSays("state:get:error", { error: "An error occurred while processing your request." })
		expect(store.readError).toBe("An error occurred while processing your request.")
	})
})
