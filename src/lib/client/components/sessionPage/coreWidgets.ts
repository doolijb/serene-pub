/**
 * Core's default session widgets — the conversation, and the widgets beside
 * it — projected from core's ONE declaration (`CORE_WIDGETS`), each mounted
 * remote: core's own component module, served at `/core-ui/<slug>` and run in
 * the page's UI worker (R79).
 *
 * Nothing here is retyped. Title, icon, packing hints (`layout`), settings,
 * the base sections it reads (R75) and the scopes it holds are the
 * declaration's, so a field added to a core widget reaches the page with it.
 * Whether a widget starts ON is not a widget fact at all: it is on exactly
 * when the session's layout draws it (`SurfaceManager`, C2) — Stats (World
 * State's too, an alias of it since W7) is offered and placed by the genres
 * whose layouts want it, never seated empty in every chat. No Inventory: R79 removed that widget for now,
 * and a stored layout naming it draws nothing (`RETIRED_WIDGET_IDS`).
 */
import {
	WIDGET_ID_ALIASES,
	WIDGET_SCOPED_SECTIONS,
	resolveWidgetSurface,
	widgetReads,
	type WidgetBaseSection,
	type WidgetSectionScope
} from "@serene-pub/sdk"
import { CORE_WIDGETS, type WidgetDecl } from "$lib/shared/widgets/types"

type ModePanel = Sockets.Sessions.View.ModePanel

const coreDecl = (id: string) => {
	const decl = CORE_WIDGETS.find((w) => w.id === id)
	if (!decl) throw new Error(`core declares no widget '${id}'`)
	return decl
}

/** A declaration's scopes that deliver a section — the ones a grant can name. */
const sectionScopes = (scopes: readonly string[] | undefined): WidgetSectionScope[] =>
	(scopes ?? []).filter((s): s is WidgetSectionScope => Object.hasOwn(WIDGET_SCOPED_SECTIONS, s))

/**
 * Core's conversation, as the layout mounts it: its module, and the base
 * sections its declaration reads (R75, K12) — everything else it is told
 * arrives in its dossier (`session:full`, the page's grant).
 */
export const CORE_CONVERSATION: { src: string; reads: readonly WidgetBaseSection[] } = Object.freeze({
	src: `/core-ui/${coreDecl("messages").component ?? "messages"}`,
	reads: Object.freeze([...widgetReads(coreDecl("messages"))])
})

/**
 * One core side widget as the page offers it: its declaration, projected —
 * plus where its module is served and the section scopes it holds (core's own
 * widgets hold every one they declare).
 */
function coreWidgetPanel(decl: WidgetDecl): ModePanel {
	const surface = resolveWidgetSurface(decl, "core")
	if (surface?.kind !== "remote") throw new Error(`core widget '${decl.id}' declares no component`)
	const grants = sectionScopes(decl.scopes)
	return {
		id: decl.id,
		title: decl.title,
		...(decl.icon !== undefined ? { icon: decl.icon } : {}),
		role: "secondary",
		surface,
		src: `/core-ui/${surface.component}`,
		...(decl.layout ? { layout: decl.layout } : {}),
		settings: decl.settings as Record<string, unknown> | undefined,
		...(Array.isArray(decl.reads) ? { reads: [...widgetReads(decl)] } : {}),
		...(grants.length ? { grants } : {})
	}
}

/**
 * The side widgets, resolved: every widget core declares but its primary
 * (the conversation, which the layout mounts itself — `CORE_CONVERSATION`),
 * in the catalogue's order.
 *
 * ⏳ Not an aliased one (`world-state`, the SDK's `WIDGET_ID_ALIASES`): it is
 * declared only so its style rows survive a release, and offering it would
 * put a second World State in the tray and seat a widget the layout's id no
 * longer means. A layout that places `world-state` draws it as a copy of
 * Stats (`SurfaceManager`'s copies: `widgetOfInstance` reads it as one).
 */
export function coreDefaultWidgets(): ModePanel[] {
	return CORE_WIDGETS.filter(
		(w) => w.role !== "primary" && !Object.hasOwn(WIDGET_ID_ALIASES, w.id)
	).map(coreWidgetPanel)
}
