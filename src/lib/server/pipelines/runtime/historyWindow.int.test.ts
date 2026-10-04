/**
 * The history window (2026-10-03): a 150-message session, turn after turn.
 *
 * `session-history` read a fixed 100 rows, so once a session passed 100
 * messages the read itself dropped a line off the front every turn — on a
 * window that held them all, and on one that did not, before the transcript
 * fit ever saw the rows — and a backend that reuses its cache only on an
 * exact prefix (a hybrid model on KoboldCPP) reprocessed the whole prompt.
 * Wired to the run's budget, the read takes about twice what the window
 * holds, and the first line is the transcript fit's to decide: it stays put
 * until the conversation outgrows the held cut, then moves by a chunk.
 *
 * The real path end to end, minus the model: the host's `session_messages`
 * read on a test database, the `session-history` binding, `process-messages`
 * and the shipped template through `assemble` with a counter.
 */

import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { createHost } from "$lib/server/pipelines/runtime/host"
import * as schema from "$lib/server/db/schema"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { resetHeldCuts } from "$lib/server/pipelines/prompt/transcriptFit"

let db: TestDb
let userId: number

const count = (t: string) => Math.ceil(t.length / 4)
const node = { key: "history", definitionId: "core:query/session-history@1" } as any

/** About 25 tokens a line, numbered so a line's place is in its text. */
const line = (n: number) => `Line ${n}: ` + "words ".repeat(15)

async function newSession(messages: number): Promise<{ sessionId: number; next: number }> {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	await db.insert(schema.sessionMessages).values(
		Array.from({ length: messages }, (_, i) => ({
			sessionId: session.id,
			role: i % 2 ? "assistant" : "user",
			content: line(i + 1),
			isGenerating: false
		})) as any
	)
	return { sessionId: session.id, next: messages + 1 }
}

async function say(sessionId: number, n: number) {
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: (n - 1) % 2 ? "assistant" : "user",
		content: line(n),
		isGenerating: false
	} as any)
}

/** One turn's prompt: the history read (sized by `total` unless null), then assemble. */
async function turn(sessionId: number, total: number, opts: { sized?: boolean } = {}) {
	const { coreBindings } = await import("$lib/server/pipelines/runtime/bindings")
	const b = coreBindings()
	const host = createHost(db, { sessionId })
	const ctx = {
		read: (t: string, q: unknown) => host.read!(t, q, node),
		status: () => {},
		countTokens: count
	} as any
	const read: any = await b["core:query/session-history@1"]!(
		{
			scope: { sessionId },
			...(opts.sized === false ? {} : { budget: { total } }),
			params: {}
		},
		ctx
	)
	expect(read.kind).toBe("ok")
	const rows = read.value.messages as Array<{ id: number }>
	const lines: any = await b["core:task/process-messages@1"]!(
		{ messages: rows, cast: {}, templateContext: { char: "Aria", user: "Jody" } },
		ctx
	)
	const assembled: any = await b["core:task/assemble@2"]!(
		{
			template: { source: SHIPPED_CONTEXT_TEMPLATE, engine: CORE_TEMPLATE_ENGINE },
			decisions: [],
			messages: lines.value.messages,
			budget: { total },
			templateContext: { instructions: "You're Aria." },
			connection: { metadata: { wireMode: "chat", midSystem: "fold" } }
		},
		ctx
	)
	expect(assembled.kind).toBe("ok")
	const first = assembled.value.context.messages.find((m: any) => m.role !== "system")
		?.content as string
	return {
		rows,
		first: Number(/Line (\d+):/.exec(first)?.[1]),
		fit: assembled.value.transcriptFit as { held: boolean; dropped: number } | undefined
	}
}

beforeAll(async () => {
	db = await createTestDb()
	const [user] = await db
		.insert(schema.users)
		.values({ username: "history-window", isAdmin: false })
		.returning()
	userId = user.id
}, 120_000)

describe("the history window — a 150-message session, turn after turn", () => {
	it("the old count window moved its front every turn past 100 messages", async () => {
		const { sessionId, next } = await newSession(150)
		const a = await turn(sessionId, 100_000, { sized: false })
		await say(sessionId, next)
		const b = await turn(sessionId, 100_000, { sized: false })
		// The defect, kept visible: 100 rows, and the first one moved by one.
		expect(a.rows).toHaveLength(100)
		expect(b.first).toBe(a.first + 1)
	}, 60_000)

	it("a window that holds the whole session reads it all, and the first line never moves", async () => {
		resetHeldCuts()
		const { sessionId, next } = await newSession(150)
		for (let n = next; n < next + 6; n++) {
			const t = await turn(sessionId, 100_000)
			expect(t.rows.length).toBe(n - 1)
			expect(t.rows.length).toBeGreaterThan(100)
			expect(t.first).toBe(1)
			expect(t.fit).toBeUndefined()
			await say(sessionId, n)
		}
	}, 120_000)

	it("a window that binds keeps the same first line until the chunk cut, then moves by a chunk", async () => {
		resetHeldCuts()
		const { sessionId, next } = await newSession(150)
		const firsts: number[] = []
		const held: boolean[] = []
		for (let n = next; n < next + 16; n++) {
			const t = await turn(sessionId, 1000)
			// Sized by the window: past what fits (the fit cut some), and far
			// short of every row.
			expect(t.fit).toBeDefined()
			expect(t.fit!.dropped).toBeGreaterThan(0)
			expect(t.rows.length).toBeLessThan(100)
			firsts.push(t.first)
			held.push(t.fit!.held)
			await say(sessionId, n)
		}
		const moves = firsts
			.slice(1)
			.map((f, i) => f - firsts[i])
			.filter((d) => d !== 0)
		// The front moved at most twice in sixteen turns, never backwards, and
		// every move was a chunk — never the one line a turn the count window
		// cost on every turn.
		expect(moves.length, JSON.stringify(firsts)).toBeGreaterThanOrEqual(1)
		expect(moves.length, JSON.stringify(firsts)).toBeLessThanOrEqual(2)
		for (const d of moves) expect(d).toBeGreaterThan(3)
		// Between the cuts, each turn kept the cut an earlier turn made.
		const heldTurns = firsts.slice(1).filter((f, i) => f === firsts[i]).length
		expect(heldTurns).toBeGreaterThanOrEqual(10)
		expect(held.filter(Boolean).length).toBe(heldTurns)
	}, 180_000)
})
