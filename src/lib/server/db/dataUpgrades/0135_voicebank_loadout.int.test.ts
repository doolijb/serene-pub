/**
 * The 0135 data upgrade (voice loadouts): every voicebank row with no loadout
 * gets the `text->audio` loadout on its model, else the default, else the
 * Narration seed. Scratch tables with the columns the SQL touches.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { backfillVoicebankLoadouts } from "./0135_voicebank_loadout"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async (s: string): Promise<any[]> => rawRows<any>(await q(s))
const upgrade = () => db.transaction(async (tx: any) => backfillVoicebankLoadouts(tx))
const assigned = async () =>
	Object.fromEntries((await rows(`SELECT slug, loadout_id FROM voicebank_voices ORDER BY id`)).map((r) => [r.slug, r.loadout_id]))

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(
		`CREATE TABLE loadouts (id serial PRIMARY KEY, name text, seed_key text, transform text NOT NULL, merged_into int, connection_id int, connection_model_id int, default_for_input text, default_for_output text)`
	)
	await q(
		`CREATE TABLE voicebank_voices (id serial PRIMARY KEY, slug text, connection_model_id int, loadout_id int)`
	)
}, 60_000)

afterEach(async () => {
	await client.close()
})

const loadout = async (name: string, f: { model?: number; seed?: string; dflt?: boolean; mergedInto?: number; transform?: string } = {}) => {
	const [r] = await rows(
		`INSERT INTO loadouts (name, seed_key, transform, merged_into, connection_id, connection_model_id, default_for_input, default_for_output)
		 VALUES ('${name}', ${f.seed ? `'${f.seed}'` : "NULL"}, '${f.transform ?? "text->audio"}', ${f.mergedInto ?? "NULL"}, ${f.model ? 1 : "NULL"}, ${f.model ?? "NULL"},
		 ${f.dflt ? "'text'" : "NULL"}, ${f.dflt ? "'audio'" : "NULL"}) RETURNING id`
	)
	return r.id as number
}
const voice = (slug: string, model: number | null, loadout: number | null = null) =>
	q(`INSERT INTO voicebank_voices (slug, connection_model_id, loadout_id) VALUES ('${slug}', ${model ?? "NULL"}, ${loadout ?? "NULL"})`)

describe("0135 voicebank loadout back-fill", () => {
	it("matches by model (through a merge root), else the default, else the Narration seed", async () => {
		const narr = await loadout("Narration", { model: 10, seed: "core:loadout/tts@1" })
		const other = await loadout("Other", { model: 20 })
		const child = await loadout("Child", { mergedInto: other })
		const dflt = await loadout("Chosen default", { model: 30, dflt: true })
		await loadout("Reply", { model: 40, transform: "text->text" })
		await voice("on-other", 20)
		await voice("on-narration", 10)
		await voice("unknown-model", 99)
		await voice("no-model", null)
		expect(await upgrade()).toBe(4)
		const got = await assigned()
		// Lowest id wins when a root and its child both resolve to the model.
		expect(got["on-other"]).toBe(other)
		expect(got["on-narration"]).toBe(narr)
		expect(got["unknown-model"]).toBe(dflt)
		expect(got["no-model"]).toBe(dflt)
		expect(child).toBeGreaterThan(other)
	}, 60_000)

	it("falls to the Narration seed when no default is flagged; leaves a row alone with no speech loadout", async () => {
		const narr = await loadout("Narration", { seed: "core:loadout/tts@1" })
		await voice("a", 5)
		await upgrade()
		expect((await assigned()).a).toBe(narr)
		await q(`DELETE FROM loadouts`)
		await q(`UPDATE voicebank_voices SET loadout_id = NULL`)
		expect(await upgrade()).toBe(0)
		expect((await assigned()).a).toBeNull()
	}, 60_000)

	it("keeps a row that already has a loadout, and a second run changes nothing; an empty table (fresh install) is a no-op", async () => {
		expect(await upgrade()).toBe(0)
		const mine = await loadout("Mine", { model: 1 })
		const dflt = await loadout("Default", { model: 2, dflt: true })
		await voice("kept", 2, mine)
		await voice("fresh", 2)
		expect(await upgrade()).toBe(1)
		const once = await assigned()
		expect(once).toEqual({ kept: mine, fresh: dflt })
		expect(await upgrade()).toBe(0)
		expect(await assigned()).toEqual(once)
	}, 60_000)
})
