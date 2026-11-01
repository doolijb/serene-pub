import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	withSpeechFacts,
	type SpeechFacts
} from "$lib/shared/connectionAdapters/speechFacts"
import { getSpeechAdapter } from "./getSpeechAdapter"

/**
 * 🚧 The speech facts store: runs a connection's speech discovery for its
 * speaking models and writes the answer under `connection_models.facts.speech`.
 *
 * Lives in the speech adapter family (server side only; not under shared/ or
 * client/, which importBoundary forbids from reaching adapters). `db` is always
 * passed in. Only the `speech` key is written; every other key of the facts bag
 * (the host's `ModelFacts`) is kept, one UPDATE per row.
 */

export interface SpeechRefreshResult {
	model: string
	connectionModelId: number
	speech: SpeechFacts | null
	error?: string
}

export async function refreshSpeechFacts(
	db: Db,
	connectionId: number,
	opts?: {
		/** Refresh only this model (any modality), instead of every "tts" row. */
		model?: string
		/** A `null` discovery clears the stored record instead of keeping it. */
		clearOnNull?: boolean
	}
): Promise<SpeechRefreshResult[]> {
	const connection = await db.query.connections.findFirst({
		where: eq(schema.connections.id, connectionId)
	})
	if (!connection) return []
	const rows = await db
		.select()
		.from(schema.connectionModels)
		.where(
			opts?.model
				? and(
						eq(schema.connectionModels.connectionId, connectionId),
						eq(schema.connectionModels.model, opts.model)
					)
				: and(
						eq(schema.connectionModels.connectionId, connectionId),
						eq(schema.connectionModels.modality, "tts")
					)
		)
	const adapter = await getSpeechAdapter(connection.type)
	const results: SpeechRefreshResult[] = []
	for (const row of rows) {
		const kept = (row.facts as Record<string, any> | null)?.speech ?? null
		if (!adapter?.discoverSpeechFacts) {
			results.push({
				model: row.model,
				connectionModelId: row.id,
				speech: kept,
				error: "This connection type cannot list speech facts."
			})
			continue
		}
		try {
			const speech = await adapter.discoverSpeechFacts(
				connection,
				row.model,
				{ name: row.name }
			)
			if (speech || opts?.clearOnNull) {
				await db
					.update(schema.connectionModels)
					.set({ facts: withSpeechFacts(row.facts, speech) })
					.where(eq(schema.connectionModels.id, row.id))
			}
			results.push({
				model: row.model,
				connectionModelId: row.id,
				speech: speech ?? (opts?.clearOnNull ? null : kept)
			})
		} catch (e: any) {
			results.push({
				model: row.model,
				connectionModelId: row.id,
				speech: kept,
				error: e?.message ?? "Speech discovery failed."
			})
		}
	}
	return results
}
