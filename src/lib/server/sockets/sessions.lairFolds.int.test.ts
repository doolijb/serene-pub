/**
 * What the Lair's rows fold — over the REAL reply road (lair pass B5, owner
 * D5, 2026-09-27; R8, owner F4 2026-09-28).
 *
 * R8 retired the B5 **Plan** fold: the beats go to the Sanctum, as the BODY
 * of the Castellan's beats row (a markdown list), and no row carries a Plan
 * section any more. The lead delver's row carries its own line and the
 * reasoning of ITS call (the turn's first prose call — nothing is written in
 * prose before it); the knock carries its question and no fold at all.
 *
 * The faked model answers a JSON request with the planner's (and keeper's)
 * document, and every prose request with prose plus a reasoning trace on the
 * adapter's thinking channel, numbered by call.
 */

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, ne } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lair-folds-test-secret" }
})

const PLAN = {
	beats: ["The torch gutters.", "Something scrapes behind the door."],
	speakers: [{ name: "Brannoc", intent: "check the door" }],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "The Old Well" },
	values: [],
	inventory: []
}
const KNOCK = {
	...PLAN,
	speakers: [],
	unknownExit: "The Drowned Hall",
	knockQuestion: "The stair goes down to the Drowned Hall. Is there one?"
}
/** What the planner answers this test with. */
let document: Record<string, unknown> = PLAN
/** Every prose call, in order — the narrator's is the first of a turn. */
let proseCalls = 0
/** Every prompt a JSON step (the planner, the keeper) was sent. */
const jsonPrompts: string[] = []
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
		const json =
			this.responseFormat === "json" ||
			JSON.stringify(this.injected ?? "").includes(
				JSON.stringify(JSON_INSTRUCTION).slice(1, 40)
			)
		const call = json ? 0 : ++proseCalls
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (
				onContent: (c: string) => void,
				onThinking?: (c: string) => void
			) => {
				if (json) {
					jsonPrompts.push(JSON.stringify(this.injected ?? ""))
					// The planner reasons too — and that must NOT reach the row.
					onThinking?.("The planner weighs the beats.")
					onContent(JSON.stringify(document))
					return
				}
				onThinking?.(`Reasoning of prose call ${call}.`)
				for (const chunk of PROSE) onContent(chunk)
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
		path.join(os.tmpdir(), "serene-pub-vitest-lair-folds-")
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


/** A row's shown revision's parts, in order. */
async function partsOf(messageId: number) {
	const { getMessage } = await import("$lib/server/messages/store")
	const msg = (await getMessage(testDb as unknown as Db, messageId))!
	const active = msg.activeRevisions["0"] ?? 0
	return msg.parts
		.filter((p) => p.step === 0 && p.revision === active)
		.sort((a, b) => a.ordinal - b.ordinal)
}

/** Every row the run wrote, oldest first — the master's own line left out. */
async function turnRows(sessionId: number) {
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select()
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				ne(schema.sessionMessages.role, "user")
			)
		)
		.orderBy(schema.sessionMessages.id)
}

describe("R8 · what the Lair's rows fold", () => {
	test("the beats are the Sanctum row's body; the lead's row folds its own Thinking; no Plan anywhere", async () => {
		document = PLAN
		proseCalls = 0
		jsonPrompts.length = 0
		const w = await session("core:genre/lair", {})
		const { res } = await reply(w, "the fold road")
		expect((res as any)?.error).toBeUndefined()
		expect(
			(await runsOf(w.session.id)).map((r) => `${r.specSlug}:${r.outcome}`)
		).toContain("core:spec/lair-respond:ok")

		const rows = (await turnRows(w.session.id)).filter(
			(r) => (r.metadata as any)?.greeting !== true
		)
		const beats = rows.find((r) => r.channel === "sanctum" && r.content?.startsWith("- "))!
		expect(beats.content).toBe(
			"- The torch gutters.\n- Something scrapes behind the door."
		)
		const beatsParts = await partsOf(beats.id)
		expect(beatsParts.map((p) => p.type)).toEqual(["core:markdown"])

		const lead = rows.find((r) => r.characterId === w.brannoc)!
		const leadParts = await partsOf(lead.id)
		expect(leadParts.map((p) => p.type)).toEqual(["core:thinking", "core:markdown"])
		// The lead's reasoning — the turn's first prose call — never the
		// planner's.
		expect(leadParts[0]!.content).toBe("Reasoning of prose call 1.")
		const body = String(lead.content)
		expect(body).not.toContain("{")
		expect(body).not.toContain("planner")
		expect(body).not.toContain("Reasoning")
		// No row folds a Plan any more (the B5 fold is retired).
		for (const r of rows)
			expect((await partsOf(r.id)).map((p) => p.type)).not.toContain("core:section")
		// B11: the master's line reached the planner as DIRECTION.
		expect(
			jsonPrompts.some((p) => p.includes("Direction this turn: I open the door."))
		).toBe(true)
	})

	test("the knock is the question alone: no fold, no Thinking, no beats — nothing was played", async () => {
		document = KNOCK
		proseCalls = 0
		const w = await session("core:genre/lair", {})
		const { res } = await reply(w, "the knock fold road")
		expect((res as any)?.error).toBeUndefined()
		const rows = (await turnRows(w.session.id)).filter(
			(r) => (r.metadata as any)?.greeting !== true
		)
		expect(proseCalls).toBe(0)
		expect(rows).toHaveLength(1)
		expect(rows[0]!.channel).toBe("main")
		expect(String(rows[0]!.content)).toBe(KNOCK.knockQuestion)
		const types = (await partsOf(rows[0]!.id)).map((p) => p.type)
		expect(types).not.toContain("core:section")
		expect(types).not.toContain("core:thinking")
	})
})
