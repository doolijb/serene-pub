/**
 * What a run produced is recorded — all of it, and not as a preview.
 *
 * ## The defect
 *
 * The run recorded nothing for a real reply, and every real reply was stored as
 * `is_preview = true`. Both fall out of one true fact stated in the wrong place:
 * the reply path calls `runTurn({ preview: true })` because the ADAPTER makes
 * the provider call, not the pipeline — so no Consumer node ever commits,
 * nothing named the message, and `isPreview: Boolean(receipt.preview)` says
 * "preview" about the one kind of run that is definitely not one.
 *
 * The knock-on is where it hurts: `pipelines:sessionEntryUsage` filters
 * `AND r.is_preview = false`, `runForMessage` looks up by the message, and
 * `lastRunFor` — the query whose whole job is answering "did this session's last
 * reply come from the pipeline" — filters on `is_preview = false` too. All three
 * saw nothing in production while working perfectly in every test, because the
 * tests run the pipeline all the way through a Consumer and production never
 * does.
 *
 * ## The second defect, in the schema itself
 *
 * The first fix wrote `pipeline_runs.message_id`, and that column can hold
 * exactly one id. Ruled 2026-09-08: *"the schema is wrong if it only reflects
 * one message"* — so it is a relation now, `pipeline_run_artifacts`, and the
 * case the column structurally could not hold is tested below: a greeting seed
 * writes **N** messages, and the old shape recorded none of them.
 *
 * ## What `is_preview` means now
 *
 * "Nothing was produced." Not "the executor was asked to halt early" — the
 * reply path halts early on purpose and produces a message anyway, through the
 * adapter. `preview: true` still means exactly what it meant to the executor;
 * only the recorded FACT changed, and the two were never the same question.
 *
 * ## The halves, tested separately on purpose
 *
 * The first `describe` drives the **real reply path** — `generateResponse`, its
 * queue, its adapter seam, its message row — because "a reply's run is linked"
 * is a claim about that function and a `runTurn` call written by a test would
 * pass whatever `generateResponse` does. The second pins the rule at
 * `saveReceipt`, including the case that must NOT change: a genuine debug
 * preview, which is what `sessions:promptTokenCount` and `pipeline:compare`
 * issue, stays a preview. The third drives the host commit that writes many
 * rows at once.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

let db: TestDb
let dataDir: string
let userId: number
let sessionId: number
let characterId: number

// `generateResponse` imports `db` at module scope, so the handle has to be the
// test's before it is loaded — the same route `promptTokenCount.int.test.ts`
// takes.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "reply-receipt-secret" }
})

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

// The background vectorizer, which a finished reply kicks. Not this file's
// subject and it would open a queue nothing here closes.
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {}
}))

/** The model, and only the model. Everything else below is the real thing. */
class FakeAdapter {
	injected: any
	currentCharacterId: number | null
	promptBuilder: any = {}
	constructor(args: any) {
		this.currentCharacterId = args?.currentCharacterId ?? null
	}
	/** The composed stop list. Recorded so a test can assert what was handed over. */
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async preflight() {}
	async generateText() {
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: "The Ashguard ride at dawn."
		}
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-reply-run-"))
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
		.values({ username: "reply-run", isAdmin: true })
		.returning()
	userId = user.id

	// A real row, registered the way an instance registers one — the reply path
	// resolves its connection through the same chain a user's would.
	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Reply Only",
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

/** The runs that recorded a `message` artifact for this row. */
const runsFor = (messageId: number) =>
	db
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
		.then((rows) => rows.map((r: any) => r.pipeline_runs))

describe("a real reply records a linked, non-preview run", () => {
	it("records one message/created artifact and is_preview = false", async () => {
		const row = await generatingRow()
		const ok = await generateResponseFor(row)
		expect(ok, "the reply itself did not complete").toBe(true)

		// ⚠ THE defect, as one assertion. Before the fix this array was empty:
		// no Consumer ran, so nothing named the row, so the run recorded no
		// output at all on every reply this product has ever generated.
		const runs = await runsFor(row.id)
		expect(
			runs.length,
			"no run is linked to the message the reply wrote"
		).toBe(1)

		// One artifact, in the shape the relation records: the reply path
		// writes exactly one message and nothing else.
		const { runArtifacts } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const artifacts = await runArtifacts(db, runs[0]!.id)
		expect(artifacts).toHaveLength(1)
		expect(artifacts[0]).toMatchObject({
			kind: "message",
			entityId: row.id,
			action: "created",
			seq: 0,
			// The trigger created the row, not a node — so there is no node to
			// name, and inventing one would be worse than the absence.
			nodeKey: null
		})

		// ⚠ And the other half. `preview: true` is how the reply path asks the
		// executor to stop before the provider — the adapter sends — so
		// `Boolean(receipt.preview)` recorded every reply as a preview, and
		// every consumer of `is_preview = false` saw an empty product.
		expect(
			runs[0]!.isPreview,
			"a real reply is recorded as a preview"
		).toBe(false)
		expect(runs[0]!.sessionId).toBe(sessionId)
	}, 120_000)

	it("is what lastRunFor and runForMessage answer with", async () => {
		// The two queries the defect silenced, asked directly. `lastRunFor` is
		// the query whose entire purpose is "did this session's last reply come
		// from the pipeline", and it answered "no" for every reply.
		const { lastRunFor, runForMessage } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		const row = await generatingRow()
		await generateResponseFor(row)

		const last = await lastRunFor(db, sessionId)
		expect(
			last,
			"lastRunFor sees no non-preview run for this session"
		).toBeTruthy()
		const { runArtifacts } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		expect(
			(await runArtifacts(db, last.id)).map((a: any) => a.entityId)
		).toEqual([row.id])

		const found = await runForMessage(db, row.id)
		expect(found, "runForMessage cannot find the reply's run").toBeTruthy()
		expect(found!.nodes.length).toBeGreaterThan(0)
	}, 120_000)
})

describe("a debug preview is still a preview", () => {
	it("records is_preview = true and no message when nothing was produced", async () => {
		/**
		 * The case that must NOT move. `sessions:promptTokenCount`,
		 * `entries:preview` and `pipeline:compare` all issue
		 * `runTurn({ preview: true })` to see what WOULD be sent; they name no
		 * message because they produce none. Those three pass `skipReceipt`, so
		 * this runs the one shape that does record — the same one
		 * `receipts.int.test.ts` pins — and asserts the rule did not widen into
		 * "every preview is a reply".
		 */
		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const receipt = await runTurn({
			db: db,
			sessionId,
			userId,
			currentCharacterId: characterId,
			text: "",
			seed: "reply-receipt:preview",
			preview: true
		})

		const [run] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.runId, receipt.runId))
		expect(run, "the preview recorded no run at all").toBeTruthy()
		expect(run!.isPreview, "a debug preview stopped being a preview").toBe(
			true
		)
		const { runArtifacts } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)
		expect(await runArtifacts(db, run!.id)).toEqual([])
	}, 120_000)

	it("never records output on a run it calls a preview", async () => {
		// The control on the rule's shape, restated in artifact terms:
		// `is_preview = false` must follow having PRODUCED something, not the
		// other way round, so no run may own an artifact while claiming to be
		// a preview. It was `message_id IS NOT NULL` when a run could only
		// produce one message; the relation makes the same statement about
		// every kind of row a run can leave.
		const contradictions = await db
			.select({ id: schema.pipelineRuns.id })
			.from(schema.pipelineRuns)
			.innerJoin(
				schema.pipelineRunArtifacts,
				eq(schema.pipelineRunArtifacts.runId, schema.pipelineRuns.id)
			)
			.where(eq(schema.pipelineRuns.isPreview, true))
		expect(contradictions).toEqual([])
	}, 60_000)
})

