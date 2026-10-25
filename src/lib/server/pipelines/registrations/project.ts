/**
 * 🚧 **Projecting declarations into registration rows** (PLAN-layering D7;
 * 2026-10-20) — the boot's re-sync, like `syncPluginPresets` and
 * `seedSessionPresets` before it:
 *
 *  · **the genre's defaults** of every genre this instance knows → rows at
 *    genre scope, origin `genre` (declared, or ⏳ derived from old locks for
 *    a package genre that declares none — `genreDefaults.ts`). Rows an
 *    administrator added at genre scope (another origin) are left alone;
 *  · **core's shipped presets** → their changes (`CorePresetSeed.registrations`)
 *    at preset scope, origin `preset`, on the row while it is immutable;
 *  · **a package's shipped presets** → their changes, origin
 *    `package:<plugin id>`: `PresetDecl.registrations` when the package
 *    states them, else ⏳ derived from its `bindings` and `actions.include`
 *    (`presetChangesOf`), a binding's configuration becoming that
 *    registration's `values` (R38);
 *  · **one default per genre** (R22): a core seed marked default becomes its
 *    genre's default when the genre has none (Guide, Lair and Dungeon
 *    Crawler's seeds were not, before 2026-10-20).
 *
 * Idempotent: an unchanged row is not rewritten. An administrator's preset
 * (not immutable) is never touched — its rows are theirs.
 */
import { and, asc, eq } from "drizzle-orm"
import { genres, presetChangesOf, type PresetRegistrationChanges, type RegistrationDecl } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	ensureCoreGenres,
	genreDefaultsFor,
	type LockedSpecRow
} from "$lib/server/pipelines/registrations/genreDefaults"
import {
	rowOfChange,
	rowOfDecl,
	rowsOfPresetChanges,
	valuesOfConfigRows,
	type RegistrationInsert
} from "$lib/server/pipelines/registrations/rows"
import { replaceRows } from "$lib/server/pipelines/registrations/write"
import { invalidateRegistrations } from "$lib/server/pipelines/registrations/resolve"

export interface RegistrationProjectionReport {
	genres: Array<{ genreId: string; registrations: number; derived: boolean; changed: boolean }>
	presets: Array<{ presetId: number; seedKey: string; rows: number; changed: boolean }>
	/** Seed keys made their genre's default (R22). */
	defaultsMarked: string[]
	/** `<seed key> <registration key>`: a package preset's configuration that resolved to no installed row. */
	unresolvedConfigs: string[]
}

/** The published, active specs and their old locks — ordered by spec id, the old tie-break. */
export async function lockedSpecRows(db: Db): Promise<LockedSpecRow[]> {
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			inputEvents: schema.pipelineSpecVersions.inputEvents,
			contributes: schema.pipelineSpecVersions.contributes,
			suits: schema.pipelineSpecVersions.suits
		})
		.from(schema.pipelineSpecs)
		.innerJoin(schema.pipelineSpecVersions, eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId))
		.orderBy(asc(schema.pipelineSpecs.id))
	return rows
		.filter((r) => r.activeVersionId === r.versionId && r.status === "published")
		.map((r) => ({
			slug: r.slug,
			inputGenre: r.inputGenre ?? null,
			inputEvent: r.inputEvent ?? null,
			inputEvents: (r.inputEvents as string[] | null) ?? null,
			contributes: r.contributes,
			suits: (r.suits as string[] | null) ?? null
		}))
}

