/**
 * Automatic read aloud (speech follow-ups A1 + A2): `message-settled` is emitted
 * once per line after the run's receipt, and the listener starts the speak run
 * as its OWN run, outside the reply's queue and the session's busy state.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const replyText = 'He nodded. "Hello there," she said.'

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
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(replyText)
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
	const real = await importOriginal<typeof import("$lib/server/connections/capabilityTarget")>()
	return {
		...real,
		resolveCapabilityTarget: async (db: Db, req: Parameters<typeof real.resolveCapabilityTarget>[1]) => {
			const target = await real.resolveCapabilityTarget(db, req)
			if (target.ok) return target
			return {
				ok: true,
				capability: req.capability,
				connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
				sampling: { id: 1 },
				connectionVia: "pipelineConfig",
				samplingVia: "pipelineConfig"
			}
		}
	}
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

const h = vi.hoisted(() => ({
	/** Replaces `fireAction` for a test; null runs the real one. */
	fire: null as null | ((db: any, req: any) => Promise<any>),
	/** Holds `dispatchSpeech` until released; null does not hold. */
	gate: null as null | Promise<void>,
	speakCalls: 0,
	/** Every `onMessageSettled` call: the payload and whether the run's receipt was saved by then. */
	settled: [] as Array<{ payload: any; receiptSaved: boolean }>
}))

vi.mock("$lib/server/pipelines/runtime/fireAction", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/pipelines/runtime/fireAction")>()
	return { ...real, fireAction: (db: any, req: any) => (h.fire ? h.fire(db, req) : real.fireAction(db, req)) }
})

vi.mock("$lib/server/speech/onMessageSettled", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/speech/onMessageSettled")>()
	return {
		...real,
		onMessageSettled: async (db: any, opts: any) => {
			const { pipelineRuns } = await import("$lib/server/db/schema")
			const runId = opts.payload?.cause?.runId
			const rows = runId
				? await db.select().from(pipelineRuns).where(eq(pipelineRuns.runId, runId)).limit(1)
				: []
			h.settled.push({ payload: opts.payload, receiptSaved: rows.length > 0 })
			return real.onMessageSettled(db, opts)
		}
	}
})

vi.mock("$lib/server/pipelines/runtime/dispatchSpeech", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/pipelines/runtime/dispatchSpeech")>()
	return {
		...real,
		dispatchSpeech: async (db: Db, call: any) => {
			h.speakCalls++
			if (h.gate) await h.gate
			const { storeGeneratedMedia } = await import("$lib/server/media/generatedMedia")
			const data = Buffer.alloc(80)
			const hd = Buffer.alloc(44)
			hd.write("RIFF", 0)
			hd.writeUInt32LE(36 + data.length, 4)
			hd.write("WAVEfmt ", 8)
			hd.writeUInt32LE(16, 16)
			hd.writeUInt16LE(1, 20)
			hd.writeUInt16LE(1, 22)
			hd.writeUInt32LE(8000, 24)
			hd.writeUInt32LE(16000, 28)
			hd.writeUInt16LE(2, 32)
			hd.writeUInt16LE(16, 34)
			hd.write("data", 36)
			hd.writeUInt32LE(data.length, 40)
			const [ref] = await storeGeneratedMedia(
				db,
				[{ kind: "audio", mime: "audio/wav", base64: Buffer.concat([hd, data]).toString("base64"), meta: { spoken: true } } as any],
				{ userId: call.userId ?? 0, sessionId: call.sessionId ?? null }
			)
			const cueMap = { source: "concatenated", spans: [{ startMs: 0, endMs: 10 }] }
			const spokenAs = { voice: "v", model: "m", applied: [], ignored: [] }
			return {
				audio: ref,
				cueMap,
				spokenAs,
				meta: { spokenAs, cueMap, inflection: null, template: null, at: "2026-10-29T00:00:00.000Z" },
				applied: [],
				ignored: [],
				notes: [],
				plan: null,
				isAborted: false
			}
		}
	}
})

