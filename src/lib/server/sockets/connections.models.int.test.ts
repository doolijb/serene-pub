/**
 * The (endpoint, model) pair at the handler seam (0114).
 *
 * Three contracts, and every one of them is a place the split could have broken
 * something that used to work:
 *
 *   1. **Form compatibility.** `connections:create` with a `model` field is what
 *      all nine connection forms send, and it has to keep producing a usable
 *      endpoint AND a model row — without marking anything. Connections have
 *      no default model.
 *   2. **No implicit star.** Nothing here stars: create, createModel and import
 *      only ensure ROWS. A default is a PAIR registered through
 *      `connections:setDefault` with an explicit `modelId`, and an endpoint-only
 *      registration is refused.
 *   3. **Delete releases, never promotes.** Deleting a model just deletes it;
 *      a capability registration naming it is FK-released to endpoint-only and
 *      resolves as incomplete.
 */

import { beforeAll, describe, expect, test, vi } from "vitest"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { asc, eq } from "drizzle-orm"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { byCapability } from "$lib/server/connections/capabilityDefaults"

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

/**
 * A distinct host per fixture, the way the name is distinct per fixture.
 *
 * One Ollama connection per host (owner ruling 2026-09-25): `connections:create`
 * refuses a second to a host that already has one, so fixtures sharing
 * `localhost:11434` would all fail after the first. None of these tests is
 * about hosts — Ollama is just a convenient type — so each simply gets its own.
 */
let fixtureHost = 0

async function createConnection(model: string | null, name = "fixture") {
	const { connectionsCreate } = await import("./connections")
	const res = await connectionsCreate.handler(
		admin(),
		{
			connection: {
				name: `${name} ${Math.random()}`,
				type: CONNECTION_TYPE.OLLAMA,
				baseUrl: `http://ollama-fixture-${++fixtureHost}.test:11434`,
				...(model === null ? {} : { model })
			} as any
		},
		noop
	)
	return res.connection
}

