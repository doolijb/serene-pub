/**
 * 0127: the embedding singleton becomes a connection, and the star becomes the
 * switch.
 *
 * ## Why this is tested against the shipped SQL, on a REGRESSED database
 *
 * `createTestDb` applies every migration including this one, so the columns
 * 0127 drops are already gone and a fixture written afterwards could not meet
 * it. Each case therefore puts the database back into the shape a real upgrade
 * finds it in — the three `system_settings` columns re-added, the
 * `vectorization_configs` singleton recreated — seeds it, and replays the real
 * file. A DML migration matched on string literals fails SILENTLY when it
 * matches nothing, and on a fresh database "matched nothing" and "worked" look
 * identical; this is what tells them apart.
 *
 * ## The hazard, stated plainly
 *
 * The API key is encrypted at rest under a key class of its own
 * (`VECTORIZATION_API_KEY_INFO`), derived from the app secret by an HKDF info
 * string distinct from the connection one. **A ciphertext copied across is
 * undecryptable and, worse, looks configured** — the row would show a key set,
 * every embed would fail on authentication, and nothing on screen would say the
 * secret was the problem.
 *
 * SQL cannot decrypt, so the migration cannot re-encrypt. It QUARANTINES the
 * old envelope under `extra_json.__legacyVectorizationApiKey` — a name nothing
 * in the running app reads — and the boot step converts it exactly once into
 * `extra_json.apiKey` under the connection class. The two halves are asserted
 * separately below, and the quarantine name is asserted to NOT be `apiKey`,
 * because that is precisely the mistake this shape exists to make impossible.
 */

import { beforeEach, describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { eq, sql } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	decryptApiKeyField,
	encryptToken,
	VECTORIZATION_API_KEY_INFO
} from "$lib/server/utils/tokenCrypto"
import { migrateEmbeddingConnection } from "./migrateEmbeddingConnection"

const TAG = "0127_embeddings_are_connections"
/** The file that ships, not a re-typed copy of it. */
const MIGRATION = readFileSync(`drizzle/${TAG}.sql`, "utf8")

let db: TestDb

/**
 * Put the schema back the way 0126 left it, and seed the singleton.
 *
 * The `system_settings` columns and the whole `vectorization_configs` table are
 * recreated verbatim from what 0094's baseline declared, because a fixture that
 * differed would test a schema no install ever had.
 *
 * ⚠ `connections.model` and `connection_models.is_default` come back too, and
 * they belong to a LATER migration than the one under test: 0128 drops both
 * when the per-connection default goes away. That is the honest cost of a
 * hand-written inverse — 0127 writes an identifier into `connections.model` and
 * reads `is_default` when it creates the model row, so without them the file
 * that ships cannot be replayed at all.
 */
async function regress(seed: {
	vectorizationEnabled?: boolean
	embeddingModelName?: string | null
	activeEmbeddingConnectionId?: number | null
	vc?: Record<string, unknown> | null
}) {
	// One statement per `execute`: PGlite's protocol refuses a prepared
	// statement carrying several.
	for (const stmt of [
		`ALTER TABLE "system_settings" ADD COLUMN "vectorization_enabled" boolean NOT NULL DEFAULT false`,
		`ALTER TABLE "system_settings" ADD COLUMN "embedding_model_name" text`,
		`ALTER TABLE "system_settings" ADD COLUMN "active_embedding_connection_id" integer`,
		// ⚠ The foreign key is added by NAME, exactly as 0094's baseline spells
		// it, because 0127 drops it by that name. An inline `REFERENCES` would
		// get Postgres's auto-generated `…_fkey` instead and the drop would fail
		// here while succeeding on every real install.
		`ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_active_embedding_connection_id_connections_id_fk" FOREIGN KEY ("active_embedding_connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action`,
		`ALTER TABLE "connections" ADD COLUMN "model" text`,
		`ALTER TABLE "connection_models" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL`,
		// By NAME, as 0114 spells it, because 0128 drops it by that name — and
		// because the partial UNIQUE index is what 0127's `NOT EXISTS` guard is
		// written against.
		`CREATE UNIQUE INDEX "connection_models_one_default" ON "connection_models" USING btree ("connection_id") WHERE "connection_models"."is_default"`,
		`CREATE TABLE "vectorization_configs" (
			"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
			"embedding_model_ttl_minutes" integer DEFAULT 5 NOT NULL,
			"mode" text DEFAULT 'local' NOT NULL,
			"api_base_url" text,
			"api_key" text,
			"api_key_iv" text,
			"api_key_auth_tag" text,
			"api_model" text,
			"api_dimensions" integer
		)`
	])
		await db.execute(stmt)
	await db.insert(schema.systemSettings).values({ id: 1 } as any)
	await db.execute(sql`
		UPDATE system_settings SET
			vectorization_enabled = ${seed.vectorizationEnabled ?? false},
			embedding_model_name = ${seed.embeddingModelName ?? null},
			active_embedding_connection_id = ${seed.activeEmbeddingConnectionId ?? null}
		WHERE id = 1
	`)
	if (seed.vc !== null) {
		const vc = seed.vc ?? {}
		await db.execute(sql`
			INSERT INTO vectorization_configs
				(id, embedding_model_ttl_minutes, mode, api_base_url, api_key, api_key_iv, api_key_auth_tag, api_model, api_dimensions)
			VALUES (
				1,
				${(vc.ttl as number) ?? 5},
				${(vc.mode as string) ?? "local"},
				${(vc.apiBaseUrl as string) ?? null},
				${(vc.apiKey as string) ?? null},
				${(vc.apiKeyIv as string) ?? null},
				${(vc.apiKeyAuthTag as string) ?? null},
				${(vc.apiModel as string) ?? null},
				${(vc.apiDimensions as number) ?? null}
			)
		`)
	}
}

