/**
 * The edits the layout EDITOR makes to a session's panels (PLAN-session-panels
 * 2026-10-14 §3 lanes 3–4). Pure: every op takes a `PanelLayoutV1` and answers
 * either `{ layout }` (a new document; the input is never mutated) or
 * `{ refused }` with the reason to show. An op that would change nothing
 * answers the SAME layout object, so a caller may compare by identity.
 *
 * Two rules no op may break (§1.1, §10): a panel always holds at least one
 * tab, and the middle is never empty (`MIDDLE_EMPTY`). The primary is a
 * place, not a widget (§10): when an op would empty it or move it away, the
 * nearest middle panel — the last of `above`, else the first of `below` — is
 * promoted into it. There is no Messages lock (§10 R-B). Both editors share
 * this file; the live session's two edits live in `livePanels.ts`.
 */
import type { PanelHeightV1, PanelLayoutV1, PanelV1 } from "@serene-pub/sdk"
import { findPanel, withPanelPinned, type PanelPlace } from "./livePanels"

/** A stack a panel can sit in: the two sides and the middle's two strips. */
export type StackPlace = "left" | "right" | "above" | "below"
/** Where a panel goes: the stack and the index to insert at (clamped). */
export type PanelSlot = { place: StackPlace; index: number }
/** Where a tab goes: the panel and the index among its tabs (end when absent). */
export type TabSlot = { panelKey: string; index?: number }

export type ArrangeOutcome = { layout: PanelLayoutV1; refused?: undefined } | { refused: string; layout?: undefined }

export const MIDDLE_EMPTY = "Put something in the middle first."
export const ALREADY_PLACED = "That widget is already in the layout."
/** `setHeight` on the primary (it always fills) or `setPinned` on a middle panel (only sides go in the rail). */
export const NOT_A_STACK = "That panel can't take that setting."
export const UNKNOWN_PANEL = "That panel isn't in the layout."
export const UNKNOWN_TAB = "That widget isn't in the layout."

const STACKS: readonly StackPlace[] = ["left", "right", "above", "below"]

export function isStackPlace(place: PanelPlace): place is StackPlace {
	return (STACKS as readonly string[]).includes(place)
}

/** The panels in one stack, top to bottom. */
export function stackOf(layout: PanelLayoutV1, place: StackPlace): PanelV1[] {
	return place === "left" || place === "right" ? (layout[place] ?? []) : (layout.middle?.[place] ?? [])
}

function withStack(layout: PanelLayoutV1, place: StackPlace, stack: PanelV1[]): PanelLayoutV1 {
	if (place === "left" || place === "right") return { ...layout, [place]: stack }
	return { ...layout, middle: { ...layout.middle, [place]: stack } }
}

/** Every panel, with where it sits. */
export function allPanels(layout: PanelLayoutV1): Array<{ panel: PanelV1; place: PanelPlace }> {
	const out: Array<{ panel: PanelV1; place: PanelPlace }> = []
	for (const place of ["above", "left", "right", "below"] as const)
		for (const panel of stackOf(layout, place)) out.push({ panel, place })
	if (layout.middle?.primary) out.push({ panel: layout.middle.primary, place: "primary" })
	return out
}

/** Every widget instance id placed anywhere, in panel order. */
export function placedIds(layout: PanelLayoutV1): string[] {
	return allPanels(layout).flatMap(({ panel }) => panel.tabs)
}

/** The next unused `p<n>` key. */
export function nextPanelKey(layout: PanelLayoutV1): string {
	let max = 0
	for (const { panel } of allPanels(layout)) {
		const m = /^p(\d+)$/.exec(panel.key)
		if (m) max = Math.max(max, Number(m[1]))
	}
	return `p${max + 1}`
}

/**
 * Why this tab can't be removed, or null when it can: `UNKNOWN_TAB`, or
 * `MIDDLE_EMPTY` when it is the primary's last tab and no other middle panel
 * could be promoted.
 */
export function removeRefusal(layout: PanelLayoutV1, instanceId: string): string | null {
	const holder = panelOfTab(layout, instanceId)
	if (!holder) return UNKNOWN_TAB
	if (holder.place === "primary" && holder.panel.tabs.length === 1 && !promoted(layout)) return MIDDLE_EMPTY
	return null
}

/** A panel as the primary holds it: never pinned, no height (the primary always fills). */
function asPrimary(panel: PanelV1): PanelV1 {
	const { pinned: _p, height: _h, ...rest } = panel
	return rest
}

/**
 * The layout with the primary vacated and the nearest middle panel promoted
 * into it — the last of `above`, else the first of `below` — or null when the
 * middle has no other panel. The old primary is simply gone from the result.
 */
function promoted(layout: PanelLayoutV1): PanelLayoutV1 | null {
	const above = stackOf(layout, "above")
	const below = stackOf(layout, "below")
	if (above.length)
		return { ...layout, middle: { ...layout.middle, above: above.slice(0, -1), primary: asPrimary(above[above.length - 1]) } }
	if (below.length) return { ...layout, middle: { ...layout.middle, below: below.slice(1), primary: asPrimary(below[0]) } }
	return null
}

