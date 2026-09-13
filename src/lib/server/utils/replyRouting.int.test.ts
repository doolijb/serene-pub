/**
 * Which road a reply takes, decided by the shape of the spec that serves it.
 *
 * ## The defect this file exists for
 *
 * `generateResponse` compiled every reply with `runTurn({ preview: true })`,
 * took the FIRST provider's payload and let the connection adapter send it. For
 * `core:spec/respond` — one Provider on the spine — that is exactly right and
 * stays. For a spec with several generating stages it meant the FIRST stage's
 * prompt became the reply: an Adventure turn shipped the planner's JSON to the
 * screen and never narrated, never gave the cast a voice, never ran the
 * state-keeper. The receipt said `halt … "preview: stopped before planWrite,
 * nothing sent"` beside a message row that had just been written.
 *
 * ## Driven through the real entry point
 *
 * `generateResponse` is what the socket handlers call, and the routing is the
 * thing under test — a test that called `runTurn` itself would assert about a
 * function this path does not take. Everything below the model is real:
 * published core specs, the real world projection, the real host, the real
 * queue. Only the adapter is a fake, and it is the same fake on both roads.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, desc, eq } from "drizzle-orm"
import { ADVENTURE_GENRE_ID } from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string
let userId: number
let adventureSessionId: number
let chatSessionId: number
let chatCharacterId: number

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "reply-routing-secret" }
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
 * The one document every generating step gets back, for the reason G1's
 * `adventure.int.test.ts` gives: what is under test is the WIRING, and a stub
 * that answered differently per step would be a second implementation of the
 * pipeline's ordering asserting itself.
 *
 * The marker is what makes the assembly legible. Every call gets its own, and
 * `extractJson` walks brace depth, so the planner still reads its plan out of
 * the same string the reply is assembled from.
 */
const PLAN = {
	beats: ["The lantern gutters."],
	speakers: [{ name: "Wren", intent: "warn the party" }, { name: "Marrow" }],
	worldHints: { weather: "fog" },
	needsLookup: false,
	// The keeper's two lists, which is the shape its schema now names: a schema
	// can only be strict about a list whose items are all one shape.
	values: [
		{ owner: "Wren", slot: "hp", value: "14" },
		{ owner: "world", slot: "weather", value: "fog" }
	],
	possessions: []
}

let calls = 0
/** Runs at the start of each fake generation, for the cancellation test. */
let onCall: ((n: number) => Promise<void> | void) | null = null
/**
 * What every generation answers instead, for the one case that is about the
 * TEXT rather than the routing: a model that ran on past its turn.
 */
let answerWith: string | null = null

const answerFor = (n: number) =>
	answerWith ?? `${JSON.stringify(PLAN)}\n<<call:${n}>>`

class FakeAdapter {
	injected: any
	currentCharacterId: number | null
	promptBuilder: any = {}
	aborted = false
	constructor(args: any) {
		this.currentCharacterId = args?.currentCharacterId ?? null
	}
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {
		this.aborted = true
	}
	async preflight() {}
	/**
	 * What this send put on the wire, recorded through the real recorder so the
	 * shape a receipt carries is the adapters' and not this file's.
	 */
	lastExchange: any
	async generateText() {
		const n = ++calls
		await onCall?.(n)
		const answer = answerFor(n)
		const { WireRecorder } = await import(
			"$lib/server/connectionAdapters/BaseConnectionAdapter"
		)
		const wire = new WireRecorder({
			url: "http://localhost:11434/api/chat",
			body: {
				model: "irrelevant",
				messages: this.injected?.messages ?? [],
				options: {
					stop: (this.stops?.sent ?? []).map((s: any) => s.value)
				}
			}
		})
		wire.received({ message: { content: answer } })
		this.lastExchange = wire.exchange
		return {
			compiledPrompt: this.injected,
			isAborted: this.aborted,
			completionResult: answer
		}
	}
}

vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

/** Everything the turn pushed at the session, in order. */
let broadcasts: Array<{ event: string; data: any }> = []

