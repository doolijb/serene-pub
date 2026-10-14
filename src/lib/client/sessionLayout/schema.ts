/**
 * The modular session layout schema (mockup: serene-pub-chat-layout.html,
 * ruled 2026-08-28) — a free-form template the user (and eventually genres /
 * plugins) can customize wholesale.
 *
 * The chat core stays fixed in the middle; everything around it is ZONES the
 * layout JSON declares — any ids, any number of them, each carrying its own
 * widget list and its own ladder of width rules. Rules are evaluated against
 * the **measured container width** (the chat component's own box, never the
 * viewport), ascending and cumulative: each rule inherits the resolved values
 * below it and overrides what it states, so "any number of customizable
 * screen widths" is literal — three rules or thirteen, the resolver walks
 * them the same way.
 *
 * Side-zone presentation is a two-step decision:
 *   1. the width rules resolve a base mode — `drawer` (overlay + scrim,
 *      narrow) or `rail` (wide enough to dock);
 *   2. the zone's `pinned` flag refines `rail`: pinned → a static rail that
 *      takes layout space; unpinned → the rail collapses to an icon strip,
 *      and clicking a widget's icon pops the zone OVER the chat until the
 *      user clicks away (or pins it).
 * Strips are horizontal (top/bottom of the core) and scroll sideways when
 * tight.
 */
import {
	type LayoutZoneDef,
	type ZoneLayoutV1,
	zoneRungAt
} from "@serene-pub/sdk"
import { isRetiredWidget } from "./widgetGrid"

/*
 * The `zoneLayout` slot's types are the SDK's (`ZoneLayoutV1`, its zones
 * `LayoutZoneDef`, their width ladders `LayoutZoneRule`), imported from
 * `@serene-pub/sdk` wherever they are used: the session layout is one format
 * a genre ships and this page draws. So is the ladder walk and its default
 * ladders (`zoneRungAt`, `DEFAULT_SIDE_RULES`, `DEFAULT_STRIP_RULES`): what a
 * zone is at a width is part of what a layout draws (`resolveDrawn`). What
 * stays here is the page's handle on a resolved zone, and the normalizer that
 * repairs a stored blob for the editor.
 */

/** What a side zone is drawn as at a width. */
export type SideMode = "drawer" | "rail" | "icons" | "hidden"
/** What a strip is drawn as at a width. */
export type StripMode = "row" | "hidden"

/** What a zone IS at the current width, after rules + pinning. */
export interface ResolvedZone {
	id: string
	def: LayoutZoneDef
	mode: SideMode | StripMode
	width: number
	columns: number
}

/* ── defaults ───────────────────────────────────────────────────────── */

/**
 * A fresh layout: exactly the three zones (PLAN 25) — Left, Middle, Right.
 * There is no top/bottom zone; a widget that wants to sit at the top/bottom is
 * just anchored there within its zone. (The middle is the chat, owned by the
 * widget grid, so it isn't a side zone declared here.)
 */
export function defaultZoneLayout(rightWidgets: string[] = []): ZoneLayoutV1 {
	return {
		version: 1,
		zones: {
			left: { kind: "side", side: "left", pinned: false, widgets: [] },
			right: {
				kind: "side",
				side: "right",
				pinned: true,
				widgets: [...rightWidgets]
			}
		}
	}
}

/**
 * Does dropping a widget into this side zone also PIN it? (Ruled 2026-09-17.)
 *
 * `defaultZoneLayout` ships Left unpinned, because a fresh session has nothing
 * on the left and an icon strip for an empty column is the honest default. But
 * somebody who has just arranged widgets into that column meant a column, not a
 * strip of icons — so the first drop takes the default with it.
 *
 * The two cases are told apart by whether the zone had any WIDGETS when the
 * editor opened, not by any extra flag:
 *
 *   - shipped unpinned — the zone was empty, so there was never a rail to
 *     unpin and `pinned: false` can only be the default talking. The drop pins.
 *   - explicitly unpinned — you unpin a rail you can see, which means widgets
 *     were in it. `pinned: false` is then a decision, and it stands.
 *
 * `hadWidgets` is read from the snapshot the editor took when it opened, so a
 * second drop in the same session cannot re-pin a zone the user unpinned after
 * the first one.
 */
export function pinsOnFirstDrop(o: {
	/** The zone's current pin. Absent means pinned (schema default). */
	pinned?: boolean
	/** Did this zone hold any widgets when the editor opened? */
	hadWidgets: boolean
}): boolean {
	return o.pinned === false && !o.hadWidgets
}

/* ── resolution ─────────────────────────────────────────────────────── */

/**
 * One zone at the measured container width: the SDK's ladder walk
 * (`zoneRungAt` — the rules ascending and cumulative, the default ladder for
 * its side when it states none, an unpinned rail refined to icons), with the
 * zone it was read from beside it.
 */
export function resolveZone(
	id: string,
	def: LayoutZoneDef,
	containerWidth: number
): ResolvedZone {
	const { mode, width, columns } = zoneRungAt(def, containerWidth)
	return { id, def, mode, width, columns }
}

