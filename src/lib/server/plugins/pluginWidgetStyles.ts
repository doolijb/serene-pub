/**
 * A plugin's widget styles: the `presets` its widget declarations ship, seeded
 * as `source: 'system'` rows exactly as core's are (`db/widgetStyles.ts`).
 *
 * `WidgetDecl.presets` is documented as "seeded as system rows", and core's
 * boot only ever seeded `CORE_WIDGETS` — so a plugin could declare a style and
 * no one could pick it. This is the plugin half.
 *
 * **Owned by the plugin, through the widget id.** A plugin's widget is seated
 * under `<pluginId>:<widgetId>` (`pluginWidgetId`), and its style rows carry
 * that id as `widget_slug`, so the owner is read off the row with
 * `parsePluginWidgetId` — no column to keep in step. Core's boot sync spares
 * those rows for the same reason (`syncWidgetStyles`' `pruneUndeclared`), and
 * this sync is the one that removes them.
 *
 * **Every INSTALLED plugin, enabled or not.** Disabling a plugin hides its
 * widgets (and so the picker never offers their styles) but keeps the rows, so
 * a person's layout pinned to one comes back on a re-enable. An uninstall is
 * what removes them. A user row (`source = 'user'`) is never touched here.
 *
 * **Held to the rules a person's style is.** The CSS and the vars go through
 * the same check as a style typed into the editor (`assertSafeThemeCss`, the
 * same size caps): a preset that fails is refused by name and the rest of the
 * plugin's styles still seed.
 */
import { and, eq, inArray } from "drizzle-orm"
import { i18nText, parsePluginWidgetId, pluginWidgetId } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import type { WidgetDecl } from "$lib/shared/widgets/types"
import { AUTHORED_OWNER_LABEL } from "$lib/shared/widgets/authoredOwner"
import { notCoreRow } from "./frameHost"

const MAX_CSS_BYTES = 64 * 1024
const MAX_VARS_BYTES = 8 * 1024
const VAR_KEY_RE = /^--[a-z0-9-]+$/
const PRESET_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/

/** One plugin's widgets with the presets they ship, as the seed reads them. */
export interface PluginStyleDecls {
	pluginId: string
	version: string
	/** Every widget the plugin declares, namespaced — one with no presets prunes its rows. */
	decls: WidgetDecl[]
	/** Presets refused, one sentence each. */
	refused: string[]
}

/** Read one stored manifest's widget presets, tolerantly, under the namespaced ids. */
export async function pluginStyleDeclsOf(
	pluginId: string,
	version: string,
	manifest: unknown
): Promise<PluginStyleDecls> {
	const { assertSafeThemeCss } = await import("$lib/server/sockets/customThemes")
	const out: PluginStyleDecls = { pluginId, version, decls: [], refused: [] }
	const widgets = (manifest as { widgets?: unknown } | null)?.widgets
	if (!Array.isArray(widgets)) return out
	for (const w of widgets as Array<Record<string, any> | null>) {
		if (!w || typeof w.id !== "string") continue
		const id = pluginWidgetId(pluginId, w.id)
		const presets: NonNullable<WidgetDecl["presets"]> = []
		for (const p of Array.isArray(w.presets) ? w.presets : []) {
			const at = `widget '${w.id}' preset '${String(p?.slug)}'`
			try {
				if (typeof p?.slug !== "string" || !PRESET_SLUG_RE.test(p.slug))
					throw new Error("its slug is lowercase letters, digits and '-'")
				if (presets.some((q) => q.slug === p.slug))
					throw new Error("two presets of one widget share the slug")
				const css = p.css ?? ""
				if (typeof css !== "string") throw new Error("its CSS has to be text")
				if (css.length > MAX_CSS_BYTES) throw new Error("its CSS is over 64 KB")
				assertSafeThemeCss(css)
				const vars: Record<string, string> = {}
				for (const [k, v] of Object.entries(
					p.vars && typeof p.vars === "object" && !Array.isArray(p.vars) ? p.vars : {}
				)) {
					if (!VAR_KEY_RE.test(k) || typeof v !== "string")
						throw new Error(`'${k}' is not a CSS custom property with a text value`)
					assertSafeThemeCss(v)
					vars[k] = v
				}
				if (JSON.stringify(vars).length > MAX_VARS_BYTES)
					throw new Error("its variables are over 8 KB")
				presets.push({
					slug: p.slug,
					title: i18nText(p.title) ?? p.slug,
					css,
					vars
				})
			} catch (e) {
				out.refused.push(`${at}: ${e instanceof Error ? e.message : String(e)}`)
			}
		}
		out.decls.push({ id, title: i18nText(w.title) ?? w.id, presets } as WidgetDecl)
	}
	return out
}

/**
 * Reconcile every installed plugin's shipped widget styles with the table:
 * seed and refresh what each declares, prune what it stopped declaring, and
 * remove the rows of a plugin that is not installed. Idempotent; run on
 * boot, install, enable, disable and uninstall. Returns refusal lines.
 */
export async function syncPluginWidgetStyles(db: Db): Promise<string[]> {
	const { syncWidgetStyles } = await import("$lib/server/db/widgetStyles")
	const rows = await db
		.select({
			pluginId: schema.plugins.pluginId,
			version: schema.plugins.version,
			manifest: schema.plugins.manifest
		})
		.from(schema.plugins)
		.where(notCoreRow())
	const lines: string[] = []
	const declared = new Set<string>()
	for (const r of rows) {
		const p = await pluginStyleDeclsOf(r.pluginId, r.version || "0.0.0", r.manifest)
		for (const line of p.refused) lines.push(`'${r.pluginId}' ${line}`)
		for (const d of p.decls) declared.add(d.id)
		// Scoped to this plugin's widget ids: a widget whose presets went
		// loses the rows, and nobody else's rows are in reach.
		if (p.decls.length) await syncWidgetStyles(p.decls, p.version, {}, db)
	}
	// What no installed plugin declares: a widget dropped from a
	// manifest, or a plugin uninstalled. Only plugin-owned ids (an authored
	// component's id parses too, and is not a plugin's), and only system rows.
	const seeded = await db
		.selectDistinct({ widgetSlug: schema.widgetStyles.widgetSlug })
		.from(schema.widgetStyles)
		.where(eq(schema.widgetStyles.source, "system"))
	const orphans = seeded
		.map((r) => r.widgetSlug)
		.filter((id) => {
			const parsed = parsePluginWidgetId(id)
			return (
				!!parsed &&
				parsed.pluginId !== AUTHORED_OWNER_LABEL &&
				!parsed.pluginId.startsWith(`${AUTHORED_OWNER_LABEL}.`) &&
				!declared.has(id)
			)
		})
	if (orphans.length)
		await db
			.delete(schema.widgetStyles)
			.where(
				and(
					eq(schema.widgetStyles.source, "system"),
					inArray(schema.widgetStyles.widgetSlug, orphans)
				)
			)
	return lines
}
