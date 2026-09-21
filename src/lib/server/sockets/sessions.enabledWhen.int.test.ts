/**
 * Enabled-when on the roads a model drives (plans/29 R-15 *enabled-when*;
 * plans/30 U5e review, 2026-09-17) — the two the actions suite cannot reach
 * without a faked model, over the real handlers.
 *
 *  1. **The oracle road is admitted as the click road is (W1).** A form's
 *     answer action declaring `session.generating equals false` is fired by
 *     the answer pipeline while the asking run and the answer run are both
 *     still registered — its own tree — and `sessionGenerating` sets that
 *     tree aside: the grandchild runs and Tom's line lands. A second root
 *     running beside the tree still refuses it.
 *  2. **The reply road pushes the list at its start and its end (C1,
 *     W-A1).** After a regenerate through `sessionMessages:regenerate`,
 *     every member's socket receives `sessions:actions` twice — `retry`
 *     grey with the generating reason, then `enabled: true` — the server
 *     deciding the verdict moved, whichever way the reply ended; the
 *     terminal frame precedes the end push (W-A6).
 *  3. **A parked run pushes when it settles (W-A2, S-A2).** On the trigger
 *     road a run parked at review pushes once at its start and once when
 *     the owner decides — approved (ok), rejected (halt) or cancelled —
 *     never while it waits; a grandchild parked at review pushes from its
 *     own settle, after every root has already pushed.
 *  4. **`state:changed` follows the push (W-A3).** A reply whose spec moves
 *     state announces it only after the run has left the registry and the
 *     list has gone out, so a member's last-received listing reads
 *     `enabled: true` and a relist on `state:changed` cannot race it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import type { MessageBlock, SpecDocument } from "@serene-pub/sdk"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "when-test-secret" }
})

/** The model, faked: `{"choice":"maybe"}` for the oracle, a line for a reply. */
let modelAnswer = '{"choice":"maybe"}'
class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	constructor(_p: any) {}
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
	async generateText() {
		const answer = modelAnswer
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(answer)
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))
vi.mock("$lib/server/utils/resolveTaskConfig", () => ({
	resolveTaskConfig: async () => ({
		connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
		sampling: { id: 1 }
	})
}))
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real =
		await importOriginal<
			typeof import("$lib/server/connections/capabilityTarget")
		>()
	return {
		...real,
		resolveCapabilityTarget: async (
			db: Db,
			req: Parameters<typeof real.resolveCapabilityTarget>[1]
		) => {
			const target = await real.resolveCapabilityTarget(db, req)
			if (target.ok) return target
			return {
				ok: true,
				capability: req.capability,
				connection: {
					id: 1,
					type: "koboldcpp",
					promptFormat: "vicuna"
				},
				sampling: { id: 1 },
				connectionVia: "pipelineConfig",
				samplingVia: "pipelineConfig"
			}
		}
	}
})
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		sampling: { id: 1 },
		contextConfig: { id: 1 },
		promptConfig: { id: 1, systemPrompt: "Stay in character." }
	})
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const CHAT = "core:genre/chat"

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-when-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

/** One connected socket per member, each holding `sessions:actions#<session>` and `state:changed#<session>`, every emit recorded. */
function recordingIo(userIds: number[], sessionId: number) {
	const emitted: Array<{ room: string; event: string; payload: any }> = []
	const sockets = new Map(
		userIds.map((id) => [
			`socket-${id}`,
			{
				id: `socket-${id}`,
				user: { id, isAdmin: false },
				interest: new Set([
					`sessions:actions#${sessionId}`,
					`state:changed#${sessionId}`
				])
			}
		])
	)
	const io = {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) => {
						const m = /^user_(\d+)$/.exec(room)
						return m && sockets.has(`socket-${m[1]}`)
							? new Set([`socket-${m[1]}`])
							: undefined
					}
				}
			},
			sockets: {
				get: (id: string) => sockets.get(id),
				values: () => sockets.values()
			}
		},
		to: (room: string) => ({
			emit: (event: string, payload: any) =>
				emitted.push({ room, event, payload })
		})
	}
	return { io: io as any, emitted }
}

