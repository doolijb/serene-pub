/**
 * 🚧 A card-less seat's turn, end to end (seat-cast S4, lane s4-seat-live):
 * `runReply` with `speaker: seated-member:<id>` → the run's scope → its own
 * private lore → a reply row stamped with the member.
 *
 * The real road (shipped `story-respond`, real handlers, real DB); only the
 * model is faked. `createHost` is wrapped to record the `HostScope` it was
 * given and the queries of every `lorebook_entries` read (which carry the
 * `sessionScope` the bindings forward).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { characterLoreValues } from "$lib/server/pipelines/testing/fixtures"

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
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

/** One entry per host the road built: its scope, and each lore read's query. */
const hosts: Array<{ scope: any; loreQueries: any[] }> = []
vi.mock("$lib/server/pipelines/runtime/host", async (importOriginal) => {
	const actual =
		await importOriginal<
			typeof import("$lib/server/pipelines/runtime/host")
		>()
	return {
		...actual,
		createHost: (...args: Parameters<typeof actual.createHost>) => {
			const host = actual.createHost(...args)
			const rec = { scope: args[1], loreQueries: [] as any[] }
			hosts.push(rec)
			const read = host.read?.bind(host)
			if (read)
				host.read = (async (kind: string, q: any, node: any) => {
					if (kind === "lorebook_entries") rec.loreQueries.push(q)
					return read(kind as any, q, node)
				}) as any
			return host
		}
	}
})

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
		return {
			compiledPrompt: {
				prompt: "p",
				messages: undefined,
				meta: {} as any
			},
			isAborted: false,
			completionResult: async (onContent: (c: string) => void) => {
				onContent("A voice answers.")
			}
		}
	}
}
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({ Adapter: FakeAdapter })
}))

let userId: number
let cardId: number
const fakeSocket = (uid: number) => ({ user: { id: uid }, io: {} }) as any
let n = 0

/** A session whose book holds a card-less member M (seated), N, B (not seated), and a carded one. */
async function world() {
	const tag = ++n
	const [minimal] = await db
		.select({ id: schema.sessionPresets.id })
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.seedKey, "core-story-minimal"))
	const [book] = await db
		.insert(schema.lorebooks)
		.values({ userId, name: `Book ${tag}` } as any)
		.returning()
	const member = async (name: string, characterId: number | null = null) =>
		(
			await db
				.insert(schema.lorebookBindings)
				.values({
					lorebookId: book!.id,
					characterId,
					binding: `{{char:${name}${tag}}}`,
					name: `${name}${tag}`
				} as any)
				.returning()
		)[0]!
	const [session] = await db
		.insert(schema.sessions)
		.values({
			userId,
			isGroup: false,
			presetId: minimal!.id,
			lorebookId: book!.id
		} as any)
		.returning()
	const sessionId = session!.id
	const M = await member("Mira")
	const N = await member("Nox")
	const B = await member("Bede")
	const P = await member("Pia")
	const C = await member("Cardo", cardId)
	const seat = (castMemberId: number, characterId: number | null = null) =>
		db
			.insert(schema.sessionCharacters)
			.values({ sessionId, characterId, castMemberId } as any)
	await seat(M.id)
	await seat(N.id)
	await seat(C.id, cardId)
	await db.insert(schema.sessionPersonas).values({
		sessionId,
		personaId: cardId,
		castMemberId: P.id,
		userId
	} as any)
	await db.insert(schema.sessionMessages).values({
		sessionId,
		userId,
		role: "user",
		content: "who is there?"
	} as any)
	await db.insert(schema.lorebookEntries).values(
		characterLoreValues(
			[M, N, B, P].map((m) => ({
				lorebookId: book!.id,
				name: `secret of ${m.name}`,
				keys: "",
				content: `${m.name} keeps a secret.`,
				lorebookBindingId: m.id
			}))
		)
	)
	return { sessionId, book: book!, M, N, B, P, C }
}

