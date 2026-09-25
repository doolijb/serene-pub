/**
 * The one road (09-B B4, R-17, R-21, R-8): a real chat turn, end to end, with
 * no trigger-side insert.
 *
 * ## What is pinned, and why each half would break silently
 *
 *  1. **The pipeline owns its row.** Nothing outside the run inserts a
 *     message: the only `session_messages` insert on a turn is the spec's own
 *     `placeholder` outlet, `message-created` is recorded on the receipt as
 *     caused by that node, and the host announces the row from the commit —
 *     the client's placeholder IS the pipeline's row. The trigger used to
 *     insert it and hand it down to the run as a fill-in id; that seam is gone,
 *     and this is what keeps it gone.
 *  2. **Streaming is run-level.** The oracle publishes its stream and stays
 *     blind to messages; core routes it to the run's live row. The row the
 *     player watches fills while the model writes, and the final write joins
 *     the same row rather than making a second one.
 *  3. **Stop is a run-level guarantee.** Cancelled mid-stream, the row ends
 *     `isGenerating: false` holding the partial text, and the receipt reads
 *     `cancelled` — the executor converts an oracle that halted on its abort,
 *     and the host finalises the row from the run-end hook. No node runs to
 *     do it; none could.
 *  4. **A preview performs no writes.** The token estimate runs the same
 *     document with the placeholder before the halt, and leaves zero rows.
 *  5. **One resolution per run.** A session's sampling pick and the panel's
 *     connection pick reach the budget, the render and the wire as one
 *     answer: dispatch is handed what the executor resolved and re-walks
 *     nothing; `contextBudget`'s window is the adapter's `tokenLimit`; and the
 *     model's own context window (0114) caps both — and the panel's figure —
 *     through the one function (`runtime/contextWindow.ts`).
 *
 * Asserted through `runReply` against the SHIPPED `core:spec/respond` document
 * published by the bootstrap — the road the socket handlers take — with a fake
 * adapter standing in for the model.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { connectionSlotValue } from "$lib/shared/connections/slotRef"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
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
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		contextConfig: { id: 1, template: "{{instructions}}" },
		promptConfig: { id: 1, systemPrompt: "Be brief." },
		narratorPromptConfig: null
	})
}))

/** Every session broadcast the host and the live row made, in order. */
const broadcasts: Array<{ sessionId: number; event: string; payload: any }> = []
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	broadcastToSessionUsers: async (
		_io: any,
		sessionId: number,
		event: string,
		payload: any
	) => {
		broadcasts.push({ sessionId, event, payload })
	}
}))

/** What the adapter was constructed with — the wire's side of R-8. */
const textCalls: Array<{
	tokenLimit: number
	sampling: any
	connection: any
}> = []
/** The chunks the fake streams, in order. */
const CHUNKS = ["The gate ", "was sealed ", "with old iron."]
/**
 * A gate the test holds between the first chunk and the rest, so a Stop can
 * land mid-stream deterministically rather than by racing a timer.
 */
let holdStream: Promise<void> | null = null
let releaseStream: (() => void) | null = null
const armHold = () => {
	holdStream = new Promise<void>((r) => {
		releaseStream = r
	})
}

class FakeAdapter {
	aborted = false
	constructor(p: any) {
		textCalls.push({
			tokenLimit: p?.tokenLimit,
			sampling: p?.sampling,
			connection: p?.connection
		})
	}
	abort() {
		this.aborted = true
		// A stopped stream does not wait for the model to notice.
		releaseStream?.()
	}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt() {
		return this
	}
	withStreaming() {
		return this
	}
	async generateText() {
		return {
			compiledPrompt: {
				prompt: "p",
				messages: undefined,
				meta: {} as any
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				for (let i = 0; i < CHUNKS.length; i++) {
					if (this.aborted) return
					onContent(CHUNKS[i]!)
					if (i === 0 && holdStream) await holdStream
					if (this.aborted) return
				}
			}
		}
	}
}
/** A stand-in whose service falls over, for the failure case. */
class FailingAdapter {
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withCompiledPrompt() {
		return this
	}
	withStreaming() {
		return this
	}
	async generateText(): Promise<never> {
		throw new Error("the service fell over at http://text")
	}
}
let adapterClass: any = FakeAdapter
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: adapterClass })
}))

const DEFAULT_WINDOW = 32768
const PICKED_WINDOW = 3000
const MODEL_WINDOW = 2048
const DEFAULT_TEMP = 0.1
const PICKED_TEMP = 0.9
const REPLY_RESERVE = 200

let userId: number
let characterId: number
let defaultConnectionId: number
let pickedConnectionId: number
let pickedModelId: number
let defaultSamplingId: number
let pickedSamplingId: number
/** An endpoint with a model row but NO registered default — the stale target. */
let staleConnectionId: number
let RESPOND: string

const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as any

/** A session with one character and one user line, ready for a turn. */
async function makeSession(tag: string) {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false })
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId,
		isActive: true,
		visibility: "visible"
	})
	await db.insert(schema.sessionMessages).values({
		sessionId: session.id,
		userId,
		role: "user",
		content: `tell me about the gate (${tag})`
	} as any)
	return session.id
}

const messagesOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(schema.sessionMessages.id)

const events: Array<{ event: string; data: any }> = []
const emit = (event: string, data: any) => {
	events.push({ event, data })
}

const reply = async (sessionId: number, turn?: any) => {
	const { runReply } = await import("$lib/server/utils/runReply")
	return await runReply({
		socket: fakeSocket(userId),
		emitToUser: emit,
		sessionId,
		userId,
		turn: turn ?? { kind: "respond", characterId }
	})
}

