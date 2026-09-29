/**
 * The availability ruling (2026-09-14), as behaviour:
 *
 *   - a listing POPULATES: every identifier the host names gets a row;
 *   - a listing MARKS: a row the host stops naming is `missing_since` now,
 *     and stays at that first value on later syncs;
 *   - a listing RESTORES: a row the host names again is cleared;
 *   - a FAILED listing touches no row and records the error on the endpoint;
 *   - a missing model is unavailable globally — the star refuses it, the
 *     resolver refuses it at dispatch, and it satisfies no transform.
 *
 * Real PGlite: three of the five are database behaviour, and the resolver's
 * refusal is a join.
 */

import { beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => [],
	isLocalEmbeddingSupported: async () => false
}))

let db: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

/**
 * What the "host" lists, swapped per test. The sync reaches the adapter
 * through `getConnectionAdapter`, so mocking that one loader is enough for a
 * text-family type.
 */
let hostListing: { models: unknown[]; error?: string } = { models: [] }
/**
 * How long the "host" takes to answer. Zero for every test but the concurrency
 * one, where the whole question is what happens between the read and the write.
 */
let hostDelayMs = 0
vi.mock("$lib/server/utils/getConnectionAdapter", () => ({
	getConnectionAdapter: async () => ({
		listModels: async () => {
			if (hostDelayMs)
				await new Promise((r) => setTimeout(r, hostDelayMs))
			return hostListing
		},
		testConnection: async () => ({ ok: true })
	})
}))

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db
		.insert(schema.systemSettings)
		.values({ id: 1 })
		.onConflictDoNothing()
}, 120_000)

const admin = () =>
	({
		user: { id: 1, isAdmin: true },
		io: { to: () => ({ emit: () => {} }) }
	}) as any
const noop = () => {}

async function endpoint(name: string) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: `${name} ${Math.random()}`,
			type: CONNECTION_TYPE.OLLAMA,
			baseUrl: "http://localhost:11434",
			modality: "text-gen",
			capabilities: { resolved: { "text->text": "native" } }
		})
		.returning()
	return row
}

const modelsOf = (connectionId: number) =>
	db
		.select()
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.connectionId, connectionId))
		.orderBy(schema.connectionModels.model)

const endpointRow = (id: number) =>
	db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, id))
		.then((r) => r[0])

