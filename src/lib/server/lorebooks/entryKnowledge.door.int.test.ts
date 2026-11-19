/**
 * 🚧 The knowledge door's helpers on a real database: the judged read
 * (`readBookKnowledge`), the hand switch (`setHandKnowledgeTie`) and the bulk
 * mark (`setBookCommonKnowledge`), and their owner-only gate.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { insertCastMember } from "$lib/server/characters/versions"
import {
	loadEntryKnowledge,
	readBookKnowledge,
	setBookCommonKnowledge,
	setHandKnowledgeTie,
	writeKnowledgeTie
} from "./entryKnowledge"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-kn4a-door-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

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
	const user = await createTestUser(testDb, `door-${suffix}`)
	const other = await createTestUser(testDb, `door-other-${suffix}`)
	const [adminRow] = await testDb
		.insert(schema.users)
		.values({ username: `door-admin-${suffix}`, isAdmin: true } as never)
		.returning()
	const admin = adminRow!
	const guest = await createTestUser(testDb, `door-guest-${suffix}`)
	const mkBook = async (userId: number, name: string, sessionId?: number) =>
		(
			await testDb
				.insert(schema.lorebooks)
				.values({ userId, name, ...(sessionId ? { sessionId } : {}) } as never)
				.returning()
		)[0]!
	const book = await mkBook(user.id, `Book ${suffix}`)
	const elsewhere = await mkBook(user.id, `Elsewhere ${suffix}`)
	const members: Record<string, number> = {}
	for (const name of ["Ana", "Bo"]) {
		const [card] = await testDb
			.insert(schema.characters)
			.values({ userId: user.id, name, description: "…" } as never)
			.returning()
		members[name] = (
			await insertCastMember(testDb, {
				lorebookId: book.id,
				binding: `{{char:${name}${suffix}}}`,
				characterId: card!.id,
				name
			})
		).member!.id
	}
	const [session] = await testDb
		.insert(schema.sessions)
		.values({
			userId: user.id,
			isGroup: true,
			name: `Run ${suffix}`,
			lorebookId: book.id
		} as never)
		.returning()
	const sessionId = session!.id
	const notes = await mkBook(user.id, `Notes ${suffix}`, sessionId)
	await testDb
		.insert(schema.sessionGuests)
		.values({ sessionId, userId: guest.id } as never)
	await testDb.insert(schema.sessionCharacters).values(
		["Ana", "Bo"].map((name, position) => ({
			sessionId,
			characterId: undefined,
			castMemberId: members[name]!,
			position,
			seatedByUserId: user.id,
			isActive: true
		})) as never
	)
	const entry = async (
		lorebookId: number,
		fields: Record<string, unknown> = {},
		typeId = "core:entry/world-lore"
	) =>
		(
			await testDb
				.insert(schema.lorebookEntries)
				.values({
					lorebookId,
					typeId,
					typeVersion: 1,
					position: ++positions,
					fields
				} as never)
				.returning()
		)[0]!.id
	const mark = (ids: number[], notCommonKnowledge = true, userId = user.id) =>
		setBookCommonKnowledge(db(), {
			userId,
			lorebookId: book.id,
			entryIds: ids,
			notCommonKnowledge
		})
	const tie = (
		who: string,
		entryId: number,
		kind: Parameters<typeof writeKnowledgeTie>[1]["kind"],
		over: Partial<Parameters<typeof writeKnowledgeTie>[1]> = {}
	) =>
		writeKnowledgeTie(db(), {
			userId: user.id,
			lorebookId: book.id,
			castMemberId: members[who]!,
			entryId,
			kind,
			...over
		})
	const relationship = async (who: string, entryId: number, type: string) =>
		(
			await testDb
				.insert(schema.narrativeRelationships)
				.values({
					lorebookId: book.id,
					fromNodeId: members[who]!,
					toEntryId: entryId,
					relationshipType: type,
					status: "active"
				} as never)
				.returning()
		)[0]!.id
	const hand = (who: string, entryId: number, h: "knows" | "kept_from" | null) =>
		setHandKnowledgeTie(db(), {
			userId: user.id,
			lorebookId: book.id,
			castMemberId: members[who]!,
			entryId,
			hand: h
		})
	const readPair = async (who: string, entryId: number) => {
		const r = await readBookKnowledge(db(), {
			userId: user.id,
			lorebookId: book.id,
			entryId,
			castMemberId: members[who]!,
			branchId: null,
			moment: null
		})
		return r.rows[0]!
	}
	const live = async (who: string, entryId: number) =>
		testDb
			.select()
			.from(schema.narrativeRelationships)
			.where(
				and(
					eq(schema.narrativeRelationships.fromNodeId, members[who]!),
					eq(schema.narrativeRelationships.toEntryId, entryId),
					eq(schema.narrativeRelationships.status, "active")
				)
			)
	return {
		user,
		other,
		admin,
		guest,
		book,
		notes,
		elsewhere,
		members,
		sessionId,
		entry,
		mark,
		tie,
		relationship,
		hand,
		readPair,
		live
	}
}

describe("readBookKnowledge: the judged result", () => {
	test("an ordinary relationship knows, with no kind", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.mark([e])
		await w.relationship("Ana", e, "friend of")
		const row = await w.readPair("Ana", e)
		expect(row.known).toBe(true)
		expect(row.winner).toMatchObject({
			kind: null,
			relationshipType: "friend of",
			hand: false,
			date: null
		})
		expect(row.hand).toBeNull()
	})

	test("a hand kept_from beats a later dated was_told, and says what it overrules", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const h = await w.entry(w.book.id, { year: 12 }, HISTORY_TYPE_ID)
		const kept = await w.tie("Ana", e, "kept_from")
		const told = await w.tie("Ana", e, "was_told", { historyEntryId: h })
		const row = await w.readPair("Ana", e)
		expect(row.known).toBe(false)
		expect(row.winner).toMatchObject({
			tieId: kept,
			kind: "kept_from",
			hand: true
		})
		expect(row.hand).toBe("kept_from")
		expect(row.overruled).toMatchObject({
			tieId: told,
			kind: "was_told",
			hand: false,
			date: { year: 12, month: null, day: null }
		})
	})

	test("overruled is null with no hand tie, and with a hand tie alone", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const f = await w.entry(w.book.id)
		await w.relationship("Ana", e, "friend of")
		expect((await w.readPair("Ana", e)).overruled).toBeNull()
		await w.tie("Ana", f, "kept_from")
		expect((await w.readPair("Ana", f)).overruled).toBeNull()
	})

	test("the winner's date is sent only while the book's Timeline is on", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const h = await w.entry(w.book.id, { year: 12 }, HISTORY_TYPE_ID)
		await w.tie("Ana", e, "was_told", { historyEntryId: h })
		type At = { year: number; month: null; day: null } | null
		const at = async (moment: At) =>
			(
				await readBookKnowledge(db(), {
					userId: w.user.id,
					lorebookId: w.book.id,
					entryId: e,
					castMemberId: w.members.Ana!,
					branchId: null,
					moment
				})
			).rows[0]!.winner?.date
		const YEAR_20 = { year: 20, month: null, day: null }
		await testDb
			.update(schema.lorebooks)
			.set({ timelineEnabled: true } as never)
			.where(eq(schema.lorebooks.id, w.book.id))
		expect(await at(YEAR_20)).toEqual({ year: 12, month: null, day: null })
		expect(await at(null)).toEqual({ year: 12, month: null, day: null })
		await testDb
			.update(schema.lorebooks)
			.set({ timelineEnabled: false } as never)
			.where(eq(schema.lorebooks.id, w.book.id))
		expect(await at(YEAR_20)).toBeNull()
		// A book with no timeline is read with no moment: still no date.
		expect(await at(null)).toBeNull()
	})

	test("with the Timeline off a hand kept_from still wins, and overruled has no date", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const h = await w.entry(w.book.id, { year: 12 }, HISTORY_TYPE_ID)
		const kept = await w.tie("Ana", e, "kept_from")
		await w.tie("Ana", e, "was_told", { historyEntryId: h })
		await testDb
			.update(schema.lorebooks)
			.set({ timelineEnabled: false } as never)
			.where(eq(schema.lorebooks.id, w.book.id))
		const row = await w.readPair("Ana", e)
		expect(row.known).toBe(false)
		expect(row.winner).toMatchObject({
			tieId: kept,
			kind: "kept_from",
			date: null
		})
		expect(row.overruled).toMatchObject({ kind: "was_told", date: null })
	})

	test("a hand knows and a hand kept_from, both live: the newest id wins", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.mark([e])
		await w.tie("Ana", e, "knows")
		const kept = await w.tie("Ana", e, "kept_from")
		const row = await w.readPair("Ana", e)
		expect(row.known).toBe(false)
		expect(row.winner).toMatchObject({ tieId: kept, kind: "kept_from", hand: true })
		expect(row.hand).toBe("kept_from")
		const rev = await world()
		const e2 = await rev.entry(rev.book.id)
		await rev.mark([e2])
		await rev.tie("Ana", e2, "kept_from")
		const knows = await rev.tie("Ana", e2, "knows")
		const row2 = await rev.readPair("Ana", e2)
		expect(row2.known).toBe(true)
		expect(row2.winner).toMatchObject({ tieId: knows, kind: "knows", hand: true })
		expect(row2.hand).toBe("knows")
	})

	test("a hand knows beats a dated kept_from", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const h = await w.entry(w.book.id, { year: 12 }, HISTORY_TYPE_ID)
		await w.mark([e])
		const k = await w.tie("Ana", e, "knows")
		await w.tie("Ana", e, "kept_from", { historyEntryId: h })
		const row = await w.readPair("Ana", e)
		expect(row.known).toBe(true)
		expect(row.winner).toMatchObject({ tieId: k, hand: true })
		expect(row.overruled).toMatchObject({ kind: "kept_from", hand: false })
	})

	test("a common entry with a hand kept_from is not known", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.tie("Ana", e, "kept_from")
		expect((await w.readPair("Ana", e)).known).toBe(false)
	})

	test("a marked entry with no tie is not known and has no winner", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.mark([e])
		const row = await w.readPair("Bo", e)
		expect(row.known).toBe(false)
		expect(row.winner).toBeNull()
		expect(row.hand).toBeNull()
	})

	test("a common entry with no tie is known and has no winner", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const row = await w.readPair("Bo", e)
		expect(row.known).toBe(true)
		expect(row.winner).toBeNull()
	})

	test("a place entry says so", async () => {
		const w = await world()
		const place = await w.entry(w.book.id, {}, LOCATION_TYPE_ID)
		const lore = await w.entry(w.book.id)
		expect((await w.readPair("Ana", place)).placeEntry).toBe(true)
		expect((await w.readPair("Ana", lore)).placeEntry).toBe(false)
	})

	test("member mode lists marked and tied entries; entry mode lists every member; both ids, one row", async () => {
		const w = await world()
		const marked = await w.entry(w.book.id)
		const tied = await w.entry(w.book.id)
		const idle = await w.entry(w.book.id)
		await w.mark([marked])
		await w.tie("Ana", tied, "knows")
		const asked = {
			userId: w.user.id,
			lorebookId: w.book.id,
			branchId: null,
			moment: null
		}
		const member = await readBookKnowledge(db(), {
			...asked,
			castMemberId: w.members.Ana
		})
		expect(member.markedEntryIds).toEqual([marked])
		expect(member.rows.map((r) => r.entryId)).toEqual(
			[marked, tied].sort((a, b) => a - b)
		)
		expect(member.rows.every((r) => r.castMemberId === w.members.Ana)).toBe(true)
		const byEntry = await readBookKnowledge(db(), { ...asked, entryId: idle })
		expect(byEntry.rows.map((r) => r.name)).toEqual(["Ana", "Bo"])
		const both = await readBookKnowledge(db(), {
			...asked,
			entryId: marked,
			castMemberId: w.members.Bo
		})
		expect(both.rows).toHaveLength(1)
		const none = await readBookKnowledge(db(), asked)
		expect(none.rows).toEqual([])
		expect(none.markedEntryIds).toEqual([marked])
	})

	test("refuses an entry or a member outside the book", async () => {
		const w = await world()
		const far = await w.entry(w.elsewhere.id)
		const asked = {
			userId: w.user.id,
			lorebookId: w.book.id,
			branchId: null,
			moment: null
		}
		await expect(
			readBookKnowledge(db(), { ...asked, entryId: far })
		).rejects.toThrow("That entry is not in this lorebook.")
		await expect(
			readBookKnowledge(db(), { ...asked, castMemberId: 99999999 })
		).rejects.toThrow("That cast member is not in this lorebook.")
		await expect(
			readBookKnowledge(db(), { ...asked, branchId: 99999999, entryId: far })
		).rejects.toThrow("That is not a line of this lorebook.")
	})
})

describe("setHandKnowledgeTie", () => {
	test("leaves exactly one live hand tie, null ends them all, play's rows stay", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const h = await w.entry(w.book.id, { year: 4 }, HISTORY_TYPE_ID)
		await w.tie("Ana", e, "knows")
		await w.tie("Ana", e, "kept_from")
		const told = await w.tie("Ana", e, "was_told", { historyEntryId: h })
		const been = await w.tie("Ana", e, "has_been_there")
		const friend = await w.relationship("Ana", e, "friend of")
		const keep = [told, been, friend]
		const handsOf = async () =>
			(await w.live("Ana", e)).filter(
				(t) =>
					(t.knowledgeKind === "knows" || t.knowledgeKind === "kept_from") &&
					t.historyEntryId == null &&
					t.branchId == null
			)

		await w.hand("Ana", e, "knows")
		const one = await handsOf()
		expect(one).toHaveLength(1)
		expect(one[0]!.knowledgeKind).toBe("knows")
		await w.hand("Ana", e, "kept_from")
		expect((await handsOf()).map((t) => t.knowledgeKind)).toEqual(["kept_from"])
		await w.hand("Ana", e, null)
		expect(await handsOf()).toEqual([])
		const stillLive = (await w.live("Ana", e)).map((t) => t.id)
		for (const id of keep) expect(stillLive).toContain(id)
	})

	test("refuses a kind that is not a hand", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await expect(
			w.hand("Ana", e, "was_told" as never)
		).rejects.toThrow("That is not a kind of knowledge.")
	})
})

describe("setBookCommonKnowledge", () => {
	test("is one transaction: a foreign entry in the list marks none", async () => {
		const w = await world()
		const a = await w.entry(w.book.id)
		const far = await w.entry(w.elsewhere.id)
		await expect(w.mark([a, far])).rejects.toThrow(
			"That entry is not in this lorebook."
		)
		expect(await w.mark([a], false)).toEqual([])
		await expect(w.mark([])).rejects.toThrow("Name the entries to mark.")
	})

	test("marks and clears several, and writes no edit history", async () => {
		const w = await world()
		const a = await w.entry(w.book.id)
		const b = await w.entry(w.book.id)
		const count = async () =>
			Number(
				(await testDb.select({ c: sql`count(*)` }).from(schema.loreRedlines))[0]!.c
			)
		const before = await count()
		expect(await w.mark([b, a, a])).toEqual([a, b].sort((x, y) => x - y))
		expect(await w.mark([a], false)).toEqual([b])
		expect(await count()).toBe(before)
	})
})

describe("the owner-only gate", () => {
	test("another user, an administrator and a session member are refused by the read and both writers", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		for (const who of [w.other, w.admin]) {
			await expect(
				readBookKnowledge(db(), {
					userId: who.id,
					lorebookId: w.book.id,
					entryId: e,
					branchId: null,
					moment: null
				})
			).rejects.toThrow("Lorebook not found.")
			await expect(w.mark([e], true, who.id)).rejects.toThrow("Lorebook not found.")
			await expect(
				setHandKnowledgeTie(db(), {
					userId: who.id,
					lorebookId: w.book.id,
					castMemberId: w.members.Ana,
					entryId: e,
					hand: "knows"
				})
			).rejects.toThrow("Lorebook not found.")
		}
		// A guest of the session has no access to its notes (G2): the same refusal, and nothing of the notes in it.
		const notesAsked = { userId: w.guest.id, lorebookId: w.notes.id }
		const refusals = await Promise.all([
			readBookKnowledge(db(), { ...notesAsked, entryId: e, branchId: null, moment: null }).catch((x) => x),
			setBookCommonKnowledge(db(), { ...notesAsked, entryIds: [e], notCommonKnowledge: true }).catch((x) => x),
			setHandKnowledgeTie(db(), {
				...notesAsked,
				castMemberId: w.members.Ana,
				entryId: e,
				hand: "knows"
			}).catch((x) => x)
		])
		for (const r of refusals) {
			expect(r).toBeInstanceOf(Error)
			expect(String((r as Error).message)).toBe("Lorebook not found.")
		}
	})
})

describe("the hand switch against the prompt's judgement", () => {
	test("kept_from leaves the entry out for that member's speaker; knows on a marked entry brings it back", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const speaker = `seated-member:${w.members.Ana}`
		const out = async () => {
			const r = await loadEntryKnowledge(db(), { sessionId: w.sessionId, speaker })
			return r.kind === "judged" ? r.leftOut.map((l) => l.entryId) : []
		}
		await w.hand("Ana", e, "kept_from")
		expect(await out()).toEqual([e])
		await w.hand("Ana", e, null)
		expect(await out()).toEqual([])
		await w.mark([e])
		expect(await out()).toEqual([e])
		await w.hand("Ana", e, "knows")
		expect(await out()).toEqual([])
	})
})
