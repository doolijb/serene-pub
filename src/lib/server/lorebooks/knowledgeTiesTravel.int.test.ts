/**
 * Entry knowledge travels with the lorebook: the mark and every knowledge tie
 * (with its kind and its words) survive a file out and back in, the timeless
 * copy and a duplicate. A file from before carries neither and imports as
 * ordinary; a file row that says a knowledge kind on the wrong ends is skipped,
 * never stored as an ordinary tie.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	WORLD_LORE_TYPE_ID,
	entryInsert
} from "$lib/server/utils/lorebookEntries"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { insertCastMember } from "$lib/server/characters/versions"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { makeTimelessCopy } from "./timelessCopy"
import { setEntryCommonKnowledge, writeKnowledgeTie } from "./entryKnowledge"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let n = 0

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-knowledge-travel-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const as = (id: number) => ({ user: { id }, io: {} }) as any
const quiet = (async () => {}) as any
const db = () => testDb as unknown as Db

/** One book: Ana and Bo, entries Vault and Cellar (Vault marked), a history entry, and the ties. */
async function seed() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `kn-travel-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Travel ${n}` })
		.returning()
	const lorebookId = book!.id
	let position = 0
	const entry = async (typeId: string, name: string, extra = {}) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values(
					entryInsert({
						typeId,
						lorebookId,
						position: position++,
						name,
						content: `${name}.`,
						...extra
					} as any)
				)
				.returning()
		)[0]!
	const vault = await entry(WORLD_LORE_TYPE_ID, "Vault")
	const cellar = await entry(WORLD_LORE_TYPE_ID, "Cellar")
	const history = await entry(HISTORY_TYPE_ID, "", { year: 1200 })
	const member = async (name: string) =>
		(
			await insertCastMember(testDb, {
				lorebookId,
				binding: `{{char:${name}${n}}}`,
				name
			})
		).member!.id
	const ana = await member("Ana")
	const bo = await member("Bo")
	await setEntryCommonKnowledge(db(), {
		userId: user.id,
		entryId: vault.id,
		notCommonKnowledge: true
	})
	const tie = (
		castMemberId: number,
		entryId: number,
		kind: "was_told" | "knows" | "has_been_there" | "kept_from",
		historyEntryId?: number
	) =>
		writeKnowledgeTie(db(), {
			userId: user.id,
			lorebookId,
			castMemberId,
			entryId,
			kind,
			historyEntryId: historyEntryId ?? null
		})
	await tie(ana, vault.id, "was_told")
	await tie(ana, vault.id, "kept_from")
	await tie(bo, cellar.id, "knows", history.id)
	// An ordinary cast-to-cast tie beside them.
	await testDb.insert(schema.narrativeRelationships).values({
		lorebookId,
		fromNodeId: ana,
		toNodeId: bo,
		relationshipType: "ally"
	})
	return { user, lorebookId, vault, cellar, history, ana, bo }
}
type Fx = Awaited<ReturnType<typeof seed>>

/** A book's ties as comparable lines, with each end named. */
async function tiesOf(lorebookId: number) {
	const rows = await testDb
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, lorebookId))
		.orderBy(asc(schema.narrativeRelationships.id))
	const members = new Map(
		(
			await testDb
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
		).map((m) => [m.id, m.name])
	)
	const entries = new Map(
		(
			await testDb
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
		).map((e) => [e.id, e])
	)
	return rows
		.map((r) => ({
			from:
				r.fromNodeId != null
					? members.get(r.fromNodeId)
					: r.fromEntryId,
			to:
				r.toNodeId != null
					? members.get(r.toNodeId)
					: entries.get(r.toEntryId!)?.title,
			type: r.relationshipType,
			kind: r.knowledgeKind,
			dated: r.historyEntryId != null
		}))
		.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

const KNOWLEDGE = [
	{
		from: "Ana",
		to: "Vault",
		type: "kept_from",
		kind: "kept_from",
		dated: false
	},
	{
		from: "Ana",
		to: "Vault",
		type: "was_told",
		kind: "was_told",
		dated: false
	},
	{ from: "Bo", to: "Cellar", type: "knows", kind: "knows", dated: true }
]
const ALLY = { from: "Ana", to: "Bo", type: "ally", kind: null, dated: false }
const ALL = [ALLY, ...KNOWLEDGE].sort((a, b) =>
	JSON.stringify(a).localeCompare(JSON.stringify(b))
)

const marksOf = async (lorebookId: number) =>
	Object.fromEntries(
		(
			await testDb
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
		)
			.filter((e) => e.typeId !== HISTORY_TYPE_ID)
			.map((e) => [e.title, e.notCommonKnowledge])
	)

async function stranger() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	return (await createTestUser(testDb, `kn-travel-in-${++n}`)).id
}

