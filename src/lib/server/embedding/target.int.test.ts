/**
 * Which connection embeds — read from the STAR, and from nothing else.
 *
 * `getConfiguredEmbeddingTarget()` used to read three places at once:
 * `system_settings.vectorization_enabled` (on/off),
 * `system_settings.embedding_model_name` (which local model), and
 * `vectorization_configs` (the API half plus the TTL). That is one fact spelled
 * three times, and the three could disagree — the `mode` column had to be
 * written by every handler that touched either of the others precisely because
 * a stale one made boot reactivate a config the admin had switched away from.
 *
 * There is now one fact: the `text->embedding` row in `connection_defaults`.
 * No star means no embeddings, everywhere the switch used to be read. These
 * assert that, plus the two things the migration's hazard turns on:
 *
 *   · the API key is decrypted under the CONNECTION key class, never the
 *     vectorization one, so a row whose ciphertext was merely copied across
 *     would come back unreadable rather than looking configured; and
 *   · the model identity string is UNCHANGED from what the singleton produced
 *     (`api::baseUrl::model` for an endpoint, the bare HuggingFace id for a
 *     local model), because that string is written into every embedded row's
 *     `embedding_model` column and a new spelling would silently mark every
 *     stored vector stale.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { encryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import {
	EMBEDDING_CAPABILITY,
	embeddingsEnabled,
	resolveEmbeddingTarget
} from "./target"

let db: TestDb

beforeEach(async () => {
	db = await createTestDb()
}, 60_000)

/** A saved embedding connection with a default model row, as the app makes one. */
async function connection(values: Record<string, any>) {
	const [conn] = await db
		.insert(schema.connections)
		.values({
			name: "Embeddings",
			modality: "embeddings",
			extraJson: {},
			capabilities: {},
			...values
		} as any)
		.returning()
	if (values.model) {
		await db.insert(schema.connectionModels).values({
			connectionId: conn.id,
			model: values.model,
			name: values.model,
			isDefault: true
		})
	}
	return conn
}

async function star(connectionId: number | null) {
	await db.delete(schema.connectionDefaults)
	await db
		.insert(schema.connectionDefaults)
		.values({ input: "text", output: "embedding", connectionId })
}

describe("no star", () => {
	it("is the off switch: the target is null and embeddings are disabled", async () => {
		expect(await resolveEmbeddingTarget(db)).toBeNull()
		expect(await embeddingsEnabled(db)).toBe(false)
	}, 60_000)

	it("a CLEARED star is off too, even with the connection still there", async () => {
		// `connection_defaults.connection_id` is ON DELETE SET NULL, so deleting
		// the embedding connection leaves the row behind with a null id. That is
		// a different sentence from "never configured" and the same behaviour:
		// nothing embeds.
		await connection({
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			model: "Xenova/all-MiniLM-L6-v2"
		})
		await star(null)
		expect(await resolveEmbeddingTarget(db)).toBeNull()
		expect(await embeddingsEnabled(db)).toBe(false)
	}, 60_000)

	it("is what a star pointing at a row that is gone resolves to", async () => {
		const conn = await connection({
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			model: "Xenova/all-MiniLM-L6-v2"
		})
		await star(conn.id)
		await db
			.delete(schema.connections)
			.where(eq(schema.connections.id, conn.id))
		expect(await resolveEmbeddingTarget(db)).toBeNull()
	}, 60_000)
})

describe("a starred local ONNX connection", () => {
	it("resolves to the in-process backend under the model's own id", async () => {
		const conn = await connection({
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			model: "Xenova/all-MiniLM-L6-v2"
		})
		await star(conn.id)

		const target = (await resolveEmbeddingTarget(db))!
		expect(target).toMatchObject({
			connectionId: conn.id,
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			mode: "local",
			// ⚠ The bare HuggingFace id, unchanged — every row embedded before
			// the migration carries exactly this string.
			modelId: "Xenova/all-MiniLM-L6-v2",
			localModelName: "Xenova/all-MiniLM-L6-v2"
		})
		expect(await embeddingsEnabled(db)).toBe(true)
	}, 60_000)

	it("defaults the idle TTL to five minutes and reads an override off the row", async () => {
		const conn = await connection({
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			model: "Xenova/all-MiniLM-L6-v2"
		})
		await star(conn.id)
		expect((await resolveEmbeddingTarget(db))!.ttlMinutes).toBe(5)

		await db
			.update(schema.connections)
			.set({ extraJson: { embeddingModelTtlMinutes: 0 } })
			.where(eq(schema.connections.id, conn.id))
		// Zero is a real setting ("keep it loaded"), so it must survive rather
		// than fall through a `||` back to the default.
		expect((await resolveEmbeddingTarget(db))!.ttlMinutes).toBe(0)
	}, 60_000)
})

