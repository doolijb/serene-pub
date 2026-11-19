/**
 * A person's edit to their own earlier line is what a re-run of the reply
 * after it reads: a swipe's new alternative and a regenerate both build their
 * prompt from the line as it is stored now, never from the words it held when
 * the reply being replaced was written.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "edited-line-rerun-test-secret" }
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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** Every prompt handed to the model, in order. */
const compiled: any[] = []
/** What the model answers — the reply quotes the person's line as first sent. */
let answer = `"The password is apple," Wren repeats.`
/** What the Story sweep answers, when it runs. */
let sweepAnswer = "{}"
/** While set, the sweep's model call waits on it — a sweep still running. */
let sweepGate: Promise<void> | null = null
let sweepEntered = false
class FakeAdapter {
	injected: any
	abort() {}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		compiled.push(p)
		return this
	}
	async generateText() {
		const asked = JSON.stringify(this.injected ?? {})
		const text = asked.includes("You keep the record of a story")
			? JSON.stringify({ deltas: [], clock: [], place: [] })
			: asked.includes("You keep the books of a story")
				? sweepAnswer
				: answer
		const held = asked.includes("You keep the books of a story") ? sweepGate : null
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (held) {
					sweepEntered = true
					await held
				}
				onContent(text)
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let ownerId: number
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: quietIo() }) as any
const emit = () => {}
function quietIo() {
	return {
		sockets: { adapter: { rooms: { get: () => undefined } }, sockets: { get: () => undefined, values: () => [].values() } },
		to: () => ({ emit: () => {} })
	}
}
async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-edited-line-rerun-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "edited-line-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "reply-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Edited line test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function presetId(seedKey: string) {
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
	expect(p, `preset ${seedKey} is seeded`).toBeTruthy()
	return p!.id
}

async function createOn(name: string, seedKey: string) {
	const [c] = await db
		.insert(schema.characters)
		.values({ userId: ownerId, name: "Wren", description: "A quiet companion.", isPersona: false })
		.returning()
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: await presetId(seedKey) }, characterIds: [c!.id], personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	return res.session.id as number
}

/** Send a line, let the reply land; the person's row and the reply's. */
async function sendAndReply(sessionId: number, content: string) {
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content, channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const rows = await db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(schema.sessionMessages.id)
	const mine = rows.find((r) => r.role === "user" && r.content === content)
	expect(mine, "the person's line is stored").toBeTruthy()
	const reply = rows.find((r) => r.role === "assistant" && r.id > mine!.id && r.content.includes("apple"))
	expect(reply, `a reply quoting the line landed: ${JSON.stringify(rows.map((r) => [r.role, r.content]))}`).toBeTruthy()
	return { mine: mine!, reply: reply! }
}

async function editLine(id: number, content: string) {
	const { sessionMessagesUpdateHandler } = await import("./sessions")
	const res: any = await sessionMessagesUpdateHandler.handler(fakeSocket(ownerId), { id, content } as any, emit)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const [row] = await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.id, id))
	expect(row!.content).toBe(content)
}

/** The prompts a re-run of `replyId` handed the model, as text. */
async function rerunPrompts(verb: "swipe" | "regenerate", replyId: number): Promise<string[]> {
	const before = compiled.length
	answer = `"The password is banana," Wren repeats.`
	const handlers = await import("./sessions")
	const res: any =
		verb === "swipe"
			? await handlers.sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id: replyId } as any, emit)
			: await handlers.sessionMessagesRegenerateHandler.handler(fakeSocket(ownerId), { id: replyId } as any, emit)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const run = compiled.slice(before)
	expect(run.length, "the re-run asked the model").toBeGreaterThan(0)
	return run.map((p) => JSON.stringify(p))
}

describe("an edited line is what a re-run of the reply after it reads", () => {
	for (const seedKey of ["core-story-minimal", "core-story-living"]) {
		for (const verb of ["swipe", "regenerate"] as const) {
			it(`${seedKey} · ${verb}: the prompt carries the edited line and never the words it replaced`, async () => {
				answer = `"The password is apple," Wren repeats.`
				const sessionId = await createOn(`edited-${seedKey}-${verb}`, seedKey)
				const { mine, reply } = await sendAndReply(sessionId, "The password is apple.")
				await editLine(mine.id, "The password is banana.")
				const prompts = await rerunPrompts(verb, reply.id)
				for (const [i, text] of prompts.entries()) {
					expect(text, `prompt ${i + 1} of ${prompts.length} holds the pre-edit words`).not.toContain("apple")
				}
				expect(prompts.some((t) => t.includes("The password is banana.")), "the edited line reached the re-run").toBe(true)
				const [after] = await db
					.select()
					.from(schema.sessionMessages)
					.where(and(eq(schema.sessionMessages.id, reply.id), eq(schema.sessionMessages.sessionId, sessionId)))
				expect(after!.content).toContain("banana")
			}, 240_000)
		}
	}
})

