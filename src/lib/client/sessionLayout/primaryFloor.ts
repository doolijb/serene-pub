/**
 * The **primary floor** — only a CONVERTER's rule (owner review 2026-10-14,
 * R-B: no lock at all), now over panels v2 (PLAN 2026-11-05: three flat
 * stacks, no primary panel).
 *
 * A layout stored as `panels` is read exactly as stored: it may hold no
 * conversation at all, and any panel may hold any widget (a map, stats, a
 * plugin's). Reset to genre default layout is the way back; nothing here puts
 * the conversation back behind the person's back.
 *
 * The floor survives in one place: a blob with NO valid `panels` (only the ⏳
 * old slots, or nothing) is converted by the SDK (`panelsOf`), which puts the
 * bare conversation (and its Composer / Turn line) in the middle when the old
 * slots placed none, marking those panels `floor`. `readStoredLayout` swaps
 * that converter's conversation for this genre's primary (`withPrimaryFloor`)
 * when the genre's primary is not Messages — an R71 genre's board, say. And
 * when a genre that withholds a widget empties the WHOLE middle of a stored
 * layout by omitting it (the genre did that, not the person), its primary
 * takes the middle.
 *
 * "Placed" means DRAWN, never merely named: what is drawn is the SDK's one
 * reading of a layout (`resolveDrawn` over `panelsOf`, `drawnOf` here) — a
 * retired widget's tab draws nothing.
 *
 * Pure: it reads a session layout (`SessionLayoutV1`) and its panels, never
 * the ⏳ old slots directly.
 */
import {
	type DrawnLayout,
	drawnInstances,
	isInstanceOf,
	type PanelLayoutV2,
	type PanelV2,
	panelsOf,
	primaryPlaced,
	type ResolveDrawnOptions,
	resolveDrawn,
	type SessionLayoutV1,
	widgetOfInstance
} from "@serene-pub/sdk"
import { conversationKindOf } from "./conversationTarget"

/**
 * What a session layout DRAWS, and where, in a session box `box.inline` px
 * wide — the SDK's `resolveDrawn`: per zone, its panels in reading order,
 * each with its tabs, the tab shown, its height and priority, and the
 * layout's look. `opts.widgets` supplies the declared defaults.
 */
export function drawnOf(
	layout: SessionLayoutV1,
	box: { inline: number; block?: number } = { inline: 0 },
	opts?: ResolveDrawnOptions
): DrawnLayout {
	return resolveDrawn(layout, box, opts)
}

/**
 * Every id the layout DRAWS, in reading order: the middle, left, right
 * (`drawnOf`), so the floor, a genre's check and any other reader agree on
 * what "placed" means.
 */
export function drawnIdsOf(layout: SessionLayoutV1): string[] {
	return drawnInstances(drawnOf(layout)).map((i) => i.instanceId)
}

/** Every panel of a panel layout, in reading order. */
function everyPanel(p: PanelLayoutV2): PanelV2[] {
	return [...p.middle, ...p.left, ...p.right]
}

/** A key no panel of the layout uses: `p` + the next counter. */
function freshKey(p: PanelLayoutV2): string {
	let n = 0
	for (const panel of everyPanel(p)) {
		const m = /^p(\d+)$/.exec(panel.key ?? "")
		if (m) n = Math.max(n, Number(m[1]))
	}
	return `p${n + 1}`
}

/**
 * The panels with the primary floor applied: returned BY REFERENCE when an
 * instance of `primaryId` is drawn anywhere, else with the bare primary as a
 * new first panel of the middle — nothing the layout placed is lost.
 *
 * For a CONVERTED blob only (`readStoredLayout`) — never over stored
 * `panels` or the editor's working copy (R-B, no lock).
 */
export function withPrimaryFloor(
	panels: PanelLayoutV2,
	primaryId: string
): PanelLayoutV2 {
	if (primaryPlaced({ panels }, primaryId)) return panels
	return {
		...panels,
		middle: [{ key: freshKey(panels), tabs: [primaryId] }, ...panels.middle]
	}
}

