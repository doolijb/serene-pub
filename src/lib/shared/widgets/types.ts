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
 *
 * ## The title is resolved here (R-20, U5i)
 *
 * A declared widget's `title` is display text — a string or a locale map —
 * and this module is the one door the app reads declarations through, so it
 * is where the map becomes the text a screen shows: `WidgetDecl` below is the
 * SDK's declaration with `title` resolved through the SDK's `i18nText`, and
 * `CORE_WIDGETS` is the catalogue projected the same way. Every reader past
 * this line — the chrome, the tray, the settings schema's default title, the
 * style seeds — sees a string, and none of them reaches for `.en`. A plugin's
 * panels enter through the session view socket, where the server resolves
 * them the same way (`sockets/sessions.ts`).
 */
import { i18nText, type WidgetDecl as DeclaredWidget } from "@serene-pub/sdk"
import { CORE_WIDGETS as DECLARED_CORE_WIDGETS } from "@serene-pub/core-catalog"

export {
	systemStyleSlug,
	type WidgetDependency,
	type WidgetScope,
	type WidgetStylePreset
} from "@serene-pub/core-catalog"

/** A widget declaration as the app reads it: the SDK's, with `title` resolved to text. */
export type WidgetDecl = Omit<DeclaredWidget, "title"> & { title: string }

/**
 * The SDK's declaration with its title resolved in `language` (R-20). The
 * title is required at publish, so the id is a fallback the gate makes
 * unreachable rather than a case a reader plans for.
 */
export function resolveWidgetDecl(
	decl: DeclaredWidget,
	language?: string
): WidgetDecl {
	return { ...decl, title: i18nText(decl.title, language) ?? decl.id }
}

/** The shipped widgets, titles resolved — see the module note. */
export const CORE_WIDGETS: WidgetDecl[] =
	DECLARED_CORE_WIDGETS.map((w) => resolveWidgetDecl(w))

/**
 * The width class of a widget's own box — the SDK's, because it is a field of
 * the widget envelope (`layout.v1.tier`) and a plugin reflows against the same
 * four names this app does.
 */
export type { WidgetTier } from "@serene-pub/sdk"

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