const fakeSocket = () =>
	({
		user: { id: userId, isAdmin: true },
		io: {
			to: () => ({
				emit: (event: string, data: any) =>
					broadcasts.push({ event, data })
			})
		}
	}) as any

const noopEmit = () => {}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-reply-routing-")
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
		.values({ username: "reply-routing", isAdmin: true })
		.returning()
	userId = user.id

	const [connection] = await db
		.insert(schema.connections)
		.values({
			name: "Reply Routing Only",
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

	const cast: number[] = []
	for (const name of ["Wren", "Marrow"]) {
		const [row] = await db
			.insert(schema.characters)
			.values({ userId, name, description: `${name} of the fog roads.` })
			.returning()
		cast.push(row.id)
	}
	chatCharacterId = cast[0]!

	const [persona] = await db
		.insert(schema.personas)
		.values({
			userId,
			isDefault: false,
			name: "Rell",
			description: "A cartographer."
		})
		.returning()

	const [adventure] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: true,
			name: "The fog roads",
			genreId: ADVENTURE_GENRE_ID,
			genreFields: {
				tone: "grounded",
				difficulty: "normal",
				trustNarrator: false
			}
		})
		.returning()
	adventureSessionId = adventure.id
	for (const characterId of cast)
		await db.insert(schema.sessionCharacters).values({
			sessionId: adventureSessionId,
			characterId,
			isActive: true,
			visibility: "visible"
		})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId: adventureSessionId, personaId: persona.id })

	const [chat] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, name: "Chat" })
		.returning()
	chatSessionId = chat.id
	await db.insert(schema.sessionCharacters).values({
		sessionId: chatSessionId,
		characterId: chatCharacterId,
		isActive: true,
		visibility: "visible"
	})
	await db
		.insert(schema.sessionPersonas)
		.values({ sessionId: chatSessionId, personaId: persona.id })
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

/** A player's turn, and the empty row the trigger hands `generateResponse`. */
async function turn(sessionId: number, characterId: number | null) {
	const { insertLegacy } = await import("$lib/server/messages/store")
	await insertLegacy(db, {
		sessionId,
		role: "user",
		content: "I hold up the lantern."
	})
	return await insertLegacy(db, {
		sessionId,
		role: "assistant",
		characterId,
		content: "",
		isGenerating: true,
		generationStage: "queued"
	})
}

async function generateResponseFor(sessionId: number, row: any) {
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

const rowOf = (id: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, id))
		.then((rows) => rows[0])

/** The newest run recorded against a session — a cancelled one wrote no message. */
const latestRunIn = (sessionId: number) =>
	db
		.select()
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(desc(schema.pipelineRuns.id))
		.limit(1)
		.then((rows) => rows[0])

/** The run that names this message as its output. */
const runFor = (messageId: number) =>
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
		.then((rows) => rows.map((r: any) => r.pipeline_runs)[0])

