/**
 * The Sanctum, the Castellan and its greeting (lair re-plan R6, owner F1/F2
 * 2026-09-28) — over the REAL create and reply roads, against the SHIPPED
 * Lair documents the bootstrap publishes, with a fake adapter standing in
 * for the model.
 *
 * What is pinned:
 *
 *  1. **The greeting.** A new Lair session holds exactly one row: the
 *     Castellan's declared greeting, on the Sanctum, under its name — the
 *     Dungeon Master and the party named — and creation calls no model. The
 *     row is on the wire (`sessions:get`), which is where the page's primary
 *     log reads every channel until S1 gives the Sanctum its own panel.
 *  2. **Sanctum talk.** A person's Sanctum line heads the order on the
 *     Sanctum; Continue pressed there gives ONE Castellan row on the Sanctum,
 *     streamed, from a prompt that says it is talking with the Dungeon
 *     Master and carries the story's newest rows as background.
 *  3. **The party never hear the table.** The next `main` turn's voice and
 *     keeper prompts carry no Sanctum text (the planner reads the unplayed
 *     talk while _Sanctum talk steers the story_ is on — R13, tested in
 *     `sessions.sanctumSteers.int.test.ts`), and its unclaimed row is the
 *     Castellan's (the fallback envoy) — so the retake confirm names it so.
 *  4. **Per channel.** The Sanctum lists Continue and Narrate, never Pick
 *     who speaks nor Regenerate the last turn; a Pick pressed there is
 *     refused at the door.
 *  5. **Naming is declared, not seated.** Unseated, the Castellan still
 *     names the own voice and a story row; only Sanctum talk stops, refused
 *     by name, and no greeting is written for it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, asc, desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { JSON_INSTRUCTION } from "$lib/server/connections/structuredOutput"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "lair-sanctum-test-secret" }
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
	broadcastToSessionUsers: async () => {}
}))
vi.mock("$lib/server/utils/getUserConfigurations", () => ({
	getUserConfigurations: async () => ({
		contextConfig: { id: 1, template: "{{instructions}}" },
		promptConfig: { id: 1, systemPrompt: "Be brief." },
		narratorPromptConfig: null
	})
}))

/** What the planner and the keeper answer: one delver speaks. */
const PLAN = {
	beats: ["The torch gutters."],
	speakers: [{ name: "Brannoc", intent: "check the door" }],
	unknownExit: "",
	knockQuestion: "",
	worldHints: { location: "The Old Well" },
	values: [],
	inventory: []
}
const SANCTUM_LINE = "What if the stair floods when they come back up?"
const CASTELLAN_SAYS = "A flood would suit the stair. Build it and I'll keep the tally."
const STORY_LINE = "The torches gutter, and something wakes below."

/** Every call the fake model took: its prompt, and whether it wanted JSON. */
const calls: Array<{ prompt: string; json: boolean }> = []

