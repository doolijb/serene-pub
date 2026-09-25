/**
 * The built-in writes (R-15, ruled 2026-09-15; plans/30 §U5b): every
 * state-altering write core implements runs as its own one-node spec, always
 * emits what changed and what was lost, and lands in the next reply's inlet
 * as `changes`.
 *
 * What is pinned, and why each half would break silently:
 *
 *  1. **Each built-in is a run.** Invoked through the socket handler as the
 *     session owner, a delete / hide / edit / swipe / branch produces ONE
 *     receipt pinning `core:spec/builtin-*`, registered as an `action` run;
 *     the row changed; the event is on the receipt's `emitted` AND in
 *     `session_changes` with the lost / previous content; the row was
 *     broadcast from the commit, not from the handler.
 *  2. **Floors and opt-ins.** A shape declaring `edit: false` (or `branch`,
 *     `stop`) is refused at registration with a sentence; a genre declaring
 *     `delete: false` is honoured — the handler refuses with the genre's
 *     reason and `sessions:view` reports the control absent.
 *  3. **`sessionChanges` on the next inlet.** Delete a message, run a reply:
 *     the reply's receipt shows the inlet published `sessionChanges` carrying
 *     the deletion with its lost content; the reply's own regenerate-free
 *     finish records nothing; a second reply sees an empty list; a preview
 *     sees the list without consuming it. Consumed AFTER the run and only
 *     when it produced a reply (W1); the content is let go of once consumed
 *     (W4); past fifty the list ends with a truncation marker (S1).
 *  4. **The item rule at the write** (review C1). The review form for a
 *     built-in offers no `target`; a reviewer who submits one is refused with
 *     a sentence and the run stays parked; the host re-judges the actor
 *     against the row it is about to write, so a request that never passed
 *     the handler is refused there too; and a document that is not the
 *     built-in's own cannot perform the write at all (W8).
 *
 * Asserted against the SHIPPED specs published by the bootstrap, with a fake
 * adapter standing in for the model where a reply runs.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

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

/** Every session broadcast the host made, in order. */
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

const REPLY = "The gate was sealed with old iron."
/** Set to make the NEXT model call fail — the oracle erring mid-turn (W1). */
let failNextCall = false
class FakeAdapter {
	constructor(_p: any) {}
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
	async generateText() {
		if (failNextCall) {
			failNextCall = false
			throw new Error("the model fell over")
		}
		return {
			compiledPrompt: {
				prompt: "p",
				messages: undefined,
				meta: {} as any
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(REPLY)
				return { content: REPLY, isAborted: false }
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
let characterId: number

const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as any
const events: Array<{ event: string; data: any }> = []
const emit = (event: string, data: any) => {
	events.push({ event, data })
}

/** A session with one character, one user line and one settled reply. */
async function makeSession(tag: string, genreId?: string) {
	const [session] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, ...(genreId ? { genreId } : {}) })
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId,
		isActive: true,
		visibility: "visible"
	})
	const [user] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			userId,
			role: "user",
			content: `tell me about the gate (${tag})`
		} as any)
		.returning()
	const [reply] = await db
		.insert(schema.sessionMessages)
		.values({
			sessionId: session.id,
			userId,
			role: "assistant",
			characterId,
			content: `The gate (${tag}) is old.`,
			metadata: {}
		} as any)
		.returning()
	return { sessionId: session.id, userId: user.id, replyId: reply.id }
}

const row = async (id: number) =>
	(
		await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, id))
	)[0]

const changesOf = async (sessionId: number) => {
	// Event work runs after the writer, on the session's queue (PLAN §8 (27)).
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	return db
		.select()
		.from(schema.sessionChanges)
		.where(eq(schema.sessionChanges.sessionId, sessionId))
		.orderBy(schema.sessionChanges.id)
}

