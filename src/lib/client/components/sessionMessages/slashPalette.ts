/**
 * The `/` palette's logic, apart from its markup (plans/29 R-15 *slash
 * name*; F38; plans/30 U5c).
 *
 * Typing `/` at the start of an empty draft opens a list of the composer's
 * actions — the composer venue's and the extra tab's, since both are the
 * composer's own — by slash name and label; the rest of the draft filters
 * it; Enter invokes the highlighted one, or the exact match when the palette
 * is closed; Escape closes it until the draft changes. Slash names are
 * stable ASCII ids and never localised (R-20): the palette shows the
 * localised label beside each.
 *
 * Pure, so it is tested without a DOM: the component owns the textarea and
 * the popover, this owns what they show.
 */

import { enablementVerdict, i18nText, type EnabledWhen } from "@serene-pub/sdk"
import { CORE_ACTION_SPEC } from "$lib/shared/actions/identity"
import type { ItemValues } from "$lib/shared/actions/itemValues"
import { statusText } from "./text"
import { notYoursToUse, VERB_REASONS } from "./messageVerbState"

export interface PaletteAction {
	/** With `specSlug`, the action's identity — the one key (plans/31 V2). */
	key: string
	specSlug: string
	name: string
	slash: string
	icon?: string
	/** Who may act, off the list — what the audience's sentence names when `canAct` is false. */
	audience: { act: string[] }
	canAct: boolean
	isNew: boolean
	venue: string
	/**
	 * The enabled-when verdict off the list (U5e): every predicate the
	 * server evaluated over the session's published values holds. Absent
	 * (an older server) reads as enabled.
	 */
	enabled?: boolean
	/** Why it is grey when `enabled` is false — already resolved to a sentence. */
	reason?: string
	/**
	 * The `item.*` predicates the server could not judge without a message
	 * (U5e). An **extra**-venue row acts on the newest row — `/retry`,
	 * `/continue` — so they are judged here against it, and a session with
	 * no row at all fails them: nothing to regenerate. A composer row's
	 * press names no row, and is judged against none.
	 */
	itemPredicates?: EnabledWhen[]
}

/** The draft as a slash query: `/nar` → `nar`; anything else → null. */
export function slashQueryOf(draft: string): string | null {
	const m = /^\/([^\s]*)$/.exec(draft)
	return m ? m[1]! : null
}

/**
 * One row per slash name. One declaration listed under several venues —
 * the chips row and the extra tab — is one action and one row; the first
 * occurrence keeps its place in the order. Two declarations under one name
 * cannot reach a session: one slash name means one action (R-15; plans/31
 * V2), refused at publish. Were a stale listing to carry two, core's verb
 * holds the name (S1) and otherwise the first declaration does.
 */
export function dedupePaletteActions(
	actions: ReadonlyArray<PaletteAction>
): PaletteAction[] {
	const rows = new Map<string, PaletteAction>()
	for (const a of actions) {
		const held = rows.get(a.slash)
		if (!held) {
			rows.set(a.slash, a)
			continue
		}
		if (held.specSlug !== CORE_ACTION_SPEC && a.specSlug === CORE_ACTION_SPEC)
			rows.set(a.slash, a)
	}
	return [...rows.values()]
}

/**
 * The palette's rows for a query: slash names starting with it first, then
 * labels containing it, one row per slash name (`dedupePaletteActions`).
 * An empty query lists everything.
 */
export function filterPaletteActions(
	actions: ReadonlyArray<PaletteAction>,
	query: string
): PaletteAction[] {
	const q = query.trim().toLowerCase()
	const unique = dedupePaletteActions(actions)
	if (!q) return unique
	const byName = unique.filter((a) => a.slash.toLowerCase().startsWith(q))
	const byLabel = unique.filter(
		(a) =>
			!a.slash.toLowerCase().startsWith(q) &&
			(a.name.toLowerCase().includes(q) ||
				a.slash.toLowerCase().includes(q))
	)
	return [...byName, ...byLabel]
}

/** The one row a whole slash name names, if the draft is exactly it — the deduped row. */
export function exactPaletteMatch(
	actions: ReadonlyArray<PaletteAction>,
	draft: string
): PaletteAction | undefined {
	const q = slashQueryOf(draft)
	if (!q) return undefined
	return dedupePaletteActions(actions).find(
		(a) => a.slash.toLowerCase() === q.toLowerCase()
	)
}

/**
 * Whether one palette row may be run now, and why not: the audience first
 * (`canAct`, off the list), then the declared **enabled-when** verdict the
 * list carries (`enabled` / `reason`, U5e — *Set a location first*), then
 * the session's state — nothing runs while a reply streams, as the chips
 * and the **More** menu already refuse (U5c review, S5). One reading for
 * the row's `aria-disabled`, its note and the Enter/click guard, so the
 * palette cannot say one thing and do another; the chips and the More
 * menu read it too.
 */
export function paletteRowState(
	a: Pick<PaletteAction, "name" | "audience" | "canAct" | "enabled" | "reason" | "itemPredicates"> & {
		venue?: string
	},
	opts: {
		generating: boolean
		/**
		 * The newest row's `item` document, or `null` for a session with no
		 * row — what an **extra**-venue press (Regenerate, Continue, and
		 * their palette rows) acts on. A composer-venue press names no row
		 * and is judged against none, as the door judges it (W4). Absent
		 * means the caller has no row to offer and the item predicates are
		 * left unjudged (a surface that lists no such action).
		 */
		newest?: ItemValues | null
	}
): { disabled: boolean; reason?: string } {
	if (!a.canAct)
		return { disabled: true, reason: notYoursToUse({ name: a.name, act: a.audience.act }) }
	if (a.enabled === false)
		return { disabled: true, ...(a.reason ? { reason: a.reason } : {}) }
	if (a.itemPredicates?.length && opts.newest !== undefined) {
		// No row reads as every `item.*` value absent, so the first item
		// predicate — the newest-row rule, for core's verbs — names why.
		const actsOn = a.venue === "extra" ? opts.newest : null
		const heard = enablementVerdict.judge({
			preds: a.itemPredicates,
			doc: actsOn ? { item: actsOn } : {}
		})
		if (!heard.ok)
			return {
				disabled: true,
				reason: statusText({ i18n: heard.sentence }) || (i18nText(heard.sentence) ?? "")
			}
	}
	if (opts.generating)
		return { disabled: true, reason: VERB_REASONS.generating }
	return { disabled: false }
}

/** The next highlight after an arrow key, wrapping. */
export function stepHighlight(
	current: number,
	count: number,
	delta: 1 | -1
): number {
	if (count <= 0) return -1
	if (current < 0) return delta === 1 ? 0 : count - 1
	return (current + delta + count) % count
}