function fakeSocket(userId: number, io?: any) {
	return {
		user: { id: userId, isAdmin: false },
		io: io ?? { to: () => ({ emit: () => {} }) }
	} as any
}
const noopEmit = () => {}

async function character(userId: number, name: string) {
	const schema = await import("$lib/server/db/schema")
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: name })
		.returning()
	return row!.id
}

/** A chat session with an owner, a guest, and a cast character Tom nobody portrays. */
async function sessionWithTom(tag: string) {
	const schema = await import("$lib/server/db/schema")
	const owner = await makeUser(`${tag}-owner`)
	const guest = await makeUser(`${tag}-guest`)
	const [session] = await testDb
		.insert(schema.sessions)
		.values({ userId: owner.id, isGroup: false, genreId: CHAT })
		.returning()
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId: session!.id, userId: guest.id })
	const tom = await character(owner.id, `Tom ${tag}`)
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: session!.id,
		characterId: tom,
		isActive: true,
		visibility: "visible"
	})
	return { owner, guest, session: session!, tom }
}

/**
 * Ask writes a choices block to Tom; Answer — the block's action — declares
 * the busy rule and writes the chosen label as Tom. The same pair the forms
 * suite uses, with one predicate on Answer.
 */
async function publishAskAndAnswer(tag: string, tom: number) {
	const { spec, compile } = await import("@serene-pub/sdk")
	const C = await import("@serene-pub/contracts")
	const { chatGenre } = await import("@serene-pub/core-catalog")
	const { saveDocument } = await import("$lib/server/pipelines/boot/store")
	const askId = `core:spec/test-${tag}-ask`
	const answerId = `core:spec/test-${tag}-answer`
	const askFn = `${tag}-ask`
	const answerFn = `${tag}-answer`
	const answerAction = `${answerId}#${answerFn}`
	const blocks: MessageBlock[] = [
		{
			kind: "choices",
			addressee: `character:${tom}` as any,
			question: "Will you come to the festival?",
			actions: [
				{
					fn: answerFn,
					action: answerAction,
					label: "Yes",
					choice: "yes"
				},
				{
					fn: answerFn,
					action: answerAction,
					label: "Maybe",
					choice: "maybe"
				},
				{
					fn: answerFn,
					action: answerAction,
					label: "No",
					choice: "no"
				}
			]
		}
	]
	const ask: SpecDocument = compile(
		spec(askId, {
			version: "1.0.0",
			taxonomy: { role: "action", genre: CHAT },
			contributes: {
				actions: [
					{
						key: askFn,
						genre: CHAT,
						venue: { kind: "composer" },
						label: { en: "Ask" }
					}
				]
			}
		})
			.inlet("input", C.userMessage.v1(), {
				genre: chatGenre,
				event: "core:event/session-action@1"
			})
			.outlet("save", () =>
				C.createMessage.v1({
					narration: true,
					text: "Will you come to the festival?",
					blocks: blocks as any
				})
			)
			.build()
	)
	const answer: SpecDocument = compile(
		spec(answerId, {
			version: "1.0.0",
			taxonomy: { role: "action", genre: CHAT },
			contributes: {
				actions: [
					{
						key: answerFn,
						genre: CHAT,
						venue: { kind: "form" },
						audience: {
							see: ["participant"],
							act: ["participant"]
						},
						label: { en: "Answer" },
						enabledWhen: {
							on: "session.generating",
							equals: false,
							reason: { en: "Let the reply land first." }
						}
					}
				]
			}
		})
			.inlet("input", C.userMessage.v1(), {
				genre: chatGenre,
				event: "core:event/session-action@1"
			})
			.task("answer", ($) =>
				C.readAnswer.v1({
					payload: $.input.payload,
					form: $.input.form
				})
			)
			.outlet("save", ($) =>
				C.createMessage.v1({
					text: $.answer.label,
					characterId: $.answer.characterId,
					speaker: $.answer.addressee
				})
			)
			.build()
	)
	const batch = new Set([askId, answerId])
	await saveDocument(testDb as any, ask, { publish: true, batch })
	await saveDocument(testDb as any, answer, { publish: true, batch })
	return { askId, answerId, askFn, answerFn }
}

