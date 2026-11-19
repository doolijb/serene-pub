/**
 * The two writers of a session's `genre_fields` and `rigour` columns, against a
 * real database. "No write" is detected by pinning `updated_at` to a past time
 * and asserting it did not move: the schema moves it on every drizzle update.
 */

import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, createTestUser, type TestDb } from "$lib/server/utils/testDb"
import { writeGenreFields, writeRigour } from "./settingsWrite"

vi.setConfig({ testTimeout: 60_000 })

const PAST = "2001-02-03 04:05:06+00"

let db: TestDb
let owner: number

async function newSession(genreFields: Record<string, unknown> = {}, rigour?: string) {
	const [row] = await db
		.insert(schema.sessions)
		.values({
			userId: owner,
			isGroup: false,
			genreId: "core:genre/story",
			presetId: null,
			genreFields,
			...(rigour ? { rigour } : {})
		} as any)
		.returning()
	await pin(row!.id)
	return row!.id
}

const pin = (id: number) =>
	db.execute(sql`UPDATE sessions SET updated_at = ${PAST}::timestamptz WHERE id = ${id}`)

async function stamp(id: number): Promise<number> {
	const r: any = await db.execute(sql`SELECT updated_at FROM sessions WHERE id = ${id}`)
	return new Date((r.rows ?? r)[0].updated_at).getTime()
}

const PAST_MS = new Date(PAST).getTime()

async function stored(id: number) {
	const [row] = await db
		.select({ genreFields: schema.sessions.genreFields, rigour: schema.sessions.rigour })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, id))
	return row!
}

beforeAll(async () => {
	db = await createTestDb()
	owner = (await createTestUser(db, "sw-owner")).id
})

describe("writeGenreFields", () => {
	it("writes change's result and hands change what is stored", async () => {
		const id = await newSession({ a: 1 })
		let seen: unknown
		const out = await db.transaction((tx) =>
			writeGenreFields(tx, id, (cur) => {
				seen = cur
				return { ...cur, b: 2 }
			})
		)
		expect(seen).toEqual({ a: 1 })
		expect(out).toEqual({ written: true, genreFields: { a: 1, b: 2 } })
		expect((await stored(id)).genreFields).toEqual({ a: 1, b: 2 })
		expect(await stamp(id)).toBeGreaterThan(PAST_MS)
	})

	it("hands change {} when nothing is stored", async () => {
		const id = await newSession({})
		let seen: unknown
		await db.transaction((tx) =>
			writeGenreFields(tx, id, (cur) => {
				seen = cur
				return { x: true }
			})
		)
		expect(seen).toEqual({})
		expect((await stored(id)).genreFields).toEqual({ x: true })
	})

	it("writes nothing when change returns null", async () => {
		const id = await newSession({ a: 1 })
		const out = await db.transaction((tx) => writeGenreFields(tx, id, () => null))
		expect(out).toEqual({ written: false, genreFields: { a: 1 } })
		expect(await stamp(id)).toBe(PAST_MS)
	})

	it("writes nothing when change returns an equal object", async () => {
		const id = await newSession({ a: 1, n: { k: [1, 2] } })
		const out = await db.transaction((tx) =>
			writeGenreFields(tx, id, (cur) => ({ ...cur }))
		)
		expect(out.written).toBe(false)
		expect(out.genreFields).toEqual({ a: 1, n: { k: [1, 2] } })
		expect(await stamp(id)).toBe(PAST_MS)
	})

	it("does not call change for a missing session", async () => {
		const change = vi.fn(() => ({ a: 1 }))
		const out = await db.transaction((tx) => writeGenreFields(tx, 987654321, change))
		expect(change).not.toHaveBeenCalled()
		expect(out).toEqual({ written: false, genreFields: {} })
	})

	it("re-reads inside the transaction, so a concurrent change is kept", async () => {
		const id = await newSession({})
		const staleCopy = await stored(id)
		expect(staleCopy.genreFields).toEqual({})
		await db
			.update(schema.sessions)
			.set({ genreFields: { b: 2 } })
			.where(eq(schema.sessions.id, id))
		await db.transaction((tx) => writeGenreFields(tx, id, (cur) => ({ ...cur, a: 1 })))
		expect((await stored(id)).genreFields).toEqual({ a: 1, b: 2 })
	})

	it("rolls back with the caller's transaction when it throws after the write", async () => {
		const id = await newSession({ a: 1 })
		await expect(
			db.transaction(async (tx) => {
				const out = await writeGenreFields(tx, id, (cur) => ({ ...cur, z: 9 }))
				expect(out.written).toBe(true)
				throw new Error("boom")
			})
		).rejects.toThrow("boom")
		expect((await stored(id)).genreFields).toEqual({ a: 1 })
	})
})

describe("writeRigour", () => {
	it("writes a different value and returns true", async () => {
		const id = await newSession({}, "prose")
		const wrote = await db.transaction((tx) => writeRigour(tx, id, "mechanics"))
		expect(wrote).toBe(true)
		expect((await stored(id)).rigour).toBe("mechanics")
		expect(await stamp(id)).toBeGreaterThan(PAST_MS)
	})

	it("returns false and writes nothing for the same value", async () => {
		const id = await newSession({}, "mechanics")
		const wrote = await db.transaction((tx) => writeRigour(tx, id, "mechanics"))
		expect(wrote).toBe(false)
		expect(await stamp(id)).toBe(PAST_MS)
	})

	it("returns false for a missing session", async () => {
		expect(await db.transaction((tx) => writeRigour(tx, 987654321, "mechanics"))).toBe(false)
	})
})