/** Project every declaration this instance knows into rows. Never throws for one bad declaration. */
export async function projectRegistrations(db: Db): Promise<RegistrationProjectionReport> {
	const report: RegistrationProjectionReport = { genres: [], presets: [], defaultsMarked: [], unresolvedConfigs: [] }
	// Whatever this boot or sync changed underneath (specs published, plugins
	// switched), nothing resolved before it may answer after it.
	invalidateRegistrations()
	await ensureCoreGenres()
	const locked = await lockedSpecRows(db)

	// ── the genre's defaults ──────────────────────────────────────────────
	const ids = new Set<string>()
	for (const g of genres()) ids.add(g.id)
	// ⏳ A package genre known only by its specs' old locks. A transitional
	// input-type genre (`ns:inlet/x@1`) is not a genre id and gets none.
	for (const s of locked) if (s.inputGenre && !s.inputGenre.includes("@")) ids.add(s.inputGenre)
	const defaultsByGenre = new Map<string, readonly RegistrationDecl[]>()
	for (const genreId of [...ids].sort()) {
		try {
			const { registrations, derived } = await genreDefaultsFor(genreId, locked)
			defaultsByGenre.set(genreId, registrations)
			const scope = { kind: "genre" as const, genreId }
			const changed = await replaceRows(
				db,
				scope,
				registrations.map((d) => rowOfDecl(d, scope, "genre")),
				["genre"]
			)
			report.genres.push({ genreId, registrations: registrations.length, derived, changed })
		} catch (err) {
			console.warn(`[registrations] could not project the defaults of '${genreId}':`, err)
		}
	}

	// ── core's shipped presets ────────────────────────────────────────────
	const { corePresetSeeds } = await import("@serene-pub/core-catalog")
	for (const seed of corePresetSeeds()) {
		const [row] = await db
			.select()
			.from(schema.sessionPresets)
			.where(eq(schema.sessionPresets.seedKey, seed.seedKey))
			.limit(1)
		if (!row) continue
		if (row.isImmutable) {
			// A shipped row is re-forced to what ships (the posture a plugin's
			// shipped presets take): its card, its pins, its derived bindings
			// (⏳ unread) — never `enabled` or `is_default`, the
			// administrator's.
			const shipped = {
				name: seed.name,
				description: seed.description,
				bindings: seed.bindings,
				includedActions: null,
				defaults: seed.defaults ?? null,
				settings: seed.settings ?? null,
				callsPerTurn: seed.callsPerTurn ?? null,
				castFloor: seed.castFloor ?? null
			}
			const differs = (Object.keys(shipped) as Array<keyof typeof shipped>).some(
				(k) => JSON.stringify((row as Record<string, unknown>)[k] ?? null) !== JSON.stringify(shipped[k] ?? null)
			)
			if (differs)
				await db.update(schema.sessionPresets).set(shipped).where(eq(schema.sessionPresets.id, row.id))
			const scope = { kind: "preset" as const, presetId: row.id }
			const rows = rowsOfPresetChanges(seed.registrations ?? {}, scope, "preset")
			const changed = await replaceRows(db, scope, rows, ["preset"])
			report.presets.push({ presetId: row.id, seedKey: seed.seedKey, rows: rows.length, changed })
		}
		// One default per genre (R22): the seed's mark lands where the genre has none.
		if (seed.isDefault && !row.isDefault) {
			const [other] = await db
				.select({ id: schema.sessionPresets.id })
				.from(schema.sessionPresets)
				.where(and(eq(schema.sessionPresets.genreId, row.genreId), eq(schema.sessionPresets.isDefault, true)))
				.limit(1)
			if (!other) {
				await db.update(schema.sessionPresets).set({ isDefault: true }).where(eq(schema.sessionPresets.id, row.id))
				report.defaultsMarked.push(seed.seedKey)
			}
		}
	}

	// ── a package's shipped presets ───────────────────────────────────────
	await projectPluginPresets(db, defaultsByGenre, report)
	return report
}

/**
 * ⏳ Re-project one genre's defaults when a spec locked to it (the old inlet
 * lock) is published at run time — a package's spec, a test's fixture — so a
 * genre whose defaults are derived from locks answers as its locks do now,
 * not as they did at boot; a genre that declares its defaults gains only a
 * lock-era companion action its declaration does not name (`companionActions`).
 * Safe inside a transaction: it reads and writes through `db` only.
 */
export async function projectLockedGenre(db: Db, genreId: string): Promise<void> {
	if (!genreId || genreId.includes("@")) return
	await ensureCoreGenres()
	const { registrations } = await genreDefaultsFor(genreId, await lockedSpecRows(db))
	const scope = { kind: "genre" as const, genreId }
	await replaceRows(
		db,
		scope,
		registrations.map((d) => rowOfDecl(d, scope, "genre")),
		["genre"]
	)
}

