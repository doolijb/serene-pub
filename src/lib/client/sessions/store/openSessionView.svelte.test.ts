import { describe, expect, it } from "vitest"
import { createSessionStore } from "./sessionStore.svelte"
import { createOpenSessionView } from "./openSessionView.svelte"

const row = (id: number, extra: Record<string, unknown> = {}) =>
	({ id, sessionId: 1, channel: "main", metadata: null, ...extra }) as any

function setup(userId: number | null = 5) {
	const store = createSessionStore()
	const view = createOpenSessionView({ store, userId: () => userId })
	const load = (extra: Record<string, unknown> = {}, rows = [row(1, { metadata: { isGreeting: true } })]) => {
		store.open(1)
		store.load(
			{ id: 1, name: "S", userId: 5, sessionMessages: rows, sessionCharacters: [], sessionPersonas: [], ...extra } as any,
			{ hasMore: false, olderIn: [] } as any
		)
	}
	return { store, view, load }
}

describe("createOpenSessionView", () => {
	it("reads null until the session is loaded", () => {
		const cleanup = $effect.root(() => {
			const { store, view, load } = setup()
			expect(view.sessionId).toBeNull()
			expect(view.isOwner).toBe(false)
			store.open(1)
			expect(view.sessionId).toBeNull()
			load()
			expect(view.sessionId).toBe(1)
		})
		cleanup()
	})

	it("each getter follows a store write", () => {
		const cleanup = $effect.root(() => {
			const { store, view, load } = setup()
			load()
			expect(view.sessionName).toBe("S")
			store.patchSession(1, { name: "T" })
			expect(view.sessionName).toBe("T")

			expect(view.branchOfLabel).toBeNull()
			store.patchSession(1, { branchOfSessionId: 3, branchOfMessageId: 9, branchOfName: "Crawl Six" } as any)
			expect(view.branchOfLabel).toBe("Branch of Crawl Six")

			expect(view.archived).toBe(false)
			store.patchSession(1, { archivedAt: "2026-10-01" } as any)
			expect(view.archived).toBe(true)

			store.patchSession(1, { lorebookId: 4, lorebookBranchId: 8 })
			expect(view.lorebookId).toBe(4)
			expect(view.lorebookBranchId).toBe(8)

			expect(view.lorebookFixed).toBe(false)
			store.upsertMessage(row(2))
			expect(view.lorebookFixed).toBe(true)

			store.mergeGenreOf({ sessionId: 1, genre: { name: "Story" } } as any)
			expect(view.genreName).toBe("Story")
		})
		cleanup()
	})

	it("hands out the same storyClock object until the clock moves", () => {
		const cleanup = $effect.root(() => {
			const { store, view, load } = setup()
			load({ storyClockYear: 3, storyClockMonth: 1, storyClockDay: 2 })
			const first = view.storyClock
			expect(first).toEqual({ year: 3, month: 1, day: 2 })
			store.patchSession(1, { name: "other" })
			expect(view.storyClock === first).toBe(true)
			store.patchSession(1, { storyClockYear: 4 } as any)
			expect(view.storyClock === first).toBe(false)
			expect(view.storyClock?.year).toBe(4)
		})
		cleanup()
	})

	it("isOwner follows the user id", () => {
		const cleanup = $effect.root(() => {
			const mine = setup(5)
			mine.load()
			expect(mine.view.isOwner).toBe(true)
			const other = setup(6)
			other.load()
			expect(other.view.isOwner).toBe(false)
		})
		cleanup()
	})

	it("isGenerating is true while a reply run is in flight", () => {
		const cleanup = $effect.root(() => {
			const { store, view, load } = setup()
			load()
			expect(view.isGenerating).toBe(false)
			store.mergeRunStatus({ sessionId: 1, runId: "r", kind: "reply", status: "s", reply: { channel: "main" } } as any)
			expect(view.isGenerating).toBe(true)
			store.mergeRunStatus({ sessionId: 1, runId: "r", kind: "reply", status: null } as any)
			expect(view.isGenerating).toBe(false)
		})
		cleanup()
	})

	it("cast, headerNotice and rewind are writable", () => {
		const cleanup = $effect.root(() => {
			const { view } = setup()
			view.cast = [{ id: 1 }] as any
			view.headerNotice = { text: "n" } as any
			view.rewind = { back: null } as any
			expect(view.cast).toHaveLength(1)
			expect((view.headerNotice as any).text).toBe("n")
			expect(view.rewind === null).toBe(false)
			view.rewind = null
			expect(view.rewind === null).toBe(true)
		})
		cleanup()
	})
})
