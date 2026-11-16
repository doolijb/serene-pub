/**
 * A remote widget's log (`remoteMessages.ts`) over cell rows: 50 content frames
 * on a 40-row window project and clone one row per frame, not forty, and the
 * values are what a fresh projection of every row gives, after every frame.
 */
import { describe, expect, it, vi } from "vitest"
import { flushSync } from "svelte"
import { projectMessageRow } from "@serene-pub/sdk"
import { createSessionStore } from "$lib/client/sessions/store/sessionStore.svelte"
import { createRemoteMessages } from "./remoteMessages.svelte"

const projected = vi.hoisted(() => ({ calls: 0 }))
vi.mock("@serene-pub/sdk", async (orig) => {
	const real = await orig<typeof import("@serene-pub/sdk")>()
	return {
		...real,
		projectMessageRow: (row: unknown) => (
			projected.calls++,
			real.projectMessageRow(row)
		)
	}
})

const N = 40
const FRAMES = 50
const pag = { hasMore: false, olderIn: [] } as any

const rowAt = (i: number, extra: Record<string, unknown> = {}) =>
	({
		id: i,
		sessionId: 1,
		channel: "main",
		role: i % 2 ? "user" : "assistant",
		content: `line ${i}`,
		metadata: null,
		isGenerating: false,
		debugMeta: { prompt: "secret" },
		embedding: [0.1, 0.2],
		updatedAt: "2026-11-13T00:00:00.000Z",
		...extra
	}) as any

const frame = (n: number) =>
	rowAt(N, {
		isGenerating: true,
		content: "x".repeat(n),
		metadata: { reasoning: `r${n}` }
	})

function opened() {
	const s = createSessionStore()
	s.open(1)
	s.load(
		{
			id: 1,
			name: "S",
			rewind: { ahead: 0, back: null, forward: null, regenerate: null },
			sessionMessages: Array.from({ length: N }, (_, k) => rowAt(k + 1)),
			sessionCharacters: [],
			sessionPersonas: []
		} as any,
		pag
	)
	return s
}

describe("the log a remote widget is handed", () => {
	it("50 content frames on a 40-row window: one row projected per frame, the same values", () => {
		const s = opened()
		const reuse = createRemoteMessages()
		let derivedRuns = 0
		let held!: unknown[]
		let before!: unknown[]
		const stop = $effect.root(() => {
			const rows = $derived(s.messagesOf(1))
			const messages = $derived((derivedRuns++, reuse(rows)))
			// The formulation it replaced: every row projected and the lot cloned.
			const old = $derived(
				$state.snapshot(rows.map(projectMessageRow)) as unknown[]
			)
			$effect(() => {
				held = messages
				before = old
			})
		})
		flushSync()
		const start = projected.calls
		expect(start).toBe(N + N)
		let oldCost = 0
		for (let n = 1; n <= FRAMES; n++) {
			const mark = projected.calls
			s.upsertMessage(frame(n))
			flushSync()
			// This frame's calls: the reuse's one plus the replaced code's forty.
			oldCost += projected.calls - mark - 1
			const fresh = $state.snapshot(
				s.messagesOf(1).map(projectMessageRow)
			)
			expect(held).toEqual(fresh)
			expect(before).toEqual(fresh)
			expect(held.at(-1)).toMatchObject({
				content: "x".repeat(n),
				metadata: { reasoning: `r${n}` }
			})
			expect(held[0]).not.toHaveProperty("debugMeta")
		}
		const total = projected.calls - start
		console.log(
			`[remoteMessages] projectMessageRow over ${FRAMES} frames: before ${oldCost}, after ${FRAMES}`
		)
		expect(derivedRuns).toBe(1 + FRAMES)
		expect(oldCost).toBe(FRAMES * N)
		// What `fresh` and the old derived cost is test overhead; the reuse's own is one a frame.
		expect(total).toBeGreaterThan(FRAMES)
		stop()
	})

	it("a plain row changed in place is read afresh, never served from a stale copy", () => {
		const reuse = createRemoteMessages()
		const row = { id: 1, content: "a", embedding: [1] }
		expect(reuse([row])).toEqual([{ id: 1, content: "a" }])
		row.content = "ab"
		expect(reuse([row])).toEqual([{ id: 1, content: "ab" }])
	})
})
