/**
 * Knowledge ties (a cast member's standing with an entry: `knowledge_kind` set)
 * are a kind of their own: no reader of ordinary ties admits one. One fixture;
 * each reader is asserted to still read the ordinary rows beside the knowledge
 * rows, so the test proves the filter and not an empty read.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { insertCastMember } from "$lib/server/characters/versions"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { writeKnowledgeTie } from "./entryKnowledge"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string
let n = 0

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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-knowledge-hidden-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const fakeSocket = (userId: number) =>
	({
		user: { id: userId, isAdmin: false },
		io: { to: () => ({ emit: () => {} }) }
	}) as any
const noopEmit = () => {}

/** Ana and Bo (cards), places Vault and Cellar, a session on the book; Ana → Bo, Ana → Vault (ordinary) and knowledge ties. */
async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `kn-hidden-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user.id, name: `Hidden ${n}` })
		.returning()
	const lorebookId = book!.id
	let position = 0
	const place = async (title: string) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId,
					typeId: LOCATION_TYPE_ID,
					typeVersion: 1,
					position: ++position,
					title
				})
				.returning()
		)[0]!
	const vault = await place("Vault")
	const cellar = await place("Cellar")
	const member = async (name: string) => {
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name, description: "…" } as never)
			.returning()
		const made = (
			await insertCastMember(testDb, {
				lorebookId,
				binding: `{{char:${name}${n}}}`,
				characterId: card!.id,
				name
			})
		).member!
		return { id: made.id, cardId: card!.id }
	}
	const ana = await member("Ana")
	const bo = await member("Bo")
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${n}`,
			lorebookId
		})
		.returning()
	await testDb.insert(schema.sessionCharacters).values(
		[ana, bo].map((m, i) => ({
			sessionId: session!.id,
			characterId: m.cardId,
			position: i
		})) as never
	)
	const ordinary = async (over: Record<string, unknown>) =>
		(
			await testDb
				.insert(schema.narrativeRelationships)
				.values({
					lorebookId,
					visibility: "acknowledged",
					status: "active",
					relationshipType: "ally",
					...over
				} as never)
				.returning()
		)[0]!
	const knowledge = (
		castMemberId: number,
		entryId: number,
		kind: "was_told" | "knows" | "has_been_there" | "kept_from",
		over: { lorebookId?: number; historyEntryId?: number | null } = {}
	) =>
		writeKnowledgeTie(db(), {
			userId: user.id,
			lorebookId: over.lorebookId ?? lorebookId,
			castMemberId,
			entryId,
			kind,
			historyEntryId: over.historyEntryId ?? null
		})
	const castTie = await ordinary({ fromNodeId: ana.id, toNodeId: bo.id })
	const entryLink = await ordinary({
		fromNodeId: ana.id,
		toEntryId: vault.id,
		relationshipType: "guards"
	})
	const told = await knowledge(ana.id, vault.id, "was_told")
	const kept = await knowledge(ana.id, vault.id, "kept_from")
	return {
		user,
		lorebookId,
		vault,
		cellar,
		ana,
		bo,
		session: session!,
		castTie,
		entryLink,
		told,
		kept,
		ordinary,
		knowledge
	}
}
type World = Awaited<ReturnType<typeof world>>

