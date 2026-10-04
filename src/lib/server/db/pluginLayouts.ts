/**
 * The plugin half of `session_layout_presets` — the reconciler that projects
 * a package's declared **session layout presets** into rows, beside
 * `syncPluginPresets` (`pipelines/boot/registrySync.ts`), whose shape this
 * deliberately mirrors statement for statement.
 *
 * ## What a manifest declares
 *
 * ```
 * layouts: [{ genreId, slug, name, description?, preset }]
 * ```
 *
 * `preset` is a **session layout** (`SessionLayoutV1`), the one format: the
 * row stores it verbatim in `layout`, so what a package declares is what a
 * session draws. It is checked here with the SDK's `validateSessionLayout`
 * — the same check `layout()` made where the package declared it — because a
 * manifest is stored verbatim at install and runtime is where its shape is
 * actually checked. A layout that fails, the retired layout document
 * (LayoutDoc v2) included, is refused and reported, never converted: a
 * package built against an older SDK is rebuilt.
 *
 * Here the check knows what a packager cannot — every widget this instance
 * offers (`knownWidgetDecls`) — so it also reports, as warnings, a layout
 * that draws otherwise than it is written: a widget nothing declares (it
 * draws a labelled placeholder) and one placed past its `maxInstances`. A
 * warned layout is projected all the same. The callers log the report
 * (`pluginLayoutReportLines`); the install command prints it.
 *
 * ## It writes only what changed
 *
 * A projection whose fields already match its row writes nothing, and
 * `layout_updated_at` moves only when `layout` itself does — so a session can
 * tell that the layout it started from was **Updated** since, rather than
 * every boot or every enable/disable saying so.
 *
 * ## It marks, it never deletes
 *
 * Disabling or uninstalling a plugin sets `withdrawn_at` on its layouts. A
 * session names its preset, so deleting the row would leave live sessions
 * pointing at nothing the moment an extension was switched off — and switching
 * one off is a reversible, everyday act. Re-enabling clears the mark and every
 * session that was on it is back where it was.
 *
 * ## `default` is the genre owner's slug
 *
 * A genre's `default` row is its **genre default layout**, and a plugin that
 * could claim it would silently replace the layout of a genre it does not own. Owner is
 * by GRAMMAR, the rule the rest of the app already enforces: a genre id's
 * namespace is its owner's (`acme.x:genre/heist`), and a package's namespace is
 * its manifest id with the one `/` flattened (`acme/x` → `acme.x`,
 * `engineNamespaceOf`). So a plugin may ship `default` for its own genres and
 * never for `core:` ones or a neighbour's — and any other slug for any genre it
 * names, which is the whole point of shipping a layout for somebody else's
 * genre.
 */
import {
	i18nText,
	validateSessionLayout,
	type I18n,
	type SessionLayoutV1,
	type WidgetDecl
} from "@serene-pub/sdk"
import { and, eq } from "drizzle-orm"
import * as schema from "./schema"
import { engineNamespaceOf } from "$lib/server/plugins/engineHost"
import {
	notCoreRow,
	pluginWidgetDecls
} from "$lib/server/plugins/frameHost"
import { DEFAULT_LAYOUT_SLUG, sameLayout } from "./layoutPresets"

/** One entry of a manifest's `layouts[]`, as this reconciler reads it. */
export interface DeclaredLayout {
	genreId: string
	/** The stable key within the plugin: `cinematic`, `tabletop`. */
	slug: string
	name: string
	description?: string
	/** As the manifest holds it: checked (`validateSessionLayout`) before any row is written. */
	preset: SessionLayoutV1
}

/** What a sync did, for the log line and the tests. */
export interface PluginLayoutSyncReport {
	/** Seed keys whose row now holds the declaration (inserted, re-forced, or already current). */
	projected: string[]
	/** Seed keys marked withdrawn this pass. */
	withdrawn: string[]
	/** Seed keys whose withdrawal this pass cleared. */
	restored: string[]
	/** Declarations that were refused, each with the reason. */
	refused: Array<{ key: string; pluginId: string; reason: string }>
	/**
	 * What a projected layout draws otherwise than it is written — the
	 * validator's warnings against every widget this instance knows. The
	 * layout is projected all the same.
	 */
	warnings: Array<{ key: string; pluginId: string; warning: string }>
}

/**
 * The report as log lines, one per refusal and per warning — what boot and the
 * enable switch `console.warn` and the install command prints. `pluginId`
 * narrows it to one package's layouts; empty when every declared layout
 * projected as written.
 */
