/**
 * Widget instances in the layout editor (brief 7b of
 * `PLAN-layout-one-format-2026-09-28`, plan §M.3): "we should be able to add
 * more than one of each kind of widget" (owner, 2026-09-29).
 *
 * A layout places a widget under its **widget instance id** — the widget id
 * for its first instance, `<widget id>#<instance name>` for a copy. Storage,
 * settings, style pins and seating already key by it; what this module holds
 * is the editor's half, pure, so it is tested without a page:
 *
 * - **the Add menu** (`trayOffers`, `trayWidgets`) offers every widget kind
 *   every time, a placed kind with its count, and turns one away only at its
 *   `WidgetDecl.maxInstances` (`capRefusal`);
 * - **minting** (`mintInstanceId`): adding widget W places the bare `W` when no
 *   instance holds it, else `W#n` — n the smallest number ≥ 2 that is neither
 *   placed nor holding stored widget settings or a style pin, so a new copy
 *   never inherits a removed copy's leftovers (there is no server prune);
 * - **Duplicate** (`duplicateValues`): QD, below.
 *
 * **QD — can a placed widget be duplicated, and does the duplicate copy its
 * settings?** ⚠ Provisional until the owner rules. Built as the plan's
 * RECOMMENDED (2): the tray, plus **Duplicate** on a placed card (the Move
 * tab's card, the rail and strip edit bars, the phone's row and the Settings
 * tab's overlay), which mints an id and copies the source's widget settings
 * and style pin VERBATIM, `channel` included — two panels on one channel are
 * allowed, because a second view of one channel never holds the page's ids
 * (`channelClaims`'s `pageIdsHolders`).
 *
 * **The flip is ONE line, {@link DUPLICATE_RULE}, for any of the three:**
 * `"copy-settings"` = (2); `"copy-size"` = (3), Duplicate stays and the copy
 * starts at its widget's defaults (the card is still seated at the source's
 * size); `"tray-only"` = (1), no Duplicate anywhere — every site asks
 * {@link duplicateOffered}, and the Settings overlay is never handed a
 * duplicator.
 */
import { instanceNameOf, widgetOfInstance } from "@serene-pub/sdk"
import type { PanelInstance } from "../surfaces/types"

/** QD's three answers (plan M.7): (1) `tray-only`, (2) `copy-settings`, (3) `copy-size`. */
export type DuplicateRule = "tray-only" | "copy-settings" | "copy-size"

/** QD, as built: the plan's recommended (2). ⚠ Provisional — flip here. */
export const DUPLICATE_RULE: DuplicateRule = "copy-settings"

/** Is **Duplicate** offered on a placed widget at all? Only (1) says no. */
export function duplicateOffered(rule: DuplicateRule = DUPLICATE_RULE): boolean {
	return rule !== "tray-only"
}

/** The placed instances of `widgetId` — its own id and every `#name` copy. */
export function instancesOf(widgetId: string, placed: Iterable<string>): string[] {
	return [...new Set(placed)].filter((id) => widgetOfInstance(id) === widgetId)
}

/**
 * The widget instance id adding `widgetId` places: the bare id when no
 * instance holds it, else `widgetId#n`, n the smallest number ≥ 2 that is not
 * `placed` and not `stored` (the ids holding widget settings or a style pin in
 * this session).
 *
 * The bare id comes back whatever it has stored: re-adding a widget brings its
 * own settings back, as it always has (plan M.3.4). Only `#n` leftovers are
 * skipped — a copy removed and a new one added must not look like the old one.
 *
 * `fresh` — a **Duplicate**'s mint — skips a stored bare id too: the copy is
 * handed the SOURCE's values, and writing them under a bare id that still holds
 * its own (the widget's first instance, removed while a copy stayed) would
 * overwrite what re-adding it brings back, with no Cancel to undo it (brief 7b
 * review). So a Duplicate only ever writes under an id that holds nothing.
 */
export function mintInstanceId(
	widgetId: string,
	placed: Iterable<string>,
	stored: Iterable<string>,
	opts: { fresh?: boolean } = {}
): string {
	const taken = new Set(placed)
	if (!opts.fresh && !taken.has(widgetId)) return widgetId
	for (const id of stored) taken.add(id)
	if (!taken.has(widgetId)) return widgetId
	for (let n = 2; ; n++) {
		const id = `${widgetId}#${n}`
		if (!taken.has(id)) return id
	}
}

/**
 * Why a widget at its cap cannot be added again, or null when it can — a
 * widget with no `maxInstances` never is turned away (no core widget sets
 * one; the owner's rule is "more than one of each").
 */
export function capRefusal(
	maxInstances: number | undefined,
	placedCount: number
): string | null {
	if (!maxInstances || placedCount < maxInstances) return null
	return maxInstances === 1 ? "Only one per layout" : `Only ${maxInstances} per layout`
}

/** A widget kind the Add menu can offer. */
export interface TrayOffer {
	id: string
	title: string
	icon?: string
	maxInstances?: number
}

