/**
 * The **attic restore** — the `attic` startup task: every 0.5.3 row, back in
 * `public` in the 0.6 shape, in one transaction (plan §4.1 part B, §4.2).
 *
 * Runs before every other startup task: env-account recovery would otherwise
 * create or touch a user in the emptied `users` table before the 0.5.3 users
 * are back. It needs what `defaults.sync()` seeded first (the admin seed, the
 * shipped sampling configs, the completion templates a connection's prompt
 * format points at) and the entry types in the definition registry — the one
 * seed `defaults.sync()` does not write, published here with the same
 * idempotent sync the pipelines bootstrap runs again after.
 *
 * All or nothing. A failure anywhere rolls every row back, leaves the attic as
 * it was, and throws — the task is critical, so the app does not come up
 * serving an empty database over somebody's data. The next boot tries again.
 * Success ends with the reconciliation passing, the upgrade notes written, the
 * id maps persisted for the wiring, and `__restored` stamped; a boot that finds
 * that stamp goes straight on to the wiring (`finish.ts`).
 */
import { sql } from "drizzle-orm"
import { getAppDataDir } from "$lib/server/db/drizzle.config"
import { atticExists, atticHasTable, atticRestoredAt, ATTIC_SCHEMA } from "./index"
import * as attic from "./tables"
import { UpgradeNotes, writeUpgradeNotes } from "./notes"
import { carriedVectorCounts, embeddingCarryFor, stampCarriedVectors } from "./embeddings"
import { rawRows } from "$lib/server/db/rawRows"
import { ATTIC_LEDGER_PRUNED } from "$lib/server/db/dataUpgrades/0095_schema_0_6_0"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	countDrop,
	liftIndexes,
	resyncSequences,
	spreadSameInstant,
	type RestoreContext
} from "./context"
import { reconcile, mismatches, type ReconcileLine } from "./reconcile"
import { restoreAccountRows, restoreUserSettings, restoreUsers } from "./etl/accounts"
import { restoreCharacters } from "./etl/characters"
import { restoreImages } from "./etl/media"
import {
	linkBindingHistory,
	mergeDuplicateBindings,
	repairCastTags,
	restoreBindings,
	restoreEntries,
	restoreGraph,
	restoreLorebooks
} from "./etl/lore"
import { restoreMessages, restoreSessions } from "./etl/sessions"
import { noteUncarriedConfigParts } from "./etl/configs"
import {
	restoreConnections,
	restorePubSettings,
	restoreSamplingConfigs
} from "./etl/connections"

export interface AtticRestoreReport {
	/** The restore had already committed on an earlier boot. */
	alreadyRestored: boolean
	notes: number
	reconciliation: ReconcileLine[]
	embeddings: { kept: Record<string, number>; dropped: Record<string, number> }
}

export interface AtticRestoreOptions {
	/** Where 0.5.3's `/images/data/users/…` paths resolve. */
	appDataDir?: string
}

