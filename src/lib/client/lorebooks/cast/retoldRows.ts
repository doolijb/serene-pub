/**
 * The member form's retold rows, as arithmetic
 * (PLAN-cast-retold-fields-2026-10-13; one **Use from card** switch per row
 * since 2026-11-10, lane s4-rul-e).
 *
 * A card is a starter. Each of its prose fields may be **retold** by the cast
 * member — the member's own text is read instead of the card's (Use from card
 * off). The member's text is KEPT when the switch goes back on: set aside,
 * never discarded.
 *
 * ⚠ Not *override* (a config scope), not *amendment* (the flags and the text
 * are themselves amendable), not *diverged* (NOMENCLATURE §8).
 */
import type { RetoldField, RetoldFlags } from "$lib/shared/lorebooks/retold"
import type { CharacterGreeting } from "$lib/shared/characters/profile"
import { greetingColumnsOf } from "$lib/client/components/characterForms/cardDraft"
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

/**
 * What a row of the block is named. The opener and the alternates are ONE
 * row, **Greetings**: the server reads them as one profile field, followed or
 * own as a whole, so retelling half would silently give the member an own
 * list of both. On the wire nothing changes: the list's first item is
 * `firstMessage`, the rest `alternateGreetings`.
 */
export type RetoldRowField =
	| Exclude<RetoldProseField, "firstMessage" | "alternateGreetings">
	| "greetings"

/** The card a member is drawn with, as far as this block reads it. */
export type RetoldCard = NonNullable<CastRow["character"]>

/** The member's side of the block: their text and their flags. */
export interface RetoldDraft {
	description: string
	personality: string
	scenario: string
	firstMessage: string
	alternateGreetings: string[]
	/** The member's own greetings marked for group sessions only (on the wire a third column). */
	groupOnlyGreetings: string[]
	exampleDialogues: string
	faceMediaId: number | null
	retold: RetoldFlags
}

/** One row of the block, as the form draws it. */
export interface RetoldRow {
	field: RetoldRowField
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

/** The one row's label for the opener and the alternates together. */
export const GREETINGS_LABEL = "Greetings"

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

/** The card's opener and alternates as one list (the opener first). */
export function cardGreetings(card: RetoldCard | null | undefined): string[] {
	const alternates = [...(card?.alternateGreetings ?? [])]
	const opener = card?.firstMessage ?? ""
	return opener === "" && alternates.length === 0
		? []
		: [opener, ...alternates]
}

/** The member's own opener and alternates as one list (the opener first). */
export function greetingsOf(
	draft: Pick<RetoldDraft, "firstMessage" | "alternateGreetings">
): string[] {
	return draft.firstMessage === "" && draft.alternateGreetings.length === 0
		? []
		: [draft.firstMessage, ...draft.alternateGreetings]
}

/**
 * Put a greeting list back as the opener and the alternates. The marked
 * greetings are the draft's `groupOnlyGreetings`, left as they are.
 */
export function withGreetings<D extends RetoldDraft>(
	draft: D,
	list: readonly string[]
): D {
	return {
		...draft,
		firstMessage: list[0] ?? "",
		alternateGreetings: list.slice(1)
	}
}

/**
 * The member's greetings as the form lists them: the unmarked ones (the
 * opener first, an empty opener kept so positions hold), then the ones marked
 * **Group sessions only** — the order the wire's three columns give them back
 * in on a reload, as on the card.
 */
export function greetingListOf(
	draft: Pick<
		RetoldDraft,
		"firstMessage" | "alternateGreetings" | "groupOnlyGreetings"
	>
): CharacterGreeting[] {
	return [
		...greetingsOf(draft).map((text) => ({ text })),
		...draft.groupOnlyGreetings.map((text) => ({
			text,
			groupOnly: true as const
		}))
	]
}

/** Put the form's list back into the draft's three columns (`greetingColumnsOf`). */
export function withGreetingList<D extends RetoldDraft>(
	draft: D,
	list: readonly CharacterGreeting[]
): D {
	return { ...draft, ...greetingColumnsOf(list) }
}

/** Whether either half of the greetings is retold (a half-retold member reads their own list). */
export function greetingsRetold(flags: RetoldFlags): boolean {
	return flags.firstMessage === true || flags.alternateGreetings === true
}

/** Every greeting text the member holds, marked ones too. */
function ownGreetingTexts(draft: RetoldDraft): string[] {
	return [...greetingsOf(draft), ...draft.groupOnlyGreetings]
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
	const rows: RetoldRow[] = []
	for (const prose of RETOLD_PROSE_FIELDS) {
		if (prose === "alternateGreetings") continue
		if (prose === "firstMessage") {
			const cardValue = cardGreetings(card)
			rows.push({
				field: "greetings",
				label: GREETINGS_LABEL,
				shape: "list",
				retold: greetingsRetold(draft.retold),
				cardValue,
				cardHasText: hasText(cardValue),
				kept:
					!greetingsRetold(draft.retold) &&
					hasText(ownGreetingTexts(draft))
			})
			continue
		}
		const cardValue = cardValueOf(card, prose)
		rows.push({
			field: prose,
			label: RETOLD_LABELS[prose],
			shape: "text",
			retold: draft.retold[prose] === true,
			cardValue,
			cardHasText: hasText(cardValue),
			kept: draft.retold[prose] !== true && hasText(draft[prose])
		})
	}
	return rows
}

/**
 * Copy the card's current value into the member's field (**Take from card**).
 * The flag is left as it is.
 */
export function takeFromCard<D extends RetoldDraft>(
	draft: D,
	field: RetoldProseField | "greetings",
	card: RetoldCard | null | undefined
): D {
	if (field === "greetings")
		return {
			...withGreetings(draft, cardGreetings(card)),
			groupOnlyGreetings: [...(card?.groupOnlyGreetings ?? [])]
		}
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
	field: RetoldField | "greetings",
	on: boolean,
	card: RetoldCard | null | undefined,
	saved?: D
): D {
	if (field === "greetings") return setGreetingsRetold(draft, on, card, saved)
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

/**
 * The greetings row's switch: BOTH flags move together. On with no greetings
 * of the member's own copies the card's in first; off keeps the member's list
 * (hidden), except an unedited copy of the card's, as `setRetold` does.
 */
function setGreetingsRetold<D extends RetoldDraft>(
	draft: D,
	on: boolean,
	card: RetoldCard | null | undefined,
	saved?: D
): D {
	let next: D = {
		...draft,
		retold: {
			...draft.retold,
			firstMessage: on,
			alternateGreetings: on
		}
	}
	if (on && !hasText(ownGreetingTexts(draft)))
		return takeFromCard(next, "greetings", card)
	if (!on && saved && !hasText(ownGreetingTexts(saved))) {
		const copy = takeFromCard(saved, "greetings", card)
		if (
			JSON.stringify(greetingListOf(draft)) ===
			JSON.stringify(greetingListOf(copy))
		)
			next = {
				...next,
				firstMessage: saved.firstMessage,
				alternateGreetings: [...saved.alternateGreetings],
				groupOnlyGreetings: [...saved.groupOnlyGreetings]
			}
	}
	return next
}