export function pluginLayoutReportLines(
	report: Pick<PluginLayoutSyncReport, "refused" | "warnings">,
	pluginId?: string
): string[] {
	const mine = (e: { pluginId: string }) =>
		pluginId === undefined || e.pluginId === pluginId
	return [
		...report.refused
			.filter(mine)
			.map((r) => `layout ${r.key} refused: ${r.reason}`),
		...report.warnings
			.filter(mine)
			.map((w) => `layout ${w.key}: ${w.warning}`)
	]
}

/** A widget as the validator checks a layout's ids and caps against it. */
type KnownWidget = Pick<WidgetDecl, "id" | "maxInstances">

/**
 * Every widget this instance knows, under the id a layout names it by — the
 * declarers `sessions:view` seats: core's `CORE_WIDGETS`; each enabled
 * plugin's `widgets` and ⏳ panels, namespaced (`pluginWidgetDecls`, the one
 * definition `enabledPluginWidgetIds` reads too — a panel sharing a widget's id
 * is listed after it, as the view seats the panel) and its genres' ⏳
 * `shape.panels` (as declared); and every offered authored component.
 */
async function knownWidgetDecls(
	db: Db,
	enabled: ReadonlyArray<{ pluginId: string; manifest: unknown }>
): Promise<KnownWidget[]> {
	const { CORE_WIDGETS } = await import("@serene-pub/core-catalog")
	const out: KnownWidget[] = CORE_WIDGETS.map((w) => ({
		id: w.id,
		maxInstances: w.maxInstances
	}))
	for (const { pluginId, manifest } of enabled) {
		// The package's own widgets and panels: the one list the id
		// allow-lists read too (`pluginWidgetDecls`).
		out.push(...pluginWidgetDecls(manifest, pluginId))
		const m = (manifest ?? {}) as { genres?: unknown }
		if (Array.isArray(m.genres))
			for (const g of m.genres as Array<{ shape?: { panels?: unknown } } | null>) {
				const panels = g?.shape?.panels
				if (Array.isArray(panels))
					for (const p of panels as Array<{ id?: unknown } | null>)
						if (p && typeof p.id === "string") out.push({ id: p.id })
			}
	}
	const { offeredAuthoredWidgetIds } = await import(
		"$lib/server/components/offer"
	)
	for (const id of await offeredAuthoredWidgetIds(db)) out.push({ id })
	return out
}

/** The reseed-stable natural key of a plugin's layout. */
export const pluginLayoutSeedKey = (
	genreId: string,
	pluginId: string,
	slug: string
): string => `layout:${genreId}:${pluginId}/${slug}`

/** Read `layouts` off a stored manifest, tolerant of its json being anything. */
export function declaredLayoutsOf(manifest: unknown): DeclaredLayout[] {
	const raw =
		manifest && typeof manifest === "object"
			? (manifest as Record<string, unknown>).layouts
			: undefined
	if (!Array.isArray(raw)) return []
	const out: DeclaredLayout[] = []
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue
		const d = entry as Record<string, unknown>
		// A declaration missing any of these cannot make a row: the genre is
		// NOT NULL, the slug is half the identity and the name is what a person
		// picks it by. Skipped rather than defaulted — inventing one would
		// produce a layout nobody declared under a key nothing can update.
		if (
			typeof d.genreId !== "string" ||
			!d.genreId ||
			typeof d.slug !== "string" ||
			!d.slug ||
			!i18nText(d.name as I18n) ||
			!d.preset ||
			typeof d.preset !== "object"
		)
			continue
		out.push({
			genreId: d.genreId,
			slug: d.slug,
			// Display text is a string or a locale map (R-20); the row keeps English.
			name: i18nText(d.name as I18n)!,
			description: i18nText(d.description as I18n | undefined),
			preset: d.preset as SessionLayoutV1
		})
	}
	return out
}

/** Does this package own this genre? Ownership by grammar — see the header. */
export function pluginOwnsGenre(pluginId: string, genreId: string): boolean {
	const colon = genreId.indexOf(":")
	if (colon <= 0) return false
	return genreId.slice(0, colon) === engineNamespaceOf(pluginId)
}

/**
 * Project every enabled plugin's declared layouts into rows, withdraw the rows
 * of layouts no enabled plugin declares any more, and restore the ones that
 * came back. Idempotent: safe to run at boot and on every enable/disable.
 *
 * Takes `db` explicitly, as the plugin reconcilers beside it do — the caller is
 * sometimes a socket handler holding the app's database and sometimes a test
 * holding its own, and a module-level default would escape the second.
 */
