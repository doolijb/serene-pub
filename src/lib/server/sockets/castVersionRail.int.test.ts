/**
 * 🚧 The wire the cast member page's version rail reads and writes: every
 * cast row names the member's base version, a member save may name the base
 * as the version it writes, and each listed cast version says who wrote it.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { and, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCastMember,
	insertCharacterVersions,
	writeCastVersion
} from "$lib/server/characters/versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-cast-version-rail-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
const fakeSocket = (userId: number) => ({ user: { id: userId } }) as any
const noopEmit = () => {}
const V = schema.characterVersions
let n = 0

async function world() {
	const { createTestUser } = await import("$lib/server/utils/testDb")
	const user = await createTestUser(testDb, `cast-rail-${++n}`)
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ name: `Book ${n}`, userId: user.id, storyClockYear: 100 })
		.returning()
	const mk = async (name: string) =>
		insertCastMember(db(), {
			lorebookId: book!.id,
			binding: `{{char:${n}-${name}}}`,
			characterId: null,
			name,
			description: `${name} at the start.`
		})
	const { member, base } = await mk("The innkeeper")
	const other = await mk("The smith")
	const dated = async (year: number, description: string) =>
		(
			await writeCastVersion(db(), {
				member: member.id,
				changes: { description },
				writtenBy: `user:${user.id}`,
				at: {
					branchId: null,
					date: { year, month: null, day: null },
					personalPosition: null
				}
			})
		).version!
	const update = async (fields: Record<string, unknown>, extra = {}) => {
		const { updateLorebookBindingHandler } = await import(
			"$lib/server/sockets/lorebooks"
		)
		return (await updateLorebookBindingHandler.handler(
			fakeSocket(user.id),
			{ lorebookBinding: { id: member.id, ...fields }, ...extra } as any,
			noopEmit
		)) as Sockets.Lorebooks.UpdateBinding.Response
	}
	const list = async (asker = user.id) => {
		const m = await import("./amendments")
		return m.amendmentsListHandler.handler(
			fakeSocket(asker),
			{ lorebookId: book!.id },
			noopEmit
		)
	}
	return {
		user,
		book: book!,
		member,
		base: base!,
		other,
		dated,
		update,
		list
	}
}

const versionRow = async (id: number) =>
	(await testDb.select().from(V).where(eq(V.id, id)))[0]!

describe("a member save names the version it writes", () => {
	test("the base: its columns change and the dated version at the present stays", async () => {
		const w = await world()
		const at50 = await w.dated(50, "At fifty.")
		const res = await w.update(
			{ description: "Rewritten start." },
			{ castVersionId: w.base.id }
		)
		expect((await versionRow(w.base.id)).description).toBe(
			"Rewritten start."
		)
		expect((await versionRow(at50.id)).description).toBe("At fifty.")
		expect(res.lorebookBinding.baseVersionId).toBe(w.base.id)
		// the dated version is still the one in force at the present
		expect(res.lorebookBinding.castVersionId).toBe(at50.id)
	})

	test("without a version named it writes the version in force at the present", async () => {
		const w = await world()
		const at50 = await w.dated(50, "At fifty.")
		await w.update({ description: "Edited at the present." })
		expect((await versionRow(at50.id)).description).toBe(
			"Edited at the present."
		)
		expect((await versionRow(w.base.id)).description).toBe(
			"The innkeeper at the start."
		)
	})

	test("a dated version, or another member's base, is refused and nothing is written", async () => {
		const w = await world()
		const at50 = await w.dated(50, "At fifty.")
		const before = await testDb.select().from(V)
		const sentence =
			"That version can't be saved here: only this cast member's first version is saved from the member page."
		for (const id of [at50.id, w.other.base!.id])
			await expect(
				w.update({ description: "Nope." }, { castVersionId: id })
			).rejects.toThrow(sentence)
		expect(await testDb.select().from(V)).toEqual(before)
	})

	test("bindingList carries the base version's id", async () => {
		const w = await world()
		await w.dated(50, "At fifty.")
		const { buildLorebookBindingList } = await import(
			"$lib/server/sockets/lorebooks"
		)
		const res = await buildLorebookBindingList(w.user.id, w.book.id)
		const row = res.lorebookBindingList.find((m) => m.id === w.member.id)!
		expect(row.baseVersionId).toBe(w.base.id)
		expect(row.baseVersionId).not.toBe(row.castVersionId)
	})
})

describe("amendments:list says who wrote each cast version", () => {
	async function sessionOf(userId: number, bookId: number, name: string) {
		const [s] = await testDb
			.insert(schema.sessions)
			.values({
				userId,
				isGroup: false,
				name,
				genreId: "test:genre/versions-authoring",
				lorebookId: bookId
			} as any)
			.returning()
		return s!
	}
	async function bySession(
		w: Awaited<ReturnType<typeof world>>,
		id: number | null,
		year: number
	) {
		const [row] = await insertCharacterVersions(db(), [
			{
				castMemberId: w.member.id,
				lorebookId: w.book.id,
				parentVersionId: w.base.parentVersionId,
				follows: w.base.follows,
				nodeState: "active",
				nodeVisibility: "normal",
				year,
				sourceSessionId: id,
				writtenBy: id == null ? `user:${w.user.id}` : `run:${id}`
			} as any
		])
		return row!
	}

	test("a person's version: write order, no session", async () => {
		const w = await world()
		const v = await w.dated(50, "At fifty.")
		const row = (await w.list()).cast.find((r) => r.id === v.id)!
		expect(row.writeOrder).toBe(v.writeOrder)
		expect(row.sourceSessionId).toBeNull()
		expect(row.sourceSessionName).toBeNull()
	})

	test("a session the asker owns is named; one they may not open is not", async () => {
		const w = await world()
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const stranger = await createTestUser(testDb, `cast-rail-stranger-${n}`)
		const mine = await sessionOf(w.user.id, w.book.id, "  The long night ")
		const theirs = await sessionOf(stranger.id, w.book.id, "Private")
		const blank = await sessionOf(w.user.id, w.book.id, "  ")
		const a = await bySession(w, mine.id, 60)
		const b = await bySession(w, theirs.id, 70)
		const c = await bySession(w, blank.id, 80)
		const cast = (await w.list()).cast
		const of = (id: number) => cast.find((r) => r.id === id)!
		expect(of(a.id)).toMatchObject({
			sourceSessionId: mine.id,
			sourceSessionName: "The long night",
			writeOrder: a.writeOrder
		})
		expect(of(b.id)).toMatchObject({
			sourceSessionId: theirs.id,
			sourceSessionName: null
		})
		expect(of(c.id).sourceSessionName).toBeNull()
	})
})
