/**
 * The batch clamp, end to end, on the configuration people actually have.
 *
 * The unit tests prove the arithmetic and the binding. This proves the part
 * neither of them can: that the window **arrives**. The control is only real if
 * `sampling` resolves through the normal slot path on an install that set up a
 * connection and never opened the pipeline panel — which is the first-run state
 * and the one the overflow bug lives in.
 *
 * ⚠ It did not arrive, and the reason was invisible. A `sampling` slot with no
 * per-step pick resolved to `{}` in the executor while `dispatchStep` still sent
 * the call against the instance default's window — so the cutter clamped against
 * nothing while the prompt went out against 2048. Every Provider only *forwards*
 * its sampling (the host reduces it back to a row id), so no existing node could
 * tell the difference; the batch cutter is the first node that reads the values.
 * `world.activeSampling` and the executor's fallback beside `activeConnection`
 * are what close it.
 */

import { describe, it, expect, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { BATCH_RESERVE_TOKENS } from "$lib/server/utils/summarizer/batchBudget"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/** Every prompt the fake model was handed, with the window it was sent against. */
const calls: Array<{ userPrompt: string; tokenLimit: number }> = []

class FakeStepAdapter {
	/** The composed stop list, handed over at construction. */
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	private user: string
	private limit: number
	constructor(p: any) {
		this.user = p?.session?.sessionMessages?.[0]?.content ?? ""
		this.limit = p?.tokenLimit
	}
	abort() {}
	async preflight() {}
	async generateText() {
		calls.push({ userPrompt: this.user, tokenLimit: this.limit })
		return {
			compiledPrompt: {
				prompt: undefined,
				messages: undefined,
				meta: {} as any
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent("<content>They went under the gate.</content>")
			}
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeStepAdapter })
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

/**
 * A booted instance with one connection and one sampling config registered as
 * the `text->text` default — and **nothing chosen in the pipeline panel**, which
 * is the whole point.
 */
async function instanceWithWindow(contextTokens: number, messages: number) {
	const db: TestDb = await createTestDb()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: `budget-${contextTokens}`, isAdmin: false })
		.returning()
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ name: "Lore", userId: user.id })
		.returning()
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId: user.id, isGroup: false, lorebookId: lorebook.id })
		.returning()
	await db.insert(schema.sessionMessages).values(
		Array.from({ length: messages }, (_, i) => ({
			sessionId: session.id,
			role: "user" as const,
			content: `${i}: ${"the gate was sealed with old iron. ".repeat(12)}`
		}))
	)

	const [connection] = await db
		.insert(schema.connections)
		.values({ name: "Fake", type: "koboldcpp", baseUrl: "http://x" })
		.returning()
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: `Window ${contextTokens}`,
			isImmutable: false,
			values: { contextTokens, responseTokens: 200 },
			enabled: ["contextTokens", "responseTokens"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: connection.id,
		samplingConfigId: sampling.id
	})

	return { db, sessionId: session.id, userId: user.id }
}

async function summarize(ctx: {
	db: TestDb
	sessionId: number
	userId: number
}) {
	const { runSpec } = await import("$lib/server/pipelines/runtime/runTurn")
	const { SUMMARIZE_WORLD_SPEC_ID } = await import(
		"$lib/server/pipelines/specs/summarize"
	)
	return (await runSpec({
		db: ctx.db,
		sessionId: ctx.sessionId,
		userId: ctx.userId,
		specId: SUMMARIZE_WORLD_SPEC_ID,
		input: { scope: { sessionId: ctx.sessionId }, request: {} },
		preview: { atNode: "save" },
		skipReceipt: true
	})) as any
}

describe("the instance default's window reaches the cut", () => {
	it("cuts a narrow window into more batches than a wide one", async () => {
		// The clamp, observable from outside. Same messages, same untouched
		// pipeline, two instance defaults: 3000 tokens leaves 1500 for chat after
		// the reserve, which is under the declared 2560, so the cut must narrow —
		// and 32768 leaves far more, so it must not widen past 2560.
		//
		// ⚠ This is the assertion that fails when the window does not reach the
		// cutter. With `sampling` resolving to `{}` both runs cut identically at
		// the declared size, and the narrow one then sent every batch into a
		// window that could not hold it.
		calls.length = 0
		const narrow = await instanceWithWindow(3000, 60)
		expect((await summarize(narrow)).haltNodeKey).toBe("save")
		const narrowDrafts = calls.filter((c) =>
			c.userPrompt.includes("old iron")
		)

		calls.length = 0
		const wide = await instanceWithWindow(32768, 60)
		expect((await summarize(wide)).haltNodeKey).toBe("save")
		const wideDrafts = calls.filter((c) => c.userPrompt.includes("old iron"))

		expect(wideDrafts.length).toBeGreaterThan(1)
		expect(narrowDrafts.length).toBeGreaterThan(wideDrafts.length)

		// And every narrow batch really fits: the prompt it sent, plus the
		// response the config allows, inside the window it was sent against.
		// That is what the reserve exists to guarantee.
		for (const draft of narrowDrafts) {
			expect(draft.tokenLimit).toBe(3000)
			expect(
				Math.ceil(draft.userPrompt.length / 4) + 200
			).toBeLessThanOrEqual(3000)
		}
		// The wide window does not widen the batch past the declared size — the
		// clamp is a ceiling, not a target.
		for (const draft of wideDrafts)
			expect(Math.ceil(draft.userPrompt.length / 4)).toBeLessThan(
				2560 + 500
			)
	})

	it("halts before the first call when the window cannot hold a batch at all", async () => {
		// The live overflow, in the shape a person meets it: a small local model
		// registered as the instance default and a pipeline nobody has touched.
		// Before the clamp this sent batch after batch of ~2596 tokens of chat
		// plus a template into a 1024-token window.
		calls.length = 0
		const ctx = await instanceWithWindow(1024, 20)
		const receipt = await summarize(ctx)

		expect(receipt.haltNodeKey).toBe("batches")
		expect(String(receipt.haltReason)).toContain("1024")
		// Nothing was sent. A halt that still spent the calls would be no fix.
		expect(calls).toEqual([])
	})
})
