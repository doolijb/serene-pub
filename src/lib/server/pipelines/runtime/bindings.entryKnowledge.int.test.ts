/**
 * 🚧 The knowledge filter at the source: the three lore lanes through the real
 * bindings and the host's `lorebook_entries` read leave out what the speaker
 * does not know (`knownToSpeaker`, on by default) and say how many in a note.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { createHost } from "$lib/server/pipelines/runtime/host"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import {
	loadEntryKnowledge,
	setEntryCommonKnowledge,
	writeKnowledgeTie
} from "$lib/server/lorebooks/entryKnowledge"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "bindings-entry-knowledge-secret" }
})
vi.mock("$lib/server/lorebooks/entryKnowledge", async (orig) => {
	const m = await orig<typeof import("$lib/server/lorebooks/entryKnowledge")>()
	return { ...m, loadEntryKnowledge: vi.fn(m.loadEntryKnowledge) }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))
vi.mock("$lib/server/embedding/vectorizationQueue", () => ({
	ensureSessionMessageEmbedded: async () => {},
	autoEnqueueSession: async () => {},
	autoEnqueueLorebook: async () => {}
}))
vi.mock("$lib/server/sockets/utils/broadcastHelpers", () => ({
	emitToUserRedacted: async () => {},
	broadcastToSessionUsers: async () => {}
}))

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-bindings-entry-knowledge-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

const db = () => testDb as unknown as Db
let n = 0
let positions = 0

const LANES = {
	[WORLD_LORE_TYPE_ID]: "core:query/world-lore@1",
	[CHARACTER_LORE_TYPE_ID]: "core:query/character-lore@1",
	[HISTORY_TYPE_ID]: "core:query/history-entries@1"
} as const
type LoreType = keyof typeof LANES

async function world() {
	const suffix = ++n
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `bek-${suffix}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Book ${suffix}` } as never)
		.returning()
	const [card] = await testDb
		.insert(schema.characters)
		.values({ userId: user.id, name: "Mira", description: "…" } as never)
		.returning()
	const member = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:Mira${suffix}}}`,
			characterId: card!.id,
			name: "Mira"
		})
	).member!.id
	const cardless = (
		await insertCastMember(testDb, {
			lorebookId: book!.id,
			binding: `{{char:Ola${suffix}}}`,
			name: "Ola"
		})
	).member!.id
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${suffix}`,
			lorebookId: book!.id
		} as never)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionCharacters).values([
		{
			sessionId,
			characterId: card!.id,
			castMemberId: member,
			position: 0,
			seatedByUserId: user.id,
			isActive: true
		},
		{
			sessionId,
			characterId: null,
			castMemberId: cardless,
			position: 1,
			seatedByUserId: user.id,
			isActive: true
		}
	] as never)
	/** One entry of the type; character lore is bound to `bindTo` (Mira by default, nobody for the narrator's). */
	const entry = async (
		typeId: LoreType,
		bindTo: number | null = member,
		name = `E${positions}`
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					entryInsert({
						typeId,
						lorebookId: book!.id,
						name,
						content: `About ${name}.`,
						constant: true,
						position: ++positions,
						...(typeId === CHARACTER_LORE_TYPE_ID
							? { lorebookBindingId: bindTo }
							: {})
					} as never)
				)
				.returning()
		)[0]!.id
	const mark = (entryId: number) =>
		setEntryCommonKnowledge(db(), {
			userId: user.id,
			entryId,
			notCommonKnowledge: true
		})
	const tie = (
		castMemberId: number,
		entryId: number,
		kind: "kept_from" | "knows"
	) =>
		writeKnowledgeTie(db(), {
			userId: user.id,
			lorebookId: book!.id,
			castMemberId,
			entryId,
			kind
		})
	return { sessionId, member, cardless, cardId: card!.id, entry, mark, tie }
}
type World = Awaited<ReturnType<typeof world>>

/** One turn's scope: Mira's card, the card-less seat, or nobody. */
const scopes = {
	mira: (w: World) => ({ sessionId: w.sessionId, currentCharacterId: w.cardId }),
	cardless: (w: World) => ({
		sessionId: w.sessionId,
		currentCharacterId: null,
		currentCastMemberId: w.cardless
	}),
	nobody: (w: World) => ({ sessionId: w.sessionId, currentCharacterId: null })
}

