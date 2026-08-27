/**
 * Embeddings become a connection (20 §14): the endpoint halves of the
 * `vectorization_configs` singleton project into a `connections` row with
 * `modality: 'embeddings'`, and `system_settings.active_embedding_connection_id`
 * points at it — the one active embedding connection, site-wide.
 *
 * One-shot and idempotent: a non-null pointer means done. The singleton keeps
 * its non-endpoint knobs (TTL); its endpoint columns go legacy — read here
 * once, then never written again by anything new.
 *
 * The API key is re-encrypted across key classes (vectorization → connection),
 * because each secret class derives its own HKDF key on purpose
 * (tokenCrypto.ts) — a copied ciphertext would be undecryptable and, worse,
 * would look configured.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	decryptToken,
	encryptApiKeyField,
	VECTORIZATION_API_KEY_INFO
} from "$lib/server/utils/tokenCrypto"

type Db = { select: any; insert: any; update: any }

export async function migrateEmbeddingConnection(
	db: Db
): Promise<{ migrated: boolean; connectionId?: number }> {
	const [settings] = await db
		.select()
		.from(schema.systemSettings)
		.where(eq(schema.systemSettings.id, 1))
		.limit(1)
	if (!settings) return { migrated: false }
	if (settings.activeEmbeddingConnectionId != null)
		return { migrated: false }

	const [vc] = await db
		.select()
		.from(schema.vectorizationConfigs)
		.where(eq(schema.vectorizationConfigs.id, 1))
		.limit(1)

	let values: typeof schema.connections.$inferInsert | null = null
	if (vc?.mode === "api" && vc.apiBaseUrl) {
		const extraJson: Record<string, any> = {}
		if (vc.apiKey && vc.apiKeyIv && vc.apiKeyAuthTag) {
			try {
				const plaintext = decryptToken(
					{
						ciphertext: vc.apiKey,
						iv: vc.apiKeyIv,
						authTag: vc.apiKeyAuthTag
					},
					VECTORIZATION_API_KEY_INFO
				)
				extraJson.apiKey = encryptApiKeyField(plaintext)
			} catch (e) {
				// A key-class mismatch (restored backup, 13 §5) degrades to
				// "needs re-entry" on the new row rather than blocking boot.
				console.warn(
					"[embedding] could not re-encrypt the API key; re-enter it on the new connection:",
					e
				)
			}
		}
		if (vc.apiDimensions != null) extraJson.dimensions = vc.apiDimensions
		values = {
			name: "Embeddings (API)",
			type: "openai-embeddings",
			modality: "embeddings",
			baseUrl: vc.apiBaseUrl,
			model: vc.apiModel ?? null,
			extraJson
		}
	} else if (settings.embeddingModelName) {
		values = {
			name: "Embeddings (Local)",
			type: "local-onnx",
			modality: "embeddings",
			model: settings.embeddingModelName,
			extraJson: {}
		}
	}

	// Nothing was ever configured — a fresh install migrates nothing and the
	// pointer stays null until somebody sets embeddings up.
	if (!values) return { migrated: false }

	const [connection] = await db
		.insert(schema.connections)
		.values(values)
		.returning()
	await db
		.update(schema.systemSettings)
		.set({ activeEmbeddingConnectionId: connection.id })
		.where(eq(schema.systemSettings.id, 1))
	return { migrated: true, connectionId: connection.id }
}
