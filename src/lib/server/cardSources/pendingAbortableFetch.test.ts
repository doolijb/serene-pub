/**
 * getOrStartAbortable() is the reference-counting primitive both cache.ts's
 * TtlCache and diskCache.ts's getOrFetchCardBytes build on, to make an
 * in-flight-de-duped fetch safely cancelable per-caller: one caller giving
 * up must never abort work a DIFFERENT caller attached to the same key is
 * still waiting on. This is the trickiest logic in the CharaVault
 * supersession fix, so it's tested in isolation here, with no DB/fs
 * involved — just controllable deferred promises.
 */
import { describe, expect, test, vi } from "vitest"
import {
	getOrStartAbortable,
	type PendingAbortableEntry
} from "./pendingAbortableFetch"

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (err: any) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe("getOrStartAbortable", () => {
	test("single caller, no signal, resolves normally and cleans up the pending entry", async () => {
		const pending = new Map<string, PendingAbortableEntry<string>>()
		const result = await getOrStartAbortable(
			pending,
			"key",
			async () => "value"
		)
		expect(result).toBe("value")
		expect(pending.size).toBe(0)
	})

	test("single caller, with a signal that never aborts, resolves normally", async () => {
		const pending = new Map<string, PendingAbortableEntry<string>>()
		const controller = new AbortController()
		const result = await getOrStartAbortable(
			pending,
			"key",
			async () => "value",
			controller.signal
		)
		expect(result).toBe("value")
	})

	test("two callers sharing a key: one aborts, the other still resolves with the real value, and start()'s own signal is never aborted", async () => {
		const pending = new Map<string, PendingAbortableEntry<string>>()
		const work = deferred<string>()
		let groupSignal: AbortSignal | undefined
		const start = vi.fn((signal: AbortSignal) => {
			groupSignal = signal
			return work.promise
		})

		const controllerA = new AbortController()
		const controllerB = new AbortController()
		const promiseA = getOrStartAbortable(
			pending,
			"key",
			start,
			controllerA.signal
		)
		const promiseB = getOrStartAbortable(
			pending,
			"key",
			start,
			controllerB.signal
		)
		await Promise.resolve()

		controllerA.abort()
		await expect(promiseA).rejects.toMatchObject({ name: "AbortError" })
		expect(groupSignal!.aborted).toBe(false) // B is still attached

		work.resolve("real-value")
		await expect(promiseB).resolves.toBe("real-value")
		expect(start).toHaveBeenCalledTimes(1) // one shared fetch, not two
	})

	test("both callers abort: the group signal only fires after the second, never after the first alone", async () => {
		const pending = new Map<string, PendingAbortableEntry<string>>()
		const work = deferred<string>()
		let groupSignal: AbortSignal | undefined
		const start = vi.fn((signal: AbortSignal) => {
			groupSignal = signal
			return work.promise
		})

		const controllerA = new AbortController()
		const controllerB = new AbortController()
		const promiseA = getOrStartAbortable(
			pending,
			"key",
			start,
			controllerA.signal
		)
		const promiseB = getOrStartAbortable(
			pending,
			"key",
			start,
			controllerB.signal
		)
		await Promise.resolve()

		controllerA.abort()
		await expect(promiseA).rejects.toMatchObject({ name: "AbortError" })
		expect(groupSignal!.aborted).toBe(false)

		controllerB.abort()
		await expect(promiseB).rejects.toMatchObject({ name: "AbortError" })
		expect(groupSignal!.aborted).toBe(true)
	})

	test("a pre-aborted signal joining a FRESH key never calls start() at all", async () => {
		const pending = new Map<string, PendingAbortableEntry<string>>()
		const start = vi.fn(async () => "value")
		const controller = new AbortController()
		controller.abort()

		await expect(
			getOrStartAbortable(pending, "key", start, controller.signal)
		).rejects.toMatchObject({ name: "AbortError" })

		expect(start).not.toHaveBeenCalled()
		expect(pending.size).toBe(0)
	})

	test("a pre-aborted signal joining an EXISTING entry doesn't touch waiterCount", async () => {
		const pending = new Map<string, PendingAbortableEntry<string>>()
		const work = deferred<string>()
		const start = vi.fn(() => work.promise)

		const legitimateController = new AbortController()
		const promiseLegitimate = getOrStartAbortable(
			pending,
			"key",
			start,
			legitimateController.signal
		)
		await Promise.resolve()
		const entry = pending.get("key")!
		expect(entry.waiterCount).toBe(1)

		const preAbortedController = new AbortController()
		preAbortedController.abort()
		await expect(
			getOrStartAbortable(
				pending,
				"key",
				start,
				preAbortedController.signal
			)
		).rejects.toMatchObject({ name: "AbortError" })

		expect(entry.waiterCount).toBe(1) // the pre-aborted joiner never attached

		work.resolve("value")
		await expect(promiseLegitimate).resolves.toBe("value")
	})

	test("a successful shared resolution does not call entry.controller.abort() — the detachOnAbort/detachQuietly split", async () => {
		const pending = new Map<string, PendingAbortableEntry<string>>()
		let groupSignal: AbortSignal | undefined
		const start = vi.fn(async (signal: AbortSignal) => {
			groupSignal = signal
			return "value"
		})
		const controller = new AbortController()

		const result = await getOrStartAbortable(
			pending,
			"key",
			start,
			controller.signal
		)

		expect(result).toBe("value")
		expect(groupSignal!.aborted).toBe(false)
	})

	test("listener cleanup: aborting after the fetch already resolved is a harmless no-op", async () => {
		const pending = new Map<string, PendingAbortableEntry<string>>()
		const controller = new AbortController()
		const result = await getOrStartAbortable(
			pending,
			"key",
			async () => "value",
			controller.signal
		)
		expect(result).toBe("value")
		expect(() => controller.abort()).not.toThrow()
	})

	test("a rejecting start() propagates to every attached caller, not just the first", async () => {
		const pending = new Map<string, PendingAbortableEntry<string>>()
		const work = deferred<string>()
		const start = vi.fn(() => work.promise)
		const controllerA = new AbortController()
		const controllerB = new AbortController()

		const promiseA = getOrStartAbortable(
			pending,
			"key",
			start,
			controllerA.signal
		)
		const promiseB = getOrStartAbortable(
			pending,
			"key",
			start,
			controllerB.signal
		)
		await Promise.resolve()

		work.reject(new Error("upstream failed"))

		await expect(promiseA).rejects.toThrow("upstream failed")
		await expect(promiseB).rejects.toThrow("upstream failed")
		expect(start).toHaveBeenCalledTimes(1) // one shared fetch, both callers saw its rejection
		expect(pending.size).toBe(0) // cleaned up, not stuck on the rejected entry
	})
})
