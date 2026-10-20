/**
 * 🚧 The draft's life across a Send (owner ruling 2026-10-15: a person's
 * message is saved through the pipeline, and text is never lost).
 *
 * The composer empties its box the moment Send is pressed, but the message is
 * not the person's to forget until it is SAVED: the session's save pipeline
 * may refuse it with a sentence, fail, or not answer. So the sent text is held
 * here until one of three things happens:
 *
 * - **it lands** — the answer carries the saved row, or (an answer that only
 *   says `accepted`) the row arrives on the push: the kept draft is cleared;
 * - **it is refused** — a sentence, an error, or no answer within
 *   `PENDING_SEND_TIMEOUT_MS`: the text goes back in the composer, ahead of
 *   anything typed since, and the sentence is said once;
 * - **another session opens** — dropped; the server kept the draft.
 *
 * One send at a time: while one is held, `start` refuses another, so two
 * presses cannot both be lost or both be restored.
 */

/** How long a send may go unanswered before its text comes back. */
export const PENDING_SEND_TIMEOUT_MS = 10_000

/** Said when the server never answered. */
export const SEND_UNANSWERED =
	"Your message wasn't confirmed as sent, so it's back in the composer."

export interface PendingSendDeps {
	/** Put text back in the composer (and so in the saved draft). */
	restore(content: string): void
	/** The text the composer holds now — what a restore must not overwrite. */
	draft(): string
	/** The message landed: forget the kept draft on the server. */
	landed(sessionId: number): void
	/** Say a refusal, once. */
	say(sentence: string): void
	setTimer?: (fn: () => void, ms: number) => unknown
	clearTimer?: (handle: unknown) => void
}

/** What the send handler answers (`SendPersonaMessage.Response`), as read here. */
export interface SendAnswer {
	sessionId?: number
	accepted?: true
	runId?: string
	sessionMessage?: { id?: number; role?: string; userId?: number | null; content?: string } | null
	refused?: string
	error?: string
}

/** A pushed row (`sessionMessage`), as read here. */
export interface PushedRow {
	sessionId?: number
	role?: string
	userId?: number | null
	content?: string
}

interface Held {
	sessionId: number
	content: string
	userId: number | null
	timer: unknown
}

export function createPendingSend(d: PendingSendDeps) {
	const setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
	const clearTimer = d.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
	let held: Held | null = null

	const settle = () => {
		if (held) clearTimer(held.timer)
		const was = held
		held = null
		return was
	}

	/** The text comes back: ahead of whatever was typed since, never over it. */
	const giveBack = (sentence: string | null) => {
		const was = settle()
		if (!was) return
		const now = d.draft()
		if (!now.trim()) d.restore(was.content)
		else if (now !== was.content) d.restore(`${was.content}\n\n${now}`)
		if (sentence) d.say(sentence)
	}

	const land = () => {
		const was = settle()
		if (was) d.landed(was.sessionId)
	}

	return {
		/** A send is held — the composer's next Send waits for it. */
		get inFlight() {
			return held !== null
		},
		/** Hold this text until it lands or comes back; false when one is already held. */
		start(sessionId: number, content: string, userId: number | null): boolean {
			if (held) return false
			const timer = setTimer(() => giveBack(SEND_UNANSWERED), PENDING_SEND_TIMEOUT_MS)
			held = { sessionId, content, userId, timer }
			return true
		},
		/** The send handler's answer. */
		answer(res: SendAnswer | null | undefined) {
			if (!held || res?.sessionId !== held.sessionId) return
			if (res.refused || res.error) {
				// `error` is the unexpected failure the app-wide catch-all
				// already says (its `:error`): give the text back silently.
				giveBack(res.error ? null : (res.refused ?? null))
				return
			}
			if (res.accepted && res.sessionMessage) land()
			// `accepted` alone: the row is on its way — the push lands it.
		},
		/** A row pushed to the session: this person's message landing. */
		pushed(row: PushedRow | null | undefined) {
			if (!held || !row || row.sessionId !== held.sessionId) return
			if (row.role !== "user") return
			if (held.userId != null && row.userId !== held.userId) return
			// The saved text is trimmed at the write.
			if ((row.content ?? "").trim() !== held.content.trim()) return
			land()
		},
		/** Another session opened: whatever was held is not this page's any more. */
		drop() {
			settle()
		}
	}
}

export type PendingSend = ReturnType<typeof createPendingSend>
