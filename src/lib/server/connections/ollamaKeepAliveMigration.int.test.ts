/**
 * 0108: the SEEDED `keepAlive` of "300ms" is lifted off Ollama connections.
 *
 * `OllamaAdapter.generateText()` read `extraJson?.keepAlive || "300ms"`, so a
 * connection dropped its weights a third of a second after each turn and paid
 * the reload before the next reply's first token. Moving that fallback to "5m"
 * is not the fix on its own: `CONNECTION_DEFAULTS[ollama]` seeded the same
 * string and `OllamaForm.extraFieldsToExtraJson` writes the field back
 * unconditionally, so the value sits in every saved row's OWN `extra_json` —
 * where it outranks any fallback. This file is what reaches those rows.
 *
 * What it has to prove is the WHERE clause as much as the SET: an `UPDATE` that
 * matched too widely would take back memory from somebody who chose a short
 * keep-alive, or write an Ollama-shaped key onto a connection that has no such
 * setting. So three rows go in and one comes out changed.
 *
 * ⚠ It runs against the REAL migration file, replayed over the table the way a
 * real upgrade applies it — `createTestDb` has already applied every migration
 * on creation, so a row written afterwards has never met this one.
 */

import { describe, expect, it, beforeAll, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb

const MIGRATION = "drizzle/0108_ollama_keep_alive_default.sql"

/** The three pre-upgrade rows, read back after the one statement runs. */
let seeded: Awaited<ReturnType<typeof seed>>

async function insert(
	name: string,
	type: string,
	extraJson: Record<string, unknown>
) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name,
			type,
			baseUrl: "http://localhost:11434/",
			model: "m",
			extraJson,
			capabilities: {}
		})
		.returning()
	return row
}

async function read(id: number) {
	const [row] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, id))
		.limit(1)
	return row
}

/**
 * Write all three rows, then run 0108 ONCE over the populated table.
 *
 * One statement across all three is the point rather than a convenience: a
 * migration replayed against a table holding only its target would satisfy
 * every assertion about the target while saying nothing about what else it
 * touches.
 */
async function seed() {
	const target = await insert(
		"ollama, never touched the field",
		CONNECTION_TYPE.OLLAMA,
		// `stream` and `think` are the form's other two writes. They are here to
		// be found unchanged: `extra_json` is the adapter's shared bag, and a
		// migration that rebuilt the column instead of merging into it would
		// take them with it.
		{ stream: false, think: true, keepAlive: "300ms" }
	)
	const chosen = await insert(
		"ollama, somebody moved the number",
		CONNECTION_TYPE.OLLAMA,
		{ stream: false, think: false, keepAlive: "2m" }
	)
	const otherType = await insert(
		"openai, unrelated keepAlive",
		CONNECTION_TYPE.OPENAI,
		{ stream: true, apiKey: "", keepAlive: "300ms" }
	)

	const { readFileSync } = await import("node:fs")
	const { resolve } = await import("node:path")
	const migrationSql = readFileSync(
		resolve(process.cwd(), MIGRATION),
		"utf8"
	)
	await db.execute(sql.raw(migrationSql))

	return {
		target: await read(target.id),
		chosen: await read(chosen.id),
		otherType: await read(otherType.id)
	}
}

beforeAll(async () => {
	db = await createTestDb()
	seeded = await seed()
}, 60_000)

describe("0108 lifts the seeded keep-alive off Ollama connections", () => {
	it("rewrites the exact seeded value", async () => {
		// The whole of the migration's job. "5m" is Ollama's own default and
		// the adapter's new fallback — the row stops overriding it with the
		// value nobody picked.
		expect((seeded.target.extraJson as any).keepAlive).toBe("5m")
	}, 60_000)

	it("leaves the rest of that row's extraJson alone", async () => {
		// A `||` merge, asserted rather than trusted: only `keepAlive` is on the
		// right-hand side, so `stream: false` — which is NOT the seeded default
		// for it — and `think: true` both have to survive intact, and no key may
		// appear that was not already there.
		expect(seeded.target.extraJson).toEqual({
			stream: false,
			think: true,
			keepAlive: "5m"
		})
	}, 60_000)
})

describe("what it deliberately leaves alone", () => {
	it("does not touch an Ollama row whose keep-alive somebody chose", async () => {
		// The value half of the WHERE clause. "2m" came from a person moving the
		// number or the unit, and a migration cannot tell a short keep-alive
		// that was chosen from one that was merely never asked about — so it
		// only ever claims the one string the seed wrote.
		expect(seeded.chosen.extraJson).toEqual({
			stream: false,
			think: false,
			keepAlive: "2m"
		})
	}, 60_000)

	it("does not touch another connection type carrying the same string", async () => {
		// The type half. `keepAlive` means nothing to the OpenAI adapter, which
		// is exactly why a statement keyed only on the value would go unnoticed
		// here — and `extra_json` is spread verbatim by every form, so a key
		// rewritten on a type that never reads it is a silent edit to somebody
		// else's bag.
		expect(seeded.otherType.extraJson).toEqual({
			stream: true,
			apiKey: "",
			keepAlive: "300ms"
		})
		expect(seeded.otherType.type).toBe(CONNECTION_TYPE.OPENAI)
	}, 60_000)
})
