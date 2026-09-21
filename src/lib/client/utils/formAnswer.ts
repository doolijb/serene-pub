/**
 * A form's buttons, as the viewer sees them (plans/29 R-15 *Forms*; plans/30
 * U5d review, W7).
 *
 * The server decides who may answer (`fireAction`: the addressee is the
 * audience, resolved by the portrayal resolver); this is the **affordance** —
 * the same rules, read off what the client already holds, so a person who
 * cannot answer is not shown a button that would only refuse them. Mirrors
 * `runtime/portrayals.ts` branch for branch, for the one question a block
 * asks: *does this viewer portray the addressee?*
 *
 * - `character:<id>` — a member's own presence (a `sessionPersonas` row for
 *   it): the viewer's, or not theirs. In the cast and nobody's presence: the
 *   AI's, so nobody clicks. Neither: nobody portrays them, and the **owner**
 *   may answer (W4; `docs/sessions.md`, *forms*).
 * - `envoy:<slug>` — the AI's, always.
 * - `user:<id>` · `owner` · `admin` · `participant` · `run-owner` — the
 *   viewer is, or is not, that person.
 * - No addressee — the action's own audience decides, which this view does
 *   not know; the buttons show and the server judges the press.
 *
 * An affordance only — the server refuses regardless.
 *
 * `staleOf` (U5f) is the other affordance: a form the channel has moved
 * past is drawn collapsed as *superseded*, from the same verdict the door
 * refuses with — `core:verdict/staleness`, judged over the head the client
 * holds (01 §13).
 */

import { stalenessVerdict } from "@serene-pub/sdk"

export interface FormViewer {
	userId: number | null | undefined
	isOwner: boolean
	isAdmin?: boolean
}

export interface FormSession {
	sessionPersonas?: Array<{
		personaId?: number | null
		persona?: { userId?: number | null } | null
	} | null> | null
	sessionCharacters?: Array<{ characterId?: number | null } | null> | null
}

/** A block's `answered` stamp, as the host writes it. */
export interface AnsweredMark {
	by: string
	at: string
	choice?: string
}

const rowId = (text: string): number | null => {
	if (!/^\d{1,10}$/.test(text)) return null
	const n = Number(text)
	return Number.isSafeInteger(n) && n > 0 ? n : null
}

/** May this viewer answer a form put to `addressee`? True for an unaddressed block. */
export function canAnswerForm(
	addressee: string | null | undefined,
	viewer: FormViewer,
	session: FormSession | null | undefined
): boolean {
	if (!addressee) return true
	if (viewer.userId == null) return false
	const cut = addressee.indexOf(":")
	const kind = cut === -1 ? addressee : addressee.slice(0, cut)
	const rest = cut === -1 ? "" : addressee.slice(cut + 1)
	switch (kind) {
		case "character": {
			const id = rowId(rest)
			if (id === null) return viewer.isOwner
			const presence = (session?.sessionPersonas ?? []).find(
				(p) => p?.personaId === id
			)
			if (presence) return presence.persona?.userId === viewer.userId
			const seated = (session?.sessionCharacters ?? []).some(
				(c) => c?.characterId === id
			)
			// The AI's while seated; nobody's otherwise, and then the owner's.
			return seated ? false : viewer.isOwner
		}
		case "envoy":
			return false
		case "user":
			return rowId(rest) === viewer.userId
		case "owner":
			return viewer.isOwner
		case "admin":
			return viewer.isAdmin === true
		case "participant":
		case "run-owner":
			return true
		default:
			return false
	}
}

/**
 * What an answered block shows in place of its buttons: the chosen option's
 * label for a `choices` block, else nothing beyond the fact.
 */
export function answeredChoiceLabel(
	block: { kind?: string; actions?: Array<{ choice?: string; label?: string }> },
	answered: AnsweredMark
): string | null {
	if (block.kind !== "choices" || answered.choice === undefined) return null
	const option = (block.actions ?? []).find((o) => o.choice === answered.choice)
	return option?.label ?? answered.choice
}

/**
 * The **channel head** as the client holds it (plans/29 R-15 *Staleness and
 * order*; U5f): the greatest message id among the rows it has on exactly
 * this channel string — lane-scoped, like the server's `channelHead`. Null
 * when it holds none. Deleted rows are not in the list; hidden rows are, and
 * count, as they do on the server.
 */
export function channelHeadOf(
	messages: ReadonlyArray<{ id: number; channel?: string | null } | null | undefined>,
	channel: string
): number | null {
	let head: number | null = null
	for (const m of messages) {
		if (!m || (m.channel ?? "main") !== channel) continue
		if (head === null || m.id > head) head = m.id
	}
	return head
}

/** Enough of a message row to compute a form's staleness head from. */
export interface StaleRow {
	id: number
	channel?: string | null
	metadata?: { answersForm?: { messageId?: unknown } | null } | null
}

/**
 * The **staleness head** for the forms on row `rowId`, as the client holds
 * it (U5f) — `channelHeadOf` minus the row's own answers: a message whose
 * `metadata.answersForm.messageId` is `rowId` answers one of its questions
 * and does not move the conversation on from it. Mirrors the server's
 * `stalenessHead`.
 */
export function stalenessHeadOf(
	messages: ReadonlyArray<StaleRow | null | undefined>,
	channel: string,
	rowId: number
): number | null {
	return channelHeadOf(
		messages.filter((m) => m?.metadata?.answersForm?.messageId !== rowId),
		channel
	)
}

/**
 * Is this form **stale** (U5f): `core:verdict/staleness` — unanswered,
 * carrying a `head`, and the channel past it — judged over the newest
 * message the client holds on the block's row's channel, other than answers
 * to that row's own forms (`stalenessHeadOf`, the client's reading of the
 * server's `stalenessHead`). The same verdict the door in `fireAction`
 * refuses with; an affordance only — the server refuses regardless.
 * Answered beats stale; a block with no `head` (a pre-U5f row) is never
 * stale.
 */
export function staleOf(
	block: { head?: unknown; answered?: unknown },
	row: { id: number; channel?: string | null },
	messages: ReadonlyArray<StaleRow | null | undefined>
): boolean {
	const headNow = stalenessHeadOf(messages, row.channel ?? "main", row.id)
	return !stalenessVerdict.judge({ block, headNow }).ok
}

/** The block's `answered` stamp, when it carries a well-formed one. */
export function answeredOf(block: { answered?: unknown }): AnsweredMark | null {
	const a = block?.answered as Partial<AnsweredMark> | null | undefined
	if (!a || typeof a !== "object" || typeof a.by !== "string" || typeof a.at !== "string")
		return null
	return {
		by: a.by,
		at: a.at,
		...(typeof a.choice === "string" ? { choice: a.choice } : {})
	}
}
