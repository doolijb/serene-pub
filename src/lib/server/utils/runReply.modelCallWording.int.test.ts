/**
 * A reply whose run ended at a model call: a non-administrator's progress card
 * and refusal carry the plain sentence (no reason, no step name) and the stored
 * row of a verb keeps the reason only in `connection.detail`; any other halt
 * keeps its text for everyone.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

const REASON =
	"KoboldCPP API error at http://10.0.0.5:5001/api/v1/generate: model 'mistral-7b.Q4_K_M.gguf' not loaded (respond.generate)"
const PLAIN = "The reply could not be generated. An administrator can see the details."

const next = vi.hoisted(() => ({ receipt: null as any, throws: null as unknown }))
vi.mock("$lib/server/pipelines/runtime/runTurn", async (importOriginal) => {
	const actual = await importOriginal<any>()
	return { ...actual, runTurn: vi.fn(async () => {
			if (next.throws) throw next.throws
			return next.receipt
		})
	}
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-reply-wording-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(testDb as any)
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const receipt = (
	outcome: "err" | "halt",
	node: Record<string, unknown>,
	haltReason: string,
	extra: Record<string, unknown> = {}
) => ({
	runId: "r",
	specId: "core:spec/message-respond",
	outcome,
	haltReason,
	haltNodeKey: node.nodeKey,
	nodes: [{ definitionId: "d", seq: 1, ...node }],
	...extra
})

async function reply(isAdmin: boolean, kind: "narrate" | "regenerate", archived = false) {
	const schema = await import("$lib/server/db/schema")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `u-${Math.random().toString(36).slice(2)}`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: false,
			genreId: "core:genre/story",
			...(archived ? { archivedAt: new Date() } : {})
		})
		.returning()
	let messageId = 0
	if (kind === "regenerate") {
		const [m] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "assistant", content: "x", isGenerating: true } as any)
			.returning()
		messageId = m.id
	}
	const frames: any[] = []
	const { runReply } = await import("./runReply")
	const outcome = await runReply({
		socket: { user: { id: user.id, isAdmin }, io: { to: () => ({ emit: () => {} }) } },
		emitToUser: (event: string, data: any) => {
			if (event === "pipelines:progress") frames.push(data)
		},
		sessionId: session.id,
		userId: user.id,
		turn: kind === "narrate" ? { kind: "narrate", instructions: "go" } : { kind: "regenerate", messageId }
	} as any)
	const row = messageId
		? await testDb.query.sessionMessages.findFirst({ where: eq(schema.sessionMessages.id, messageId) })
		: null
	return { outcome, terminal: frames.find((f) => f.done), row, userId: user.id, sessionId: session.id }
}

describe("runReply: a model call's failure", () => {
	test("a non-administrator's refusal, card and stored row carry no reason and no step name", async () => {
		next.receipt = receipt("err", { nodeKey: "respond.generate", kind: "oracle", result: "err" }, REASON)
		for (const kind of ["narrate", "regenerate"] as const) {
			const { outcome, terminal, row } = await reply(false, kind)
			expect(outcome.error).toBe(PLAIN)
			expect(terminal.error).toBe(PLAIN)
			expect(terminal.haltNodeKey).toBeUndefined()
			expect(terminal.haltStep).toBeUndefined()
			expect(JSON.stringify([outcome.error, terminal])).not.toMatch(/10\.0\.0\.5|gguf|respond\.generate/)
			if (row) expect((row.error as any).message).not.toMatch(/10\.0\.0\.5|gguf/)
		}
	}, 60_000)

	test("an administrator reads the reason; the stored row keeps it in the detail", async () => {
		next.receipt = receipt("err", { nodeKey: "respond.generate", kind: "oracle", result: "err" }, REASON)
		const { outcome, terminal, row } = await reply(true, "regenerate")
		expect(outcome.error).toBe(REASON)
		expect(terminal.error).toBe(REASON)
		expect((row!.error as any).connection.detail).toContain("10.0.0.5")
	}, 60_000)

	test("a review rejection, a seat-name refusal and owner-only rules read the same for everyone", async () => {
		const cases: Array<[string, Record<string, unknown>, "err" | "halt", Record<string, unknown>]> = [
			[
				"rejected at review",
				{ nodeKey: "respond.generate", kind: "oracle", result: "halt" },
				"halt",
				{ reviews: [{ action: "reject", nodeKey: "respond.generate" }] }
			],
			[
				"That name is taken by another seat.",
				{ nodeKey: "save", kind: "effect", result: "err" },
				"err",
				{ meta: { peopleSentence: "That name is taken by another seat." } }
			],
			[
				"Only the session's owner can change its rules.",
				{ nodeKey: "rules", kind: "effect", result: "err" },
				"err",
				{ meta: { peopleSentence: "Only the session's owner can change its rules." } }
			]
		]
		for (const [reason, node, outcome, extra] of cases) {
			next.receipt = receipt(outcome, node, reason, extra)
			for (const isAdmin of [false, true]) {
				const got = await reply(isAdmin, "narrate")
				expect(got.outcome.error).toBe(reason)
				expect(got.terminal.error).toBe(reason)
				expect(got.terminal.haltNodeKey).toBeUndefined()
				expect(got.terminal.haltStep).toBeUndefined()
			}
		}
	}, 60_000)

	test("a wiring halt naming a step and a spec: a non-administrator reads the plain sentence and no step; an administrator reads the reason", async () => {
		const wiring = "assemble: no published version of 'core:spec/story-respond'"
		next.receipt = receipt("halt", { nodeKey: "assemble", kind: "effect", result: "halt" }, wiring)
		for (const kind of ["narrate", "regenerate"] as const) {
			const got = await reply(false, kind)
			expect(got.outcome.error).toBe(PLAIN)
			expect(got.terminal.error).toBe(PLAIN)
			expect(got.terminal.haltNodeKey).toBeUndefined()
			expect(got.terminal.haltStep).toBeUndefined()
		}
		const admin = await reply(true, "narrate")
		expect(admin.outcome.error).toBe(wiring)
		expect(admin.terminal.haltNodeKey).toBe("assemble")
	}, 60_000)
})

/**
 * DG3 (2026-11-17): "For the future, never publish raw errors directly to the
 * message body." A halt's reason is a step's or a binding's own words; the row
 * stores a sentence core wrote, and the reason stays on the receipt / run record.
 */
