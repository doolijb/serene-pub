/**
 * The half of migration 0127 that SQL cannot do: the key, and the capabilities.
 *
 * ## The key
 *
 * `vectorization_configs.api_key` was AES-256-GCM ciphertext under a key class
 * of its own (`serene-pub:vectorizationApiKey:v1`), derived from the app secret
 * by an HKDF info string distinct from the connection one
 * (`serene-pub:connectionApiKey:v1`). Each secret class derives its own key ON
 * PURPOSE — `tokenCrypto.ts` explains at length why — and the consequence here
 * is sharp: **a ciphertext copied across is undecryptable, and looks
 * configured**. The connection would show a key set, every embed would fail on
 * authentication, and nothing on screen would name the secret as the cause.
 *
 * A migration file cannot re-encrypt: it has neither the app secret nor AES. So
 * 0127 QUARANTINES the old envelope under
 * `extra_json.__legacyVectorizationApiKey` and this step converts it exactly
 * once, decrypting under the old class and re-encrypting under the new. ⚠ The
 * quarantine name must never be `apiKey`: that is the name the whole crypto path
 * walks, and a row this step has not reached yet would then read as configured.
 *
 * The row is found by that quarantine as well as by `modality = 'embeddings'`.
 * The 0.5.3 upgrade writes its API embedding row as `openai-embeddings`, and
 * the OpenAI-compatible merge (`connections/openAIMultiModality.ts`) renames
 * it onto `openai` — a `text-gen` row — in the same boot, before this runs. A
 * lookup by modality alone would leave its key quarantined for good.
 *
 * ⚠ The conversion is one-way and the quarantine is CONSUMED, so a second boot
 * finds nothing. An envelope this cannot read (a backup restored beside a
 * different `meta.json`) is DROPPED with a warning rather than carried forward,
 * because a key nobody can decrypt is worse than no key: one asks to be
 * re-entered, the other pretends to work.
 *
 * ## The capabilities
 *
 * A connection's `capabilities.resolved` is a cache of the four resolution
 * layers, and computing it means reading the adapter manifest —
 * `resolveConnectionCapabilities`, which SQL also cannot run. So a row 0127
 * created carries `{}`, and a row the OLD boot step created (the one that
 * predates this file) carries `{}` too, because it never set the column either.
 *
 * `capabilityGuard` reads an empty set as "nobody has determined this yet" and
 * falls back to judging by modality, which is correct but coarse. Filling it in
 * here makes the row say what it can do in the same terms every other connection
 * does, so the picker greys it consistently and `capabilityRefusal` has
 * something real to read.
 *
 * ## Why this is a boot step and not more SQL
 *
 * Ordering. Migrations run when the database is opened; boot tasks run after. A
 * boot step that tried to do the whole move would find `vectorization_configs`
 * already dropped by 0127's own DDL.
 */

import { eq, isNotNull, or, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	decryptToken,
	encryptApiKeyField,
	VECTORIZATION_API_KEY_INFO
} from "$lib/server/utils/tokenCrypto"
import { resolveConnectionCapabilities } from "$lib/server/connections/resolve"

/**
 * The quarantine key 0127 writes.
 *
 * ⚠ Spelled once, here, and the SQL spells it once, there. If the two ever
 * disagree the envelope is stranded — present, unconverted, and invisible.
 */
const LEGACY_KEY = "__legacyVectorizationApiKey"

export interface EmbeddingMigrationReport {
	/** Keys moved from the vectorization class to the connection class. */
	keysConverted: number
	/** Keys dropped because they could not be decrypted. */
	keysFailed: number
	/** Rows whose capability cache this filled in. */
	capabilitiesResolved: number
}

export async function migrateEmbeddingConnection(
	db: Db
): Promise<EmbeddingMigrationReport> {
	const report: EmbeddingMigrationReport = {
		keysConverted: 0,
		keysFailed: 0,
		capabilitiesResolved: 0
	}

	const rows = await db
		.select()
		.from(schema.connections)
		.where(
			or(
				eq(schema.connections.modality, "embeddings"),
				isNotNull(
					sql`${schema.connections.extraJson} -> ${LEGACY_KEY}::text`
				)
			)
		)

	for (const row of rows) {
		const extra = { ...((row.extraJson ?? {}) as Record<string, any>) }
		let patch: Record<string, unknown> | null = null

		const legacy = extra[LEGACY_KEY]
		if (
			legacy &&
			typeof legacy === "object" &&
			typeof legacy.ciphertext === "string" &&
			typeof legacy.iv === "string" &&
			typeof legacy.authTag === "string"
		) {
			// The quarantine is consumed whatever happens below — a second pass
			// must never re-attempt a conversion that already succeeded (it
			// would decrypt a connection-class envelope with the vectorization
			// key and throw) nor one that already failed.
			delete extra[LEGACY_KEY]
			try {
				const plaintext = decryptToken(
					{
						ciphertext: legacy.ciphertext,
						iv: legacy.iv,
						authTag: legacy.authTag
					},
					VECTORIZATION_API_KEY_INFO
				)
				extra.apiKey = encryptApiKeyField(plaintext)
				report.keysConverted++
			} catch (e) {
				// A key-class mismatch (a restored backup beside a different
				// `meta.json`) degrades to "needs re-entry" on the new row
				// rather than blocking boot — and rather than leaving an
				// unreadable envelope that reads as configured.
				console.warn(
					`[embedding] could not re-encrypt the API key for connection ${row.id}; re-enter it on the connection:`,
					e
				)
				report.keysFailed++
			}
			patch = { extraJson: extra }
		}

		// The capability cache, for a row SQL created. Computed from the row as
		// it will be AFTER the key patch, though nothing in the resolution reads
		// `extra_json` — passed whole so this cannot start being wrong if that
		// ever changes.
		const resolved = (row.capabilities as { resolved?: unknown })?.resolved
		if (!resolved || Object.keys(resolved as object).length === 0) {
			const next = resolveConnectionCapabilities({
				...row,
				extraJson: extra
			} as any)
			if (Object.keys(next).length) {
				patch = {
					...(patch ?? {}),
					capabilities: {
						...((row.capabilities ?? {}) as Record<
							string,
							unknown
						>),
						resolved: next
					}
				}
				report.capabilitiesResolved++
			}
		}

		if (patch)
			await db
				.update(schema.connections)
				.set(patch as any)
				.where(eq(schema.connections.id, row.id))
	}

	return report
}
