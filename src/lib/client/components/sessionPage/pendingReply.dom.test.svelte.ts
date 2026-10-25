/**
 * The session page's waiting rows, live (`pendingReply.svelte.ts`): what the
 * Story shows from a Dungeon Crawler story turn's first status frame until
 * the Narrator's row opens — and not again after (owner 2026-10-15).
 */
import { describe, expect, it } from "vitest"
import { flushSync } from "svelte"
import { createPendingReplies } from "./pendingReply.svelte"
import { createSessionStore } from "$lib/client/sessions/store/sessionStore.svelte"

type Row = { id: number; channel?: string | null; isGenerating?: boolean }
const say = (en: string) => ({ i18n: { en } })

function harness(sessionId = 7) {
	let rows = $state<Row[]>([{ id: 1, channel: "main", isGenerating: false }])
	let current = $state(sessionId)
	let pending!: ReturnType<typeof createPendingReplies>
	const store = createSessionStore()
	store.open(sessionId)
	const stop = $effect.root(() => {
		pending = createPendingReplies({
			sessionId: () => current,
			rows: () => rows,
			runs: () => store.runsOf(current)
		})
	})
	return {
		store,
		hear(frame: Record<string, unknown>) {
			store.mergeRunStatus({ ...frame, kind: "reply" } as any)
		},
		get pending() {
			return pending
		},
		setRows(next: Row[]) {
			rows = next
			flushSync()
		},
		switchTo(id: number) {
			current = id
			flushSync()
		},
		stop
	}
}

const statusOf = (r: any) => r.generationStatus?.i18n?.en

describe("createPendingReplies", () => {
	it("a story turn: waiting row from the first status, its words change, gone when the Narrator's row opens, never back", () => {
		const h = harness()
		flushSync()
		expect(h.pending.rows).toEqual([])

		h.hear({ sessionId: 7, runId: "r1", status: say("The Planner is thinking"), reply: { channel: "main" } })
		flushSync()
		expect(h.pending.rows.map(statusOf)).toEqual(["The Planner is thinking"])
		expect(h.pending.rows[0]).toMatchObject({ isGenerating: true, channel: "main" })

		h.hear({ sessionId: 7, runId: "r1", status: say("Rolling the dice"), reply: { channel: "main" } })
		flushSync()
		expect(h.pending.rows.map(statusOf)).toEqual(["Rolling the dice"])

		// The roll line lands (a finished row): still waiting, after it.
		h.setRows([
			{ id: 1, channel: "main", isGenerating: false },
			{ id: 2, channel: "main", isGenerating: false }
		])
		expect(h.pending.rows).toHaveLength(1)

		// The Narrator's row opens: the page's own row goes.
		h.setRows([
			{ id: 1, channel: "main", isGenerating: false },
			{ id: 2, channel: "main", isGenerating: false },
			{ id: 3, channel: "main", isGenerating: true }
		])
		expect(h.pending.rows).toEqual([])

		// It finishes while the run still files its books: no waiting row again.
		h.setRows([
			{ id: 1, channel: "main", isGenerating: false },
			{ id: 2, channel: "main", isGenerating: false },
			{ id: 3, channel: "main", isGenerating: false }
		])
		h.hear({ sessionId: 7, runId: "r1", status: say("The Narrator tells it"), reply: { channel: "main" } })
		flushSync()
		expect(h.pending.rows).toEqual([])

		// The run ends.
		h.hear({ sessionId: 7, runId: "r1", status: null, reply: { channel: "main" } })
		flushSync()
		expect(h.pending.rows).toEqual([])
		h.stop()
	})

	it("hears nothing that is not this session's reply, and forgets a session it left", () => {
		const h = harness()
		// Another session's reply; a run that is not a reply (a summary).
		h.hear({ sessionId: 8, runId: "x", status: say("The Planner is thinking"), reply: { channel: "main" } })
		h.hear({ sessionId: 7, runId: "s", status: say("summarising part 1 of 2") })
		flushSync()
		expect(h.pending.rows).toEqual([])

		h.hear({ sessionId: 7, runId: "r1", status: say("The Planner is thinking"), reply: { channel: "main" } })
		flushSync()
		expect(h.pending.rows).toHaveLength(1)
		h.store.open(9)
		h.switchTo(9)
		expect(h.pending.rows).toEqual([])
		h.stop()
	})

	it("a run stopped before its row opened: the end frame takes the waiting row away", () => {
		const h = harness()
		h.hear({ sessionId: 7, runId: "r1", status: say("The Planner is thinking"), reply: { channel: "main" } })
		flushSync()
		expect(h.pending.rows).toHaveLength(1)
		h.hear({ sessionId: 7, runId: "r1", status: null })
		flushSync()
		expect(h.pending.rows).toEqual([])
		h.stop()
	})

	it("a waiting row is drawn only for a run with a reply channel: an action run draws none", () => {
		const h = harness()
		h.store.mergeRunStatus({ sessionId: 7, runId: "a1", kind: "action", status: say("Rolling") } as any)
		flushSync()
		expect(h.pending.rows).toEqual([])
		h.stop()
	})
})