/** One lane through the real bindings and one host, so lanes can share a run. */
function runner(w: World, scope: Record<string, unknown>) {
	const host = createHost(db(), { sessionId: w.sessionId })
	const bindings = coreBindings()
	return async (
		lane: string,
		params?: Record<string, unknown>
	): Promise<{ ids: number[]; log: ReturnType<typeof vi.fn> }> => {
		const log = vi.fn()
		const r = (await bindings[lane]!(
			{ scope, ...(params ? { params } : {}) } as never,
			{
				log,
				status: () => {},
				countTokens: (t: string) => Math.ceil(t.length / 4),
				read: (name: string, q: unknown) =>
					host.read!(name as never, q as never, {
						key: "n",
						definitionId: lane,
						definitionVersion: 1,
						kind: "query"
					} as never)
			} as never
		)) as any
		expect(r.kind).toBe("ok")
		const ids = (r.value.main as any[])
			.map((c) => c.id)
			.filter((id) => typeof id === "number")
		return { ids, log }
	}
}
let coreBindings: typeof import("$lib/server/pipelines/runtime/bindings").coreBindings
beforeAll(async () => {
	coreBindings = (await import("$lib/server/pipelines/runtime/bindings"))
		.coreBindings
})

const notes = (log: ReturnType<typeof vi.fn>) => log.mock.calls.map((c) => c[1])

describe.each(Object.entries(LANES) as Array<[LoreType, string]>)(
	"%s lane",
	(typeId, lane) => {
		test("a marked entry the speaker is not tied to is absent, and the note counts it", async () => {
			const w = await world()
			const e = await w.entry(typeId)
			await w.mark(e)
			const r = await runner(w, scopes.mira(w))(lane)
			expect(r.ids).not.toContain(e)
			expect(notes(r.log)).toContain("1 entry left out: not known by Mira")
		})

		test("present when the pipeline turns knownToSpeaker off", async () => {
			const w = await world()
			const e = await w.entry(typeId)
			await w.mark(e)
			const r = await runner(w, scopes.mira(w))(lane, {
				knownToSpeaker: false
			})
			expect(r.ids).toContain(e)
			expect(notes(r.log).join("\n")).not.toMatch(/left out/)
		})

		test("present for a run that speaks as nobody, with the reads-all note", async () => {
			const w = await world()
			const e = await w.entry(typeId, null)
			await w.mark(e)
			const r = await runner(w, scopes.nobody(w))(lane)
			expect(r.ids).toContain(e)
			expect(notes(r.log)).toContain(
				"Reads everything: not one cast member's turn"
			)
		})

		test("absent for a card-less seat's turn, present once tied", async () => {
			const w = await world()
			const e = await w.entry(typeId, w.cardless)
			await w.mark(e)
			expect((await runner(w, scopes.cardless(w))(lane)).ids).not.toContain(e)
			await w.tie(w.cardless, e, "knows")
			const r = await runner(w, scopes.cardless(w))(lane)
			expect(r.ids).toContain(e)
			expect(notes(r.log)).toContain("No entries left out for Ola")
		})

		test("an unmarked entry a kept-from tie wins for is absent", async () => {
			const w = await world()
			const e = await w.entry(typeId)
			await w.tie(w.member, e, "kept_from")
			const r = await runner(w, scopes.mira(w))(lane)
			expect(r.ids).not.toContain(e)
			expect(notes(r.log)).toContain("1 entry left out: kept from Mira")
		})

		test("nothing marked says so", async () => {
			const w = await world()
			const e = await w.entry(typeId)
			const r = await runner(w, scopes.mira(w))(lane)
			expect(r.ids).toContain(e)
			expect(notes(r.log)).toContain(
				"No entries left out: nothing here is marked not common knowledge or kept from anyone"
			)
		})
	}
)

test("two lanes in one run load the knowledge once", async () => {
	const w = await world()
	await w.mark(await w.entry(WORLD_LORE_TYPE_ID))
	const run = runner(w, scopes.mira(w))
	const spy = vi.mocked(loadEntryKnowledge)
	spy.mockClear()
	await run(LANES[WORLD_LORE_TYPE_ID])
	await run(LANES[CHARACTER_LORE_TYPE_ID])
	await run(LANES[HISTORY_TYPE_ID])
	expect(spy).toHaveBeenCalledTimes(1)
})
