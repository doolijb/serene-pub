/**
 * The PHONE layout editor's model (PLAN-session-panels-2026-10-14 §3 lane 4)
 * — pure, and the whole of what a narrow-screen edit may do to a session's
 * panels.
 *
 * Below the breakpoint a session draws one panel under the next, so the
 * editor is a list: one ROW per panel, its tabs listed inside, in the order
 * Above · Middle (the primary panel) · Below · Left · Right. Every edit is one
 * of ./arrangeOps — the desktop editor's ops — so a layout arranged on a phone
 * is the same `PanelLayoutV1` a desktop opens, and commits down the same path.
 *
 * Neighbours are counted within one COLUMN: the middle is one column (its
 * strips above, the primary, its strips below), each side another. That is
 * what **Move into panel above / below** reaches, and what a row's up / down
 * crosses (a strip moved past the primary changes from above to below).
 *
 * A side is two GROUPS (§10 R-C): **Docked** then **In the rail**. Its column
 * reads docked rows first, rail rows after; moving the last docked row down
 * puts it first in the rail, moving the first rail row up docks it last. An
 * all-rail side is an empty Docked group above its rail rows (R-A).
 *
 * The primary is a place (§10): **Make main** (`setPrimary`) on any other row
 * puts that panel there, the old primary going to the end of Above. Nothing
 * is locked (R-B); the one refusal left is `MIDDLE_EMPTY`.
 *
 * Every function answers an `ArrangeOutcome`: a new layout, the SAME layout
 * object when nothing changed, or the refusal to show.
 */
import type { PanelLayoutV1, PanelV1 } from "@serene-pub/sdk"
import {
	addTab,
	allPanels,
	moveTab,
	movePanel,
	newPanel,
	panelOfTab,
	placedIds,
	removeTab,
	setHeight,
	setPinned,
	setPrimary,
	setTabOrder,
	splitOut,
	stackOf,
	UNKNOWN_PANEL,
	UNKNOWN_TAB,
	type ArrangeOutcome,
	type StackPlace
} from "./arrangeOps"
import type { PanelPlace } from "./livePanels"
import { mintInstanceId } from "./widgetInstances"

export const NO_PANEL_ABOVE = "There's no panel above this one."
export const NO_PANEL_BELOW = "There's no panel below this one."

/** The five sections the phone editor lists, in order. */
export const PHONE_SECTIONS: ReadonlyArray<{ place: PanelPlace; label: string }> = [
	{ place: "above", label: "Above" },
	{ place: "primary", label: "Middle" },
	{ place: "below", label: "Below" },
	{ place: "left", label: "Left" },
	{ place: "right", label: "Right" }
]

/** A side's two groups, in the order the section lists them. */
export type SideGroup = "docked" | "rail"
export const SIDE_GROUPS: ReadonlyArray<{ group: SideGroup; label: string }> = [
	{ group: "docked", label: "Docked" },
	{ group: "rail", label: "In the rail" }
]

/** Where the Add picker lands a widget: into a panel as a tab, or a new panel at a stack's end. */
export type AddTarget = { kind: "panel"; panelKey: string } | { kind: "stack"; place: StackPlace }

/** One row of the phone editor: a panel and what it can be told. */
export interface PhoneRow {
	key: string
	place: PanelPlace
	/** Widget instance ids, in tab order. */
	tabs: string[]
	title?: string
	/** A side row's group; `null` on middle rows, which never go in the rail. */
	group: SideGroup | null
	/** Fit or Fill (a `{ share }` reads as Fill here); `null` on the primary. */
	height: "fit" | "fill" | null
	/** **Make main** applies: every row but the primary. */
	canMakeMain: boolean
	/** The row can move a step up / down in its column (a side's crosses its group boundary). */
	canMoveUp: boolean
	canMoveDown: boolean
	/** The neighbouring panels in its column, for Move into panel above / below. */
	aboveKey: string | null
	belowKey: string | null
}

export interface PhoneSection {
	place: PanelPlace
	label: string
	rows: PhoneRow[]
	/** A side's rows split Docked · In the rail (both listed, even empty); `null` elsewhere. */
	groups: Array<{ group: SideGroup; label: string; rows: PhoneRow[] }> | null
	/** Where this section's Add lands a widget. */
	add: AddTarget
}

const isRail = (panel: PanelV1) => panel.pinned === false

/** A side's panels in the order its section reads: docked first, then the rail. */
function sideColumn(layout: PanelLayoutV1, place: "left" | "right"): PanelV1[] {
	const stack = stackOf(layout, place)
	return [...stack.filter((p) => !isRail(p)), ...stack.filter(isRail)]
}

