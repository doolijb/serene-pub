/**
 * App-side widget types (PLAN 25).
 *
 * The widget DECLARATION contract (`WidgetDecl`, `WidgetScope`,
 * `WidgetStylePreset`, `WidgetDependency`, `systemStyleSlug`) and the shipped
 * `CORE_WIDGETS` now live in `@serene-pub/core-catalog` (`ui/sessions/widgets`) —
 * part of core's announcement, seeded the same way as the shipped pipelines and
 * presets. They're re-exported here so existing app imports keep resolving
 * through one module. What stays app-side is RUNTIME-only: the width tier and
 * the layout's style pin.
 */
export {
	systemStyleSlug,
	type WidgetDecl,
	type WidgetDependency,
	type WidgetScope,
	type WidgetStylePreset
} from "@serene-pub/core-catalog"

/**
 * The width class of a widget's own box (mirrors the surface-grid `Tier`, kept
 * as a self-contained literal so shared/widgets never imports client code).
 */
export type WidgetTier = "compact" | "cozy" | "roomy" | "wide"

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
