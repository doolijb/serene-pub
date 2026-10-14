/**
 * The section list's data shape, and the one signal `PanelSplit` gives it.
 *
 * A section list 🚧 (PLAN-sidebar-nav-normalization §2.1) is the left column
 * of a view whose column is the PLACES in the view — Settings, Admin,
 * Sampling, Pipelines, a lorebook's scopes — as opposed to a list column,
 * which is the items. The rows are data so every one of those views draws
 * the same row; `SectionList.svelte` is the only thing that draws them.
 */
import { getContext, setContext, type Component } from "svelte"

/** One place in a section list. */
export interface SectionItem {
	/** What `value` and `onselect` speak. Unique within the list. */
	key: string
	/** 14px medium, one line, truncated. */
	label: string
	/** A lucide icon component, drawn at 18px in the muted tone. */
	icon?: Component<any>
	/**
	 * A 12px muted second line — Sampling's and Pipelines' one-line blurbs.
	 * The row grows to two lines; it is truncated, never wrapped.
	 */
	description?: string
	/** A count badge at the right. `0` is drawn; `undefined` is not. */
	count?: number
	/**
	 * A status dot at the right (STYLE-GUIDE §5.1's status dots): `error`
	 * for a problem, `primary` for "this needs you". Never a count.
	 */
	dot?: "error" | "primary"
	/** What the dot says to a screen reader. Defaults by tone (`dotLabelFor`). */
	dotLabel?: string
	/**
	 * Renders the row as a link, so it can be opened in a new tab and read
	 * as navigation. With `onselect` set, a plain click is taken over (see
	 * `SectionList`'s `onselect`); a modified click stays the browser's.
	 */
	href?: string
	/** Drawn at 60% and not clickable. */
	disabled?: boolean
}

/** A run of rows under an optional muted label. No rule between groups. */
export interface SectionGroup {
	label?: string
	items: SectionItem[]
}

/** The sr-only words a status dot carries when its row names none. */
export function dotLabelFor(dot: NonNullable<SectionItem["dot"]>): string {
	return dot === "error" ? "(has a problem)" : "(needs you)"
}

const SECTION_COLUMN = Symbol("panels.sectionColumn")

/**
 * Set by `PanelSplit kind="sections"` for whatever its `list` snippet
 * renders. `fill` is true at compact width, where the section list is the
 * whole pane rather than a 240px column: a `SectionList` that reads it drops
 * its width and its edge and fills the pane, so a view writes one
 * `<SectionList>` for both widths instead of switching `flush` itself.
 */
export interface SectionColumn {
	readonly fill: boolean
}

export function provideSectionColumn(column: SectionColumn): void {
	setContext(SECTION_COLUMN, column)
}

export function sectionColumn(): SectionColumn | undefined {
	return getContext<SectionColumn | undefined>(SECTION_COLUMN)
}
