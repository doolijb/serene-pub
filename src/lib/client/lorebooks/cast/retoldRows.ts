/**
 * The member form's **From the card** block, as arithmetic
 * (PLAN-cast-retold-fields-2026-10-13).
 *
 * A card is a starter. Each of its prose fields may be **retold** by the cast
 * member — the member's own text is read instead of the card's. The member's
 * text is KEPT when the toggle goes off: it is hidden, never discarded.
 *
 * ⚠ Not *override* (a config scope), not *amendment* (the flags and the text
 * are themselves amendable), not *diverged* (NOMENCLATURE §8).
 */
import type { RetoldField, RetoldFlags } from "$lib/shared/lorebooks/retold"
import type { CastRow } from "../castPool"

/** The retold fields that are text a person writes (everything but the face). */
export const RETOLD_PROSE_FIELDS = [
	"description",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"exampleDialogues"
] as const satisfies readonly RetoldField[]

export type RetoldProseField = (typeof RETOLD_PROSE_FIELDS)[number]

/** The card a member is drawn with, as far as this block reads it. */
export type RetoldCard = NonNullable<CastRow["character"]>

/** The member's side of the block: their text and their flags. */
export interface RetoldDraft {
	description: string
	personality: string
	scenario: string
	firstMessage: string
	alternateGreetings: string[]
	exampleDialogues: string
	faceMediaId: number | null
	retold: RetoldFlags
}

/** One row of the block, as the form draws it. */
export interface RetoldRow {
	field: RetoldProseField
	label: string
	/** A greeting list, or one block of text. */
	shape: "text" | "list"
	retold: boolean
	/** What the card says, in the member's shape (the editor's shape). */
	cardValue: string | string[]
	/** Whether the card has anything to say for this field. */
	cardHasText: boolean
	/**
	 * The member has their own text here that is NOT being read — kept from
	 * when the field was retold, hidden until it is switched on again.
	 */
	kept: boolean
}

export const RETOLD_LABELS: Record<RetoldProseField, string> = {
	description: "Description",
	personality: "Personality",
	scenario: "Scenario",
	firstMessage: "First message",
	alternateGreetings: "Alternate greetings",
	exampleDialogues: "Example dialogues"
}

/**
 * The card's example dialogues as one block of text.
 *
 * ⚠ The card holds them as an ARRAY (one dialogue each); the member holds
 * one text. Each dialogue is opened with `<START>`, the separator old cards
 * stored them under, so the text splits back into the same dialogues.
 */
export function joinExampleDialogues(
	value: string[] | string | null | undefined
): string {
	if (!value) return ""
	if (typeof value === "string") return value
	return value
		.map((d) => d.trim())
		.filter(Boolean)
		.map((d) => `<START>\n${d}`)
		.join("\n\n")
}

/** What the card says for one field, in the shape the member's editor holds. */
export function cardValueOf(
	card: RetoldCard | null | undefined,
	field: RetoldProseField
): string | string[] {
	if (field === "alternateGreetings")
		return [...(card?.alternateGreetings ?? [])]
	if (field === "exampleDialogues")
		return joinExampleDialogues(card?.exampleDialogues)
	return card?.[field] ?? ""
}

function hasText(value: string | string[]): boolean {
	return Array.isArray(value)
		? value.some((v) => v.trim() !== "")
		: value.trim() !== ""
}

/** The block's rows, in canonical order. */
export function retoldRows(
	draft: RetoldDraft,
	card: RetoldCard | null | undefined
): RetoldRow[] {
	return RETOLD_PROSE_FIELDS.map((field) => {
		const cardValue = cardValueOf(card, field)
		return {
			field,
			label: RETOLD_LABELS[field],
			shape: field === "alternateGreetings" ? "list" : "text",
			retold: draft.retold[field] === true,
			cardValue,
			cardHasText: hasText(cardValue),
			kept: draft.retold[field] !== true && hasText(draft[field])
		}
	})
}

/**
 * Copy the card's current value into the member's field (**Take from card**).
 * The flag is left as it is.
 */
export function takeFromCard<D extends RetoldDraft>(
	draft: D,
	field: RetoldProseField,
	card: RetoldCard | null | undefined
): D {
	const value = cardValueOf(card, field)
	return {
		...draft,
		[field]: Array.isArray(value) ? [...value] : value
	}
}

/**
 * Switch one field between the member's words and the card's.
 *
 * On, with nothing of the member's yet: the card's text is copied in first,
 * so the author starts from what the card said rather than a blank box.
 * Off: the member's text is kept as it is — hidden, never discarded —
 * EXCEPT a copy nobody edited: when the saved member had no text for the
 * field and the draft still holds exactly the card's copy, the saved (empty)
 * value comes back, so an untouched on-and-off leaves the form clean (owner
 * 2026-10-13). Pass `saved` (the form's as-built draft) for that.
 */
export function setRetold<D extends RetoldDraft>(
	draft: D,
	field: RetoldField,
	on: boolean,
	card: RetoldCard | null | undefined,
	saved?: D
): D {
	let next: D = { ...draft, retold: { ...draft.retold, [field]: on } }
	if (field === "face") return next
	const prose = field as RetoldProseField
	if (on && !hasText(draft[prose])) return takeFromCard(next, prose, card)
	if (!on && saved && !hasText(saved[prose])) {
		const copy = takeFromCard(saved, prose, card)[prose]
		if (JSON.stringify(draft[prose]) === JSON.stringify(copy))
			next = { ...next, [prose]: saved[prose] }
	}
	return next
}
