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

export type ZoneKind = "side" | "strip"
export type SideMode = "drawer" | "rail" | "icons" | "hidden"
export type StripMode = "row" | "hidden"

/**
 * One width rule. `min` is the container width (px) at/above which the rule
 * applies; rules merge ascending, so later rules only state what changes.
 */
export interface ZoneRule {
	min: number
	mode?: SideMode | StripMode
	/** Rail/drawer inline size, px. */
	width?: number
	/** Rail stack columns (wide screens turn a rail into a grid). */
	columns?: number
}

export interface ZoneDef {
	kind: ZoneKind
	/** Side zones: which edge. */
	side?: "left" | "right"
	/** Strips: above or below the chat core. */
	area?: "top" | "bottom"
	/** Edit-mode label; defaults to the zone id. */
	label?: string
	/**
	 * Pinned rails take layout space; unpinned collapse to icons + popover.
	 * Meaningless for strips and for the drawer mode. Default: true.
	 */
	pinned?: boolean
	/** Widget ids, in order. */
	widgets: string[]
	/** The width ladder. Absent → the kind/side defaults below. */
	rules?: ZoneRule[]
}

export interface ZoneLayout {
	version: 1
	zones: Record<string, ZoneDef>
	/**
	 * Message-column caps by container width — the conversation should not
	 * become a 40-inch-wide bubble on a 4k screen. Same ascending-merge rule.
	 */
	messageRules?: Array<{ min: number; maxColRem?: number }>
	/** Style packs (data-attributes on the root; plumbing for later packs). */
	styles?: { chat?: string; composer?: string }
}

/** What a zone IS at the current width, after rules + pinning. */
export interface ResolvedZone {
	id: string
	def: ZoneDef
	mode: SideMode | StripMode
	width: number
	columns: number
}

/* ── defaults ───────────────────────────────────────────────────────── */

/** The default ladders, mirroring the reference mockup's breakpoints. */
export const DEFAULT_SIDE_RULES: Record<"left" | "right", ZoneRule[]> = {
	right: [
		{ min: 0, mode: "drawer", width: 320 },
		{ min: 760, mode: "rail", width: 264 },
		{ min: 1900, width: 300 },
		{ min: 2400, width: 344, columns: 2 }
	],
	left: [
		{ min: 0, mode: "drawer", width: 320 },
		{ min: 1200, mode: "rail", width: 264 },
		{ min: 1900, width: 300 },
		{ min: 2400, width: 344, columns: 2 }
	]
}

export const DEFAULT_STRIP_RULES: ZoneRule[] = [{ min: 0, mode: "row" }]

export const DEFAULT_MESSAGE_RULES: NonNullable<ZoneLayout["messageRules"]> = [
	{ min: 0 },
	{ min: 1900, maxColRem: 54 },
	{ min: 2400, maxColRem: 58 }
]

/**
 * A fresh layout: exactly the three zones (PLAN 25) — Left, Middle, Right.
 * There is no top/bottom zone; a widget that wants to sit at the top/bottom is
 * just anchored there within its zone. (The middle is the chat, owned by the
 * widget grid, so it isn't a side zone declared here.)
 */