let db: TestDb
let dataDir: string
let userId: number
let characterId: number

// The app's own handle IS the test database: `fireAction`'s access check reads the default `db`.
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

async function makeSession(genreFields: Record<string, unknown> | null) {
	const [s] = await db
		.insert(schema.sessions)
		.values({ userId, isGroup: false, ...(genreFields ? { genreFields } : {}) } as any)
		.returning()
	await db.insert(schema.sessionCharacters).values({ sessionId: s!.id, characterId, isActive: true })
	const [persona] = await db
		.insert(schema.characters)
		.values({ userId, isPersona: true, name: `Bob${s!.id}`, description: "A traveller." })
		.returning()
	await db.insert(schema.sessionPersonas).values({ sessionId: s!.id, personaId: persona!.id })
	await db.insert(schema.sessionMessages).values({
		sessionId: s!.id,
		role: "user",
		content: "Greet me.",
		personaId: persona!.id
	})
	return s!.id
}

async function addLine(
	sessionId: number,
	over: Partial<typeof schema.sessionMessages.$inferInsert> = {}
): Promise<number> {
	const [m] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, role: "assistant", content: "A line to say.", characterId, ...over } as any)
		.returning()
	return m!.id
}

const payloadOf = (
	sessionId: number,
	messageId: number,
	kind: "reply" | "narration" | "user"
) => ({
	event: "core:event/message-settled@1",
	sessionId,
	at: Date.now(),
	messageId,
	channel: "main",
	step: "write",
	revision: 0,
	speakerRef: kind === "narration" ? null : `character:${characterId}`,
	kind
})

const metaOf = async (id: number) =>
	((await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.id, id)))[0]!
		.metadata ?? {}) as any

const turn = async (sessionId: number) => {
	const { runTurn } = await import("$lib/server/pipelines/runtime/runTurn")
	return await runTurn({
		db,
		sessionId,
		userId,
		currentCharacterId: characterId,
		text: "Greet me.",
		seed: `settled:${sessionId}:${Math.random()}`
	})
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-settled-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const [user] = await db.insert(schema.users).values({ username: "settled-test", isAdmin: false }).returning()
	userId = user!.id
	const [c] = await db.insert(schema.characters).values({ userId, name: "Alice", description: "A knight." }).returning()
	characterId = c!.id
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
	h.fire = null
	h.gate = null
	h.speakCalls = 0
	h.settled.length = 0
})

describe("message-settled: the emit", () => {
	it("one per reply line, after the run's receipt is saved, with the line's facts", async () => {
		const sid = await makeSession({ speechReadAloud: "off" })
		const receipt: any = await turn(sid)
		expect(receipt.outcome, receipt.haltReason).toBe("ok")
		const { settleSessionEvents } = await import("$lib/server/pipelines/runtime/sessionEvents")
		await settleSessionEvents(sid)
		const reply = (await db.select().from(schema.sessionMessages).where(eq(schema.sessionMessages.sessionId, sid))).find(
			(r) => r.role !== "user"
		)!
		const mine = h.settled.filter((s) => s.payload.messageId === reply.id)
		expect(mine).toHaveLength(1)
		const { payload, receiptSaved } = mine[0]!
		expect(receiptSaved).toBe(true)
		expect(payload).toMatchObject({
			event: "core:event/message-settled@1",
			sessionId: sid,
			messageId: reply.id,
			channel: "main",
			revision: 0,
			speakerRef: `character:${characterId}`,
			kind: "reply",
			cause: { kind: "run", runId: receipt.runId }
		})
		expect(typeof payload.step === "string" || payload.step === null).toBe(true)
		expect(typeof payload.at).toBe("number")
		// Off: nothing was started.
		expect(h.speakCalls).toBe(0)
	})
})

