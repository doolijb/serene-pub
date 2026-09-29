/**
 * One Ollama connection per host: existing `ollama-embeddings` rows move onto
 * `ollama` IN PLACE, and every `ollama` row's capability cache learns it can
 * embed (owner ruling 2026-09-25).
 *
 * The property that matters is not the type string. It is that **the embedding
 * lane still resolves** — so the star is wired onto a real row and read back
 * through `resolveEmbeddingTarget`, the function the lane itself calls. A test
 * that only checked `type === "ollama"` would pass on a rename that silently
 * stranded somebody's embeddings.
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
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

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

async function connection(values: Record<string, unknown>) {
	const [row] = await db
		.insert(schema.connections)
		.values({
			name: "fixture",
			baseUrl: "http://localhost:11434",
			extraJson: {},
			capabilities: {},
			...values
		} as any)
		.returning()
	return row
}

async function model(connectionId: number, identifier: string) {
	const [row] = await db
		.insert(schema.connectionModels)
		.values({ connectionId, model: identifier, name: identifier, enabled: true })
		.returning()
	return row
}

async function reload(id: number) {
	const [row] = await db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.id, id))
		.limit(1)
	return row
}

const resolvedOf = (row: any) =>
	Object.keys((row.capabilities as any)?.resolved ?? {})

/** What boot does, in boot's order: rename, then rebuild every cache. */
async function boot() {
	const { mergeOllamaEmbeddingsType } = await import("./ollamaMultiModality")
	const { refreshConnectionCapabilityCaches } = await import("./resolve")
	const merged = await mergeOllamaEmbeddingsType(db)
	const cached = await refreshConnectionCapabilityCaches(db)
	return { ...merged, ...cached }
}

describe("Ollama becomes one connection per host", () => {
	it("renames an ollama-embeddings row in place — same id, so the embedding lane still finds it", async () => {
		const { mergeOllamaEmbeddingsType } = await import("./ollamaMultiModality")
		const { setCapabilityDefault } = await import("./capabilityDefaults")
		const { resolveEmbeddingTarget } = await import(
			"$lib/server/embedding/target"
		)

		const embed = await connection({
			name: "Ollama embeddings",
			type: CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
			modality: "embeddings",
			capabilities: { resolved: { "text->embedding": "native" } }
		})
		const nomic = await model(embed.id, "nomic-embed-text")
		await setCapabilityDefault(db, "text->embedding", {
			connectionId: embed.id,
			connectionModelId: nomic.id
		})

		await mergeOllamaEmbeddingsType(db)

		const after = await reload(embed.id)
		expect(after.id).toBe(embed.id)
		expect(after.type).toBe(CONNECTION_TYPE.OLLAMA)
		expect(after.modality).toBe("text-gen")

		// The lane, read the way the lane reads it: the star named this id and
		// this model, and both still exist, so nothing dangled.
		const target = await resolveEmbeddingTarget(db as any)
		expect(target?.connectionId).toBe(embed.id)
		expect(target?.type).toBe(CONNECTION_TYPE.OLLAMA)
		expect(target?.mode).toBe("api")
	}, 60_000)

	it("teaches every ollama row both halves: chat AND embeddings", async () => {
		// A chat row whose cache predates the manifest change — the upgrade case.
		const chat = await connection({
			type: CONNECTION_TYPE.OLLAMA,
			capabilities: { resolved: { "text->text": "native" } }
		})
		// And a renamed-embeddings row whose cache knows only embeddings.
		const embed = await connection({
			type: CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
			modality: "embeddings",
			capabilities: { resolved: { "text->embedding": "native" } }
		})

		await boot()

		for (const id of [chat.id, embed.id]) {
			const keys = resolvedOf(await reload(id))
			expect(keys, `row ${id}`).toContain("text->text")
			expect(keys, `row ${id}`).toContain("text->embedding")
		}
	}, 60_000)

	it("keeps a person's own toggle through the refresh", async () => {
		// Somebody switched tools OFF on this host. The refresh rebuilds the
		// cache but must not throw away the override that produced it.
		const row = await connection({
			type: CONNECTION_TYPE.OLLAMA,
			capabilities: {
				resolved: { "text->text": "native" },
				overrides: { tools: false }
			}
		})

		await boot()

		const after = await reload(row.id)
		expect((after.capabilities as any)?.overrides).toEqual({ tools: false })
		expect(resolvedOf(after)).toContain("text->embedding")
	}, 60_000)

	it("is idempotent: a second boot renames nothing and writes nothing", async () => {
		await connection({
			type: CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
			modality: "embeddings"
		})
		await boot()

		expect(await boot()).toEqual({ renamed: 0, refreshed: 0 })
	}, 60_000)

	it("never renames a connection that is not Ollama", async () => {
		const openai = await connection({
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings",
			baseUrl: "https://api.openai.com/v1",
			capabilities: { resolved: { "text->embedding": "native" } }
		})

		await boot()

		const after = await reload(openai.id)
		expect(after.type).toBe(CONNECTION_TYPE.OPENAI_EMBEDDINGS)
		expect(after.modality).toBe("embeddings")
		expect(resolvedOf(after)).not.toContain("text->text")
	}, 60_000)
})

describe("every connection's capability cache follows the manifest", () => {
	it("rebuilds a stale cache on a type that is not Ollama", async () => {
		// The general case: ANY declared type whose stored cache predates the
		// manifest. Before, only an edit or a test ever rewrote it, so a new
		// capability never reached an existing row in the picker.
		const { refreshConnectionCapabilityCaches } = await import("./resolve")
		const row = await connection({
			type: CONNECTION_TYPE.ANTHROPIC,
			baseUrl: "https://api.anthropic.com",
			capabilities: { resolved: { "text->text": "native" } }
		})
		await refreshConnectionCapabilityCaches(db)
		// Whatever the manifest declares by default for Anthropic beyond chat
		// is now on the row — the exact set is the manifest's business.
		expect(resolvedOf(await reload(row.id)).length).toBeGreaterThan(1)
	}, 60_000)

	it("skips a type the manifest declares nothing for, keeping what 0175 determined", async () => {
		// `openai-embeddings` resolves to `{}` from the manifest; its
		// `text->embedding` came from the old modality column. A rebuild must
		// not write `{}` over it — and must not write at all.
		const { refreshConnectionCapabilityCaches } = await import("./resolve")
		const row = await connection({
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			modality: "embeddings",
			baseUrl: "https://api.openai.com/v1",
			capabilities: { resolved: { "text->embedding": "native" } }
		})
		await refreshConnectionCapabilityCaches(db, {
			types: [CONNECTION_TYPE.OPENAI_EMBEDDINGS]
		})
		expect(resolvedOf(await reload(row.id))).toEqual(["text->embedding"])
	}, 60_000)
})
