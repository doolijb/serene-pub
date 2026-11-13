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
	panelsV2Of,
	widgetOfInstance,
	type PanelLayoutV1,
	type SessionLayoutV1
} from "@serene-pub/sdk"

type Blob = Record<string, unknown>

/** The ⏳ old slots: read only by `panelsFromSlots`, dropped at the 0.7 squash. */
export const OLD_LAYOUT_SLOTS = ["zoneLayout", "widgetGrid", "arrangedGrid"] as const

const isObj = (v: unknown): v is Blob =>
	!!v && typeof v === "object" && !Array.isArray(v)

/** A JSON value copied, so a conversion never mutates what it was handed. */
const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

/**
 * What a stored layout's arrangement is, for the version 2 conversion
 * (`PLAN-session-layout-simplify-2026-11-05` D14):
 * - `v2` — `panels` version 2: already what is written;
 * - `v1` — `panels` version 1 (with its primary): converts;
 * - `slots` — no `panels`, ⏳ old slots that place something: converts;
 * - `floor` — no `panels`, old slots whose conversion places only the
 *   floor's conversation (`panelsToWrite`'s `"floor"`): readers derive it;
 * - `none` — no `panels` and no old slot (`{}`, **Start from scratch**):
 *   readers derive the floor;
 * - `other` — anything else (a malformed `panels`, not an object): left alone.
 */
export type StoredPanelsKind = "v2" | "v1" | "slots" | "floor" | "none" | "other"

/** {@link StoredPanelsKind} of one stored layout. */
export function storedPanelsKind(layout: unknown): StoredPanelsKind {
	if (!isObj(layout)) return "other"
	const p = layout.panels
	if (p !== undefined) {
		if (isObj(p) && p.version === 2) return "v2"
		if (isObj(p) && p.version === 1 && isObj(p.middle) && isObj(p.middle.primary))
			return "v1"
		return "other"
	}
	const panels = panelsToWrite(layout)
	if (panels === null) return "none"
	return panels === "floor" ? "floor" : "slots"
}

/** The two widgets the conversation split into (2026-11-05, R8). */
const SPLIT_WIDGETS: ReadonlySet<string> = new Set(["composer", "turn-line"])

/** Drop every `composer*` / `turn-line*` entry of a per-instance map; did any go? */
function dropSplitEntries(map: Blob | undefined): boolean {
	if (!map) return false
	let dropped = false
	for (const id of Object.keys(map))
		if (SPLIT_WIDGETS.has(widgetOfInstance(id))) {
			delete map[id]
			dropped = true
		}
	return dropped
}

/**
 * A stored layout and the per-instance values kept beside it. A preset keeps
 * everything in its one blob; a session keeps its settings in
 * `widget_settings` rows (`settings`) and its style pins in
 * `layout_settings.widgetStyles` (`styles`).
 */
export interface LayoutStores {
	/** The layout blob: its arrangement and — a preset's — its own `widgetSettings` / `widgetStyles`. */
	layout: Blob
	/** Per-instance settings kept outside the blob, keyed by widget instance id. */
	settings?: Record<string, Record<string, unknown>>
	/** Style pins kept outside the blob, keyed by widget instance id. */
	styles?: Record<string, unknown>
}

/** {@link storedLayoutAsV2}'s answer: the three stores, and which of them moved. */
export interface LayoutStoresV2 extends LayoutStores {
	changed: { layout: boolean; settings: boolean; styles: boolean }
}

/**
 * ⏳ A stored layout brought to panels version 2 with nothing lost — the ONE
 * application of the SDK's `panelsV2Of` to stored values, shared by the boot
 * pass, the copy into a session, the export and the server's writes.
 * Pure; never mutates its input; a second call on its answer changes nothing.
 *
 * - `v1` / `slots` ({@link storedPanelsKind}): `layout.panels` becomes the
 *   version 2 panels (the ⏳ old slots stay, inert). With `dropStale`, every
 *   `composer*` / `turn-line*` entry in any store goes FIRST: a layout that
 *   could not place either widget holds only slot-era leftovers for them,
 *   and this is the one write that turns it into a layout that can.
 * - `floor` / `none`: readers derive the floor, so the arrangement is not
 *   written; only the settings moves and style copies apply (nothing is
 *   dropped as stale: a derived composer's values are real).
 * - `v2` / `other`: returned as it is.
 *
 * `panelsV2Of` layers the outer stores over the blob's own, per instance; each
 * settings move is applied to EVERY store that holds that key, from that
 * store's own value, so the layering reads the same after. A style copy goes
 * to the store that holds the source pin (the outer one first). An outer
 * settings entry left empty goes (a `widget_settings` row is never `{}`); a
 * blob entry left empty stays (in a preset, `{}` says "at its defaults").
 */
