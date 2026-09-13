/**
 * What the receipt says a reply DID, once the adapter has been and gone.
 *
 * ## The defect
 *
 * The reply road compiles with `runTurn({ preview: true })` and hands the
 * payload to the connection adapter, which sends it and streams the answer into
 * the message row. The receipt is stored before that send — so every Chat reply
 * this product has ever produced was filed as `outcome: "halt"`,
 * `haltReason: "preview: stopped before generate, nothing sent"`, `tokensSpent:
 * 0`, next to a message the adapter had just written and a service that had just
 * reported its token counts. Read back, the whole product looked like a pipeline
 * that never finishes and a generate node that never runs.
 *
 * The halt was true at the moment it was written and false by the time anybody
 * read it. `recordReplyOutcome` is the same kind of patch `recordGenerateStops`
 * and `recordGenerateWire` already make — the run's last word, written when
 * there is finally something to say.
 *
 * ## Driven through the real entry point
 *
 * `generateResponse` is what a socket handler calls, and the claim under test is
 * about the seam between it and the receipt. Only the model is a fake.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, desc, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let characterId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "reply-outcome-secret" }
})

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))

/**
 * Runs inside the turn, after the pipeline compiled and before the row is
 * claimed for a queue item — the window a Stop lands in while a long prompt is
 * still being assembled.
 */
let duringCompile: (() => Promise<void>) | null = null

vi.mock("$lib/server/pipelines/runtime/receipts", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/runtime/receipts")
		>()
	return {
		...actual,
		// The last call the turn awaits before that claim, which is what makes
		// the window reachable from a test at all.
		recordGenerateStops: async (
			...args: Parameters<typeof actual.recordGenerateStops>
		) => {
			await duringCompile?.()
			return await actual.recordGenerateStops(...args)
		}
	}
})

const REPLY = "The Ashguard ride at dawn."

/** How the service behaves on the next turn. One knob, set per test. */
let mode: "ok" | "cancel" | "fail" = "ok"
/** Runs mid-stream, for the cancellation case. */
let midStream: (() => Promise<void>) | null = null
/** How many requests the service was asked for. */
let sends = 0

/** The model, and only the model. Everything else below is the real thing. */
class FakeAdapter implements FakeTextAdapter {
	injected: any
	currentCharacterId: number | null
	promptBuilder: any = {}
	constructor(args: any) {
		this.currentCharacterId = args?.currentCharacterId ?? null
	}
	isAborting = false
	stops: any
	/** What the service said ended the reply, the way a real adapter reports it. */
	finishReason?: string
	lastExchange: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {
		this.isAborting = true
	}
	async preflight() {}
	async generateText() {
		sends++
		const { WireRecorder } = await import(
			"$lib/server/connectionAdapters/BaseConnectionAdapter"
		)
		const wire = new WireRecorder({
			url: "http://localhost:11434/api/chat",
			body: { model: "irrelevant" }
		})
		wire.received({ message: { content: REPLY } })
		wire.exchange.response.durationMs = 1234
		this.lastExchange = wire.exchange
		this.finishReason = "stop"

		if (mode === "fail") throw new Error("the model service said no")

		const common = {
			compiledPrompt: this.injected,
			isAborted: this.isAborting,
			tokensPrompt: 12,
			tokensCompletion: 34,
			// A BREAKDOWN of the 34, never an addition to it — the way
			// `completion_tokens_details.reasoning_tokens` reports it.
			tokensReasoning: 21
		}
		if (mode === "cancel")
			return {
				...common,
				completionResult: async (contentCb: (c: string) => void) => {
					contentCb("The Ashguard ")
					await midStream?.()
					if (this.isAborting) return
					contentCb("ride at dawn.")
				}
			}
		return { ...common, completionResult: REPLY }
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

const fakeSocket = () =>
	({
		user: { id: userId, isAdmin: true },
		io: { to: () => ({ emit: () => {} }) }
	}) as any

const noopEmit = () => {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-reply-outcome-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir

	const dbModule = await import("$lib/server/db")
	db = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const [user] = await db
		.insert(schema.users)
		.values({ username: "reply-outcome", isAdmin: true })
		.returning()
	userId = user.id

	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Reply Outcome Only",
			type: "ollama",
			baseUrl: "http://localhost:11434",
			model: "irrelevant",
			promptFormat: "vicuna",
			tokenCounter: "estimate"
		})
		.returning()
	const [sampling] = await db.select().from(schema.samplingConfigs).limit(1)
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: connection.id,
		samplingConfigId: sampling?.id ?? null
	})

	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Ash", description: "A rider." })
		.returning()
	characterId = character.id
	const [persona] = await db
		.insert(schema.personas)
		.values({
			userId,
			isDefault: false,
			name: "Rell",
			description: "A cartographer."
		})
		.returning()

	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	sessionId = session.id

	await db.insert(schema.sessionCharacters).values({
		sessionId,
		characterId,
		isActive: true,
		visibility: "visible"
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId, personaId: persona.id })
	await db.insert(schema.sessionMessages).values({
		sessionId,
		role: "user",
		content: "Have you seen the ashguard?",
		personaId: persona.id
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** The row a trigger creates, in the state it hands to `generateResponse`. */
async function generatingRow() {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			role: "assistant",
			characterId,
			content: "",
			isGenerating: true,
			generationStage: "queued"
		})
		.returning()
	return row
}