export async function restoreFromAttic(
	db: Db,
	opts: AtticRestoreOptions = {}
): Promise<AtticRestoreReport | null> {
	if (!(await atticExists(db))) return null
	if (await atticRestoredAt(db))
		return {
			alreadyRestored: true,
			notes: 0,
			reconciliation: [],
			embeddings: { kept: {}, dropped: {} }
		}

	const appDataDir = opts.appDataDir ?? getAppDataDir()
	const { syncDefinitionRegistry } = await import(
		"$lib/server/pipelines/boot/registrySync"
	)
	const { allEntryTypes } = await import("@serene-pub/sdk")
	await import("@serene-pub/core-catalog")
	const { RESPOND_VERSION } = await import("$lib/server/pipelines/specs/respond")

	const report = await db.transaction(async (tx) => {
		await syncDefinitionRegistry(tx, allEntryTypes(), { release: RESPOND_VERSION })

		const [settings] = await tx.select().from(attic.systemSettings).limit(1)
		const [vc] = await tx.select().from(attic.vectorizationConfigs).limit(1)
		const ctx: RestoreContext = {
			tx,
			appDataDir,
			notes: new UpgradeNotes(),
			embeddings: embeddingCarryFor(settings, vc),
			maps: new Map(),
			dropped: new Map(),
			added: new Map(),
			losses: new Map()
		}

		await restoreUsers(ctx)
		const backgrounds = await restoreUserSettings(ctx)
		await restoreAccountRows(ctx)
		await restoreSamplingConfigs(ctx)
		await restoreConnections(ctx)
		await restorePubSettings(ctx)
		await restoreLorebooks(ctx)
		await restoreCharacters(ctx)
		await restoreImages(ctx, backgrounds)
		const restoreBindingIndexes = await liftIndexes(tx, "lorebook_bindings", [
			"lorebook_bindings_character_unique",
			"lorebook_bindings_binding_unique"
		])
		await restoreBindings(ctx)
		await restoreEntries(ctx)
		await linkBindingHistory(ctx)
		await restoreSessions(ctx)
		await restoreMessages(ctx)
		await restoreGraph(ctx)
		// 0.5.3 dated an entry by its day; 0.6 by its instant.
		await spreadSameInstant(tx, "lorebook_entries", "created_at")

		// Every carried vector is stamped against the text it was computed on,
		// before the repairs below rewrite any of it: a row they rewrite reads
		// stale and is embedded again, once, through the normal queue, and no
		// vector claims text it was not computed from.
		await stampCarriedVectors(tx)

		const merged = await mergeDuplicateBindings(ctx)
		await repairCastTags(ctx)
		await restoreBindingIndexes()

		// The repairs `defaults.sync()` makes to rows it finds, for rows that
		// were not there yet when it ran — every one of them, in its order, so
		// the next boot's sync finds nothing left to change.
		const { backfillMissingBindingNames } = await import(
			"$lib/server/utils/characterBindingSync"
		)
		await backfillMissingBindingNames(tx)
		const { mergeOllamaEmbeddingsType } = await import(
			"$lib/server/connections/ollamaMultiModality"
		)
		await mergeOllamaEmbeddingsType(tx)
		const { foldKoboldCppManagedImage } = await import(
			"$lib/server/connections/koboldCppManagedFold"
		)
		await foldManagedConnections(ctx, foldKoboldCppManagedImage)
		const { refreshConnectionCapabilityCaches } = await import(
			"$lib/server/connections/resolve"
		)
		await refreshConnectionCapabilityCaches(tx)
		const { backfillRelationshipHistoryEntries } = await import(
			"$lib/server/utils/graphBackfill"
		)
		await backfillRelationshipHistoryEntries(tx)

		await resyncSequences(tx)

		const lines = await reconcile(ctx, merged)
		const wrong = mismatches(lines)
		if (wrong.length)
			throw new Error(
				`0.5.3 upgrade: the restored rows do not account for the 0.5.3 database, ` +
					`so nothing was changed and the upgrade will be retried at the next start:\n · ` +
					wrong.join("\n · ")
			)

		await noteUncarriedConfigParts(ctx)
		summarize(ctx, await carriedVectorCounts(tx))
		await noteLedgerPruned(ctx)
		const notes = await writeUpgradeNotes(tx, ctx.notes.list)
		await persistIdMaps(tx, ctx)
		await tx.execute(
			sql.raw(`CREATE TABLE "${ATTIC_SCHEMA}"."__restored" ("at" timestamp NOT NULL)`)
		)
		await tx.insert(attic.restored).values({ at: new Date() })
		return {
			alreadyRestored: false,
			notes,
			reconciliation: lines,
			embeddings: { kept: ctx.embeddings.kept, dropped: ctx.embeddings.dropped }
		}
	})

	return report
}

/**
 * The managed-KoboldCPP fold, counted for the reconciliation and said once.
 *
 * 0.5.3 could hold several `koboldcpp_managed` rows (one per "Use for chat"),
 * plus `koboldcpp_managed_image`; 0.6 has one managed endpoint, and the fold
 * moves the others' models and references onto it and deletes them. The
 * deleted rows, and the model rows that named a model the endpoint already
 * had, are the fold's to account for, not losses.
 */