const runsFor = (specSlug: string, sessionId: number) =>
	db
		.select()
		.from(schema.pipelineRuns)
		.where(
			and(
				eq(schema.pipelineRuns.specSlug, specSlug),
				eq(schema.pipelineRuns.sessionId, sessionId)
			)
		)

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-builtins-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb

	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "builtins")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()
	characterId = character.id

	// A text connection with a capability default, so a reply can run.
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(
		db,
		textConn.id,
		"default-7b"
	))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Default",
			isImmutable: false,
			values: {
				contextTokens: 8192,
				responseTokens: 200,
				temperature: 0.5
			},
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn.id,
		connectionModelId: modelId,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("each built-in is a receipted run that emits what changed", () => {
	it("delete: one receipt on core:spec/builtin-delete, the row gone, the loss recorded", async () => {
		const s = await makeSession("delete")
		const before = await row(s.replyId)
		broadcasts.length = 0
		const { sessionMessagesDeleteHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesDeleteHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId },
			emit
		)
		expect(res.error).toBeUndefined()
		expect(res.success).toMatch(/deleted/)
		expect(await row(s.replyId)).toBeUndefined()

		// One receipt, pinned to the built-in's spec, not a preview.
		const runs = await runsFor("core:spec/builtin-delete", s.sessionId)
		expect(runs.length).toBe(1)
		const run = runs[0]!
		expect(run.outcome).toBe("ok")
		expect(run.isPreview).toBe(false)
		expect(run.specHash).toBeTruthy()
		const receipt = run.receipt as any
		expect(receipt.nodes.map((n: any) => n.nodeKey)).toEqual([
			"input",
			"write"
		])
		expect(receipt.nodes[1].definitionId).toBe(
			"core:outlet/delete-message@1"
		)
		// The event is on the receipt, caused by the write…
		expect(receipt.emitted).toEqual([
			{
				event: "core:event/message-deleted@1",
				cause: "write",
				subscribers: 0
			}
		])
		// …and what was lost is what the outlet published.
		expect(receipt.nodes[1].output.lost).toMatchObject({
			content: before.content,
			role: "assistant",
			speaker: `character:${characterId}`,
			channel: "main"
		})
		// The artifact names the row as deleted.
		const artifacts = await db
			.select()
			.from(schema.pipelineRunArtifacts)
			.where(eq(schema.pipelineRunArtifacts.runId, run.id))
		expect(artifacts.map((a) => [a.kind, a.entityId, a.action])).toEqual([
			["message", s.replyId, "deleted"]
		])
		// And the session's changes carry it with the content, for the
		// next reply's inlet.
		const changes = await changesOf(s.sessionId)
		expect(changes.length).toBe(1)
		expect(changes[0]!.event).toBe("core:event/message-deleted@1")
		expect(changes[0]!.messageId).toBe(s.replyId)
		expect(changes[0]!.runId).toBe(run.runId)
		expect(changes[0]!.consumedByRunId).toBeNull()
		expect((changes[0]!.payload as any).lost.content).toBe(before.content)
	})

	it("hide: the row is a ghost, the direction recorded, the row broadcast from the commit", async () => {
		const s = await makeSession("hide")
		broadcasts.length = 0
		const { sessionMessagesUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesUpdateHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId, isHidden: true },
			emit
		)
		expect(res.error).toBeUndefined()
		expect(res.sessionMessage.isHidden).toBe(true)
		expect((await row(s.replyId)).isHidden).toBe(true)

		const [run] = await runsFor("core:spec/builtin-hide", s.sessionId)
		expect(run).toBeTruthy()
		expect((run!.receipt as any).emitted[0].event).toBe(
			"core:event/message-hidden@1"
		)
		const changes = await changesOf(s.sessionId)
		expect(
			changes.map((c) => [c.event, (c.payload as any).hidden])
		).toEqual([["core:event/message-hidden@1", true]])
		// Announced by the host's commit — the handler broadcasts nothing.
		const rows = broadcasts.filter((b) => b.event === "sessionMessage")
		expect(rows.length).toBe(1)
		expect(rows[0]!.payload.sessionMessage.id).toBe(s.replyId)
		expect(rows[0]!.payload.sessionMessage.isHidden).toBe(true)

		// And back: shown again.
		await sessionMessagesUpdateHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId, isHidden: false },
			emit
		)
		expect((await row(s.replyId)).isHidden).toBe(false)
		expect((await changesOf(s.sessionId)).at(-1)!.payload).toMatchObject({
			hidden: false
		})
	})

	it("edit: a floor — the text replaces, the row is marked edited, the previous text recorded", async () => {
		const s = await makeSession("edit")
		const before = await row(s.replyId)
		broadcasts.length = 0
		const { sessionMessagesUpdateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesUpdateHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId, content: "The gate is new." },
			emit
		)
		expect(res.error).toBeUndefined()
		const after = await row(s.replyId)
		expect(after.content).toBe("The gate is new.")
		expect(after.isEdited).toBe(true)
		expect(after.embedding).toBeNull()

		const [run] = await runsFor("core:spec/builtin-edit", s.sessionId)
		const receipt = run!.receipt as any
		expect(receipt.emitted[0].event).toBe("core:event/message-edited@1")
		expect(receipt.nodes[1].output.previous).toEqual({
			content: before.content
		})
		const changes = await changesOf(s.sessionId)
		expect(changes.length).toBe(1)
		expect((changes[0]!.payload as any).previous.content).toBe(
			before.content
		)
		expect(
			broadcasts.filter((b) => b.event === "sessionMessage").length
		).toBe(1)
	})

	it("swipe: selecting an alternative and recording a new one both emit, with what was showing", async () => {
		const s = await makeSession("swipe")
		// Two alternatives already on the row, the first showing.
		await db
			.update(schema.sessionMessages)
			.set({
				content: "first",
				metadata: {
					swipes: {
						currentIdx: 0,
						history: ["first", "second"],
						thinkingHistory: [null, null]
					}
				}
			})
			.where(eq(schema.sessionMessages.id, s.replyId))
		broadcasts.length = 0
		const {
			sessionMessagesSwipeRightHandler,
			sessionMessagesSwipeLeftHandler
		} = await import("$lib/server/sockets/sessions")

		// Right: onto the second.
		const right: any = await sessionMessagesSwipeRightHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId },
			emit
		)
		expect(right.error).toBeUndefined()
		expect(right.sessionMessage.content).toBe("second")
		expect(right.sessionMessage.isGenerating).toBe(false)
		let changes = await changesOf(s.sessionId)
		expect(changes.length).toBe(1)
		expect(changes[0]!.payload).toMatchObject({
			event: "core:event/message-swiped@1",
			previous: { content: "first", swipeIndex: 0 },
			swipeIndex: 1
		})

		// Left: back onto the first.
		const left: any = await sessionMessagesSwipeLeftHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId },
			emit
		)
		expect(left.error).toBeUndefined()
		expect(left.sessionMessage.content).toBe("first")
		changes = await changesOf(s.sessionId)
		expect(changes.length).toBe(2)
		expect(changes[1]!.payload).toMatchObject({
			previous: { content: "second", swipeIndex: 1 },
			swipeIndex: 0
		})
		const runs = await runsFor("core:spec/builtin-swipe", s.sessionId)
		expect(runs.length).toBe(2)
		expect(
			runs.every(
				(r) =>
					(r.receipt as any).emitted[0].event ===
					"core:event/message-swiped@1"
			)
		).toBe(true)
		// Every navigation was announced from the commit.
		expect(
			broadcasts.filter((b) => b.event === "sessionMessage").length
		).toBe(2)
	})

	it("swipe right past the end: the built-in records the empty alternative, then the reply road fills it and its finish records the verb", async () => {
		const s = await makeSession("swipe-new")
		broadcasts.length = 0
		const { sessionMessagesSwipeRightHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesSwipeRightHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId },
			emit
		)
		expect(res.error).toBeUndefined()
		// The handler answered with the row opened for the run…
		expect(res.sessionMessage.isGenerating).toBe(true)
		// …and the run filled it.
		const after = await row(s.replyId)
		expect(after.isGenerating).toBe(false)
		expect(after.content).toBe(REPLY)
		expect(after.metadata?.swipes?.currentIdx).toBe(1)
		expect(after.metadata?.swipes?.history).toEqual([
			`The gate (swipe-new) is old.`,
			REPLY
		])

		// Three changes: the swipe (the old text lost from view), the
		// rewrite the reply's own finishing write recorded with the verb,
		// and the row LANDING (`message-completed`, PLAN-turn-order §4.1,
		// A2) — the same finishing write, under the run's cause.
		const changes = await changesOf(s.sessionId)
		expect(changes.map((c) => c.event)).toEqual([
			"core:event/message-swiped@1",
			"core:event/message-updated@1",
			"core:event/message-completed@1"
		])
		expect(changes[2]!.runId).toBe(changes[1]!.runId)
		expect((changes[2]!.payload as any).cause).toEqual({
			kind: "run",
			runId: changes[1]!.runId
		})
		// The swipe was consumed by the reply run that followed it — a
		// reply reads what came before it; the rewrite it wrote itself
		// waits for the next one. Consumed, the swipe's content has done
		// its job and is let go of (W4); the index it left stays.
		expect(changes[0]!.consumedByRunId).toBe(changes[1]!.runId)
		expect(changes[0]!.payload).toMatchObject({
			previous: { content: null, swipeIndex: null },
			swipeIndex: 1
		})
		// The receipt of the swipe's own run still says what was showing.
		const [swipeRun] = await runsFor("core:spec/builtin-swipe", s.sessionId)
		expect((swipeRun!.receipt as any).nodes[1].output.previous).toEqual({
			content: `The gate (swipe-new) is old.`,
			swipeIndex: null
		})
		expect(changes[1]!.payload).toMatchObject({ verb: "swipe" })
		expect(changes[1]!.consumedByRunId).toBeNull()
	})

	it("branch: a floor — a new session with the copy, receipted, its first change the fork", async () => {
		const s = await makeSession("branch")
		const [third] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId: s.sessionId,
				userId,
				role: "user",
				content: "after the fork"
			} as any)
			.returning()
		const { sessionsBranchHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionsBranchHandler.handler(
			fakeSocket(userId),
			{ sessionId: s.sessionId, messageId: s.replyId, title: "Fork" },
			emit
		)
		expect(res.error).toBeUndefined()
		const branch = res.session
		expect(branch.id).not.toBe(s.sessionId)
		expect(branch.name).toBe("Fork")
		// Up to and including the fork — the line after it is not copied.
		const copied = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, branch.id))
			.orderBy(schema.sessionMessages.id)
		expect(copied.map((m) => m.content)).toEqual([
			`tell me about the gate (branch)`,
			`The gate (branch) is old.`
		])
		expect(copied.every((m) => !m.isGenerating)).toBe(true)
		expect(third!.id).toBeGreaterThan(s.replyId)

		const [run] = await runsFor("core:spec/builtin-branch", s.sessionId)
		expect(run).toBeTruthy()
		expect((run!.receipt as any).emitted[0].event).toBe(
			"core:event/session-branched@1"
		)
		const artifacts = await db
			.select()
			.from(schema.pipelineRunArtifacts)
			.where(eq(schema.pipelineRunArtifacts.runId, run!.id))
		expect(artifacts.map((a) => [a.kind, a.entityId, a.action])).toEqual([
			["session", branch.id, "created"]
		])
		// Recorded on the NEW session, naming where it came from; the
		// source's history did not move.
		expect(await changesOf(s.sessionId)).toEqual([])
		const changes = await changesOf(branch.id)
		expect(changes.length).toBe(1)
		expect(changes[0]!.payload).toMatchObject({
			event: "core:event/session-branched@1",
			fromSessionId: s.sessionId,
			fromMessageId: s.replyId
		})
	})

	it("a guest who does not own the line is refused before any run exists", async () => {
		const s = await makeSession("refused")
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = (await createTestUser(db, "builtins-guest")).id
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: s.sessionId, userId: guest })
		const { sessionMessagesDeleteHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesDeleteHandler.handler(
			fakeSocket(guest),
			{ id: s.replyId },
			emit
		)
		expect(res.error).toMatch(/Access denied/)
		expect(await row(s.replyId)).toBeTruthy()
		expect(await runsFor("core:spec/builtin-delete", s.sessionId)).toEqual(
			[]
		)
		expect(await changesOf(s.sessionId)).toEqual([])
	})
})

