/**
 * The room rule — `core:task/rank-hybrid@1`'s `shownElsewhere` in-port
 * (lorebooks plan, A28's leftover, built 2026-10-02).
 *
 * Adventure and the Lair show the room the party stand in under its own
 * slot (`{{locationEntry}}`, `locationVariables`), and the same entry also
 * ranked in as world lore, so a prompt read the room twice and paid for it
 * twice. The spec wires the entry ids a slot shows; a lore candidate with one
 * of them is marked `ineligible` with the sentence below, which `select`
 * turns into an `excluded_ineligible` decision: never ranked, never counted
 * toward a minimum, no budget spent.
 *
 * ⚠ Not one of `core:task/eligibility@1`'s rules (`eligibility.ts`): those
 * are verdicts about whether lore may reach this speaker at all. This is a
 * fact about the prompt being built, so it lives on the ranker that builds
 * the selection for that prompt.
 *
 * ⚠ Lore sources only, in either spelling (the vector index says
 * `historyEntry` where the lanes say `history`): a message or a relationship
 * can share a number with an entry and is never the room.
 */

/** The sources whose candidate `id` is a `lorebook_entries` id. */
const ENTRY_SOURCES = new Set([
	"worldLore",
	"characterLore",
	"history",
	"historyEntry"
])

export const SHOWN_ELSEWHERE_REASON = "Already in the prompt in a slot of its own."

/** Entry ids off the port: one id, or a (nested) list; anything else skipped. */
export function shownEntryIds(raw: unknown): Set<number> {
	const out = new Set<number>()
	const visit = (v: unknown) => {
		if (Array.isArray(v)) for (const item of v) visit(item)
		else if (typeof v === "number" && Number.isInteger(v)) out.add(v)
	}
	visit(raw)
	return out
}

/**
 * The same candidates, in order, with `ineligible` set on each lore entry the
 * prompt already shows. One that arrived ineligible keeps its own reason.
 */
export function markShownElsewhere<
	T extends { id?: unknown; source?: unknown; ineligible?: unknown }
>(items: readonly T[], raw: unknown): { items: T[]; marked: number } {
	const shown = shownEntryIds(raw)
	if (!shown.size) return { items: [...items], marked: 0 }
	let marked = 0
	const out = items.map((c) => {
		if (c.ineligible) return c
		if (!ENTRY_SOURCES.has(String(c.source))) return c
		if (typeof c.id !== "number" || !shown.has(c.id)) return c
		marked++
		return { ...c, ineligible: { reason: SHOWN_ELSEWHERE_REASON } }
	})
	return { items: out, marked }
}