async function runsOf(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select({
			runId: schema.pipelineRuns.runId,
			specSlug: schema.pipelineRuns.specSlug,
			outcome: schema.pipelineRuns.outcome,
			haltReason: schema.pipelineRuns.haltReason,
			depth: schema.pipelineRuns.depth
		})
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(asc(schema.pipelineRuns.id))
}

const all = (v?: { primary: any[]; overflow: any[] }) => [
	...(v?.primary ?? []),
	...(v?.overflow ?? [])
]

describe("W1 · the oracle road", () => {
	test("a form's answer with a session.generating predicate is admitted while its own tree runs, and refused beside a second root", async () => {
		const schema = await import("$lib/server/db/schema")
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const runRegistry = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		const { owner, session, tom } = await sessionWithTom("oracle")
		const { askId, askFn, answerId } = await publishAskAndAnswer(
			"oracle",
			tom
		)
		modelAnswer = '{"choice":"maybe"}'

		const asked = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(owner.id),
			{
				sessionId: session.id,
				action: `${askId}#${askFn}`
			},
			noopEmit
		)
		expect(asked.error).toBeUndefined()
		const runs = await runsOf(session.id)
		expect(runs.map((r) => r.specSlug)).toEqual([
			askId,
			"core:spec/answer-form-chat",
			answerId
		])
		const grandchild = runs[2]!
		// Admitted — its own root and parent were registered when it fired,
		// and they are not "something else generating".
		expect(grandchild.outcome).toBe("ok")
		expect(grandchild.depth).toBe(2)
		const rows = await testDb
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, session.id))
			.orderBy(asc(schema.sessionMessages.id))
		expect(rows[rows.length - 1]).toMatchObject({
			content: "Maybe",
			characterId: tom
		})

		// A second root running beside the tree is not the tree's: the same
		// road, refused at the fire with the predicate's sentence, receipted
		// as the grandchild's halt.
		const other = runRegistry.start({
			runId: `oracle-other-${session.id}`,
			userId: owner.id,
			sessionId: session.id,
			specId: "core:spec/test",
			kind: "action"
		})
		try {
			const again = await sessionsTriggerFunctionHandler.handler(
				fakeSocket(owner.id),
				{
					sessionId: session.id,
					action: `${askId}#${askFn}`
				},
				noopEmit
			)
			// The asking action itself declares nothing and runs.
			expect(again.error).toBeUndefined()
		} finally {
			runRegistry.finish(other.runId)
		}
		const after = await runsOf(session.id)
		const refused = after[after.length - 1]!
		expect(refused.specSlug).toBe(answerId)
		expect(refused.outcome).toBe("halt")
		expect(refused.haltReason).toMatch(/Let the reply land first\./)
	})
})