describe("syncConnectionModels — one listing, one endpoint", () => {
	test("populates a row per listed identifier, enabled, named as listed", async () => {
		const { syncConnectionModels } = await import("./modelSync")
		const c = await endpoint("populate")
		const res = await syncConnectionModels(db, c.id, {
			models: [
				{ model: "llama3.1:8b", name: "Llama 3.1 8B" },
				{ model: "qwen2.5:7b" }
			]
		})
		expect(res).toMatchObject({
			added: 2,
			restored: 0,
			missing: 0,
			listed: 2,
			error: null
		})
		const rows = await modelsOf(c.id)
		expect(
			rows.map((r) => [r.model, r.name, r.enabled, r.missingSince])
		).toEqual([
			["llama3.1:8b", "Llama 3.1 8B", true, null],
			["qwen2.5:7b", "qwen2.5:7b", true, null]
		])
		const ep = await endpointRow(c.id)
		expect(ep.modelsSyncedAt).toBeInstanceOf(Date)
		expect(ep.modelsSyncError).toBeNull()
	})

	test("adopts the listed display name for a row nobody renamed, and only that row", async () => {
		const { syncConnectionModels } = await import("./modelSync")
		const c = await endpoint("rename")
		// Two rows that predate any listing: one bare, one a person named.
		await db.insert(schema.connectionModels).values([
			{ connectionId: c.id, model: "claude-x", name: "claude-x" },
			{ connectionId: c.id, model: "claude-y", name: "My Y" }
		])
		await syncConnectionModels(db, c.id, {
			models: [
				{ model: "claude-x", name: "Claude X" },
				{ model: "claude-y", name: "Claude Y" }
			]
		})
		const rows = await modelsOf(c.id)
		expect(rows.map((r) => [r.model, r.name])).toEqual([
			["claude-x", "Claude X"],
			["claude-y", "My Y"]
		])
	})

	test("is idempotent: the same listing twice adds nothing", async () => {
		const { syncConnectionModels } = await import("./modelSync")
		const c = await endpoint("idempotent")
		await syncConnectionModels(db, c.id, { models: ["a", "b"] })
		const again = await syncConnectionModels(db, c.id, {
			models: ["a", "b"]
		})
		expect(again.added).toBe(0)
		expect((await modelsOf(c.id)).length).toBe(2)
	})

	test("marks a known model missing when the host stops listing it, keeps the first time, restores on return", async () => {
		const { syncConnectionModels } = await import("./modelSync")
		const c = await endpoint("vanish")
		await syncConnectionModels(db, c.id, { models: ["keep", "gone"] })

		const t1 = new Date("2026-09-14T10:00:00Z")
		const r1 = await syncConnectionModels(
			db,
			c.id,
			{ models: ["keep"] },
			t1
		)
		expect(r1).toMatchObject({ added: 0, restored: 0, missing: 1 })
		let rows = await modelsOf(c.id)
		expect(rows.find((r) => r.model === "gone")!.missingSince).toEqual(t1)
		expect(rows.find((r) => r.model === "keep")!.missingSince).toBeNull()
		// The row survives: its overrides and the selections naming it must
		// outlive the model's absence.
		expect(rows.length).toBe(2)

		// A later sync that still does not list it keeps the FIRST time.
		const t2 = new Date("2026-09-14T11:00:00Z")
		const r2 = await syncConnectionModels(
			db,
			c.id,
			{ models: ["keep"] },
			t2
		)
		expect(r2.missing).toBe(1)
		rows = await modelsOf(c.id)
		expect(rows.find((r) => r.model === "gone")!.missingSince).toEqual(t1)

		// Listed again: cleared.
		const r3 = await syncConnectionModels(db, c.id, {
			models: ["keep", "gone"]
		})
		expect(r3).toMatchObject({ added: 0, restored: 1, missing: 0 })
		rows = await modelsOf(c.id)
		expect(rows.every((r) => r.missingSince === null)).toBe(true)
	})

	test("a failed listing touches no row and records the error on the endpoint", async () => {
		const { syncConnectionModels } = await import("./modelSync")
		const c = await endpoint("unreachable")
		await syncConnectionModels(db, c.id, { models: ["a"] })
		const before = await modelsOf(c.id)

		const res = await syncConnectionModels(db, c.id, {
			models: [],
			error: "connect ECONNREFUSED"
		})
		expect(res.error).toBe("connect ECONNREFUSED")
		expect(res.added).toBe(0)
		const after = await modelsOf(c.id)
		expect(after).toEqual(before)
		const ep = await endpointRow(c.id)
		expect(ep.modelsSyncError).toBe("connect ECONNREFUSED")

		// And a later success clears the error.
		await syncConnectionModels(db, c.id, { models: ["a"] })
		expect((await endpointRow(c.id)).modelsSyncError).toBeNull()
	})

	test("an empty successful listing marks every row missing — the host really serves nothing", async () => {
		const { syncConnectionModels } = await import("./modelSync")
		const c = await endpoint("empty")
		await syncConnectionModels(db, c.id, { models: ["only"] })
		const res = await syncConnectionModels(db, c.id, { models: [] })
		expect(res.missing).toBe(1)
		expect((await modelsOf(c.id))[0].missingSince).not.toBeNull()
	})
})

describe("a model's modality, as the listing says", () => {
	test("is stored on insert, replaced when the host revises it, cleared when it stops saying", async () => {
		const { syncConnectionModels } = await import("./modelSync")
		const c = await endpoint("modality")
		await syncConnectionModels(db, c.id, {
			models: [
				{ model: "nomic-embed-text", modality: "embeddings" },
				{ model: "llama3.1:8b", modality: "text-gen" },
				{ model: "mystery" }
			]
		})
		const first = await modelsOf(c.id)
		expect(first.map((r) => [r.model, r.modality])).toEqual([
			["llama3.1:8b", "text-gen"],
			["mystery", null],
			["nomic-embed-text", "embeddings"]
		])

		await syncConnectionModels(db, c.id, {
			models: [
				{ model: "nomic-embed-text", modality: "embeddings" },
				// An older host: no capabilities array, so nothing claimed.
				{ model: "llama3.1:8b" },
				{ model: "mystery", modality: "text-gen" }
			]
		})
		const second = await modelsOf(c.id)
		expect(second.map((r) => [r.model, r.modality])).toEqual([
			["llama3.1:8b", null],
			["mystery", "text-gen"],
			["nomic-embed-text", "embeddings"]
		])
	})

	test("an embedding model on a chat-and-embed endpoint satisfies only embeddings", async () => {
		const { syncConnectionModels } = await import("./modelSync")
		const { mergeEndpointModel } = await import("./models")
		const { capabilityRefusal } = await import(
			"$lib/server/pipelines/runtime/capabilityGuard"
		)
		const [c] = await db
			.insert(schema.connections)
			.values({
				name: `both ${Math.random()}`,
				type: CONNECTION_TYPE.OLLAMA,
				baseUrl: "http://both.test:11434",
				modality: "text-gen",
				capabilities: {
					resolved: { "text->text": 2, "text->embedding": 2 }
				}
			})
			.returning()
		await syncConnectionModels(db, c.id, {
			models: [
				{ model: "nomic-embed-text", modality: "embeddings" },
				{ model: "llama3.1:8b", modality: "text-gen" }
			]
		})
		const [chat, embed] = await modelsOf(c.id)
		const pair = (m: typeof chat) => mergeEndpointModel(c as any, m as any)
		expect(capabilityRefusal(pair(embed), "text->text")).not.toBeNull()
		expect(capabilityRefusal(pair(embed), "text->embedding")).toBeNull()
		expect(capabilityRefusal(pair(chat), "text->embedding")).not.toBeNull()
		expect(capabilityRefusal(pair(chat), "text->text")).toBeNull()
	})
})

