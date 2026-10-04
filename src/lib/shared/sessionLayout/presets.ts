/**
 * Session layout presets — the pure half (PLAN 25 redesign, 2026-08-30; the
 * copy model of `PLAN-layout-one-format-2026-09-28`, brief 3).
 *
 * A **session layout preset** (NOMENCLATURE §9) is a named, copyable session
 * layout scoped to a genre, a row of `session_layout_presets`. A session never
 * references one to draw: its person's `session_panel_layouts` row holds a
 * COPY, and keeps only which preset it **started from** and when, as a label.
 * There is no precedence rule any more — nothing is layered over a session's
 * layout at read time.
 *
 * What is left here is what the server and the client must agree on without a
 * database: the seed keys core's shipped rows are matched by, and which genres
 * core seeds at all.
 */

/** The name core's empty genre default layout carries (a genre that declares none). */
export const DEFAULT_PRESET_NAME = "Default"

/** Is this a core genre (`core:…`)? Core seeds its layouts; a plugin genre's are its owner's. */
export function isCoreGenre(genreId: string): boolean {
	return genreId.startsWith("core:")
}

/**
 * The reseed-stable natural key of a core genre's **genre default layout**.
 *
 * The reconciler upserts and prunes by THIS, never by a numeric id (the
 * codified seed rule — a past bug that matched on id overwrote a user's own
 * row on upgrade). User-authored presets carry `seedKey: null`, so they are
 * structurally invisible to every statement the reconciler issues.
 */
export function layoutPresetSeedKey(genreId: string): string {
	return `layout:${genreId}:default`
}

/**
 * The seed key of any layout a core genre declares: its `default` keeps
 * {@link layoutPresetSeedKey}; another is `layout:<genreId>:core/<slug>`. That
 * cannot collide with a plugin's (`layout:<genreId>:<pluginId>/<slug>`,
 * `pluginLayoutSeedKey`), because no plugin row may be `core`
 * (`notCoreRow`).
 */
export function coreLayoutSeedKey(genreId: string, slug: string): string {
	return slug === "default"
		? layoutPresetSeedKey(genreId)
		: `layout:${genreId}:core/${slug}`
}