/**
 * The case the single column could not hold, and the reason it is a relation.
 *
 * `core:consumer/seed-greetings` writes **N** messages in one commit. The old
 * `pipeline_runs.message_id` recorded **none** of them — `writtenMessageId`
 * read `output.ids.id` off the first committed consumer and this consumer
 * publishes `ids[]`, so the id it looked for was never there. A create pipeline
 * therefore left a run row that claimed to have produced nothing at all, next
 * to three greetings it had just written.
 *
 * Driven through the host's commit rather than a whole spec run: what is under
 * test is the seam between the writer and the record — the commit pushes, the
 * collector holds, `saveReceipt` writes rows — and a create pipeline built here
 * would test the create pipeline instead.
 */
describe("a run that writes many rows records all of them", () => {
	const seedNode = {
		key: "greet",
		typeId: "core:consumer/seed-greetings",
		typeVersion: 1,
		kind: "consumer"
	} as any

	it("records one message artifact per greeting", async () => {
		const { createHost } = await import(
			"$lib/server/pipelines/runtime/host"
		)
		const { saveReceipt, runArtifacts } = await import(
			"$lib/server/pipelines/runtime/receipts"
		)

		const artifacts: any[] = []
		const host = createHost(db, {
			runId: "greet-run",
			sessionId,
			userId,
			artifacts
		})
		const out: any = await host.commit!(
			{
				greetings: [
					{ characterId, texts: ["Well met."] },
					{ characterId, texts: ["You again."] },
					{ characterId, texts: ["Say nothing."] }
				]
			},
			seedNode
		)
		expect(out.count, "the fixture wrote no greetings").toBe(3)

		// ⚠ Three, not one and not zero. `message_id` could hold one id and in
		// practice held none for this commit.
		expect(artifacts).toHaveLength(3)
		expect(artifacts.map((a) => a.kind)).toEqual([
			"message",
			"message",
			"message"
		])
		expect(artifacts.map((a) => a.entityId)).toEqual(out.ids)
		expect(artifacts.every((a) => a.action === "created")).toBe(true)
		expect(artifacts.every((a) => a.nodeKey === "greet")).toBe(true)

		// And they survive the write, in order, as rows.
		const runRowId = await saveReceipt(
			db,
			{
				runId: "greet-run",
				specId: "core:spec/create-session",
				specVersion: "1.0.0",
				outcome: "ok",
				triggerSource: "event",
				seed: "greet",
				startedAt: 0,
				endedAt: 1,
				// ⚠ Deliberately `true`, so the assertion below is about the
				// DERIVATION and not about a flag that was already false. The
				// reply path is the real case: it asks the executor to halt
				// early and writes a message anyway.
				preview: true,
				nodes: []
			} as any,
			{ sessionId, userId, artifacts }
		)
		expect(runRowId, "the receipt was not written at all").toBeTruthy()

		const rows = await runArtifacts(db, runRowId!)
		expect(rows.map((r: any) => [r.seq, r.kind, r.entityId])).toEqual(
			out.ids.map((id: number, i: number) => [i, "message", id])
		)

		// A run that produced three messages is not a preview, whatever the
		// executor was asked to do — see the `preview: true` above.
		const [run] = await db
			.select()
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.id, runRowId!))
		expect(run!.isPreview).toBe(false)
	}, 60_000)
})