const receiptRows = (runId: string) =>
	db
		.select()
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.runId, runId))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-reply-road-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { bootstrapPipelines, RESPOND_SPEC_ID } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	RESPOND = RESPOND_SPEC_ID

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "reply-road")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()
	characterId = character.id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	defaultConnectionId = textConn.id
	const [secondConn] = await db
		.insert(schema.connections)
		.values({
			name: "Second text",
			type: "koboldcpp",
			baseUrl: "http://second-text"
		})
		.returning()
	pickedConnectionId = secondConn.id
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const defaultModelId = (await ensureConnectionModel(
		db,
		textConn.id,
		"default-7b"
	))!.id
	pickedModelId = (await ensureConnectionModel(
		db,
		secondConn.id,
		"picked-7b"
	))!.id

	const sampling = async (name: string, values: any) =>
		(
			await db
				.insert(schema.samplingConfigs)
				.values({
					name,
					isImmutable: false,
					values,
					enabled: ["contextTokens", "responseTokens", "temperature"]
				} as any)
				.returning()
		)[0].id
	defaultSamplingId = await sampling("The capability default", {
		contextTokens: DEFAULT_WINDOW,
		responseTokens: REPLY_RESERVE,
		temperature: DEFAULT_TEMP
	})
	pickedSamplingId = await sampling("The session's pick", {
		contextTokens: PICKED_WINDOW,
		responseTokens: REPLY_RESERVE,
		temperature: PICKED_TEMP
	})

	const [staleConn] = await db
		.insert(schema.connections)
		.values({
			name: "Stale prompt-config target",
			type: "koboldcpp",
			baseUrl: "http://stale"
		})
		.returning()
	staleConnectionId = staleConn.id
	await ensureConnectionModel(db, staleConn.id, "stale-7b")

	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn.id,
		connectionModelId: defaultModelId,
		samplingConfigId: defaultSamplingId
	})
})

/** The verb's row as its handler leaves it: cleared, generating, queued. */
async function verbRow(
	sessionId: number,
	extra: Record<string, unknown> = {}
) {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId,
			userId,
			role: "assistant",
			characterId,
			content: "",
			isGenerating: true,
			generationStage: "queued",
			...extra
		} as any)
		.returning()
	return row!
}