describe("floors and opt-ins", () => {
	it("a shape declaring a floor false is refused at registration with a sentence", async () => {
		const { describeInletDefinition, genre, S } = await import(
			"@serene-pub/sdk"
		)
		for (const floor of ["edit", "branch", "stop"] as const) {
			expect(() =>
				describeInletDefinition({
					id: `test.floors:inlet/${floor}@1`,
					i18n: { name: { en: "Floors" } },
					sessionShape: { messageVerbs: { [floor]: false } } as any,
					ports: { out: { main: S.json } }
				})
			).toThrow(/floors — present in every genre, never switched off/)
			expect(() =>
				genre(`test.floors:genre/${floor}`, {
					name: { en: "Floors" },
					family: "test",
					shape: { messageVerbs: { [floor]: false } } as any
				})
			).toThrow(new RegExp(`${floor}: false`))
		}
		// The opt-ins and the content actions register.
		expect(() =>
			describeInletDefinition({
				id: `test.floors:inlet/opt-ins@1`,
				i18n: { name: { en: "Opt-ins" } },
				sessionShape: {
					messageVerbs: {
						delete: false,
						hide: false,
						swipe: false,
						retry: false
					}
				},
				ports: { out: { main: S.json } }
			})
		).not.toThrow()
	})

	it("delete: false is honoured — the handler refuses with the genre's reason and the view reports the control absent", async () => {
		// A genre whose lines are final: no delete.
		await db.insert(schema.pipelineDefinitionRegistry).values({
			definitionId: "test.final:inlet/encounter",
			version: 1,
			kind: "inlet",
			status: "live",
			i18n: { name: { en: "Final" } },
			ports: {},
			sessionShape: {
				composer: "text",
				messageVerbs: { delete: false }
			}
		} as any)
		const s = await makeSession("final", "test.final:inlet/encounter@1")
		const { sessionMessagesDeleteHandler, sessionsViewHandler } =
			await import("$lib/server/sockets/sessions")
		const res: any = await sessionMessagesDeleteHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId },
			emit
		)
		expect(res.error).toMatch(/'Final'/)
		expect(res.error).toMatch(/does not offer delete/)
		expect(res.error).toMatch(
			/Stopping, branching and editing are always yours/
		)
		expect(await row(s.replyId)).toBeTruthy()
		expect(await runsFor("core:spec/builtin-delete", s.sessionId)).toEqual(
			[]
		)

		const view: any = await sessionsViewHandler.handler(
			fakeSocket(userId),
			{ sessionId: s.sessionId },
			emit
		)
		expect(view.messageVerbs).toEqual({
			retry: true,
			continue: true,
			stepBack: true,
			delete: false,
			hide: true,
			swipe: true
		})
	})
})