describe("knowledge ties stay out of every tie reader", () => {
	let w: World
	beforeAll(async () => {
		w = await world()
	})

	test("the graph list", async () => {
		const { narrativeGraphListHandler } = await import(
			"../sockets/narrativeGraph"
		)
		const list = await narrativeGraphListHandler.handler(
			fakeSocket(w.user.id),
			{ lorebookId: w.lorebookId } as any,
			noopEmit
		)
		const ids = list.relationships.map((r) => r.id)
		expect(ids).toContain(w.castTie.id)
		expect(ids).toContain(w.entryLink.id)
		expect(ids).not.toContain(w.told)
		expect(ids).not.toContain(w.kept)
	})

	test("the graph's update and delete leave a knowledge tie as it was", async () => {
		const {
			narrativeGraphUpdateRelationshipHandler,
			narrativeGraphDeleteRelationshipHandler
		} = await import("../sockets/narrativeGraph")
		const rowOf = () =>
			db().query.narrativeRelationships.findFirst({
				where: eq(schema.narrativeRelationships.id, w.told)
			})
		const before = await rowOf()
		expect(before?.knowledgeKind).toBe("was_told")
		await Promise.resolve(
			narrativeGraphUpdateRelationshipHandler.handler(
				fakeSocket(w.user.id),
				{
					relationship: { id: w.told, relationshipType: "ally" }
				} as any,
				noopEmit
			)
		).catch(() => {})
		await Promise.resolve(
			narrativeGraphDeleteRelationshipHandler.handler(
				fakeSocket(w.user.id),
				{ id: w.told } as any,
				noopEmit
			)
		).catch(() => {})
		const after = await rowOf()
		expect(after?.relationshipType).toBe(before?.relationshipType)
		expect(after?.status).toBe(before?.status)
		expect(after?.updatedAt).toEqual(before?.updatedAt)
	})

	test("the ranked ties and the ties in the prompt (cast to cast only)", async () => {
		const { buildGraphRelationshipRows } = await import(
			"$lib/server/utils/graphContextFormatter"
		)
		const rows =
			(await buildGraphRelationshipRows({
				sessionId: w.session.id,
				lorebookId: w.lorebookId,
				speakerCharacterId: w.ana.cardId,
				db: testDb as any
			})) ?? []
		const ids = rows.map((r: any) => r.id)
		expect(ids).toContain(w.castTie.id)
		expect(ids).not.toContain(w.told)
		expect(ids).not.toContain(w.kept)
	})

	test("the link hop and withLinks", async () => {
		const { readGraphEntryLinks, loreLinkRowsOf } = await import(
			"$lib/server/utils/graphEntryLinks"
		)
		const links = (await readGraphEntryLinks(db(), w.session.id)) ?? []
		const ids = links.map((l) => l.id)
		expect(ids).toContain(w.entryLink.id)
		expect(ids).not.toContain(w.told)
		expect(ids).not.toContain(w.kept)
		// An entry-to-entry way beside them is read as before.
		const way = await w.ordinary({
			fromEntryId: w.vault.id,
			toEntryId: w.cellar.id,
			relationshipType: "leads to",
			reverseRelationshipType: "leads from"
		})
		const again = (await readGraphEntryLinks(db(), w.session.id)) ?? []
		expect(
			loreLinkRowsOf(w.vault.id, again).map((l) => l.linkType)
		).toEqual(["leads to"])
		expect(again.map((l) => l.id)).toContain(way.id)
	})

	test("the Timeline: a dated knowledge tie alone does not date the book", async () => {
		const { holdsSomethingDated } = await import("./timeline")
		const other = await world()
		// A history entry in ANOTHER book dates the tie, so this book holds none of its own.
		const [away] = await testDb
			.insert(schema.lorebooks)
			.values({ userId: other.user.id, name: `Away ${n}` })
			.returning()
		const [history] = await testDb
			.insert(schema.lorebookEntries)
			.values({
				lorebookId: away!.id,
				typeId: HISTORY_TYPE_ID,
				typeVersion: 1,
				position: 1,
				fields: { year: 1200 }
			})
			.returning()
		await testDb
			.update(schema.narrativeRelationships)
			.set({ historyEntryId: history!.id })
			.where(eq(schema.narrativeRelationships.id, other.told))
		expect(await holdsSomethingDated(db(), other.lorebookId)).toBe(false)
		await testDb
			.update(schema.narrativeRelationships)
			.set({ historyEntryId: history!.id })
			.where(eq(schema.narrativeRelationships.id, other.entryLink.id))
		expect(await holdsSomethingDated(db(), other.lorebookId)).toBe(true)
	})

	test("the embeddings queue counts cast edges only", async () => {
		const { countUnembedded } = await import(
			"$lib/server/embedding/vectorizationQueue"
		)
		const fresh = await world()
		const before = await countUnembedded("model-x")
		await fresh.knowledge(fresh.bo.id, fresh.cellar.id, "knows")
		await fresh.knowledge(fresh.bo.id, fresh.cellar.id, "has_been_there")
		expect(await countUnembedded("model-x")).toBe(before)
		// The ordinary cast edge is counted: the count moves with it.
		await fresh.ordinary({
			fromNodeId: fresh.bo.id,
			toNodeId: fresh.ana.id
		})
		expect(await countUnembedded("model-x")).toBe(before + 1)
	})

	test("ruleset ties", async () => {
		const { tiesBetween, rulesetSessionOf } = await import(
			"../rulesets/read"
		)
		const session = (await rulesetSessionOf(db(), w.session.id))!
		// A link to a place reads between the cast and the place's view.
		const key = (cardId: number) => `character:${cardId}`
		const ties = await tiesBetween(db(), session, [
			{
				key: key(w.ana.cardId),
				owner: { kind: "session_cast", id: w.ana.cardId }
			},
			{
				key: key(w.bo.cardId),
				owner: { kind: "session_cast", id: w.bo.cardId }
			},
			{
				key: "place:vault",
				owner: { kind: "session_location", id: w.vault.id }
			}
		] as any)
		const types = ties.map((t) => t.type)
		expect(types).toContain("ally")
		expect(types).toContain("guards")
		expect(types).not.toContain("was_told")
		expect(types).not.toContain("kept_from")
	})

	test("duplicate detection", async () => {
		const { findDuplicateCandidates } = await import(
			"$lib/server/utils/duplicateBindingDetection"
		)
		const fresh = await world()
		// Ana and Bo are two real characters: never duplicates, tie or no tie. The
		// pin is that a knowledge row neither throws nor changes the answer.
		expect(await findDuplicateCandidates(fresh.lorebookId, db())).toEqual(
			await findDuplicateCandidates(w.lorebookId, db())
		)
	})

	test("an ordinary link with the words of a knowledge tie is not refused for it", async () => {
		const { findLinkedThatWay } = await import(
			"$lib/server/utils/relationshipGuards"
		)
		const ends = {
			fromNodeId: w.ana.id,
			fromEntryId: null,
			toNodeId: null,
			toEntryId: w.vault.id
		}
		const saying = (relationshipType: string) => ({
			lorebookId: w.lorebookId,
			branchId: null,
			historyEntryId: null,
			title: "",
			relationshipType,
			reverseRelationshipType: null
		})
		// The same words and ends as the knowledge tie: not a collision.
		expect(
			await findLinkedThatWay(db(), ends, saying("was_told"))
		).toBeNull()
		// The ordinary row beside them still is one.
		expect(await findLinkedThatWay(db(), ends, saying("guards"))).toBe(
			w.entryLink.id
		)
	})
})