/* ── normalization ──────────────────────────────────────────────────── */

/**
 * Accept whatever the blob holds and return a usable layout — unknown
 * fields survive verbatim (it is the user's template), missing structure
 * gets defaults, and non-layouts fall back wholesale.
 *
 * A RETIRED widget id (`RETIRED_WIDGET_IDS` — `inventory` since R79) leaves a
 * zone's list here, the same way `loadArranged` drops it from an arrangement:
 * a zone that held only the retired widget is an empty zone, never a zone of
 * nothing drawn — so the editor offers it as a drop target and a first drop
 * pins it, as it does any empty zone.
 */
export function normalizeZoneLayout(
	raw: unknown,
	fallbackRight: string[] = []
): ZoneLayoutV1 {
	const candidate = raw as ZoneLayoutV1 | undefined
	if (
		!candidate ||
		typeof candidate !== "object" ||
		candidate.version !== 1 ||
		typeof candidate.zones !== "object" ||
		candidate.zones === null
	)
		return defaultZoneLayout(fallbackRight)
	const zones: Record<string, LayoutZoneDef> = {}
	for (const [id, def] of Object.entries(candidate.zones)) {
		if (!def || typeof def !== "object") continue
		zones[id] = {
			...def,
			kind: def.kind === "strip" ? "strip" : "side",
			widgets: Array.isArray(def.widgets)
				? def.widgets.filter(
						(w) => typeof w === "string" && !isRetiredWidget(w)
					)
				: []
		}
	}
	if (!Object.keys(zones).length) return defaultZoneLayout(fallbackRight)
	return { ...candidate, zones }
}

/** Every widget id the layout places, in zone order. */
export function placedWidgetIds(layout: ZoneLayoutV1): string[] {
	return Object.values(layout.zones).flatMap((z) => z.widgets)
}

/** Remove a widget id everywhere (a widget lives in at most one slot). */
export function withoutWidget(layout: ZoneLayoutV1, id: string): ZoneLayoutV1 {
	const zones: Record<string, LayoutZoneDef> = {}
	for (const [zid, def] of Object.entries(layout.zones))
		zones[zid] = { ...def, widgets: def.widgets.filter((w) => w !== id) }
	return { ...layout, zones }
}

/* ── style packs (message layouts) ──────────────────────────────────── */

/**
 * A selectable "style pack". These skin the ONE feature-complete
 * SessionMessage — same component, same data, same behaviors; only presentation
 * changes (mockup 2026-08-28: pure-CSS swaps via a data-attribute, no
 * re-render). New packs are additive: a plugin surface later (the
 * scriptable-CSS discussion) can register more the same way.
 */
export interface StylePack {
	id: string
	label: string
	description: string
}

/** Message-column layouts. `clean` is the default (the classic SP look). */
export const MESSAGE_LAYOUTS: StylePack[] = [
	{
		id: "clean",
		label: "Stage",
		description: "The classic Serene Pub card — full-width, uncluttered."
	},
	{
		id: "bubbles",
		label: "Bubbles",
		description: "Chat bubbles aligned by speaker; you on the right."
	},
	{
		id: "novel",
		label: "Novel",
		description: "Flowing serif prose at a reading measure, no bubbles."
	},
	{
		id: "compact",
		label: "Compact",
		description: "Dense IRC-style lines with tiny avatars."
	},
	{
		id: "cameo",
		label: "Dreamlit Cameo",
		description:
			"A large character portrait beside the text, in a soft glass card."
	}
]

export const DEFAULT_CHAT_STYLE = "clean"

/**
 * The effective style id, falling back to the default for anything unknown.
 *
 * A blob written by an older build carries a second key naming a composer look.
 * The composer's shape is a SETTING on the messages widget (`CORE_WIDGETS`), so
 * there is no pack to resolve it to and the key is read past.
 */
export function resolveStyles(layout: ZoneLayoutV1): { chat: string } {
	const chat = MESSAGE_LAYOUTS.some((l) => l.id === layout.styles?.chat)
		? layout.styles!.chat!
		: DEFAULT_CHAT_STYLE
	return { chat }
}

/** Return a copy with the style slot patched. */
export function withStyles(
	layout: ZoneLayoutV1,
	patch: { chat?: string }
): ZoneLayoutV1 {
	return { ...layout, styles: { ...layout.styles, ...patch } }
}

/** Insert a widget into a zone, optionally before another widget. */
export function withWidget(
	layout: ZoneLayoutV1,
	zoneId: string,
	id: string,
	beforeId?: string
): ZoneLayoutV1 {
	const cleared = withoutWidget(layout, id)
	const zone = cleared.zones[zoneId]
	if (!zone) return cleared
	const widgets = [...zone.widgets]
	const at = beforeId ? widgets.indexOf(beforeId) : -1
	if (at >= 0) widgets.splice(at, 0, id)
	else widgets.push(id)
	return {
		...cleared,
		zones: { ...cleared.zones, [zoneId]: { ...zone, widgets } }
	}
}