/** The panel holding this tab, or null. */
export function panelOfTab(
	layout: PanelLayoutV1,
	instanceId: string
): { panel: PanelV1; place: PanelPlace } | null {
	for (const entry of allPanels(layout)) if (entry.panel.tabs.includes(instanceId)) return entry
	return null
}

/** `open` kept only while it names a tab other than the first. */
function tidyOpen(panel: PanelV1): PanelV1 {
	const { open, ...rest } = panel
	if (open && panel.tabs.includes(open) && panel.tabs[0] !== open) return panel
	return rest
}

function replacePanel(layout: PanelLayoutV1, key: string, next: PanelV1 | null): PanelLayoutV1 {
	const found = findPanel(layout, key)
	if (!found) return layout
	if (found.place === "primary") {
		if (!next) return layout
		return { ...layout, middle: { ...layout.middle, primary: next } }
	}
	const stack = stackOf(layout, found.place)
	const i = stack.findIndex((p) => p.key === key)
	const out = stack.slice()
	if (next) out.splice(i, 1, next)
	else out.splice(i, 1)
	return withStack(layout, found.place, out)
}

/** Take a tab out, dropping a panel it leaves empty; an emptied primary is replaced by promotion. */
function detach(layout: PanelLayoutV1, instanceId: string): ArrangeOutcome {
	const holder = panelOfTab(layout, instanceId)
	if (!holder) return { refused: UNKNOWN_TAB }
	const tabs = holder.panel.tabs.filter((id) => id !== instanceId)
	if (tabs.length === 0) {
		if (holder.place === "primary") {
			const next = promoted(layout)
			return next ? { layout: next } : { refused: MIDDLE_EMPTY }
		}
		return { layout: replacePanel(layout, holder.panel.key, null) }
	}
	return { layout: replacePanel(layout, holder.panel.key, tidyOpen({ ...holder.panel, tabs })) }
}

function insertTab(layout: PanelLayoutV1, instanceId: string, to: TabSlot): ArrangeOutcome {
	const found = findPanel(layout, to.panelKey)
	if (!found) return { refused: UNKNOWN_PANEL }
	const tabs = found.panel.tabs.slice()
	const at = to.index == null ? tabs.length : Math.max(0, Math.min(tabs.length, to.index))
	tabs.splice(at, 0, instanceId)
	return { layout: replacePanel(layout, found.panel.key, { ...found.panel, tabs }) }
}

function insertPanel(layout: PanelLayoutV1, panel: PanelV1, at: PanelSlot): PanelLayoutV1 {
	const stack = stackOf(layout, at.place).slice()
	const i = Math.max(0, Math.min(stack.length, at.index))
	// A strip never pins (§1.1) and takes its content's height unless one was
	// chosen (as the converter does); a side panel arriving from a strip is docked.
	const { pinned, ...rest } = panel
	const strip = at.place === "above" || at.place === "below"
	const placed = strip ? (rest.height ? rest : { ...rest, height: "fit" as const }) : pinned === false ? panel : rest
	stack.splice(i, 0, placed)
	return withStack(layout, at.place, stack)
}

/** Put a widget that is not yet placed into a panel as a tab. */
export function addTab(layout: PanelLayoutV1, instanceId: string, to: TabSlot): ArrangeOutcome {
	if (placedIds(layout).includes(instanceId)) return { refused: ALREADY_PLACED }
	return insertTab(layout, instanceId, to)
}

/** Put a widget that is not yet placed into a new panel of its own. */
export function newPanel(
	layout: PanelLayoutV1,
	instanceId: string,
	at: PanelSlot,
	init: Pick<PanelV1, "pinned" | "height" | "title"> = {}
): ArrangeOutcome {
	if (placedIds(layout).includes(instanceId)) return { refused: ALREADY_PLACED }
	const panel: PanelV1 = { key: nextPanelKey(layout), tabs: [instanceId], ...init }
	return { layout: insertPanel(layout, panel, at) }
}

/** Remove a placed widget. The primary's last tab promotes the nearest middle panel, or is refused (`MIDDLE_EMPTY`). */
export function removeTab(layout: PanelLayoutV1, instanceId: string): ArrangeOutcome {
	const why = removeRefusal(layout, instanceId)
	if (why) return { refused: why }
	return detach(layout, instanceId)
}

/** Move a placed widget into another panel (or another place in its own). */
export function moveTab(layout: PanelLayoutV1, instanceId: string, to: TabSlot): ArrangeOutcome {
	const holder = panelOfTab(layout, instanceId)
	if (!holder) return { refused: UNKNOWN_TAB }
	if (holder.panel.key === to.panelKey) {
		const tabs = holder.panel.tabs.filter((id) => id !== instanceId)
		const at = to.index == null ? tabs.length : Math.max(0, Math.min(tabs.length, to.index))
		tabs.splice(at, 0, instanceId)
		if (tabs.every((id, i) => id === holder.panel.tabs[i])) return { layout }
		// `open` tidied as `setTabOrder` does: a reorder that brings the open tab first drops it.
		return { layout: replacePanel(layout, holder.panel.key, tidyOpen({ ...holder.panel, tabs })) }
	}
	if (!findPanel(layout, to.panelKey)) return { refused: UNKNOWN_PANEL }
	const out = detach(layout, instanceId)
	if (!out.layout) return out
	return insertTab(out.layout, instanceId, to)
}

