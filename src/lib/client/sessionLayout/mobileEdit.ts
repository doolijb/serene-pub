/**
 * The PHONE layout editor's model — pure, and the whole of what a
 * narrow-screen edit may do to a session's panels, over panels v2.
 *
 * Below the breakpoint a session draws one panel under the next, so the
 * editor is a list in three sections — Left · Middle · Right — one ROW per
 * panel, its tabs listed inside. There are no groups, no rail and no main
 * panel: every section is a plain stack, every row the same kind. Every edit
 * is one of ./arrangeOps — the desktop editor's ops — so a layout arranged
 * on a phone is the same `PanelLayoutV2` a desktop opens, and commits down the
 * same path.
 *
 * Neighbours and moves are counted within a row's own zone: that is what
 * **Move into panel above / below** reaches, and what a row's up / down
 * steps through (it never crosses into another zone). The one refusal left
 * is `MIDDLE_EMPTY`.
 *
 * Every function answers an `ArrangeOutcome`: a new layout, the SAME layout
 * object when nothing changed, or the refusal to show.
 */
import type { PanelLayoutV2, PanelPriority, PanelV2 } from "@serene-pub/sdk"
import {
	addTab,
	allPanels,
	heightOf,
	moveTab,
	movePanel,
	newPanel,
	panelOfTab,
	placedIds,
	priorityOf,
	removeTab,
	setHeight,
	setPriority,
	setTabOrder,
	splitOut,
	stackOf,
	UNKNOWN_PANEL,
	UNKNOWN_TAB,
	type ArrangeOutcome,
	type StackPlace
} from "./arrangeOps"
import { mintInstanceId } from "./widgetInstances"

export const NO_PANEL_ABOVE = "There's no panel above this one."
export const NO_PANEL_BELOW = "There's no panel below this one."

/** The three sections the phone editor lists, in order. */
export const PHONE_SECTIONS: ReadonlyArray<{
	place: StackPlace
	label: string
}> = [
	{ place: "left", label: "Left" },
	{ place: "middle", label: "Middle" },
	{ place: "right", label: "Right" }
]

/** Where the Add picker lands a widget: into a panel as a tab, or a new panel at a zone's end. */
export type AddTarget =
	| { kind: "panel"; panelKey: string }
	| { kind: "stack"; place: StackPlace }

/** One row of the phone editor: a panel and what it can be told. */
export interface PhoneRow {
	key: string
	place: StackPlace
	/** Widget instance ids, in tab order. */
	tabs: string[]
	title?: string
	/** Fit or Fill, as the panel is effectively (a `{ share }` reads as Fill here). */
	height: "fit" | "fill"
	/** High, Normal or Low, as the panel is effectively. */
	priority: PanelPriority
	/** The row can move a step up / down in its zone. */
	canMoveUp: boolean
	canMoveDown: boolean
	/** The neighbouring panels in its zone, for Move into panel above / below. */
	aboveKey: string | null
	belowKey: string | null
}

export interface PhoneSection {
	place: StackPlace
	label: string
	rows: PhoneRow[]
	/** Where this section's Add lands a widget: a new panel at the end of its zone. */
	add: AddTarget
}

function rowOf(
	layout: PanelLayoutV2,
	panel: PanelV2,
	place: StackPlace
): PhoneRow {
	const column = stackOf(layout, place)
	const i = column.findIndex((c) => c.key === panel.key)
	const height = heightOf(panel)
	return {
		key: panel.key,
		place,
		tabs: [...panel.tabs],
		...(panel.title ? { title: panel.title } : {}),
		height: height === "fit" ? "fit" : "fill",
		priority: priorityOf(panel),
		canMoveUp: i > 0,
		canMoveDown: i >= 0 && i < column.length - 1,
		aboveKey: i > 0 ? column[i - 1].key : null,
		belowKey: i >= 0 && i < column.length - 1 ? column[i + 1].key : null
	}
}

/** The phone editor's list: three sections, one row per panel. */
export function phoneSections(layout: PanelLayoutV2): PhoneSection[] {
	return PHONE_SECTIONS.map(({ place, label }) => ({
		place,
		label,
		rows: stackOf(layout, place).map((panel) =>
			rowOf(layout, panel, place)
		),
		add: { kind: "stack", place }
	}))
}

/** Every row, in the list's order. */
export function phoneRows(layout: PanelLayoutV2): PhoneRow[] {
	return phoneSections(layout).flatMap((s) => s.rows)
}

function placeOf(layout: PanelLayoutV2, key: string): StackPlace | null {
	return (
		allPanels(layout).find(({ panel }) => panel.key === key)?.place ?? null
	)
}

/** Move a row a step up (`-1`) or down (`1`) in its zone; at an end nothing changes. */
export function moveRow(
	layout: PanelLayoutV2,
	key: string,
	delta: number
): ArrangeOutcome {
	const place = placeOf(layout, key)
	if (!place) return { refused: UNKNOWN_PANEL }
	if (!delta) return { layout }
	const stack = stackOf(layout, place)
	const i = stack.findIndex((p) => p.key === key)
	const j = i + Math.sign(delta)
	if (j < 0 || j >= stack.length) return { layout }
	return movePanel(layout, key, { place, index: j })
}

