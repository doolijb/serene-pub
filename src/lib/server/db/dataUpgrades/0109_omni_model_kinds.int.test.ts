/**
 * The 0109 data upgrade (O3): each generating model's single modality becomes
 * what it WRITES; what it reads stays unstated; embedding and NER models, and
 * models the host said nothing about, are left alone. A scratch table with the
 * columns the upgrade touches, so the SQL is what is under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"
import { run } from "./0109_omni_model_kinds"

let client: PGlite
let db: any

const q = (s: string) => db.execute(sql.raw(s))
const rows = async <T extends Record<string, unknown>>(s: string): Promise<T[]> =>
	rawRows<T>(await q(s))

beforeEach(async () => {
	client = new PGlite()
	db = drizzle(client)
	await q(`CREATE TABLE connection_models (id integer PRIMARY KEY, modality text, reads json, writes json)`)
	await q(`INSERT INTO connection_models (id, modality, reads, writes) VALUES
		(1, 'text-gen', null, null),
		(2, 'image-gen', null, null),
		(3, 'embeddings', null, null),
		(4, 'ner', null, null),
		(5, null, null, null),
		(6, 'tts', null, null),
		(7, 'text-gen', null, '["text","audio"]')`)
}, 60_000)

afterEach(async () => {
	await client.close()
})

describe("0109 omni model kinds", () => {
	it("writes what each generating model was for; reads stay unstated; the rest untouched", async () => {
		await db.transaction(async (tx: any) => run(tx, {} as any))
		const got = await rows<{ id: number; reads: unknown; writes: unknown }>(
			`SELECT id, reads, writes FROM connection_models ORDER BY id`
		)
		expect(got).toEqual([
			{ id: 1, reads: null, writes: ["text"] },
			{ id: 2, reads: null, writes: ["image"] },
			{ id: 3, reads: null, writes: null },
			{ id: 4, reads: null, writes: null },
			{ id: 5, reads: null, writes: null },
			{ id: 6, reads: null, writes: ["audio"] },
			// Already stated: kept.
			{ id: 7, reads: null, writes: ["text", "audio"] }
		])
	}, 60_000)

	it("is idempotent", async () => {
		await db.transaction(async (tx: any) => run(tx, {} as any))
		await db.transaction(async (tx: any) => run(tx, {} as any))
		const [one] = await rows<{ writes: unknown }>(`SELECT writes FROM connection_models WHERE id = 1`)
		expect(one.writes).toEqual(["text"])
	}, 60_000)
})
