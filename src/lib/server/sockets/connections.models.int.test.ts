/**
 * The (endpoint, model) pair at the handler seam (0114).
 *
 * Three contracts, and every one of them is a place the split could have broken
 * something that used to work:
 *
 *   1. **Form compatibility.** `connections:create` with a `model` field is what
 *      all nine connection forms send, and it has to keep producing a usable
 *      connection — which now means an endpoint AND a default model, not just a
 *      string in a column.
 *   2. **Exactly one default.** Enforced by a partial unique index rather than
 *      by whichever handler wrote last, so the handlers have to move the star
 *      rather than set it. Two defaults is not a display bug; it is a run
 *      resolving to whichever row the planner returned first.
 *   3. **The mirror stays a mirror.** `connections.model` survives the version
 *      freeze for downgrades and for the two managed flows, and it is only worth
 *      anything if every path that can move a default writes it.
 */

import { beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { asc, eq } from "drizzle-orm"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => [],
	// `systemSettings:get` asks, and the delete handlers refresh the defaults
	// through it — see the seed in `beforeAll`.
	isLocalEmbeddingSupported: async () => false
}))

let db: TestDb

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	// The key is what `withEncryptedApiKey` reaches for on every create — see
	// `connections.noImplicitDefault.int.test.ts`, which mocks it the same way.
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	// `connections:deleteModel` refreshes the defaults the way `connections:delete`
	// does — they ride on `systemSettings:get`, and that handler throws outright
	// when the singleton row is absent. A fresh test database has no boot.
	// ⚠ id 1 explicitly: `systemSettingsGet` looks the singleton up by that id,
	// not by "the first row".
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

const modelsOf = (connectionId: number) =>
	db
		.select()
		.from(schema.connectionModels)
		.where(eq(schema.connectionModels.connectionId, connectionId))
		.orderBy(asc(schema.connectionModels.id))

const endpoint = (id: number) =>
	db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, id))
		.limit(1)
		.then((r) => r[0])

async function createConnection(model: string | null, name = "fixture") {
	const { connectionsCreate } = await import("./connections")
	const res = await connectionsCreate.handler(
		admin(),
		{
			connection: {
				name: `${name} ${Math.random()}`,
				type: CONNECTION_TYPE.OLLAMA,
				baseUrl: "http://localhost:11434",
				...(model === null ? {} : { model })
			} as any
		},
		noop
	)
	return res.connection
}

describe("connections:create keeps every form working", () => {
	test("a create carrying a model field gets a default model row", async () => {
		const conn = await createConnection("llama3.1:8b")
		const models = await modelsOf(conn.id)
		expect(models).toHaveLength(1)
		expect(models[0].model).toBe("llama3.1:8b")
		expect(models[0].name).toBe("llama3.1:8b")
		expect(models[0].isDefault).toBe(true)
		// And the mirror agrees, which is what a downgrade reads.
		expect((await endpoint(conn.id)).model).toBe("llama3.1:8b")
	}, 60_000)

	test("a create with no model makes an endpoint and no model row", async () => {
		// Saving the URL and the key before you know what is on the host is a
		// normal first step, not an error — and inventing a model row for it
		// would make an unusable endpoint look configured in every picker.
		const conn = await createConnection(null, "bare")
		expect(await modelsOf(conn.id)).toEqual([])
	}, 60_000)
})

describe("connections:createModel", () => {
	test("the first model becomes the default; the second does not", async () => {
		const { connectionsCreateModel } = await import("./connections")
		const conn = await createConnection(null, "multi")
		await connectionsCreateModel.handler(
			admin(),
			{ id: conn.id, model: { model: "a-model" } },
			noop
		)
		const second = await connectionsCreateModel.handler(
			admin(),
			{ id: conn.id, model: { model: "b-model", name: "Bee" } },
			noop
		)
		const rows = second.models!
		// Compared as a map rather than a list: the view's order is display order
		// (`sort_order`, then NAME), and "Bee" sorts before "a-model" — which is
		// the ordering contract working, not the star being in the wrong place.
		expect(
			Object.fromEntries(rows.map((m) => [m.model, m.isDefault]))
		).toEqual({ "a-model": true, "b-model": false })
		// The display name defaults to the identifier, and is kept when given.
		expect(rows.find((m) => m.model === "b-model")!.name).toBe("Bee")
	}, 60_000)

	test("adding the same identifier twice is refused, not duplicated", async () => {
		const { connectionsCreateModel } = await import("./connections")
		const conn = await createConnection("dup-model", "dup")
		const res = await connectionsCreateModel.handler(
			admin(),
			{ id: conn.id, model: { model: "dup-model" } },
			noop
		)
		expect(res.error).toMatch(/already/i)
		expect(await modelsOf(conn.id)).toHaveLength(1)
	}, 60_000)

	test("refuses an api key smuggled through extraJson", async () => {
		// The crypto path walks `connections.extra_json` and only that one, so a
		// key written onto a model row would sit in plaintext forever.
		const { connectionsCreateModel } = await import("./connections")
		const conn = await createConnection(null, "key")
		const res = await connectionsCreateModel.handler(
			admin(),
			{
				id: conn.id,
				model: { model: "m", extraJson: { apiKey: "sk-secret" } } as any
			},
			noop
		)
		expect(res.error).toBeTruthy()
		expect(JSON.stringify(await modelsOf(conn.id))).not.toContain(
			"sk-secret"
		)
	}, 60_000)
})

