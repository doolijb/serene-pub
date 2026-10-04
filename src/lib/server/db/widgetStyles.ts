/**
 * The widget-style seed reconciler (PLAN 25, ruled 2026-08-30).
 *
 * Seeds each widget's shipped presets as `source: "system"` rows and prunes any
 * system row for those widgets whose preset is no longer shipped — the "seed the
 * defaults, remove defaults no longer in the list" pass. Runs on boot for core
 * widgets (from `CORE_WIDGETS`), and for every installed plugin's widgets on
 * boot, install, enable, disable and uninstall (`plugins/pluginWidgetStyles`).
 *
 * ## The upgrade-safety landmine (why this looks the way it does)
 *
 * The codified seed rule (see defaults.ts) is: match on a natural key, NEVER on
 * a numeric id, and never let a seed touch a user row. Both invariants are
 * enforced here structurally:
 *
 *   • Upsert and prune both match on `slug` (the reseed-stable
 *     `systemStyleSlug`), and every write is scoped `source = 'system'`. A user
 *     row (`source = 'user'`) is invisible to this function even if it somehow
 *     shared a slug — it can never be overwritten or pruned by a reseed.
 *   • Rows are inserted with NO explicit id — the identity sequence assigns one —
 *     so there is no id collision with user rows and no `resyncIdSequences` need.
 *
 * ## Prune scope
 *
 * The prune is confined to the widget ids actually being synced. Core boot syncs
 * only `CORE_WIDGETS`, so it prunes only core widgets' stale presets and leaves
 * a plugin's system rows alone (that plugin prunes its own on its next sync).
 *
 * A caller syncing the COMPLETE set — core boot is the one that can say that —
 * passes `pruneUndeclared`, and then a widget id absent from the decls has its
 * system rows removed too — except a plugin's (`<pluginId>:<widgetId>`, read
 * with `parsePluginWidgetId`): those are the plugin sync's to keep or remove,
 * and core's boot runs before the plugins are read at all. It is opt-in because the claim is the caller's: a
 * plugin syncing its own three widgets would otherwise sweep away every other
 * widget's rows, which is the same footgun the scoping above exists to prevent.
 * A user row is out of scope either way.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm"
import { parsePluginWidgetId } from "@serene-pub/sdk"
import { db as defaultDb } from "."
import * as schema from "./schema"
import { systemStyleSlug, type WidgetDecl } from "$lib/shared/widgets/types"

/** One shipped preset flattened to the system row it seeds. */
interface ShippedStyle {
	slug: string
	widgetSlug: string
	title: string
	css: string
	vars: Record<string, string>
}

/** Flatten a decl set to the system rows its presets should produce. */
function shippedStylesFrom(decls: WidgetDecl[]): ShippedStyle[] {
	const out: ShippedStyle[] = []
	for (const decl of decls) {
		for (const preset of decl.presets ?? []) {
			out.push({
				slug: systemStyleSlug(decl.id, preset.slug),
				widgetSlug: decl.id,
				title: preset.title,
				css: preset.css,
				vars: preset.vars ?? {}
			})
		}
	}
	return out
}

/** How much of the table a sync speaks for (see "Prune scope" above). */
export interface SyncWidgetStylesOptions {
	/**
	 * These decls are the COMPLETE set of widgets with system styles, so system
	 * rows for any other widget id are orphans and go. Only a caller that owns
	 * every declaration may say this; core boot does.
	 */
	pruneUndeclared?: boolean
}

/**
 * Reconcile the given widgets' shipped presets against the `widget_styles`
 * table. Idempotent: safe to run every boot. `version` is stamped as provenance
 * on each system row (`seeded_by_version`).
 */
export async function syncWidgetStyles(
	decls: WidgetDecl[],
	version: string,
	options: SyncWidgetStylesOptions = {},
	db: Db = defaultDb
): Promise<void> {
	const shipped = shippedStylesFrom(decls)
	const widgetIds = decls.map((d) => d.id)
	const shippedSlugs = shipped.map((s) => s.slug)

	// Existing system rows only — user rows are never in scope.
	const existing = await db.query.widgetStyles.findMany({
		where: eq(schema.widgetStyles.source, "system")
	})
	const existingBySlug = new Map(existing.map((r) => [r.slug, r]))

	const writes: Promise<unknown>[] = []
	for (const s of shipped) {
		const found = existingBySlug.get(s.slug)
		if (!found) {
			writes.push(
				db.insert(schema.widgetStyles).values({
					// NO id — the sequence assigns one (seed rule).
					slug: s.slug,
					widgetSlug: s.widgetSlug,
					source: "system",
					ownerUserId: null,
					visibility: "system",
					title: s.title,
					css: s.css,
					vars: s.vars,
					seededByVersion: version
				})
			)
		} else {
			// Re-force the shipped fields; never the id, never the source.
			writes.push(
				db
					.update(schema.widgetStyles)
					.set({
						widgetSlug: s.widgetSlug,
						visibility: "system",
						title: s.title,
						css: s.css,
						vars: s.vars,
						seededByVersion: version
					})
					.where(
						and(
							eq(schema.widgetStyles.slug, s.slug),
							eq(schema.widgetStyles.source, "system")
						)
					)
			)
		}
	}
	await Promise.all(writes)

	// Prune: system rows for the synced widgets whose preset is gone. Scoped to
	// `source = 'system'` AND to the widget ids we actually processed, so a
	// plugin's system rows (and every user row) are untouched. `notInArray` with
	// an empty list is a no-op guard — a widget that ships zero presets still has
	// its widget id in scope, so its stale system rows are correctly removed.
	if (widgetIds.length) {
		await db
			.delete(schema.widgetStyles)
			.where(
				and(
					eq(schema.widgetStyles.source, "system"),
					inArray(schema.widgetStyles.widgetSlug, widgetIds),
					shippedSlugs.length
						? notInArray(schema.widgetStyles.slug, shippedSlugs)
						: undefined
				)
			)
	}

	// The wider prune, for the caller that speaks for the whole table: system
	// rows belonging to a widget id nobody declares any more. A widget that is
	// gone takes its shipped skins with it — the pass above can only reach ids
	// that are still in the decls, so without this a retired widget's rows sit
	// in the picker for good. Still `source = 'system'`: a user's own style for
	// that widget is theirs, and an uninstall is what removes it.
	//
	// An EMPTY decl set is declined rather than read as "nothing is declared":
	// the query would then carry no widget predicate at all and take every
	// system row in the table with it, which is a truncate wearing a sync's
	// name. A caller with nothing to declare has nothing to reconcile.
	if (options.pruneUndeclared && widgetIds.length) {
		const seeded = await db
			.selectDistinct({ widgetSlug: schema.widgetStyles.widgetSlug })
			.from(schema.widgetStyles)
			.where(eq(schema.widgetStyles.source, "system"))
		const declared = new Set(widgetIds)
		const orphans = seeded
			.map((r) => r.widgetSlug)
			.filter((id) => !declared.has(id) && !parsePluginWidgetId(id))
		if (orphans.length)
			await db
				.delete(schema.widgetStyles)
				.where(
					and(
						eq(schema.widgetStyles.source, "system"),
						inArray(schema.widgetStyles.widgetSlug, orphans)
					)
				)
	}
}
