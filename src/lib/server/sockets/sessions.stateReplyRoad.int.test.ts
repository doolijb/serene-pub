/**
 * The keeper's changes over the REAL reply road (plans/30 U5f follow-up,
 * 2026-09-17).
 *
 * `adventure.int.test.ts` runs the Adventure spec through `run()` with stubbed
 * bindings; `stateNodes.int.test.ts` drives `set-state` on its own. Neither
 * walks the road a live send takes — `sessions:triggerGenerateMessage` →
 * `runReply` → `runTurn` → the executor with the REAL host and the REAL oracle
 * bindings (the LLM queue, the live row, the run registry) — with the keeper
 * naming changes that `set-state` then has to write under U5f's locked
 * transactions. This does, in both modes: `propose` (the default) and
 * `apply` (the session trusts the narrator).
 *
 * Written to reproduce a live Adventure session that went silent after U5f
 * — one "Starting generation" line and then nothing — on the hypothesis of
 * PGlite's one deadlock (an outer-handle query awaited inside
 * `db.transaction`, which waits on its own mutex forever). It did NOT
 * reproduce: the road completes in about a second either way. The live
 * silence was the trigger loop finding nobody due (the pre-pick rotation,
 * since retired) and breaking without a word; the deadlock itself is now refused loudly by
 * `db/transactionGuard.ts`. This file stays as the road's regression guard.
 *
 * ⚠ **A hang would be the symptom**, so every road here is raced against a
 * hard timer that fails loudly (`within`). A test that merely waited would
 * hang the suite exactly as a deadlocked run would.
 *
 * The faked model answers every stage with ONE document carrying the planner's
 * keys and the keeper's — the pattern `adventure.int.test.ts` states the
 * reason for — with a NON-EMPTY change list: the world's weather and a cast
 * member's mood. That is what makes `resolve-state-changes` → `set-state`
 * actually write.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import type { TestDb } from "$lib/server/utils/testDb"
import type { FakeTextAdapter } from "$lib/server/connectionAdapters/fakeTextAdapter"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "state-road-test-secret" }
})

/**
 * One answer for every stage. `generate-json` reads the lists its `path`
 * selects out of it; `generate-text` takes it as the prose. `value` is text,
 * as the shipped keeper schema declares it.
 */
const ANSWER = JSON.stringify({
	beats: ["The lantern gutters.", "Thunder, far off."],
	speakers: [{ name: "Elara", intent: "warn the party" }],
	worldHints: { location: "the fog road", timeOfDay: "dusk", weather: "storm" },
	needsLookup: false,
	values: [
		{ owner: "world", slot: "weather", value: "storm" },
		{ owner: "Elara", slot: "mood", value: "wary" }
	],
	possessions: []
})

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
		return {
			compiledPrompt: this.injected,
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent(ANSWER)
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

const ADVENTURE = "core:genre/adventure"
const WEATHER = "core:slot/weather@1"
const MOOD = "core:slot/mood@1"

/** The hard ceiling a road gets before the suite calls it hung. */
const HANG_MS = 20_000

/**
 * The road, or a loud failure. A PGlite transaction that awaits the outer
 * handle never returns and never throws — the only way the suite can say so
 * is a timer that wins the race.
 */
async function within<T>(label: string, road: Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined
	const hung = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new Error(
						`${label} did not finish within ${HANG_MS} ms — the reply road is hung`
					)
				),
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
		path.join(os.tmpdir(), "serene-pub-state-road-int-test-")
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

async function makeUser(username: string) {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return createTestUser(testDb, username)
}

async function character(userId: number, name: string, isPersona = false) {
	const schema = await import("$lib/server/db/schema")
	const [row] = await testDb
		.insert(schema.characters)
		.values({ userId, name, description: name, isPersona })
		.returning()
	return row!.id
}

/**
 * An Adventure session as a live one stands: a lorebook (the genre requires
 * one), two cast members, the owner's persona, and the owner's line waiting
 * for a reply. Elara is the character the trigger names, so the road is the
 * character's reply road and not the envoy's.
 */
async function adventureSession(tag: string, opts: { trustNarrator: boolean }) {
	const schema = await import("$lib/server/db/schema")
	const { insertLegacy } = await import("$lib/server/messages/store")
	const owner = await makeUser(`${tag}-owner`)
	const [lorebook] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: owner.id, name: `The fog roads ${tag}` })
		.returning()
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: owner.id,
			isGroup: true,
			name: `Road ${tag}`,
			genreId: ADVENTURE,
			lorebookId: lorebook!.id,
			genreFields: {
				tone: "grounded",
				difficulty: "normal",
				trustNarrator: opts.trustNarrator
			}
		})
		.returning()
	await testDb
		.insert(schema.sessionLorebooks)
		.values({ sessionId: session!.id, lorebookId: lorebook!.id })
	const elara = await character(owner.id, "Elara")
	const tom = await character(owner.id, "Tom")
	for (const [characterId, position] of [
		[elara, 0],
		[tom, 1]
	] as const)
		await testDb.insert(schema.sessionCharacters).values({
			sessionId: session!.id,
			characterId,
			isActive: true,
			visibility: "visible",
			position
		})
	const rook = await character(owner.id, "Rook", true)
	await testDb
		.insert(schema.sessionPersonas)
		.values({ sessionId: session!.id, personaId: rook })
	const line = await insertLegacy(testDb as unknown as Db, {
		sessionId: session!.id,
		role: "user",
		content: "I hold up the lantern.",
		personaId: rook,
		userId: owner.id
	})
	return { owner, session: session!, elara, tom, rook, line }
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

function fakeSocket(userId: number, io: any) {
	return { user: { id: userId, isAdmin: false }, io } as any
}

