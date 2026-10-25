/**
 * 🚧 Migration 0122 `attribute_carries` (RF fix 2, item 3, 2026-10-23): one
 * table and nothing else moved. A database brought up through it holds the
 * table with its owner-kind check (session-layer owners only), one row per
 * holder and attribute in a session, and rows that go with their session. No
 * stored data is rewritten: with no row, every holder carries everything.
 */
import { beforeAll, describe, expect, test } from "vitest"
import fs from "fs"
import path from "path"
import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

let db: TestDb

beforeAll(async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	db = await createTestDb()
}, 60_000)

describe("0122 attribute_carries", () => {
	test("is journal entry 122: one table of its own, and nothing else", () => {
		const journal = JSON.parse(fs.readFileSync(path.resolve("drizzle/meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string }[] }
		const entry = journal.entries.find((e) => e.tag === "0122_attribute_carries")
		expect(entry?.idx).toBe(122)
		const body = fs.readFileSync(path.resolve("drizzle/0122_attribute_carries.sql"), "utf8")
		const statements = body.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)
		expect(statements.map((s) => s.split(/\s+/).slice(0, 3).join(" "))).toEqual(["CREATE TABLE \"attribute_carries\"", "ALTER TABLE \"attribute_carries\"", "CREATE UNIQUE INDEX"])
	})

	test("holds one switch per holder and attribute, session-layer owners only, gone with the session", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const user = await createTestUser(db, "carries-0122")
		const [session] = await db.insert(schema.sessions).values({ userId: user.id, isGroup: false, name: "Pier" }).returning()
		const row = { sessionId: session!.id, ownerKind: "session_cast", ownerId: 7, slotId: "acme.x:slot/nerve@1", carries: false }
		await db.insert(schema.attributeCarries).values(row)
		await expect(db.insert(schema.attributeCarries).values(row)).rejects.toThrow()
		await expect(db.insert(schema.attributeCarries).values({ ...row, ownerKind: "card" })).rejects.toThrow()
		const [{ n }] = (await db.execute(sql`select count(*)::int as n from attribute_carries where session_id = ${session!.id}`)).rows as { n: number }[]
		expect(n).toBe(1)
		await db.execute(sql`delete from sessions where id = ${session!.id}`)
		const [{ m }] = (await db.execute(sql`select count(*)::int as m from attribute_carries where session_id = ${session!.id}`)).rows as { m: number }[]
		expect(m).toBe(0)
	}, 60_000)
})
