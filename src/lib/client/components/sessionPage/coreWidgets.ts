/**
 * Core's default session widgets — the conversation, and the widgets beside
 * it — from ONE table, each mounted remote: core's own component module,
 * served at `/core-ui/<slug>` and run in the page's UI worker (R79).
 *
 * A row is what only the page decides about a core widget (its title, icon,
 * layout, whether it starts on); everything the widget declares — settings,
 * the base sections it reads (R75), the scopes it holds — is read off core's
 * own declaration (`CORE_WIDGETS`), never retyped, so a field added to the
 * announcement reaches the widget with it.
 */
import {
	WIDGET_SCOPED_SECTIONS,
	resolveWidgetSurface,
	widgetReads,
	type WidgetBaseSection,
	type WidgetSectionScope
} from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"

type ModePanel = Sockets.Sessions.View.ModePanel

/** What the page decides about one core widget; the rest is its declaration. */
interface CoreWidgetRow {
	/** The widget id core declares (and its component slug). */
	id: string
	title: string
	icon: string
	layout: NonNullable<ModePanel["layout"]>
	defaultActive: boolean
}

/**
 * The table. Stats and world state (docs/stats-and-states.md) are offered,
 * never on: a genre that declares no slots would otherwise seat two empty
 * widgets in every chat session, and a newcomer must never see a bar — a
 * genre that wants them docked ships a layout preset. Lore entries (L1)
 * likewise: a session with no lorebook would seat an empty widget. No
 * Inventory row: R79 removed that widget for now, and a stored layout naming
 * it draws nothing (`RETIRED_WIDGET_IDS`).
 */
export const CORE_WIDGET_ROWS: readonly CoreWidgetRow[] = Object.freeze([
	{
		id: "scene-portraits",
		title: "Scene Portraits",
		icon: "Users",
		layout: { span: { ideal: 1 }, minInline: 200 },
		defaultActive: true
	},
	{
		id: "stats",
		title: "Stats",
		icon: "HeartPulse",
		layout: { span: { ideal: 1 }, minInline: 220 },
		defaultActive: false
	},
	{
		id: "world-state",
		title: "World State",
		icon: "CloudSun",
		layout: { span: { ideal: 2 }, minInline: 240, minBlock: 60 },
		defaultActive: false
	},
	{
		id: "lore-entries",
		title: "Lore entries",
		icon: "BookOpen",
		layout: { span: { ideal: 1 }, minInline: 260 },
		defaultActive: false
	},
	/**
	 * 🚧 The author's note (AN1): Chat's alone among core's genres (the
	 * others omit it), offered and never on — Chat's default layout is the
	 * conversation on its own, so a person adds it in the layout editor.
	 */
	{
		id: "authors-note",
		title: "Author's note",
		icon: "NotebookPen",
		layout: { span: { ideal: 1 }, minInline: 240 },
		defaultActive: false
	}
])

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
 * The side widgets, resolved. Core's own widgets hold every section scope
 * they declare.
 */
export function coreDefaultWidgets(): ModePanel[] {
	return CORE_WIDGET_ROWS.map((row) => {
		const decl = coreDecl(row.id)
		const surface = resolveWidgetSurface(decl, "core")
		if (surface?.kind !== "remote") throw new Error(`core widget '${row.id}' declares no component`)
		const grants = sectionScopes(decl.scopes)
		return {
			id: row.id,
			title: row.title,
			icon: row.icon,
			role: "secondary",
			surface,
			src: `/core-ui/${surface.component}`,
			layout: row.layout,
			settings: decl.settings as Record<string, unknown> | undefined,
			...(Array.isArray(decl.reads) ? { reads: [...widgetReads(decl)] } : {}),
			...(grants.length ? { grants } : {}),
			defaultActive: row.defaultActive
		}
	})
}