/**
 * Every widget kind this session can add, in the order it is offered: the
 * conversation first (`conversation`, null when the genre withholds it), then
 * every declared widget. A declared PRIMARY is offered only where the
 * conversation is not — it is then the genre's own middle (R71, Battleship's
 * board); otherwise it is the surface manager's stand-in for the log, which
 * is no widget to add.
 */
export function trayOffers(
	decls: readonly PanelInstance[],
	conversation: TrayOffer | null
): TrayOffer[] {
	const out: TrayOffer[] = conversation ? [conversation] : []
	for (const p of decls) {
		if (p.role === "primary" && conversation) continue
		out.push({
			id: p.id,
			title: p.title,
			...(p.icon ? { icon: p.icon } : {}),
			...(p.maxInstances ? { maxInstances: p.maxInstances } : {})
		})
	}
	return out
}

/** One chip of the Add menu: a widget kind, how many are placed, and whether it may be added. */
export interface TrayWidget {
	/** The WIDGET id — what adding it mints an instance of. */
	id: string
	title: string
	icon?: string
	/** How many instances of it the layout places. */
	placed: number
	/** Why it cannot be added again (its cap), else null. */
	full: string | null
}

/** The Add menu: every offer, with its placed count and its cap's refusal. */
export function trayWidgets(
	offers: readonly TrayOffer[],
	placed: Iterable<string>
): TrayWidget[] {
	const ids = [...new Set(placed)]
	return offers.map((o) => {
		const count = instancesOf(o.id, ids).length
		return {
			id: o.id,
			title: o.title,
			...(o.icon ? { icon: o.icon } : {}),
			placed: count,
			full: capRefusal(o.maxInstances, count)
		}
	})
}

/** A chip's words: the widget, then how many are placed once any are (_Stats · 2 placed_). */
export function trayChipLabel(t: Pick<TrayWidget, "title" | "placed">): string {
	return t.placed ? `${t.title} · ${t.placed} placed` : t.title
}

/** What a Duplicate hands its new copy (QD). */
export interface DuplicateValues {
	/** The source's stored widget settings, copied; null when there are none to copy. */
	settings: Record<string, unknown> | null
	/** The source's style pin (`layoutSettings.widgetStyles`); null when it has none. */
	pin: { id: number; slug: string } | null
}

/**
 * What Duplicate copies from `sourceId` (QD, {@link DUPLICATE_RULE}): its
 * stored settings and its style pin, verbatim — `channel` included — under
 * (2); nothing under (3) or (1).
 */
export function duplicateValues(
	sourceId: string,
	settings: Readonly<Record<string, Record<string, unknown>>>,
	pins: Readonly<Record<string, { id: number; slug: string }>>,
	rule: DuplicateRule = DUPLICATE_RULE
): DuplicateValues {
	if (rule !== "copy-settings") return { settings: null, pin: null }
	const own = settings[sourceId]
	const pin = pins[sourceId]
	return {
		// A JSON copy: stored settings are JSON, and the store's are reactive
		// proxies a structured clone would refuse.
		settings: own && Object.keys(own).length ? JSON.parse(JSON.stringify(own)) : null,
		pin: pin ? { ...pin } : null
	}
}

/**
 * Titles that tell placed instances apart (brief 7b review): Duplicate copies
 * the source's settings verbatim — its `title`, and a Messages copy's
 * `channel`, which titles it — so a source and its copy would otherwise read
 * the same on the editor's cards, the phone's rows and panels menu, and as
 * their regions' names.
 *
 * `titles` is each placed instance id with the title it resolves to. Where two
 * or more share one, ONE keeps it — the widget's own bare id, else a copy with
 * a NAME (`messages#sanctum`, a shipped copy), else the lowest number — and
 * every other gets ` · <instance name>` (_Sanctum · 2_). Chosen by id, never by
 * position, so moving a card never swaps two names. Answers only the ids whose
 * title changes.
 */
export function distinctTitles(
	titles: Iterable<readonly [string, string]>
): Map<string, string> {
	const byTitle = new Map<string, string[]>()
	for (const [id, title] of titles) {
		const ids = byTitle.get(title)
		if (ids) ids.push(id)
		else byTitle.set(title, [id])
	}
	const out = new Map<string, string>()
	for (const [title, ids] of byTitle) {
		if (ids.length < 2) continue
		const [, ...others] = [...ids].sort(
			(a, b) => keepRank(a) - keepRank(b) || numberOf(a) - numberOf(b) || (a < b ? -1 : a > b ? 1 : 0)
		)
		for (const id of others) {
			const name = instanceNameOf(id)
			if (name) out.set(id, `${title} · ${name}`)
		}
	}
	return out
}

/** Who keeps a shared title: the bare id (0), a named copy (1), a numbered copy (2). */
function keepRank(id: string): number {
	const name = instanceNameOf(id)
	if (!name) return 0
	return /^\d+$/.test(name) ? 2 : 1
}

/** A numbered copy's number, for the order among them; 0 otherwise. */
function numberOf(id: string): number {
	const name = instanceNameOf(id)
	return name && /^\d+$/.test(name) ? Number(name) : 0
}