describe("the session's notes", () => {
	test("a knowledge tie kept in the notes is no link item and writes no notes", async () => {
		const x = await world()
		const { ownBookFor } = await import("./ownBook")
		const notes = await ownBookFor(db(), x.session.id)
		expect(notes.overlayOf).toBe(x.lorebookId)
		const { writtenNotesOf } = await import("./notesShown")
		await x.knowledge(x.ana.id, x.cellar.id, "knows", {
			lorebookId: notes.id
		})
		expect((await writtenNotesOf(db(), [notes.id])).has(notes.id)).toBe(
			false
		)

		const { overlayItemsOf } = await import("./ownBook")
		expect(
			(await overlayItemsOf(db(), x.session.id)).filter(
				(i) => i.kind === "link"
			)
		).toEqual([])

		// An ordinary link of the notes beside it is still an item.
		const way = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: notes.id,
				fromEntryId: x.vault.id,
				toEntryId: x.cellar.id,
				relationshipType: "leads to"
			} as never)
			.returning()
		const items = (await overlayItemsOf(db(), x.session.id)).filter(
			(i) => i.kind === "link"
		)
		expect(items.map((i: any) => i.linkId)).toEqual([way[0]!.id])
		expect((await writtenNotesOf(db(), [notes.id])).has(notes.id)).toBe(
			true
		)
	})
})