describe("message-settled: the listener", () => {
	it("Read aloud off starts nothing", async () => {
		const sid = await makeSession({ speechReadAloud: "off" })
		const id = await addLine(sid)
		const fired: any[] = []
		h.fire = async (_db, req) => (fired.push(req), { kind: "ran" })
		const { onMessageSettled, settleSpeechRuns } = await import("$lib/server/speech/onMessageSettled")
		await onMessageSettled(db, { payload: payloadOf(sid, id, "reply") as any, userId })
		await settleSpeechRuns(sid)
		expect(fired).toHaveLength(0)
		expect((await metaOf(id)).spoken).toBeUndefined()
	})

	for (const mode of ["make", "play"]) {
		it(`'${mode}': a reply starts ONE speak run for the message, off the action count, pending set while it runs and cleared after`, async () => {
			const sid = await makeSession({ speechReadAloud: mode })
			const id = await addLine(sid)
			const fired: any[] = []
			let seenPending: any
			h.fire = async (dbx, req) => {
				fired.push(req)
				seenPending = (await metaOf(id)).spoken?.pending
				return { kind: "ran", runId: req.runId }
			}
			const { onMessageSettled, settleSpeechRuns } = await import("$lib/server/speech/onMessageSettled")
			await onMessageSettled(db, { payload: payloadOf(sid, id, "reply") as any, userId })
			await settleSpeechRuns(sid)
			expect(fired).toHaveLength(1)
			expect(fired[0]).toMatchObject({
				sessionId: sid,
				action: "core:spec/speak-message#read-aloud",
				messageId: id,
				kind: "maintenance",
				automatic: true,
				actor: { userId }
			})
			expect(seenPending).toMatchObject({ runId: fired[0].runId })
			expect(typeof seenPending.at).toBe("string")
			// No audio written by the stub: the marker is gone, and no `spoken` is left behind.
			expect((await metaOf(id)).spoken).toBeUndefined()
		})
	}

	it("narration starts a run; a person's own line starts none", async () => {
		const sid = await makeSession({ speechReadAloud: "make" })
		const narration = await addLine(sid, { characterId: null, isNarratorResponse: true } as any)
		const mine = await addLine(sid, { role: "user", characterId: null } as any)
		const fired: any[] = []
		h.fire = async (_db, req) => (fired.push(req), { kind: "ran" })
		const { onMessageSettled, settleSpeechRuns } = await import("$lib/server/speech/onMessageSettled")
		await onMessageSettled(db, { payload: payloadOf(sid, narration, "narration") as any, userId })
		await onMessageSettled(db, { payload: payloadOf(sid, mine, "user") as any, userId })
		await settleSpeechRuns(sid)
		expect(fired.map((r) => r.messageId)).toEqual([narration])
	})

	it("a hidden, stopped or greeting line starts none", async () => {
		const sid = await makeSession({ speechReadAloud: "make" })
		const hidden = await addLine(sid, { isHidden: true } as any)
		const stopped = await addLine(sid, { generationOutcome: "stopped" } as any)
		const greeting = await addLine(sid, { metadata: { isGreeting: true } } as any)
		const fired: any[] = []
		h.fire = async (_db, req) => (fired.push(req), { kind: "ran" })
		const { onMessageSettled, settleSpeechRuns } = await import("$lib/server/speech/onMessageSettled")
		for (const id of [hidden, stopped, greeting])
			await onMessageSettled(db, { payload: payloadOf(sid, id, "reply") as any, userId })
		await settleSpeechRuns(sid)
		expect(fired).toHaveLength(0)
	})

	it("a failed run clears the pending marker and pushes", async () => {
		const sid = await makeSession({ speechReadAloud: "make" })
		const id = await addLine(sid)
		h.fire = async () => {
			throw new Error("tts down")
		}
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const { onMessageSettled, settleSpeechRuns } = await import("$lib/server/speech/onMessageSettled")
		await onMessageSettled(db, { payload: payloadOf(sid, id, "reply") as any, userId })
		await settleSpeechRuns(sid)
		warn.mockRestore()
		expect((await metaOf(id)).spoken).toBeUndefined()
	})

	it("an earlier recording stays when a refused run clears the marker", async () => {
		const sid = await makeSession({ speechReadAloud: "make" })
		const spoken = { spokenAs: { voice: "v", model: "m" }, at: "2026-10-28T00:00:00.000Z" }
		const id = await addLine(sid, { metadata: { spoken } } as any)
		h.fire = async () => ({ kind: "refused", error: "no" })
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		const { onMessageSettled, settleSpeechRuns } = await import("$lib/server/speech/onMessageSettled")
		await onMessageSettled(db, { payload: payloadOf(sid, id, "reply") as any, userId })
		await settleSpeechRuns(sid)
		warn.mockRestore()
		expect((await metaOf(id)).spoken).toEqual(spoken)
	})

	it("a newer settle of the same message cancels the older run, then runs its own", async () => {
		const sid = await makeSession({ speechReadAloud: "make" })
		const id = await addLine(sid)
		const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
		const handles: any[] = []
		const order: string[] = []
		h.fire = async (_db, req) => {
			const handle = runRegistry.start({ runId: req.runId, userId, sessionId: sid, kind: req.kind })
			handles.push(handle)
			req.onStarted?.({ runId: req.runId, specId: "core:spec/speak-message" })
			order.push(`start:${handles.length}`)
			// The first run waits to be stopped; the second finishes at once.
			if (handles.length === 1)
				await new Promise<void>((resolve) =>
					handle.controller.signal.addEventListener("abort", () => resolve(), { once: true })
				)
			order.push(`end:${handles.length}`)
			runRegistry.finish(req.runId)
			return { kind: handle.controller.signal.aborted ? "stopped" : "ran", runId: req.runId }
		}
		const { onMessageSettled, settleSpeechRuns } = await import("$lib/server/speech/onMessageSettled")
		await onMessageSettled(db, { payload: payloadOf(sid, id, "reply") as any, userId })
		await vi.waitFor(() => expect(handles).toHaveLength(1))
		await onMessageSettled(db, { payload: payloadOf(sid, id, "reply") as any, userId })
		await settleSpeechRuns(sid)
		expect(handles).toHaveLength(2)
		expect(handles[0].controller.signal.aborted).toBe(true)
		expect(handles[0].cancelledBy).toBe("core:speech")
		expect(handles[1].controller.signal.aborted).toBe(false)
		expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"].slice(0, 4))
		expect((await metaOf(id)).spoken).toBeUndefined()
	})
})