async function runsOf(sessionId: number) {
	// Event work runs after the writer, on the session's queue (PLAN §8 (27)).
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
	const schema = await import("$lib/server/db/schema")
	return testDb
		.select({
			runId: schema.pipelineRuns.runId,
			specSlug: schema.pipelineRuns.specSlug,
			outcome: schema.pipelineRuns.outcome,
			haltReason: schema.pipelineRuns.haltReason
		})
		.from(schema.pipelineRuns)
		.where(eq(schema.pipelineRuns.sessionId, sessionId))
		.orderBy(asc(schema.pipelineRuns.id))
}

/** The trigger, as the composer's send makes it: Elara's turn, once. */
async function reply(
	w: Awaited<ReturnType<typeof adventureSession>>,
	label: string
) {
	const { triggerGenerateMessageHandler } = await import("./sessions")
	const { io, emitted } = recordingIo(w.owner.id, w.session.id)
	const ownEmit = (event: string, payload: any) =>
		emitted.push({ room: "caller", event, payload })
	const res = await within(
		label,
		triggerGenerateMessageHandler.handler(
			fakeSocket(w.owner.id, io),
			{ sessionId: w.session.id, characterId: w.elara, once: true } as any,
			ownEmit
		)
	)
	return { res, emitted }
}

describe("the keeper's changes over sessions:triggerGenerateMessage", () => {
	test("propose mode: the run completes, holds the two changes as proposals with base_version, and announces state:changed", async () => {
		const schema = await import("$lib/server/db/schema")
		const w = await adventureSession("propose", { trustNarrator: false })
		const { res, emitted } = await reply(w, "the propose road")
		expect((res as any)?.error).toBeUndefined()

		// The receipt is saved: the run went to its end. The narrator
		// prologue run an adventure fire walks first (§4.6) is an ordinary
		// board run, and the respond run after it is the fire's own.
		const runs = await runsOf(w.session.id)
		expect(
			runs.map((r) => `${r.specSlug}:${r.outcome}${r.haltReason ? ` (${r.haltReason})` : ""}`)
		).toEqual([
			"core:spec/adventure-turn-order:ok",
			"core:spec/adventure-respond:ok"
		])

		// Held, not applied: two proposals, each stamped with the version the
		// turn read (a fresh session: 0).
		const proposals = await testDb
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
			.orderBy(asc(schema.stateProposals.id))
		const slots = proposals.map((p) => (p.payload as any).slotId).sort()
		expect(slots).toEqual(expect.arrayContaining([WEATHER, MOOD]))
		for (const p of proposals) {
			expect(p.status).toBe("pending")
			expect(p.baseVersion).toBe(0)
		}
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(testDb as unknown as Db, w.session.id)
		expect(state.world.weather).toBe("clear")
		expect(state.version).toBe(0)

		// Announced, after the terminal frame.
		const changed = emitted.findIndex((e) => e.event === "state:changed")
		expect(changed).toBeGreaterThanOrEqual(0)
		const terminal = emitted.findIndex(
			(e) => e.event === "pipelines:progress" && e.payload?.done
		)
		expect(terminal).toBeGreaterThanOrEqual(0)
		expect(terminal).toBeLessThan(changed)
		expect(emitted.some((e) => e.event === "pipelines:runStarted")).toBe(
			true
		)
	})

	test("apply mode (trustNarrator): the run completes, both rows land under a moved state version, and state:changed is announced", async () => {
		const schema = await import("$lib/server/db/schema")
		const w = await adventureSession("apply", { trustNarrator: true })
		const { res, emitted } = await reply(w, "the apply road")
		expect((res as any)?.error).toBeUndefined()

		const runs = await runsOf(w.session.id)
		expect(
			runs.map((r) => `${r.specSlug}:${r.outcome}${r.haltReason ? ` (${r.haltReason})` : ""}`)
		).toEqual([
			"core:spec/adventure-turn-order:ok",
			"core:spec/adventure-respond:ok"
		])

		// Applied: rows, no proposals, and the version moved once per row.
		const rows = await testDb
			.select()
			.from(schema.attributeValues)
			.where(eq(schema.attributeValues.sessionId, w.session.id))
			.orderBy(asc(schema.attributeValues.id))
		expect(rows.map((r) => r.slotId).sort()).toEqual(
			expect.arrayContaining([WEATHER, MOOD])
		)
		expect(rows.map((r) => r.stateVersion).sort()).toEqual(
			rows.map((_, i) => i + 1)
		)
		const proposals = await testDb
			.select()
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.sessionId, w.session.id))
		expect(proposals).toHaveLength(0)
		const { stateFor } = await import("$lib/server/state/resolve")
		const state = await stateFor(testDb as unknown as Db, w.session.id)
		expect(state.world.weather).toBe("storm")
		expect(state.version).toBe(rows.length)

		const changed = emitted.findIndex((e) => e.event === "state:changed")
		expect(changed).toBeGreaterThanOrEqual(0)
		const terminal = emitted.findIndex(
			(e) => e.event === "pipelines:progress" && e.payload?.done
		)
		expect(terminal).toBeLessThan(changed)
	})

	test("a second send after the first lands still runs — nothing is left holding the database", async () => {
		// A transaction that deadlocked would hold PGlite's mutex for the rest
		// of the process: every later query would wait forever. The second
		// send is the probe.
		const w = await adventureSession("again", { trustNarrator: true })
		const first = await reply(w, "the first send")
		expect((first.res as any)?.error).toBeUndefined()
		const second = await reply(w, "the second send")
		expect((second.res as any)?.error).toBeUndefined()
		// Four now: narrator prologue + respond, twice over.
		expect((await runsOf(w.session.id)).map((r) => r.outcome)).toEqual([
			"ok",
			"ok",
			"ok",
			"ok"
		])
	})
})