/**
 * The same rule with the Story sweep running after every reply: what the
 * sweep filed from the reply being replaced is taken with it, so the re-run
 * reads none of it.
 */
describe("an edited line, with the sweep filing after each reply", () => {
	beforeAll(async () => {
		;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(true)
	})
	afterAll(async () => {
		;(await import("$lib/server/pipelines/routines/runs")).setRoutinesEnabled(false)
	})

	/** The sweep's answer: every duty quotes the person's line as first sent. */
	const quotingSweep = () =>
		JSON.stringify({
			lore: [{ name: "The password", content: "The password is apple." }],
			cast: [],
			worldState: [],
			relationships: [],
			scenes: [{ name: "The Gate", content: "Where the password apple was spoken." }],
			goals: "- [ ] Remember the password is apple",
			summary: { name: "The password", content: "They agreed the password is apple." }
		})

	async function sweptEveryTurn(sessionId: number) {
		const { applyLegacyTasks, setRoutineCadenceOptions } = await import("$lib/server/utils/testDb")
		const duties = { lore: "full", cast: "full", summary: "full", scenes: "full", goals: "full", "world-state": "full", relationships: "off" }
		await applyLegacyTasks(db, sessionId, { v: 1, tasks: Object.fromEntries(Object.entries(duties).map(([k, mode]) => [k, { mode }])) })
		const { STORY_SWEEP_SPEC_ID } = await import("@serene-pub/core-catalog")
		const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
		const sweep = (await effectiveRegistrations(db as never, sessionId))!.effective.find((r) => r.pipeline === STORY_SWEEP_SPEC_ID)!
		await setRoutineCadenceOptions(db, sessionId, sweep.key, { n: 1 })
	}

	/** What the session keeps that still holds the pre-edit words: its goals and any entry. */
	async function keptWords(sessionId: number) {
		const [s] = await db.select({ annex: schema.sessions.annex }).from(schema.sessions).where(eq(schema.sessions.id, sessionId))
		const entries = await db
			.select({ title: schema.lorebookEntries.title, content: schema.lorebookEntries.content })
			.from(schema.lorebookEntries)
		const goals = String((s!.annex as any)?.core?.["story-goals"] ?? "")
		return {
			goals: goals.includes("apple") ? goals : "",
			entries: entries.filter((e) => `${e.title} ${e.content}`.includes("apple")).map((e) => e.title)
		}
	}

	const isRoutinePrompt = (t: string) => t.includes("You keep the books of a story") || t.includes("You keep the record of a story")

	for (const verb of ["swipe", "regenerate"] as const) {
		it(`core-story-living · ${verb}: what the sweep filed from the replaced reply is taken with it`, async () => {
			answer = `"The password is apple," Wren repeats.`
			sweepAnswer = quotingSweep()
			const sessionId = await createOn(`swept-${verb}`, "core-story-living")
			await sweptEveryTurn(sessionId)
			const { mine, reply } = await sendAndReply(sessionId, "The password is apple.")
			const filed = await keptWords(sessionId)
			expect(filed.goals, "the sweep filed the goals").toContain("apple")
			expect(filed.entries, "the sweep filed the entries").toEqual(expect.arrayContaining(["The password"]))
			sweepAnswer = "{}"
			await editLine(mine.id, "The password is banana.")
			const prompts = (await rerunPrompts(verb, reply.id)).filter((t) => !isRoutinePrompt(t))
			expect(prompts.length, "the re-run's reply asked the model").toBeGreaterThan(0)
			expect(await keptWords(sessionId)).toEqual({ goals: "", entries: [] })
			for (const [i, text] of prompts.entries()) {
				const at = text.indexOf("apple")
				expect(at, `reply prompt ${i + 1}: …${text.slice(Math.max(0, at - 300), at + 100)}…`).toBe(-1)
			}
		}, 300_000)
	}

	/**
	 * A sweep still running when the reply it read is swiped: the swipe waits
	 * (owner 2026-11-16: "have the user manually stop what ever is running
	 * first"), so nothing the sweep files can land after a swipe's retraction.
	 * Edit is not held. Both cases end with the replaced words gone and the
	 * next reply reading none of them.
	 */
	async function withHeldSweep(tag: string) {
		answer = `"The password is apple," Wren repeats.`
		sweepAnswer = quotingSweep()
		let release!: () => void
		sweepGate = new Promise<void>((r) => (release = r))
		sweepEntered = false
		const sessionId = await createOn(tag, "core-story-living")
		await sweptEveryTurn(sessionId)
		const handlers = await import("./sessions")
		// A safety net only: the case releases the sweep itself.
		const timer = setTimeout(() => release(), 60_000)
		const sent: any = await handlers.sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(ownerId),
			{ sessionId, personaId: null, content: "The password is apple.", channel: "main" } as any,
			emit
		)
		expect(sent?.error, sent?.error).toBeUndefined()
		for (let i = 0; i < 100 && !sweepEntered; i++) await new Promise((r) => setTimeout(r, 100))
		expect(sweepEntered, "the sweep is running").toBe(true)
		const rows = await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
			.orderBy(schema.sessionMessages.id)
		const mine = rows.find((r) => r.role === "user")!
		const reply = rows.find((r) => r.role === "assistant" && r.id > mine.id && r.content.includes("apple"))!
		expect(reply, "the reply landed").toBeTruthy()
		// Edit is never held by a run.
		const edited: any = await handlers.sessionMessagesUpdateHandler.handler(
			fakeSocket(ownerId),
			{ id: mine.id, content: "The password is banana." } as any,
			emit
		)
		expect(edited?.error, edited?.error).toBeUndefined()
		const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
		const sweep = runRegistry.active().find((h) => h.kind === "routine" && h.sessionId === sessionId)
		expect(sweep, "the sweep is a registered routine run").toBeTruthy()
		const swipe = () => handlers.sessionMessagesSwipeRightHandler.handler(fakeSocket(ownerId), { id: reply.id } as any, emit) as Promise<any>
		const finish = () => {
			clearTimeout(timer)
			release()
			sweepGate = null
			sweepAnswer = "{}"
		}
		/** Let the held sweep go; sweeps after it (the swipe's own turn) answer nothing. */
		const letGo = () => {
			sweepAnswer = "{}"
			release()
		}
		return { sessionId, handlers, reply, sweep: sweep!, swipe, release: letGo, finish }
	}

	/** The swipe, now allowed: its own prompt and the next reply's read none of the replaced words, and nothing the sweep filed outlives it. */
	async function swipeLeavesNothing(ctx: Awaited<ReturnType<typeof withHeldSweep>>) {
		answer = `"The password is banana," Wren repeats.`
		const swipeFrom = compiled.length
		const swiped = await ctx.swipe()
		expect(swiped?.error, swiped?.error).toBeUndefined()
		const swipePrompts = compiled.slice(swipeFrom).map((p) => JSON.stringify(p)).filter((t) => !isRoutinePrompt(t))
		expect(swipePrompts.some((t) => t.includes("apple")), "the swipe's own prompt").toBe(false)
		await settle()
		expect(await keptWords(ctx.sessionId), "nothing filed from the replaced reply outlives the swipe").toEqual({ goals: "", entries: [] })
		const before = compiled.length
		answer = `"Banana it is," Wren says.`
		const next: any = await ctx.handlers.sessionMessagesSendPersonaMessageHandler.handler(
			fakeSocket(ownerId),
			{ sessionId: ctx.sessionId, personaId: null, content: "Say it once more.", channel: "main" } as any,
			emit
		)
		expect(next?.error, next?.error).toBeUndefined()
		await settle()
		const nextPrompts = compiled.slice(before).map((p) => JSON.stringify(p)).filter((t) => !isRoutinePrompt(t))
		expect(nextPrompts.some((t) => t.includes("apple")), "the next reply's prompt").toBe(false)
	}

	it("core-story-living · swipe while the replaced reply's sweep is running is refused; once it has finished the swipe goes through and nothing it filed outlives it", async () => {
		const ctx = await withHeldSweep("swept-race")
		try {
			const { waitForRunSentence } = await import("$lib/shared/sessions/runsInProgress")
			const refused = await ctx.swipe()
			expect(refused?.error).toBe(waitForRunSentence(ctx.sweep.name!))
			ctx.release()
			await settle()
			await swipeLeavesNothing(ctx)
		} finally {
			ctx.finish()
		}
	}, 300_000)

	it("core-story-living · swipe after the owner stops the running sweep: it goes through and nothing the sweep filed outlives it", async () => {
		const ctx = await withHeldSweep("swept-stopped")
		try {
			const { pipelinesCancelRun } = await import("./pipelines")
			const stopped = await pipelinesCancelRun.handler(fakeSocket(ownerId), { runId: ctx.sweep.runId }, emit)
			expect(stopped).toEqual({ ok: true, found: true })
			ctx.release()
			await settle()
			await swipeLeavesNothing(ctx)
		} finally {
			ctx.finish()
		}
	}, 300_000)
})
