/**
 * Widget declaration + style types (PLAN 25 data model, ruled 2026-08-30).
 *
 * A "widget" is a session-surface component — the messages log, the composer,
 * a portrait panel, a plugin frame. Native and frame widgets share ONE
 * declaration and ONE data contract; the only difference is the iframe (and its
 * serialization boundary). This module is the authoring surface: what a widget
 * announces about itself, and the shape of the styles it ships.
 *
 * `WidgetDecl` is the superset of the SDK's `PanelDecl` — `id` and `title`
 * already satisfy the "stable slug + display title" a widget must announce, so
 * this only adds the new authoring metadata: cell bounds, the data scopes it
 * wants, external plugin dependencies, and the built-in style presets it ships.
 */
import type { PanelDecl } from "@serene-pub/sdk"

/** Data a widget requests access to (grant-gated, host-enforced at projection). */
export type WidgetScope =
	| "persona"
	| "characters"
	| "lore"
	| "session:full"
	| `channel:${string}`

/** An external plugin dependency; the CLI captures pkg/range from the imports. */
export interface WidgetDependency {
	/** The depended-on plugin's stable manifest id. */
	pluginId: string
	/** The npm package the direct API reference resolved to (CLI-filled). */
	pkg?: string
	/** Semver range the author built against (CLI-filled). */
	range?: string
}

/**
 * A built-in style a widget ships. Seeded as a `source: "system"` row keyed by
 * `systemStyleSlug(widgetId, slug)`; users never edit these in place — they
 * clone one into a private style. `css` is the scoped skin injected into the
 * widget container (native) or frame document (frame); `vars` overrides design
 * tokens (CSS custom properties).
 */
export interface WidgetStylePreset {
	/** Stable per-widget key — the seed identity within this widget's styles. */
	slug: string
	title: string
	css: string
	vars?: Record<string, string>
}

/**
 * A widget declaration. Core widgets declare it in code; plugin widgets declare
 * the identical shape and the CLI captures `dependencies` from the import graph.
 * Runtime never branches on which — it reads the decl.
 */
export interface WidgetDecl extends PanelDecl {
	/**
	 * Optional cell-based size bounds (the widgetGrid cell module), in cells.
	 * These sit alongside `layout.span` (track-based) — cells are the physical
	 * floor/ceiling, span is the responsive preference.
	 */
	cells?: { minW?: number; maxW?: number; minH?: number; maxH?: number }
	/** Data the widget requests; each entry is a grant an admin can deny. */
	scopes?: WidgetScope[]
	/** External plugin dependencies (CLI-captured into the manifest). */
	dependencies?: WidgetDependency[]
	/** Built-in styles this widget ships; seeded as system rows. */
	presets?: WidgetStylePreset[]
}

/**
 * How a saved layout pins a widget's chosen style: an id AND a slug. Resolution
 * tries the id first, then the slug; when NEITHER reconciles (deleted, or no
 * longer visible to this user), the host quietly falls back to the widget's
 * default style. Storing both is deliberate — the id is the fast path, the slug
 * survives a reseed that renumbers the row. (Ruled 2026-08-30.)
 */
export interface WidgetStyleRef {
	id: number
	slug: string
}

/**
 * The globally-unique, reseed-stable slug for a widget's built-in style. This
 * is both the system row's `slug` (the layout's reference target) and its seed
 * identity — the reconciler upserts and prunes system rows by matching on it,
 * NEVER on a numeric id (the codified seed rule; see defaults.ts).
 *
 * Widget ids and preset slugs are simple kebab tokens (no `:`), so the join is
 * unambiguous.
 */
export function systemStyleSlug(widgetId: string, presetSlug: string): string {
	return `${widgetId}:${presetSlug}`
}
