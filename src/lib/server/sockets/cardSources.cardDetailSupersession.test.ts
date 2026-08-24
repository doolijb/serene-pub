/**
 * Round-15 audit fix: cardSources:cardDetail gets the same supersession
 * treatment as characters:searchLibrary — a socket rapidly clicking
 * through several cards while browsing shouldn't leave every earlier,
 * no-longer-wanted detail fetch running to completion against the shared
 * CharaVault rate limiter. No DB involved once cachedCardDetail is mocked
 * (unlike the search handler, this one never reads userSettings/NSFW
 * policy itself) — a trivial db stub is enough to satisfy cardSources.ts's
 * top-level import.
 */
import { afterEach, describe, expect, test, vi } from "vitest"

let cachedCardDetailMock: ReturnType<typeof vi.fn>

vi.mock("$lib/server/db", () => ({ db: {} }))

vi.mock("$lib/server/cardSources", () => ({
	listCardSources: vi.fn(() => []),
	cachedCardDetail: (cachedCardDetailMock = vi.fn())
}))

afterEach(() => {
	cachedCardDetailMock.mockReset()
})

function fakeSocket(userId: number, socketId: string) {
	return { id: socketId, user: { id: userId, isAdmin: false } } as any
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (err: any) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe("cardSources:cardDetail — supersession", () => {
	test("a superseded detail request never emits an error, and only the newest one's response reaches the client", async () => {
		const { cardSourcesCardDetail } = await import("./cardSources")
		const socket = fakeSocket(1, "socket-detail-supersession-1")

		const emitted: { event: string; data: any }[] = []
		const emitToUser = (event: string, data: any) => {
			emitted.push({ event, data })
		}

		const firstWork = deferred<any>()
		let firstSignal: AbortSignal | undefined
		cachedCardDetailMock.mockImplementationOnce(
			(_source: any, _ref: any, ctx: any) => {
				firstSignal = ctx.signal
				return new Promise((resolve, reject) => {
					ctx.signal.addEventListener(
						"abort",
						() => reject(ctx.signal.reason),
						{ once: true }
					)
					firstWork.promise.then(resolve, reject)
				})
			}
		)

		const firstCallPromise = cardSourcesCardDetail.handler(
			socket,
			{
				source: "charavault",
				ref: { folder: "a", file: "b.png" },
				requestId: "req-1"
			} as any,
			emitToUser
		)
		await vi.waitFor(() => expect(firstSignal).toBeDefined())
		expect(firstSignal!.aborted).toBe(false)

		let secondSignal: AbortSignal | undefined
		cachedCardDetailMock.mockImplementationOnce(
			(_source: any, _ref: any, ctx: any) => {
				secondSignal = ctx.signal
				return Promise.resolve({ description: "second card" })
			}
		)
		const secondCallPromise = cardSourcesCardDetail.handler(
			socket,
			{
				source: "charavault",
				ref: { folder: "c", file: "d.png" },
				requestId: "req-2"
			} as any,
			emitToUser
		)
		await vi.waitFor(() => expect(secondSignal).toBeDefined())

		expect(firstSignal!.aborted).toBe(true)
		expect(secondSignal!.aborted).toBe(false)

		firstWork.resolve({ description: "first card" })
		await firstCallPromise
		await secondCallPromise

		expect(
			emitted.some((e) => e.event === "cardSources:cardDetail:error")
		).toBe(false)
		expect(
			emitted.some(
				(e) =>
					e.event === "cardSources:cardDetail" &&
					e.data.requestId === "req-2"
			)
		).toBe(true)
		expect(emitted.some((e) => e.data?.requestId === "req-1")).toBe(false)
	})

	test("a genuine (non-abort) error still emits the error event and re-throws", async () => {
		const { cardSourcesCardDetail } = await import("./cardSources")
		const socket = fakeSocket(1, "socket-detail-supersession-2")

		const emitted: { event: string; data: any }[] = []
		const emitToUser = (event: string, data: any) => {
			emitted.push({ event, data })
		}

		cachedCardDetailMock.mockImplementationOnce(async () => {
			throw new Error("upstream is down")
		})

		await expect(
			cardSourcesCardDetail.handler(
				socket,
				{
					source: "charavault",
					ref: { folder: "a", file: "b.png" },
					requestId: "req-3"
				} as any,
				emitToUser
			)
		).rejects.toThrow("upstream is down")

		const errorEvent = emitted.find(
			(e) => e.event === "cardSources:cardDetail:error"
		)
		expect(errorEvent).toBeDefined()
		expect(errorEvent!.data.error).toBe("upstream is down")
	})
})
