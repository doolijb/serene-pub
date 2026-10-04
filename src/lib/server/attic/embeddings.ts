/**
 * Which 0.5.3 vectors survive the upgrade (owner ruling D4, 2026-10-01).
 *
 * A vector is kept only when 0.6 can confirm it came from the model it will
 * embed with: the stored `embedding_model` names the same identity the
 * projected embedding connection produces (`buildApiModelId` for an endpoint,
 * the bare id for a local model — the string `target.ts` writes and staleness
 * compares) **and** it has that model's dimensions. Everything else is
 * dropped, and the queue re-embeds it through its normal path when a model is
 * starred.
 *
 * A kept vector is stamped with the hash of the text 0.6 embeds for its row
 * (`embedding_source_hash` / `source_hash`), so the first boot finds it fresh
 * and pays for nothing. The stamp is written against the text the vector was
 * computed on — before the restore's repairs (binding merge, cast-tag repair,
 * name back-fill) rewrite any of it — so a row a repair rewrites reads stale
 * and is embedded again once, and no vector claims text it never saw.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"
import { buildApiModelId, sameEmbeddingModel } from "$lib/server/embedding/target"
import { findModel } from "$lib/server/embedding/models"
import type * as attic from "./tables"

/** The 0.5.3 tables that carried a vector, and where each one's vectors land. */
export const EMBEDDED_ATTIC_TABLES = [
	"world_lore_entries",
	"character_lore_entries",
	"history_entries",
	"characters",
	"personas",
	"chat_messages",
	"lorebook_bindings",
	"narrative_relationships",
	"scenes"
] as const
export type EmbeddedAtticTable = (typeof EMBEDDED_ATTIC_TABLES)[number]

export interface EmbeddingCarry {
	/** The identity the upgraded embedding connection embeds as, or null. */
	identity: string | null
	dims: number | null
	kept: Record<string, number>
	dropped: Record<string, number>
	/** Keep this vector? Counts the answer against `table`. */
	keep(
		table: EmbeddedAtticTable,
		model: string | null | undefined,
		vector: number[] | null | undefined
	): boolean
}

/**
 * The identity and dimensions 0.6 will embed with, read from 0.5.3's own
 * settings — the same projection `connections.ts` makes of them.
 */
export function embeddingCarryFor(
	settings: typeof attic.systemSettings.$inferSelect | undefined,
	vc: typeof attic.vectorizationConfigs.$inferSelect | undefined
): EmbeddingCarry {
	let identity: string | null = null
	let dims: number | null = null
	if (vc?.mode === "api" && (vc.apiBaseUrl ?? "") !== "") {
		if (vc.apiModel) identity = buildApiModelId(vc.apiBaseUrl!, vc.apiModel)
		dims = vc.apiDimensions ?? settings?.embeddingModelDimensions ?? null
	} else if ((settings?.embeddingModelName ?? "") !== "") {
		identity = settings!.embeddingModelName!
		dims =
			findModel(identity)?.dimensions ??
			settings?.embeddingModelDimensions ??
			null
	}

	const kept: Record<string, number> = {}
	const dropped: Record<string, number> = {}
	return {
		identity,
		dims,
		kept,
		dropped,
		keep(table, model, vector) {
			if (!vector || !vector.length) return false
			const ok =
				identity != null &&
				dims != null &&
				!!model &&
				sameEmbeddingModel(model, identity) &&
				vector.length === dims
			const tally = ok ? kept : dropped
			tally[table] = (tally[table] ?? 0) + 1
			return ok
		}
	}
}

/** The vector columns of a column-store row, kept or cleared. */
export function vectorColumns(
	carry: EmbeddingCarry,
	table: EmbeddedAtticTable,
	row: {
		embedding?: number[] | null
		embeddingModel?: string | null
		vectorizedAt?: Date | string | null
	}
): {
	embedding: number[] | null
	embeddingModel: string | null
	vectorizedAt: Date | null
} {
	if (carry.keep(table, row.embeddingModel, row.embedding))
		return {
			embedding: row.embedding!,
			embeddingModel: carry.identity,
			vectorizedAt: row.vectorizedAt ? new Date(row.vectorizedAt) : new Date()
		}
	return { embedding: null, embeddingModel: null, vectorizedAt: null }
}

/**
 * Stamp every carried vector with the hash of the text it now stands for.
 *
 * The column stores read their own GENERATED `embed_text_hash`; relationships
 * hash the text the queue builds from both members' names
 * (`relationshipEmbedText`); entries hash `lorebook_entries.embed_text_hash`.
 */
export async function stampCarriedVectors(tx: Db): Promise<void> {
	for (const t of ["session_messages", "characters", "lorebook_bindings"])
		await tx.execute(
			sql.raw(`UPDATE public."${t}" SET "embedding_source_hash" = "embed_text_hash"
				WHERE "embedding" IS NOT NULL`)
		)
	const { relationshipEmbedText } = await import(
		"$lib/server/embedding/vectorizationQueue"
	)
	await tx.execute(sql`
		UPDATE "narrative_relationships" SET "embedding_source_hash" =
			left(encode(sha256(convert_to(${relationshipEmbedText}, 'UTF8')), 'hex'), 16)
		WHERE "embedding" IS NOT NULL`)
	await tx.execute(sql`
		UPDATE "lorebook_entry_vectors" v SET "source_hash" = e."embed_text_hash"
		FROM "lorebook_entries" e WHERE e."id" = v."entry_id"`)
}

/** Kept vectors per live store, after the restore's rewrites. */
export async function carriedVectorCounts(
	tx: Db
): Promise<Record<string, number>> {
	const out: Record<string, number> = {}
	for (const t of [
		"session_messages",
		"characters",
		"lorebook_bindings",
		"narrative_relationships",
		"scenes"
	]) {
		const rows = rawRows<{ n: number }>(
			await tx.execute(
				sql.raw(`SELECT count(*)::int AS n FROM public."${t}" WHERE "embedding" IS NOT NULL`)
			)
		)
		out[t] = Number(rows[0]?.n ?? 0)
	}
	const rows = rawRows<{ n: number }>(
		await tx.execute(
			sql.raw(`SELECT count(*)::int AS n FROM public."lorebook_entry_vectors"`)
		)
	)
	out.lorebook_entry_vectors = Number(rows[0]?.n ?? 0)
	return out
}