const rowOf = async (id: number) =>
	await db.query.sessionMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, id)
	})

/** The real reply path, driven exactly as a socket handler drives it. */
async function generateResponseFor(row: any) {
	const { generateResponse } = await import(
		"$lib/server/utils/generateResponse"
	)
	return await generateResponse({
		socket: fakeSocket(),
		emitToUser: noopEmit,
		sessionId,
		userId,
		generatingMessage: row as any
	})
}

/** The run that recorded this message as its output. */
async function runFor(messageId: number) {
	const [hit] = await db
		.select()
		.from(schema.pipelineRuns)
		.innerJoin(
			schema.pipelineRunArtifacts,
			eq(schema.pipelineRunArtifacts.runId, schema.pipelineRuns.id)
		)
		.where(
			and(
				eq(schema.pipelineRunArtifacts.kind, "message"),
				eq(schema.pipelineRunArtifacts.entityId, messageId)
			)
		)
		.orderBy(desc(schema.pipelineRuns.id))
	return (hit as any)?.pipeline_runs ?? null
}

/** The generate node as the receipt keeps it. */
const generateNodeOf = (run: any) =>
	(run.receipt as any).nodes.find((n: any) =>
		String(n.typeId ?? "").startsWith("core:provider/generate-text")
	)

/** The generate node as the queryable row keeps it. */
async function generateRowOf(run: any) {
	const rows = await db
		.select()
		.from(schema.pipelineRunNodes)
		.where(eq(schema.pipelineRunNodes.runId, run.id))
	return rows.find((r: any) =>
		String(r.typeId ?? "").startsWith("core:provider/generate-text")
	)
}