class FakeAdapter {
	injected: any
	responseFormat: any
	aborted = false
	abort() {
		this.aborted = true
	}
	async preflight() {}
	withStops() {
		return this
	}
	withStreaming() {
		return this
	}
	withCompiledPrompt(p: any) {
		this.injected = p
		return this
	}
	async generateText() {
		const prompt = JSON.stringify(this.injected ?? "")
		const json =
			this.responseFormat === "json" ||
			prompt.includes(JSON.stringify(JSON_INSTRUCTION).slice(1, 40))
		calls.push({ prompt, json })
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				if (json) return onContent(JSON.stringify(PLAN))
				if (prompt.includes("This conversation is the Sanctum"))
					return onContent(CASTELLAN_SAYS)
				if (/You are Brannoc,/.test(prompt)) return onContent("Brannoc checks the door.")
				onContent("The torch gutters.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
const party: Record<string, number> = {}
const fakeSocket = (uid: number) => ({ user: { id: uid, isAdmin: false }, io: recordingIo() }) as any
const emit = () => {}

/** An io that swallows every emit — the rows are read back from the table. */
function recordingIo() {
	return {
		sockets: {
			adapter: { rooms: { get: () => undefined } },
			sockets: { get: () => undefined, values: () => [].values() }
		},
		to: () => ({ emit: () => {} })
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-lair-sanctum-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "lair-sanctum")).id
	for (const name of ["Brannoc", "Vell"]) {
		const [c] = await db
			.insert(schema.characters)
			.values({ userId, name, description: "A delver." } as any)
			.returning()
		party[name] = c!.id
	}

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "lair-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Sanctum test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

async function createLairSession(name: string) {
	const { LAIR_GENRE_ID } = await import("@serene-pub/core-catalog")
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const [lorebook] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: `${name} dungeon` } as any)
		.returning()
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(userId),
		{
			session: { name, genreId: LAIR_GENRE_ID, lorebookId: lorebook!.id },
			characterIds: [party.Brannoc, party.Vell],
			personaIds: [],
			characterPositions: { [party.Brannoc!]: 0, [party.Vell!]: 1 },
			tags: []
		} as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	return res.session.id as number
}

async function settle() {
	await (await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()
}

const rowsOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(asc(schema.sessionMessages.id))

/** A person's line, then the turn order recomputed (an edit cause: no auto-advance). */
async function personSays(sessionId: number, content: string, channel = "main") {
	const [row] = await db
		.insert(schema.sessionMessages)
		.values({ sessionId, userId, role: "user", content, channel } as any)
		.returning()
	const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
	const { sessionEvents } = await import("@serene-pub/sdk")
	await emitSessionEvent(db as any, {
		sessionId,
		userId,
		event: sessionEvents.messageDeleted,
		payload: { sessionId, cause: { kind: "edit", userId } },
		wait: true
	})
	return row!
}

async function orderOf(sessionId: number) {
	const { readTurnOrder } = await import("@serene-pub/sdk")
	const [row] = await db
		.select({ metadata: schema.sessions.metadata })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
	return readTurnOrder(row!.metadata).order
}

async function pressContinue(sessionId: number, params: Record<string, unknown>) {
	const { sessionsFireTurnHandler } = await import("./sessions")
	const res: any = await sessionsFireTurnHandler.handler(
		fakeSocket(userId),
		{ sessionId, ...params } as any,
		emit
	)
	await settle()
	return res
}

describe("the Castellan's greeting (R6)", () => {
	it("a new Lair session holds exactly one row: the greeting, on the Sanctum, under the Castellan — and no model was called", async () => {
		calls.length = 0
		const sessionId = await createLairSession("greeting")
		const rows = await rowsOf(sessionId)
		expect(rows).toHaveLength(1)
		const [greeting] = rows
		expect(greeting!.channel).toBe("sanctum")
		expect(greeting!.role).toBe("assistant")
		expect((greeting!.metadata as any)?.speaker).toBe("envoy:castellan")
		expect(greeting!.content).toContain("Welcome, Dungeon Master. I am Castellan")
		expect(greeting!.content).toContain("Brannoc and Vell have come to delve")
		expect(greeting!.content).toContain("This is the Sanctum")
		expect(greeting!.content).not.toContain("{{")
		expect(calls).toHaveLength(0)

		// On the wire: the page's session read carries it, channel and all.
		const { sessionsGetHandler } = await import("./sessions")
		const got: any = await sessionsGetHandler.handler(
			fakeSocket(userId),
			{ id: sessionId } as any,
			emit
		)
		const wire = (got?.messages ?? []) as any[]
		expect(wire.find((m) => m.id === greeting!.id)?.channel).toBe("sanctum")
	})
})

describe("the Castellan talks in the Sanctum (R6)", () => {
	it("a Sanctum line heads the order there, and Continue pressed there gives one streamed Castellan row", async () => {
		const sessionId = await createLairSession("talk")
		await personSays(sessionId, STORY_LINE)
		const line = await personSays(sessionId, SANCTUM_LINE, "sanctum")
		const order = await orderOf(sessionId)
		expect(order[0]).toMatchObject({ ref: null, channel: "sanctum" })

		calls.length = 0
		const res = await pressContinue(sessionId, { channel: "sanctum" })
		expect(res?.error, res?.error).toBeUndefined()

		const after = (await rowsOf(sessionId)).filter((r) => r.id > line.id)
		expect(after).toHaveLength(1)
		const [reply] = after
		expect(reply!.channel).toBe("sanctum")
		expect(reply!.content).toBe(CASTELLAN_SAYS)
		expect((reply!.metadata as any)?.speaker).toBe("envoy:castellan")
		// One prose call, then the scratchpad rewrite (R13) — no planner, no keeper.
		expect(calls.map((c) => c.json)).toEqual([false, true])
		const prompt = calls.find((c) => !c.json)!.prompt
		// R4's seam: the Castellan knows whom it is talking with.
		expect(prompt).toContain("talking with the Dungeon Master")
		// The Sanctum is the conversation; the story is background.
		expect(prompt).toContain(SANCTUM_LINE)
		expect(prompt).toContain("The story so far")
		expect(prompt).toContain(`Dungeon Master: ${STORY_LINE}`)

		// Streamed: the reply's run declares its `say` step streaming.
		const [run] = await db
			.select({ receipt: schema.pipelineRuns.receipt })
			.from(schema.pipelineRuns)
			.where(
				and(
					eq(schema.pipelineRuns.sessionId, sessionId),
					eq(schema.pipelineRuns.specSlug, "core:spec/lair-respond")
				)
			)
			.orderBy(desc(schema.pipelineRuns.id))
			.limit(1)
		const ran = ((run?.receipt as any)?.nodes ?? [])
			.filter((n: any) => n.result === "ok")
			.map((n: any) => n.nodeKey as string)
		expect(ran).toContain("via.turn.channel.sanctum.say")
		expect(ran.some((k: string) => k.startsWith("via.turn.channel.story."))).toBe(false)
		const { CORE_SPECS } = await import("$lib/server/pipelines/specs")
		const doc = CORE_SPECS.find((s) => s.slug === "core:spec/lair-respond")!.build()
		expect((doc.nodes.find((n: any) => n.key === "via.turn.channel.sanctum.say")?.expose as any)?.stream).toBe(true)
	})

	it("the party never hear the Sanctum, and the turn's unclaimed row is the Castellan's", async () => {
		const sessionId = await createLairSession("story")
		await personSays(sessionId, SANCTUM_LINE, "sanctum")
		await personSays(sessionId, STORY_LINE)

		calls.length = 0
		const res = await pressContinue(sessionId, { channel: "main" })
		expect(res?.error, res?.error).toBeUndefined()
		// The planner, the voice and the keeper (R8: nothing narrates). The
		// voice and the keeper never hear the table; the planner reads the
		// unplayed talk while Sanctum talk steers the story (R13, the default)
		// — and never the greeting.
		expect(calls.length).toBeGreaterThanOrEqual(3)
		for (const c of calls) expect(c.prompt).not.toContain("Welcome, Dungeon Master")
		const planner = calls.filter((c) => c.json && c.prompt.includes("You plan the PARTY only"))
		expect(planner).toHaveLength(1)
		expect(planner[0]!.prompt).toContain(SANCTUM_LINE)
		for (const c of calls.filter((c) => !planner.includes(c)))
			expect(c.prompt).not.toContain(SANCTUM_LINE)

		// Nothing narrates a turn (R8): no row on main is the own voice's;
		// the Castellan's row of the turn is its beats row, in the Sanctum.
		const rows = await rowsOf(sessionId)
		const story = rows.filter((r) => r.channel === "main" && r.role === "assistant")
		expect(story.some((r) => r.characterId == null)).toBe(false)
		const own = rows.filter((r) => r.channel === "sanctum" && r.role === "assistant").at(-1)!
		expect((own.metadata as any)?.speaker).toBe("envoy:castellan")

		// The retake confirm names the turn's rows by who wrote them (R5 fold-in).
		const { creatingRunOf, turnYieldOf } = await import("$lib/server/sessions/turnYield")
		const run = await creatingRunOf(db as any, own.id)
		const names = (await turnYieldOf(db as any, run!.id)).map((r) => r.name)
		expect(names).toEqual(["Castellan", "Brannoc"])
	})
})

describe("the Sanctum's turn controls (R6)", () => {
	it("the Sanctum lists Continue and Narrate, never Pick who speaks nor Regenerate; main lists all four", async () => {
		const sessionId = await createLairSession("controls")
		const { listSessionActions } = await import(
			"$lib/server/pipelines/entities/sessionActions"
		)
		const keysOn = async (channel: string) =>
			new Set(
				Object.values(await listSessionActions(db as any, sessionId, { userId }, { channel }))
					.flatMap((v) => [...v.primary, ...v.overflow])
					.map((a) => `${a.specSlug}#${a.key}`)
			)
		const table = await keysOn("sanctum")
		const story = await keysOn("main")
		for (const k of ["core#advance", "core#narrate"]) expect(table.has(k), k).toBe(true)
		for (const k of ["core#pick", "core#retake"]) expect(table.has(k), k).toBe(false)
		for (const k of ["core#advance", "core#narrate", "core#pick", "core#retake"])
			expect(story.has(k), k).toBe(true)
	})

	it("a Pick pressed on the Sanctum is refused at the door; the Castellan is never an order entry", async () => {
		const sessionId = await createLairSession("pick")
		await personSays(sessionId, SANCTUM_LINE, "sanctum")
		const res = await pressContinue(sessionId, {
			channel: "sanctum",
			entry: { ref: `character:${party.Brannoc}` }
		})
		expect(res?.error).toMatch(/not offered on this channel/)
		// Its turns come from the strategy's null entry, never a reference to it.
		for (const e of await orderOf(sessionId)) expect(e.ref).not.toBe("envoy:castellan")
		// And the seat Pick lists from carries no character, so it is never a candidate.
		const seats = await db
			.select()
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId))
		const castellan = seats.find((s) => s.envoySlug === "castellan")!
		expect(castellan.characterId).toBeNull()
	})
})

