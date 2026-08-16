/**
 * withSupersession() is the per-socket registry that makes a new
 * search/card-detail request cancel that same socket's own previous
 * still-in-flight request of the same kind. The trickiest part is the
 * belated-cleanup race: request N's own `finally` cleanup must never delete
 * request N+1's entry if N+1 has already replaced it in the map by the time
 * N's cleanup runs.
 */
import { describe, expect, test } from "vitest"
import {
	withSupersession,
	clearInFlightRequestsForSocket
} from "./inFlightRequests"

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

describe("withSupersession", () => {
	test("a second call for the same (socketId, kind) aborts the first's signal", async () => {
		let firstSignal: AbortSignal | undefined
		const firstStarted = deferred<void>()
		const firstWork = deferred<string>()

		const firstPromise = withSupersession(
			"socket-1",
			"characters:searchLibrary",
			async (signal) => {
				firstSignal = signal
				firstStarted.resolve()
				return firstWork.promise
			}
		)
		await firstStarted.promise

		expect(firstSignal!.aborted).toBe(false)

		const secondPromise = withSupersession(
			"socket-1",
			"characters:searchLibrary",
			async () => "second-result"
		)

		expect(firstSignal!.aborted).toBe(true)

		firstWork.resolve("first-result") // let the first call actually settle
		await firstPromise
		await expect(secondPromise).resolves.toBe("second-result")
	})

	test("different socketId never cross-interferes", async () => {
		let signalForA: AbortSignal | undefined
		const workA = deferred<string>()
		const promiseA = withSupersession(
			"socket-A",
			"characters:searchLibrary",
			async (signal) => {
				signalForA = signal
				return workA.promise
			}
		)
		await Promise.resolve()

		// A request on a DIFFERENT socket must not touch socket-A's controller.
		await withSupersession(
			"socket-B",
			"characters:searchLibrary",
			async () => "b-result"
		)

		expect(signalForA!.aborted).toBe(false)
		workA.resolve("a-result")
		await expect(promiseA).resolves.toBe("a-result")
	})

	test("different kind on the same socket never cross-interferes", async () => {
		let signalForSearch: AbortSignal | undefined
		const workSearch = deferred<string>()
		const searchPromise = withSupersession(
			"socket-1",
			"characters:searchLibrary",
			async (signal) => {
				signalForSearch = signal
				return workSearch.promise
			}
		)
		await Promise.resolve()

		// A card-detail request on the SAME socket is a different kind — must
		// not abort the in-flight search.
		await withSupersession(
			"socket-1",
			"cardSources:cardDetail",
			async () => "detail-result"
		)

		expect(signalForSearch!.aborted).toBe(false)
		workSearch.resolve("search-result")
		await expect(searchPromise).resolves.toBe("search-result")
	})

	test("clearInFlightRequestsForSocket aborts and stops tracking every kind for that socket", async () => {
		let signalForSearch: AbortSignal | undefined
		let signalForDetail: AbortSignal | undefined
		const workSearch = deferred<string>()
		const workDetail = deferred<string>()

		const searchPromise = withSupersession(
			"socket-1",
			"characters:searchLibrary",
			async (signal) => {
				signalForSearch = signal
				return workSearch.promise
			}
		)
		const detailPromise = withSupersession(
			"socket-1",
			"cardSources:cardDetail",
			async (signal) => {
				signalForDetail = signal
				return workDetail.promise
			}
		)
		await Promise.resolve()

		clearInFlightRequestsForSocket("socket-1")

		expect(signalForSearch!.aborted).toBe(true)
		expect(signalForDetail!.aborted).toBe(true)

		workSearch.resolve("unused")
		workDetail.resolve("unused")
		await searchPromise
		await detailPromise

		// A fresh request after clearing starts a genuinely new, non-aborted
		// controller rather than inheriting the cleared state.
		let signalForFresh: AbortSignal | undefined
		await withSupersession(
			"socket-1",
			"characters:searchLibrary",
			async (signal) => {
				signalForFresh = signal
				return "fresh"
			}
		)
		expect(signalForFresh!.aborted).toBe(false)
	})

	test("belated cleanup race: request N's finally running after N+1 replaced it must not delete N+1's entry", async () => {
		const workN = deferred<string>()

		// Request N — its own run() won't resolve until we manually do so
		// below, simulating it being slow to actually notice its abort.
		const promiseN = withSupersession(
			"socket-1",
			"characters:searchLibrary",
			async () => workN.promise
		)
		await Promise.resolve()

		// Request N+1 supersedes N (aborting N's signal, replacing the map
		// entry with its own controller).
		let signalForNPlus1: AbortSignal | undefined
		const workNPlus1 = deferred<string>()
		const promiseNPlus1 = withSupersession(
			"socket-1",
			"characters:searchLibrary",
			async (signal) => {
				signalForNPlus1 = signal
				return workNPlus1.promise
			}
		)
		await Promise.resolve()

		// N's run() finally settles (belatedly) — its own finally block
		// fires now, well after N+1 already took over the map entry.
		workN.resolve("n-result")
		await promiseN

		// N+1 must still be trackable/cancelable — if N's belated cleanup
		// had wrongly deleted N+1's entry, a THIRD request here would fail
		// to abort N+1's signal.
		await withSupersession(
			"socket-1",
			"characters:searchLibrary",
			async () => "n-plus-2-result"
		)
		expect(signalForNPlus1!.aborted).toBe(true)

		workNPlus1.resolve("unused")
		await promiseNPlus1
	})
})
