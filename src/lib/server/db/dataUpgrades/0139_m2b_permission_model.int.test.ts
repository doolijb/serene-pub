/**
 * The 0139 data upgrade (M2b, a8 ruling): `annex.core.annexVersions` moves
 * into `sessions.annex_versions`. Scratch table with the columns the upgrade
 * touches, so the SQL is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { moveAnnexVersionsToColumn } from "./0139_m2b_permission_model"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> => rawRows<T>(await q(s))
const upgrade = () => db.transaction(async (tx: any) => moveAnnexVersionsToColumn(tx))
const all = () => rows<any>(`SELECT * FROM sessions ORDER BY id`)

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(
		`CREATE TABLE sessions (id serial PRIMARY KEY, annex jsonb NOT NULL DEFAULT '{}', annex_versions jsonb NOT NULL DEFAULT '{}')`
	)
}, 60_000)

afterEach(async () => {
	await client.close()
})

const insert = (id: number, annex: unknown, versions: unknown = {}) =>
	q(`INSERT INTO sessions (id, annex, annex_versions) VALUES (${id}, '${JSON.stringify(annex)}', '${JSON.stringify(versions)}')`)

describe("0139: annex document versions move from core's runtime key to the column", () => {
	it("moves the map, drops the key, keeps core's other keys and every other owner", async () => {
		await insert(1, { core: { "retake-quietly": true, turnOrder: { v: 1 }, annexVersions: { "acme.rp": 3, core: 1 } }, "acme.rp": { clock: 5 } })
		expect(await upgrade()).toBe(1)
		const [row] = await all()
		expect(row.annex_versions).toEqual({ "acme.rp": 3, core: 1 })
		expect(row.annex.core).toEqual({ "retake-quietly": true, turnOrder: { v: 1 } })
		expect(row.annex["acme.rp"]).toEqual({ clock: 5 })
	}, 60_000)

	it("merges under a count the column already holds — the larger wins — and keeps the column's other owners", async () => {
		await insert(1, { core: { annexVersions: { a: 2, b: 7 } } }, { a: 5, c: 1 })
		await upgrade()
		const [row] = await all()
		expect(row.annex_versions).toEqual({ a: 5, b: 7, c: 1 })
		expect(row.annex.core).toEqual({})
	}, 60_000)

	it("a session without the key is left alone, and a second run changes nothing", async () => {
		await insert(1, { core: { "retake-quietly": false } }, { x: 1 })
		await insert(2, { core: { annexVersions: { y: 4 } } })
		expect(await upgrade()).toBe(1)
		expect(await upgrade()).toBe(0)
		const [one, two] = await all()
		expect(one.annex_versions).toEqual({ x: 1 })
		expect(one.annex).toEqual({ core: { "retake-quietly": false } })
		expect(two.annex_versions).toEqual({ y: 4 })
	}, 60_000)
})