/** A session-scope value on the reply spec — the panel's write, by hand. */
async function sessionOverride(
	sessionId: number,
	nodeKey: string,
	slot: string,
	path: string,
	value: unknown
) {
	const [spec] = await db
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, RESPOND))
	await db.insert(schema.pipelineNodeOverrides).values({
		specId: spec!.id,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey,
		slot,
		path,
		value: value as any
	})
	return async () => {
		await db
			.delete(schema.pipelineNodeOverrides)
			.where(
				and(
					eq(schema.pipelineNodeOverrides.scopeKind, "session"),
					eq(schema.pipelineNodeOverrides.scopeId, sessionId)
				)
			)
	}
}

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("the pipeline owns its row", () => {
	it("one real turn: the only insert is the placeholder's, and the reply fills it", async () => {
		const sessionId = await makeSession("owns")
		const before = await messagesOf(sessionId)
		broadcasts.length = 0
		textCalls.length = 0

		const outcome = await reply(sessionId)
		expect(outcome.error, outcome.error).toBeUndefined()
		expect(outcome.ok).toBe(true)
		const receipt = outcome.receipt!
		expect(receipt.outcome).toBe("ok")

		// ONE new row, and the placeholder made it.
		const after = await messagesOf(sessionId)
		expect(after.length).toBe(before.length + 1)
		const row = after[after.length - 1]!
		expect(row.characterId).toBe(characterId)
		expect(row.role).toBe("assistant")
		// …filled by the update, generation over.
		expect(row.content).toBe(CHUNKS.join(""))
		expect(row.isGenerating).toBe(false)
		expect(row.generationStage).toBeNull()
		expect(row.queueItemId).toBeNull()
		expect(row.error).toBeNull()
		expect(row.isEdited).toBe(false)

		// The nodes that ran, in the reply's shape: inlet → the reads →
		// speaker → placeholder → … → generate → save. The placeholder comes
		// AFTER the speaker node since 2026-09-21 — the row is made for
		// whoever was chosen — and before anything costs a token. The
		// oracle's binding actually ran — no preview halt, no adapter road —
		// and the update targeted the placeholder.
		const keys = receipt.nodes.map((n) => n.nodeKey)
		expect(keys[0]).toBe("input")
		// The settings document rides the inlet (PLAN-turn-order §4.12, R13;
		// A3): resolved once by `runSpec` and published as `$.input.session`,
		// so a spec reads a setting without knowing which table holds it.
		const inletSession = (receipt.nodes[0]!.output as any).session
		expect(inletSession.v).toBe(1)
		expect(inletSession.sessionId).toBe(sessionId)
		expect(inletSession.genreId).toBe("core:genre/chat")
		expect(inletSession.cast.sessionCharacters.map((c: any) => c.character.id)).toEqual([
			characterId
		])
		// No `speaker` node since A6 (PLAN-turn-order §4.4): the fired entry
		// names who speaks, and `placeholder` is the second node — the row
		// is made before anything costs a token.
		expect(keys).not.toContain("speaker")
		expect(keys[1]).toBe("placeholder")
		expect(keys.indexOf("placeholder")).toBeLessThan(keys.indexOf("generate"))
		// The save fills the row; only the sprite tail (DESIGN-sprites §5)
		// follows it, and it writes nothing for a card with no sprites.
		expect(keys.indexOf("save")).toBe(keys.length - 2)
		expect(keys.at(-1)).toBe("sprites")
		const generate = receipt.nodes.find((n) => n.nodeKey === "generate")!
		expect(generate.result).toBe("ok")
		expect((generate.output as any).text).toBe(CHUNKS.join(""))
		const save = receipt.nodes.find((n) => n.nodeKey === "save")!
		expect(save.definitionId).toBe("core:outlet/update-message@1")
		expect((save.input as any).target.ids.id).toBe(row.id)

		// `message-created` genuinely fires now, caused by the placeholder —
		// and `message-updated` by the save. Neither is dry.
		expect(
			receipt.emitted.map((e) => [e.event, e.cause, e.dry ?? false])
		).toEqual([
			["core:event/message-created@1", "placeholder", false],
			["core:event/message-updated@1", "save", false]
		])

		// The host announced the row from the commit — the client's
		// placeholder IS this row — and again when it was filled. Every
		// announcement is this row and this session.
		const rows = broadcasts.filter((b) => b.event === "sessionMessage")
		expect(rows.length).toBeGreaterThanOrEqual(2)
		expect(rows.every((b) => b.sessionId === sessionId)).toBe(true)
		expect(rows.every((b) => b.payload.sessionMessage.id === row.id)).toBe(
			true
		)
		expect(rows[0]!.payload.sessionMessage.isGenerating).toBe(true)
		expect(rows[0]!.payload.sessionMessage.content).toBe("")
		expect(rows.at(-1)!.payload.sessionMessage.isGenerating).toBe(false)
		expect(rows.at(-1)!.payload.sessionMessage.content).toBe(
			CHUNKS.join("")
		)

		// The run's artifacts name the row, created and updated, and the run
		// is not a preview.
		const [run] = await receiptRows(receipt.runId)
		expect(run.isPreview).toBe(false)
		expect(run.outcome).toBe("ok")
		const artifacts = await db
			.select()
			.from(schema.pipelineRunArtifacts)
			.where(eq(schema.pipelineRunArtifacts.runId, run.id))
		expect(
			artifacts.map((a) => [a.kind, a.entityId, a.action, a.nodeKey])
		).toEqual([
			["message", row.id, "created", "placeholder"],
			["message", row.id, "updated", "save"]
		])
	})

	it("the stream lands in the live row while the model writes", async () => {
		const sessionId = await makeSession("stream")
		broadcasts.length = 0
		armHold()

		const done = reply(sessionId)
		// Wait for the first chunk to be persisted: the live row announces
		// each frame it writes.
		await vi.waitFor(() => {
			const frames = broadcasts.filter(
				(b) =>
					b.event === "sessionMessage" &&
					b.payload.sessionMessage.isGenerating &&
					b.payload.sessionMessage.content
			)
			expect(frames.length).toBeGreaterThan(0)
		})
		const frame = broadcasts.find(
			(b) =>
				b.event === "sessionMessage" &&
				b.payload.sessionMessage.isGenerating &&
				b.payload.sessionMessage.content
		)!
		expect(frame.payload.sessionMessage.content).toBe(CHUNKS[0]!.trim())
		// And the row itself carries it: core owns the buffer.
		const [mid] = (await messagesOf(sessionId)).slice(-1)
		expect(mid!.isGenerating).toBe(true)
		expect(mid!.content).toBe(CHUNKS[0]!.trim())

		releaseStream!()
		holdStream = null
		const outcome = await done
		expect(outcome.ok).toBe(true)
		const [final] = (await messagesOf(sessionId)).slice(-1)
		expect(final!.content).toBe(CHUNKS.join(""))
		expect(final!.isGenerating).toBe(false)
	})

	it("a verb re-drives its existing row: the placeholder claims it instead of inserting", async () => {
		const sessionId = await makeSession("regen")
		// The row a regenerate handler leaves behind: cleared, generating.
		const [existing] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				userId,
				role: "assistant",
				characterId,
				content: "",
				isGenerating: true,
				generationStage: "queued"
			} as any)
			.returning()
		const before = await messagesOf(sessionId)

		const outcome = await reply(sessionId, {
			kind: "regenerate",
			messageId: existing.id
		})
		expect(outcome.ok, outcome.error).toBe(true)
		const after = await messagesOf(sessionId)
		expect(after.length).toBe(before.length)
		const row = after.find((m) => m.id === existing.id)!
		expect(row.content).toBe(CHUNKS.join(""))
		expect(row.isGenerating).toBe(false)
		expect(
			(
				outcome.receipt!.nodes.find((n) => n.nodeKey === "placeholder")!
					.output as any
			).ids.id
		).toBe(existing.id)
	})

	it("a continue keeps the partial and joins the reply onto it", async () => {
		const sessionId = await makeSession("continue")
		const PARTIAL = "Long ago,"
		const [existing] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				userId,
				role: "assistant",
				characterId,
				content: PARTIAL,
				isGenerating: true,
				generationStage: "queued"
			} as any)
			.returning()
		const outcome = await reply(sessionId, {
			kind: "continue",
			messageId: existing.id
		})
		expect(outcome.ok, outcome.error).toBe(true)
		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, existing.id))
		expect(row!.content).toBe(`${PARTIAL} ${CHUNKS.join("")}`)
		expect(row!.isGenerating).toBe(false)
		// A verb's rewrite is history moving (R-15): the finishing write
		// recorded `message-updated` with the verb, for the next reply's
		// inlet — and the row landing as `message-completed` (PLAN-turn-order
		// §4.1, A2), which a fresh turn's finish records too.
		const changes = await db
			.select()
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, sessionId))
		expect(changes.map((c) => [c.event, c.messageId, (c.payload as any).verb])).toEqual([
			["core:event/message-updated@1", existing.id, "continue"],
			["core:event/message-completed@1", existing.id, undefined]
		])
		expect(changes[0]!.runId).toBe(outcome.receipt!.runId)
		expect(changes[1]!.runId).toBe(outcome.receipt!.runId)
	})

	/**
	 * The verb on a NARRATION row routes to the narrate spec, and that spec's
	 * placeholder has to claim the row too. It did not: `respond` alone wired
	 * `row`, so a regenerate on a narration inserted a second narration while
	 * the verb's row — already set generating by its handler — spun forever.
	 */
	it("a regenerate on a narration row re-drives the narrate spec, which claims the row", async () => {
		const sessionId = await makeSession("regen-narration")
		const existing = await verbRow(sessionId, {
			characterId: null,
			isNarratorResponse: true,
			metadata: { narratorName: "Narrator" }
		})
		const before = await messagesOf(sessionId)

		const outcome = await reply(sessionId, {
			kind: "regenerate",
			messageId: existing.id
		})
		expect(outcome.ok, outcome.error).toBe(true)
		const { NARRATE_SPEC_ID } = await import(
			"$lib/server/pipelines/specs/narrate"
		)
		expect(outcome.receipt!.specId).toBe(NARRATE_SPEC_ID)

		const after = await messagesOf(sessionId)
		expect(after.length, "a second narration was inserted").toBe(
			before.length
		)
		const row = after.find((m) => m.id === existing.id)!
		expect(row.isGenerating).toBe(false)
		expect(row.isNarratorResponse).toBe(true)
		expect(row.content).toBe(CHUNKS.join(""))
		expect(
			(
				outcome.receipt!.nodes.find((n) => n.nodeKey === "placeholder")!
					.output as any
			).ids.id
		).toBe(existing.id)
		expect(after.some((m) => m.isGenerating)).toBe(false)
	})

	it("a regenerate on a side character's line re-drives narrate-character, which claims the row", async () => {
		const sessionId = await makeSession("regen-side")
		// The side-character FACT lives at `metadata.sideCharacter` since
		// U5g (migration 0138 moved it); `metadata.speaker` is the reference.
		const sideCharacter = { name: "Vell", characterId: null, known: false }
		const existing = await verbRow(sessionId, {
			characterId: null,
			isNarratorResponse: true,
			metadata: { narratorName: "Vell", sideCharacter }
		})
		const before = await messagesOf(sessionId)

		const outcome = await reply(sessionId, {
			kind: "regenerate",
			messageId: existing.id
		})
		expect(outcome.ok, outcome.error).toBe(true)
		const { NARRATE_CHARACTER_SPEC_ID } = await import(
			"$lib/server/pipelines/specs/narrate"
		)
		expect(outcome.receipt!.specId).toBe(NARRATE_CHARACTER_SPEC_ID)

		const after = await messagesOf(sessionId)
		expect(after.length).toBe(before.length)
		const row = after.find((m) => m.id === existing.id)!
		expect(row.isGenerating).toBe(false)
		expect(row.content).toBe(CHUNKS.join(""))
		expect((row.metadata as any).sideCharacter).toEqual(sideCharacter)
		expect(
			(
				outcome.receipt!.nodes.find((n) => n.nodeKey === "placeholder")!
					.output as any
			).ids.id
		).toBe(existing.id)
		expect(after.some((m) => m.isGenerating)).toBe(false)
	})

	/**
	 * Who portrays the side character (U5a, W3): the model does, for this
	 * one turn — `character:<id>` is the inlet's speaker and the receipt
	 * pins it `ai`, cast row or not. And a member's own presence is never
	 * seated that way: the picker does not offer one, and if a pick reaches
	 * this road anyway the speaker reference stays null rather than pinning
	 * the person to a line the model wrote.
	 */
	it("a narrate-character run pins the AI as its speaker's portrayal, and never seats a presence", async () => {
		const sessionId = await makeSession("side-portrayal")
		const [vell] = await db
			.insert(schema.characters)
			.values({ userId, name: "Vell", description: "A shopkeeper." })
			.returning()
		const card = {
			id: vell.id,
			name: "Vell",
			nickname: null,
			description: "A shopkeeper.",
			personality: null
		}
		const outcome = await reply(sessionId, {
			kind: "narrate-character",
			speaker: { name: "Vell", characterId: vell.id, known: false, character: card }
		})
		expect(outcome.ok, outcome.error).toBe(true)
		const receipt: any = outcome.receipt!
		const inlet = receipt.nodes.find((n: any) => n.nodeKey === "input")
		expect(inlet.output.speaker).toBe(`character:${vell.id}`)
		expect(receipt.portrayals[`character:${vell.id}`]).toEqual({ by: "ai" })
		// The row itself carries the same participant reference the inlet
		// published — `metadata.speaker`, the shape 0138 writes for a
		// migrated row (see the placeholder in `narrateCharacter.ts`).
		const vellRow = (await messagesOf(sessionId)).at(-1)!
		expect((vellRow.metadata as any).speaker).toBe(`character:${vell.id}`)
		// The cast member is the AI's too; the owner is themselves.
		expect(receipt.portrayals[`character:${characterId}`]).toEqual({ by: "ai" })
		expect(receipt.portrayals.owner).toEqual({
			by: "person",
			userId: String(userId)
		})

		// The belt: the owner's own presence, picked as a side character.
		const [me] = await db
			.insert(schema.characters)
			.values({
				userId,
				name: "Me",
				description: "The owner's persona.",
				isPersona: true
			})
			.returning()
		await db
			.insert(schema.sessionPersonas)
			.values({ sessionId, personaId: me.id })
		const asMe = await reply(sessionId, {
			kind: "narrate-character",
			speaker: {
				name: "Me",
				characterId: me.id,
				known: false,
				character: { ...card, id: me.id, name: "Me" }
			}
		})
		expect(asMe.ok, asMe.error).toBe(true)
		const meReceipt: any = asMe.receipt!
		const meInlet = meReceipt.nodes.find((n: any) => n.nodeKey === "input")
		// Not the speaker — no reference, while the fact still rides.
		expect(meInlet.output.speaker).toBe(null)
		expect(meInlet.output.sideCharacter.characterId).toBe(me.id)
		const meRow = (await messagesOf(sessionId)).at(-1)!
		expect((meRow.metadata as any).speaker).toBeFalsy()
		// The presence is still asked about (it is in the session) and is
		// its person's, as the member list says — not the model's.
		expect(meReceipt.portrayals[`character:${me.id}`]).toEqual({
			by: "person",
			userId: String(userId)
		})
	})

	it("the tool loop's placeholder claims a verb's row too", async () => {
		// Bound to no genre, so no verb routes to it today; a genre that binds
		// it as its reply function would, and its placeholder has to behave as
		// the others do. Driven as the run a verb would start.
		const sessionId = await makeSession("regen-tools")
		const existing = await verbRow(sessionId)
		const before = await messagesOf(sessionId)
		const { TOOL_LOOP_SPEC_ID } = await import(
			"$lib/server/pipelines/specs"
		)
		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const receipt = await runTurn({
			db,
			sessionId,
			userId,
			specId: TOOL_LOOP_SPEC_ID,
			currentCharacterId: characterId,
			text: "",
			messageId: existing.id,
			skipReceipt: true
		})
		expect(receipt.outcome, receipt.haltReason).toBe("ok")
		const after = await messagesOf(sessionId)
		expect(after.length).toBe(before.length)
		const row = after.find((m) => m.id === existing.id)!
		expect(row.isGenerating).toBe(false)
		expect(row.content).toBe(CHUNKS.join(""))
		expect(
			(
				receipt.nodes.find((n) => n.nodeKey === "placeholder")!
					.output as any
			).ids.id
		).toBe(existing.id)
	})

	it("a settled message can never be claimed as a placeholder", async () => {
		// `row` is a port, and a port is something an authored spec can wire
		// to anything. The row's own state is the guard: only a row already
		// waiting on a run — generating — may be taken over.
		const sessionId = await makeSession("claim-settled")
		const [settled] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId,
				userId,
				role: "assistant",
				characterId,
				content: "A finished reply nobody asked to redo.",
				isGenerating: false
			} as any)
			.returning()
		const outcome = await reply(sessionId, {
			kind: "regenerate",
			messageId: settled!.id
		})
		expect(outcome.ok).toBe(false)
		const placeholder = outcome.receipt!.nodes.find(
			(n) => n.nodeKey === "placeholder"
		)!
		expect(placeholder.result).toBe("err")
		expect(placeholder.reason).toMatch(/not generating/)
		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, settled!.id))
		expect(row!.content).toBe("A finished reply nobody asked to redo.")
		expect(row!.isGenerating).toBe(false)
	})
})

