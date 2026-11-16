import { describe, expect, it, vi } from "vitest"
import { flushSync } from "svelte"
import { createSessionStore, sourceOf } from "./sessionStore.svelte"
import { createOpenSessionView } from "./openSessionView.svelte"
import { generatingOf, lorebookFixedOf, rewindOf } from "./derive"
import { lastAuthorLine } from "$lib/client/components/sessionPage/swipeControls"

/** Calls of the two derive helpers the open-session view also runs (its `isGenerating` and `lorebookFixed` deriveds), page + view together. */
const calls = vi.hoisted(() => ({ generatingOf: 0, lorebookFixedOf: 0 }))
vi.mock("./derive", async (orig) => {
	const real = await orig<typeof import("./derive")>()
	return {
		...real,
		generatingOf: (...a: Parameters<typeof real.generatingOf>) => (
			calls.generatingOf++,
			real.generatingOf(...a)
		),
		lorebookFixedOf: (...a: Parameters<typeof real.lorebookFixedOf>) => (
			calls.lorebookFixedOf++,
			real.lorebookFixedOf(...a)
		)
	}
})

const N = 40
const FRAMES = 50
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

const frame = (n: number, extra: Record<string, unknown> = {}) =>
	rowAt(N, {
		role: "assistant",
		isGenerating: true,
		content: "x".repeat(n),
		metadata: { reasoning: `r${n}` },
		updatedAt: `2026-11-13T00:00:${String(n % 60).padStart(2, "0")}.000Z`,
		...extra
	})

/** The page's derived chain (sessionPageData.svelte.ts ~100-482), each with a counter. */
function chain(store: ReturnType<typeof createSessionStore>) {
	const c = {
		rows: 0,
		session: 0,
		lastMessage: 0,
		hasGeneratingMessage: 0,
		generating: 0,
		lastAuthorLine: 0,
		rewind: 0,
		lorebookFixed: 0,
		lastSettledMessageKey: 0
	}
	const v: Record<string, any> = {}
	const view = createOpenSessionView({ store, userId: () => 1 })
	const stop = $effect.root(() => {
		const record = $derived(store.session(1))
		const rows = $derived.by(
			() => (c.rows++, record ? store.messagesOf(1) : [])
		)
		const session = $derived.by(
			() => (
				c.session++,
				record ? { ...record, sessionMessages: rows } : undefined
			)
		)
		const lastMessage = $derived.by(() => {
			c.lastMessage++
			return session && session.sessionMessages.length > 0
				? session.sessionMessages[session.sessionMessages.length - 1]
				: undefined
		})
		const has = $derived.by(
			() => (
				c.hasGeneratingMessage++,
				session?.sessionMessages?.some((m: any) => m.isGenerating) ||
					false
			)
		)
		const generating = $derived.by(
			() => (
				c.generating++,
				!session || generatingOf(rows, store.runsOf(1))
			)
		)
		const author = $derived.by(
			() => (
				c.lastAuthorLine++,
				lastAuthorLine(session?.sessionMessages as any)
			)
		)
		const rewind = $derived.by(() => (c.rewind++, rewindOf(record, rows)))
		const fixed = $derived.by(
			() => (c.lorebookFixed++, lorebookFixedOf(record, rows))
		)
		const settled = $derived.by(
			() => (
				c.lastSettledMessageKey++,
				lastMessage && !lastMessage.isGenerating
					? `${lastMessage.id}:${lastMessage.content}`
					: null
			)
		)
		$effect(() => {
			v.rows = rows
			v.session = session
			v.lastMessage = lastMessage
			v.has = has
			v.generating = generating
			v.author = author
			v.rewind = rewind
			v.fixed = fixed
			v.settled = settled
			v.viewGenerating = view.isGenerating
			v.viewFixed = view.lorebookFixed
		})
	})
	flushSync()
	return { c, v, stop, view }
}

function opened() {
	const s = createSessionStore()
	s.open(1)
	s.load(payload(), pag)
	return s
}

/** What a fresh plain computation over plain copies of the held rows gives. */
function plain(s: ReturnType<typeof createSessionStore>) {
	const rows = s.messagesOf(1).map((r) => ({ ...r }))
	const record = { ...s.session(1)! }
	return {
		rows,
		lastMessage: rows.at(-1),
		has: rows.some((m) => m.isGenerating),
		generating: generatingOf(rows, []),
		author: lastAuthorLine(rows as any),
		rewind: rewindOf(record as any, rows),
		fixed: lorebookFixedOf(record as any, rows),
		settled:
			rows.at(-1) && !rows.at(-1)!.isGenerating
				? `${rows.at(-1)!.id}:${rows.at(-1)!.content}`
				: null
	}
}

function delta(c: Record<string, number>, base: Record<string, number>) {
	return Object.fromEntries(
		Object.entries(c).map(([k, x]) => [k, x - base[k]])
	)
}

function expectValues(
	s: ReturnType<typeof createSessionStore>,
	v: Record<string, any>
) {
	const p = plain(s)
	expect(v.rows.map((r: any) => ({ ...r }))).toEqual(p.rows)
	expect(v.session.sessionMessages).toBe(v.rows)
	expect(v.lastMessage).toBe(v.rows.at(-1))
	expect(v.has).toBe(p.has)
	expect(v.generating).toBe(p.generating)
	expect(v.author?.id).toBe(p.author?.id)
	expect(v.rewind).toEqual(p.rewind)
	expect(v.fixed).toBe(p.fixed)
	expect(v.settled).toBe(p.settled)
	expect(v.viewGenerating).toBe(p.generating)
	expect(v.viewFixed).toBe(p.fixed)
}

