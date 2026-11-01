/**
 * The 0137 data upgrade (narration fallback): the voicebank stars become the
 * loadout voice. Scratch tables with the columns the SQL touches.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { moveStarsToLoadoutVoices } from "./0137_loadout_voices"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async (s: string): Promise<any[]> => rawRows<any>(await q(s))
const upgrade = () => db.transaction(async (tx: any) => moveStarsToLoadoutVoices(tx))
const voices = async () =>
	Object.fromEntries(
		(await rows(`SELECT name, default_voice_id FROM loadouts ORDER BY id`)).map((r) => [r.name, r.default_voice_id])
	)

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(`CREATE TABLE loadouts (id serial PRIMARY KEY, name text, default_voice_id int)`)
	await q(
		`CREATE TABLE voicebank_voices (id serial PRIMARY KEY, slug text, loadout_id int, is_default boolean NOT NULL DEFAULT false, is_narration_default boolean NOT NULL DEFAULT false)`
	)
}, 60_000)

afterEach(async () => {
	await client.close()
})

const loadout = async (name: string, voice: number | null = null) =>
	(await rows(`INSERT INTO loadouts (name, default_voice_id) VALUES ('${name}', ${voice ?? "NULL"}) RETURNING id`))[0].id as number
const voice = async (slug: string, loadoutId: number | null, f: { dflt?: boolean; narr?: boolean } = {}) =>
	(
		await rows(
			`INSERT INTO voicebank_voices (slug, loadout_id, is_default, is_narration_default)
			 VALUES ('${slug}', ${loadoutId ?? "NULL"}, ${!!f.dflt}, ${!!f.narr}) RETURNING id`
		)
	)[0].id as number

describe("0137 stars become the loadout voice", () => {
	it("both stars on one loadout: the default star wins", async () => {
		const l = await loadout("Narration")
		const a = await voice("a", l, { dflt: true })
		await voice("b", l, { narr: true })
		await upgrade()
		expect((await voices()).Narration).toBe(a)
	}, 60_000)

	it("stars on two loadouts: each gets its own", async () => {
		const l1 = await loadout("One")
		const l2 = await loadout("Two")
		const a = await voice("a", l1, { dflt: true })
		const b = await voice("b", l2, { narr: true })
		await upgrade()
		expect(await voices()).toEqual({ One: a, Two: b })
	}, 60_000)

	it("a starred unassigned row does nothing; no stars is a no-op", async () => {
		await loadout("Narration")
		await voice("a", null, { dflt: true })
		await voice("b", null, { narr: true })
		expect(await upgrade()).toBe(0)
		await q(`UPDATE voicebank_voices SET is_default = false, is_narration_default = false`)
		expect(await upgrade()).toBe(0)
		expect((await voices()).Narration).toBeNull()
	}, 60_000)

	it("a loadout that already has a voice is untouched; a second run changes nothing", async () => {
		const l = await loadout("Narration")
		const keep = await loadout("Has one")
		const own = await voice("own", keep)
		await voice("a", keep, { dflt: true })
		const b = await voice("b", l, { narr: true })
		await q(`UPDATE loadouts SET default_voice_id = ${own} WHERE id = ${keep}`)
		await upgrade()
		const first = await voices()
		expect(first).toEqual({ Narration: b, "Has one": own })
		await upgrade()
		expect(await voices()).toEqual(first)
	}, 60_000)
})