async function foldManagedConnections(
	ctx: RestoreContext,
	fold: (tx: Db) => Promise<{ folded: number; renamed: number }>
): Promise<void> {
	const { tx } = ctx
	const models = async () =>
		Number(
			rawRows<{ n: number }>(
				await tx.execute(sql`SELECT count(*)::int AS n FROM connection_models`)
			)[0]?.n ?? 0
		)
	const before = await models()
	const { folded } = await fold(tx)
	if (!folded) return
	countDrop(ctx, "connections", folded)
	countDrop(ctx, "connection_models", before - (await models()))
	const [endpoint] = rawRows<{ name: string }>(
		await tx.execute(
			sql`SELECT name FROM connections WHERE type = ${CONNECTION_TYPE.KOBOLDCPP_MANAGED} ORDER BY id LIMIT 1`
		)
	)
	ctx.notes.add({
		topic: "connection-converted",
		objectLabel: endpoint?.name ?? "KoboldCPP",
		summary:
			`${folded} more managed KoboldCPP connection(s) were folded into "${endpoint?.name ?? "KoboldCPP"}": ` +
			`Serene Pub runs one KoboldCPP, and this one connection now lists every model they named.`
	})
}

/**
 * What was carried and what was accepted as lost (D10). The summary note that
 * counts every note is the wiring's, written last (`finish.ts`).
 */
function summarize(ctx: RestoreContext, vectors: Record<string, number>): void {
	const { kept, dropped } = ctx.embeddings
	const total = (r: Record<string, number>) =>
		Object.values(r).reduce((a, b) => a + b, 0)
	const keptN = total(kept)
	const droppedN = total(dropped)
	if (keptN || droppedN)
		ctx.notes.add({
			topic: "embeddings",
			objectLabel: "embeddings",
			summary:
				`${keptN} embedding(s) came from the model 0.6 embeds with and were kept; ` +
				`${droppedN} came from another model or had other dimensions and were dropped — ` +
				`they are made again when an embedding model is starred.`,
			changes: [
				...Object.entries(kept).map(([t, v]) => ({
					field: `kept.${t}`,
					label: `kept from ${t}`,
					after: v
				})),
				...Object.entries(dropped).map(([t, v]) => ({
					field: `dropped.${t}`,
					label: `dropped from ${t}`,
					after: v
				})),
				...Object.entries(vectors).map(([t, v]) => ({
					field: `carried.${t}`,
					label: `vectors in ${t}`,
					after: v
				}))
			]
		})
	for (const [what, n] of ctx.losses)
		ctx.notes.add({
			topic: "accepted-loss",
			objectLabel: what,
			summary: `${n} × ${what}: 0.6 has no place for this, so it was not carried over.`
		})
}

/**
 * The migration ledger rows the stash pruned (`0095_schema_0_6_0.ts`), said
 * once: the upgrade is the only time they are removed, so it is the only time
 * there is anything to say.
 */
async function noteLedgerPruned(ctx: RestoreContext): Promise<void> {
	if (!(await atticHasTable(ctx.tx, ATTIC_LEDGER_PRUNED))) return
	const rows = await ctx.tx.select().from(attic.ledgerPruned)
	if (!rows.length) return
	ctx.notes.add({
		topic: "migration-ledger",
		objectLabel: "Migration record",
		summary:
			`This pub's migration record held ${rows.length} leftover entr${rows.length === 1 ? "y" : "ies"} ` +
			`from earlier 0.5.x builds that match no 0.6 migration; they were removed, once. ` +
			`None of your data was in them.`,
		changes: [{ field: "pruned", label: "entries removed", after: rows.length }]
	})
}

async function persistIdMaps(tx: Db, ctx: RestoreContext): Promise<void> {
	await tx.execute(
		sql.raw(`CREATE TABLE IF NOT EXISTS "${ATTIC_SCHEMA}"."__idmap"
			("table_name" text NOT NULL, "old_id" integer NOT NULL, "new_id" integer NOT NULL)`)
	)
	const rows: Array<{ tableName: string; oldId: number; newId: number }> = []
	for (const [tableName, m] of ctx.maps)
		for (const [oldId, newId] of m) rows.push({ tableName, oldId, newId })
	for (let i = 0; i < rows.length; i += 500)
		await tx.insert(attic.idmap).values(rows.slice(i, i + 500))
}