describe("changes on the next inlet", () => {
	const reply = async (
		sessionId: number,
		extra: Record<string, unknown> = {}
	) => {
		const { runReply } = await import("$lib/server/utils/runReply")
		return await runReply({
			socket: fakeSocket(userId),
			emitToUser: emit,
			sessionId,
			userId,
			turn: { kind: "respond", characterId },
			...extra
		})
	}

	it("a deletion reaches the next reply's inlet with its lost content, once", async () => {
		const s = await makeSession("changes")
		const lostContent = (await row(s.replyId)).content
		const { sessionMessagesDeleteHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionMessagesDeleteHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId },
			emit
		)

		// A preview sees the change without consuming it.
		const { runTurn } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const preview = await runTurn({
			db,
			sessionId: s.sessionId,
			userId,
			currentCharacterId: characterId,
			text: "",
			preview: true,
			skipReceipt: true
		})
		const peeked = (preview.nodes[0]!.output as any).sessionChanges
		expect(peeked.length).toBe(1)
		expect((await changesOf(s.sessionId))[0]!.consumedByRunId).toBeNull()

		// The real turn: the inlet published the deletion, and consumed it.
		const first = await reply(s.sessionId)
		expect(first.error, first.error).toBeUndefined()
		expect(first.ok).toBe(true)
		const inlet = first.receipt!.nodes[0]!
		expect(inlet.nodeKey).toBe("input")
		const changes = (inlet.output as any).sessionChanges
		expect(changes).toEqual([
			expect.objectContaining({
				event: "core:event/message-deleted@1",
				sessionId: s.sessionId,
				messageId: s.replyId,
				lost: expect.objectContaining({ content: lostContent })
			})
		])
		expect(typeof changes[0].at).toBe("number")
		const [recorded] = await changesOf(s.sessionId)
		expect(recorded!.consumedByRunId).toBe(first.receipt!.runId)
		// Consumed, the content has done its job (W4): the row keeps the
		// event, the ids and the rest of what was lost, and lets the line go.
		expect(recorded!.event).toBe("core:event/message-deleted@1")
		expect(recorded!.messageId).toBe(s.replyId)
		expect((recorded!.payload as any).lost).toMatchObject({
			content: null,
			role: "assistant",
			speaker: `character:${characterId}`
		})

		// A fresh reply's own finish is the history growing, not moving:
		// no verb, no `message-updated` — but the row LANDED, and since
		// PLAN-turn-order A2 that is an event (`message-completed`) on the
		// same ledger, so the second reply sees exactly that one and
		// nothing else.
		const afterFirst = await changesOf(s.sessionId)
		expect(afterFirst.map((c) => c.event)).toEqual([
			"core:event/message-deleted@1",
			"core:event/message-completed@1"
		])
		const second = await reply(s.sessionId)
		expect(second.ok).toBe(true)
		expect(
			(second.receipt!.nodes[0]!.output as any).sessionChanges.map(
				(c: any) => [c.event, c.cause?.kind]
			)
		).toEqual([["core:event/message-completed@1", "run"]])
	})

	it("a reply that fails at the oracle leaves the changes for the next one (W1)", async () => {
		const s = await makeSession("changes-fail")
		const { sessionMessagesDeleteHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		await sessionMessagesDeleteHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId },
			emit
		)

		failNextCall = true
		const failed = await reply(s.sessionId)
		expect(failed.ok).toBe(false)
		expect(failed.receipt?.outcome).toBe("err")
		// The failed run was HANDED the change…
		expect(
			(failed.receipt!.nodes[0]!.output as any).sessionChanges.length
		).toBe(1)
		// …and did not consume it: nothing produced, nothing read.
		const [after] = await changesOf(s.sessionId)
		expect(after!.consumedByRunId).toBeNull()
		expect((after!.payload as any).lost.content).toBeTruthy()

		// The next reply sees the deletion, and then it is gone.
		const next = await reply(s.sessionId)
		expect(next.ok, next.error).toBe(true)
		const seen = (next.receipt!.nodes[0]!.output as any).sessionChanges
		expect(seen.map((c: any) => c.event)).toEqual([
			"core:event/message-deleted@1"
		])
		expect((await changesOf(s.sessionId))[0]!.consumedByRunId).toBe(
			next.receipt!.runId
		)
		// The third sees only what the second's finish landed (A2).
		const third = await reply(s.sessionId)
		expect(
			(third.receipt!.nodes[0]!.output as any).sessionChanges.map(
				(c: any) => c.event
			)
		).toEqual(["core:event/message-completed@1"])
	})

	it("a regenerate's finishing write records what it replaced (W3)", async () => {
		const s = await makeSession("regen")
		const before = (await row(s.replyId)).content
		const { sessionMessagesRegenerateHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesRegenerateHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId },
			emit
		)
		expect(res.error).toBeUndefined()
		expect((await row(s.replyId)).content).toBe(REPLY)
		const changes = await changesOf(s.sessionId)
		expect(changes.map((c) => c.event)).toEqual([
			"core:event/message-updated@1",
			// The regenerated row landed (PLAN-turn-order §4.1, A2).
			"core:event/message-completed@1"
		])
		expect(changes[0]!.payload).toMatchObject({
			verb: "regenerate",
			messageId: s.replyId,
			previous: { content: before }
		})
	})

	it("past fifty, the newest fifty arrive and a last entry says how many were dropped (S1)", async () => {
		const s = await makeSession("overflow")
		const { recordSessionChange, peekSessionChanges, SESSION_CHANGES_CAP } =
			await import("$lib/server/messages/sessionChanges")
		for (let i = 0; i < SESSION_CHANGES_CAP + 5; i++)
			await recordSessionChange(db, {
				event: "core:event/message-hidden@1",
				sessionId: s.sessionId,
				messageId: s.replyId,
				hidden: i % 2 === 0
			})
		const peeked = await peekSessionChanges(db, s.sessionId)
		expect(peeked.length).toBe(SESSION_CHANGES_CAP + 1)
		expect(peeked.at(-1)).toMatchObject({
			event: "core:event/session-changes-truncated@1",
			sessionId: s.sessionId,
			dropped: 5
		})
		expect(
			peeked
				.slice(0, -1)
				.every((c) => c.event === "core:event/message-hidden@1")
		).toBe(true)
		// The marker is a registered event, not an ad-hoc string.
		const { getEvent } = await import("@serene-pub/sdk")
		expect(getEvent("session-changes-truncated")?.version).toBe(1)

		// A reply is handed the same list, and consumes the overflow too —
		// dropped, never delivered late and out of order.
		const r = await reply(s.sessionId)
		expect(r.ok, r.error).toBe(true)
		const seen = (r.receipt!.nodes[0]!.output as any).sessionChanges
		expect(seen.length).toBe(SESSION_CHANGES_CAP + 1)
		expect(seen.at(-1).dropped).toBe(5)
		// Plus the one the reply's own finish landed (`message-completed`,
		// A2), written after the read and so left for the next run.
		const rows = await changesOf(s.sessionId)
		expect(rows.length).toBe(SESSION_CHANGES_CAP + 5 + 1)
		expect(rows.at(-1)!.event).toBe("core:event/message-completed@1")
		expect(rows.at(-1)!.consumedByRunId).toBeNull()
		expect(
			rows
				.slice(0, -1)
				.every((c) => c.consumedByRunId === r.receipt!.runId)
		).toBe(true)
		// The marker is never written to the table.
		expect(
			rows.some(
				(c) => c.event === "core:event/session-changes-truncated@1"
			)
		).toBe(false)
	})
})