describe("Stop is a run-level guarantee", () => {
	it("cancelled mid-stream: the row ends stopped with the partial, the receipt reads cancelled", async () => {
		const sessionId = await makeSession("stop")
		events.length = 0
		broadcasts.length = 0
		armHold()

		const done = reply(sessionId)
		// The first chunk is on the row before anybody presses anything.
		await vi.waitFor(async () => {
			const [row] = (await messagesOf(sessionId)).slice(-1)
			expect(row?.isGenerating).toBe(true)
			expect(row?.content).toBe(CHUNKS[0]!.trim())
		})
		// The progress card's X: the run is stopped by name, and the row is
		// not touched by the click — finalising it is the run's job.
		const started = events.find((e) => e.event === "pipelines:runStarted")!
		const runRegistry = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		expect(runRegistry.cancel(started.data.runId, userId)).toEqual({
			found: true,
			allowed: true
		})

		const outcome = await done
		expect(outcome.stopped).toBe(true)
		expect(outcome.ok).toBe(false)
		const receipt = outcome.receipt!
		expect(receipt.outcome).toBe("cancelled")
		expect(receipt.cancelledBy).toBe(`user:${userId}`)
		// The oracle's row keeps its own account; the run's is the stop.
		expect(
			receipt.nodes.find((n) => n.nodeKey === "generate")!.result
		).toBe("halt")
		expect(receipt.nodes.some((n) => n.nodeKey === "save")).toBe(false)

		// The row: out of the generating state, holding what had arrived, no
		// error — and saying so: the explicit `stopped` outcome (R-15), set by
		// the run-end finalisation since nothing else released this row.
		const [row] = (await messagesOf(sessionId)).slice(-1)
		expect(row!.isGenerating).toBe(false)
		expect(row!.generationStage).toBeNull()
		expect(row!.generationOutcome).toBe("stopped")
		expect(row!.queueItemId).toBeNull()
		expect(row!.error).toBeNull()
		expect(row!.content).toBe(CHUNKS[0]!.trim())
		expect(row!.content.length).toBeGreaterThan(0)
		// And the stop is a change the next reply's inlet will see, recorded
		// once, by the run that was filling the row — followed by the row
		// landing (`message-completed`, PLAN-turn-order §4.1, A2): a stopped
		// reply is a row that is not generating.
		const changes = await db
			.select()
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, sessionId))
		expect(changes.map((c) => [c.event, c.messageId, c.runId])).toEqual([
			["core:event/message-stopped@1", row!.id, started.data.runId],
			["core:event/message-completed@1", row!.id, started.data.runId]
		])
		expect((changes[1]!.payload as any).cause).toEqual({
			kind: "run",
			runId: started.data.runId
		})
		expect(changes[0]!.payload).toMatchObject({
			textLength: CHUNKS[0]!.trim().length
		})

		// The card was told — per stage while the run went, not only at the
		// end. The oracle's start is the frame that names the stage; a card
		// that saw only `done` was the U3 rename's dead comparison
		// (`kind !== "provider"` against an executor that says `oracle`).
		const frames = events
			.filter((e) => e.event === "pipelines:progress")
			.map((e) => e.data)
		const generate = frames.find((f) => f.nodeKey === "generate")
		expect(generate, "no progress frame for the generate stage").toBeTruthy()
		expect(generate).toMatchObject({
			runId: started.data.runId,
			sessionId,
			stage: "generate"
		})
		// Clause-interior oracles don't count as steps — the two embeds inside
		// the retrieval gathers fire before the reply's generate, but they are
		// not spine Providers, so they never inflate `steps` past the spine
		// count `runStarted` announced. `generate` is the spine's first stage.
		expect(generate.step).toBe(1)
		expect(generate.steps).toBe(started.data.steps)
		expect(started.data.steps).toBeGreaterThanOrEqual(1)
		const last = frames.at(-1)!
		expect(last.done).toBe(true)
		expect(last.cancelled).toBe(true)
		// `stopped` (the registry's own record) outranks the receipt: a
		// cancelled run reads `outcome: "cancelled"` on its terminal frame
		// even though nothing here made the executor's own conversion fail.
		expect(last.outcome).toBe("cancelled")
	})

	/** The message's own Stop, exactly as the socket handler performs it. */
	const stopViaHandler = async (sessionId: number, id?: number) => {
		const { sessionMessagesCancelHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		return await sessionMessagesCancelHandler.handler(
			fakeSocket(userId),
			{ sessionId, id } as any,
			emit
		)
	}

	it("the message's own Stop reaches the run, in the handler's order: the run first, then the rows", async () => {
		const sessionId = await makeSession("stop-message")
		armHold()
		const done = reply(sessionId)
		await vi.waitFor(async () => {
			const [row] = (await messagesOf(sessionId)).slice(-1)
			expect(row?.content).toBe(CHUNKS[0]!.trim())
		})
		const [live] = (await messagesOf(sessionId)).slice(-1)
		const res: any = await stopViaHandler(sessionId, live!.id)
		expect(res.error).toBeUndefined()
		expect(res.success).toMatch(/Cancelled 1/)

		const outcome = await done
		expect(outcome.stopped).toBe(true)
		expect(outcome.receipt!.outcome).toBe("cancelled")
		expect(outcome.receipt!.cancelledBy).toBe(`user:${userId}`)
		expect(outcome.receipt!.nodes.some((n) => n.nodeKey === "save")).toBe(
			false
		)
		// The row's final state, whichever of the two releases landed first:
		// out of the generating state, the partial kept, no error, not an
		// edit — and no second row.
		const rows = await messagesOf(sessionId)
		const row = rows.find((m) => m.id === live!.id)!
		expect(row.isGenerating).toBe(false)
		expect(row.generationStage).toBeNull()
		expect(row.generationOutcome).toBe("stopped")
		expect(row.queueItemId).toBeNull()
		expect(row.error).toBeNull()
		expect(row.isEdited).toBe(false)
		expect(row.content).toBe(CHUNKS[0]!.trim())
		expect(rows.filter((m) => m.role === "assistant").length).toBe(1)
		// Whichever release won — the handler's or the run's — the stop was
		// recorded exactly once, and the row landed once (A2).
		const changes = await db
			.select()
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, sessionId))
		expect(changes.map((c) => [c.event, c.messageId])).toEqual([
			["core:event/message-stopped@1", row.id],
			["core:event/message-completed@1", row.id]
		])
	})

	it("a Stop that released the row before the save landed leaves the partial — the late reply is dropped, not written as an edit", async () => {
		// The race the handler's old order allowed: the rows were released
		// and broadcast, and only THEN was the run told — so a run that had
		// just finished streaming could reach its save node against a row
		// already released. The save's fence missed, and it fell through to
		// the "edit a settled row" branch: the whole reply over the partial
		// the person had kept, marked as their edit. Reproduced here without
		// the registry at all, which is the same thing as the run not having
		// been told yet.
		const sessionId = await makeSession("stop-during-save")
		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		armHold()
		const done = runTurn({
			db,
			sessionId,
			userId,
			currentCharacterId: characterId,
			text: "",
			skipReceipt: true
		})
		await vi.waitFor(async () => {
			const [row] = (await messagesOf(sessionId)).slice(-1)
			expect(row?.content).toBe(CHUNKS[0]!.trim())
		})
		const [live] = (await messagesOf(sessionId)).slice(-1)
		// The handler's unconditional release, as it lands on the row.
		const { updateLegacyWhere } = await import(
			"$lib/server/messages/store"
		)
		await updateLegacyWhere(db, eq(schema.sessionMessages.id, live!.id), {
			isGenerating: false,
			generationStage: null,
			queueItemId: null,
			error: null
		})
		// The model finishes anyway — nobody told it to stop — and the run
		// walks on to its save.
		releaseStream!()
		holdStream = null
		const receipt = await done
		const save = receipt.nodes.find((n) => n.nodeKey === "save")!
		expect(save.result).toBe("ok")

		const [row] = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, live!.id))
		expect(row!.content).toBe(CHUNKS[0]!.trim())
		expect(row!.isEdited).toBe(false)
		expect(row!.isGenerating).toBe(false)
		expect(row!.error).toBeNull()
	})

	it("a concurrent run that is not filling the stopped message survives the Stop", async () => {
		// Somebody else's image render, or a summary, in the same session: an
		// `action` with no row among the released. Before the registry knew
		// what a run was for, a guest's Stop on a reply aborted it.
		const sessionId = await makeSession("stop-others")
		const runRegistry = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		const render = runRegistry.start({
			runId: "render-in-progress",
			userId,
			sessionId,
			specId: "core:spec/generate-image",
			kind: "action"
		})
		try {
			armHold()
			const done = reply(sessionId)
			await vi.waitFor(async () => {
				const [row] = (await messagesOf(sessionId)).slice(-1)
				expect(row?.content).toBe(CHUNKS[0]!.trim())
			})
			const [live] = (await messagesOf(sessionId)).slice(-1)
			await stopViaHandler(sessionId, live!.id)
			const outcome = await done
			expect(outcome.stopped).toBe(true)
			expect(render.controller.signal.aborted).toBe(false)
		} finally {
			runRegistry.finish("render-in-progress")
		}
	})

	it("a failing oracle fails the row it made, never leaves it generating", async () => {
		const sessionId = await makeSession("fail")
		adapterClass = FailingAdapter
		let outcome
		try {
			outcome = await reply(sessionId)
		} finally {
			adapterClass = FakeAdapter
		}
		expect(outcome.ok).toBe(false)
		expect(outcome.receipt?.outcome).toBe("err")
		const [row] = (await messagesOf(sessionId)).slice(-1)
		expect(row!.isGenerating).toBe(false)
		// A service's words are not shown as written — the opaque sentence
		// for everyone, the detail in the administrator-only field.
		expect((row!.error as any)?.message).toMatch(/Generation failed/)
		expect((row!.error as any)?.connection?.detail).toMatch(/fell over/)

		// The terminal `pipelines:progress` frame carries its own outcome
		// (2026-09-16): a card that read `done: true` alone as success said
		// "Respond finished ✓" on exactly this run.
		const terminal = events
			.filter(
				(e) =>
					e.event === "pipelines:progress" &&
					e.data.runId === outcome.receipt?.runId &&
					e.data.done
			)
			.at(-1)
		expect(terminal?.data.outcome).toBe("err")
		expect(terminal?.data.error).toBeTruthy()
	})

	it("a run that THROWS after its placeholder still fails the row — the hook fires on the way out", async () => {
		// A host seam failing outside any binding: the reviewer's transport.
		// The executor used to rethrow past its run-end hook, so the
		// placeholder a fresh turn had made stayed generating with nobody left
		// to finish it.
		const sessionId = await makeSession("throws")
		const restore = await sessionOverride(
			sessionId,
			"save",
			"settings",
			"review",
			"on"
		)
		const gate = await import("$lib/server/pipelines/runtime/reviewGate")
		gate.setReviewTransport(() => {
			throw new Error("the review transport fell over")
		})
		let outcome
		try {
			outcome = await reply(sessionId)
		} finally {
			gate.setReviewTransport(() => {})
			for (const r of gate.pendingReviewsFor(userId))
				gate.resolveReview(r.id, userId, "reject")
			await restore()
		}
		expect(outcome.ok).toBe(false)
		expect(outcome.shown, "the failure is on the row").toBe(true)
		const [row] = (await messagesOf(sessionId)).slice(-1)
		expect(row!.role).toBe("assistant")
		expect(row!.isGenerating).toBe(false)
		expect(row!.generationStage).toBeNull()
		expect(row!.error).not.toBeNull()
	})
})