describe("connections:create keeps every form working", () => {
	test("a create carrying a model field gets a model row and marks nothing", async () => {
		const conn = await createConnection("llama3.1:8b")
		const models = await modelsOf(conn.id)
		expect(models).toHaveLength(1)
		expect(models[0].model).toBe("llama3.1:8b")
		expect(models[0].name).toBe("llama3.1:8b")
		// Connections have no default model: nothing is starred, and the
		// endpoint row carries no model column at all.
		expect("isDefault" in models[0]).toBe(false)
		expect("model" in (await endpoint(conn.id))).toBe(false)
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
	test("creates rows without starring anything", async () => {
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
		expect(rows.map((m) => m.model).sort()).toEqual(["a-model", "b-model"])
		// Nothing is starred: connections have no default model, so a second
		// row is just a second row.
		for (const m of rows) expect("isDefault" in m).toBe(false)
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

describe("connections:setDefault names the pair outright", () => {
	test("an endpoint-only registration is refused", async () => {
		// Connections have no default model, so "the endpoint, whichever model"
		// is not a registration — the caller must choose a model.
		const { connectionsSetDefault } = await import("./connections")
		const conn = await createConnection("first", "endpoint-only")
		await expect(
			connectionsSetDefault.handler(
				admin(),
				{ capability: "text->text", id: conn.id } as any,
				noop
			)
		).rejects.toThrow(/choose a model/i)
	}, 60_000)

	test("refuses a model belonging to a different endpoint", async () => {
		// A pair whose halves name different connections cannot be displayed and
		// cannot be run; refusing at the door is cheaper than refusing at
		// dispatch with a sentence about a choice nobody made.
		const { connectionsSetDefault } = await import("./connections")
		const a = await createConnection("a-only", "A")
		const b = await createConnection("b-only", "B")
		const bModels = await modelsOf(b.id)
		await expect(
			connectionsSetDefault.handler(
				admin(),
				{
					capability: "text->text",
					id: a.id,
					modelId: bModels[0].id
				} as any,
				noop
			)
		).rejects.toThrow(/not on the connection/i)
	}, 60_000)

	test("refuses a model that is switched off", async () => {
		// The star refuses what the dropdown must not offer: a switched-off
		// model satisfies nothing.
		const { connectionsSetDefault, connectionsUpdateModel } = await import(
			"./connections"
		)
		const conn = await createConnection("on-off", "switched")
		const [row] = await modelsOf(conn.id)
		await connectionsUpdateModel.handler(
			admin(),
			{ id: conn.id, modelId: row.id, model: { enabled: false } },
			noop
		)
		await expect(
			connectionsSetDefault.handler(
				admin(),
				{
					capability: "text->text",
					id: conn.id,
					modelId: row.id
				} as any,
				noop
			)
		).rejects.toThrow(/switched off/i)
	}, 60_000)
})

describe("connections:deleteModel", () => {
	test("deleting a model just deletes it; the registration releases to endpoint-only", async () => {
		const {
			connectionsCreateModel,
			connectionsDeleteModel,
			connectionsSetDefault
		} = await import("./connections")
		const conn = await createConnection("keeper", "del")
		await connectionsCreateModel.handler(
			admin(),
			{ id: conn.id, model: { model: "goner" } },
			noop
		)
		const rows = await modelsOf(conn.id)
		const goner = rows.find((m) => m.model === "goner")!
		// Register the pair that names the row about to go.
		await connectionsSetDefault.handler(
			admin(),
			{
				capability: "text->text",
				id: conn.id,
				modelId: goner.id
			} as any,
			noop
		)
		const res = await connectionsDeleteModel.handler(
			admin(),
			{ id: conn.id, modelId: goner.id },
			noop
		)
		expect(res.models!.map((m) => m.model)).toEqual(["keeper"])
		// `connection_defaults.connection_model_id` is ON DELETE SET NULL: the
		// registration survives as endpoint-only, which resolves as incomplete
		// rather than stranded — and nothing is promoted in its place.
		const [reg] = await db
			.select()
			.from(schema.loadouts)
			.where(byCapability("text->text"))
		expect(reg.connectionId).toBe(conn.id)
		expect(reg.connectionModelId).toBeNull()
	}, 60_000)

	test("deleting the last model leaves the endpoint with no models", async () => {
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
		// An import stars nothing — it only ensures rows.
		for (const m of res.models!) expect("isDefault" in m).toBe(false)
	}, 60_000)
})

describe("every model handler is admin-only", () => {
	test("a non-admin is refused by all four", async () => {
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

describe("connections:updateModel always answers", () => {
	// Admin → Connections' Save sends each model switch as one write and
	// waits for ITS reply (`awaitReply`, STYLE-GUIDE §6.11). A path that
	// returned without emitting left that Save waiting for a timeout.
	test("a write that changes nothing still emits its reply", async () => {
		const { connectionsUpdateModel } = await import("./connections")
		const conn = await createConnection("no-op", "noop")
		const [row] = await modelsOf(conn.id)
		const sent: Array<[string, any]> = []
		await connectionsUpdateModel.handler(
			admin(),
			{ id: conn.id, modelId: row.id, model: {} },
			((event: string, data: unknown) => sent.push([event, data])) as any
		)
		const reply = sent.find(([event]) => event === "connections:updateModel")
		expect(reply?.[1]?.connectionId).toBe(conn.id)
	}, 60_000)

	test("a refusal answers on the :error sibling", async () => {
		const { connectionsUpdateModel } = await import("./connections")
		const conn = await createConnection("elsewhere", "refused")
		const sent: Array<[string, any]> = []
		await connectionsUpdateModel.handler(
			admin(),
			{ id: conn.id, modelId: 987654, model: { enabled: false } },
			((event: string, data: unknown) => sent.push([event, data])) as any
		)
		expect(sent.map(([event]) => event)).toContain(
			"connections:updateModel:error"
		)
	}, 60_000)
})

describe("connections:models answers satisfiable transforms per pair", () => {
	test("an enabled model names what the pair may default for; a switched-off one names nothing", async () => {
		const mod = await import("./connections")
		const conn = await createConnection("llama3.1:8b", "sat")
		const res = await mod.connectionsModels.handler(
			admin(),
			{ id: conn.id },
			noop
		)
		expect(res.models).toHaveLength(1)
		// Judged as the pair with the same reader the star uses: an Ollama
		// text model may hold the chat default.
		expect(res.models![0].satisfiableCapabilities).toContain("text->text")
		for (const id of res.models![0].satisfiableCapabilities ?? [])
			expect(typeof id).toBe("string")
		// Switching it off empties the list — the star refuses it, so the
		// dropdown must not offer it either.
		await mod.connectionsUpdateModel.handler(
			admin(),
			{ id: conn.id, modelId: res.models![0].id, model: { enabled: false } },
			noop
		)
		const res2 = await mod.connectionsModels.handler(
			admin(),
			{ id: conn.id },
			noop
		)
		expect(res2.models![0].satisfiableCapabilities).toEqual([])
	}, 60_000)
})

describe("a managed KoboldCPP model's vision projector", () => {
	async function managedPair() {
		const [conn] = await db
			.insert(schema.connections)
			.values({
				name: `managed ${Math.random()}`,
				type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
				baseUrl: "http://localhost:5001"
			} as any)
			.returning()
		const [model] = await db
			.insert(schema.connectionModels)
			.values({
				connectionId: conn.id,
				model: "gemma-3-4b.gguf",
				name: "gemma-3-4b.gguf",
				enabled: true,
				extraJson: { keep: "me" }
			} as any)
			.returning()
		return { conn, model }
	}

	test("is stored on the model's extra_json, shown on its row, and turns Vision on", async () => {
		const mod = await import("./connections")
		const { mergeEndpointModel } = await import(
			"$lib/server/connections/models"
		)
		const { capabilityRefusal } = await import(
			"$lib/server/pipelines/runtime/capabilityGuard"
		)
		const { conn, model } = await managedPair()

		const res = await mod.connectionsUpdateModel.handler(
			admin(),
			{
				id: conn.id,
				modelId: model.id,
				model: { visionProjector: " mmproj-gemma-3-4b-f16.gguf " }
			},
			noop
		)
		expect(res.error).toBeUndefined()
		expect(res.models![0].visionProjector).toBe("mmproj-gemma-3-4b-f16.gguf")
		const [row] = await modelsOf(conn.id)
		// One key written; the rest of the adapter's bag kept.
		expect(row.extraJson).toEqual({
			keep: "me",
			mmproj: "mmproj-gemma-3-4b-f16.gguf"
		})
		const pair = mergeEndpointModel(await endpoint(conn.id), row)
		expect(capabilityRefusal(pair, "text+image->text")).toBeNull()

		// Blank clears it, and Vision goes back to the adapter's default.
		const cleared = await mod.connectionsUpdateModel.handler(
			admin(),
			{ id: conn.id, modelId: model.id, model: { visionProjector: "" } },
			noop
		)
		expect(cleared.models![0].visionProjector).toBeNull()
		const [after] = await modelsOf(conn.id)
		expect(after.extraJson).toEqual({ keep: "me" })
		expect(
			capabilityRefusal(
				mergeEndpointModel(await endpoint(conn.id), after),
				"text+image->text"
			)
		).not.toBeNull()
	}, 60_000)

	test("refuses a path, a non-gguf name, and any endpoint that does not launch models", async () => {
		const mod = await import("./connections")
		const { conn, model } = await managedPair()
		for (const bad of ["../etc/passwd.gguf", "dir/mmproj.gguf", "mmproj.bin"]) {
			const res = await mod.connectionsUpdateModel.handler(
				admin(),
				{ id: conn.id, modelId: model.id, model: { visionProjector: bad } },
				noop
			)
			expect(res.error).toMatch(/vision projector/i)
		}
		const [row] = await modelsOf(conn.id)
		expect(row.extraJson).toEqual({ keep: "me" })

		const ollama = await createConnection("llava:7b", "ollama projector")
		const [om] = await modelsOf(ollama!.id)
		const refused = await mod.connectionsUpdateModel.handler(
			admin(),
			{ id: ollama!.id, modelId: om.id, model: { visionProjector: "x.gguf" } },
			noop
		)
		expect(refused.error).toMatch(/KoboldCPP/)
		const listed = await mod.connectionsModels.handler(
			admin(),
			{ id: ollama!.id },
			noop
		)
		expect("visionProjector" in listed.models![0]).toBe(false)
	}, 60_000)
})

describe("a model's What it's for (`modality`)", () => {
	async function pair(type: string, model = "a-model") {
		const [conn] = await db
			.insert(schema.connections)
			.values({
				name: `modality ${Math.random()}`,
				type,
				baseUrl: `http://modality-${++fixtureHost}.test/v1`,
				modality: CONNECTION_TYPE.modalityOf(type),
				capabilities: {
					resolved: { "text->text": 2, "text->embedding": 2 }
				}
			} as any)
			.returning()
		const [row] = await db
			.insert(schema.connectionModels)
			.values({
				connectionId: conn.id,
				model,
				name: model,
				enabled: true
			})
			.returning()
		return { conn, row }
	}

	const setModality = async (
		connectionId: number,
		modelId: number,
		modality: unknown,
		sent: Array<[string, any]> = []
	) => {
		const { connectionsUpdateModel } = await import("./connections")
		return connectionsUpdateModel.handler(
			admin(),
			{ id: connectionId, modelId, model: { modality } as any },
			((event: string, data: unknown) => sent.push([event, data])) as any
		)
	}

	test("an OpenAI-compatible model takes chat, embeddings or Not sure, and the list moves with it", async () => {
		const { conn, row } = await pair(CONNECTION_TYPE.OPENAI)

		const sent: Array<[string, any]> = []
		const res = await setModality(conn.id, row.id, "embeddings", sent)
		expect(res.error).toBeUndefined()
		expect(res.models![0].modality).toBe("embeddings")
		// An embedding model on this pair can no longer be offered for chat.
		expect(res.models![0].satisfiableCapabilities).not.toContain(
			"text->text"
		)
		expect(sent.map(([event]) => event)).toEqual(
			expect.arrayContaining([
				"connections:updateModel",
				"connections:list"
			])
		)

		expect(
			(await setModality(conn.id, row.id, "text-gen")).models![0].modality
		).toBe("text-gen")
		// Blank and null are both "Not sure".
		expect(
			(await setModality(conn.id, row.id, "")).models![0].modality
		).toBeNull()
		await setModality(conn.id, row.id, "embeddings")
		expect(
			(await setModality(conn.id, row.id, null)).models![0].modality
		).toBeNull()
	}, 60_000)

	test("refuses what this connection's type cannot serve, and a value that is not a choice", async () => {
		const { conn, row } = await pair(CONNECTION_TYPE.OPENAI)
		// `image-gen` left this list 2026-10-12: the OPENAI type carries an image module now (I6).
		for (const bad of ["ner", "tts"]) {
			const res = await setModality(conn.id, row.id, bad)
			expect(res.error).toMatch(/can only be for chat, image generation or embeddings/i)
		}
		const junk = await setModality(conn.id, row.id, 7)
		expect(junk.error).toMatch(/Not sure/)
		const [after] = await modelsOf(conn.id)
		expect(after.modality).toBeNull()

		// The choices are the type's: a managed KoboldCPP model may draw.
		const managed = await pair(CONNECTION_TYPE.KOBOLDCPP_MANAGED, "sd.gguf")
		const drew = await setModality(
			managed.conn.id,
			managed.row.id,
			"image-gen"
		)
		expect(drew.error).toBeUndefined()
		expect(drew.models![0].modality).toBe("image-gen")
	}, 60_000)

	test("refuses a modality that would strand a default on this model", async () => {
		const { connectionsSetDefault } = await import("./connections")
		const { conn, row } = await pair(CONNECTION_TYPE.OPENAI, "starred")
		await connectionsSetDefault.handler(
			admin(),
			{ capability: "text->text", id: conn.id, modelId: row.id } as any,
			noop
		)

		const refused = await setModality(conn.id, row.id, "embeddings")
		expect(refused.error).toMatch(/in the Reply loadout/i)
		const [kept] = await modelsOf(conn.id)
		expect(kept.modality).toBeNull()

		// What keeps the default servable is accepted, and so is Not sure.
		expect(
			(await setModality(conn.id, row.id, "text-gen")).error
		).toBeUndefined()
		expect((await setModality(conn.id, row.id, null)).error).toBeUndefined()
	}, 60_000)

	/**
	 * A published pipeline whose steps each declare one connection slot, and
	 * one named config holding `values` at those slots.
	 */
	async function pipelineConfig(
		name: string,
		configName: string,
		steps: Array<{ nodeKey: string; requires: string[]; value?: unknown }>
	) {
		const n = ++fixtureHost
		const [spec] = await db
			.insert(schema.pipelineSpecs)
			.values({ slug: `test:spec/modality-${n}`, name })
			.returning()
		const [version] = await db
			.insert(schema.pipelineSpecVersions)
			.values({
				specId: spec.id,
				semver: "1.0.0",
				canonicalHash: `h${n}`
			})
			.returning()
		await db
			.update(schema.pipelineSpecs)
			.set({ activeVersionId: version.id })
			.where(eq(schema.pipelineSpecs.id, spec.id))
		for (const [position, step] of steps.entries()) {
			const definitionId = `test:oracle/modality-${n}-${step.nodeKey}`
			await db.insert(schema.pipelineDefinitionRegistry).values({
				definitionId,
				version: 1,
				kind: "node",
				slots: {
					connection: { kind: "connection", requires: step.requires }
				}
			})
			await db.insert(schema.pipelineNodes).values({
				specVersionId: version.id,
				nodeKey: step.nodeKey,
				kind: "oracle",
				definitionId,
				position
			})
		}
		const [config] = await db
			.insert(schema.pipelineConfigs)
			.values({ specId: spec.id, name: configName })
			.returning()
		const values = steps.filter((s) => s.value !== undefined)
		if (values.length)
			await db.insert(schema.pipelineConfigValues).values(
				values.map((s) => ({
					configId: config.id,
					nodeKey: s.nodeKey,
					slot: "connection",
					path: "",
					value: s.value
				}))
			)
		return { spec, config }
	}

	test("refuses a modality that would strand a pipeline configuration's step on this model", async () => {
		const { conn, row } = await pair(CONNECTION_TYPE.OPENAI, "configured")
		await pipelineConfig("Summarize", "Mine", [
			{
				nodeKey: "generate",
				requires: ["text->text"],
				value: { ref: conn.id, modelId: row.id }
			},
			// A held slot: the run drops a pick there, so it strands nothing.
			{
				nodeKey: "windows",
				requires: ["text->embedding"],
				value: { ref: conn.id, modelId: row.id }
			}
		])

		const refused = await setModality(conn.id, row.id, "embeddings")
		expect(refused.error).toBe(
			"The “Mine” configuration of Summarize uses this model for chat. " +
				"Choose another model in that configuration first, then change what this one is for."
		)
		const [kept] = await modelsOf(conn.id)
		expect(kept.modality).toBeNull()

		expect(
			(await setModality(conn.id, row.id, "text-gen")).error
		).toBeUndefined()
		expect((await setModality(conn.id, row.id, null)).error).toBeUndefined()
	}, 60_000)

	test("a switched-off plugin's configuration holds nothing back; switched on, it does", async () => {
		const { conn, row } = await pair(CONNECTION_TYPE.OPENAI, "plugin-held")
		const { spec } = await pipelineConfig("Plugin pipeline", "Theirs", [
			{
				nodeKey: "generate",
				requires: ["text->text"],
				value: { ref: conn.id, modelId: row.id }
			}
		])
		const [plugin] = await db
			.insert(schema.plugins)
			.values({
				pluginId: `acme.modality-${++fixtureHost}`,
				name: "Acme",
				bundleSource: "// x",
				bundleHash: "deadbeef",
				enabled: false,
				manifest: {}
			})
			.returning()
		await db
			.update(schema.pipelineSpecs)
			.set({ sourcePluginId: plugin.id })
			.where(eq(schema.pipelineSpecs.id, spec.id))

		expect(
			(await setModality(conn.id, row.id, "embeddings")).error
		).toBeUndefined()
		expect((await setModality(conn.id, row.id, null)).error).toBeUndefined()

		await db
			.update(schema.plugins)
			.set({ enabled: true })
			.where(eq(schema.plugins.id, plugin.id))
		expect((await setModality(conn.id, row.id, "embeddings")).error).toMatch(
			/configuration of Plugin pipeline uses this model for chat/
		)
	}, 60_000)

	test("a configuration naming only the endpoint, or an address the pipeline no longer declares, strands nothing", async () => {
		const { conn, row } = await pair(CONNECTION_TYPE.OPENAI, "loose")
		const { config } = await pipelineConfig("Narrate", "Loose", [
			{ nodeKey: "generate", requires: ["text->text"], value: conn.id }
		])
		await db.insert(schema.pipelineConfigValues).values({
			configId: config.id,
			nodeKey: "retired-step",
			slot: "connection",
			path: "",
			value: { ref: conn.id, modelId: row.id }
		})

		expect(
			(await setModality(conn.id, row.id, "embeddings")).error
		).toBeUndefined()
	}, 60_000)

	test("names the defaults and every configuration in one refusal", async () => {
		const { connectionsSetDefault } = await import("./connections")
		const { conn, row } = await pair(CONNECTION_TYPE.OPENAI, "everywhere")
		await connectionsSetDefault.handler(
			admin(),
			{ capability: "text->text", id: conn.id, modelId: row.id } as any,
			noop
		)
		const value = { ref: conn.id, modelId: row.id }
		await pipelineConfig("Reply", "Fast", [
			{ nodeKey: "plan", requires: ["text->text"], value },
			{ nodeKey: "narrate", requires: ["text->text"], value }
		])
		await pipelineConfig("Recap", "Slow", [
			{ nodeKey: "generate", requires: ["text->text"], value }
		])

		const refused = await setModality(conn.id, row.id, "embeddings")
		expect(refused.error).toBe(
			"This model is in the Reply loadout. " +
				"The “Fast” configuration of Reply and the “Slow” configuration of Recap use it for chat. " +
				"Choose another model in Loadouts and in those configurations first, then change what this one is for."
		)
	}, 60_000)

	test("counts the configurations past the third rather than naming them", async () => {
		const { conn, row } = await pair(CONNECTION_TYPE.OPENAI, "popular")
		const value = { ref: conn.id, modelId: row.id }
		for (const name of ["One", "Two", "Three", "Four"])
			await pipelineConfig(`Pipeline ${name}`, name, [
				{ nodeKey: "generate", requires: ["text->text"], value }
			])

		const refused = await setModality(conn.id, row.id, "embeddings")
		expect(refused.error).toBe(
			"The “One” configuration of Pipeline One, the “Two” configuration of Pipeline Two, " +
				"and 2 other configurations use this model for chat. " +
				"Choose another model in those configurations first, then change what this one is for."
		)
	}, 60_000)
})
