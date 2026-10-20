/**
 * 🚧 **A dot on a tab with news** (PLAN-dc-after-walk2 Q3-3, the walk's #25:
 * a secret, a death's *Make a new character*, a question landed on the
 * Planner tab and nothing said so while the Story was the tab shown).
 *
 * A conversation copy's tab claims a channel (its `channel` setting,
 * `claimOf`); it carries a dot while it is not the tab shown in its panel
 * and its channel holds a line somebody else wrote after the newest one the
 * tab was last shown with. What a tab has been shown with is this page's
 * own memory (`seen`): a tab first seen already holding lines starts with
 * them read, so history is never news.
 *
 * Kept apart from the renderer (additive, `SessionLayoutRender` owns the
 * mount): `observe` runs from an `$effect` — it writes — and `dots` is a pure
 * read for the template.
 */
import { untrack } from "svelte"
import { SvelteMap } from "svelte/reactivity"
import { parseChannel, type DrawnLayout, type DrawnPanel } from "@serene-pub/sdk"
import { claimOf } from "./channelClaims"

type Row = {
	id: number
	channel?: string | null
	userId?: number | null
	/** Whose line it is: only a `user` row of the viewer's is their own (below). */
	role?: string | null
	isHidden?: boolean | null
	isGenerating?: boolean | null
}

/** What a tab shows: its channel's slug, and the one lane of it when it reads one. */
type Shown = { slug: string; lane: number | null }

/**
 * The newest line on what `shown` shows — the slug's every lane, or its one
 * lane (a bare slug is lane 1) — that somebody other than `viewerId` wrote,
 * or 0.
 *
 * 🚧 A row is the viewer's own only when it is a person's line (`role:
 * 'user'`, or no role said) under their id (PLAN-dc-after-walk3 R1-1, the
 * walk's NEW-3): the Planner's and the table's rows carry the id of the
 * person whose run wrote them, so a guest's Planner lane — every line of it
 * written by a run the guest started — and the owner's goal question and
 * death's *Make a new character* read as the viewer's own, and never dotted.
 */
function newestNews(rows: readonly Row[], shown: Shown, viewerId: number | null): number {
	let newest = 0
	for (const m of rows) {
		if (m.isHidden || m.isGenerating) continue
		const at = parseChannel(m.channel ?? "main")
		if (at.slug !== shown.slug) continue
		if (shown.lane !== null && (at.lane ?? 1) !== shown.lane) continue
		if (viewerId != null && m.userId === viewerId && (m.role ?? "user") === "user") continue
		if (m.id > newest) newest = m.id
	}
	return newest
}

/** The tab a panel shows: its `open`, else its first (as `PanelTabs` draws it). */
const shownOf = (p: DrawnPanel): string =>
	p.tabs.some((t) => t.instanceId === p.open) ? (p.open as string) : (p.tabs[0]?.instanceId ?? "")

/**
 * `storedOf` answers a tab's stored settings (`widgetSettingValues`);
 * `laneOf`, the one lane a copy shows this viewer when it reads one
 * (`laneClaimOf`) — a Planner tab on a personal channel counts its own lane,
 * never the others' an owner also receives.
 */
export function createTabAttention(
	storedOf: (instanceId: string) => unknown,
	laneOf: (instanceId: string) => string | undefined = () => undefined
) {
	const seen = new SvelteMap<string, number>()
	const claimed = (tabId: string): Shown | null => {
		const channel = claimOf(storedOf(tabId))
		if (!channel) return null
		const slug = parseChannel(channel).slug
		const lane = laneOf(tabId)
		if (!lane) return { slug, lane: null }
		const ref = parseChannel(lane)
		// A lane this view has none of yet (`NO_LANE_CHANNEL`): nothing is news.
		return ref.slug === slug ? { slug, lane: ref.lane ?? 1 } : { slug, lane: -1 }
	}
	const panelsOf = (drawn: DrawnLayout | null | undefined): DrawnPanel[] =>
		drawn ? [...drawn.left.panels, ...drawn.middle.panels, ...drawn.right.panels] : []
	return {
		/** Record what each tab is shown with, and a tab's first look. Writes: call from an `$effect`. */
		observe(drawn: DrawnLayout | null | undefined, rows: readonly Row[], viewerId: number | null) {
			for (const p of panelsOf(drawn)) {
				const open = shownOf(p)
				for (const t of p.tabs) {
					const what = claimed(t.instanceId)
					if (!what) continue
					const newest = newestNews(rows, what, viewerId)
					// What it writes it never reads tracked: the effect reruns on
					// the rows and the layout, never on its own marks.
					untrack(() => {
						if (open === t.instanceId || !seen.has(t.instanceId)) {
							if (seen.get(t.instanceId) !== newest) seen.set(t.instanceId, newest)
						}
					})
				}
			}
		},
		/** The tabs of `panel` that carry a dot. A pure read. */
		dots(panel: DrawnPanel, rows: readonly Row[], viewerId: number | null): Set<string> {
			const out = new Set<string>()
			const open = shownOf(panel)
			for (const t of panel.tabs) {
				if (t.instanceId === open) continue
				const what = claimed(t.instanceId)
				if (!what) continue
				const last = seen.get(t.instanceId)
				if (last !== undefined && newestNews(rows, what, viewerId) > last) out.add(t.instanceId)
			}
			return out
		}
	}
}
