/**
 * Resolving a saved layout's style pin to a concrete style row (PLAN 25, ruled
 * 2026-08-30). Pure — no DB, no reactivity — so the client can resolve against
 * whatever set of styles is visible/usable to the current user, and the server
 * can resolve the same way in a test.
 *
 * A layout pins a widget's style with an id+slug `WidgetStyleRef`. Resolution:
 *   1. id AND slug both match  — the confident case.
 *   2. id alone               — the row was renamed (slug drifted); still the pin.
 *   3. slug alone             — a reseed renumbered the row; same style, new id.
 *   4. neither reconciles     — quietly fall back to the widget's default style.
 *
 * The candidate set is the caller's responsibility: pass only rows this user may
 * USE (system + own private + shared). A pin to a now-private or deleted style
 * therefore falls through to the default, which is exactly the intended quiet
 * degrade — never an error, never someone else's private skin.
 */
import { systemStyleSlug, type WidgetStyleRef } from "./types"

/** The minimum a row needs to be resolvable. Real rows carry more (css, vars…). */
export interface ResolvableStyle {
	id: number
	slug: string
	widgetSlug: string
}

/**
 * The widget's default style: the seeded `<widgetId>:default` system row, or —
 * if that specific slug isn't present — the first candidate for the widget, or
 * `undefined` when the widget has no usable style at all (render bare).
 */
export function defaultStyleFor<T extends ResolvableStyle>(
	widgetId: string,
	candidates: T[]
): T | undefined {
	const defaultSlug = systemStyleSlug(widgetId, "default")
	return (
		candidates.find((c) => c.slug === defaultSlug) ??
		candidates.find((c) => c.widgetSlug === widgetId)
	)
}

/**
 * Resolve a style pin to a concrete row, degrading to the widget's default when
 * neither the id nor the slug reconciles. `ref` may be absent (a widget with no
 * pin yet) — that also yields the default.
 */
export function resolveStyle<T extends ResolvableStyle>(
	widgetId: string,
	ref: WidgetStyleRef | null | undefined,
	candidates: T[]
): T | undefined {
	// A pin only ever resolves WITHIN its own widget's styles — a row for a
	// different widget that happens to share an id/slug is not a candidate.
	const mine = candidates.filter((c) => c.widgetSlug === widgetId)
	if (ref) {
		const exact = mine.find((c) => c.id === ref.id && c.slug === ref.slug)
		if (exact) return exact
		const byId = mine.find((c) => c.id === ref.id)
		if (byId) return byId
		const bySlug = mine.find((c) => c.slug === ref.slug)
		if (bySlug) return bySlug
	}
	return defaultStyleFor(widgetId, mine)
}