describe("syncConnectionModelsById — staleness and the adapter", () => {
	test("skips a fresh listing unless forced, and asks the host when forced", async () => {
		const { syncConnectionModelsById } = await import("./modelSync")
		const c = await endpoint("stale")
		hostListing = { models: ["first"] }
		const one = await syncConnectionModelsById(db, c.id)
		expect(one?.result.added).toBe(1)

		hostListing = { models: ["first", "second"] }
		expect(await syncConnectionModelsById(db, c.id)).toBeNull()
		expect((await modelsOf(c.id)).length).toBe(1)

		const forced = await syncConnectionModelsById(db, c.id, { force: true })
		expect(forced?.result.added).toBe(1)
		expect(forced?.listing.models).toEqual(["first", "second"])
	})

	test("an unknown endpoint is null", async () => {
		const { syncConnectionModelsById } = await import("./modelSync")
		expect(await syncConnectionModelsById(db, 999_999)).toBeNull()
	})
})

describe("a missing model is unavailable globally", () => {
	async function endpointWithMissing() {
		const { syncConnectionModels } = await import("./modelSync")
		const c = await endpoint("global")
		await syncConnectionModels(db, c.id, { models: ["ok", "gone"] })
		await syncConnectionModels(db, c.id, { models: ["ok"] })
		const rows = await modelsOf(c.id)
		return {
			c,
			ok: rows.find((r) => r.model === "ok")!,
			gone: rows.find((r) => r.model === "gone")!
		}
	}

	test("it satisfies no transform on the wire; a listed sibling still does", async () => {
		const { connectionsModels } = await import("../sockets/connections")
		const { c, ok, gone } = await endpointWithMissing()
		const res = await connectionsModels.handler(admin(), { id: c.id }, noop)
		const byId = new Map(res.models!.map((m) => [m.id, m]))
		expect(byId.get(gone.id)!.missingSince).not.toBeNull()
		expect(byId.get(gone.id)!.satisfiableCapabilities).toEqual([])
		expect(byId.get(ok.id)!.missingSince).toBeNull()
		expect(byId.get(ok.id)!.satisfiableCapabilities).toContain("text->text")
		expect(res.modelsSync?.at).toBeTruthy()
	})

	test("the star refuses it, naming the fix", async () => {
		const { connectionsSetDefault } = await import("../sockets/connections")
		const { c, gone } = await endpointWithMissing()
		await expect(
			connectionsSetDefault.handler(
				admin(),
				{ capability: "text->text", id: c.id, modelId: gone.id },
				noop
			)
		).rejects.toThrow(/no longer listed by its host/)
	})

	test("the resolver refuses it at dispatch, naming the fix", async () => {
		const { setCapabilityDefault } = await import("./capabilityDefaults")
		const { resolveCapabilityTarget, TEXT_CAPABILITY } = await import(
			"./capabilityTarget"
		)
		const { c, gone } = await endpointWithMissing()
		// Registered directly at the storage layer: the star refuses it, and
		// the point here is what happens to a registration that predates the
		// model vanishing.
		await setCapabilityDefault(db, TEXT_CAPABILITY, {
			connectionId: c.id,
			connectionModelId: gone.id
		})
		const out = await resolveCapabilityTarget(
			db as any,
			{
				capability: TEXT_CAPABILITY
			} as any
		)
		expect(out.ok).toBe(false)
		if (!out.ok) {
			expect(out.problem.kind).toBe("model")
			expect(out.problem.message).toMatch(/no longer listed by its host/)
			expect(out.problem.message).toMatch(
				/Refresh that connection's models/
			)
		}
	})

	test("the list carries every model with its availability", async () => {
		const { connectionsList } = await import("../sockets/connections")
		const { c, gone } = await endpointWithMissing()
		const res = await connectionsList.handler(admin(), {}, noop)
		const row = res.connectionsList.find((r) => r.id === c.id)!
		expect(row.models.length).toBe(2)
		expect(
			row.models.find((m) => m.id === gone.id)!.missingSince
		).not.toBeNull()
		expect(row.modelsSync.at).toBeTruthy()
		expect(row.modelsSync.error).toBeNull()
		// The key envelope never rides the list.
		expect((row as any).extraJson).toBeUndefined()
	})
})

