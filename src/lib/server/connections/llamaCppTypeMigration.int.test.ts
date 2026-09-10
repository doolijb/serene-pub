/**
 * 0105: a llama.cpp connection survives its type id being renamed.
 *
 * `llamacpp_completion` was the one `CONNECTION_TYPE` id that encoded a WIRE
 * MODE, and wire mode has been a capability since 0098. Ruling 2026-09-08 —
 * one connection type per service, wire mode as a property — renamed it to
 * `llamacpp` and gave `LlamaCppAdapter` the chat leg it never had.
 *
 * A rename with no migration would not merely look stale on the row. Two things
 * on the SEND path break for an id nothing declares:
 *
 *   · `ADAPTER_REGISTRY` has no entry, so `getConnectionAdapter` throws;
 *   · `adapterCapabilities` is undefined, so `declaredWireModes` is empty and
 *     `wireModeFor` falls to its last resort, `chat` — the opposite of what the
 *     row was being called by.
 *
 * Both are asserted below, on a row REGRESSED to the old id first. Without that
 * regression the file would pass vacuously: `createTestDb` applies 0105 on
 * creation, so a row inserted afterwards never meets it.
 *
 * ⚠ It runs against the REAL migration file, the way a real upgrade applies it.
 */

import { describe, expect, it, beforeAll, vi } from "vitest"
import { eq, sql } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { resolveWireMode } from "$lib/server/connections/resolve"
import { ADAPTER_REGISTRY } from "$lib/server/adapters/registry"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb

const MIGRATION = "drizzle/0105_llamacpp_service_type.sql"
const OLD_TYPE = "llamacpp_completion"

let migrationSql: string

beforeAll(async () => {
	db = await createTestDb()
	const { readFileSync } = await import("node:fs")
	const { resolve } = await import("node:path")
	migrationSql = readFileSync(resolve(process.cwd(), MIGRATION), "utf8")
}, 60_000)

/**
 * Insert a row, REGRESS it to the pre-0105 id, then replay 0105 over the table.
 *
 * The regression is the whole reason this proves anything. `createTestDb` has
 * already applied every migration including this one, so a row written with the
 * old id through the normal insert would be indistinguishable from one written
 * after the upgrade — and the assertions would hold whether the migration
 * existed or not.
 */
async function migrated(overrides: Record<string, unknown> = {}) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: `fixture ${JSON.stringify(overrides)}`,
			type: CONNECTION_TYPE.LLAMACPP,
			baseUrl: "http://localhost:8080",
			model: "m",
			extraJson: {},
			capabilities: {},
			...overrides
		})
		.returning()
	await db.execute(
		sql`UPDATE connections SET type = ${OLD_TYPE} WHERE id = ${row.id}`
	)
	const [before] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, row.id))
		.limit(1)
	expect(before.type).toBe(OLD_TYPE)

	await db.execute(sql.raw(migrationSql))
	const [after] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, row.id))
		.limit(1)
	return after
}

describe("0105 carries a llama.cpp connection onto the service type id", () => {
	it("rewrites the type and leaves everything else on the row alone", async () => {
		const row = await migrated({
			name: "my llama server",
			baseUrl: "http://192.168.1.9:8080",
			model: "qwen3-30b.gguf",
			promptFormat: "chatml",
			extraJson: { stream: true },
			capabilities: {
				overrides: { "text+image->text": false },
				probe: { found: { "text->text": 1 }, at: "2026-01-01T00:00:00Z" }
			}
		})
		expect(row.type).toBe(CONNECTION_TYPE.LLAMACPP)
		expect(row.type).toBe("llamacpp")
		// A type rename is a rename and nothing else. The durable halves of
		// `capabilities` in particular: a person may have switched vision off by
		// hand, and 0098's precedent is that a migration merges into those
		// rather than replacing them.
		expect(row.name).toBe("my llama server")
		expect(row.baseUrl).toBe("http://192.168.1.9:8080")
		expect(row.model).toBe("qwen3-30b.gguf")
		expect(row.promptFormat).toBe("chatml")
		expect(row.extraJson).toEqual({ stream: true })
		expect((row.capabilities as any).overrides).toEqual({
			"text+image->text": false
		})
		expect((row.capabilities as any).probe?.at).toBe(
			"2026-01-01T00:00:00Z"
		)
	}, 60_000)

	it("keeps the row on the COMPLETION leg it was already being called by", async () => {
		// ⚠ The mutation the whole migration is sized around. `wire_chat` is
		// declared on the new type but NOT defaulted, so `resolveCapabilities`
		// gives it a model grade of 0 and the row resolves to completion —
		// exactly what `llamacpp_completion` did. Defaulting chat in the
		// manifest instead would re-tune every upgrading install on the send
		// path, with nothing reporting it.
		const row = await migrated()
		expect(resolveWireMode(row as any)).toBe("completion")
	}, 60_000)

	it("gives the row back an adapter — the old id has none", async () => {
		// The half that is not cosmetic. An unmigrated row asks
		// `getConnectionAdapter` for a type the registry does not carry.
		expect(ADAPTER_REGISTRY[OLD_TYPE]).toBeUndefined()
		const row = await migrated()
		expect(ADAPTER_REGISTRY[row.type!]?.text).toBeTypeOf("function")
	}, 60_000)

	it("leaves every other connection type untouched", async () => {
		// The `WHERE` clause, stated. A migration that rewrote the column
		// unconditionally would pass every assertion above — this row is never
		// regressed, so it is only reachable by a statement that matches too
		// widely.
		const [ollama] = await db
			.insert(schema.connections)
			.values({
				name: "untouched ollama",
				type: CONNECTION_TYPE.OLLAMA,
				baseUrl: "http://localhost:11434",
				model: "llama3",
				extraJson: {},
				capabilities: {}
			})
			.returning()
		await db.execute(sql.raw(migrationSql))
		const [after] = await db
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.id, ollama.id))
			.limit(1)
		expect(after.type).toBe(CONNECTION_TYPE.OLLAMA)
	}, 60_000)
})