describe("a reply the adapter sent", () => {
	it("records ok, the rule, the reply and the tokens", async () => {
		mode = "ok"
		const row = await generatingRow()
		expect(
			await generateResponseFor(row),
			"the reply did not complete"
		).toBe(true)

		const run = await runFor(row.id)
		expect(run, "no run recorded this message as its output").toBeTruthy()

		// ⚠ THE defect. This read `halt` / "preview: stopped before generate,
		// nothing sent" on every reply in the product.
		expect(run.outcome).toBe("ok")
		expect(run.haltNodeKey).toBeNull()
		expect(run.haltReason).toBeNull()
		expect(run.isPreview).toBe(false)

		const node = generateNodeOf(run)
		expect(node.result).toBe("ok")
		expect(node.reason).toBe("sent by the reply adapter")
		expect(node.tokens).toBe(34)

		// What came back, beside the stop record and the wire the other two
		// patches write.
		const saved = await rowOf(row.id)
		expect(node.output.reply).toMatchObject({
			text: saved!.content,
			finishReason: "stop",
			tokensPrompt: 12,
			tokensCompletion: 34,
			tokensReasoning: 21
		})
		expect(node.output.reply.truncated).toBeUndefined()

		// Prompt plus completion, as the service reported them — and 0 was the
		// only number this column ever held.
		//
		// ⚠ 46, not 67. The reasoning count is a BREAKDOWN of the completion
		// count; summing the two would report a reply as costing half again
		// what it did, on the one number a person reads as the bill.
		expect(run.tokensSpent).toBe(46)
		expect((run.receipt as any).consumption.tokens).toBe(46)

		// ⚠ The run's span covers the send. Stored at the pre-call halt it is
		// the compile alone, so a header reads tens of milliseconds beside a
		// generate node that spent the whole exchange.
		expect(run.elapsedMs).toBeGreaterThanOrEqual(1234)
		expect(run.endedAt.getTime() - run.startedAt.getTime()).toBe(
			run.elapsedMs
		)
		// The blob and the columns say the same thing, and the start never moves.
		expect((run.receipt as any).endedAt).toBe(run.endedAt.getTime())
		expect((run.receipt as any).startedAt).toBe(run.startedAt.getTime())

		// The queryable half says the same thing as the blob.
		const nodeRow = await generateRowOf(run)
		expect(nodeRow!.result).toBe("ok")
		expect(nodeRow!.reason).toBe("sent by the reply adapter")
		expect(nodeRow!.tokens).toBe(34)
		expect(nodeRow!.elapsedMs).toBeGreaterThanOrEqual(1234)

		// The record of what the adapter was handed is untouched: `preview` is
		// that substrate, and it is why the send could happen at all.
		expect((run.receipt as any).preview).toBeTruthy()
	}, 120_000)
})