export function storedLayoutAsV2(
	stores: LayoutStores,
	opts: { dropStale?: boolean } = {}
): LayoutStoresV2 {
	const kind = storedPanelsKind(stores.layout)
	const writesPanels = kind === "v1" || kind === "slots"
	const unchanged: LayoutStoresV2 = {
		...stores,
		changed: { layout: false, settings: false, styles: false }
	}
	if (!writesPanels && kind !== "floor" && kind !== "none") return unchanged

	const layout = copy(stores.layout)
	const settings = copy(stores.settings)
	const styles = copy(stores.styles)
	const blobSettings = isObj(layout.widgetSettings) ? layout.widgetSettings : undefined
	const blobStyles = isObj(layout.widgetStyles) ? layout.widgetStyles : undefined
	const changed = { layout: false, settings: false, styles: false }
	if (writesPanels && opts.dropStale) {
		if (dropSplitEntries(blobSettings)) changed.layout = true
		if (dropSplitEntries(blobStyles)) changed.layout = true
		if (dropSplitEntries(settings)) changed.settings = true
		if (dropSplitEntries(styles)) changed.styles = true
	}

	const conversion = panelsV2Of(layout as SessionLayoutV1, {
		widgetSettings: settings,
		widgetStyles: styles
	})
	if (
		!writesPanels &&
		!conversion.settingsMoves.length &&
		!conversion.styleCopies.length
	)
		return unchanged

	const stores2: Array<[Blob | undefined, "layout" | "settings"]> = [
		[blobSettings, "layout"],
		[settings, "settings"]
	]
	for (const move of conversion.settingsMoves) {
		const from = "drop" in move ? move.drop : move.from
		for (const [store, which] of stores2) {
			const values = store?.[from]
			if (!store || !isObj(values) || !Object.hasOwn(values, move.key)) continue
			const value = values[move.key]
			delete values[move.key]
			changed[which] = true
			if ("to" in move) {
				const target = isObj(store[move.to]) ? (store[move.to] as Blob) : {}
				target[move.key] = value
				store[move.to] = target
			}
		}
	}
	if (settings)
		for (const [id, values] of Object.entries(settings))
			if (!isObj(values) || !Object.keys(values).length) {
				delete settings[id]
				changed.settings = true
			}

	for (const { from, to } of conversion.styleCopies) {
		if (styles && styles[from] != null) {
			styles[to] = copy(styles[from])
			changed.styles = true
		} else if (blobStyles && blobStyles[from] != null) {
			blobStyles[to] = copy(blobStyles[from])
			changed.layout = true
		}
	}

	if (writesPanels) {
		layout.panels = conversion.panels
		changed.layout = true
	}
	return { layout, settings, styles, changed }
}

/**
 * A session layout preset's blob — arrangement, `widgetSettings` and
 * `widgetStyles` in one — at panels version 2 ({@link storedLayoutAsV2},
 * stale split entries dropped). What a copy into a session and an export read.
 * A blob the converter cannot read is returned as it is (logged): the copy
 * and the export carry it verbatim, as they did before version 2.
 */
export function presetLayoutAsV2(layout: Blob): Blob {
	try {
		return storedLayoutAsV2({ layout }, { dropStale: true }).layout
	} catch (err) {
		console.warn("session layout: could not read a layout as panels version 2; kept as it is:", err)
		return layout
	}
}

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
 * A session layout as an EXPORTED package ships it: `panels` version 2 only
 * (an export is new, so it carries no ⏳ old slot and no version 1), its
 * `widgetSettings` and `widgetStyles` split the way the conversion splits
 * them (`presetLayoutAsV2`), everything else kept. A layout that would
 * convert to the floor alone keeps its old slots — dropping them would lose
 * its side panels, and readers convert it on the fly (`panelsOf`).
 */
export function exportedSessionLayout(layout: unknown): unknown {
	if (!isObj(layout)) return layout
	const kind = storedPanelsKind(layout)
	const v2 = presetLayoutAsV2(layout)
	if (kind === "floor") return v2
	const out: Blob = {}
	for (const [k, v] of Object.entries(v2))
		if (!(OLD_LAYOUT_SLOTS as readonly string[]).includes(k)) out[k] = v
	if (out.panels !== undefined) return { panels: out.panels, ...out }
	return out
}