describe("runReply: the stored row of a halt that is not a model call", () => {
	const STEP_REASON =
		"node 'respond.guard' of core:spec/message-respond@3 refused: no published version of 'core:spec/story-respond'"
	const leaks = /respond\.guard|core:spec|published version/

	test("the row and the notification carry the plain sentence, not the reason; the receipt keeps it", async () => {
		const schema = await import("$lib/server/db/schema")
		const { plainReplyFailure } = await import("$lib/server/pipelines/runtime/haltExplanation")
		next.receipt = receipt("err", { nodeKey: "respond.guard", kind: "effect", result: "err" }, STEP_REASON)
		for (const isAdmin of [false, true]) {
			const got = await reply(isAdmin, "regenerate")
			const stored = (got.row!.error as any).message
			expect(stored).toBe(plainReplyFailure())
			expect(JSON.stringify(got.row!.error)).not.toMatch(leaks)
			const notes = await testDb
				.select()
				.from(schema.notifications)
				.where(eq(schema.notifications.userId, got.userId))
			expect(notes.length).toBeGreaterThan(0)
			expect(JSON.stringify(notes.map((n) => n.vars))).not.toMatch(leaks)
			expect(JSON.stringify(notes.map((n) => n.vars))).toContain(plainReplyFailure().slice(0, 30))
			// The administrator's reading of the reason is untouched.
			expect((got.outcome as any).receipt.haltReason).toBe(STEP_REASON)
			if (isAdmin) expect(got.outcome.error).toBe(STEP_REASON)
		}
	}, 60_000)

	test("a model call failing with a composed sentence that names plumbing: the row, the notification and the refusal read plain for a non-administrator and carry the sentence for an administrator", async () => {
		const schema = await import("$lib/server/db/schema")
		const { ComposedError, withoutConnectionIdentity } = await import(
			"$lib/server/connections/visibility"
		)
		const { plainReplyFailure } = await import("$lib/server/pipelines/runtime/haltExplanation")
		const sentences = [
			"No model is set for Reply, and one is never picked automatically. An admin chooses it with Use in Reply beside a model in Connections.",
			"The Reply loadout's first model 'Mistral 7B' is not installed on Studio."
		]
		for (const sentence of sentences) {
			next.throws = new ComposedError(sentence)
			try {
				for (const isAdmin of [false, true]) {
					const got = await reply(isAdmin, "regenerate")
					const stored = got.row!.error as any
					expect(stored.message).toBe(plainReplyFailure())
					expect(stored.connection.detail).toContain(sentence)
					// Serialised per reader: the detail is the administrator's.
					const forMember = JSON.stringify(withoutConnectionIdentity(stored))
					expect(forMember).not.toContain(sentence.slice(0, 25))
					expect(JSON.stringify(withoutConnectionIdentity(stored))).toContain(plainReplyFailure().slice(0, 30))
					expect(got.outcome.error).toBe(isAdmin ? sentence : plainReplyFailure())
					const notes = await testDb
						.select()
						.from(schema.notifications)
						.where(eq(schema.notifications.userId, got.userId))
					expect(JSON.stringify(notes.map((n) => n.vars))).not.toContain(sentence.slice(0, 25))
				}
			} finally {
				next.throws = null
			}
		}
	}, 60_000)

	test("an archived session's refusal stores its own sentence", async () => {
		const { SESSION_ARCHIVED_SENTENCE } = await import("$lib/shared/sessions/archive")
		const got = await reply(false, "regenerate", true)
		expect((got.row!.error as any).message).toBe(SESSION_ARCHIVED_SENTENCE)
	}, 60_000)

	test("a row stored before keeps the message it was stored with", async () => {
		const schema = await import("$lib/server/db/schema")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(testDb, `old-${Math.random().toString(36).slice(2)}`)
		const [session] = await testDb
			.insert(schema.sessions)
			.values({ userId: user.id, isGroup: false, genreId: "core:genre/story" })
			.returning()
		const old = { message: "halt at 'respond.guard' of core:spec/message-respond" }
		const [m] = await testDb
			.insert(schema.sessionMessages)
			.values({ sessionId: session.id, role: "assistant", content: "", error: old } as any)
			.returning()
		const read = await testDb.query.sessionMessages.findFirst({
			where: eq(schema.sessionMessages.id, m.id)
		})
		expect(read!.error).toEqual(old)
	}, 60_000)
})