/** Move a placed widget out of its panel into a new panel of its own. */
export function splitOut(layout: PanelLayoutV1, instanceId: string, at: PanelSlot): ArrangeOutcome {
	const holder = panelOfTab(layout, instanceId)
	if (!holder) return { refused: UNKNOWN_TAB }
	if (holder.panel.tabs.length === 1) return movePanel(layout, holder.panel.key, at)
	const out = detach(layout, instanceId)
	if (!out.layout) return out
	const panel: PanelV1 = { key: nextPanelKey(out.layout), tabs: [instanceId] }
	return { layout: insertPanel(out.layout, panel, at) }
}

/**
 * Move a panel to a stack slot. The index counts the target stack WITHOUT
 * this panel. The primary may move too: the nearest middle panel is promoted
 * first (so the index also counts the strip without the promoted panel), or
 * the move is refused with `MIDDLE_EMPTY`.
 */
export function movePanel(layout: PanelLayoutV1, key: string, to: PanelSlot): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found) return { refused: UNKNOWN_PANEL }
	if (found.place === "primary") {
		const next = promoted(layout)
		if (!next) return { refused: MIDDLE_EMPTY }
		return { layout: insertPanel(next, found.panel, to) }
	}
	const from = stackOf(layout, found.place)
	const fromIndex = from.findIndex((p) => p.key === key)
	if (found.place === to.place && fromIndex === Math.max(0, Math.min(from.length - 1, to.index)))
		return { layout }
	const without = replacePanel(layout, key, null)
	return { layout: insertPanel(without, found.panel, to) }
}

/**
 * Make a panel (from any stack) the primary. The old primary goes to the END
 * of `above` — the nearest slot. The promoted panel loses `pinned` and
 * `height` (the primary always fills). Already primary: the same object.
 */
export function setPrimary(layout: PanelLayoutV1, key: string): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found) return { refused: UNKNOWN_PANEL }
	if (found.place === "primary") return { layout }
	const old = layout.middle.primary
	const without = replacePanel(layout, key, null)
	const { pinned: _p, ...oldRest } = old
	return {
		layout: {
			...without,
			middle: { ...without.middle, above: [...stackOf(without, "above"), oldRest], primary: asPrimary(found.panel) }
		}
	}
}

/**
 * Set a side or strip panel's height; `undefined` means fill. `'fill'` is
 * written as absent (§1.1: absent = fill), so Fill and "never set" compare
 * equal in `samePanels`; a `{ share }` is held to a whole 1–12 so no op can
 * write a height the validator refuses.
 */
export function setHeight(layout: PanelLayoutV1, key: string, asked: PanelHeightV1 | undefined): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found) return { refused: UNKNOWN_PANEL }
	if (found.place === "primary") return { refused: NOT_A_STACK }
	const height: PanelHeightV1 | undefined =
		asked === "fill"
			? undefined
			: typeof asked === "object" && asked
				? { share: Math.max(1, Math.min(12, Math.round(asked.share) || 1)) }
				: asked
	const { height: was, ...rest } = found.panel
	if (JSON.stringify(was) === JSON.stringify(height)) return { layout }
	return { layout: replacePanel(layout, key, height === undefined ? rest : { ...rest, height }) }
}

/** Dock a side panel or move it to the rail. Strips and the primary are refused. */
export function setPinned(layout: PanelLayoutV1, key: string, pinned: boolean): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found) return { refused: UNKNOWN_PANEL }
	if (found.place !== "left" && found.place !== "right") return { refused: NOT_A_STACK }
	return { layout: withPanelPinned(layout, key, pinned) ?? layout }
}

/** Name a panel, or clear its name. Shown only while it has two or more tabs. */
export function setTitle(layout: PanelLayoutV1, key: string, title: string | undefined): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found) return { refused: UNKNOWN_PANEL }
	const trimmed = title?.trim() || undefined
	if ((found.panel.title ?? undefined) === trimmed) return { layout }
	const { title: _was, ...rest } = found.panel
	return { layout: replacePanel(layout, key, trimmed ? { ...rest, title: trimmed } : rest) }
}

/** Reorder a panel's tabs. */
export function setTabOrder(layout: PanelLayoutV1, key: string, tabs: string[]): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found) return { refused: UNKNOWN_PANEL }
	const same = tabs.length === found.panel.tabs.length && tabs.every((t) => found.panel.tabs.includes(t))
	if (!same) return { refused: UNKNOWN_TAB }
	if (tabs.every((t, i) => t === found.panel.tabs[i])) return { layout }
	return { layout: replacePanel(layout, key, tidyOpen({ ...found.panel, tabs })) }
}

/** True when the two layouts place the same tabs in the same panels with the same options. */
export function samePanels(a: PanelLayoutV1, b: PanelLayoutV1): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}