describe("streaming frames patch a held row in place", () => {
	it("50 content frames rerun nothing but what reads content", () => {
		const s = opened()
		const { c, v, stop } = chain(s)
		const rowsBefore = v.rows
		const rowBefore = v.rows.at(-1)
		const base = { ...c }
		const baseCalls = { ...calls }
		for (let n = 1; n <= FRAMES; n++) {
			s.upsertMessage(frame(n))
			flushSync()
		}
		expect(v.rows).toBe(rowsBefore)
		expect(s.messagesOf(1).at(-1)).toBe(rowBefore)
		const d = delta(c, base)
		for (const k of [
			"rows",
			"session",
			"lastMessage",
			"hasGeneratingMessage",
			"generating",
			"lastAuthorLine",
			"rewind",
			"lorebookFixed"
		])
			expect(d[k], k).toBe(0)
		// The open-session view's isGenerating / lorebookFixed deriveds (page's included).
		expect(calls.generatingOf - baseCalls.generatingOf).toBe(0)
		expect(calls.lorebookFixedOf - baseCalls.lorebookFixedOf).toBe(0)
		expect(rowBefore.content).toBe("x".repeat(FRAMES))
		expect(rowBefore.metadata).toEqual({ reasoning: `r${FRAMES}` })
		expectValues(s, v)
		stop()
	})

	it("a settling frame reruns the readers of isGenerating, with right values", () => {
		const s = opened()
		const { c, v, stop } = chain(s)
		for (let n = 1; n <= 5; n++) {
			s.upsertMessage(frame(n))
			flushSync()
		}
		const base = { ...c }
		s.upsertMessage(frame(6, { isGenerating: false }))
		flushSync()
		const d = delta(c, base)
		expect(d.rows).toBe(0)
		expect(d.hasGeneratingMessage).toBe(1)
		expect(d.generating).toBe(1)
		expect(d.lastSettledMessageKey).toBe(1)
		expect(v.has).toBe(false)
		expect(v.generating).toBe(false)
		expect(v.viewGenerating).toBe(false)
		expect(v.settled).toBe(`${N}:${"x".repeat(6)}`)
		expectValues(s, v)
		stop()
	})

	it("a frame whose keys differ replaces the row (and rewakes the rows)", () => {
		const s = opened()
		const { c, v, stop } = chain(s)
		const rowsBefore = v.rows
		const rowBefore = v.rows.at(-1)
		const base = { ...c }
		const { updatedAt, ...fewer } = frame(3)
		s.upsertMessage(fewer as any)
		flushSync()
		expect(c.rows - base.rows).toBe(1)
		expect(v.rows).not.toBe(rowsBefore)
		expect(v.rows.at(-1)).not.toBe(rowBefore)
		expect(Object.keys(v.rows.at(-1))).not.toContain("updatedAt")
		expect(v.rows.at(-1).content).toBe("xxx")
		expectValues(s, v)
		stop()
	})

	it("previous is the pre-patch snapshot; sourceOf is the latest incoming object", () => {
		const s = opened()
		const first = frame(2)
		const second = frame(5)
		const a = s.upsertMessage(first)!
		const held = s.messagesOf(1).at(-1)!
		expect(a.added).toBe(false)
		expect(a.previous!.content).toBe("")
		expect(a.previous!.isGenerating).toBe(true)
		expect(Object.getPrototypeOf(a.previous)).toBe(Object.prototype)
		expect(sourceOf(held)).toBe(first)
		const b = s.upsertMessage(second)!
		expect(b.previous!.content).toBe("xx")
		expect(held.content).toBe("xxxxx")
		expect(sourceOf(held)).toBe(second)
		expect(s.messagesOf(1).at(-1)).toBe(held)
		const plainRow = { id: 1 }
		expect(sourceOf(plainRow)).toBe(plainRow)
	})

	it("cell rows read like plain ones: spread, JSON, structuredClone, snapshot", () => {
		const s = opened()
		s.upsertMessage(frame(4))
		const held = s.messagesOf(1).at(-1)!
		const expected = frame(4)
		expect(Object.getPrototypeOf(held)).toBe(Object.prototype)
		expect({ ...held }).toEqual(expected)
		expect(JSON.parse(JSON.stringify(held))).toEqual(expected)
		expect(structuredClone({ ...held })).toEqual(expected)
		expect(Object.keys(held)).toEqual(Object.keys(expected))
		expect($state.snapshot(held)).toEqual(expected)
	})

	it("merge and load patch a held row in place", () => {
		const s = opened()
		const rowsBefore = s.messagesOf(1)
		const held = rowsBefore.at(-1)!
		const added = s.merge(
			{ id: 1, sessionMessages: [frame(7), rowAt(N + 1)] } as any,
			N
		)
		expect(added.map((r) => r.id)).toEqual([N + 1])
		expect(s.messagesOf(1).at(-2)).toBe(held)
		expect(held.content).toBe("xxxxxxx")
		const after = s.messagesOf(1)
		s.merge({ id: 1, sessionMessages: [] } as any, null)
		expect(s.messagesOf(1)).toEqual([])
		s.load(payload(), pag)
		const loaded = s.messagesOf(1)
		s.load(payload(), pag)
		expect(s.messagesOf(1).at(-1)).toBe(loaded.at(-1))
		expect(after.length).toBe(N + 1)
	})
})
