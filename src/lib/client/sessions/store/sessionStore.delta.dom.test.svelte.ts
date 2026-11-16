import { describe, expect, it } from "vitest"
import { flushSync } from "svelte"
import { createSessionStore, sourceOf } from "./sessionStore.svelte"

const N = 5
const pag = { hasMore: false, olderIn: [] } as any

function rowAt(i: number, extra: Record<string, unknown> = {}) {
	return {
		id: i,
		sessionId: 1,
		channel: "main",
		role: i % 2 ? "user" : "assistant",
		content: `line ${i}`,
		metadata: null,
		isGenerating: false,
		updatedAt: "2026-11-13T00:00:00.000Z",
		...extra
	} as any
}

function payload() {
	const rows = Array.from({ length: N }, (_, k) => rowAt(k + 1))
	rows[N - 1] = rowAt(N, {
		role: "assistant",
		isGenerating: true,
		content: ""
	})
	return {
		id: 1,
		name: "S",
		rewind: { ahead: 0, back: null, forward: null, regenerate: null },
		sessionMessages: rows,
		sessionCharacters: [],
		sessionPersonas: []
	} as any
}

/** The page's `rows` derived: one array per window, as the page holds it. */
function watched(s: ReturnType<typeof createSessionStore>) {
	const v: { rows: any[] } = { rows: [] }
	const stop = $effect.root(() => {
		const rows = $derived(s.messagesOf(1))
		$effect(() => {
			v.rows = rows
		})
	})
	flushSync()
	return { v, stop }
}

function opened() {
	const s = createSessionStore()
	s.open(1)
	s.load(payload(), pag)
	return s
}

const d = (
	id: number,
	content: string,
	reasoning: string | null,
	sessionId = 1
) => ({
	sessionId,
	id,
	content,
	reasoning
})

describe("sessionStore.applyMessageDelta", () => {
	it("patches the held row in place across 20 deltas, then the settled row equals a fresh load", () => {
		const s = opened()
		const { v, stop } = watched(s)
		const rows = v.rows
		const row = rows.at(-1)!
		let lastReasoning: string | null = null
		let prevSource = sourceOf(row)
		for (let n = 1; n <= 20; n++) {
			const reasoning = n % 3 === 0 ? null : `r${n}`
			if (reasoning !== null) lastReasoning = reasoning
			const done = s.applyMessageDelta(d(N, "x".repeat(n), reasoning))
			flushSync()
			expect(done?.row).toBe(row)
			expect(done?.previous.content).toBe("x".repeat(n - 1))
			expect(v.rows).toBe(rows)
			expect(v.rows.at(-1)).toBe(row)
			expect(row.content).toBe("x".repeat(n))
			expect((row.metadata as any).reasoning).toBe(lastReasoning)
			const next = sourceOf(row)
			expect(next).not.toBe(prevSource)
			prevSource = next
		}
		const settled = rowAt(N, {
			role: "assistant",
			content: "x".repeat(20),
			isGenerating: false,
			metadata: { reasoning: "final", swipes: ["a", "b"] },
			updatedAt: "2026-11-13T00:01:00.000Z"
		})
		s.upsertMessage(settled)
		const fresh = createSessionStore()
		fresh.open(1)
		const p = payload()
		p.sessionMessages[N - 1] = settled
		fresh.load(p, pag)
		expect({ ...s.messagesOf(1).at(-1) }).toEqual({
			...fresh.messagesOf(1).at(-1)
		})
		flushSync()
		expect(v.rows).toBe(rows)
		expect(s.messagesOf(1).at(-1)).toBe(row)
		stop()
	})

	it("drops a delta for an id the store does not hold", () => {
		const s = opened()
		const { v, stop } = watched(s)
		const rows = v.rows
		const ids = rows.map((r) => r.id)
		expect(s.applyMessageDelta(d(99, "x", "r"))).toBeNull()
		flushSync()
		expect(v.rows).toBe(rows)
		stop()
		expect(s.messagesOf(1).map((r) => r.id)).toEqual(ids)
	})

	it("drops a delta that names another session", () => {
		const s = opened()
		expect(s.applyMessageDelta(d(N, "x", "r", 2))).toBeNull()
		expect(s.messagesOf(1).at(-1)!.content).toBe("")
	})

	it("never repaints a settled row", () => {
		const s = opened()
		expect(s.applyMessageDelta(d(2, "late", "r"))).toBeNull()
		expect(s.messagesOf(1)[1].content).toBe("line 2")
	})

	it("leaves null metadata null for a reasoning-less frame", () => {
		const s = opened()
		const done = s.applyMessageDelta(d(N, "hi", null))
		expect(done).not.toBeNull()
		expect(s.messagesOf(1).at(-1)!.content).toBe("hi")
		expect(s.messagesOf(1).at(-1)!.metadata).toBeNull()
	})
})