describe("review lands on the save, when somebody turns it on (R-21 (3))", () => {
	it("nothing is gated by default; enabled on save, the run parks after the placeholder and a reject settles it", async () => {
		const gate = await import("$lib/server/pipelines/runtime/reviewGate")
		gate.setReviewTransport(() => {})
		// Nothing by default: the turns above never parked.
		expect(gate.pendingReviewsFor(userId)).toEqual([])

		const sessionId = await makeSession("review")
		const restore = await sessionOverride(
			sessionId,
			"save",
			"settings",
			"review",
			"on"
		)
		try {
			const done = reply(sessionId)
			await vi.waitFor(
				() => {
					expect(gate.pendingReviewsFor(userId).length).toBe(1)
				},
				{ timeout: 20_000 }
			)
			const review = gate.pendingReviewsFor(userId)[0]!
			// Parked at the SAVE — after the placeholder exists and the model
			// has answered — with the reply's text in front of the reviewer.
			expect(review.nodeKey).toBe("save")
			expect(String(review.values.text)).toBe(CHUNKS.join(""))
			const [parked] = (await messagesOf(sessionId)).slice(-1)
			expect(parked!.role).toBe("assistant")
			expect(parked!.isGenerating).toBe(true)

			gate.resolveReview(review.id, userId, "reject")
			const outcome = await done
			expect(outcome.ok).toBe(false)
			expect(outcome.receipt!.outcome).toBe("halt")
			expect(outcome.receipt!.haltReason).toMatch(/rejected at review/)
			// The placeholder is settled, not left generating, and says why.
			const [row] = (await messagesOf(sessionId)).slice(-1)
			expect(row!.id).toBe(parked!.id)
			expect(row!.isGenerating).toBe(false)
			expect(row!.generationStage).toBeNull()
			expect((row!.error as any)?.message).toMatch(/rejected at review/)
		} finally {
			for (const r of gate.pendingReviewsFor(userId))
				gate.resolveReview(r.id, userId, "reject")
			await restore()
		}
	})
})

