/**
 * Which step streams into the reply, and what the progress card says while
 * the others run — over the REAL reply road (lair pass B3/B18, owner D6/D5,
 * 2026-09-27).
 *
 * F3: the rule that picked the streaming step walked back from the write to
 * the nearest SPINE oracle, and skipped anything inside a clause. The Lair's
 * narrator sits inside the `turn` junction, so the Lair streamed its
 * planner's JSON into the reply body, froze while the narrator wrote, then
 * jumped to prose that never streamed. The step is declared now
 * (`expose.stream`), and this walks `sessions:fireTurn` → `runReply` →
 * `runTurn` with the real host and a faked model to prove the row only ever
 * shows prose.
 *
 * The faked model answers a JSON request (`responseFormat: "json"`, or the
 * instruction door's `JSON_INSTRUCTION` — what `generate-json` asks for) with the planner's and keeper's document, and
 * every other request with two chunks of prose — so a frame carrying `{` is
 * a JSON step streaming into the row, and nothing else could put it there.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "streaming-step-test-secret" }
})

const DOCUMENT = JSON.stringify({
	beats: ["The torch gutters.", "Something scrapes behind the door."],
	speakers: [{ name: "Brannoc", intent: "check the door" }],
	worldHints: {},
	needsLookup: false,
	values: [],
	inventory: []
})
const PROSE = ["The torch gutters. ", "Something scrapes behind the door."]

class FakeAdapter implements FakeTextAdapter {
	injected: any
	promptBuilder: any = {}
	responseFormat: any
	responseSchema: any
	constructor(_p: any) {}
	stops: any
	withStops(s: any) {
		this.stops = s
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	abort() {}
	async generateText() {
		// Structured output on the wire, or — a stub connection declares no
		// capabilities — the instruction door's sentence in the prompt.
		const json =
			this.responseFormat === "json" ||
			JSON.stringify(this.injected ?? "").includes(
				JSON.stringify(JSON_INSTRUCTION).slice(1, 40)
			)
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (json) {
					// Two chunks, so a JSON step that streamed shows a frame.
					onContent(DOCUMENT.slice(0, 20))
					onContent(DOCUMENT.slice(20))
					return
				}
				for (const chunk of PROSE) {
					onContent(chunk)
					// Past the persist throttle, so each chunk is a frame.
					await new Promise((r) => setTimeout(r, 120))
				}
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
				connection: { id: 1, type: "koboldcpp", promptFormat: "vicuna" },
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

const HANG_MS = 30_000
async function within<T>(label: string, road: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const hung = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} did not finish within ${HANG_MS} ms`)),
			HANG_MS
		)
	})
	try {
		return await Promise.race([road, hung])
	} finally {
		clearTimeout(timer)
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-streaming-step-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	const dbModule = await import("$lib/server/db")
	testDb = dbModule.db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

let n = 0

/** A narrator-genre session with one cast member and the owner's line waiting. */
async function session(genreId: string, genreFields: Record<string, unknown>) {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const tag = `stream-${++n}`
	const owner = await createTestUser(testDb, `${tag}-owner`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `The lair ${tag}` })
		.returning()
	const [row] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Session ${tag}`,
			genreId,
			lorebookId: lorebook!.id,
			genreFields
		})
		.returning()
	const [brannoc] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Brannoc", description: "A delver." })
		.returning()
	await testDb.insert(schema.sessionCharacters).values({
		sessionId: row!.id,
		characterId: brannoc!.id,
		isActive: true,
		position: 0
	})
	const [rook] = await testDb
		.insert(schema.characters)
		.values({ userId: owner.id, name: "Rook", description: "Rook", isPersona: true })
		.returning()
	await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: row!.id, personaId: rook!.id })
	await insertLegacy(testDb as unknown as Db, {
		sessionId: row!.id,
		role: "user",
		content: "I open the door.",
		personaId: rook!.id,
		userId: owner.id
	})
	return { owner, session: row!, brannoc: brannoc!.id }
}

/** One socket for the owner, every emit recorded. */
function recordingIo(userId: number, sessionId: number) {
	const emitted: Array<{ room: string; event: string; payload: any }> = []
	const socketId = `socket-${userId}`
	const sockets = new Map([
		[
			socketId,
			{
				id: socketId,
				user: { id: userId, isAdmin: false },
				interest: new Set([
					`sessionMessage#${sessionId}`,
					`sessions:runStatus#${sessionId}`,
					`sessions:actions#${sessionId}`,
					`state:changed#${sessionId}`
				])
			}
		]
	])
	const io = {
		sockets: {
			adapter: {
				rooms: {
					get: (room: string) =>
						room === `user_${userId}` ? new Set([socketId]) : undefined
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

async function reply(
	w: Awaited<ReturnType<typeof session>>,
	label: string,
	// Absent: Continue — the owner's carry-on (R8: an explicit
	// `{ ref: null }` is the Narrate press); a delver's is Pick who speaks.
	entry?: Record<string, unknown>
) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const { io, emitted } = recordingIo(w.owner.id, w.session.id)
	const ownEmit = (event: string, payload: any) =>
		emitted.push({ room: "caller", event, payload })
	const res = await within(
		label,
		sessionsFireTurnHandler.handler(
			{ user: { id: w.owner.id, isAdmin: false }, io } as any,
			{ sessionId: w.session.id, ...(entry ? { entry } : {}) } as any,
			ownEmit
		)
	)
	return { res, emitted }
}

async function runsOf(sessionId: number) {
	await (
		await import("$lib/server/pipelines/runtime/sessionEvents")
	).settleSessionEvents()
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select({
			specSlug: schema.pipelineRuns.specSlug,
			outcome: schema.pipelineRuns.outcome,
			haltReason: schema.pipelineRuns.haltReason
		})
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
}

/** Every text the reply row showed while it was still generating. */
const streamedFrames = (emitted: Array<{ event: string; payload: any }>) =>
	emitted
		.filter(
			(e) =>
				e.event === "sessionMessage" &&
				e.payload?.sessionMessage?.isGenerating === true &&
				e.payload?.sessionMessage?.role !== "user"
		)
		.map((e) => String(e.payload.sessionMessage.content ?? ""))
		.filter((c) => c.length > 0)

const progressFrames = (emitted: Array<{ event: string; payload: any }>) =>
	emitted.filter((e) => e.event === "pipelines:progress").map((e) => e.payload)

/** Every piece of text a person could read off a progress frame. */
const shownText = (frame: any): string[] =>
	[
		frame.label,
		frame.stage,
		frame.message,
		...(frame.status?.i18n
			? typeof frame.status.i18n === "string"
				? [frame.status.i18n]
				: Object.values(frame.status.i18n)
			: [])
	].filter((t): t is string => typeof t === "string")

/** A node key as the retired `stageOf` spelled it — `planWrite` → "plan write". */
const humanized = (key: string) =>
	key
		.split(".")
		.filter((part) => part !== "item")
		.join(" ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()

describe("the streaming step over sessions:fireTurn", () => {
	test("the Lair streams only its lead delver's line — never the planner's JSON (R8)", async () => {
		const w = await session("core:genre/lair", {})
		const { res, emitted } = await reply(w, "the lair road")
		expect((res as any)?.error).toBeUndefined()
		expect((await runsOf(w.session.id)).map((r) => `${r.specSlug}:${r.outcome}`)).toContain(
			"core:spec/lair-respond:ok"
		)

		const frames = streamedFrames(emitted)
		// No frame of the reply ever carried the planner's document…
		for (const text of frames) {
			expect(text).not.toContain("{")
			expect(text).not.toContain("beats")
		}
		// …and the lead delver's line arrived while the row was still open.
		expect(frames.some((t) => t.startsWith("The torch gutters."))).toBe(true)
	})

	test("Adventure still streams its scene, and nothing else", async () => {
		const w = await session("core:genre/adventure", {
			tone: "grounded",
			difficulty: "normal"
		})
		const { res, emitted } = await reply(w, "the adventure road")
		expect((res as any)?.error).toBeUndefined()
		const frames = streamedFrames(emitted)
		for (const text of frames) expect(text).not.toContain("{")
		expect(frames.some((t) => t.startsWith("The torch gutters."))).toBe(true)
	})

	/**
	 * W2: the Writing Room's prose is written by one of two oracles in the
	 * mutually exclusive branches of its `turn` junction. Under "one per spec"
	 * it streamed nothing; now each branch's step is declared and the one
	 * that runs streams.
	 */
	test("the Writing Room streams its manuscript chunk — the manuscript branch", async () => {
		const w = await session("core:genre/writing-room", {})
		const { res, emitted } = await reply(w, "the manuscript road", {
			ref: null,
			via: "pick",
			channel: "manuscript"
		})
		expect((res as any)?.error).toBeUndefined()
		expect((await runsOf(w.session.id)).map((r) => `${r.specSlug}:${r.outcome}`)).toContain(
			"core:spec/writing-room-respond:ok"
		)
		const frames = streamedFrames(emitted)
		expect(frames.some((t) => t.startsWith("The torch gutters."))).toBe(true)
	})

	test("the Writing Room streams its companion's reply — the talk branch", async () => {
		const w = await session("core:genre/writing-room", {})
		const { res, emitted } = await reply(w, "the talk road", { ref: null, via: "pick" })
		expect((res as any)?.error).toBeUndefined()
		expect((await runsOf(w.session.id)).map((r) => `${r.specSlug}:${r.outcome}`)).toContain(
			"core:spec/writing-room-respond:ok"
		)
		const frames = streamedFrames(emitted)
		expect(frames.some((t) => t.startsWith("The torch gutters."))).toBe(true)
	})

	test("the progress card reads the declared step status, never a node key", async () => {
		const w = await session("core:genre/lair", {})
		const { emitted } = await reply(w, "the lair progress road")
		const frames = progressFrames(emitted).filter(
			(f) => f.specId === "core:spec/lair-respond"
		)
		// The planner's declared status reached the card, keyed to the planner.
		expect(
			frames.some(
				(f) =>
					f.nodeKey === "via.turn.channel.story.pick.planned.planWrite" &&
					f.status?.i18n?.en === "The Castellan is planning the turn"
			)
		).toBe(true)
		// No text a person reads is a node key, raw or humanized.
		const { CORE_SPECS } = await import("@serene-pub/core-catalog")
		const doc = CORE_SPECS.find((s) => s.slug === "core:spec/lair-respond")!.build()
		const keys = new Set(
			doc.nodes.flatMap((node: { key: string }) => [
				node.key,
				humanized(node.key)
			])
		)
		for (const f of frames)
			for (const text of shownText(f))
				expect(keys.has(text.trim()), `"${text}" on a progress frame`).toBe(false)
	})
})