export function defaultZoneLayout(rightWidgets: string[] = []): ZoneLayout {
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

/* ── resolution ─────────────────────────────────────────────────────── */

/** Ascending cumulative merge — each rule inherits what came before it. */
function walkRules(rules: ZoneRule[], width: number): Required<Omit<ZoneRule, "min">> {
	const out = { mode: "row" as SideMode | StripMode, width: 264, columns: 1 }
	for (const rule of [...rules].sort((a, b) => a.min - b.min)) {
		if (width < rule.min) break
		if (rule.mode !== undefined) out.mode = rule.mode
		if (rule.width !== undefined) out.width = rule.width
		if (rule.columns !== undefined) out.columns = rule.columns
	}
	return out
}

export function resolveZone(
	id: string,
	def: ZoneDef,
	containerWidth: number
): ResolvedZone {
	const rules =
		def.rules ??
		(def.kind === "side"
			? DEFAULT_SIDE_RULES[def.side ?? "right"]
			: DEFAULT_STRIP_RULES)
	const r = walkRules(rules, containerWidth)
	let mode = r.mode
	if (def.kind === "strip" && mode !== "hidden") mode = "row"
	// The pin refinement: an unpinned rail is an icon strip until popped.
	if (def.kind === "side" && mode === "rail" && def.pinned === false)
		mode = "icons"
	return { id, def, mode, width: r.width, columns: r.columns }
}

export function resolveMessageCap(
	layout: ZoneLayout,
	containerWidth: number
): number | undefined {
	let cap: number | undefined
	for (const rule of [...(layout.messageRules ?? DEFAULT_MESSAGE_RULES)].sort(
		(a, b) => a.min - b.min
	)) {
		if (containerWidth < rule.min) break
		cap = rule.maxColRem ?? cap
	}
	return cap
}

/* ── normalization ──────────────────────────────────────────────────── */

/**
 * Accept whatever the blob holds and return a usable layout — unknown
 * fields survive verbatim (it is the user's template), missing structure
 * gets defaults, and non-layouts fall back wholesale.
 */
export function normalizeZoneLayout(
	raw: unknown,
	fallbackRight: string[] = []
): ZoneLayout {
	const candidate = raw as ZoneLayout | undefined
	if (
		!candidate ||
		typeof candidate !== "object" ||
		candidate.version !== 1 ||
		typeof candidate.zones !== "object" ||
		candidate.zones === null
	)
		return defaultZoneLayout(fallbackRight)
	const zones: Record<string, ZoneDef> = {}
	for (const [id, def] of Object.entries(candidate.zones)) {
		if (!def || typeof def !== "object") continue
		zones[id] = {
			...def,
			kind: def.kind === "strip" ? "strip" : "side",
			widgets: Array.isArray(def.widgets)
				? def.widgets.filter((w) => typeof w === "string")
				: []
		}
	}
	if (!Object.keys(zones).length) return defaultZoneLayout(fallbackRight)
	return { ...candidate, zones }
}

/** Every widget id the layout places, in zone order. */
export function placedWidgetIds(layout: ZoneLayout): string[] {
	return Object.values(layout.zones).flatMap((z) => z.widgets)
}

/** Remove a widget id everywhere (a widget lives in at most one slot). */
export function withoutWidget(layout: ZoneLayout, id: string): ZoneLayout {
	const zones: Record<string, ZoneDef> = {}
	for (const [zid, def] of Object.entries(layout.zones))
		zones[zid] = { ...def, widgets: def.widgets.filter((w) => w !== id) }
	return { ...layout, zones }
}

/* ── style packs (message + composer layouts) ───────────────────────── */

/**
 * A selectable "style pack". These skin the ONE feature-complete
 * SessionMessage / SessionComposer — same components, same data, same
 * behaviors; only presentation changes (mockup 2026-08-28: pure-CSS swaps via
 * a data-attribute, no re-render). New packs are additive: a plugin surface
 * later (the scriptable-CSS discussion) can register more the same way.
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
		label: "Clean",
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
			"A large character portrait framed in a soft, dreamlike card."
	}
]

/** Composer layouts. */
export const COMPOSER_LAYOUTS: StylePack[] = [
	{
		id: "classic",
		label: "Classic",
		description: "The standard composer with tabs and token meter."
	},
	{
		id: "minimal",
		label: "Minimal",
		description: "A single-line pill; chrome tucked away."
	},
	{
		id: "writer",
		label: "Writer",
		description: "A tall editor with room to draft long prose."
	}
]

export const DEFAULT_CHAT_STYLE = "clean"
export const DEFAULT_COMPOSER_STYLE = "classic"

/** The effective style ids, falling back to defaults for anything unknown. */
export function resolveStyles(layout: ZoneLayout): {
	chat: string
	composer: string
} {
	const chat = MESSAGE_LAYOUTS.some((l) => l.id === layout.styles?.chat)
		? layout.styles!.chat!
		: DEFAULT_CHAT_STYLE
	const composer = COMPOSER_LAYOUTS.some(
		(l) => l.id === layout.styles?.composer
	)
		? layout.styles!.composer!
		: DEFAULT_COMPOSER_STYLE
	return { chat, composer }
}

/** Return a copy with one or both style slots patched. */
export function withStyles(
	layout: ZoneLayout,
	patch: { chat?: string; composer?: string }
): ZoneLayout {
	return { ...layout, styles: { ...layout.styles, ...patch } }
}

/** Insert a widget into a zone, optionally before another widget. */
export function withWidget(
	layout: ZoneLayout,
	zoneId: string,
	id: string,
	beforeId?: string
): ZoneLayout {
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