describe("the speak run is its own run", () => {
	it("speaks the line for real, replacing the pending marker; the session is not busy and the next reply does not wait", async () => {
		const sid = await makeSession({ speechReadAloud: "make" })
		const id = await addLine(sid)
		let release!: () => void
		h.gate = new Promise<void>((r) => (release = r))
		const { onMessageSettled, settleSpeechRuns, speechRunsInFlight } = await import(
			"$lib/server/speech/onMessageSettled"
		)
		await onMessageSettled(db, { payload: payloadOf(sid, id, "reply") as any, userId })
		await vi.waitFor(() => expect(h.speakCalls).toBe(1))
		expect(speechRunsInFlight(sid)).toHaveLength(1)
		expect((await metaOf(id)).spoken?.pending?.runId).toBe(speechRunsInFlight(sid)[0])
		// 🚧 Shown on its line only (speech polish 2026-10-29): the run is line-bound.
		const { runLineBoundOf } = await import("$lib/server/pipelines/runtime/runRegistry")
		expect(runLineBoundOf(speechRunsInFlight(sid)[0]!)).toBe(true)

		// The voice is speaking, and the session is not busy for it.
		const { sessionGenerating } = await import("$lib/server/pipelines/entities/publishedValues")
		expect(await sessionGenerating(db, sid)).toBe(false)

		// The next reply (Read aloud now off, so it adds no speech of its own) completes while the voice is still speaking.
		await db.update(schema.sessions).set({ genreFields: { speechReadAloud: "off" } } as any).where(eq(schema.sessions.id, sid))
		const receipt: any = await turn(sid)
		expect(receipt.outcome, receipt.haltReason).toBe("ok")
		expect(speechRunsInFlight(sid)).toHaveLength(1)

		release()
		await settleSpeechRuns(sid)
		const meta = await metaOf(id)
		expect(meta.spoken?.pending).toBeUndefined()
		expect(meta.spoken?.spokenAs).toBeTruthy()
		const parts = await db.select().from(schema.messageParts).where(eq(schema.messageParts.messageId, id))
		expect(parts.filter((p) => p.type === "core:audio")).toHaveLength(1)
	})
})