describe("a genre whose respond spec has several generating stages", () => {
	it("runs the spec to completion and saves the assembled reply", async () => {
		calls = 0
		onCall = null
		broadcasts = []
		const row = await turn(adventureSessionId, null)
		const ok = await generateResponseFor(adventureSessionId, row)
		expect(ok, "the reply did not complete").toBe(true)

		const saved = await rowOf(row.id)
		const markers = [...(saved!.content ?? "").matchAll(/<<call:(\d+)>>/g)]
		// The planner's answer is the PROMPT's subject, never the reply.
		expect(saved!.content).not.toContain("<<call:1>>")
		// The scene and both voices, joined — the spec's `reply` node.
		expect(markers.map((m) => m[1])).toEqual(["2", "3", "4"])

		const run = await runFor(row.id)
		expect(run, "no run recorded this message as its output").toBeTruthy()
		expect(
			`${run.outcome} ${run.haltReason ?? ""} ${run.haltNodeKey ?? ""}`.trim()
		).toBe("ok")
		expect(run.isPreview).toBe(false)

		const nodeKeys = (run.receipt as any).nodes.map((n: any) => n.nodeKey)
		expect(
			nodeKeys.filter((k: string) => k === "voices.item.say")
		).toHaveLength(2)
		expect(nodeKeys).toContain("commit.reviewed.propose")

		const proposals = await db
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, adventureSessionId))
		expect(proposals.length).toBeGreaterThan(0)
		// The keeper moved something, so the session was told.
		expect(
			broadcasts.some((b) => b.event === "state:changed"),
			"the ledger was never told the keeper wrote anything"
		).toBe(true)

		/**
		 * The narrator, and only the narrator, reached the row while the run
		 * was still going. A run has one sink, so the planner's JSON and the
		 * two parallel voices would land on top of each other if every
		 * Provider were allowed to stream.
		 */
		const midRun = broadcasts.filter(
			(b) =>
				b.event === "sessionMessage" &&
				b.data?.sessionMessage?.id === row.id &&
				b.data?.sessionMessage?.isGenerating === true &&
				(b.data.sessionMessage.content ?? "").length > 0
		)
		expect(
			midRun.length,
			"the narrator's prose never reached the message row mid-run"
		).toBeGreaterThan(0)
		for (const frame of midRun) {
			expect(frame.data.sessionMessage.content).toContain("<<call:2>>")
			expect(frame.data.sessionMessage.content).not.toContain(
				"<<call:1>>"
			)
		}
	}, 120_000)

	it("stops the whole run wherever it is when the turn is cancelled", async () => {
		calls = 0
		const { llmQueue } = await import("$lib/server/utils/llmQueue")
		const row = await turn(adventureSessionId, null)
		// The Stop button's own mechanism: the row carries the queue item, and
		// `sessionMessages:cancel` cancels by it.
		onCall = async (n) => {
			if (n !== 2) return
			const live = await rowOf(row.id)
			if (live?.queueItemId) llmQueue.cancel(live.queueItemId)
		}
		const ok = await generateResponseFor(adventureSessionId, row)
		onCall = null
		// A stop is not a completed turn, and not a failure either.
		expect(ok).toBe(false)

		// The row is not left spinning. `sessionMessages:cancel` clears it
		// first on the Stop button's path; the progress card cancels the RUN
		// and nothing else would, so the turn releases its own row.
		const stoppedRow = await rowOf(row.id)
		expect(stoppedRow!.isGenerating).toBe(false)
		expect(stoppedRow!.queueItemId).toBeNull()

		const run = await latestRunIn(adventureSessionId)
		expect(run, "the cancelled run recorded no receipt").toBeTruthy()
		expect(run.outcome).not.toBe("ok")
		// The stage it was standing on when the stop arrived, named on the
		// receipt. ⚠ `halt` rather than `cancelled` whenever the abort lands
		// INSIDE a provider call: the node reports "generation was aborted"
		// and the run ends on that, before the executor — which only polls
		// between nodes — ever reaches its cancel hook. Same known gap
		// `sessions:triggerFunction` states, which is why neither path decides
		// cancellation from the receipt.
		expect(run.haltNodeKey).toBe("scene")
		expect(run.haltReason).toContain("aborted")
		// Nothing after the stop: the cast never spoke and the keeper never ran.
		const nodeKeys = (run.receipt as any).nodes.map((n: any) => n.nodeKey)
		expect(nodeKeys).not.toContain("voices.item.say")
		expect(nodeKeys).not.toContain("keeperWrite")
	}, 120_000)
})