describe("connections:setDefaultModel", () => {
	test("moves the star and re-writes the mirror", async () => {
		const { connectionsCreateModel, connectionsSetDefaultModel } =
			await import("./connections")
		const conn = await createConnection("first", "star")
		await connectionsCreateModel.handler(
			admin(),
			{ id: conn.id, model: { model: "second" } },
			noop
		)
		const rows = await modelsOf(conn.id)
		const second = rows.find((m) => m.model === "second")!
		const res = await connectionsSetDefaultModel.handler(
			admin(),
			{ id: conn.id, modelId: second.id },
			noop
		)
		expect(
			res.models!.filter((m) => m.isDefault).map((m) => m.model)
		).toEqual(["second"])
		expect((await endpoint(conn.id)).model).toBe("second")
	}, 60_000)

	test("refuses a model belonging to a different endpoint", async () => {
		// A pair whose halves name different connections cannot be displayed and
		// cannot be run; refusing at the door is cheaper than refusing at
		// dispatch with a sentence about a choice nobody made.
		const { connectionsCreateModel, connectionsSetDefaultModel } =
			await import("./connections")
		const a = await createConnection("a-only", "A")
		const b = await createConnection("b-only", "B")
		const bModels = await modelsOf(b.id)
		const res = await connectionsSetDefaultModel.handler(
			admin(),
			{ id: a.id, modelId: bModels[0].id },
			noop
		)
		expect(res.error).toBeTruthy()
		expect((await endpoint(a.id)).model).toBe("a-only")
	}, 60_000)
})

describe("connections:deleteModel", () => {
	test("deleting the default promotes another and re-mirrors", async () => {
		const { connectionsCreateModel, connectionsDeleteModel } = await import(
			"./connections"
		)
		const conn = await createConnection("keeper", "del")
		await connectionsCreateModel.handler(
			admin(),
			{ id: conn.id, model: { model: "goner" } },
			noop
		)
		const rows = await modelsOf(conn.id)
		const keeper = rows.find((m) => m.model === "keeper")!
		// Star the one about to go, so the delete has to move it.
		const { connectionsSetDefaultModel } = await import("./connections")
		const goner = rows.find((m) => m.model === "goner")!
		await connectionsSetDefaultModel.handler(
			admin(),
			{ id: conn.id, modelId: goner.id },
			noop
		)
		const res = await connectionsDeleteModel.handler(
			admin(),
			{ id: conn.id, modelId: goner.id },
			noop
		)
		expect(res.models!.map((m) => m.model)).toEqual(["keeper"])
		expect(res.models![0].isDefault).toBe(true)
		expect(res.models![0].id).toBe(keeper.id)
		expect((await endpoint(conn.id)).model).toBe("keeper")
	}, 60_000)

	test("deleting the last model leaves the endpoint with a null mirror", async () => {
		// Not a deleted endpoint. Somebody removing the only model from a
		// connection is clearing a field, not throwing away a base URL and a
		// key — the managed flows are the only place the two go together, and
		// they say so themselves.
		const { connectionsDeleteModel } = await import("./connections")
		const conn = await createConnection("solo", "last")
		const [only] = await modelsOf(conn.id)
		await connectionsDeleteModel.handler(
			admin(),
			{ id: conn.id, modelId: only.id },
			noop
		)
		expect(await modelsOf(conn.id)).toEqual([])
		const row = await endpoint(conn.id)
		expect(row).toBeTruthy()
		expect(row.model).toBeNull()
	}, 60_000)
})

describe("connections:importModels", () => {
	test("adds what is new and says how many it skipped", async () => {
		// A probed list is never auto-persisted — this runs on an explicit
		// press — and re-running it must be additive rather than a reset.
		const { connectionsImportModels } = await import("./connections")
		const conn = await createConnection("already-here", "import")
		const res = await connectionsImportModels.handler(
			admin(),
			{
				id: conn.id,
				models: [
					{ model: "already-here" },
					{ model: "fresh-one", name: "Fresh" }
				]
			},
			noop
		)
		expect(res.added).toBe(1)
		expect(res.skipped).toBe(1)
		expect(res.models!.map((m) => m.model).sort()).toEqual([
			"already-here",
			"fresh-one"
		])
		// The star did not move — an import must not restar the endpoint.
		expect(
			res.models!.filter((m) => m.isDefault).map((m) => m.model)
		).toEqual(["already-here"])
	}, 60_000)
})

describe("every model handler is admin-only", () => {
	test("a non-admin is refused by all five", async () => {
		const mod = await import("./connections")
		const guest = () =>
			({
				user: { id: 2, isAdmin: false },
				io: { to: () => ({ emit: () => {} }) }
			}) as any
		const conn = await createConnection("guarded", "guard")
		const [only] = await modelsOf(conn.id)
		const calls: Promise<{ error?: string }>[] = [
			mod.connectionsModels.handler(guest(), { id: conn.id }, noop),
			mod.connectionsCreateModel.handler(
				guest(),
				{ id: conn.id, model: { model: "x" } },
				noop
			),
			mod.connectionsUpdateModel.handler(
				guest(),
				{ id: conn.id, modelId: only.id, model: { name: "x" } },
				noop
			),
			mod.connectionsSetDefaultModel.handler(
				guest(),
				{ id: conn.id, modelId: only.id },
				noop
			),
			mod.connectionsDeleteModel.handler(
				guest(),
				{ id: conn.id, modelId: only.id },
				noop
			)
		]
		for (const res of await Promise.all(calls))
			expect(res.error).toMatch(/admin/i)
		// And nothing was written on the way past.
		expect(await modelsOf(conn.id)).toHaveLength(1)
	}, 60_000)
})
