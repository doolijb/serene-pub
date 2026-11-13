/**
 * The edits the layout EDITOR makes to a session's panels, over panels v2
 * (owner rulings 2026-11-05: no pin, one kind of panel, every zone its own
 * stack). Pure: every op takes a `PanelLayoutV2` and answers either
 * `{ layout }` (a new document; the input is never mutated) or `{ refused }`
 * with the reason to show. An op that would change nothing answers the SAME
 * layout object, so a caller may compare by identity.
 *
 * The layout is three plain stacks — `left`, `middle`, `right` — of panels,
 * top to bottom. Two rules no op may break: a panel always holds at least
 * one tab (detaching its last tab drops it), and the middle is never empty
 * (`MIDDLE_EMPTY`). Nothing else is locked: any panel may hold any widget,
 * and there is no primary panel, no rail and no pin. Both editors share this
 * file; the live session's one edit lives in `livePanels.ts`.
 *
 * A panel's height and priority are stored only when they differ from what
 * its open widget declares (absent = declared), and the layout's look
 * (`backing`, `opacity`, `gap`, `behind`, `behindDim`) only when it differs from the default; the
 * `*Of` readers answer the effective value.
 */
import {
	DEFAULT_PANEL_LOOK,
	widgetOfInstance,
	type PanelBacking,
	type PanelGap,
	type PanelHeightV1,
	type PanelLayoutV2,
	type PanelLook,
	type PanelPriority,
	type PanelV2
} from "@serene-pub/sdk"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { findPanel, openTabOf, type PanelPlace } from "./livePanels"

/** A stack a panel can sit in: the three zones. */
export type StackPlace = "left" | "middle" | "right"
/** Where a panel goes: the stack and the index to insert at (clamped). */
export type PanelSlot = { place: StackPlace; index: number }
/** Where a tab goes: the panel and the index among its tabs (end when absent). */
export type TabSlot = { panelKey: string; index?: number }

export type ArrangeOutcome =
	| { layout: PanelLayoutV2; refused?: undefined }
	| { refused: string; layout?: undefined }

/** The layout's look: what a patch may carry. */
export type LookPatch = Partial<{
	backing: PanelBacking
	opacity: number
	gap: PanelGap
	behind: "background" | "backdrop"
	behindDim: number
}>

export const MIDDLE_EMPTY = "Put something in the middle first."
export const ALREADY_PLACED = "That widget is already in the layout."
export const UNKNOWN_PANEL = "That panel isn't in the layout."
export const UNKNOWN_TAB = "That widget isn't in the layout."

const STACKS: readonly StackPlace[] = ["left", "middle", "right"]

export function isStackPlace(place: PanelPlace): place is StackPlace {
	return (STACKS as readonly string[]).includes(place)
}

/** The panels in one stack, top to bottom. */
export function stackOf(layout: PanelLayoutV2, place: StackPlace): PanelV2[] {
	return layout[place] ?? []
}

function withStack(
	layout: PanelLayoutV2,
	place: StackPlace,
	stack: PanelV2[]
): PanelLayoutV2 {
	return { ...layout, [place]: stack }
}

/** Every panel, with where it sits: left, middle, right. */
export function allPanels(
	layout: PanelLayoutV2
): Array<{ panel: PanelV2; place: StackPlace }> {
	const out: Array<{ panel: PanelV2; place: StackPlace }> = []
	for (const place of STACKS)
		for (const panel of stackOf(layout, place)) out.push({ panel, place })
	return out
}

/** Every widget instance id placed anywhere, in panel order. */
export function placedIds(layout: PanelLayoutV2): string[] {
	return allPanels(layout).flatMap(({ panel }) => panel.tabs)
}

/** The next unused `p<n>` key. */
export function nextPanelKey(layout: PanelLayoutV2): string {
	let max = 0
	for (const { panel } of allPanels(layout)) {
		const m = /^p(\d+)$/.exec(panel.key)
		if (m) max = Math.max(max, Number(m[1]))
	}
	return `p${max + 1}`
}

/** The panel holding this tab, or null. */
export function panelOfTab(
	layout: PanelLayoutV2,
	instanceId: string
): { panel: PanelV2; place: StackPlace } | null {
	for (const entry of allPanels(layout))
		if (entry.panel.tabs.includes(instanceId)) return entry
	return null
}

/** Would taking this tab out leave the middle with no panel? */
function emptiesMiddle(
	layout: PanelLayoutV2,
	holder: { panel: PanelV2; place: StackPlace }
): boolean {
	return (
		holder.place === "middle" &&
		holder.panel.tabs.length === 1 &&
		stackOf(layout, "middle").length === 1
	)
}

