/**
 * ⏳ TRANSITIONAL — pure helpers over a STORED session layout that may still
 * hold only the old slots (`zoneLayout`, `widgetGrid`, `arrangedGrid`). The
 * boot pass (`./sessionLayoutPanels`) and the package export
 * (`plugins/exportPackage`, `plugins/exportScaffold`) share them. Delete at
 * the 0.7 squash with `panelsFromSlots` and the old slots.
 */
import {
	layoutWidgetIds,
	panelsFromSlots,
	type PanelLayoutV1,
	type SessionLayoutV1
} from "@serene-pub/sdk"

type Blob = Record<string, unknown>

/** The ⏳ old slots: read only by `panelsFromSlots`, dropped at the 0.7 squash. */
export const OLD_LAYOUT_SLOTS = ["zoneLayout", "widgetGrid", "arrangedGrid"] as const

const isObj = (v: unknown): v is Blob =>
	!!v && typeof v === "object" && !Array.isArray(v)

/**
 * The `panels` a stored layout should gain: `null` when it is left alone (it
 * has `panels` already, or holds no old slot — `{}` places nothing and the
 * page draws its floor), `"floor"` when its conversion would place only the
 * floor's conversation (no `messages` anywhere and nothing in the middle:
 * stored `panels` always name a primary, which would turn the floor — the
 * genre's primary, whatever it is — into a placed `messages`), else the
 * converted panels.
 */
export function panelsToWrite(layout: unknown): PanelLayoutV1 | null | "floor" {
	if (!isObj(layout) || layout.panels !== undefined) return null
	if (!OLD_LAYOUT_SLOTS.some((s) => layout[s] !== undefined)) return null
	const doc = layout as SessionLayoutV1
	const panels = panelsFromSlots(doc)
	const tabs = panels.middle.primary.tabs
	const floorOnly =
		tabs.length === 1 &&
		tabs[0] === "messages" &&
		!layoutWidgetIds(doc).includes("messages")
	return floorOnly ? "floor" : panels
}

/**
 * A session layout as an EXPORTED package ships it: `panels` only (an export
 * is new, so it carries no ⏳ old slot), everything else kept. A layout that
 * would convert to the floor alone keeps its old slots — dropping them would
 * lose its side panels, and readers convert it on the fly (`panelsOf`).
 */
export function exportedSessionLayout(layout: unknown): unknown {
	if (!isObj(layout)) return layout
	const panels = panelsToWrite(layout)
	if (panels === "floor") return layout
	const out: Blob = {}
	for (const [k, v] of Object.entries(layout))
		if (!(OLD_LAYOUT_SLOTS as readonly string[]).includes(k)) out[k] = v
	if (panels) return { panels, ...out }
	return out
}
