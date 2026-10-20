/**
 * The **primary floor** — now only a CONVERTER's rule (owner review
 * 2026-10-14, R-B: no lock at all).
 *
 * A layout stored as `panels` is read exactly as stored: it may hold no
 * conversation at all, and its primary panel may hold any widget (a map,
 * stats, a plugin's). Reset to genre default layout is the way back; nothing
 * here puts the conversation back behind the person's back.
 *
 * The floor survives in one place: a blob with NO `panels` (only the ⏳ old
 * slots, or nothing) is converted by the SDK (`panelsOf` → `panelsFromSlots`),
 * which puts the bare conversation in the middle when the old slots placed
 * none. `readStoredLayout` swaps that converter's conversation for this
 * genre's primary (`withPrimaryFloor`) — an R71 genre's board, say. And when
 * a genre that withholds a widget empties the WHOLE middle of a stored layout
 * by omitting it (the genre did that, not the person), its primary takes the
 * primary panel.
 *
 * "Placed" means DRAWN, never merely named: what is drawn is the SDK's one
 * reading of a layout (`resolveDrawn` over `panelsOf`, `drawnOf` here) — a
 * retired widget's tab draws nothing.
 *
 * Pure: it reads a session layout (`SessionLayoutV1`) and its panels
 * (PLAN-session-panels-2026-10-14), never the ⏳ old slots directly.
 */
import {
	type DrawnLayout,
	drawnInstances,
	isInstanceOf,
	type PanelLayoutV1,
	type PanelV1,
	panelsOf,
	primaryPlaced,
	resolveDrawn,
	type SessionLayoutV1,
	widgetOfInstance
} from "@serene-pub/sdk"

/**
 * What a session layout DRAWS, and where, in a session box `box.inline` px
 * wide — the SDK's `resolveDrawn`: per zone, its panels in reading order,
 * each with its tabs, the tab shown, its pin and its height. The box only
 * moves a side's ladder rung; membership is the same at any width.
 */
export function drawnOf(
	layout: SessionLayoutV1,
	box: { inline: number; block?: number } = { inline: 0 }
): DrawnLayout {
	return resolveDrawn(layout, box)
}

/**
 * Every id the layout DRAWS, in reading order: the middle (above, primary,
 * below), left, right (`drawnOf`), so the floor, a genre's check and any other
 * reader agree on what "placed" means.
 */
export function drawnIdsOf(layout: SessionLayoutV1): string[] {
	return drawnInstances(drawnOf(layout)).map((i) => i.instanceId)
}

/** Every panel of a panel layout, in reading order. */
function everyPanel(p: PanelLayoutV1): PanelV1[] {
	return [
		...(p.middle.above ?? []),
		p.middle.primary,
		...(p.middle.below ?? []),
		...(p.left ?? []),
		...(p.right ?? [])
	].filter((x): x is PanelV1 => !!x)
}

/** A key no panel of the layout uses: `p` + the next counter. */
function freshKey(p: PanelLayoutV1): string {
	let n = 0
	for (const panel of everyPanel(p)) {
		const m = /^p(\d+)$/.exec(panel.key ?? "")
		if (m) n = Math.max(n, Number(m[1]))
	}
	return `p${n + 1}`
}

/**
 * The panels with the primary floor applied: returned BY REFERENCE when an
 * instance of `primaryId` is drawn anywhere, else with the bare primary as
 * the middle's primary panel. The primary panel that was there — when it
 * draws anything — becomes the last panel above it, sized to `fit`, so
 * nothing the layout placed is lost and the log gets the fill.
 *
 * For a CONVERTED blob only (`readStoredLayout`) — never over stored
 * `panels` or the editor's working copy (R-B, no lock).
 */
export function withPrimaryFloor(
	panels: PanelLayoutV1,
	primaryId: string
): PanelLayoutV1 {
	if (primaryPlaced({ panels }, primaryId)) return panels
	// The old primary's tabs, less any instance of the primary itself: one
	// that is not drawn is the converter's floor (`panelsFromSlots` puts the
	// conversation there when a layout places none), never a second copy.
	const { pinned: _pinned, ...old } = panels.middle.primary ?? { key: "", tabs: [] }
	const moved: PanelV1 = {
		...old,
		tabs: (old.tabs ?? []).filter((id) => !isInstanceOf(id, primaryId))
	}
	const kept =
		drawnOf({
			panels: {
				version: 1,
				left: [],
				right: [],
				middle: { above: [], below: [], primary: moved }
			}
		}).middle.primary.tabs.length > 0
	return {
		...panels,
		middle: {
			...panels.middle,
			above: [
				...(panels.middle.above ?? []),
				...(kept ? [{ ...moved, height: "fit" as const }] : [])
			],
			primary: { key: freshKey(panels), tabs: [primaryId] }
		}
	}
}

