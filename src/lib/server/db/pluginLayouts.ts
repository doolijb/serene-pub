/**
 * The plugin half of `session_layout_presets` (session layout v2 §4.1) — the
 * reconciler that projects a package's declared **layout presets** into rows,
 * beside `syncPluginPresets` (`pipelines/boot/registrySync.ts`), whose shape
 * this deliberately mirrors statement for statement.
 *
 * ## What a manifest declares
 *
 * ```
 * layouts: [{ genreId, slug, name, description?, preset }]
 * ```
 *
 * `preset` is the SDK's `LayoutPreset` — the **layout document** plus the
 * per-instance settings and style pins that came with it. ⏳ The SDK's
 * `announce` side of this (the builder that puts `layouts[]` into a packaged
 * manifest, and the CLI validation of it) is P7's; this reads the field
 * defensively either way, because a manifest is stored verbatim at install and
 * runtime is where its shape is actually checked.
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
 * A genre's own layout is the last tier before the built-in floor, and a plugin
 * that could claim it would silently re-floor a genre it does not own. Owner is
 * by GRAMMAR, the rule the rest of the app already enforces: a genre id's
 * namespace is its owner's (`acme.x:genre/heist`), and a package's namespace is
 * its manifest id with the one `/` flattened (`acme/x` → `acme.x`,
 * `engineNamespaceOf`). So a plugin may ship `default` for its own genres and
 * never for `core:` ones or a neighbour's — and any other slug for any genre it
 * names, which is the whole point of shipping a layout for somebody else's
 * genre.
 */
import { i18nText, type I18n } from "@serene-pub/sdk"
import { and, eq } from "drizzle-orm"
import * as schema from "./schema"
import { engineNamespaceOf } from "$lib/server/plugins/engineHost"
import { DEFAULT_LAYOUT_SLUG } from "./layoutPresets"
import { validateLayoutDoc } from "@serene-pub/sdk"
import type { LayoutDecls, LayoutDoc, LayoutPreset } from "@serene-pub/sdk"

/** One entry of a manifest's `layouts[]`, as this reconciler reads it. */
export interface DeclaredLayout {
	genreId: string
	/** The stable key within the plugin: `cinematic`, `tabletop`. */
	slug: string
	name: string
	description?: string
	preset: LayoutPreset
}

/** What a sync did, for the log line and the tests. */
export interface PluginLayoutSyncReport {
	/** Seed keys written (inserted or re-forced). */
	projected: string[]
	/** Seed keys marked withdrawn this pass. */
	withdrawn: string[]
	/** Seed keys whose withdrawal this pass cleared. */
	restored: string[]
	/** Declarations that were refused, each with the reason. */
	refused: Array<{ key: string; reason: string }>
}

/** The reseed-stable natural key of a plugin's layout. */
export const pluginLayoutSeedKey = (
	genreId: string,
	pluginId: string,
	slug: string
): string => `layout:${genreId}:${pluginId}/${slug}`

/** The declaration sets `validateLayoutDoc` reads. Warnings only; see below. */
let declsPromise: Promise<LayoutDecls> | null = null
async function layoutDecls(): Promise<LayoutDecls> {
	declsPromise ??= import("@serene-pub/core-catalog").then((m) => ({
		widgets: m.CORE_WIDGETS,
		looks: m.CORE_LOOKS
	}))
	return declsPromise
}

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
			preset: d.preset as LayoutPreset
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
		refused: []
	}

	const plugins = await db.select().from(schema.plugins)
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
		// A refused document is REPORTED and never written. An unknown widget
		// id or an undeclared look key is a WARNING, not an error, and is
		// deliberately let through: it draws a labelled placeholder, which is
		// what keeps a layout readable when the widget it names arrives later.
		const verdict = validateLayoutDoc(decl.preset.layout, await layoutDecls())
		if (!verdict.ok) {
			report.refused.push({
				key: seedKey,
				reason: verdict.errors.join(" ")
			})
			console.warn(
				`[layouts] plugin layout ${seedKey} was refused: ${verdict.errors.join(" ")}`
			)
			continue
		}

		const projected = {
			genreId: decl.genreId,
			origin: "plugin" as const,
			pluginId,
			authorUserId: null,
			slug: decl.slug,
			name: decl.name,
			description: decl.description ?? null,
			visibility: "shared" as const,
			// ⏳ The legacy blob a plugin never had. `{}` is "no overrides",
			// which is what the pre-v2 client renders as its own arrangement —
			// so applying a plugin's layout there is inert rather than broken.
			layout: {},
			document: decl.preset.layout as LayoutDoc,
			widgetSettings: decl.preset.widgetSettings ?? null,
			widgetStyles: decl.preset.widgetStyles ?? null,
			seededByVersion: version
		}

		const existing = bySeedKey.get(seedKey)
		if (!existing) {
			await db.insert(schema.sessionLayoutPresets).values({
				// NO id — the sequence assigns one (seed rule).
				seedKey,
				withdrawnAt: null,
				...projected
			})
			report.projected.push(seedKey)
			continue
		}
		// A row under this key that another package owns is not this sync's to
		// write. It can only happen if two manifests claimed one id, and taking
		// it over would silently replace somebody else's layout.
		if (existing.pluginId !== pluginId) continue

		if (existing.withdrawnAt) report.restored.push(seedKey)
		await db
			.update(schema.sessionLayoutPresets)
			.set({ ...projected, withdrawnAt: null })
			.where(
				and(
					eq(schema.sessionLayoutPresets.id, existing.id),
					eq(schema.sessionLayoutPresets.origin, "plugin")
				)
			)
		report.projected.push(seedKey)
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
