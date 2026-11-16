/**
 * 🚧 The loader and the writers of entry knowledge on a real session: marks,
 * knowledge ties of every kind, an ordinary tie, an ended tie, a tie kept in
 * the session's notes, a narrator, and the statements a read costs.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { insertCastMember } from "$lib/server/characters/versions"
import {
	endKnowledgeTie,
	loadEntryKnowledge,
	setEntryCommonKnowledge,
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
		path.join(os.tmpdir(), "serene-pub-vitest-entryKnowledge-")
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
	const user = await createTestUser(testDb, `knowledge-${suffix}`)
	const other = await createTestUser(testDb, `knowledge-other-${suffix}`)
	const mkBook = async (userId: number, name: string) =>
		(
			await testDb
				.insert(schema.lorebooks)
				.values({ userId, name } as never)
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
	const foreignMember = (
		await insertCastMember(testDb, {
			lorebookId: elsewhere.id,
			binding: `{{char:Far${suffix}}}`,
			name: "Far"
		})
	).member!.id
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
	const notes = (
		await testDb
			.insert(schema.lorebooks)
			.values({
				userId: user.id,
				name: `Notes ${suffix}`,
				sessionId
			} as never)
			.returning()
	)[0]!
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
	const mark = (entryId: number, notCommonKnowledge = true) =>
		setEntryCommonKnowledge(db(), {
			userId: user.id,
			entryId,
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
	const read = (who: string | null) =>
		loadEntryKnowledge(db(), {
			sessionId,
			speaker: who ? `seated-member:${members[who]}` : null
		})
	return {
		user,
		other,
		book,
		notes,
		elsewhere,
		members,
		foreignMember,
		sessionId,
		entry,
		mark,
		tie,
		read
	}
}

async function countStatements<T>(
	fn: () => Promise<T>
): Promise<{ result: T; statements: number }> {
	const client = (
		testDb as unknown as {
			$client: { query: (...a: unknown[]) => unknown }
		}
	).$client
	const original = client.query.bind(client)
	let statements = 0
	client.query = (...args: unknown[]) => {
		statements++
		return original(...args)
	}
	try {
		return { result: await fn(), statements }
	} finally {
		client.query = original
	}
}

const leftOut = (r: Awaited<ReturnType<typeof loadEntryKnowledge>>) =>
	r.kind === "judged" ? r.leftOut : null

describe("loadEntryKnowledge", () => {
	test("nothing marked and nothing kept from reads in exactly one statement", async () => {
		const w = await world()
		await w.entry(w.book.id)
		const { result, statements } = await countStatements(() =>
			w.read("Ana")
		)
		expect(result).toEqual({ kind: "nothing-marked" })
		expect(statements).toBe(1)
	})

	test("a narrator and an envoy read everything", async () => {
		const w = await world()
		await w.mark(await w.entry(w.book.id))
		expect(await w.read(null)).toEqual({ kind: "reads-all" })
		expect(
			await loadEntryKnowledge(db(), {
				sessionId: w.sessionId,
				speaker: ""
			})
		).toEqual({ kind: "reads-all" })
		expect(
			await loadEntryKnowledge(db(), {
				sessionId: w.sessionId,
				speaker: "seated-member:999999"
			})
		).toEqual({
			kind: "reads-all"
		})
	})

	test("a marked entry is left out until the member is tied to it", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.mark(e)
		const first = await w.read("Ana")
		expect(first).toMatchObject({
			kind: "judged",
			name: "Ana",
			notKnown: 1,
			keptFrom: 0
		})
		expect(leftOut(first)).toEqual([{ entryId: e, cause: "not-known" }])
		await w.tie("Ana", e, "has_been_there")
		expect(leftOut(await w.read("Ana"))).toEqual([])
		// A tie belongs to its member alone.
		expect(leftOut(await w.read("Bo"))).toEqual([
			{ entryId: e, cause: "not-known" }
		])
	})

	test("each knowing kind lets a marked entry in", async () => {
		const w = await world()
		for (const kind of ["was_told", "knows", "has_been_there"] as const) {
			const e = await w.entry(w.book.id)
			await w.mark(e)
			await w.tie("Ana", e, kind)
		}
		expect(leftOut(await w.read("Ana"))).toEqual([])
	})

	test("an ordinary tie lets a marked entry in", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.mark(e)
		await testDb.insert(schema.narrativeRelationships).values({
			lorebookId: w.book.id,
			fromNodeId: w.members.Ana!,
			toEntryId: e,
			relationshipType: "member of"
		} as never)
		expect(leftOut(await w.read("Ana"))).toEqual([])
	})

	test("kept from leaves out an unmarked entry", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.tie("Ana", e, "kept_from")
		const r = await w.read("Ana")
		expect(leftOut(r)).toEqual([{ entryId: e, cause: "kept-from" }])
		expect(leftOut(await w.read("Bo"))).toEqual([])
	})

	test("an ended tie does not count", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.mark(e)
		const id = await w.tie("Ana", e, "knows")
		await endKnowledgeTie(db(), { userId: w.user.id, tieId: id })
		expect(leftOut(await w.read("Ana"))).toEqual([
			{ entryId: e, cause: "not-known" }
		])
		const kept = await w.entry(w.book.id)
		const keptTie = await w.tie("Ana", kept, "kept_from")
		await endKnowledgeTie(db(), { userId: w.user.id, tieId: keptTie })
		expect(await w.read("Ana")).toMatchObject({
			kind: "judged",
			keptFrom: 0
		})
	})

	test("the date of a tie is its history entry's date", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.mark(e)
		const early = await w.entry(w.book.id, { year: 10 }, HISTORY_TYPE_ID)
		const late = await w.entry(w.book.id, { year: 20 }, HISTORY_TYPE_ID)
		await w.tie("Ana", e, "kept_from", { historyEntryId: early })
		await w.tie("Ana", e, "knows", { historyEntryId: late })
		expect(leftOut(await w.read("Ana"))).toEqual([])
		const f = await w.entry(w.book.id)
		await w.mark(f)
		await w.tie("Ana", f, "knows", { historyEntryId: early })
		await w.tie("Ana", f, "kept_from", { historyEntryId: late })
		expect(leftOut(await w.read("Ana"))).toEqual([
			{ entryId: f, cause: "kept-from" }
		])
	})

	test("a tie kept in the session's notes counts, for an entry of the attached book", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.mark(e)
		await w.tie("Ana", e, "was_told", { lorebookId: w.notes.id })
		expect(leftOut(await w.read("Ana"))).toEqual([])
		// An entry marked in the notes is judged too.
		const own = await w.entry(w.notes.id)
		await w.mark(own)
		expect(leftOut(await w.read("Ana"))).toEqual([
			{ entryId: own, cause: "not-known" }
		])
	})

	test("reports the statements of a judged read with rows", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await w.mark(e)
		await w.tie("Ana", e, "knows")
		const { result, statements } = await countStatements(() =>
			w.read("Ana")
		)
		expect(result.kind).toBe("judged")
		// 15 today: the flag read, the seat, the ties, the name, the reading. A ceiling, not a target.
		expect(statements).toBeLessThanOrEqual(20)
	})
})

describe("the writers", () => {
	test("refuse a non-owner", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		await expect(
			setEntryCommonKnowledge(db(), {
				userId: w.other.id,
				entryId: e,
				notCommonKnowledge: true
			})
		).rejects.toThrow(
			"Only the lorebook's owner can mark what is common knowledge."
		)
		await expect(
			w.tie("Ana", e, "knows", { userId: w.other.id })
		).rejects.toThrow()
		const id = await w.tie("Ana", e, "knows")
		await expect(
			endKnowledgeTie(db(), { userId: w.other.id, tieId: id })
		).rejects.toThrow()
		const [row] = await testDb
			.select({ status: schema.narrativeRelationships.status })
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, id))
		expect(row!.status).toBe("active")
	})

	test("set and clear the mark", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const marked = async () =>
			(
				await testDb
					.select({ v: schema.lorebookEntries.notCommonKnowledge })
					.from(schema.lorebookEntries)
					.where(eq(schema.lorebookEntries.id, e))
			)[0]!.v
		expect(await marked()).toBe(false)
		await w.mark(e)
		expect(await marked()).toBe(true)
		await w.mark(e, false)
		expect(await marked()).toBe(false)
	})

	test("writeKnowledgeTie refuses a binding or an entry of another book", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const far = await w.entry(w.elsewhere.id)
		await expect(
			writeKnowledgeTie(db(), {
				userId: w.user.id,
				lorebookId: w.book.id,
				castMemberId: w.foreignMember,
				entryId: e,
				kind: "knows"
			})
		).rejects.toThrow("That cast member is not in this lorebook.")
		await expect(w.tie("Ana", far, "knows")).rejects.toThrow(
			"That entry is not in this lorebook."
		)
	})

	test("endKnowledgeTie refuses an ordinary row", async () => {
		const w = await world()
		const e = await w.entry(w.book.id)
		const [row] = await testDb
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: w.book.id,
				fromNodeId: w.members.Ana!,
				toEntryId: e,
				relationshipType: "member of"
			} as never)
			.returning()
		await expect(
			endKnowledgeTie(db(), { userId: w.user.id, tieId: row!.id })
		).rejects.toThrow("That is not a knowledge tie.")
	})
})
