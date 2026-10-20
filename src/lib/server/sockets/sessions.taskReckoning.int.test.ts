/**
 * 🚧 The **reckoning** after a Story reply (PLAN-genre-restructure §4, lane 2,
 * 2026-10-19), on real turns with a scripted model: *Keep the sheets* on
 * Review files every change — belongings included — as a proposal instead
 * of dropping it; a lorebook item's supply is checked (phase 3b: a unique
 * item is never handed out twice); and *Describe new places* files the
 * place a move reached, linked to the places the book knows. The session's
 * task modes are what the host's own handlers read.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "task-reckoning-test-secret" }
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

/** What the reckoning answers this turn; every other call says a line. */
const script = vi.hoisted(() => ({ reckoning: "" as string }))
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
		return this
	}
	async generateText() {
		const asked = JSON.stringify(this.injected ?? {})
		const text = asked.includes("You keep the record of a story") ? script.reckoning : "They walk on."
		return {
			compiledPrompt: this.injected ?? { prompt: "p", messages: undefined, meta: {} },
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => onContent(text)
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let ownerId: number
let bookId: number
let crownId: number
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
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-task-reckoning-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await (await import("$lib/server/db/defaults")).sync()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	ownerId = (await createTestUser(db, "task-reckoning-owner")).id
	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "openai", baseUrl: "http://text/v1" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn!.id, "reckon-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Task reckoning test sampling",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 300, temperature: 0.2 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", { connectionId: textConn!.id, connectionModelId: modelId, samplingConfigId: sampling!.id })

	const [book] = await db.insert(schema.lorebooks).values({ userId: ownerId, name: "The Old Keep" }).returning()
	bookId = book!.id
	const { entryInsert } = await import("$lib/server/utils/lorebookEntries")
	await db.insert(schema.lorebookEntries).values(
		entryInsert({ typeId: "core:entry/location", lorebookId: bookId, name: "The Gatehouse", content: "Where the road ends.", position: 1 } as any)
	)
	const [crown] = await db
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({ typeId: "core:entry/item", lorebookId: bookId, name: "The Iron Crown", content: "There is only one.", supply: "unique", position: 1 } as any)
		)
		.returning({ id: schema.lorebookEntries.id })
	crownId = crown!.id
}, 180_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

async function presetId(seedKey: string) {
	const [p] = await db.select({ id: schema.sessionPresets.id }).from(schema.sessionPresets).where(eq(schema.sessionPresets.seedKey, seedKey))
	return p!.id
}

async function aCharacter(name: string) {
	const [c] = await db.insert(schema.characters).values({ userId: ownerId, name, description: "A traveller.", isPersona: false }).returning()
	return c!.id
}

async function living(name: string, characterIds: number[], tasks: Record<string, "full" | "review" | "off"> = {}) {
	const { sessionsCreateHandler } = await import("$lib/server/sockets/sessions")
	const res: any = await sessionsCreateHandler.handler(
		fakeSocket(ownerId),
		{ session: { name, presetId: await presetId("core-story-living") }, characterIds, personaIds: [], characterPositions: {}, tags: [] } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
	const sessionId = res.session.id as number
	const fields = { tasks: { v: 1, tasks: Object.fromEntries(Object.entries(tasks).map(([k, mode]) => [k, { mode }])) } }
	await db.update(schema.sessions).set({ lorebookId: bookId, genreFields: fields }).where(eq(schema.sessions.id, sessionId))
	return sessionId
}

async function turn(sessionId: number, reckoning: unknown) {
	script.reckoning = JSON.stringify(reckoning)
	const { sessionMessagesSendPersonaMessageHandler } = await import("./sessions")
	const res: any = await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(ownerId),
		{ sessionId, personaId: null, content: "We go on.", channel: "main" } as any,
		emit
	)
	expect(res?.error, res?.error).toBeUndefined()
	await settle()
}

const delta = (d: Record<string, unknown>) => ({
	owner: "world",
	op: "add",
	slot: "",
	repertoire: "",
	piece: "",
	value: "",
	check: "",
	against: 0,
	reason: "the reply said so",
	...d
})

