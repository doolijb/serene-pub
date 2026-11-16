/**
 * 🚧 `core:query/unknown-entries@1` through the bindings map: the left-out
 * entries of one speaker, their exclusion verdicts, and the note that says why.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { insertCastMember } from "$lib/server/characters/versions"
import {
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
	await testDb.insert(schema.sessionCharacters).values({
		sessionId,
		characterId: card!.id,
		castMemberId: member,
		position: 0,
		seatedByUserId: user.id,
		isActive: true
	} as never)
	const entry = async () =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId: book!.id,
					typeId: "core:entry/world-lore",
					typeVersion: 1,
					position: ++positions,
					fields: {}
				} as never)
				.returning()
		)[0]!.id
	const mark = (entryId: number) =>
		setEntryCommonKnowledge(db(), {
			userId: user.id,
			entryId,
			notCommonKnowledge: true
		})
	const tie = (entryId: number, kind: "kept_from" | "has_been_there") =>
		writeKnowledgeTie(db(), {
			userId: user.id,
			lorebookId: book!.id,
			castMemberId: member,
			entryId,
			kind
		})
	return { sessionId, member, entry, mark, tie }
}
type World = Awaited<ReturnType<typeof world>>

async function run(w: World, speaker: string | null) {
	const bindings = (
		await import("$lib/server/pipelines/runtime/bindings")
	).coreBindings()
	const log = vi.fn()
	const r = (await bindings["core:query/unknown-entries@1"]!(
		{ scope: { sessionId: w.sessionId }, speaker } as never,
		{ log, read: async () => [] } as never
	)) as any
	expect(r.kind).toBe("ok")
	return { value: r.value, log }
}

const speakerOf = (w: World) => `seated-member:${w.member}`

describe("core:query/unknown-entries@1", () => {
	test("nothing marked: empty outputs and the nothing-marked note", async () => {
		const w = await world()
		await w.entry()
		const r = await run(w, speakerOf(w))
		expect(r.value).toEqual({ main: [], exclusions: [] })
		expect(r.log.mock.calls).toEqual([
			[
				"info",
				"No entries left out: nothing here is marked not common knowledge or kept from anyone"
			]
		])
	})

	test("a marked entry the speaker is not tied to is left out, under all three sources", async () => {
		const w = await world()
		const e = await w.entry()
		await w.mark(e)
		const r = await run(w, speakerOf(w))
		expect(r.value.main).toEqual([{ entryId: e, reason: "Not known by Mira." }])
		expect(r.value.exclusions).toEqual(
			["worldLore", "characterLore", "history"].map((source) => ({
				source,
				id: e,
				reason: "Not known by Mira."
			}))
		)
		expect(r.log.mock.calls).toEqual([
			["info", "1 entry left out: not known by Mira"]
		])
	})

	test("a narrator reads everything and says so", async () => {
		const w = await world()
		await w.mark(await w.entry())
		const r = await run(w, null)
		expect(r.value).toEqual({ main: [], exclusions: [] })
		expect(r.log.mock.calls).toEqual([
			["info", "Reads everything: not one cast member's turn"]
		])
	})

	test("a kept-from tie on an unmarked entry leaves it out", async () => {
		const w = await world()
		const e = await w.entry()
		await w.tie(e, "kept_from")
		const r = await run(w, speakerOf(w))
		expect(r.value.main).toEqual([{ entryId: e, reason: "Kept from Mira." }])
		expect(r.log.mock.calls).toEqual([
			["info", "1 entry left out: kept from Mira"]
		])
	})
})