describe("a starred API connection", () => {
	it("resolves an OpenAI-compatible endpoint with its key decrypted", async () => {
		const conn = await connection({
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			baseUrl: "http://localhost:1234/v1",
			model: "text-embedding-3-small",
			extraJson: { apiKey: encryptApiKeyField("sk-embed-123") }
		})
		await star(conn.id)

		const target = (await resolveEmbeddingTarget(db))!
		expect(target).toMatchObject({
			mode: "api",
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			apiBaseUrl: "http://localhost:1234/v1",
			apiModel: "text-embedding-3-small",
			// ⚠ Byte-identical to what the singleton produced, or every stored
			// vector reads as stale on the first boot after upgrading.
			modelId: "api::http://localhost:1234/v1::text-embedding-3-small"
		})
		// Under the CONNECTION key class. A ciphertext copied from the
		// vectorization class would decrypt to nothing here while the row still
		// looked configured, which is the whole hazard of the move.
		expect(target.apiKey).toBe("sk-embed-123")
		// And the row an adapter is built from still carries the key ENCRYPTED.
		expect(JSON.stringify(target.connection.extraJson)).not.toContain(
			"sk-embed-123"
		)
	}, 60_000)

	it("resolves Ollama, whose route is its own and not the OpenAI shim", async () => {
		const conn = await connection({
			type: CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
			baseUrl: "http://localhost:11434",
			model: "nomic-embed-text"
		})
		await star(conn.id)

		const target = (await resolveEmbeddingTarget(db))!
		expect(target).toMatchObject({
			mode: "api",
			type: CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
			apiBaseUrl: "http://localhost:11434",
			apiModel: "nomic-embed-text"
		})
		// The type is what routes to `/api/embed` rather than `/embeddings`, so
		// it has to survive onto the target — "api" alone cannot say which.
		expect(target.apiKey ?? null).toBeNull()
	}, 60_000)

	it("takes the model the star NAMES, not the endpoint's default", async () => {
		// The pair rule (0114): a registration names `(connection, model)`, and
		// the model half is what an endpoint hosting several is for.
		const conn = await connection({
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			baseUrl: "http://localhost:1234/v1",
			model: "text-embedding-3-small"
		})
		const [other] = await db
			.insert(schema.connectionModels)
			.values({
				connectionId: conn.id,
				model: "text-embedding-3-large",
				name: "large",
				isDefault: false
			})
			.returning()
		await db.delete(schema.connectionDefaults)
		await db.insert(schema.connectionDefaults).values({
			input: "text",
			output: "embedding",
			connectionId: conn.id,
			connectionModelId: other.id
		})

		const target = (await resolveEmbeddingTarget(db))!
		expect(target.apiModel).toBe("text-embedding-3-large")
		expect(target.modelId).toBe(
			"api::http://localhost:1234/v1::text-embedding-3-large"
		)
	}, 60_000)

	it("is null when the endpoint has no base URL yet", async () => {
		// A connection somebody created and has not finished is "nothing to do",
		// not an error on every idle queue tick.
		const conn = await connection({
			type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			baseUrl: "",
			model: "text-embedding-3-small"
		})
		await star(conn.id)
		expect(await resolveEmbeddingTarget(db)).toBeNull()
	}, 60_000)
})

describe("the capability id", () => {
	it("is the one `connection_defaults` keys embeddings by", () => {
		expect(EMBEDDING_CAPABILITY).toBe("text->embedding")
	})
})
