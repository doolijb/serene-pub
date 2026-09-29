/**
 * What an action collects before it fires, as a listing carries it (lair
 * pass R3, 2026-09-28): the declaration's `collects` (`@serene-pub/sdk`
 * `CollectedText`, `CollectedRecipients`) with its display text resolved, and
 * `min` defaulted. The collect modal reads this; the fire door reads the
 * declaration itself.
 */

import { i18nText, type ActionDecl, type I18n } from "@serene-pub/sdk"

export interface ListedCollects {
	text?: {
		need: "required" | "optional"
		label: string
		placeholder?: string
		/** What an empty submit does — present whenever `need` is `optional`. */
		ifEmpty?: string
	}
	recipients?: {
		label: string
		/** The fewest that may be picked (declared, else 1). */
		min: number
		/** The most that may be picked; absent, any number. */
		max?: number
		/**
		 * The per-cast slot the action writes on each recipient, replacing
		 * what it held (R10 — the Whisper's `core:slot/whisper@1`): the modal
		 * shows each member's current value.
		 */
		overwrites?: string
	}
}

const text = (v: I18n | undefined): string | undefined => i18nText(v)

/** A declaration's `collects`, resolved for a listing; `undefined` when it collects nothing. */
export function listedCollects(
	collects: ActionDecl["collects"] | undefined
): ListedCollects | undefined {
	if (!collects || (!collects.text && !collects.recipients)) return undefined
	const out: ListedCollects = {}
	if (collects.text) {
		const placeholder = text(collects.text.placeholder)
		const ifEmpty = text(collects.text.ifEmpty)
		out.text = {
			need: collects.text.need,
			label: text(collects.text.label) ?? "",
			...(placeholder ? { placeholder } : {}),
			...(ifEmpty ? { ifEmpty } : {})
		}
	}
	if (collects.recipients) {
		out.recipients = {
			label: text(collects.recipients.label) ?? "",
			min: collects.recipients.min ?? 1,
			...(collects.recipients.max !== undefined ? { max: collects.recipients.max } : {}),
			...(collects.recipients.overwrites ? { overwrites: collects.recipients.overwrites } : {})
		}
	}
	return out
}