describe("C1 / W-A1 · the reply road pushes the list at its start and its end", () => {
	test("after sessionMessages:regenerate, each member's socket receives sessions:actions twice: retry grey while generating, then enabled", async () => {
		const schema = await import("$lib/server/db/schema")
		const { sessionMessagesRegenerateHandler } = await import("./sessions")
		const { owner, guest, session, tom } = await sessionWithTom("regen")
		// A persona line, then Tom's reply — the newest, regenerable row.
		await testDb.insert(schema.sessionMessages).values({
			sessionId: session.id,
			role: "user",
			content: "Hello?",
			userId: owner.id
		})
		const [tomsLine] = await testDb
			.insert(schema.sessionMessages)
			.values({
				sessionId: session.id,
				role: "assistant",
				content: "Hi.",
				characterId: tom,
				userId: owner.id
			})
			.returning()
		modelAnswer = "Hello again."
		const { CORE_VERB_REASONS } = await import("@serene-pub/sdk")
		const { io, emitted } = recordingIo([owner.id, guest.id], session.id)
		// The caller's own frames, in the same record as the pushes, so their
		// order can be read.
		const ownEmit = (event: string, payload: any) =>
			emitted.push({ room: "caller", event, payload })

		const res = await sessionMessagesRegenerateHandler.handler(
			fakeSocket(owner.id, io),
			{ id: tomsLine!.id },
			ownEmit
		)
		// The road ran (a fake model answered) — and whichever way it
		// ended, the list followed the run's start and its end.
		expect(res.error ?? "").not.toMatch(
			/permission|only the newest|wait for the reply/
		)
		const pushes = emitted.filter((e) => e.event === "sessions:actions")
		for (const room of [`socket-${owner.id}`, `socket-${guest.id}`]) {
			const mine = pushes.filter((p) => p.room === room)
			expect(mine, room).toHaveLength(2)
			const retryOf = (push: (typeof mine)[number]) =>
				all(push.payload.venues.message).find(
					(a: any) => a.key === "retry"
				)
			expect(mine[0]!.payload.sessionId).toBe(session.id)
			expect(retryOf(mine[0]!)).toMatchObject({
				enabled: false,
				reason: { i18n: CORE_VERB_REASONS.generating }
			})
			expect(retryOf(mine[1]!)).toMatchObject({ enabled: true })
			expect(retryOf(mine[1]!).reason).toBeUndefined()
		}
		// The terminal frame goes out before the end push (W-A6): a card
		// that clears, then a list.
		const terminalAt = emitted.findIndex(
			(e) => e.event === "pipelines:progress" && e.payload?.done
		)
		expect(terminalAt).toBeGreaterThanOrEqual(0)
		const lastPushAt = emitted.reduce(
			(at, e, i) => (e.event === "sessions:actions" ? i : at),
			-1
		)
		expect(lastPushAt).toBeGreaterThan(terminalAt)
		// Nothing generating any more: the row settled with the run.
		const [row] = await testDb
			.select({ isGenerating: schema.sessionMessages.isGenerating })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, tomsLine!.id))
		expect(row!.isGenerating).toBe(false)
	})
})

/** Review ON for one spec's `save` node, as the session's own override. */
async function reviewSave(specSlug: string, sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	const [spec] = await testDb
		.select({ id: schema.pipelineSpecs.id })
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.slug, specSlug))
	await testDb.insert(schema.pipelineNodeOverrides).values({
		specId: spec!.id,
		scopeKind: "session",
		scopeId: sessionId,
		nodeKey: "save",
		slot: "settings",
		path: "review",
		value: "on"
	})
}

const retryOf = (push: { payload: any }) =>
	all(push.payload.venues.message).find((a: any) => a.key === "retry")

