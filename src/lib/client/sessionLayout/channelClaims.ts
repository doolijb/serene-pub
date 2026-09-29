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
import { isInstanceOf } from "$lib/shared/widgets/instanceId"

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