/** Drag a row to `index` in its zone's rows. */
export function moveRowTo(
	layout: PanelLayoutV2,
	key: string,
	index: number
): ArrangeOutcome {
	const place = placeOf(layout, key)
	if (!place) return { refused: UNKNOWN_PANEL }
	const last = stackOf(layout, place).length - 1
	return movePanel(layout, key, {
		place,
		index: Math.min(Math.max(0, Math.round(index)), last)
	})
}

/** Move one tab a step earlier (`-1`) or later (`1`) among its panel's tabs. */
export function moveTabWithin(
	layout: PanelLayoutV2,
	tabId: string,
	delta: number
): ArrangeOutcome {
	const holder = panelOfTab(layout, tabId)
	if (!holder) return { refused: UNKNOWN_TAB }
	const tabs = [...holder.panel.tabs]
	const i = tabs.indexOf(tabId)
	const j = i + Math.sign(delta)
	if (!delta || j < 0 || j >= tabs.length) return { layout }
	;[tabs[i], tabs[j]] = [tabs[j], tabs[i]]
	return setTabOrder(layout, holder.panel.key, tabs)
}

/**
 * **Move into panel above / below**: the tab joins the neighbouring panel in
 * its zone — at the end of the one above, the start of the one below, so
 * the reading order holds. A one-tab panel moved so merges into it.
 */
export function moveTabInto(
	layout: PanelLayoutV2,
	tabId: string,
	dir: -1 | 1
): ArrangeOutcome {
	const holder = panelOfTab(layout, tabId)
	if (!holder) return { refused: UNKNOWN_TAB }
	const row = rowOf(layout, holder.panel, holder.place)
	const target = dir < 0 ? row.aboveKey : row.belowKey
	if (!target) return { refused: dir < 0 ? NO_PANEL_ABOVE : NO_PANEL_BELOW }
	return moveTab(
		layout,
		tabId,
		dir < 0 ? { panelKey: target } : { panelKey: target, index: 0 }
	)
}

/** Whether a tab can be split out: only out of a panel holding two or more. */
export function canSplitOut(layout: PanelLayoutV2, tabId: string): boolean {
	return (panelOfTab(layout, tabId)?.panel.tabs.length ?? 0) > 1
}

/**
 * **Split out**: the tab takes a panel of its own, right after the one it
 * leaves, in the same zone. A tab alone in its panel already is one; nothing
 * changes.
 */
export function splitTab(layout: PanelLayoutV2, tabId: string): ArrangeOutcome {
	const holder = panelOfTab(layout, tabId)
	if (!holder) return { refused: UNKNOWN_TAB }
	if (holder.panel.tabs.length < 2) return { layout }
	const stack = stackOf(layout, holder.place)
	const i = stack.findIndex((p) => p.key === holder.panel.key)
	return splitOut(layout, tabId, { place: holder.place, index: i + 1 })
}

/**
 * The instance id an added widget gets (./widgetInstances `mintInstanceId`):
 * the bare id when nothing holds it, else `W#n`, skipping what is placed or
 * stored. `fresh` (Duplicate) never reuses an id holding stored values.
 */
export function mintFor(
	layout: PanelLayoutV2,
	widgetId: string,
	stored: Iterable<string> = [],
	opts: { fresh?: boolean } = {}
): string {
	return mintInstanceId(widgetId, placedIds(layout), stored, opts)
}

/** Land an instance from the Add picker: a tab of a panel, or a new panel at a zone's end. */
export function addAt(
	layout: PanelLayoutV2,
	instanceId: string,
	target: AddTarget
): ArrangeOutcome {
	if (target.kind === "panel")
		return addTab(layout, instanceId, { panelKey: target.panelKey })
	return newPanel(layout, instanceId, {
		place: target.place,
		index: stackOf(layout, target.place).length
	})
}

/** **Duplicate**: the copy (already minted) lands as the tab right after its source. */
export function duplicateTab(
	layout: PanelLayoutV2,
	sourceId: string,
	copyId: string
): ArrangeOutcome {
	const holder = panelOfTab(layout, sourceId)
	if (!holder) return { refused: UNKNOWN_TAB }
	return addTab(layout, copyId, {
		panelKey: holder.panel.key,
		index: holder.panel.tabs.indexOf(sourceId) + 1
	})
}

/** ×: remove a tab. The last tab of the middle's only panel is refused (`MIDDLE_EMPTY`). */
export function removeTabFrom(
	layout: PanelLayoutV2,
	tabId: string
): ArrangeOutcome {
	return removeTab(layout, tabId)
}

/** A row's height: Fit takes its content's height, Fill shares what is left. */
export function setRowHeight(
	layout: PanelLayoutV2,
	key: string,
	height: "fit" | "fill"
): ArrangeOutcome {
	return setHeight(layout, key, height === "fit" ? "fit" : "fill")
}

/** A row's priority: when a zone runs short, Low gives way first, then Normal; High last. */
export function setRowPriority(
	layout: PanelLayoutV2,
	key: string,
	priority: PanelPriority
): ArrangeOutcome {
	return setPriority(layout, key, priority)
}