describe("S-A2 / W-A2 · a parked run pushes when it settles, and never while it waits", () => {
	/**
	 * Echo parks at its `save` (review on): the trigger road pushes once at
	 * the start, answers `parked`, and pushes once more only when the owner
	 * decides — whichever way. `decide` is the decision; `ended` is what the
	 * terminal frame must say.
	 */
	async function parkedRoot(
		tag: string,
		decide: (reviewId: string, ownerId: number, runId: string) => void,
		ended: "ok" | "halt" | "cancelled"
	) {
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const { pendingReviewsFor } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		const { CORE_VERB_REASONS } = await import("@serene-pub/sdk")
		const { owner, session } = await sessionWithTom(tag)
		await reviewSave("core:spec/echo", session.id)
		const { io, emitted } = recordingIo([owner.id], session.id)
		const ownEmit = (event: string, payload: any) =>
			emitted.push({ room: "caller", event, payload })
		const pushes = () =>
			emitted.filter((e) => e.event === "sessions:actions")
		const runId = `echo-${tag}`

		const ack = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(owner.id, io),
			{
				sessionId: session.id,
				action: "core:spec/echo#echo",
				runId
			},
			ownEmit
		)
		expect(ack).toMatchObject({ parked: true })
		// The rise, and nothing more while it waits.
		expect(pushes()).toHaveLength(1)
		expect(retryOf(pushes()[0]!)).toMatchObject({
			enabled: false,
			reason: { i18n: CORE_VERB_REASONS.generating }
		})
		const [review] = pendingReviewsFor(owner.id).filter(
			(r) => r.specId === "core:spec/echo"
		)
		expect(review).toBeTruthy()

		decide(review!.id, owner.id, runId)
		await vi.waitFor(() => expect(pushes()).toHaveLength(2), {
			timeout: 30_000,
			interval: 50
		})
		// The fall: exactly one more, retry open, after the terminal frame.
		expect(retryOf(pushes()[1]!)).toMatchObject({ enabled: true })
		const terminal = emitted.find(
			(e) => e.event === "pipelines:progress" && e.payload?.done
		)
		expect(terminal?.payload).toMatchObject({ runId, outcome: ended })
		expect(emitted.indexOf(terminal!)).toBeLessThan(
			emitted.indexOf(pushes()[1]!)
		)
		// Settled for good: nothing follows.
		await new Promise((r) => setTimeout(r, 200))
		expect(pushes()).toHaveLength(2)
		return { session, owner }
	}

	test("approved: one push at the start, one when the line lands (ok)", async () => {
		const { resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		const { session } = await parkedRoot(
			"park-ok",
			(id, ownerId) =>
				resolveReview(id, ownerId, "edit", { text: "hello" }),
			"ok"
		)
		const rows = await runsOf(session.id)
		expect(rows.map((r) => `${r.specSlug}:${r.outcome}`)).toEqual([
			"core:spec/echo:ok"
		])
	})

	test("rejected: one push at the start, one when the run halts", async () => {
		const { resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		const { session } = await parkedRoot(
			"park-halt",
			(id, ownerId) => resolveReview(id, ownerId, "reject"),
			"halt"
		)
		expect((await runsOf(session.id)).map((r) => r.outcome)).toEqual([
			"halt"
		])
	})

	test("cancelled while parked: one push at the start, one when the stop lands", async () => {
		const runRegistry = await import(
			"$lib/server/pipelines/runtime/runRegistry"
		)
		await parkedRoot(
			"park-cancel",
			(_id, ownerId, runId) => {
				expect(runRegistry.cancel(runId, ownerId)).toEqual({
					found: true,
					allowed: true
				})
			},
			"cancelled"
		)
	})

	test("a grandchild parked at review pushes from its own settle, after every root has pushed (W-A2)", async () => {
		const schema = await import("$lib/server/db/schema")
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const { pendingReviewsFor, resolveReview } = await import(
			"$lib/server/pipelines/runtime/reviewGate"
		)
		const { owner, session, tom } = await sessionWithTom("park-child")
		const { askId, askFn, answerId } = await publishAskAndAnswer(
			"park-child",
			tom
		)
		await reviewSave(answerId, session.id)
		modelAnswer = '{"choice":"maybe"}'
		const { io, emitted } = recordingIo([owner.id], session.id)
		const pushes = () =>
			emitted.filter((e) => e.event === "sessions:actions")

		const asked = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(owner.id, io),
			{
				sessionId: session.id,
				action: `${askId}#${askFn}`
			},
			noopEmit
		)
		expect(asked.error).toBeUndefined()
		// The root's rise and fall — the parked grandchild pushed nothing yet.
		expect(pushes()).toHaveLength(2)
		const [review] = pendingReviewsFor(owner.id).filter(
			(r) => r.specId === answerId
		)
		expect(review).toMatchObject({ nodeKey: "save" })

		resolveReview(review!.id, owner.id, "approve")
		await vi.waitFor(() => expect(pushes()).toHaveLength(3), {
			timeout: 30_000,
			interval: 50
		})
		expect(retryOf(pushes()[2]!)).toMatchObject({ enabled: true })
		await vi.waitFor(
			async () =>
				expect(
					(
						await testDb
							.select({ content: schema.sessionMessages.content })
							.from(schema.sessionMessages)
							.where(
								eq(schema.sessionMessages.sessionId, session.id)
							)
							.orderBy(asc(schema.sessionMessages.id))
					).pop()?.content
				).toBe("Maybe"),
			{ timeout: 30_000, interval: 50 }
		)
		await new Promise((r) => setTimeout(r, 200))
		expect(pushes()).toHaveLength(3)
	})
})