describe("a stop belongs to the alternative that was streaming (W2)", () => {
	it("swiping onto another alternative clears the stopped mark; the row is otherwise untouched", async () => {
		const s = await makeSession("stopped-swipe")
		await db
			.update(schema.sessionMessages)
			.set({
				content: "second, cut short",
				generationOutcome: "stopped",
				metadata: {
					swipes: {
						currentIdx: 1,
						history: ["first", "second, cut short"],
						thinkingHistory: [null, null]
					}
				}
			})
			.where(eq(schema.sessionMessages.id, s.replyId))
		const { sessionMessagesSwipeLeftHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionMessagesSwipeLeftHandler.handler(
			fakeSocket(userId),
			{ id: s.replyId },
			emit
		)
		expect(res.error).toBeUndefined()
		const after = await row(s.replyId)
		expect(after.content).toBe("first")
		expect(after.generationOutcome).toBeNull()
		expect(after.metadata?.swipes?.currentIdx).toBe(0)
	})
})

describe("the item rule at the write (review C1)", () => {
	/** A guest with a session seat and one persona line of their own. */
	async function guestWithLine(tag: string) {
		const s = await makeSession(tag)
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const guest = (await createTestUser(db, `builtins-guest-${tag}`)).id
		await db
			.insert(schema.sessionGuests)
			.values({ sessionId: s.sessionId, userId: guest })
		const [persona] = await db
			.insert(schema.characters)
			.values({ userId: guest, name: "Guest", description: "A guest." })
			.returning()
		const [line] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId: s.sessionId,
				userId: guest,
				personaId: persona.id,
				role: "user",
				content: `the guest speaks (${tag})`
			} as any)
			.returning()
		return { ...s, guest, guestLineId: line.id }
	}

	it("the review form for a built-in offers no target; retyping one is refused and the owner's row stands", async () => {
		const s = await guestWithLine("review")
		// Review on for the delete's write, as the session's own setting —
		// the same row the panel writes.
		const [spec] = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, "core:spec/builtin-delete"))
		await db.insert(schema.pipelineNodeOverrides).values({
			specId: spec!.id,
			scopeKind: "session",
			scopeId: s.sessionId,
			nodeKey: "write",
			slot: "settings",
			path: "review",
			value: "on"
		})
		const { pendingReviewsFor, resolveReview, ReviewFieldRefused } =
			await import("$lib/server/pipelines/runtime/reviewGate")
		const { sessionMessagesDeleteHandler } = await import(
			"$lib/server/sockets/sessions"
		)

		// The guest deletes their OWN line — allowed — and the run parks.
		const running = sessionMessagesDeleteHandler.handler(
			fakeSocket(s.guest),
			{ id: s.guestLineId },
			emit
		)
		await vi.waitFor(
			() => expect(pendingReviewsFor(s.guest).length).toBeGreaterThan(0),
			{ timeout: 20_000, interval: 50 }
		)
		const review = pendingReviewsFor(s.guest)[0]!
		expect(review.definitionId).toBe("core:outlet/delete-message@1")
		// No identity field on the form: nothing to edit on a delete.
		expect(review.schema).toEqual({})
		expect(review.values).toEqual({})

		// Retyping the target — at the owner's reply — is refused with a
		// sentence, and the run is still parked, still decidable.
		expect(() =>
			resolveReview(review.id, s.guest, "edit", { target: s.replyId })
		).toThrow(ReviewFieldRefused)
		expect(() =>
			resolveReview(review.id, s.guest, "edit", { target: s.replyId })
		).toThrow(/cannot change 'target'/)
		expect(pendingReviewsFor(s.guest).map((r) => r.id)).toEqual([review.id])
		expect(await row(s.replyId)).toBeTruthy()
		expect(await row(s.guestLineId)).toBeTruthy()

		// Approved, the write lands on the row the handler judged.
		resolveReview(review.id, s.guest, "approve")
		const res: any = await running
		expect(res.error).toBeUndefined()
		expect(await row(s.guestLineId)).toBeUndefined()
		expect(await row(s.replyId)).toBeTruthy()
	})

	it("the host re-judges the actor against the row it is about to write, so a request that skipped the handler is refused", async () => {
		const s = await guestWithLine("host-rule")
		const { runBuiltIn } = await import(
			"$lib/server/pipelines/runtime/builtins"
		)
		// Straight to the run, as a guest, aimed at the owner's reply.
		const outcome = await runBuiltIn(db, {
			kind: "delete",
			sessionId: s.sessionId,
			actor: s.guest,
			payload: { target: s.replyId }
		})
		expect(outcome.ok).toBe(false)
		expect(outcome.error).toMatch(
			/don't have permission to change this message/
		)
		expect(outcome.receipt.outcome).toBe("err")
		expect(await row(s.replyId)).toBeTruthy()
		expect(await changesOf(s.sessionId)).toEqual([])
		// No actor is no permission.
		const nobody = await runBuiltIn(db, {
			kind: "edit",
			sessionId: s.sessionId,
			actor: undefined as unknown as number,
			payload: { target: s.replyId, text: "rewritten" }
		})
		expect(nobody.ok).toBe(false)
		expect((await row(s.replyId)).content).not.toBe("rewritten")
		// Their own line, they may.
		const own = await runBuiltIn(db, {
			kind: "hide",
			sessionId: s.sessionId,
			actor: s.guest,
			payload: { target: s.guestLineId, hidden: true }
		})
		expect(own.ok, own.error).toBe(true)
		expect((await row(s.guestLineId)).isHidden).toBe(true)
	})

	it("a branch is re-checked as owner-only at the write", async () => {
		const s = await guestWithLine("host-branch")
		const { runBuiltIn } = await import(
			"$lib/server/pipelines/runtime/builtins"
		)
		const outcome = await runBuiltIn(db, {
			kind: "branch",
			sessionId: s.sessionId,
			actor: s.guest,
			payload: { fromMessage: s.replyId, title: "Guest fork" }
		})
		expect(outcome.ok).toBe(false)
		expect(outcome.error).toMatch(/only the session's owner may branch/)
		const forks = await db
			.select({ id: schema.sessions.id })
			.from(schema.sessions)
			.where(eq(schema.sessions.name, "Guest fork"))
		expect(forks).toEqual([])
	})

	it("a document that is not the built-in's own cannot perform the write (W8)", async () => {
		const s = await makeSession("sweep")
		const { spec, compile, validate } = await import("@serene-pub/sdk")
		const C = await import("@serene-pub/contracts")
		const doc = compile(
			spec("test.tidy:spec/sweep", { version: "1.0.0" })
				.inlet("input", C.builtInRequest.v1())
				.outlet("write", ($: any) =>
					C.deleteMessage.v1({ target: $.input.target })
				)
				.build()
		)
		// The SDK refuses it at publish — and so does the instance's publish,
		// which runs `validate()` since the U5d review (W9)…
		expect(validate(doc).map((f) => f.law)).toContain("R-15")
		const { saveDocument } = await import(
			"$lib/server/pipelines/boot/store"
		)
		await expect(saveDocument(db, doc, { publish: true })).rejects.toThrow(
			/does not validate — \[R-15\].*a built-in write/
		)
		// …and a host that meets it anyway — a row patched behind the door —
		// refuses at the write. Published as a document that validates, then
		// the stored outlet is rewritten to the built-in's.
		const schema = await import("$lib/server/db/schema")
		const { eq, and } = await import("drizzle-orm")
		const patchable = compile(
			spec("test.tidy:spec/sweep", { version: "1.0.0" })
				.inlet("input", C.builtInRequest.v1())
				.outlet("write", ($: any) =>
					C.hideMessage.v1({ target: $.input.target })
				)
				.build()
		)
		// `hide-message` is a built-in too; the same refusal would meet it.
		// So it is stored under a harmless outlet first — `attach-image`,
		// whose `target` takes the same row ids and which no R-15 rule names…
		patchable.nodes.find((n) => n.key === "write")!.definitionId =
			"core:outlet/attach-image"
		patchable.edges = patchable.edges.map((e) =>
			e.to === "write" ? { ...e, toPort: "target" } : e
		)
		const saved = await saveDocument(db, patchable, { publish: true })
		// …and rewritten in place to the delete, as a bypass would.
		await db
			.update(schema.pipelineNodes)
			.set({ definitionId: "core:outlet/delete-message" })
			.where(
				and(
					eq(schema.pipelineNodes.specVersionId, saved.specVersionId),
					eq(schema.pipelineNodes.nodeKey, "write")
				)
			)
		const { runSpec } = await import(
			"$lib/server/pipelines/runtime/runTurn"
		)
		const receipt = await runSpec({
			db,
			sessionId: s.sessionId,
			userId,
			specId: "test.tidy:spec/sweep",
			input: {
				sessionId: s.sessionId,
				sessionScope: {
					sessionId: s.sessionId,
					currentCharacterId: null
				},
				target: s.replyId
			},
			skipReceipt: true
		})
		expect(receipt.outcome).toBe("err")
		expect(receipt.haltReason).toMatch(/not a built-in's spec/)
		expect(await row(s.replyId)).toBeTruthy()
		expect(await changesOf(s.sessionId)).toEqual([])
	})
})