export async function syncPluginLayouts(
	db: Db
): Promise<PluginLayoutSyncReport> {
	const report: PluginLayoutSyncReport = {
		projected: [],
		withdrawn: [],
		restored: [],
		refused: [],
		warnings: []
	}

	// A row stored as `core` would own core's genres by grammar: it declares nothing.
	const plugins = await db.select().from(schema.plugins).where(notCoreRow())
	const widgets = await knownWidgetDecls(
		db,
		plugins.filter((p) => p.enabled)
	)
	const declared = new Map<
		string,
		{ pluginId: string; version: string; decl: DeclaredLayout }
	>()
	for (const p of plugins as Array<Record<string, any>>) {
		if (!p.enabled) continue
		for (const decl of declaredLayoutsOf(p.manifest)) {
			const key = pluginLayoutSeedKey(decl.genreId, p.pluginId, decl.slug)
			// The reserved slug, refused for a genre this package does not own.
			if (
				decl.slug === DEFAULT_LAYOUT_SLUG &&
				!pluginOwnsGenre(p.pluginId, decl.genreId)
			) {
				report.refused.push({
					key,
					pluginId: p.pluginId,
					reason: `'${DEFAULT_LAYOUT_SLUG}' is the genre owner's slug, and '${p.pluginId}' does not own '${decl.genreId}' — ship it under a slug of its own.`
				})
				continue
			}
			declared.set(key, {
				pluginId: p.pluginId,
				version: typeof p.version === "string" ? p.version : "0.0.0",
				decl
			})
		}
	}

	const rows = await db
		.select()
		.from(schema.sessionLayoutPresets)
		.where(eq(schema.sessionLayoutPresets.origin, "plugin"))
	const bySeedKey = new Map(
		(rows as Array<Record<string, any>>)
			.filter((r) => r.seedKey)
			.map((r) => [r.seedKey as string, r])
	)

	for (const [seedKey, { pluginId, version, decl }] of declared) {
		// A refused layout is REPORTED and never written. An unknown widget id
		// is not an error — it draws a labelled placeholder, which is what
		// keeps a layout readable when the widget it names arrives later — so
		// only errors refuse, and it is reported as a warning.
		const verdict = validateSessionLayout(decl.preset, {
			widgets,
			unknownWidgets: "warn"
		})
		if (!verdict.ok) {
			report.refused.push({
				key: seedKey,
				pluginId,
				reason: verdict.errors.join(" ")
			})
			continue
		}
		const warned = verdict.warnings.map((warning) => ({
			key: seedKey,
			pluginId,
			warning
		}))

		const projected = {
			genreId: decl.genreId,
			origin: "plugin" as const,
			pluginId,
			authorUserId: null,
			slug: decl.slug,
			name: decl.name,
			description: decl.description ?? null,
			visibility: "shared" as const,
			// The session layout, verbatim: what a session starting from this
			// row draws.
			layout: decl.preset as Record<string, unknown>,
			seededByVersion: version
		}

		const existing = bySeedKey.get(seedKey)
		if (!existing) {
			await db.insert(schema.sessionLayoutPresets).values({
				// NO id — the sequence assigns one (seed rule). `layout_updated_at`
				// takes its default: the layout is new.
				seedKey,
				withdrawnAt: null,
				...projected
			})
			report.projected.push(seedKey)
			report.warnings.push(...warned)
			continue
		}
		// A row under this key that another package owns is not this sync's to
		// write. It can only happen if two manifests claimed one id, and taking
		// it over would silently replace somebody else's layout.
		if (existing.pluginId !== pluginId) continue

		report.projected.push(seedKey)
		report.warnings.push(...warned)
		if (existing.withdrawnAt) report.restored.push(seedKey)
		const layoutMoved = !sameLayout(existing.layout, projected.layout)
		const current =
			!existing.withdrawnAt &&
			!layoutMoved &&
			(Object.keys(projected) as Array<keyof typeof projected>).every(
				(k) => k === "layout" || existing[k] === projected[k]
			)
		// Already what the manifest says: nothing to write, and nothing moves.
		if (current) continue
		await db
			.update(schema.sessionLayoutPresets)
			.set({
				...projected,
				withdrawnAt: null,
				...(layoutMoved ? { layoutUpdatedAt: new Date() } : {})
			})
			.where(
				and(
					eq(schema.sessionLayoutPresets.id, existing.id),
					eq(schema.sessionLayoutPresets.origin, "plugin")
				)
			)
	}

	for (const row of rows as Array<Record<string, any>>) {
		if (!row.seedKey || row.withdrawnAt) continue
		if (declared.has(row.seedKey)) continue
		await db
			.update(schema.sessionLayoutPresets)
			.set({ withdrawnAt: new Date() })
			.where(eq(schema.sessionLayoutPresets.id, row.id))
		report.withdrawn.push(row.seedKey)
	}

	return report
}