describe("W-A3 · a reply that moves state announces it after the list", () => {
	test("state:changed follows the end push, and the member's last-received listing reads enabled: true", async () => {
		const schema = await import("$lib/server/db/schema")
		const { spec, compile, sessionEvents, slot } = await import(
			"@serene-pub/sdk"
		)
		const C = await import("@serene-pub/contracts")
		const { chatGenre } = await import("@serene-pub/core-catalog")
		const { saveDocument } = await import(
			"$lib/server/pipelines/boot/store"
		)
		const { triggerGenerateMessageHandler } = await import("./sessions")
		const { owner, guest, session, tom } =
			await sessionWithTom("state-reply")

		// A reply spec of the test's own: it moves state (a proposal for the
		// world's weather), then writes Tom's line — bound for this session.
		const specId = "core:spec/test-state-reply"
		const doc: SpecDocument = compile(
			spec(specId, {
				version: "1.0.0",
				taxonomy: { role: "primary", genre: CHAT }
			})
				.inlet("input", C.userMessage.v1(), {
					genre: chatGenre,
					event: sessionEvents.messageRespond
				})
				.task("state", ($) =>
					C.setState.v1({
						changes: [
							{
								owner: { kind: "session", id: session.id },
								slotId: "core:slot/weather@1",
								value: "storm"
							}
						],
						scope: $.input.sessionScope,
						params: slot.params()
					})
				)
				.outlet("save", () =>
					C.createMessage.v1({
						text: "A storm rolls in.",
						characterId: tom
					})
				)
				.build()
		)
		await saveDocument(testDb as any, doc, { publish: true })
		// The session's own binding for the primary turn, as a row: the
		// bucket `resolveSubjectVerdict` checks it against is the inlet lock
		// plus a message write, which this spec has.
		const [specRow] = await testDb
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, specId))
		await testDb.insert(schema.pipelineBindings).values({
			scopeKind: "session",
			scopeId: session.id,
			genreId: CHAT,
			subject: "core:event/message-respond@1",
			specId: specRow!.id,
			updatedBy: owner.id
		})

		const { io, emitted } = recordingIo([owner.id, guest.id], session.id)
		const ownEmit = (event: string, payload: any) =>
			emitted.push({ room: "caller", event, payload })
		const res = await triggerGenerateMessageHandler.handler(
			fakeSocket(owner.id, io),
			{ sessionId: session.id, characterId: tom, once: true } as any,
			ownEmit
		)
		expect((res as any)?.error).toBeUndefined()
		expect(
			(await runsOf(session.id)).map((r) => `${r.specSlug}:${r.outcome}`)
		).toEqual([`${specId}:ok`])

		// The state moved and was announced — after the run left the
		// registry and the list went out, never before.
		const changed = emitted.findIndex((e) => e.event === "state:changed")
		expect(changed).toBeGreaterThanOrEqual(0)
		const terminal = emitted.findIndex(
			(e) => e.event === "pipelines:progress" && e.payload?.done
		)
		expect(terminal).toBeGreaterThanOrEqual(0)
		expect(terminal).toBeLessThan(changed)
		for (const room of [`socket-${owner.id}`, `socket-${guest.id}`]) {
			const mine = emitted
				.map((e, i) => ({ ...e, i }))
				.filter(
					(e) => e.event === "sessions:actions" && e.room === room
				)
			expect(mine, room).toHaveLength(2)
			expect(mine[1]!.i).toBeLessThan(changed)
			expect(retryOf(mine[1]!)).toMatchObject({ enabled: true })
		}
		// …and the proposal is there for the player.
		const proposals = await testDb
			.select({ id: schema.stateProposals.id })
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, session.id))
		expect(proposals.length).toBeGreaterThan(0)
	})
})