/**
 * Apply the shipped file the way drizzle does: one statement per breakpoint.
 *
 * ⚠ Not `db.execute(MIGRATION)` — PGlite refuses a prepared statement holding
 * several commands, so a single call would fail on the first breakpoint and
 * never reach the DDL this suite is about.
 */
async function replay() {
	for (const statement of MIGRATION.split("--> statement-breakpoint"))
		if (statement.trim()) await db.execute(statement)
}

const embeddingConnections = () =>
	db
		.select()
		.from(schema.connections)
		.where(eq(schema.connections.modality, "embeddings"))

const star = async () => {
	const [row] = await db
		.select()
		.from(schema.connectionDefaults)
		.where(eq(schema.connectionDefaults.output, "embedding"))
	return row
}

beforeEach(async () => {
	db = await createTestDb()
}, 60_000)

describe("an API configuration", () => {
	const enc = () => encryptToken("sk-embed-123", VECTORIZATION_API_KEY_INFO)

	it("becomes a starred connection whose key survives the class change", async () => {
		const e = enc()
		await regress({
			vectorizationEnabled: true,
			embeddingModelName:
				"api::http://localhost:1234/v1::text-embedding-3-small",
			vc: {
				mode: "api",
				apiBaseUrl: "http://localhost:1234/v1",
				apiModel: "text-embedding-3-small",
				apiDimensions: 1536,
				apiKey: e.ciphertext,
				apiKeyIv: e.iv,
				apiKeyAuthTag: e.authTag
			}
		})

		await replay()

		const [conn] = await embeddingConnections()
		expect(conn).toMatchObject({
			type: "openai-embeddings",
			modality: "embeddings",
			baseUrl: "http://localhost:1234/v1"
		})
		expect((conn.extraJson as any).dimensions).toBe(1536)

		// The identifier lives on a MODEL row, which is the half a star has to
		// name: an endpoint on its own is an incomplete registration.
		const [model] = await db
			.select()
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.connectionId, conn.id))
		expect(model).toMatchObject({ model: "text-embedding-3-small" })

		// Starred, with BOTH halves of the pair.
		expect(await star()).toMatchObject({
			input: "text",
			output: "embedding",
			connectionId: conn.id,
			connectionModelId: model.id
		})

		// ⚠ QUARANTINED, not installed. The ciphertext is present under a name
		// nothing in the running app reads, and `apiKey` — the name the whole
		// crypto path walks — is still absent, so a row the boot step has not
		// reached yet cannot look configured.
		const extra = conn.extraJson as any
		expect(extra.apiKey).toBeUndefined()
		expect(extra.__legacyVectorizationApiKey).toMatchObject({
			ciphertext: e.ciphertext,
			iv: e.iv,
			authTag: e.authTag
		})
		// And it never rests as plaintext at any point.
		expect(JSON.stringify(extra)).not.toContain("sk-embed-123")
	}, 60_000)

	it("is finished by the boot step, which re-encrypts exactly once", async () => {
		const e = enc()
		await regress({
			vectorizationEnabled: true,
			vc: {
				mode: "api",
				apiBaseUrl: "http://localhost:1234/v1",
				apiModel: "text-embedding-3-small",
				apiKey: e.ciphertext,
				apiKeyIv: e.iv,
				apiKeyAuthTag: e.authTag
			}
		})
		await replay()

		const r = await migrateEmbeddingConnection(db)
		expect(r.keysConverted).toBe(1)

		const [conn] = await embeddingConnections()
		const extra = conn.extraJson as any
		// Readable under the CONNECTION class, which is the whole hazard.
		expect(decryptApiKeyField(extra.apiKey)).toBe("sk-embed-123")
		// The quarantine is consumed, so nothing can convert it twice.
		expect(extra.__legacyVectorizationApiKey).toBeUndefined()
		expect(JSON.stringify(extra)).not.toContain("sk-embed-123")

		// Idempotent: a second boot finds nothing to do and leaves the key alone.
		expect((await migrateEmbeddingConnection(db)).keysConverted).toBe(0)
		const [again] = await embeddingConnections()
		expect(decryptApiKeyField((again.extraJson as any).apiKey)).toBe(
			"sk-embed-123"
		)
	}, 60_000)

	it("degrades a key it cannot read to 'needs re-entry' rather than blocking boot", async () => {
		// A restored backup whose `meta.json` secret differs. The envelope is
		// dropped and the connection is left asking for the key, which is the
		// only honest outcome — carrying an unreadable ciphertext forward is
		// exactly the "looks configured" failure.
		await regress({
			vectorizationEnabled: true,
			vc: {
				mode: "api",
				apiBaseUrl: "http://localhost:1234/v1",
				apiModel: "m",
				apiKey: "not-a-real-ciphertext",
				apiKeyIv: "0".repeat(24),
				apiKeyAuthTag: "0".repeat(32)
			}
		})
		await replay()

		const r = await migrateEmbeddingConnection(db)
		expect(r.keysFailed).toBe(1)
		const [conn] = await embeddingConnections()
		const extra = conn.extraJson as any
		expect(extra.apiKey).toBeUndefined()
		expect(extra.__legacyVectorizationApiKey).toBeUndefined()
	}, 60_000)
})

