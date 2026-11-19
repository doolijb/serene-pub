/**
 * 🚧 The core tools judge lore like the run's other reads: `search_entries`,
 * `get_entry` and `read_summary` drop an entry the speaking card does not
 * know, through the real host's `lorebook_entries` read. No speaker, no drop.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { defineAttributeSheet } from "@serene-pub/sdk"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { genreKeeping } from "$lib/server/utils/testGenre"
import { insertCastMember } from "$lib/server/characters/versions"
import { entryInsert } from "$lib/server/utils/lorebookEntries"
import { createHost } from "$lib/server/pipelines/runtime/host"
import {
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import {
	setEntryCommonKnowledge,
	writeKnowledgeTie
} from "$lib/server/lorebooks/entryKnowledge"
import {
	getEntry,
	readSummary,
	searchEntries
} from "$lib/server/pipelines/runtime/tools/coreTools"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "core-tools-knowledge" }
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
		path.join(os.tmpdir(), "serene-pub-vitest-coretools-knowledge-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 120_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
	await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {})
})

const LOCATION_SLOT = "core:slot/location@1"
const WALKERS = "test:genre/coretools-knowledge-walkers"
genreKeeping(WALKERS, {
	name: { en: "Walkers" },
	family: "test",
	sheets: [
		defineAttributeSheet("test:sheet/coretools-knowledge-walkers@1", {
			label: { en: "Walkers" },
			slots: [{ id: LOCATION_SLOT, appliesTo: ["world", "cast"] }]
		})
	],
	events: {}
})

const db = () => testDb as unknown as Db
let n = 0
let positions = 0

async function world() {
	const suffix = ++n
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `ctk-${suffix}`)
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
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${suffix}`,
			lorebookId: book!.id,
			genreId: WALKERS
		} as never)
		.returning()
	const sessionId = session!.id
	await testDb.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: card!.id,
		castMemberId: member,
		position: 0,
		seatedByUserId: user.id,
		isActive: true
	} as never)
	const entry = async (typeId: string, name: string) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					entryInsert({
						typeId,
						lorebookId: book!.id,
						name,
						content: `About ${name}.`,
						position: ++positions
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
	return {
		sessionId,
		member,
		lorebookId: book!.id,
		cardId: card!.id,
		userId: user.id,
		entry,
		mark
	}
}
type World = Awaited<ReturnType<typeof world>>

/** The tool context the host hands a tool: its own read, the run's speaker. */
function toolCtx(w: World, currentCharacterId: number | null) {
	const host = createHost(db(), { sessionId: w.sessionId })
	return {
		sessionId: w.sessionId,
		currentCharacterId,
		read: (table: string, q: unknown) =>
			host.read!(table as never, q as never, {
				key: "n",
				definitionId: "core:tool",
				definitionVersion: 1,
				kind: "query"
			} as never)
	} as never
}

/** What the three tools say about `name`/`id`: found by search, summary, and get. */
async function seen(ctx: never, name: string, id: number) {
	const search: any = await searchEntries.run({ query: name }, ctx)
	const summary: any = await readSummary.run({ kind: "world", name }, ctx)
	const got = await getEntry.run({ id }, ctx).then(
		() => true,
		(e) => {
			expect(String(e.message)).toMatch(new RegExp(`no entry ${id}`))
			return false
		}
	)
	return {
		search: search.entries.some((e: any) => e.id === id),
		summary: summary.summaries.some((e: any) => e.id === id),
		get: got
	}
}

describe("core tools and the knowledge judgement", () => {
	test("a marked, untied entry is not found, summarized or fetched for the speaking card", async () => {
		const w = await world()
		const secret = await w.entry(WORLD_LORE_TYPE_ID, "Vaultsecret")
		await w.mark(secret)
		expect(await seen(toolCtx(w, w.cardId), "Vaultsecret", secret)).toEqual({
			search: false,
			summary: false,
			get: false
		})
	})

	test("with no speaker, the same entry is found by all three", async () => {
		const w = await world()
		const secret = await w.entry(WORLD_LORE_TYPE_ID, "Vaultsecret")
		await w.mark(secret)
		expect(await seen(toolCtx(w, null), "Vaultsecret", secret)).toEqual({
			search: true,
			summary: true,
			get: true
		})
	})

	test("tied with 'knows', or not marked, it is found for the card", async () => {
		const w = await world()
		const tied = await w.entry(WORLD_LORE_TYPE_ID, "Tiedsecret")
		await w.mark(tied)
		await writeKnowledgeTie(db(), {
			userId: w.userId,
			lorebookId: w.lorebookId,
			castMemberId: w.member,
			entryId: tied,
			kind: "knows"
		})
		const open = await w.entry(WORLD_LORE_TYPE_ID, "Opentale")
		const all = { search: true, summary: true, get: true }
		expect(await seen(toolCtx(w, w.cardId), "Tiedsecret", tied)).toEqual(all)
		expect(await seen(toolCtx(w, w.cardId), "Opentale", open)).toEqual(all)
	})

	test("the room the card stands in is still found though marked; another marked room is not", async () => {
		const w = await world()
		const vault = await w.entry(LOCATION_TYPE_ID, "Vaultroom")
		const cellar = await w.entry(LOCATION_TYPE_ID, "Cellarroom")
		await w.mark(vault)
		await w.mark(cellar)
		const { applyChange } = await import("$lib/server/state/write")
		await applyChange(
			db(),
			{ sessionId: w.sessionId, updatedBy: "user" },
			{
				owner: { kind: "seated_member", id: w.member },
				slotId: LOCATION_SLOT,
				value: "Vaultroom"
			} as never
		)
		const ctx = toolCtx(w, w.cardId)
		const found: any = await searchEntries.run({ query: "room" }, ctx)
		expect(found.entries.map((e: any) => e.id)).toEqual([vault])
		expect(cellar).toBeGreaterThan(0)
	})
})
