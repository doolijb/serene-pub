/**
 * What a picture step needs, against what the pair's drawing sheet can do
 * (DESIGN-image-generation §4.6).
 *
 * **No by type, yes by need.** A spec never names a connection type; it wires
 * ports and sets params, and this decides — once, from the sheet:
 *
 *  - a **hard need** the pair lacks is a REFUSAL before anything is sent
 *    (`references: required` on a sheet with no reference input; `cutOut:
 *    native-only` on a sheet that draws no transparency). Hard needs are the
 *    ones a person could not see failing in the output.
 *  - a **soft need** degrades with a report, and where the degradation changes
 *    what the picture is OF (references) the report is a **pre-run notice**
 *    the action's form shows before the run.
 *
 * Refusal copy names the need, never a vendor or the pair's name — the pair
 * rides as a field on the error, removed for everyone who is not an admin, the
 * same way every other image dispatch failure carries it.
 *
 * Pure, so the bind (dispatch) and the form's preview cannot disagree.
 */

import type { DrawingSheet } from "$lib/shared/imageGen/types"

/** The oracle's `references` param. */
export type ReferencesPolicy = "preferred" | "required"
/** The oracle's `cutOut` param. */
export type CutOutMode = "off" | "native-or-task" | "native-only"

export interface ImageStepNeeds {
	/** How many reference images are wired (0 = the port is empty). */
	references: number
	init: boolean
	mask: boolean
	referencesPolicy?: ReferencesPolicy | null
	cutOut?: CutOutMode | null
}

export interface SheetVerdict {
	/** A sentence to refuse with, or null when the step may run. */
	refusal: string | null
	/**
	 * What the action's form says BEFORE the run, when the run will proceed
	 * but draw something other than asked. Empty when nothing degrades in a
	 * way a person would want to know first.
	 */
	preRunNotices: string[]
	/** Ask the model itself for a transparent background. */
	transparent: boolean
	/** Flag the pictures for the cut-out task (`media.meta.needsCutOut`). */
	needsCutOut: boolean
}

const WHERE_TO_FIX =
	"An admin fills the Images loadout in Loadouts, or sets a model in the pipeline's configuration."

export const REFERENCES_REFUSAL =
	`This step needs a model that takes reference images, and the model in the Images loadout does not. ` +
	WHERE_TO_FIX

export const CUT_OUT_REFUSAL =
	`This step needs a model that draws a transparent background itself, and the model in the Images loadout does not. ` +
	WHERE_TO_FIX

export const REFERENCES_NOTICE =
	"This model can't take a reference image; the picture is drawn from the prompt alone, so it will match less closely."

export const referencesCappedNotice = (max: number): string =>
	`This model takes at most ${max} reference image${max === 1 ? "" : "s"}; the rest are left out.`

export function judgeSheet(
	sheet: DrawingSheet,
	needs: ImageStepNeeds
): SheetVerdict {
	const notices: string[] = []
	const policy = needs.referencesPolicy ?? "preferred"
	const cutOut = needs.cutOut ?? "off"

	if (needs.references > 0) {
		if (!sheet.references) {
			if (policy === "required")
				return refuse(REFERENCES_REFUSAL)
			notices.push(REFERENCES_NOTICE)
		} else if (needs.references > sheet.references.max)
			notices.push(referencesCappedNotice(sheet.references.max))
	}

	const native = sheet.transparent === "native"
	if (cutOut === "native-only" && !native) return refuse(CUT_OUT_REFUSAL)

	return {
		refusal: null,
		preRunNotices: notices,
		transparent: cutOut !== "off" && native,
		needsCutOut: cutOut === "native-or-task" && !native
	}
}

const refuse = (refusal: string): SheetVerdict => ({
	refusal,
	preRunNotices: [],
	transparent: false,
	needsCutOut: false
})
