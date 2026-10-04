/**
 * Which channels each placed copy of the conversation shows (lair re-plan S1).
 *
 * A `messages` copy with a `channel` setting **claims** that channel: it shows
 * that channel alone, and its composer writes there. A copy with none is a
 * **primary log**: it shows every channel no placed copy claims. So a layout
 * with one Messages widget is the whole session, exactly as before, and the
 * Lair's `messages#sanctum` takes the Sanctum out of the story's log and its
 * channel strip.
 *
 * Pure, so the rule is tested without a page: `SessionLayout` feeds it the
 * placed ids and each one's settings, and hands every copy its channels as
 * the dossier's `composer.channels` (the list the conversation shows rows
 * for and writes on).
 */
import { isInstanceOf } from "@serene-pub/sdk"

/** The conversation's widget id — the widget every claiming copy is an instance of. */
export const CONVERSATION_WIDGET = "messages"

/** A copy's claim, read off its settings: a non-empty trimmed `channel`, else none. */
export function claimOf(settings: Record<string, unknown> | undefined): string | null {
	const raw = settings?.channel
	return typeof raw === "string" && raw.trim() ? raw.trim() : null
}

/**
 * Every claim in a layout: placed conversation copy → the channel it claims.
 * A placed id that is not a conversation copy claims nothing, whatever its
 * settings say.
 */
export function channelClaims(
	placed: Iterable<string>,
	settingsOf: (id: string) => Record<string, unknown> | undefined
): Map<string, string> {
	const out = new Map<string, string>()
	for (const id of placed) {
		if (!isInstanceOf(id, CONVERSATION_WIDGET)) continue
		const claim = claimOf(settingsOf(id))
		if (claim) out.set(id, claim)
	}
	return out
}

/**
 * The layout's **primary log**: the first placed instance of `widgetId` (the
 * conversation, or an R71 genre's own primary) that claims no channel, in the
 * reading order the caller passes — middle, left, right; by row, then by
 * column. Else the first placed instance at all, claiming or not; else null.
 *
 * Free placement (brief 7a) is why this is a question: the conversation may
 * sit in a side, and a layout whose every copy claims a channel has no
 * unclaimed log. The phone's stage and Stage only draw this one (./placementRules
 * `stageOf`), and when it is a claiming copy it also shows what no copy claims
 * (`channelsForCopy`), so `main` never vanishes from the session.
 */
export function primaryLogOf(
	readingOrder: Iterable<string>,
	claims: ReadonlyMap<string, string>,
	widgetId: string = CONVERSATION_WIDGET
): string | null {
	const instances = [...readingOrder].filter((id) => isInstanceOf(id, widgetId))
	return instances.find((id) => !claims.has(id)) ?? instances[0] ?? null
}

/**
 * The channels one copy shows. A claiming copy: its channel alone. A primary
 * log: the session's channels less every claimed one — and all of them if
 * that would leave none, because a log with no channel is a log nobody can
 * write in.
 *
 * `primaryLog` is `primaryLogOf`'s answer. When it is a CLAIMING copy — no
 * unclaimed copy is placed — that copy also shows every unclaimed channel,
 * after its own, so removing the story's log from the Lair leaves the story
 * readable in the Sanctum panel rather than nowhere (plan M.3.9).
 */
export function channelsForCopy(
	all: readonly string[],
	claims: ReadonlyMap<string, string>,
	id: string,
	primaryLog: string | null = null
): string[] {
	const own = claims.get(id)
	const claimed = new Set(claims.values())
	const rest = all.filter((c) => !claimed.has(c))
	if (own) return id === primaryLog ? [own, ...rest] : [own]
	return rest.length ? rest : [...all]
}

/**
 * The conversation mounts that hold the page's message ids (`#message-<id>`,
 * which j/k, links and notifications land on) — brief 7b, plan §M.3.8 as
 * amended by its review: every Messages copy whose channels share none with a
 * mount already holding them, taken primary log first, then in reading order.
 *
 * So every row a layout draws is reachable by its page id, and none is on the
 * page twice: the story's log and the Lair's Sanctum both keep their ids (they
 * show different channels), while a second Sanctum or a second view of the
 * story takes its box's prefix (`ComponentMount`'s `pageIds`). A rule of ONE
 * mount — the first draft — left every row only a claiming copy draws (the
 * Sanctum's, Castellan's greeting included) with a prefixed id alone, so a
 * notification aimed at one never landed.
 *
 * `all` is the session's channels (the dossier's `composer.channels`), each
 * copy's own list read through `channelsForCopy`. Before the dossier arrives
 * (`all` empty) an unclaimed copy counts as showing "whatever no copy claims",
 * which is what it shows once the channels are known in every layout but one
 * whose every channel is claimed — so a box is not remounted as the page loads.
 *
 * Always the CONVERSATION's: an R71 genre's own primary is a widget like any
 * other, whose ids are its box's.
 */
export function pageIdsHolders(
	readingOrder: Iterable<string>,
	claims: ReadonlyMap<string, string>,
	all: readonly string[]
): Set<string> {
	const order = [...readingOrder].filter((id) => isInstanceOf(id, CONVERSATION_WIDGET))
	const log = primaryLogOf(order, claims, CONVERSATION_WIDGET)
	const held = new Set<string>()
	if (!log) return held
	const shown = new Set<string>()
	for (const id of [log, ...order.filter((id) => id !== log)]) {
		const mine = channelsShownBy(all, claims, id, log)
		if (mine.some((c) => shown.has(c))) continue
		held.add(id)
		for (const c of mine) shown.add(c)
	}
	return held
}

/** Stands for "every channel no copy claims" while the session's channels are unknown. */
const UNCLAIMED = "\u0000unclaimed"

/** `channelsForCopy`, or — with no channels known yet — the same answer in outline. */
function channelsShownBy(
	all: readonly string[],
	claims: ReadonlyMap<string, string>,
	id: string,
	log: string
): string[] {
	if (all.length) return channelsForCopy(all, claims, id, log)
	const own = claims.get(id)
	if (!own) return [UNCLAIMED]
	return id === log ? [own, UNCLAIMED] : [own]
}