describe("connections:syncModels", () => {
	test("syncs one endpoint on demand and answers with what it did", async () => {
		const { connectionsSyncModels } = await import("../sockets/connections")
		const { loginRateLimit } = await import(
			"$lib/server/services/loginRateLimit"
		)
		loginRateLimit.clearRateLimit("connections:refreshModels")
		const c = await endpoint("handler")
		hostListing = { models: ["x", "y", "z"] }
		const emitted: string[] = []
		const res = await connectionsSyncModels.handler(
			admin(),
			{ id: c.id, force: true },
			(event) => emitted.push(event)
		)
		expect(res.results).toHaveLength(1)
		expect(res.results[0]).toMatchObject({ connectionId: c.id, added: 3 })
		expect(emitted).toContain("connections:models")
		expect(emitted).toContain("connections:list")
	})

	test("a non-admin is refused", async () => {
		const { connectionsSyncModels } = await import("../sockets/connections")
		const res = await connectionsSyncModels.handler(
			{ user: { id: 2, isAdmin: false } } as any,
			{},
			noop
		)
		expect(res.results).toEqual([])
		expect(res.error).toMatch(/admin/i)
	})
})

describe("a listing that repeats itself, and two syncs that overlap", () => {
	test("a repeated identifier adds one row rather than aborting the sync", async () => {
		const { syncConnectionModels } = await import("./modelSync")
		const c = await endpoint("repeats")
		// A host — or a merged catalogue — that names one model twice. The
		// `(connection_id, model)` unique index would refuse the second INSERT
		// of the pair and take the whole sync down with it, so the listing is
		// reduced to distinct identifiers before anything is written.
		const res = await syncConnectionModels(db, c.id, {
			models: [
				{ model: "llama3.1:8b", name: "Llama 3.1 8B" },
				{ model: "llama3.1:8b", name: "Llama 3.1 8B (again)" },
				{ model: "qwen2.5:7b" }
			]
		})
		expect(res.error).toBeNull()
		expect(res).toMatchObject({ added: 2, listed: 2 })
		expect((await modelsOf(c.id)).map((m) => m.model)).toEqual([
			"llama3.1:8b",
			"qwen2.5:7b"
		])
	})

	test("two syncs of one endpoint at once populate it exactly once", async () => {
		const { syncConnectionModels } = await import("./modelSync")
		const c = await endpoint("concurrent")
		const listing = {
			models: [
				{ model: "a/one" },
				{ model: "b/two" },
				{ model: "c/three" }
			]
		}
		// ⚠ The reproduction. Both syncs read the endpoint's rows — none, on a
		// fresh instance — and then both INSERT, and the second violates
		// `connection_models_endpoint_model`. That took the whole sync down
		// with "duplicate key value violates unique constraint", which is the
		// live failure this test exists for.
		//
		// Two syncs of one endpoint overlap for ordinary reasons:
		// `connections:syncModels` with no id syncs every endpoint
		// concurrently, while the sidebar's own per-endpoint sync runs beside
		// it. The window is as wide as the listing is slow, and a local ONNX
		// endpoint's listing now awaits the recommended list.
		const [first, second] = await Promise.all([
			syncConnectionModels(db, c.id, listing),
			syncConnectionModels(db, c.id, listing)
		])
		expect(first.error).toBeNull()
		expect(second.error).toBeNull()
		// Three models listed, three rows, no duplicates.
		expect((await modelsOf(c.id)).map((m) => m.model)).toEqual([
			"a/one",
			"b/two",
			"c/three"
		])
		// And between them they claim to have added exactly three: the loser
		// of the race reports what it actually wrote, not what it tried to.
		expect(first.added + second.added).toBe(3)
	})
})
