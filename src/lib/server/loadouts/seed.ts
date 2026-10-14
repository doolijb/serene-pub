/**
 * Seeding shipped loadouts (I12): core's set (`CORE_LOADOUTS`) and every
 * enabled plugin's manifest `loadouts[]`.
 *
 * Matched on `seed_key` (the declared id), never on a row id. A shipped
 * loadout arrives **unfilled** and **unmerged**: the pair is the one field a
 * person fills (R53), and installing a plugin never changes which model runs.
 * A re-seed refreshes the prose (name, description, tier, transform) and
 * leaves everything a person set — pair, sampling, workflow, merge, default
 * flag — alone. The sampling preset is resolved by its seed key on INSERT
 * only: a person's later pick is theirs.
 */

import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	isTransformId,
	loadoutDeclProblems,
	parseLoadoutId,
	type LoadoutDecl
} from "@serene-pub/sdk"

export interface LoadoutSeedReport {
	inserted: number
	refreshed: number
	refused: string[]
}

async function samplingIdBySeedKey(db: Db, seedKey: string | undefined) {
	if (!seedKey) return null
	const [row] = await db
		.select({ id: schema.samplingConfigs.id })
		.from(schema.samplingConfigs)
		.where(eq(schema.samplingConfigs.seedKey, seedKey))
		.limit(1)
	return row?.id ?? null
}

/** Seed one owner's declarations. Exported for the plugin path and tests. */
export async function seedLoadoutDecls(
	db: Db,
	owner: string,
	decls: readonly LoadoutDecl[]
): Promise<LoadoutSeedReport> {
	const report: LoadoutSeedReport = { inserted: 0, refreshed: 0, refused: [] }
	if (!decls.length) return report
	const existing = await db
		.select()
		.from(schema.loadouts)
		.where(
			inArray(
				schema.loadouts.seedKey,
				decls.map((d) => d.id)
			)
		)
	const bySeed = new Map(existing.map((r) => [r.seedKey!, r]))
	for (const d of decls) {
		const problems = loadoutDeclProblems(d, owner)
		if (problems.length || !isTransformId(d.transform)) {
			report.refused.push(...(problems.length ? problems : [`'${d.id}': bad transform`]))
			continue
		}
		const slug = parseLoadoutId(d.id)!.name
		const prose = {
			name: d.name,
			description: d.description,
			tier: d.tier ?? null,
			transform: d.transform
		}
		const found = bySeed.get(d.id)
		if (found) {
			await db
				.update(schema.loadouts)
				.set({ ...prose, updatedAt: new Date() })
				.where(eq(schema.loadouts.id, found.id))
			report.refreshed++
			continue
		}
		await db
			.insert(schema.loadouts)
			.values({
				...prose,
				seedKey: d.id,
				owner,
				slug,
				samplingConfigId: await samplingIdBySeedKey(db, d.sampling)
			})
			.onConflictDoNothing()
		report.inserted++
	}
	return report
}

/** Core's set, every boot. Idempotent. */
export async function seedCoreLoadouts(db: Db): Promise<LoadoutSeedReport> {
	const { CORE_LOADOUTS } = await import("@serene-pub/core-catalog")
	return seedLoadoutDecls(db, "core", CORE_LOADOUTS)
}

/**
 * Every enabled plugin's `loadouts[]`. A plugin turned off keeps its rows (a
 * stored config may name them; an unknown loadout id would resolve to nothing
 * where an unfilled one falls back to the default) — the same "withdrawn, not
 * deleted" reading templates take.
 */
export async function seedPluginLoadouts(db: Db): Promise<LoadoutSeedReport> {
	const total: LoadoutSeedReport = { inserted: 0, refreshed: 0, refused: [] }
	const plugins = await db
		.select({
			pluginId: schema.plugins.pluginId,
			manifest: schema.plugins.manifest,
			enabled: schema.plugins.enabled
		})
		.from(schema.plugins)
	for (const p of plugins) {
		if (!p.enabled) continue
		const m = p.manifest as { slug?: unknown; loadouts?: unknown } | null
		const decls = Array.isArray(m?.loadouts) ? (m!.loadouts as LoadoutDecl[]) : []
		if (!decls.length) continue
		// The declared ids carry the package's slug; the row's owner is that slug.
		const owner =
			typeof m?.slug === "string" ? m.slug : (decls[0]!.id.split(":")[0] ?? p.pluginId)
		const r = await seedLoadoutDecls(db, owner, decls)
		total.inserted += r.inserted
		total.refreshed += r.refreshed
		total.refused.push(...r.refused)
	}
	return total
}

/**
 * Which core loadout becomes a transform's default the first time that default
 * is set — `CORE_LOADOUTS[].defaultFor`. Null for a transform core ships no
 * default loadout for (Vision, say): the default then gets a `pub` loadout of
 * its own, named after the transform.
 */
export async function coreDefaultSeedFor(transform: string): Promise<string | null> {
	const { CORE_LOADOUTS } = await import("@serene-pub/core-catalog")
	return (
		CORE_LOADOUTS.find((d) => d.defaultFor && d.transform === transform)?.id ?? null
	)
}