/** A column's panels, top to bottom, with their places. */
function columnOf(layout: PanelLayoutV1, place: PanelPlace): Array<{ panel: PanelV1; place: PanelPlace }> {
	if (place === "left" || place === "right") return sideColumn(layout, place).map((panel) => ({ panel, place }))
	return [
		...stackOf(layout, "above").map((panel) => ({ panel, place: "above" as const })),
		...(layout.middle?.primary ? [{ panel: layout.middle.primary, place: "primary" as const }] : []),
		...stackOf(layout, "below").map((panel) => ({ panel, place: "below" as const }))
	]
}

function rowOf(layout: PanelLayoutV1, panel: PanelV1, place: PanelPlace): PhoneRow {
	const column = columnOf(layout, place)
	const i = column.findIndex((c) => c.panel.key === panel.key)
	const side = place === "left" || place === "right"
	const primary = place === "primary"
	// A middle strip moves past the primary; the primary itself never moves.
	// A side row crosses its group boundary: a docked row can always go down
	// (into the rail), a rail row always up (docked).
	const rail = side && isRail(panel)
	const canMoveUp = !primary && (side ? i > 0 || rail : place === "below" || i > 0)
	const canMoveDown = !primary && (side ? i < column.length - 1 || !rail : place === "above" || i < column.length - 1)
	return {
		key: panel.key,
		place,
		tabs: [...panel.tabs],
		...(panel.title ? { title: panel.title } : {}),
		group: side ? (isRail(panel) ? "rail" : "docked") : null,
		canMakeMain: !primary,
		height: primary ? null : panel.height === "fit" ? "fit" : "fill",
		canMoveUp,
		canMoveDown,
		aboveKey: i > 0 ? column[i - 1].panel.key : null,
		belowKey: i >= 0 && i < column.length - 1 ? column[i + 1].panel.key : null
	}
}

/** The phone editor's list: five sections, one row per panel. */
export function phoneSections(layout: PanelLayoutV1): PhoneSection[] {
	return PHONE_SECTIONS.map(({ place, label }) => {
		const side = place === "left" || place === "right"
		const panels =
			place === "primary"
				? layout.middle?.primary
					? [layout.middle.primary]
					: []
				: side
					? sideColumn(layout, place)
					: stackOf(layout, place)
		const rows = panels.map((panel) => rowOf(layout, panel, place))
		return {
			place,
			label,
			rows,
			groups: side
				? SIDE_GROUPS.map(({ group, label }) => ({ group, label, rows: rows.filter((r) => r.group === group) }))
				: null,
			add:
				place === "primary"
					? { kind: "panel", panelKey: layout.middle?.primary?.key ?? "" }
					: { kind: "stack", place }
		}
	})
}

/** Every row, in the list's order. */
export function phoneRows(layout: PanelLayoutV1): PhoneRow[] {
	return phoneSections(layout).flatMap((s) => s.rows)
}

function placeOf(layout: PanelLayoutV1, key: string): PanelPlace | null {
	return allPanels(layout).find(({ panel }) => panel.key === key)?.place ?? null
}

/**
 * Put a side panel at `index` among its `group`'s rows, in that group. The
 * stack keeps every other panel where it was; only this one moves.
 */
function placeInGroup(
	layout: PanelLayoutV1,
	key: string,
	place: "left" | "right",
	group: SideGroup,
	index: number
): ArrangeOutcome {
	const stack = stackOf(layout, place)
	const without = stack.filter((p) => p.key !== key)
	const members = without.filter((p) => isRail(p) === (group === "rail"))
	const at =
		index < members.length
			? without.indexOf(members[Math.max(0, index)])
			: members.length
				? without.indexOf(members[members.length - 1]) + 1
				: group === "docked"
					? 0
					: without.length
	const moved = movePanel(layout, key, { place, index: at })
	if (!moved.layout) return moved
	return setPinned(moved.layout, key, group === "docked")
}

/**
 * Move a row a step up (`-1`) or down (`1`) in its column. A strip at the
 * primary's edge crosses it: the last panel above moves to the first below,
 * and back. A side row at its group's edge crosses the boundary: the last
 * docked row goes first in the rail, the first rail row docks last. The
 * primary does not move (Make main on another row moves it).
 */
export function moveRow(layout: PanelLayoutV1, key: string, delta: number): ArrangeOutcome {
	const place = placeOf(layout, key)
	if (!place) return { refused: UNKNOWN_PANEL }
	if (!delta || place === "primary") return { layout }
	if (place === "left" || place === "right") {
		const column = sideColumn(layout, place)
		const i = column.findIndex((p) => p.key === key)
		const j = i + Math.sign(delta)
		const rail = isRail(column[i])
		// A docked row always has somewhere below (the rail, even empty); a rail row above.
		if ((j < 0 && !rail) || (j >= column.length && rail)) return { layout }
		const docked = column.filter((p) => !isRail(p)).length
		// Group-relative index the row lands at; crossing lands at the boundary.
		if (j < docked || (rail && j < 0)) return placeInGroup(layout, key, place, "docked", rail ? docked : j)
		return placeInGroup(layout, key, place, "rail", rail ? j - docked : 0)
	}
	const stack = stackOf(layout, place)
	const i = stack.findIndex((p) => p.key === key)
	const j = i + Math.sign(delta)
	if (j >= 0 && j < stack.length) return movePanel(layout, key, { place, index: j })
	if (place === "above" && delta > 0) return movePanel(layout, key, { place: "below", index: 0 })
	if (place === "below" && delta < 0)
		return movePanel(layout, key, { place: "above", index: stackOf(layout, "above").length })
	return { layout }
}