describe("a branch's runs (S5)", () => {
	it("pipelines:runs for the branched session includes the run that made it", async () => {
		const s = await makeSession("branch-runs")
		const { sessionsBranchHandler } = await import(
			"$lib/server/sockets/sessions"
		)
		const res: any = await sessionsBranchHandler.handler(
			fakeSocket(userId),
			{ sessionId: s.sessionId, messageId: s.replyId, title: "Runs" },
			emit
		)
		expect(res.error).toBeUndefined()
		const { pipelinesRuns } = await import("$lib/server/sockets/pipelines")
		await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
		// Read as an admin: the runs list is an administrator's (R55).
		const listed: any = await pipelinesRuns.handler(
			{ user: { id: userId, isAdmin: true }, io: {} } as any,
			{ sessionId: res.session.id },
			emit
		)
		// The branch's own run, and the branch's first turn-order recompute:
		// a branch recomputes at birth (PLAN-turn-order §4.5), which is what
		// gives a forked session an order without a backfill.
		// In either order: the recompute runs after the branch's write, on the
		// session's queue, and may save its row first (PLAN §8 (27)).
		expect(listed.runs.map((r: any) => r.specSlug).sort()).toEqual([
			"core:spec/builtin-branch",
			"core:spec/chat-turn-order"
		])
		const branchRun = listed.runs.find((r: any) => r.specSlug === "core:spec/builtin-branch")
		// The run row itself still sits on the session it ran in.
		expect(branchRun.sessionId).toBe(s.sessionId)
		expect(branchRun.artifacts).toEqual([
			expect.objectContaining({
				kind: "session",
				entityId: res.session.id
			})
		])
	})
})