describe("the Castellan's name does not depend on its seat (R6)", () => {
	it("unseated, it still names the own voice and a story row; only Sanctum talk stops, and no greeting is written", async () => {
		const sessionId = await createLairSession("unseated")
		const { unseatEnvoy, sessionDeclaredEnvoys } = await import(
			"$lib/server/pipelines/entities/envoys"
		)
		expect(await unseatEnvoy(db as any, sessionId, "castellan")).toBe(true)

		const { ownVoiceName } = await import("$lib/shared/sessions/ownVoiceName")
		expect(ownVoiceName({ envoys: await sessionDeclaredEnvoys(db as any, sessionId) })).toBe(
			"Castellan"
		)

		// Sanctum talk stops, with the envoy's sentence.
		await personSays(sessionId, SANCTUM_LINE, "sanctum")
		const refused = await pressContinue(sessionId, { channel: "sanctum" })
		expect(refused?.error).toMatch(/Castellan is not seated in this session/)

		// A story turn still runs, under its name.
		await personSays(sessionId, STORY_LINE)
		const ok = await pressContinue(sessionId, { channel: "main" })
		expect(ok?.error, ok?.error).toBeUndefined()
		// Its beats row (R8) is written in the Sanctum under its name, seated
		// or not: only talk stops.
		const own = (await rowsOf(sessionId))
			.filter((r) => r.channel === "sanctum" && r.role === "assistant")
			.at(-1)!
		expect((own.metadata as any)?.speaker).toBe("envoy:castellan")

		// And the greeting read answers nothing for an unseated envoy.
		const { collectEnvoyGreeting } = await import("$lib/server/sessions/greetings")
		expect(await collectEnvoyGreeting(db as any, sessionId, "castellan")).toBeUndefined()
	})
})
