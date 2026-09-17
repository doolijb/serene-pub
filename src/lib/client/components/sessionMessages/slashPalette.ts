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

import { CORE_ACTION_SPEC } from "$lib/shared/actions/identity"
import { VERB_REASONS } from "./messageVerbState"

export interface PaletteAction {
	key: string
	function: string
	specSlug: string
	name: string
	slash: string
	icon?: string
	canAct: boolean
	isNew: boolean
	venue: string
	/**
	 * This slash name is offered by more than one declaration — two specs
	 * contributing one function under one name — and the row stands for
	 * the **name**, not for the first declaration that happened to carry
	 * it (U5c review, W-D). Such a row is fired as the legacy shape, naming
	 * no `action`, so the server's binding layer (`resolveFunctionVerdict`:
	 * the session's binding, then the preset's, then the instance's, then
	 * the companion rule) selects the spec — the one place that choice is
	 * ruled to be made. Naming the first row's identity would have run
	 * that spec and skipped every binding. Set by `dedupePaletteActions`;
	 * absent on a row that is the only one of its name.
	 */
	shared?: boolean
}

/** The draft as a slash query: `/nar` → `nar`; anything else → null. */
export function slashQueryOf(draft: string): string | null {
	const m = /^\/([^\s]*)$/.exec(draft)
	return m ? m[1]! : null
}

/**
 * One row per slash name. Two specs offering one function under one name
 * are alternatives the **binding** selects among, so the palette shows the
 * name once and marks the row `shared` — the fire then names no
 * declaration and the server selects (W-D). The first occurrence keeps
 * its place in the order; only the mark is added. A name carried by one
 * declaration is that declaration's row, unmarked.
 */
export function dedupePaletteActions(
	actions: ReadonlyArray<PaletteAction>
): PaletteAction[] {
	const rows = new Map<string, PaletteAction>()
	const identities = new Map<string, Set<string>>()
	for (const a of actions) {
		const identity = `${a.specSlug}#${a.key}`
		const seen = identities.get(a.slash)
		if (!seen) {
			rows.set(a.slash, a)
			identities.set(a.slash, new Set([identity]))
			continue
		}
		// One declaration listed under several venues is one action, not
		// an alternative.
		if (seen.has(identity)) continue
		seen.add(identity)
		// Core's verbs hold their names (S1): a verb's row is the name's,
		// never shared, whichever side of it a contributed alternative was
		// listed — a verb goes to its handler, and the fire refuses it by
		// name anyway.
		const held = rows.get(a.slash)!
		if (held.specSlug === CORE_ACTION_SPEC) continue
		if (a.specSlug === CORE_ACTION_SPEC) {
			rows.set(a.slash, a)
			continue
		}
		rows.set(a.slash, { ...held, shared: true })
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

/**
 * The one row a whole slash name names, if the draft is exactly it — the
 * deduped row, so a shared name fires legacy here too (W-D).
 */
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
 * (`canAct`, off the list), then the session's state — nothing runs while a
 * reply streams, as the chips and the **More** menu already refuse (U5c
 * review, S5). One reading for the row's `aria-disabled`, its note and the
 * Enter/click guard, so the palette cannot say one thing and do another.
 */
export function paletteRowState(
	a: Pick<PaletteAction, "canAct">,
	opts: { generating: boolean }
): { disabled: boolean; reason?: string } {
	if (!a.canAct) return { disabled: true, reason: VERB_REASONS.notYoursToUse }
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