describe("a preview performs no writes", () => {
	it("the token estimate runs the placeholder dry and leaves zero rows", async () => {
		const sessionId = await makeSession("preview")
		const before = await messagesOf(sessionId)
		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const receipt = await runTurn({
			db,
			sessionId,
			userId,
			currentCharacterId: characterId,
			text: "",
			preview: true,
			skipReceipt: true
		})
		expect(receipt.outcome).toBe("halt")
		expect(receipt.preview, "no preview report").toBeTruthy()
		const placeholder = receipt.nodes.find(
			(n) => n.nodeKey === "placeholder"
		)!
		expect(placeholder.result).toBe("ok")
		expect(placeholder.dry).toBe(true)
		expect((placeholder.output as any).ids.id).toBe("dry:placeholder")
		expect(receipt.emitted.every((e) => e.dry === true)).toBe(true)
		const after = await messagesOf(sessionId)
		expect(after.length).toBe(before.length)
		expect(after.some((m) => m.isGenerating)).toBe(false)
	})

	it("C13 — the previewed payload is the one the turn sends", async () => {
		// The preview is a dry run of the same document, halted at the
		// oracle with the formed payload; the real turn sends it. The prompt
		// the fake was handed is the render, and the render is deterministic
		// on a seed — so the two agree byte for byte.
		const sessionId = await makeSession("c13")
		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const previewed = await runTurn({
			db,
			sessionId,
			userId,
			currentCharacterId: characterId,
			text: "",
			seed: "seed:c13",
			preview: true,
			skipReceipt: true
		})
		const rendered = previewed.preview!.context.rendered as any
		const previewPrompt = JSON.stringify(rendered?.rendered ?? rendered)

		const sent = await runTurn({
			db,
			sessionId,
			userId,
			currentCharacterId: characterId,
			text: "",
			seed: "seed:c13",
			skipReceipt: true
		})
		expect(sent.outcome).toBe("ok")
		const generate = sent.nodes.find((n) => n.nodeKey === "generate")!
		const request = (generate.request as any)?.compiledPrompt
		expect(JSON.stringify(request?.rendered ?? request)).toBe(previewPrompt)
	})
})

