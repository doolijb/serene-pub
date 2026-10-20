/**
 * The two edits the LIVE session makes to its panels (PLAN-session-panels
 * 2026-10-14 §1.3): which tab a panel has open, and whether a side panel is
 * docked or in the rail. Pure — each returns a new `PanelLayoutV1`, or null
 * when nothing changes (an unknown key, a tab the panel does not hold, the
 * value it already has), so the caller writes nothing for a no-op.
 *
 * Both keep the stored form minimal: `open` is absent for the first tab and
 * `pinned` is absent for docked — the only value ever written is `false`.
 * The editor's arrangement ops are lane 3's (`arrangeOps`); these two are the
 * only writes a person makes from the session itself.
 */
import type { PanelLayoutV1, PanelV1 } from "@serene-pub/sdk"

/** Where a panel sits: a side, or one of the middle's three places. */
export type PanelPlace = "left" | "right" | "above" | "primary" | "below"

/** The panel with this key and where it sits, or null. */
export function findPanel(
	layout: PanelLayoutV1,
	key: string
): { panel: PanelV1; place: PanelPlace } | null {
	if (!key) return null
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

/** The layout with the keyed panel replaced by `next`. */
function replacing(
	layout: PanelLayoutV1,
	key: string,
	next: PanelV1
): PanelLayoutV1 {
	const swap = (list: PanelV1[] | undefined) =>
		(list ?? []).map((p) => (p?.key === key ? next : p))
	return {
		...layout,
		left: swap(layout.left),
		right: swap(layout.right),
		middle: {
			...layout.middle,
			above: swap(layout.middle?.above),
			below: swap(layout.middle?.below),
			primary:
				layout.middle?.primary?.key === key ? next : layout.middle.primary
		}
	}
}

/** The tab a panel shows: its `open` when that is one of its tabs, else the first. */
export function openTabOf(panel: PanelV1): string | undefined {
	const tabs = Array.isArray(panel.tabs) ? panel.tabs : []
	return typeof panel.open === "string" && tabs.includes(panel.open)
		? panel.open
		: tabs[0]
}

/**
 * The layout with `tab` shown in the keyed panel — `open` written, or left
 * out when it is the first tab — or null when that changes nothing.
 */
export function withPanelOpen(
	layout: PanelLayoutV1,
	key: string,
	tab: string
): PanelLayoutV1 | null {
	const found = findPanel(layout, key)
	if (!found) return null
	const { panel } = found
	if (!Array.isArray(panel.tabs) || !panel.tabs.includes(tab)) return null
	if (openTabOf(panel) === tab && (tab !== panel.tabs[0] || panel.open === undefined))
		return null
	const { open: _open, ...rest } = panel
	const next: PanelV1 = tab === panel.tabs[0] ? rest : { ...rest, open: tab }
	return replacing(layout, key, next)
}

/**
 * The layout with the keyed SIDE panel docked (`pinned` left out) or in the
 * rail (`pinned: false`), or null when it already is, or is not a side
 * panel: the middle never pins.
 */
export function withPanelPinned(
	layout: PanelLayoutV1,
	key: string,
	pinned: boolean
): PanelLayoutV1 | null {
	const found = findPanel(layout, key)
	if (!found || (found.place !== "left" && found.place !== "right"))
		return null
	const { panel } = found
	if ((panel.pinned !== false) === pinned) return null
	const { pinned: _pinned, ...rest } = panel
	return replacing(layout, key, pinned ? rest : { ...rest, pinned: false })
}