describe("the reckoning (lane 2)", () => {
	it("the host reads the session's task modes: stored over the preset's pins", async () => {
		const sessionId = await living("reckon-modes", [await aCharacter("Ash")], { attributes: "review", "timed-expiry": "off" })
		const { sessionTaskModes } = await import("$lib/server/sessions/tasks")
		const modes = await sessionTaskModes(db as any, sessionId)
		expect(modes).toMatchObject({ attributes: "review", "timed-expiry": "off", conditions: "full", "lore-retrieval": "full" })
		expect(modes).not.toHaveProperty("whispers")
		expect(modes).not.toHaveProperty("envoy-initiative")
		const { expiryOf } = await import("$lib/server/rulesets/resolve")
		expect(expiryOf(modes)).toEqual({ pieces: false, review: false, conditions: true })
	}, 180_000)

	it("Keep the sheets on Review: a value the reply changed waits as a proposal; nothing is applied", async () => {
		const ash = await aCharacter("Bram")
		const sessionId = await living("reckon-review", [ash], { attributes: "review", time: "off", "places-on-move": "off" })
		await turn(sessionId, { deltas: [delta({ owner: `character:${ash}`, op: "set", slot: "mood", value: "wary" })], clock: [], place: [] })
		const { pendingProposals } = await import("$lib/server/state/write")
		const pending = await pendingProposals(db as any, sessionId)
		expect(pending.length, "the change was proposed, not dropped").toBeGreaterThan(0)

		// A piece (a thing gained) goes through the ruleset handler in its
		// `propose` mode — lane 1 dropped it. ⚠ A fresh Story session tracks
		// no list for Freeform's repertoires, so the handler refuses it there
		// as `unknown-repertoire`; a session that tracks one gets a proposal.
		await turn(sessionId, { deltas: [delta({ owner: `character:${ash}`, op: "add", repertoire: "things", piece: "Rope", value: "1" })], clock: [], place: [] })
		const runs = await db.select({ receipt: schema.pipelineRuns.receipt }).from(schema.pipelineRuns).where(eq(schema.pipelineRuns.sessionId, sessionId))
		const held = runs
			.flatMap((r) => ((r.receipt as any)?.nodes ?? []) as any[])
			.find((n) => (n.key ?? n.nodeKey) === "reckon.on.commit.piecesHeld.propose")
		expect(held, "the Review arm ran").toBeTruthy()
		expect(held.outputs?.facts?.mode ?? held.output?.facts?.mode).toBe("propose")
		const applied = runs
			.flatMap((r) => ((r.receipt as any)?.nodes ?? []) as any[])
			.find((n) => (n.key ?? n.nodeKey) === "reckon.on.commit.pieces.apply")
		expect(applied, "nothing on Review is applied").toBeUndefined()
	}, 180_000)

	it("a unique item is handed out once: the second grant is refused by its supply", async () => {
		const cara = await aCharacter("Cara")
		const dov = await aCharacter("Dov")
		const sessionId = await living("reckon-supply", [cara, dov], { time: "off", "places-on-move": "off", conditions: "off" })
		const grant = (who: number) => delta({ owner: `character:${who}`, op: "add", repertoire: "things", piece: "the iron crown", value: "1" })
		await turn(sessionId, { deltas: [grant(cara)], clock: [], place: [] })
		const { itemSupplyFor } = await import("$lib/server/state/supply")
		const once = (await itemSupplyFor(db as any, sessionId, [crownId]))[0]!
		expect(once.held).toBe(1)
		expect(once.remaining).toBe(0)

		await turn(sessionId, { deltas: [grant(dov)], clock: [], place: [] })
		const twice = (await itemSupplyFor(db as any, sessionId, [crownId]))[0]!
		expect(twice.held, "the crown stayed one").toBe(1)
		expect(twice.holders.map((h) => h.ownerId)).toEqual([expect.any(Number)])
	}, 180_000)

	it("Describe new places: the place a move reached is filed, linked to the place it was reached from", async () => {
		const sessionId = await living("reckon-place", [await aCharacter("Eda")], { attributes: "off", time: "off", conditions: "off" })
		await turn(sessionId, {
			deltas: [],
			clock: [],
			place: [{ name: "The Undercroft", content: "Low vaults, dripping.", ways: ["The Gatehouse", "The Well"] }]
		})
		const rows = await db
			.select({ id: schema.lorebookEntries.id, content: schema.lorebookEntries.content })
			.from(schema.lorebookEntries)
			.where(and(eq(schema.lorebookEntries.title, "The Undercroft"), sql`split_part(${schema.lorebookEntries.typeId}, '@', 1) = 'core:entry/location'`))
		expect(rows, "the place was filed").toHaveLength(1)
		expect(rows[0]!.content).toContain("Ways out: The Well.")
		const links = await db
			.select({ id: schema.narrativeRelationships.id })
			.from(schema.narrativeRelationships)
			.where(sql`${schema.narrativeRelationships.fromEntryId} = ${rows[0]!.id} or ${schema.narrativeRelationships.toEntryId} = ${rows[0]!.id}`)
		expect(links.length, "linked to the Gatehouse").toBeGreaterThan(0)

		// Off: a move files nothing.
		const quiet = await living("reckon-place-off", [await aCharacter("Fen")], { attributes: "full", "places-on-move": "off" })
		await turn(quiet, { deltas: [], clock: [], place: [{ name: "The Loft", content: "Dusty.", ways: [] }] })
		const loft = await db.select({ id: schema.lorebookEntries.id }).from(schema.lorebookEntries).where(eq(schema.lorebookEntries.title, "The Loft"))
		expect(loft).toEqual([])
	}, 180_000)
})
