/**
 * The 0142 data upgrade (★4b): stored names in the automatic shape are marked
 * default; a person's own name is not; a second run changes nothing. Scratch
 * table with the columns the upgrade touches, so the SQL is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { run } from "./0142_scenes_unfiled_default_names"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const upgrade = (): Promise<void> => db.transaction(async (tx: any) => run(tx))
const markedCount = (m: Record<string, boolean>): number => Object.values(m).filter(Boolean).length
const marks = async () =>
	Object.fromEntries(
		rawRows<{ name: string | null; name_is_default: boolean }>(
			await q(`SELECT name, name_is_default FROM scenes ORDER BY id`)
		).map((r) => [String(r.name), r.name_is_default])
	)

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(
		`CREATE TABLE scenes (id serial PRIMARY KEY, name text, name_is_default boolean NOT NULL DEFAULT false)`
	)
}, 60_000)

afterEach(async () => {
	await client.close()
})

describe("0142: automatic scene names are marked default", () => {
	it("marks `Scene N` and `Scene N · …`, never a person's own name", async () => {
		for (const name of [
			"Scene 1",
			"Scene 3 · the Crypt · Day 2",
			"Scene 12 · Year 4, Mo. 2, Day 9",
			"The duel at dawn",
			"Scene one",
			"Scene 2: the Crypt",
			"Scenes 1 · 2",
			"A Scene 3"
		])
			await q(`INSERT INTO scenes (name) VALUES ('${name}')`)
		await q(`INSERT INTO scenes (name) VALUES (NULL)`)
		await upgrade()
		expect(markedCount(await marks())).toBe(3)
		expect(await marks()).toEqual({
			"Scene 1": true,
			"Scene 3 · the Crypt · Day 2": true,
			"Scene 12 · Year 4, Mo. 2, Day 9": true,
			"The duel at dawn": false,
			"Scene one": false,
			"Scene 2: the Crypt": false,
			"Scenes 1 · 2": false,
			"A Scene 3": false,
			null: false
		})
	}, 60_000)

	it("a second run changes nothing", async () => {
		await q(`INSERT INTO scenes (name) VALUES ('Scene 1'), ('Mine')`)
		await upgrade()
		expect(markedCount(await marks())).toBe(1)
		const first = await marks()
		await upgrade()
		expect(await marks()).toEqual(first)
	}, 60_000)
})