describe("chat", () => {
	it("still sends through the adapter, halting at the pre-call substrate", async () => {
		calls = 0
		onCall = null
		answerWith = null
		const row = await turn(chatSessionId, chatCharacterId)
		const ok = await generateResponseFor(chatSessionId, row)
		expect(ok, "the reply did not complete").toBe(true)

		const saved = await rowOf(row.id)
		expect(saved!.content).toContain("<<call:1>>")

		const run = await runFor(row.id)
		expect(run, "no run recorded this message as its output").toBeTruthy()
		// The run halts at the pre-call substrate and the adapter beside it
		// sends — and the receipt's last word is what the SEND did, not where
		// the executor stopped. See `recordReplyOutcome`.
		expect(run.outcome).toBe("ok")
		expect(run.haltNodeKey).toBeNull()
		expect(run.haltReason).toBeNull()
		expect(run.isPreview).toBe(false)
		const generate = (run.receipt as any).nodes.find(
			(n: any) => n.nodeKey === "generate"
		)
		expect(generate.result).toBe("ok")
		expect(generate.reason).toBe("sent by the reply adapter")
		// The substrate the adapter was handed is still on the receipt: it is
		// what makes the send explicable.
		expect((run.receipt as any).preview).toBeTruthy()
	}, 120_000)

	/**
	 * The reply ends at the speaker boundary, and the receipt says so.
	 *
	 * A model handed a transcript whose message content carries `Name:` labels
	 * continues it — writing the player's next line, and the character's answer
	 * to it — which reads as this app speaking for everybody. Two halves, both
	 * asserted here because either alone leaves the defect reachable: the labels
	 * go out as stop sequences, and what comes back is cut at the first line that
	 * opens with somebody else's label whatever the backend honoured.
	 */
	it("cuts a runaway reply at the next speaker, and records where", async () => {
		calls = 0
		onCall = null
		// The persona speaks, then the character answers themselves. Only the
		// first line is this turn's.
		answerWith = "*nods*\nRell: hi\nWren: no"
		const row = await turn(chatSessionId, chatCharacterId)
		try {
			const ok = await generateResponseFor(chatSessionId, row)
			expect(ok, "the reply did not complete").toBe(true)
		} finally {
			answerWith = null
		}

		const saved = await rowOf(row.id)
		expect(saved!.content).toBe("*nods*")

		const run = await runFor(row.id)
		const node = (run.receipt as any).nodes.find((n: any) =>
			String(n?.typeId ?? "").startsWith("core:provider/generate-text")
		)
		const stops = node?.output?.stops
		expect(stops, "the run recorded no stop list at all").toBeTruthy()
		// The persona's label, on the wire, newline-prefixed so it cannot match
		// at position zero — and carrying the sentence that put it there.
		const speaker = stops.sent.find((s: any) => s.kind === "speaker")
		expect(speaker, "no speaker stop reached the wire").toBeTruthy()
		expect(speaker.value).toBe("\nRell:")
		expect(speaker.why).toBeTruthy()
		// And the cut that had to fire anyway, named rather than silent.
		expect(stops.trimmedAt).toEqual({ label: "Rell:", offset: 6 })
	}, 120_000)

	/**
	 * What the adapter actually sent, on the receipt beside the stop record.
	 *
	 * The reply road halts at the pre-call substrate and the adapter beside it
	 * does the sending, so nothing on the run itself has seen the request. The
	 * patch is what closes that gap — without it the inspector can show the
	 * assembled prompt and never what the connection was asked.
	 */
	it("records what the adapter put on the wire", async () => {
		calls = 0
		onCall = null
		answerWith = null
		const row = await turn(chatSessionId, chatCharacterId)
		const ok = await generateResponseFor(chatSessionId, row)
		expect(ok, "the reply did not complete").toBe(true)

		const run = await runFor(row.id)
		const node = (run.receipt as any).nodes.find((n: any) =>
			String(n?.typeId ?? "").startsWith("core:provider/generate-text")
		)
		const wire = node?.output?.wire
		expect(wire, "the run recorded no exchange at all").toBeTruthy()
		expect(wire.request.url).toContain("/api/chat")
		expect(Array.isArray(wire.request.body.messages)).toBe(true)
		expect(wire.request.body.messages.length).toBeGreaterThan(0)
		expect(wire.request.body.options.stop).toEqual(
			expect.arrayContaining(["\nRell:"])
		)
		expect(wire.response.raw).toContain("<<call:1>>")
		// The stop record is untouched by the second patch.
		expect(node.output.stops?.sent?.length).toBeGreaterThan(0)
	}, 120_000)
})