/** Why this tab can't be removed, or null when it can: `UNKNOWN_TAB`, or `MIDDLE_EMPTY` when it is the last tab of the middle's only panel. */
export function removeRefusal(
	layout: PanelLayoutV2,
	instanceId: string
): string | null {
	const holder = panelOfTab(layout, instanceId)
	if (!holder) return UNKNOWN_TAB
	return emptiesMiddle(layout, holder) ? MIDDLE_EMPTY : null
}

/** `open` kept only while it names a tab other than the first. */
function tidyOpen(panel: PanelV2): PanelV2 {
	const { open, ...rest } = panel
	if (open && panel.tabs.includes(open) && panel.tabs[0] !== open)
		return panel
	return rest
}

function replacePanel(
	layout: PanelLayoutV2,
	key: string,
	next: PanelV2 | null
): PanelLayoutV2 {
	const found = findPanel(layout, key)
	if (!found || !isStackPlace(found.place)) return layout
	const stack = stackOf(layout, found.place)
	const i = stack.findIndex((p) => p.key === key)
	const out = stack.slice()
	if (next) out.splice(i, 1, next)
	else out.splice(i, 1)
	return withStack(layout, found.place, out)
}

/** Take a tab out, dropping a panel it leaves empty; the middle is never left without a panel. */
function detach(layout: PanelLayoutV2, instanceId: string): ArrangeOutcome {
	const holder = panelOfTab(layout, instanceId)
	if (!holder) return { refused: UNKNOWN_TAB }
	if (emptiesMiddle(layout, holder)) return { refused: MIDDLE_EMPTY }
	const tabs = holder.panel.tabs.filter((id) => id !== instanceId)
	if (tabs.length === 0)
		return { layout: replacePanel(layout, holder.panel.key, null) }
	return {
		layout: replacePanel(
			layout,
			holder.panel.key,
			tidyOpen({ ...holder.panel, tabs })
		)
	}
}

function insertTab(
	layout: PanelLayoutV2,
	instanceId: string,
	to: TabSlot
): ArrangeOutcome {
	const found = findPanel(layout, to.panelKey)
	if (!found) return { refused: UNKNOWN_PANEL }
	const tabs = found.panel.tabs.slice()
	const at =
		to.index == null
			? tabs.length
			: Math.max(0, Math.min(tabs.length, to.index))
	tabs.splice(at, 0, instanceId)
	return {
		layout: replacePanel(layout, found.panel.key, {
			...found.panel,
			tabs
		} as PanelV2)
	}
}

function insertPanel(
	layout: PanelLayoutV2,
	panel: PanelV2,
	at: PanelSlot
): PanelLayoutV2 {
	const stack = stackOf(layout, at.place).slice()
	const i = Math.max(0, Math.min(stack.length, at.index))
	stack.splice(i, 0, panel)
	return withStack(layout, at.place, stack)
}

/** Put a widget that is not yet placed into a panel as a tab. */
export function addTab(
	layout: PanelLayoutV2,
	instanceId: string,
	to: TabSlot
): ArrangeOutcome {
	if (placedIds(layout).includes(instanceId))
		return { refused: ALREADY_PLACED }
	return insertTab(layout, instanceId, to)
}

/** Put a widget that is not yet placed into a new panel of its own. */
export function newPanel(
	layout: PanelLayoutV2,
	instanceId: string,
	at: PanelSlot,
	init: Pick<PanelV2, "height" | "priority" | "title"> = {}
): ArrangeOutcome {
	if (placedIds(layout).includes(instanceId))
		return { refused: ALREADY_PLACED }
	const panel: PanelV2 = {
		key: nextPanelKey(layout),
		tabs: [instanceId],
		...init
	}
	return { layout: insertPanel(layout, panel, at) }
}

/** Remove a placed widget. The last tab of the middle's only panel is refused (`MIDDLE_EMPTY`). */
export function removeTab(
	layout: PanelLayoutV2,
	instanceId: string
): ArrangeOutcome {
	const why = removeRefusal(layout, instanceId)
	if (why) return { refused: why }
	return detach(layout, instanceId)
}

/** Move a placed widget into another panel (or another place in its own). */
export function moveTab(
	layout: PanelLayoutV2,
	instanceId: string,
	to: TabSlot
): ArrangeOutcome {
	const holder = panelOfTab(layout, instanceId)
	if (!holder) return { refused: UNKNOWN_TAB }
	if (holder.panel.key === to.panelKey) {
		const tabs = holder.panel.tabs.filter((id) => id !== instanceId)
		const at =
			to.index == null
				? tabs.length
				: Math.max(0, Math.min(tabs.length, to.index))
		tabs.splice(at, 0, instanceId)
		if (tabs.every((id, i) => id === holder.panel.tabs[i]))
			return { layout }
		// `open` tidied as `setTabOrder` does: a reorder that brings the open tab first drops it.
		return {
			layout: replacePanel(
				layout,
				holder.panel.key,
				tidyOpen({ ...holder.panel, tabs })
			)
		}
	}
	const target = findPanel(layout, to.panelKey)
	if (!target) return { refused: UNKNOWN_PANEL }
	// Leaving the middle's only panel for a side would empty the middle; into another middle panel it would not.
	if (emptiesMiddle(layout, holder) && target.place !== "middle")
		return { refused: MIDDLE_EMPTY }
	const out = detach(layout, instanceId)
	if (!out.layout) return out
	return insertTab(out.layout, instanceId, to)
}

