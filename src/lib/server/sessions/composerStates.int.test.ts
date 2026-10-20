/**
 * 🚧 Composer states (owner ruling 2026-10-15): a genre opens and closes a
 * person's composer per channel lane (`core:outlet/set-composer-state@1`);
 * the state is `sessions.composer_states` (migration 0103), and the send door
 * — `offerMessage`, which the send handler goes through — refuses a line on a
 * closed composer with what it waits on. The owner is closed too: the genre
 * decides. Core opens and closes nothing on its own.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { sessionEvents } from "@serene-pub/sdk"

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
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	// annexViews pushes per-user views through this; a stub keeps that push quiet.
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

const REPLY = "The gate was sealed with old iron."
/** Set to make the NEXT model call fail — the placeholder never completes. */
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
			compiledPrompt: { prompt: "p", messages: undefined, meta: {} as any },
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
let otherUserId: number
let characterId: number
let personaId: number
let othersPersonaId: number

const fakeSocket = (uid: number) =>
	({ user: { id: uid, isAdmin: true }, io: {} }) as any
const emit = (_event: string, _data: any) => {}

const settle = async () =>
	(await import("$lib/server/pipelines/runtime/sessionEvents")).settleSessionEvents()

const completedOf = async (sessionId: number) => {
	await settle()
	return (
		await db
			.select()
			.from(schema.sessionChanges)
			.where(eq(schema.sessionChanges.sessionId, sessionId))
			.orderBy(schema.sessionChanges.id)
	).filter((c) => c.event === sessionEvents.messageCompleted)
}

const chatPreset = async () => {
	const [row] = await db
		.select()
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-minimal"))
		.limit(1)
	return row!
}

async function makeSession(tag: string, presetId?: number) {
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			name: `offer ${tag}`,
			presetId: presetId ?? (await chatPreset()).id
		})
		.returning()
	await db.insert(schema.sessionCharacters).values({
		sessionId: session.id,
		characterId,
		isActive: true
	})
	await db.insert(schema.sessionMessages).values({
		sessionId: session.id,
		userId,
		role: "assistant",
		characterId,
		content: `The gate (${tag}) is old.`,
		metadata: {}
	} as any)
	return session.id
}

const send = async (uid: number, params: Record<string, unknown>) => {
	const { sessionMessagesSendPersonaMessageHandler } = await import(
		"$lib/server/sockets/sessions"
	)
	return (await sessionMessagesSendPersonaMessageHandler.handler(
		fakeSocket(uid),
		params as any,
		emit
	)) as any
}

const userRows = async (sessionId: number) =>
	(
		await db
			.select()
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.sessionId, sessionId))
	).filter((m) => m.role === "user")

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-composer-states-int-test-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)

	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "offer-owner")).id
	otherUserId = (await createTestUser(db, "offer-other")).id
	const [character] = await db
		.insert(schema.characters)
		.values({ userId, name: "Alice", description: "A knight." })
		.returning()
	characterId = character.id
	const [persona] = await db
		.insert(schema.characters)
		.values({ userId, name: "Bram", description: "", isPersona: true, aliases: [] } as any)
		.returning()
	personaId = persona.id
	const [others] = await db
		.insert(schema.characters)
		.values({ userId: otherUserId, name: "Cass", description: "", isPersona: true, aliases: [] } as any)
		.returning()
	othersPersonaId = others.id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import("$lib/server/connections/models")
	const modelId = (await ensureConnectionModel(db, textConn.id, "default-7b"))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "Default",
			isImmutable: false,
			values: { contextTokens: 8192, responseTokens: 200, temperature: 0.5 },
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import("$lib/server/connections/capabilityDefaults")
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn.id,
		connectionModelId: modelId,
		samplingConfigId: sampling.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})


const closeVia = async (sessionId: number, input: Record<string, unknown>) => {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(db as any, { sessionId, userId, specId: "test:spec/composer", runId: `run-${Math.random()}` } as any)
	const node = { key: "composer", definitionId: "core:outlet/set-composer-state", definitionVersion: 1 } as any
	return (await host.commit!(input, node)) as any
}
const statesOf = async (sessionId: number) =>
	(
		await db
			.select({ composerStates: schema.sessions.composerStates })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
	)[0]!.composerStates

