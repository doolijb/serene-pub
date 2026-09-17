/**
 * 0128: connections have no default model — every selection names an explicit
 * (endpoint, model) pair.
 *
 * This file replaces the 0114 backfill pinning this file used to hold. The
 * `connections.model` column and `connection_models.is_default` are gone
 * (drizzle/0128_organic_wild_child.sql), so there is no backfill left to
 * replay: `SELECT model FROM connections` and `INSERT ... is_default` both
 * fail against the current schema. What survives of the old safety argument
 * is the explicit-pair equivalent:
 *
 * - `ensureConnectionModel` creates exactly one row for an identifier, copying
 *   nothing else, so the merged pair resolves byte-identically to the endpoint
 *   it hangs off;
 * - a blank identifier creates nothing (the check constraint would refuse it);
 * - creating the same identifier twice returns the row rather than duplicating;
 * - an endpoint-only `connection_defaults` registration resolves as incomplete
 *   rather than guessing a row.
 */

import { describe, expect, it, beforeAll, vi } from "vitest"
import { asc, eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	ensureConnectionModel,
	mergeEndpointModel
} from "$lib/server/connections/models"
import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY
} from "$lib/server/connections/capabilityTarget"
import { setCapabilityDefault } from "$lib/server/connections/capabilityDefaults"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

/** A bare endpoint — no model column exists anymore. */
async function endpoint(over: Partial<InsertConnection> = {}) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: `fixture ${Math.random()}`,
			type: CONNECTION_TYPE.OLLAMA,
			baseUrl: "http://localhost",
			...over
		} as InsertConnection)
		.returning()
	return row
}

async function modelsOf(connectionId: number) {
	return await db
		.select()
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.connectionId, connectionId))
		.orderBy(asc(schema.connectionModels.id))
}

describe("explicit model rows", () => {
	it("creates exactly one row naming the same identifier", async () => {
		const e = await endpoint()
		const m = (await ensureConnectionModel(
			db,
			e.id,
			"llama3.1:8b"
		))!
		expect(m).toBeTruthy()
		const models = await modelsOf(e.id)
		expect(models).toHaveLength(1)
		expect(models[0].model).toBe("llama3.1:8b")
		// The display name defaults to the identifier, so a row nobody renamed
		// reads on screen the way it always did.
		expect(models[0].name).toBe("llama3.1:8b")
		expect(models[0].enabled).toBe(true)
		expect(models[0].connectionId).toBe(e.id)
	}, 60_000)

	it("copies NOTHING but the identifier, so the merge is byte-identical", async () => {
		// The whole safety argument in one assertion: every per-model setting
		// starts empty, so `endpoint ?? model` resolves to the endpoint's value
		// for every explicitly created row. A helper that copied
		// `prompt_format` down would look harmless and would pin the template at
		// creation time — changing the endpoint's would then stop reaching the
		// model, silently, forever.
		const e = await endpoint({
			type: CONNECTION_TYPE.OPENAI,
			promptFormat: "vicuna",
			tokenCounter: "openai",
			capabilities: { resolved: { "text->text": 1 } }
		})
		const m = (await ensureConnectionModel(db, e.id, "gpt-4o"))!
		expect(m.promptFormat).toBeNull()
		expect(m.tokenCounter).toBeNull()
		expect(m.contextWindow).toBeNull()
		expect(m.capabilities).toEqual({})
		expect(m.extraJson).toEqual({})
		// And the merge falls through to the endpoint for everything unstated.
		const pair = mergeEndpointModel(e, m)
		expect(pair.model).toBe("gpt-4o")
		expect(pair.promptFormat).toBe("vicuna")
		expect(pair.tokenCounter).toBe("openai")
	}, 60_000)

	it("leaves an endpoint with no models and no rows", async () => {
		// No row means nobody finished setting this endpoint up, and inventing
		// a model row for it would make an unusable endpoint look configured
		// in every picker.
		const e = await endpoint()
		expect(await modelsOf(e.id)).toEqual([])
	}, 60_000)

	it("creates no row for a blank identifier", async () => {
		// `''` reaches here from a form field somebody cleared. The check
		// constraint on `connection_models` refuses it outright, so a helper
		// that did not filter would abort the whole save with a constraint
		// error rather than the endpoint it was for.
		const e = await endpoint()
		expect(await ensureConnectionModel(db, e.id, "")).toBeUndefined()
		expect(await ensureConnectionModel(db, e.id, "   ")).toBeUndefined()
		expect(await ensureConnectionModel(db, e.id, null)).toBeUndefined()
		expect(await modelsOf(e.id)).toEqual([])
	}, 60_000)

	it("is idempotent — ensuring the same identifier twice adds nothing", async () => {
		// The managed flows run "find or create the connection for this gguf",
		// and a restored backup replayed over a partly-filled database is a
		// real support path. Re-running must not produce a second row, which
		// the (connection_id, model) unique index would refuse anyway — better
		// to say so here than to find out at 3am.
		const e = await endpoint()
		const first = (await ensureConnectionModel(
			db,
			e.id,
			"mistral:7b"
		))!
		const second = (await ensureConnectionModel(
			db,
			e.id,
			"mistral:7b"
		))!
		expect(second.id).toBe(first.id)
		expect(await modelsOf(e.id)).toHaveLength(1)
	}, 60_000)

	it("resolves an endpoint-only registration as incomplete, not as a guess", async () => {
		// NULL means nobody chose a model, and connections have no default to
		// fall back to. The resolver refuses with the fix attached rather than
		// picking a row.
		const e = await endpoint({
			capabilities: { resolved: { "text->text": 1 } }
		})
		const m = (await ensureConnectionModel(
			db,
			e.id,
			"llama3.1:70b"
		))!
		await db.insert(schema.connectionDefaults).values({
			input: "text",
			output: "text",
			connectionId: e.id,
			connectionModelId: null
		})
		const bare = await resolveCapabilityTarget(db, {
			capability: TEXT_CAPABILITY
		})
		expect(bare.ok).toBe(false)
		if (bare.ok) return
		expect(bare.problem.kind).toBe("model")
		expect(bare.problem.message).toMatch(/No model is chosen/i)
		// Naming the pair explicitly resolves to it.
		await setCapabilityDefault(db, TEXT_CAPABILITY, {
			connectionId: e.id,
			connectionModelId: m.id
		})
		const paired = await resolveCapabilityTarget(db, {
			capability: TEXT_CAPABILITY
		})
		expect(paired.ok).toBe(true)
		if (!paired.ok) return
		expect(paired.connection.model).toBe("llama3.1:70b")
		expect(paired.connection.connectionModelId).toBe(m.id)
	}, 60_000)
})
