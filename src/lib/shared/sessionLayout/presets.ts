/**
 * Saved session-layout presets — the pure half (PLAN 25 redesign, 2026-08-30).
 *
 * A *preset* is a reusable layout DEFINITION scoped to a genre, living in
 * `session_layout_presets`. Which one a user is on, plus their own per-widget
 * settings, ride their `session_panel_layouts` row (`layoutPresetId` /
 * `layoutSettings`). This module owns the two rules both halves must agree on:
 * the seed key a shipped default is matched by, and how a preset composes with
 * the user's own layout blob.
 *
 * ## The precedence rule, and why it is this way round
 *
 * A session's effective layout is three layers, lowest first:
 *
 *   1. the active preset's `layout`  — the shared definition
 *   2. the user's `layoutSettings`   — their per-widget config, over the preset
 *   3. the user's `layout` blob      — their own live arrangement
 *
 * Layer 3 is LAST and is applied by the surface manager, not here: the manager
 * keeps the user's blob in its own (serialised) slots and this base in a slot
 * it never serialises, reading `userSlot ?? baseSlot`. That ordering is the
 * whole compatibility guarantee — a session that already has an arrangement in
 * `layout` has its slots set, so the `??` short-circuits and the preset is
 * never consulted. Nothing about what such a session renders can change.
 *
 * The second half of that guarantee is `presetBase` returning `undefined` for
 * an empty preset. The shipped per-genre default carries `layout: {}` — "no
 * overrides", i.e. the app's own built-in arrangement — so for every user who
 * has never picked a preset, every effective slot resolves to
 * `undefined ?? undefined` and the manager's state is bit-for-bit what it is
 * today. The preset system is inert until someone opts into it.
 */

/** The name every shipped per-genre default preset carries. */
export const DEFAULT_PRESET_NAME = "Default"

/**
 * The reseed-stable natural key of a genre's shipped default preset.
 *
 * The reconciler upserts and prunes by THIS, never by a numeric id (the
 * codified seed rule — a past bug that matched on id overwrote a user's own
 * row on upgrade). User-authored presets carry `seedKey: null`, so they are
 * structurally invisible to every statement the reconciler issues.
 */
export function layoutPresetSeedKey(genreId: string): string {
	return `layout:${genreId}:default`
}

/** Is this a plain (non-array, non-null) object? */
function isPlainObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v)
}

/**
 * Compose the read-only base a session's layout sits on: the active preset's
 * layout, with the user's own `layoutSettings` merged over it.
 *
 * Returns `undefined` when the result carries nothing — the signal the manager
 * needs to leave every slot exactly as it was before presets existed. Both
 * arguments are untrusted blobs (json columns, forward-compatible by design),
 * so anything that isn't a plain object is treated as absent rather than
 * throwing.
 */
export function presetBase(
	presetLayout: unknown,
	layoutSettings?: unknown
): Record<string, unknown> | undefined {
	const base = isPlainObject(presetLayout) ? presetLayout : {}
	const over = isPlainObject(layoutSettings) ? layoutSettings : {}
	const merged = { ...base, ...over }
	return Object.keys(merged).length ? merged : undefined
}

/**
 * The per-widget settings a session's widgets read: the ones the active preset
 * pins, with this user's own stored values over the top.
 *
 * Merged per WIDGET and per FIELD, not wholesale: a preset that pins two fields
 * of a widget keeps the one the user has not touched. `presetLayout` is the
 * composed base (`presetBase`), so a `widgetSettings` key on either half of it
 * lands here; both arguments are untrusted blobs, so anything that is not a
 * plain object is read as absent rather than throwing.
 *
 * ⚠ A stored value equal to the widget's DECLARED default is pruned before it
 * reaches storage, so it cannot currently override a preset that pins the same
 * field to something else. Setting such a field back means changing the preset.
 */
export function presetWidgetSettings(
	presetLayout: unknown,
	userValues: unknown
): Record<string, Record<string, unknown>> {
	const pinned =
		isPlainObject(presetLayout) &&
		isPlainObject(presetLayout.widgetSettings)
			? presetLayout.widgetSettings
			: {}
	const own = isPlainObject(userValues) ? userValues : {}
	const out: Record<string, Record<string, unknown>> = {}
	for (const [widgetId, values] of Object.entries(pinned))
		if (isPlainObject(values)) out[widgetId] = { ...values }
	for (const [widgetId, values] of Object.entries(own))
		if (isPlainObject(values))
			out[widgetId] = { ...(out[widgetId] ?? {}), ...values }
	return out
}
