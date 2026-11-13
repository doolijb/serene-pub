import { versionLabelText } from "$lib/client/components/characterForms/cardVersionWords"

/**
 * The words of **Update ‹member› to card ‹label›** (lane cv-member2, B1).
 * 🚧 Provisional (★, cv-client's proposal): kept here so the member page and
 * the cast line say the same thing.
 */

/** A card version as the offer reads it (`CardVersionSummary`). */
export interface OfferedCardVersion {
	number: number
	label: string | null
}

/** The muted line: where the member is, and where the card is. */
export function cardUpdateLine(
	cardVersion: OfferedCardVersion,
	cardCurrentVersion: OfferedCardVersion
): string {
	return `On card ${versionLabelText(cardVersion.label, cardVersion.number)}; the card is on ${versionLabelText(cardCurrentVersion.label, cardCurrentVersion.number)}.`
}

/** The button: what happens, to whom, to which version. */
export function cardUpdateButton(
	memberName: string,
	cardCurrentVersion: OfferedCardVersion
): string {
	return `Update ${memberName} to card ${versionLabelText(cardCurrentVersion.label, cardCurrentVersion.number)}`
}

/** What a refusal with no sentence of its own says. */
export const CARD_UPDATE_FALLBACK = "The member could not be updated."