/** Does the blob store `panels` a reader can walk (the SDK's own test)? */
function storesPanels(blob: SessionLayoutV1): boolean {
	const p = blob.panels as Partial<PanelLayoutV1> | undefined
	return (
		!!p &&
		typeof p === "object" &&
		p.version === 1 &&
		!!p.middle &&
		typeof p.middle === "object" &&
		!!p.middle.primary &&
		typeof p.middle.primary === "object"
	)
}

/**
 * A STORED session layout — a preset's `layout`, a genre's shipped one, any
 * blob this build did not write — read the way the page reads its own: its
 * panels (`panelsOf`: the stored `panels`, else the ⏳ old slots converted)
 * and the tabs of an `omit`ted widget dropped. So `drawnOf` of it is what
 * applying that layout would draw. Anything that is not an object reads as a
 * layout that saved nothing.
 *
 * Stored `panels` are read as stored — no floor (R-B): a layout with no
 * conversation draws what it holds. Only a converted blob gets the floor,
 * for this genre's primary (`withPrimaryFloor`) in place of the converter's
 * conversation; and a stored layout whose whole middle the genre's `omit`
 * emptied gets the genre's primary as its primary panel.
 */
export function readStoredLayout(
	layout: unknown,
	primaryId = "messages",
	omit: ReadonlySet<string> = new Set()
): SessionLayoutV1 {
	const blob: SessionLayoutV1 =
		layout && typeof layout === "object" && !Array.isArray(layout)
			? (layout as SessionLayoutV1)
			: {}
	const stored = storesPanels(blob)
	let panels = panelsOf(blob, { primaryWidgetIds: [primaryId] })
	// The converter's own floor (`panelsFromSlots` puts the bare conversation
	// in the middle of a layout that places none) is not the layout's: this
	// floor, for this genre's primary, stands in for it.
	if (!stored && drawnOf(blob).middle.primary.floor)
		panels = {
			...panels,
			middle: { ...panels.middle, primary: { ...panels.middle.primary, tabs: [] } }
		}
	let omittedMiddle = false
	if (omit.size) {
		const keep = (p: PanelV1): PanelV1 => ({
			...p,
			tabs: (p.tabs ?? []).filter((id) => !omit.has(widgetOfInstance(id)))
		})
		const list = (l: PanelV1[] | undefined) =>
			(l ?? []).map(keep).filter((p) => p.tabs.length > 0)
		const before = middleTabs(panels)
		panels = {
			...panels,
			left: list(panels.left),
			right: list(panels.right),
			middle: {
				above: list(panels.middle.above),
				primary: keep(panels.middle.primary),
				below: list(panels.middle.below)
			}
		}
		omittedMiddle = before > 0 && middleTabs(panels) === 0
	}
	return {
		panels: !stored || omittedMiddle ? withPrimaryFloor(panels, primaryId) : panels,
		...(blob.widgetSettings ? { widgetSettings: blob.widgetSettings } : {}),
		...(blob.widgetStyles ? { widgetStyles: blob.widgetStyles } : {})
	}
}

/** How many tabs the middle's panels hold, all three places. */
function middleTabs(p: PanelLayoutV1): number {
	return [...(p.middle.above ?? []), p.middle.primary, ...(p.middle.below ?? [])]
		.filter((x): x is PanelV1 => !!x)
		.reduce((n, x) => n + (x.tabs?.length ?? 0), 0)
}

/** The placed instances of `primaryId` — the bare id and every `#name` copy. */
export function primaryInstances(
	placed: Iterable<string>,
	primaryId: string
): string[] {
	return [...placed].filter((id) => isInstanceOf(id, primaryId))
}


/** The middle's three places, as any reader holds them. */
export interface MiddlePlaces<P extends { tabs: readonly unknown[] }> {
	above: readonly P[]
	primary: P
	below: readonly P[]
}

/**
 * The middle as the LIVE view draws it (R-B; the primary is a place): when
 * the primary panel draws nothing — its widget uninstalled, withheld by the
 * genre, or every tab undrawable here — the nearest middle panel takes its
 * place (the last above, else the first below), the same panel the editor
 * promotes when the primary leaves. Never written: the stored layout is the
 * person's. With nothing in the middle at all it is returned as it is; the
 * page then draws the sides and the stage moves to the first drawn panel
 * (./placementRules `stageOf`).
 */
export function withPrimaryFilled<P extends { tabs: readonly unknown[] }>(
	m: MiddlePlaces<P>
): MiddlePlaces<P> {
	if (m.primary.tabs.length > 0) return m
	if (m.above.length > 0)
		return {
			above: m.above.slice(0, -1),
			primary: m.above[m.above.length - 1],
			below: m.below
		}
	if (m.below.length > 0)
		return { above: m.above, primary: m.below[0], below: m.below.slice(1) }
	return m
}
