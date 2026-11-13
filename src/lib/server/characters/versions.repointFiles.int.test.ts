/**
 * 🚧 `repointCastVersionFiles`: the in-place rewrite of a member's face and
 * likeness picture on every one of its versions (retired included), and never
 * on a card version.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { releaseDataDir } from "$lib/server/utils/testDb"
import {
	insertCard,
	insertCastMember,
	repointCastVersionFiles
} from "./versions"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async (importOriginal) => {
	const actual = await importOriginal<typeof import("$lib/server/db")>()
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { ...actual, db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-vitest-repoint-files-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await releaseDataDir(dataDir)
})

const db = () => testDb as unknown as Db
let n = 0

async function file(userId: number) {
	const [f] = await testDb
		.insert(schema.files)
		.values({
			userId,
			hash: `repoint-${++n}`,
			filename: `f${n}.png`,
			mimeType: "image/png",
			kind: "image",
			size: 1
		} as any)
		.returning()
	return f!.id
}

async function world() {
	const [user] = await testDb
		.insert(schema.users)
		.values({ username: `repoint-${++n}` })
		.returning()
	const { card, version } = await insertCard(testDb, {
		userId: user!.id,
		name: `Card ${n}`,
		description: "A person."
	})
	const [book] = await testDb
		.insert(schema.lorebooks)
		.values({ userId: user!.id, name: `Book ${n}` })
		.returning()
	const { member } = await insertCastMember(db(), {
		lorebookId: book!.id,
		characterId: null,
		binding: `{{char:${n}}}`,
		name: `Bare ${n}`
	})
	return { user: user!, card, version, member }
}

const V = schema.characterVersions
const rowsOf = (memberId: number) =>
	testDb.select().from(V).where(eq(V.castMemberId, memberId))

describe("repointCastVersionFiles", () => {
	test("rewrites face and likeness on every version in place, retired included", async () => {
		const w = await world()
		const a = await file(w.user.id)
		const b = await file(w.user.id)
		const keep = await file(w.user.id)
		const [base] = await rowsOf(w.member.id)
		await testDb
			.update(V)
			.set({ faceMediaId: a, likeness: { imageMediaId: a } } as any)
			.where(eq(V.id, base!.id))
		const [second] = await testDb
			.insert(V)
			.values({
				...base!,
				id: undefined,
				faceMediaId: keep,
				likeness: { imageMediaId: a },
				retiredOrder: 99999,
				year: 5
			} as any)
			.returning()
		await testDb
			.update(V)
			.set({ faceMediaId: a })
			.where(eq(V.id, w.version.id))

		const changed = await repointCastVersionFiles(
			db(),
			w.member.id,
			new Map([[a, b]])
		)
		expect(changed).toBe(2)
		const rows = await rowsOf(w.member.id)
		expect(rows).toHaveLength(2)
		const r1 = rows.find((r) => r.id === base!.id)!
		const r2 = rows.find((r) => r.id === second!.id)!
		expect(r1.faceMediaId).toBe(b)
		expect((r1.likeness as any).imageMediaId).toBe(b)
		expect(r2.faceMediaId).toBe(keep)
		expect((r2.likeness as any).imageMediaId).toBe(b)
		expect(r2.retiredOrder).toBe(99999)
		// A card version is never touched.
		const [card] = await testDb
			.select()
			.from(V)
			.where(eq(V.id, w.version.id))
		expect(card!.faceMediaId).toBe(a)
		// Second call: nothing left to change; an empty map is a no-op.
		expect(
			await repointCastVersionFiles(db(), w.member.id, new Map([[a, b]]))
		).toBe(0)
		expect(
			await repointCastVersionFiles(db(), w.member.id, new Map())
		).toBe(0)
	})
})