/** A package preset's declared changes, or ⏳ its bindings and include list read as changes. */
async function projectPluginPresets(
	db: Db,
	defaultsByGenre: ReadonlyMap<string, readonly RegistrationDecl[]>,
	report: RegistrationProjectionReport
): Promise<void> {
	const { notCoreRow } = await import("$lib/server/plugins/frameHost")
	const { presetSeedKey, pluginConfigSeedKey } = await import("$lib/server/pipelines/boot/registrySync")
	const { resolveRenamedCoreId } = await import("$lib/server/plugins/renamedCoreIds")
	const plugins = await db.select().from(schema.plugins).where(notCoreRow())
	for (const p of plugins as any[]) {
		if (!p.enabled) continue
		const presets = (p.manifest as any)?.presets
		if (!Array.isArray(presets)) continue
		for (const decl of presets) {
			if (!decl || typeof decl.slug !== "string" || typeof decl.genre !== "string") continue
			const seedKey = presetSeedKey(p.pluginId, decl.slug)
			try {
				const [row] = await db
					.select()
					.from(schema.sessionPresets)
					.where(eq(schema.sessionPresets.seedKey, seedKey))
					.limit(1)
				if (!row || row.ownerPluginId !== p.id || !row.isImmutable) continue
				const scope = { kind: "preset" as const, presetId: row.id }
				const origin = `package:${p.pluginId}`
				const rows = await packagePresetRows({
					decl,
					genreDefaults: defaultsByGenre.get(row.genreId) ?? [],
					scope,
					origin,
					resolveId: resolveRenamedCoreId,
					configValues: async (spec, slug) => {
						const [config] = await db
							.select({ id: schema.pipelineConfigs.id })
							.from(schema.pipelineConfigs)
							.where(eq(schema.pipelineConfigs.seedKey, pluginConfigSeedKey(p.pluginId, spec, slug)))
							.limit(1)
						if (!config) return null
						return await db
							.select()
							.from(schema.pipelineConfigValues)
							.where(eq(schema.pipelineConfigValues.configId, config.id))
					},
					unresolved: (key) => report.unresolvedConfigs.push(`${seedKey} ${key}`)
				})
				const changed = await replaceRows(db, scope, rows, [origin])
				report.presets.push({ presetId: row.id, seedKey, rows: rows.length, changed })
			} catch (err) {
				console.warn(`[registrations] could not project the preset '${seedKey}':`, err)
			}
		}
	}
}

/**
 * One package preset's rows. Its `registrations` when it states them (an SDK
 * with presets as changes); otherwise ⏳ derived from `bindings` and
 * `actions.include` over the genre's defaults (`presetChangesOf`), each
 * binding's configuration (a config slug of that spec, installed under the
 * package's seed key) becoming the values of that registration (R38).
 */
export async function packagePresetRows(
	o: {
		decl: Record<string, any>
		genreDefaults: readonly RegistrationDecl[]
		scope: { kind: "preset"; presetId: number }
		origin: string
		resolveId: (id: string) => string
		configValues: (
			spec: string,
			slug: string
		) => Promise<ReadonlyArray<{ nodeKey: string; slot: string; path?: string | null; value: unknown }> | null>
		unresolved: (key: string) => void
	}
): Promise<RegistrationInsert[]> {
	const stated = o.decl.registrations as PresetRegistrationChanges | undefined
	if (stated && typeof stated === "object") return rowsOfPresetChanges(stated, o.scope, o.origin)
	const bindings: Record<string, { spec: string; config?: string }> = {}
	for (const [event, b] of Object.entries((o.decl.bindings ?? {}) as Record<string, any>))
		if (b && typeof b.spec === "string")
			bindings[event] = { spec: o.resolveId(b.spec), ...(typeof b.config === "string" ? { config: b.config } : {}) }
	const include = Array.isArray(o.decl.actions?.include)
		? (o.decl.actions.include as unknown[]).map((k) => o.resolveId(String(k))).filter((k) => k.includes("#"))
		: null
	const changes = presetChangesOf(
		{ bindings: bindings as never, ...(include ? { actions: { include } as never } : {}) },
		o.genreDefaults
	)
	const rows = rowsOfPresetChanges(changes, o.scope, o.origin)
	for (const [key, slug] of Object.entries(changes.aliasConfigs ?? {})) {
		const spec =
			changes.register?.find((r) => r.key === key)?.pipeline ??
			o.genreDefaults.find((r) => r.key === key)?.pipeline
		if (!spec) continue
		const configRows = await o.configValues(spec, slug)
		if (!configRows) {
			o.unresolved(key)
			continue
		}
		const values = valuesOfConfigRows(configRows)
		if (!values) continue
		const at = rows.findIndex((r) => r.key === key)
		if (at >= 0) rows[at] = { ...rows[at]!, values }
		else rows.push(rowOfChange({ key, values }, o.scope, o.origin))
	}
	return rows
}