describe("composer states", () => {
	it("the migration applies: a new session's composers are all open ({})", async () => {
		const sessionId = await makeSession("fresh")
		expect(await statesOf(sessionId)).toEqual({})
	})

	it("closed by the outlet: the send is refused with its reason, nothing written; opened: the send lands", async () => {
		const sessionId = await makeSession("close")
		const out = await closeVia(sessionId, { channel: "main", open: false, reason: "Make your character first." })
		expect(out.written).toBe(true)
		expect(out.states).toEqual({ main: { "*": { open: false, reason: "Make your character first." } } })
		expect(await statesOf(sessionId)).toEqual(out.states)

		const refused = await send(userId, { sessionId, personaId: null, content: "Hello?" })
		// The owner is closed too: the genre decides.
		expect(refused.refused).toBe("You can't send here yet. Make your character first. Your text was kept.")
		expect(refused.accepted).toBeUndefined()
		expect(await userRows(sessionId)).toHaveLength(0)

		await closeVia(sessionId, { channel: "main", open: true })
		expect(await statesOf(sessionId)).toEqual({})
		const landed = await send(userId, { sessionId, personaId: null, content: "Hello?" })
		expect(landed.refused).toBeUndefined()
		expect(landed.accepted).toBe(true)
		expect((await userRows(sessionId)).map((r) => r.content)).toEqual(["Hello?"])
	})

	it("closed for one person: theirs is refused (no reason: the plain sentence); another member's lands", async () => {
		const sessionId = await makeSession("one person")
		await db.insert(schema.sessionGuests).values({ sessionId, userId: otherUserId, isPlayer: true } as any)
		await closeVia(sessionId, { channel: "main", open: false, person: `user:${userId}` })
		const mine = await send(userId, { sessionId, personaId: null, content: "Me first." })
		expect(mine.refused).toBe("You can't send here yet. Your text was kept.")
		const theirs = await send(otherUserId, { sessionId, personaId: othersPersonaId, content: "Me then." })
		expect(theirs.refused, theirs.refused).toBeUndefined()
		expect((await userRows(sessionId)).map((r) => r.content)).toEqual(["Me then."])
	})

	it("per lane: closing parley:2 closes that lane alone; * closes every channel", async () => {
		const sessionId = await makeSession("lanes")
		const { composerRefusal } = await import("$lib/server/sessions/composerStates")
		await closeVia(sessionId, { channel: "parley:2", open: false, reason: "Wait for the Planner." })
		expect(await composerRefusal(db as any, sessionId, "parley:2", userId)).toBe("You can't send here yet. Wait for the Planner.")
		expect(await composerRefusal(db as any, sessionId, "parley", userId)).toBeNull()
		expect(await composerRefusal(db as any, sessionId, "main", userId)).toBeNull()
		await closeVia(sessionId, { channel: "*", open: false })
		expect(await composerRefusal(db as any, sessionId, "main", otherUserId)).toBe("You can't send here yet.")
		// Opening everything clears every closure.
		await closeVia(sessionId, { channel: "*", open: true })
		expect(await statesOf(sessionId)).toEqual({})
	})

	it("the outlet halts on a value it cannot read; a run's settings document carries the states when something is closed", async () => {
		const sessionId = await makeSession("halts")
		expect((await closeVia(sessionId, { channel: "main", open: "maybe" })).halt).toMatch(/neither open/)
		expect((await closeVia(sessionId, { channel: "main", open: false, person: "character:3" })).halt).toMatch(/not a person/)
		expect((await closeVia(sessionId, { open: false })).halt).toMatch(/no channel/)
		expect(await statesOf(sessionId)).toEqual({})
		const { resolveSessionSettings } = await import("$lib/server/sessions/settings")
		expect((await resolveSessionSettings(db as any, sessionId))?.composerStates).toBeUndefined()
		await closeVia(sessionId, { channel: "main", open: false, person: `user:${userId}` })
		expect((await resolveSessionSettings(db as any, sessionId))?.composerStates).toEqual({
			main: { [`user:${userId}`]: { open: false } }
		})
	})
})