/** Does the blob store `panels` a reader can walk (the SDK's own test)? */
function storesPanels(blob: SessionLayoutV1): boolean {
	const p = blob.panels as
		| { version?: unknown; middle?: unknown; left?: unknown; right?: unknown }
		| undefined
	if (!p || typeof p !== "object") return false
	if (p.version === 2)
		return (
			Array.isArray(p.left) && Array.isArray(p.middle) && Array.isArray(p.right)
		)
	const m = p.middle as { primary?: unknown } | undefined
	return (
		p.version === 1 &&
		!!m &&
		typeof m === "object" &&
		!!m.primary &&
		typeof m.primary === "object"
	)
}

/**
 * A STORED session layout — a preset's `layout`, a genre's shipped one, any
 * blob this build did not write — read the way the page reads its own: its
 * panels (`panelsOf`: the stored `panels` of version 1 or 2, else the ⏳ old
 * slots converted) as panels v2, and the tabs of an `omit`ted widget dropped.
 * So `drawnOf` of it is what applying that layout would draw. Anything that
 * is not an object reads as a layout that saved nothing.
 *
 * A genre that withholds Messages (`omit` holds `messages`) has no log, so a
 * Composer and a Turn line — which write to and speak about it — go too.
 *
 * Stored `panels` are read as stored — no floor (R-B): a layout with no
 * conversation draws what it holds. Only a converted blob gets the floor,
 * for this genre's primary (`withPrimaryFloor`) in place of the converter's
 * conversation when that primary is not Messages; and a stored layout whose
 * whole middle the genre's `omit` emptied gets the genre's primary.
 */
export function readStoredLayout(
	layout: unknown,
	primaryId = "messages",
	omit: ReadonlySet<string> = new Set()
): Pick<SessionLayoutV1, "widgetSettings" | "widgetStyles"> & {
	panels: PanelLayoutV2
} {
	const blob: SessionLayoutV1 =
		layout && typeof layout === "object" && !Array.isArray(layout)
			? (layout as SessionLayoutV1)
			: {}
	const stored = storesPanels(blob)
	let panels = panelsOf(blob, { primaryWidgetIds: [primaryId] })
	// The converter's own floor (a conversation, with its Composer and Turn
	// line, when the old slots placed none) is the genre's own Messages only
	// when its primary is Messages; any other primary's floor replaces it.
	if (!stored && primaryId !== "messages") {
		const drawn = drawnOf(blob)
		const floorKeys = new Set(
			[...drawn.middle.panels, ...drawn.left.panels, ...drawn.right.panels]
				.filter((p) => p.floor)
				.map((p) => p.key)
		)
		if (floorKeys.size) {
			const keep = (list: PanelV2[]) =>
				list.filter(
					(p) =>
						!(
							floorKeys.has(p.key) &&
							p.tabs.every((id) => conversationKindOf(id) !== null)
						)
				)
			panels = {
				...panels,
				left: keep(panels.left),
				middle: keep(panels.middle),
				right: keep(panels.right)
			}
		}
	}
	let omittedMiddle = false
	if (omit.size) {
		const dropLog = omit.has("messages")
		const list = (l: PanelV2[]) =>
			l
				.map((p) => {
					const tabs = p.tabs.filter(
						(id) =>
							!omit.has(widgetOfInstance(id)) &&
							!(
								dropLog &&
								(isInstanceOf(id, "composer") || isInstanceOf(id, "turn-line"))
							)
					)
					return tabs.length === p.tabs.length ? p : { ...p, tabs }
				})
				.filter((p) => p.tabs.length > 0)
		const before = panels.middle.reduce((n, p) => n + p.tabs.length, 0)
		panels = {
			...panels,
			left: list(panels.left),
			middle: list(panels.middle),
			right: list(panels.right)
		}
		omittedMiddle = before > 0 && panels.middle.length === 0
	}
	return {
		panels: !stored || omittedMiddle ? withPrimaryFloor(panels, primaryId) : panels,
		...(blob.widgetSettings ? { widgetSettings: blob.widgetSettings } : {}),
		...(blob.widgetStyles ? { widgetStyles: blob.widgetStyles } : {})
	}
}

/** The placed instances of `primaryId` — the bare id and every `#name` copy. */
export function primaryInstances(
	placed: Iterable<string>,
	primaryId: string
): string[] {
	return [...placed].filter((id) => isInstanceOf(id, primaryId))
}