describe("a reply that was stopped", () => {
	it("records cancelled, and leaves no error on the message", async () => {
		mode = "cancel"
		const row = await generatingRow()
		const { sessionMessagesCancelHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		// The Stop button's own handler, mid-stream — both halves of it: the row
		// is released first and the queue item cancelled after, which is the
		// window a stream error used to arrive in.
		midStream = async () => {
			await sessionMessagesCancelHandler.handler(
				fakeSocket(),
				{ sessionId, id: row.id } as any,
				noopEmit
			)
		}
		const ok = await generateResponseFor(row)
		midStream = null
		expect(ok, "a stop is not a completed turn").toBe(false)

		const run = await runFor(row.id)
		expect(run.outcome).toBe("cancelled")
		expect(run.haltNodeKey).toBe("generate")
		const node = generateNodeOf(run)
		expect(node.result).toBe("cancelled")
		expect((await generateRowOf(run))!.result).toBe("cancelled")

		// A stop is not a failure, and must never be written up as one.
		const saved = await rowOf(row.id)
		expect(saved!.error).toBeNull()
		expect(saved!.isGenerating).toBe(false)
	}, 120_000)
})

describe("a reply the service refused", () => {
	it("records err, with the reason", async () => {
		mode = "fail"
		const row = await generatingRow()
		expect(await generateResponseFor(row)).toBe(false)

		const run = await runFor(row.id)
		expect(run.outcome).toBe("err")
		expect(run.haltNodeKey).toBe("generate")
		const node = generateNodeOf(run)
		expect(node.result).toBe("err")
		expect((await generateRowOf(run))!.result).toBe("err")

		/**
		 * ⚠ The receipt's reason obeys the rule the message row obeys: a run row
		 * is served to whoever owns it, admin or not, and a service's own words
		 * carry the base URL they failed against. The whole diagnostic stays
		 * where `withoutConnectionIdentity` can remove it per reader.
		 */
		expect(run.haltReason).toBe("the service reported an error")
		expect(node.reason).toBe("the service reported an error")
		const saved = await rowOf(row.id)
		expect((saved!.error as any).connection.detail).toContain(
			"the model service said no"
		)
	}, 120_000)
})

describe("the reply record's limits", () => {
	/** A stored receipt with one generate node, the shape the patch edits. */
	const storeReceipt = async (runId: string) => {
		const { saveReceipt } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		return await saveReceipt(
			db,
			{
				runId,
				specId: "core:spec/respond",
				specVersion: "1.0.0",
				outcome: "halt",
				haltNodeKey: "generate",
				haltReason: "preview: stopped before generate, nothing sent",
				triggerSource: "input",
				seed: runId,
				startedAt: 0,
				endedAt: 5,
				consumption: { tokens: 0, nodeExecutions: 1 },
				nodes: [
					{
						nodeKey: "generate",
						seq: 0,
						kind: "provider",
						typeId: "core:provider/generate-text@1",
						result: "halt",
						reason: "preview: stopped before generate, nothing sent",
						startedAt: 0,
						endedAt: 5,
						elapsedMs: 5
					}
				]
			} as any,
			{ sessionId, userId }
		)
	}

	it("keeps the first 64 KB of a reply and says the rest was dropped", async () => {
		const { recordReplyOutcome } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const { WIRE_RAW_LIMIT } = await import(
			"$lib/server/connectionAdapters/BaseConnectionAdapter"
		)
		const id = await storeReceipt("reply-outcome-cap")
		await recordReplyOutcome(db, "reply-outcome-cap", {
			result: "ok",
			text: "x".repeat(WIRE_RAW_LIMIT + 500)
		})

		const [run] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.id, id!))
		const reply = generateNodeOf(run).output.reply
		expect(reply.text).toHaveLength(WIRE_RAW_LIMIT)
		expect(reply.truncated).toBe(true)
	}, 60_000)

	it("leaves the total at 0 and says so when the service reported nothing", async () => {
		const { recordReplyOutcome } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const id = await storeReceipt("reply-outcome-silent")
		await recordReplyOutcome(db, "reply-outcome-silent", {
			result: "ok",
			text: "short"
		})

		const [run] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.id, id!))
		expect(run.tokensSpent).toBe(0)
		expect((run.receipt as any).consumption.tokens).toBe(0)
		// Absent stays absent: a 0 nobody reported would read as a free reply.
		const node = generateNodeOf(run)
		expect(node.tokens ?? null).toBeNull()
		expect((node.notes ?? []).join(" ")).toContain(
			"reported no token counts"
		)
	}, 60_000)
})

describe("a reply stopped before the request went out", () => {
	it("sends nothing, and the run says so", async () => {
		mode = "ok"
		sends = 0
		const row = await generatingRow()
		const { sessionMessagesCancelHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		duringCompile = async () => {
			await sessionMessagesCancelHandler.handler(
				fakeSocket(),
				{ sessionId, id: row.id } as any,
				noopEmit
			)
		}
		const ok = await generateResponseFor(row)
		duringCompile = null
		expect(ok, "a stop is not a completed turn").toBe(false)

		/**
		 * ⚠ THE defect. `sessionMessages:cancel` releases the ROW and cancels
		 * the QUEUE ITEM, and no queue item exists while the pipeline is still
		 * compiling — so the turn sent anyway, producing a generation nothing
		 * in this app could reach or abort, whose eventual failure landed on
		 * whatever the row was doing by then.
		 */
		expect(sends, "the request went out after the turn was stopped").toBe(0)

		const run = await runFor(row.id)
		expect(run.outcome).toBe("cancelled")
		expect(run.haltNodeKey).toBe("generate")
		expect(generateNodeOf(run).reason).toBe(
			"stopped before the request went out"
		)

		const saved = await rowOf(row.id)
		expect(saved!.error).toBeNull()
		expect(saved!.isGenerating).toBe(false)
		expect(saved!.queueItemId).toBeNull()
	}, 120_000)
})
