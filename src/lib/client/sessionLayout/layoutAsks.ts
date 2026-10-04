/**
 * What one tab has asked of the layout card menu, and whether a pushed
 * **started from** answer is still news (brief 6b of
 * `PLAN-layout-one-format-2026-09-28`, review round).
 *
 * Every answer to share, make a copy, Save changes to and the new-session
 * layout reaches every tab of the person; each adopts the refreshed list, and
 * only the tab that ASKED says how it went. An answer names its layout (or,
 * for the new-session layout, its genre), so a tab spends the ask with that
 * key. A handler that throws answers instead with its `:error` twin, which
 * names nothing, so it spends the tab's OLDEST ask of that verb — without
 * that, the ask was never spent, and a later answer with the same key (a
 * click in another tab) was toasted here.
 */

/** The card-menu verbs a tab asks. */
export type LayoutAskVerb = "share" | "clone" | "update" | "new-session"

export class LayoutAsks {
	/** Asks with no answer yet, oldest first, as `verb:key`. */
	#asks: string[] = []

	/** Record an ask: `key` is the layout's id, or the genre for `new-session`. */
	ask(verb: LayoutAskVerb, key: number | string): void {
		this.#asks.push(`${verb}:${key}`)
	}

	/** An answer arrived: did THIS tab ask? Spends that ask when it did. */
	take(verb: LayoutAskVerb, key: number | string): boolean {
		const at = this.#asks.indexOf(`${verb}:${key}`)
		if (at === -1) return false
		this.#asks.splice(at, 1)
		return true
	}

	/**
	 * The verb's handler threw (`:error`, which names no layout): spend this
	 * tab's oldest ask of it. `false` when this tab asked for none — the error
	 * is another tab's, and saying so is the shell's catch-all toast.
	 */
	fail(verb: LayoutAskVerb): boolean {
		const at = this.#asks.findIndex((a) => a.startsWith(`${verb}:`))
		if (at === -1) return false
		this.#asks.splice(at, 1)
		return true
	}

	/** Asks with no answer yet. */
	get pending(): number {
		return this.#asks.length
	}
}

/**
 * Is a **started from** answer — pushed, or answered on a reconnect ask —
 * about an OLDER copy than the one this tab holds?
 *
 * The push reads a session's row and sends it after a few more awaits; a
 * copy this tab asked for (Start from, Start again, Save as new, Save changes
 * to) can land and answer in between, and the late push would put the old
 * source's name, and its Updated mark, back on the pane. Every copy stamps
 * `layoutCopiedAt`, so an answer that carries an earlier stamp than the tab's
 * is old news. The same stamp, a later one, or a tab that holds none: news.
 * An unreadable instant never hides an answer.
 */
export function olderThanHeld(
	heldCopiedAt: string | null,
	answerCopiedAt: string | null
): boolean {
	if (heldCopiedAt == null) return false
	const held = Date.parse(heldCopiedAt)
	if (Number.isNaN(held)) return false
	if (answerCopiedAt == null) return true
	const answer = Date.parse(answerCopiedAt)
	if (Number.isNaN(answer)) return false
	return answer < held
}