/** Move a placed widget out of its panel into a new panel of its own. */
export function splitOut(
	layout: PanelLayoutV2,
	instanceId: string,
	at: PanelSlot
): ArrangeOutcome {
	const holder = panelOfTab(layout, instanceId)
	if (!holder) return { refused: UNKNOWN_TAB }
	if (holder.panel.tabs.length === 1)
		return movePanel(layout, holder.panel.key, at)
	const out = detach(layout, instanceId)
	if (!out.layout) return out
	const panel: PanelV2 = { key: nextPanelKey(out.layout), tabs: [instanceId] }
	return { layout: insertPanel(out.layout, panel, at) }
}

/** Move a panel to a stack slot. The index counts the target stack WITHOUT this panel. */
export function movePanel(
	layout: PanelLayoutV2,
	key: string,
	to: PanelSlot
): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found || !isStackPlace(found.place)) return { refused: UNKNOWN_PANEL }
	const from = stackOf(layout, found.place)
	if (found.place === "middle" && to.place !== "middle" && from.length === 1)
		return { refused: MIDDLE_EMPTY }
	const fromIndex = from.findIndex((p) => p.key === key)
	if (
		found.place === to.place &&
		fromIndex === Math.max(0, Math.min(from.length - 1, to.index))
	)
		return { layout }
	const without = replacePanel(layout, key, null)
	return { layout: insertPanel(without, found.panel as PanelV2, to) }
}

const HEIGHTS = ["fit", "fill"] as const
const PRIORITIES: readonly PanelPriority[] = ["high", "normal", "low"]
const BACKINGS: readonly PanelBacking[] = ["card", "glass", "none"]
const GAPS: readonly PanelGap[] = ["tight", "comfortable", "spacious"]

/** What a widget instance declares for its panel: height and priority, else fill / normal. */
export function declaredPanelOf(instanceId: string | undefined): {
	height: "fit" | "fill"
	priority: PanelPriority
} {
	const decl = instanceId
		? CORE_WIDGETS.find((w) => w.id === widgetOfInstance(instanceId))
		: undefined
	return {
		height: decl?.panel?.height ?? "fill",
		priority: decl?.panel?.priority ?? "normal"
	}
}

function validHeight(h: unknown): h is PanelHeightV1 {
	return (
		(HEIGHTS as readonly unknown[]).includes(h) ||
		(!!h &&
			typeof h === "object" &&
			Number.isFinite((h as { share?: unknown }).share))
	)
}

/** A panel's effective height: the stored one when valid, else its open tab's declaration. */
export function heightOf(panel: PanelV2): PanelHeightV1 {
	return validHeight(panel.height)
		? panel.height
		: declaredPanelOf(openTabOf(panel)).height
}

/** A panel's effective priority: the stored one when valid, else its open tab's declaration. */
export function priorityOf(panel: PanelV2): PanelPriority {
	return panel.priority && PRIORITIES.includes(panel.priority)
		? panel.priority
		: declaredPanelOf(openTabOf(panel)).priority
}

/**
 * Set a panel's height; `undefined` means fill. A value equal to the panel's
 * DECLARED default is written as absent (stored form stays minimal), any
 * other explicitly — so Fill on a Composer panel (declared fit) writes
 * `"fill"`. A `{ share }` is held to a whole 1–12 so no op can write a
 * height the validator refuses.
 */
export function setHeight(
	layout: PanelLayoutV2,
	key: string,
	asked: PanelHeightV1 | undefined
): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found || !isStackPlace(found.place)) return { refused: UNKNOWN_PANEL }
	const want: PanelHeightV1 | undefined =
		asked === undefined
			? "fill"
			: typeof asked === "object" && asked
				? {
						share: Math.max(
							1,
							Math.min(12, Math.round(asked.share) || 1)
						)
					}
				: asked
	if (!validHeight(want)) return { layout }
	const panel = found.panel as PanelV2
	const { height: was, ...rest } = panel
	const stored =
		want === declaredPanelOf(openTabOf(panel)).height ? undefined : want
	if (JSON.stringify(was) === JSON.stringify(stored)) return { layout }
	return {
		layout: replacePanel(
			layout,
			key,
			stored === undefined ? rest : { ...rest, height: stored }
		)
	}
}