describe("a person's press of Read aloud (speech polish 2026-10-29)", () => {
	it(
		"is line-bound too, says so to its caller, and registers as maintenance — never turn work",
		async () => {
			const sid = await makeSession({ speechReadAloud: "off" })
			const id = await addLine(sid)
			let release!: () => void
			h.gate = new Promise<void>((r) => (release = r))
			const { fireAction } = await import("$lib/server/pipelines/runtime/fireAction")
			const { READ_ALOUD_ACTION } = await import("./onMessageSettled")
			const { runKindOf, runLineBoundOf } = await import("$lib/server/pipelines/runtime/runRegistry")
			const started: any[] = []
			const runId = `press-speak-${sid}`
			const outcome = fireAction(db, {
				sessionId: sid,
				action: READ_ALOUD_ACTION,
				messageId: id,
				actor: { userId },
				runId,
				// Past this test session's Actions switch (off here); no `kind`
				// passed, as a press passes none — what is pinned is the default.
				automatic: true,
				onStarted: (run) => started.push(run)
			})
			await vi.waitFor(() => expect(h.speakCalls).toBe(1))
			expect(started[0]).toMatchObject({ runId, lineBound: true })
			expect(runKindOf(runId)).toBe("maintenance")
			expect(runLineBoundOf(runId)).toBe(true)
			const { sessionGenerating } = await import("$lib/server/pipelines/entities/publishedValues")
			expect(await sessionGenerating(db, sid)).toBe(false)
			release()
			const done: any = await outcome
			expect(done.kind, done.error).toBe("ran")
		},
		60_000
	)
})

describe("derelict Speaking… markers (boot)", () => {
	it(
		"clears a marker written before this process started, keeps an earlier recording, leaves a fresh one",
		async () => {
			const { clearDerelictSpokenPending } = await import("./onMessageSettled")
			const sessionId = await makeSession(null)
			const bootedAt = new Date("2026-10-29T12:00:00.000Z")
			const before = "2026-10-29T11:59:00.000Z"
			const after = "2026-10-29T12:01:00.000Z"
			const recording = { spokenAs: { voice: "v", model: "m", applied: [], ignored: [] }, at: before }
			const bare = await addLine(sessionId, {
				metadata: { spoken: { pending: { runId: "run-old-bare", at: before } } } as any
			})
			const kept = await addLine(sessionId, {
				metadata: { spoken: { ...recording, pending: { runId: "run-old-kept", at: before } } } as any
			})
			const fresh = await addLine(sessionId, {
				metadata: { spoken: { pending: { runId: "run-fresh", at: after } } } as any
			})
			const cleared = await clearDerelictSpokenPending(db as any, bootedAt)
			expect(cleared).toBe(2)
			expect((await metaOf(bare)).spoken).toBeUndefined()
			expect((await metaOf(kept)).spoken).toEqual(recording)
			expect((await metaOf(fresh)).spoken.pending.runId).toBe("run-fresh")
		},
		60_000
	)
})