describe("a local configuration", () => {
	it("becomes a starred local-onnx connection naming the same model", async () => {
		await regress({
			vectorizationEnabled: true,
			embeddingModelName: "Xenova/all-MiniLM-L6-v2",
			vc: { mode: "local", ttl: 15 }
		})
		await replay()

		const [conn] = await embeddingConnections()
		expect(conn).toMatchObject({
			type: "local-onnx",
			modality: "embeddings"
		})
		const [model] = await db
			.select()
			.from(schema.connectionModels)
			.where(eq(schema.connectionModels.connectionId, conn.id))
		expect(model).toMatchObject({ model: "Xenova/all-MiniLM-L6-v2" })
		// The TTL was the only knob on the singleton worth keeping, and it is a
		// property of THIS connection now rather than of the instance.
		expect((conn.extraJson as any).embeddingModelTtlMinutes).toBe(15)
		expect((await star())?.connectionId).toBe(conn.id)
	}, 60_000)
})

describe("embeddings that were switched OFF", () => {
	it("keeps the configuration as a connection but does not star it", async () => {
		// The switch is gone, and the star is what replaces it. Starring a row
		// the admin had deliberately turned off would switch embeddings back on
		// during an upgrade; dropping the row would throw their setup away. So:
		// saved, unstarred.
		await regress({
			vectorizationEnabled: false,
			embeddingModelName: "Xenova/all-MiniLM-L6-v2",
			vc: { mode: "local" }
		})
		await replay()

		const conns = await embeddingConnections()
		expect(conns).toHaveLength(1)
		expect(await star()).toBeUndefined()
	}, 60_000)
})