/** Set a panel's priority; `undefined` or the declared one is written as absent. An unknown value changes nothing. */
export function setPriority(
	layout: PanelLayoutV2,
	key: string,
	asked: PanelPriority | undefined
): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found || !isStackPlace(found.place)) return { refused: UNKNOWN_PANEL }
	if (asked !== undefined && !PRIORITIES.includes(asked)) return { layout }
	const panel = found.panel as PanelV2
	const { priority: was, ...rest } = panel
	const stored =
		asked === undefined ||
		asked === declaredPanelOf(openTabOf(panel)).priority
			? undefined
			: asked
	if (was === stored) return { layout }
	return {
		layout: replacePanel(
			layout,
			key,
			stored === undefined ? rest : { ...rest, priority: stored }
		)
	}
}

/** The layout's effective look: what it stores over the default. */
export function lookOf(layout: PanelLayoutV2): Required<PanelLook> {
	return {
		backing:
			layout.backing && BACKINGS.includes(layout.backing)
				? layout.backing
				: DEFAULT_PANEL_LOOK.backing,
		opacity:
			typeof layout.opacity === "number" &&
			Number.isFinite(layout.opacity)
				? layout.opacity
				: DEFAULT_PANEL_LOOK.opacity,
		gap:
			layout.gap && GAPS.includes(layout.gap)
				? layout.gap
				: DEFAULT_PANEL_LOOK.gap,
		behind:
			layout.behind === "background" || layout.behind === "backdrop"
				? layout.behind
				: "background",
		behindDim:
			typeof layout.behindDim === "number" &&
			Number.isFinite(layout.behindDim)
				? Math.max(0, Math.min(100, Math.round(layout.behindDim)))
				: 0
	}
}

/**
 * Set the layout's look. Each patched value is checked (an invalid one is
 * ignored; opacity is rounded and held to 0–100); one equal to the default
 * is removed from the layout. It never touches the panels.
 */
export function setLook(
	layout: PanelLayoutV2,
	patch: LookPatch
): ArrangeOutcome {
	const next: PanelLayoutV2 = { ...layout }
	const write = <K extends keyof PanelLook>(k: K, value: PanelLook[K]) => {
		if (value === DEFAULT_PANEL_LOOK[k]) delete next[k]
		else (next as unknown as Record<string, unknown>)[k] = value
	}
	if (patch.backing !== undefined && BACKINGS.includes(patch.backing))
		write("backing", patch.backing)
	if (patch.gap !== undefined && GAPS.includes(patch.gap))
		write("gap", patch.gap)
	if (typeof patch.opacity === "number" && Number.isFinite(patch.opacity))
		write("opacity", Math.max(0, Math.min(100, Math.round(patch.opacity))))
	if (patch.behind === "background" || patch.behind === "backdrop")
		write("behind", patch.behind)
	if (typeof patch.behindDim === "number" && Number.isFinite(patch.behindDim))
		write(
			"behindDim",
			Math.max(0, Math.min(100, Math.round(patch.behindDim)))
		)
	return JSON.stringify(next) === JSON.stringify(layout)
		? { layout }
		: { layout: next }
}

/** Name a panel, or clear its name. Shown only while it has two or more tabs. */
export function setTitle(
	layout: PanelLayoutV2,
	key: string,
	title: string | undefined
): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found) return { refused: UNKNOWN_PANEL }
	const trimmed = title?.trim() || undefined
	if ((found.panel.title ?? undefined) === trimmed) return { layout }
	const { title: _was, ...rest } = found.panel as PanelV2
	return {
		layout: replacePanel(
			layout,
			key,
			trimmed ? { ...rest, title: trimmed } : rest
		)
	}
}

/** Reorder a panel's tabs. */
export function setTabOrder(
	layout: PanelLayoutV2,
	key: string,
	tabs: string[]
): ArrangeOutcome {
	const found = findPanel(layout, key)
	if (!found) return { refused: UNKNOWN_PANEL }
	const same =
		tabs.length === found.panel.tabs.length &&
		tabs.every((t) => found.panel.tabs.includes(t))
	if (!same) return { refused: UNKNOWN_TAB }
	if (tabs.every((t, i) => t === found.panel.tabs[i])) return { layout }
	return {
		layout: replacePanel(
			layout,
			key,
			tidyOpen({ ...(found.panel as PanelV2), tabs })
		)
	}
}

/** True when the two layouts place the same tabs in the same panels with the same options. */
export function samePanels(a: PanelLayoutV2, b: PanelLayoutV2): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}