async function exported(fx: Fx) {
	const { buildLorebookExportData } = await import(
		"$lib/server/utils/lorebookExportBuilder"
	)
	const { specBookWithGraph } = await buildLorebookExportData(
		fx.lorebookId,
		fx.user.id,
		{}
	)
	return JSON.parse(JSON.stringify(specBookWithGraph)) as any
}

/** Imported by someone else: the same person's second copy of one file is refused as already there. */
async function importFile(userId: number, file: unknown) {
	const { lorebookImportHandler } = await import("../sockets/lorebooks")
	const res = await lorebookImportHandler.handler(
		as(userId),
		{ lorebookJson: JSON.stringify(file) },
		quiet
	)
	return res.lorebook!.id as number
}

describe("export and import", () => {
	test("the mark and every knowledge tie come back with kind and words", async () => {
		const fx = await seed()
		const file = await exported(fx)
		const rels = file.extensions.serenepub.narrativeGraph.relationships
		expect(rels.filter((r: any) => r.knowledgeKind)).toHaveLength(3)
		expect(
			rels.find((r: any) => r.relationshipType === "ally").knowledgeKind
		).toBeUndefined()
		const bags = file.entries.map((e: any) => e.extensions.serenepub)
		expect(
			bags.filter((b: any) => b.notCommonKnowledge === true)
		).toHaveLength(1)

		const copyId = await importFile(await stranger(), file)
		expect(await tiesOf(copyId)).toEqual(ALL)
		expect(await marksOf(copyId)).toMatchObject({
			Vault: true,
			Cellar: false
		})
	})

	test("a file from before (no kind, no mark) imports as ordinary, unmarked", async () => {
		const fx = await seed()
		const file = await exported(fx)
		for (const r of file.extensions.serenepub.narrativeGraph.relationships)
			delete r.knowledgeKind
		for (const e of file.entries)
			delete e.extensions.serenepub.notCommonKnowledge

		const copyId = await importFile(await stranger(), file)
		const ties = await tiesOf(copyId)
		expect(ties.every((t) => t.kind === null)).toBe(true)
		expect(ties).toHaveLength(4)
		expect(
			Object.values(await marksOf(copyId)).every((m) => m === false)
		).toBe(true)
	})

	test("a mark that is not a literal true does not mark", async () => {
		const fx = await seed()
		const file = await exported(fx)
		for (const e of file.entries)
			if (e.extensions.serenepub.notCommonKnowledge === true)
				e.extensions.serenepub.notCommonKnowledge = "true"
		const copyId = await importFile(await stranger(), file)
		expect(
			Object.values(await marksOf(copyId)).every((m) => m === false)
		).toBe(true)
	})

	test("a knowledge kind on entry-to-entry ends is skipped, never an ordinary tie", async () => {
		const fx = await seed()
		const file = await exported(fx)
		const rels = file.extensions.serenepub.narrativeGraph.relationships
		const toEntry = rels.find((r: any) => r.knowledgeKind).to
		const other = file.entries
			.map((e: any) => e.extensions.serenepub.entryLocalId)
			.filter(
				(id: unknown) => typeof id === "number" && id !== toEntry.entry
			)[0]
		rels.push({
			from: { kind: "entry", entry: other },
			to: toEntry,
			relationshipType: "knows",
			knowledgeKind: "knows",
			description: "",
			visibility: "normal",
			status: "active",
			reason: null,
			historyEntryLocalId: null,
			sceneLocalId: null
		})
		const copyId = await importFile(await stranger(), file)
		expect(await tiesOf(copyId)).toEqual(ALL)
	})
})

describe("timeless copy and duplicate", () => {
	test("the timeless copy keeps the mark and both kinds between one pair", async () => {
		const fx = await seed()
		const copy = await testDb.transaction((tx) =>
			makeTimelessCopy(tx as any, {
				sourceId: fx.lorebookId,
				branchId: null,
				userId: fx.user.id,
				name: "Timeless"
			})
		)
		const ties = await tiesOf(copy.id)
		// Undated: the history entry is not kept, so the dated tie's date goes with it.
		expect(ties.map((t) => ({ ...t, dated: false }))).toEqual(
			ALL.map((t) => ({ ...t, dated: false }))
		)
		expect(ties.filter((t) => t.to === "Vault")).toHaveLength(2)
		expect(await marksOf(copy.id)).toMatchObject({
			Vault: true,
			Cellar: false
		})
	})

	test("a duplicate keeps the mark and every tie", async () => {
		const fx = await seed()
		const { lorebooksDuplicateHandler } = await import(
			"../sockets/lorebooks"
		)
		const res = await lorebooksDuplicateHandler.handler(
			as(fx.user.id),
			{ lorebookId: fx.lorebookId },
			quiet
		)
		const id = (res as any).lorebook.id as number
		expect(await tiesOf(id)).toEqual(ALL)
		expect(await marksOf(id)).toMatchObject({ Vault: true, Cellar: false })
	})
})