describe("an install the old boot step already migrated", () => {
	it("stars the row that exists instead of making a second one", async () => {
		// `active_embedding_connection_id` was written by the boot step that
		// shipped before this migration. Its key is ALREADY in the connection
		// class, so nothing may be quarantined over it.
		const [existing] = await db
			.insert(schema.connections)
			.values({
				name: "Embeddings (API)",
				type: "openai-embeddings",
				modality: "embeddings",
				baseUrl: "http://localhost:1234/v1",
				extraJson: {
					apiKey: {
						__enc: true,
						ciphertext: "x",
						iv: "y",
						authTag: "z"
					}
				}
			} as any)
			.returning()
		const e = encryptToken("sk-old", VECTORIZATION_API_KEY_INFO)
		await regress({
			vectorizationEnabled: true,
			activeEmbeddingConnectionId: existing.id,
			vc: {
				mode: "api",
				apiBaseUrl: "http://localhost:1234/v1",
				apiModel: "text-embedding-3-small",
				apiKey: e.ciphertext,
				apiKeyIv: e.iv,
				apiKeyAuthTag: e.authTag
			}
		})
		// The identifier the boot step of that era left in `connections.model`,
		// written through the column `regress` just restored — 0127 reads it
		// from there to name the pair.
		await db.execute(sql`
			UPDATE connections SET model = 'text-embedding-3-small'
			WHERE id = ${existing.id}
		`)
		await replay()

		const conns = await embeddingConnections()
		expect(conns).toHaveLength(1)
		expect(conns[0].id).toBe(existing.id)
		const registered = await star()
		expect(registered?.connectionId).toBe(existing.id)
		// BOTH halves: an endpoint-only star resolves as unconfigured.
		expect(registered?.connectionModelId).toBeTruthy()
		// ⚠ The already-converted key is untouched, and no stale envelope is
		// laid over it.
		const extra = conns[0].extraJson as any
		expect(extra.apiKey).toMatchObject({ __enc: true, ciphertext: "x" })
		expect(extra.__legacyVectorizationApiKey).toBeUndefined()
	}, 60_000)
})

describe("a fresh install", () => {
	it("migrates nothing and stars nothing", async () => {
		await regress({ vectorizationEnabled: false, vc: {} })
		await replay()
		expect(await embeddingConnections()).toHaveLength(0)
		expect(await star()).toBeUndefined()
		expect((await migrateEmbeddingConnection(db)).keysConverted).toBe(0)
	}, 60_000)
})

describe("what the migration removes", () => {
	it("drops the three columns and the singleton table", async () => {
		await regress({ vectorizationEnabled: true, vc: { mode: "local" } })
		await replay()

		const cols = await db.execute(sql`
			SELECT column_name FROM information_schema.columns
			WHERE table_name = 'system_settings'
		`)
		const names = (cols.rows as Array<{ column_name: string }>).map(
			(r) => r.column_name
		)
		expect(names).not.toContain("vectorization_enabled")
		expect(names).not.toContain("embedding_model_name")
		expect(names).not.toContain("active_embedding_connection_id")

		const tables = await db.execute(sql`
			SELECT table_name FROM information_schema.tables
			WHERE table_name = 'vectorization_configs'
		`)
		expect(tables.rows).toHaveLength(0)
	}, 60_000)
})

describe("the journal", () => {
	it("runs at all: the journal rises in step with itself", () => {
		// ⚠ A lower-numbered migration is SILENTLY SKIPPED on an install that
		// has already applied a higher one. Drizzle compares `when`, so a file
		// whose timestamp sits below its index never runs and nothing says so.
		// The checkable invariant is the whole journal's: `idx` and `when` rise
		// together, so every file is newer than the one before it.
		const journal = JSON.parse(
			readFileSync("drizzle/meta/_journal.json", "utf8")
		) as {
			entries: Array<{ tag: string; idx: number; when: number }>
		}
		const mine = journal.entries.find((e) => e.tag === TAG)
		expect(
			mine,
			`${TAG} has no journal entry, so it runs nowhere`
		).toBeTruthy()
		const byIdx = [...journal.entries].sort((a, b) => a.idx - b.idx)
		for (let i = 1; i < byIdx.length; i++)
			expect(
				byIdx[i].when,
				`${byIdx[i].tag} (idx ${byIdx[i].idx}) is stamped at or before ` +
					`${byIdx[i - 1].tag} (idx ${byIdx[i - 1].idx}), so it is ` +
					`skipped on any install that has already applied that one.`
			).toBeGreaterThan(byIdx[i - 1].when)
	})
})