/** The reply run's own host — the turn-order run after it builds one too. */
const runHost = () => {
	const own = hosts.filter(
		(h) => h.scope?.specId === "core:spec/story-respond"
	)
	if (own.length === 0)
		throw new Error(
			`no run host among ${JSON.stringify(hosts.map((h) => Object.keys(h.scope ?? {})))}`
		)
	return own.at(-1)!
}

const reply = async (sessionId: number, turn: any) => {
	const { runReply } = await import("$lib/server/utils/runReply")
	return await runReply({
		socket: fakeSocket(userId),
		emitToUser: () => {},
		sessionId,
		userId,
		turn
	})
}

const messagesOf = (sessionId: number) =>
	db
		.select()
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(schema.sessionMessages.id)

/** The character-lore names a host read for one asker, read directly. */
async function loreSeenBy(
	w: Awaited<ReturnType<typeof world>>,
	scope: Record<string, unknown>
) {
	const { createHost } = await import("$lib/server/pipelines/runtime/host")
	const host = createHost(
		db as any,
		{ sessionId: w.sessionId, ...scope } as any
	)
	const rows = (await host.read!(
		"lorebook_entries",
		{ sessionId: w.sessionId, ...scope },
		{
			key: "lore",
			definitionId: "core:query/character-lore@1",
			definitionVersion: 1,
			kind: "query"
		} as any
	)) as any[]
	return rows
		.filter((r) => r.source === "characterLore")
		.map((r) => r.name as string)
		.sort()
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-speaker-lore-cardless-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(db)
	const { createTestUser } = await import("$lib/server/utils/testDb")
	userId = (await createTestUser(db, "speaker-lore-cardless")).id
	const [card] = await db
		.insert(schema.characters)
		.values({ userId, name: "Cardo", description: "A card." } as any)
		.returning()
	cardId = card!.id

	const [textConn] = await db
		.insert(schema.connections)
		.values({ name: "Text", type: "koboldcpp", baseUrl: "http://text" })
		.returning()
	const { ensureConnectionModel } = await import(
		"$lib/server/connections/models"
	)
	const modelId = (await ensureConnectionModel(
		db,
		textConn!.id,
		"default-7b"
	))!.id
	const [sampling] = await db
		.insert(schema.samplingConfigs)
		.values({
			name: "default",
			isImmutable: false,
			values: {
				contextTokens: 8192,
				responseTokens: 200,
				temperature: 0.1
			},
			enabled: ["contextTokens", "responseTokens", "temperature"]
		} as any)
		.returning()
	const { setCapabilityDefault } = await import(
		"$lib/server/connections/capabilityDefaults"
	)
	await setCapabilityDefault(db, "text->text", {
		connectionId: textConn!.id,
		connectionModelId: modelId,
		samplingConfigId: sampling!.id
	})
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("a card-less seat's turn through runReply", () => {
	it("the run's HostScope and lore reads carry the member; the reply row is the member's", async () => {
		const w = await world()
		hosts.length = 0
		const ref = `seated-member:${w.M.id}` as const
		const out = await reply(w.sessionId, { kind: "respond", speaker: ref })
		expect(out.ok, out.error).toBe(true)

		const run = runHost()
		expect(run.scope.currentCharacterId ?? null).toBeNull()
		expect(run.scope.currentCastMemberId).toBe(w.M.id)
		// sessionScope reached the bindings' lore reads.
		expect(run.loreQueries.length).toBeGreaterThan(0)
		for (const q of run.loreQueries) {
			expect(q.currentCharacterId).toBeNull()
			expect(q.currentCastMemberId).toBe(w.M.id)
		}

		const row = (await messagesOf(w.sessionId)).at(-1)!
		expect(row.role).toBe("assistant")
		expect(row.characterId).toBeNull()
		expect(row.castMemberId).toBe(w.M.id)
		expect((row.metadata as any).speaker).toBe(ref)
	})

	it("a carded turn and a narrator turn carry no currentCastMemberId anywhere", async () => {
		const w = await world()
		hosts.length = 0
		const carded = await reply(w.sessionId, {
			kind: "respond",
			characterId: cardId
		})
		expect(carded.ok, carded.error).toBe(true)
		const cardedRun = runHost()
		expect(cardedRun.scope.currentCharacterId).toBe(cardId)
		expect("currentCastMemberId" in cardedRun.scope).toBe(false)
		for (const q of cardedRun.loreQueries)
			expect("currentCastMemberId" in q).toBe(false)

		hosts.length = 0
		const narrator = await reply(w.sessionId, { kind: "respond" })
		expect(narrator.ok, narrator.error).toBe(true)
		const narratorRun = runHost()
		expect(narratorRun.scope.currentCharacterId ?? null).toBeNull()
		expect("currentCastMemberId" in narratorRun.scope).toBe(false)
		for (const q of narratorRun.loreQueries)
			expect("currentCastMemberId" in q).toBe(false)
	})

	it("a regenerate of a card-less seat's row re-drives as that seat", async () => {
		const w = await world()
		const ref = `seated-member:${w.M.id}`
		const [existing] = await db
			.insert(schema.sessionMessages)
			.values({
				sessionId: w.sessionId,
				userId,
				role: "assistant",
				characterId: null,
				castMemberId: w.M.id,
				content: "",
				metadata: { speaker: ref },
				isGenerating: true,
				generationStage: "queued"
			} as any)
			.returning()
		hosts.length = 0
		const out = await reply(w.sessionId, {
			kind: "regenerate",
			messageId: existing!.id
		})
		expect(out.ok, out.error).toBe(true)
		expect(runHost().scope.currentCastMemberId).toBe(w.M.id)
		const row = (
			await db
				.select()
				.from(schema.sessionMessages)
				.where(
					and(
						eq(schema.sessionMessages.id, existing!.id),
						eq(schema.sessionMessages.sessionId, w.sessionId)
					)
				)
		)[0]!
		expect(row.characterId).toBeNull()
		expect(row.castMemberId).toBe(w.M.id)
		expect((row.metadata as any).speaker).toBe(ref)
		expect(row.content).toBe("A voice answers.")
	})
})

describe("the host lorebook_entries read gates a card-less speaker", () => {
	it("M's turn sees M's entry only; the narrator sees the background member's; a player seat's member is seen on every turn", async () => {
		const w = await world()
		const name = (m: { name: string }) => `secret of ${m.name}`
		const asM = await loreSeenBy(w, {
			currentCharacterId: null,
			currentCastMemberId: w.M.id
		})
		expect(asM).toContain(name(w.M))
		expect(asM).not.toContain(name(w.N))
		expect(asM).not.toContain(name(w.B))
		// The player seat's member is visible whoever asks.
		expect(asM).toContain(name(w.P))

		const asNarrator = await loreSeenBy(w, { currentCharacterId: null })
		expect(asNarrator).toContain(name(w.B))
		expect(asNarrator).not.toContain(name(w.M))
		expect(asNarrator).not.toContain(name(w.N))
		expect(asNarrator).toContain(name(w.P))

		const asN = await loreSeenBy(w, {
			currentCharacterId: null,
			currentCastMemberId: w.N.id
		})
		expect(asN).toContain(name(w.N))
		expect(asN).not.toContain(name(w.M))
		expect(asN).toContain(name(w.P))
	})

	it("a wired seated-member speaker naming a card-less seat decides the same way", async () => {
		const w = await world()
		const name = (m: { name: string }) => `secret of ${m.name}`
		const asM = await loreSeenBy(w, { speaker: `seated-member:${w.M.id}` })
		expect(asM).toContain(name(w.M))
		expect(asM).not.toContain(name(w.N))
		expect(asM).not.toContain(name(w.B))
	})
})