/** Drag a row to `index` in its column's rows, spent as single steps. */
export function moveRowTo(layout: PanelLayoutV1, key: string, index: number): ArrangeOutcome {
	let cur = layout
	for (let guard = 0; guard < 64; guard++) {
		const place = placeOf(cur, key)
		if (!place) return { refused: UNKNOWN_PANEL }
		const column = columnOf(cur, place)
		const at = column.findIndex((c) => c.panel.key === key)
		const want = Math.min(Math.max(0, Math.round(index)), column.length - 1)
		if (at === want) break
		const out = moveRow(cur, key, want > at ? 1 : -1)
		if (!out.layout || out.layout === cur) break
		cur = out.layout
	}
	return { layout: cur }
}

/** Move one tab a step earlier (`-1`) or later (`1`) among its panel's tabs. */
export function moveTabWithin(layout: PanelLayoutV1, tabId: string, delta: number): ArrangeOutcome {
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
 * its column — at the end of the one above, the start of the one below, so
 * the reading order holds. A one-tab panel moved so merges into it.
 */
export function moveTabInto(layout: PanelLayoutV1, tabId: string, dir: -1 | 1): ArrangeOutcome {
	const holder = panelOfTab(layout, tabId)
	if (!holder) return { refused: UNKNOWN_TAB }
	const row = rowOf(layout, holder.panel, holder.place)
	const target = dir < 0 ? row.aboveKey : row.belowKey
	if (!target) return { refused: dir < 0 ? NO_PANEL_ABOVE : NO_PANEL_BELOW }
	return moveTab(layout, tabId, dir < 0 ? { panelKey: target } : { panelKey: target, index: 0 })
}

/** Whether a tab can be split out: only out of a panel holding two or more. */
export function canSplitOut(layout: PanelLayoutV1, tabId: string): boolean {
	return (panelOfTab(layout, tabId)?.panel.tabs.length ?? 0) > 1
}

/**
 * **Split out**: the tab takes a panel of its own, right after the one it
 * leaves (a tab of the primary: the first panel below). A tab alone in its
 * panel already is one; nothing changes.
 */
export function splitTab(layout: PanelLayoutV1, tabId: string): ArrangeOutcome {
	const holder = panelOfTab(layout, tabId)
	if (!holder) return { refused: UNKNOWN_TAB }
	if (holder.panel.tabs.length < 2) return { layout }
	if (holder.place === "primary") return splitOut(layout, tabId, { place: "below", index: 0 })
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
	layout: PanelLayoutV1,
	widgetId: string,
	stored: Iterable<string> = [],
	opts: { fresh?: boolean } = {}
): string {
	return mintInstanceId(widgetId, placedIds(layout), stored, opts)
}

/** Land an instance from the Add picker: a tab of a panel, or a new panel at a stack's end. */
export function addAt(layout: PanelLayoutV1, instanceId: string, target: AddTarget): ArrangeOutcome {
	if (target.kind === "panel") return addTab(layout, instanceId, { panelKey: target.panelKey })
	return newPanel(layout, instanceId, { place: target.place, index: stackOf(layout, target.place).length })
}

/** **Duplicate**: the copy (already minted) lands as the tab right after its source. */
export function duplicateTab(layout: PanelLayoutV1, sourceId: string, copyId: string): ArrangeOutcome {
	const holder = panelOfTab(layout, sourceId)
	if (!holder) return { refused: UNKNOWN_TAB }
	return addTab(layout, copyId, {
		panelKey: holder.panel.key,
		index: holder.panel.tabs.indexOf(sourceId) + 1
	})
}

/** ×: remove a tab. Every tab has one; the primary's last, with nothing to promote, is refused (`MIDDLE_EMPTY`). */
export function removeTabFrom(layout: PanelLayoutV1, tabId: string): ArrangeOutcome {
	return removeTab(layout, tabId)
}

/** **Make main**: this row's panel becomes the primary; the old primary goes to the end of Above. */
export function makeMain(layout: PanelLayoutV1, key: string): ArrangeOutcome {
	return setPrimary(layout, key)
}

/** A row's height: Fit takes its content's height, Fill shares what is left. */
export function setRowHeight(layout: PanelLayoutV1, key: string, height: "fit" | "fill"): ArrangeOutcome {
	return setHeight(layout, key, height === "fit" ? "fit" : undefined)
}