describe("one resolution per run (R-8)", () => {
	/** The mutable copy of the shipped config, so a pick can be written. */
	async function pick(nodeKey: string, slot: string, value: unknown) {
		const { duplicateConfig, selectConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, RESPOND))
		const [existing] = await db
			.select({ id: schema.pipelineConfigs.id })
			.from(schema.pipelineConfigs)
			.where(
				and(
					eq(schema.pipelineConfigs.specId, spec.id),
					eq(schema.pipelineConfigs.name, "reply road (test)")
				)
			)
		let configId = existing?.id
		if (configId === undefined) {
			const [shipped] = await db
				.select()
				.from(schema.pipelineConfigs)
				.where(
					and(
						eq(schema.pipelineConfigs.specId, spec.id),
						eq(schema.pipelineConfigs.isImmutable, true)
					)
				)
			const copy = await duplicateConfig(
				db,
				shipped.id,
				"reply road (test)"
			)
			await selectConfig(db, spec.id, "instance", 0, copy.id, userId)
			configId = copy.id
		}
		await db
			.delete(schema.pipelineConfigValues)
			.where(
				and(
					eq(schema.pipelineConfigValues.configId, configId),
					eq(schema.pipelineConfigValues.nodeKey, nodeKey),
					eq(schema.pipelineConfigValues.slot, slot),
					eq(schema.pipelineConfigValues.path, "")
				)
			)
		await db.insert(schema.pipelineConfigValues).values({
			configId,
			nodeKey,
			slot,
			path: "",
			value: value as any
		})
	}

	const budgetOf = (receipt: any) =>
		receipt.nodes.find((n: any) => n.nodeKey === "contextBudget")!.output
			.main

	it("a prompt config's stale connection_id is not a tier: the reply goes to the capability default", async () => {
		// The legacy "AI Override" picker wrote `prompt_configs.connection_id`.
		// The old walk read it but the capability default outranked it, so
		// on every install that generates the column was dead. Projecting it
		// into the world revived it — pointing at an endpoint with no chosen
		// model — and every reply on such an install refused with "No model
		// is chosen". Decision: the connection half of that tier does not
		// ship; the sampling half, which was live, stays.
		const sessionId = await makeSession("stale-prompt-config")
		const [stale] = await db
			.insert(schema.promptConfigs)
			.values({
				name: "Stale override",
				systemPrompt: "Be brief.",
				connectionId: staleConnectionId
			} as any)
			.returning()
		await db
			.update(schema.sessions)
			.set({ promptConfigId: stale!.id })
			.where(eq(schema.sessions.id, sessionId))
		textCalls.length = 0

		const outcome = await reply(sessionId)
		expect(outcome.ok, outcome.error).toBe(true)
		expect(textCalls.length).toBe(1)
		expect(textCalls[0]!.connection.id).toBe(defaultConnectionId)
		expect(textCalls[0]!.connection.model).toBe("default-7b")
		const generate = outcome.receipt!.nodes.find(
			(n) => n.nodeKey === "generate"
		)!
		expect(String((generate.input as any).connection.id)).toBe(
			String(defaultConnectionId)
		)
	})

	it("the session's sampling pick and the panel's connection pick reach budget and wire as one answer", async () => {
		const sessionId = await makeSession("r8")
		// The session's own choice (tier 3, sampling only) …
		await db
			.update(schema.sessions)
			.set({ samplingConfigId: pickedSamplingId })
			.where(eq(schema.sessions.id, sessionId))
		// … and the panel's pick on the generate node (tier 2, the pair).
		await pick(
			"generate",
			"connection",
			connectionSlotValue(pickedConnectionId, pickedModelId)
		)
		textCalls.length = 0

		const outcome = await reply(sessionId)
		expect(outcome.ok, outcome.error).toBe(true)
		const receipt = outcome.receipt!

		// The executor's resolution, recorded on the generate node's input.
		const generate = receipt.nodes.find((n) => n.nodeKey === "generate")!
		expect(String((generate.input as any).connection.id)).toBe(
			String(pickedConnectionId)
		)
		expect(String((generate.input as any).connection.modelId)).toBe(
			String(pickedModelId)
		)
		expect((generate.input as any).sampling.temperature).toBe(PICKED_TEMP)

		// Dispatch consumed the SAME answer: the connection the adapter was
		// built against, the samplers it was handed, and the window.
		expect(textCalls.length).toBe(1)
		expect(textCalls[0]!.connection.id).toBe(pickedConnectionId)
		expect(textCalls[0]!.connection.model).toBe("picked-7b")
		expect(textCalls[0]!.sampling.temperature).toBe(PICKED_TEMP)
		const budget = budgetOf(receipt)
		expect(budget.window).toBe(PICKED_WINDOW)
		expect(textCalls[0]!.tokenLimit).toBe(budget.window)
		expect(budget.available).toBe(
			Math.floor((PICKED_WINDOW - REPLY_RESERVE) * 0.95)
		)
	})

	it("the model's own context window caps budget, wire and panel through the one function", async () => {
		const sessionId = await makeSession("r8-model")
		await db
			.update(schema.sessions)
			.set({ samplingConfigId: pickedSamplingId })
			.where(eq(schema.sessions.id, sessionId))
		await pick(
			"generate",
			"connection",
			connectionSlotValue(pickedConnectionId, pickedModelId)
		)
		await db
			.update(schema.connectionModels)
			.set({ contextWindow: MODEL_WINDOW })
			.where(eq(schema.connectionModels.id, pickedModelId))
		textCalls.length = 0

		const outcome = await reply(sessionId)
		expect(outcome.ok, outcome.error).toBe(true)
		const budget = budgetOf(outcome.receipt!)
		expect(budget.window).toBe(MODEL_WINDOW)
		expect(textCalls[0]!.tokenLimit).toBe(MODEL_WINDOW)
		const expected = Math.floor((MODEL_WINDOW - REPLY_RESERVE) * 0.95)
		expect(budget.available).toBe(expected)

		// The panel's figure — the tokens a share divides — is the same
		// number, from the same function.
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		// The panel reads the pipeline config's sampling pick, so make the
		// panel's own pick the same row the session chose.
		await pick("generate", "sampling", pickedSamplingId)
		const view: any = await namespaceView(db, "secret", RESPOND, {
			userId,
			isAdmin: true
		})
		// The shares live on the sources since R-7 P5 (2026-09-16): each
		// source's own "Share — …" number carries the window it is a share OF.
		const shareOf = (v: any) =>
			v.steps
				.flatMap((s: any) => [...s.options, ...s.advanced])
				.find((o: any) => /^Share — /.test(o.label))
		expect(shareOf(view)?.windowTokens).toBe(expected)

		// Cleared, the cap is gone everywhere at once.
		await db
			.update(schema.connectionModels)
			.set({ contextWindow: null })
			.where(eq(schema.connectionModels.id, pickedModelId))
		const view2: any = await namespaceView(db, "secret", RESPOND, {
			userId,
			isAdmin: true
		})
		expect(shareOf(view2)?.windowTokens).toBe(
			Math.floor((PICKED_WINDOW - REPLY_RESERVE) * 0.95)
		)
	})
})