describe("pass 3 · the trigger road announces state whatever the outcome", () => {
	test("a run whose set-state landed and then halted still emits state:changed, after the list", async () => {
		const schema = await import("$lib/server/db/schema")
		const { spec, compile, sessionEvents, slot } = await import(
			"@serene-pub/sdk"
		)
		const C = await import("@serene-pub/contracts")
		const { chatGenre } = await import("@serene-pub/core-catalog")
		const { saveDocument } = await import(
			"$lib/server/pipelines/boot/store"
		)
		const { sessionsTriggerFunctionHandler } = await import("./sessions")
		const { owner, guest, session } = await sessionWithTom("state-halt")

		// Moves the weather, writes a line, then reads a form's answer a
		// composer press never carries — the run halts at its last node
		// with the proposal already made. (A halt BEFORE any outlet ran is
		// compacted by the executor, nodes and all — `set-state` is a task
		// and declares no `effects` — and the host cannot see it moved
		// state; reported with the unit, not this test's to fix.)
		const specId = "core:spec/test-state-halt"
		const fn = "state-halt"
		const doc: SpecDocument = compile(
			spec(specId, {
				version: "1.0.0",
				taxonomy: { role: "action", genre: CHAT },
				contributes: {
					actions: [
						{
							key: fn,
							genre: CHAT,
							venue: { kind: "composer" },
							label: { en: "Halt" }
						}
					]
				}
			})
				.inlet("input", C.userMessage.v1(), {
					genre: chatGenre,
					event: sessionEvents.sessionAction
				})
				.task("state", ($) =>
					C.setState.v1({
						changes: [
							{
								owner: { kind: "session", id: session.id },
								slotId: "core:slot/weather@1",
								value: "fog"
							}
						],
						scope: $.input.sessionScope,
						params: slot.params()
					})
				)
				// The line lands (an outlet — effectful, so the halt below is
				// not compacted away), then a form's answer with no form to
				// read: the task halts, with the proposal already made.
				.outlet("save", () =>
					C.createMessage.v1({
						narration: true,
						text: "Fog rolls in."
					})
				)
				.task("answer", ($) =>
					C.readAnswer.v1({
						payload: $.input.payload,
						form: $.input.form
					})
				)
				.build()
		)
		await saveDocument(testDb as any, doc, { publish: true })

		const { io, emitted } = recordingIo([owner.id, guest.id], session.id)
		const ownEmit = (event: string, payload: any) =>
			emitted.push({ room: "caller", event, payload })
		const res = await sessionsTriggerFunctionHandler.handler(
			fakeSocket(owner.id, io),
			{ sessionId: session.id, action: `${specId}#${fn}` },
			ownEmit
		)
		expect(res.error).toMatch(/nothing to answer/)
		expect((await runsOf(session.id)).map((r) => r.outcome)).toEqual([
			"halt"
		])

		// The write was real: the proposal is there…
		const proposals = await testDb
			.select({ id: schema.stateProposals.id })
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, session.id))
		expect(proposals.length).toBeGreaterThan(0)
		// …and announced, after the terminal frame and the end push.
		const changed = emitted.findIndex((e) => e.event === "state:changed")
		expect(changed).toBeGreaterThanOrEqual(0)
		const terminal = emitted.findIndex(
			(e) => e.event === "pipelines:progress" && e.payload?.done
		)
		expect(terminal).toBeLessThan(changed)
		const lastPush = emitted.reduce(
			(at, e, i) => (e.event === "sessions:actions" ? i : at),
			-1
		)
		expect(lastPush).toBeGreaterThan(terminal)
		expect(lastPush).toBeLessThan(changed)
	})
})
