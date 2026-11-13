/**
 * The one edit the LIVE session makes to its panels (PLAN-session-panels
 * 2026-10-14 §1.3): which tab a panel has open. Pure — it returns a new
 * panel layout (the same version it was given, v1 or v2), or null when
 * nothing changes (an unknown key, a tab the panel does not hold, the value
 * it already has), so the caller writes nothing for a no-op.
 *
 * It keeps the stored form minimal: `open` is absent for the first tab. The
 * editor's arrangement ops are lay-D's (`arrangeOps`); this is the only write
 * a person makes from the session itself. There is no pin (PLAN 2026-11-05).
 */
import type {
	PanelLayoutV1,
	PanelLayoutV2,
	PanelV1,
	PanelV2
} from "@serene-pub/sdk"

/**
 * Where a panel sits: a zone (`left` / `middle` / `right`, panels v2), or —
 * ⏳ v1, read by lay-D's editor until it moves to v2 — one of the v1 middle's
 * three places (`above` / `primary` / `below`).
 */
export type PanelPlace = "left" | "middle" | "right" | "above" | "primary" | "below"

type AnyPanel = PanelV1 | PanelV2
type AnyLayout = PanelLayoutV1 | PanelLayoutV2

/** The panel with this key and where it sits, or null. */
export function findPanel(
	layout: AnyLayout,
	key: string
): { panel: AnyPanel; place: PanelPlace } | null {
	if (!key) return null
	if (layout?.version === 2) {
		for (const place of ["left", "middle", "right"] as const)
			for (const panel of layout[place] ?? [])
				if (panel?.key === key) return { panel, place }
		return null
	}
	for (const place of ["left", "right"] as const)
		for (const panel of layout[place] ?? [])
			if (panel?.key === key) return { panel, place }
	for (const place of ["above", "below"] as const)
		for (const panel of layout.middle?.[place] ?? [])
			if (panel?.key === key) return { panel, place }
	if (layout.middle?.primary?.key === key)
		return { panel: layout.middle.primary, place: "primary" }
	return null
}

/** The layout with the keyed panel replaced by `next`; the same version it was given. */
function replacing<L extends AnyLayout>(layout: L, key: string, next: AnyPanel): L {
	if (layout.version === 2) {
		const swap = (list: PanelV2[] | undefined) =>
			(list ?? []).map((p) => (p?.key === key ? (next as PanelV2) : p))
		return {
			...layout,
			left: swap(layout.left),
			middle: swap(layout.middle),
			right: swap(layout.right)
		} as L
	}
	const v1 = layout as PanelLayoutV1
	const swap = (list: PanelV1[] | undefined) =>
		(list ?? []).map((p) => (p?.key === key ? (next as PanelV1) : p))
	return {
		...v1,
		left: swap(v1.left),
		right: swap(v1.right),
		middle: {
			...v1.middle,
			above: swap(v1.middle?.above),
			below: swap(v1.middle?.below),
			primary: v1.middle?.primary?.key === key ? (next as PanelV1) : v1.middle.primary
		}
	} as L
}

/** The tab a panel shows: its `open` when that is one of its tabs, else the first. */
export function openTabOf(panel: AnyPanel): string | undefined {
	const tabs = Array.isArray(panel.tabs) ? panel.tabs : []
	return typeof panel.open === "string" && tabs.includes(panel.open)
		? panel.open
		: tabs[0]
}

/**
 * The layout with `tab` shown in the keyed panel — `open` written, or left
 * out when it is the first tab — or null when that changes nothing. The
 * layout comes back in the version it was given.
 */
export function withPanelOpen<L extends AnyLayout>(
	layout: L,
	key: string,
	tab: string
): L | null {
	const found = findPanel(layout, key)
	if (!found) return null
	const { panel } = found
	if (!Array.isArray(panel.tabs) || !panel.tabs.includes(tab)) return null
	if (openTabOf(panel) === tab && (tab !== panel.tabs[0] || panel.open === undefined))
		return null
	const { open: _open, ...rest } = panel
	const next: AnyPanel = tab === panel.tabs[0] ? rest : { ...rest, open: tab }
	return replacing(layout, key, next)
}
