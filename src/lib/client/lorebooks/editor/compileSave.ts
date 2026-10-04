/**
 * Where a compile's review saves (plan A11).
 *
 * The compile reads the scenes of the line it was asked from, so its text is
 * that line's telling of the entry, and the save must reach that line and the
 * lines that read it — never the lines the entry came from:
 *
 * - **At a moment**: an amendment on the line, dated then, as the entry
 *   editor's _Save as of_ is.
 * - **At now, the line's own entry**: the entry itself. Only this line, and
 *   the lines branched off it, read it.
 * - **At now, an entry the line reads from main or a parent line**: an
 *   amendment on the line dated at the entry's OWN date. Writing the entry
 *   would hand this line's scenes to main and to every line beside this one;
 *   the amendment applies on this line from the event's own date, and a
 *   nearer line's amendment wins over an ancestor's (`amendmentsOnLine`).
 */
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import { sameLineAndMoment } from "$lib/shared/lorebooks/loreRoute"

export type CompileSave =
	| { kind: "entry" }
	| {
			kind: "amendment"
			branchId: number | null
			date: StoryDate
			/** Dated at the entry's own date because the entry is not the line's. */
			atEntryDate: boolean
	  }

/** A history entry as far as its line and date go. */
export interface CompiledEntry {
	branchId?: number | null
	year: number
	month?: number | null
	day?: number | null
}

export function compileSaveOf(
	entry: CompiledEntry,
	reading: { branchId: number | null; moment: StoryDate | null }
): CompileSave {
	if (reading.moment)
		return {
			kind: "amendment",
			branchId: reading.branchId,
			date: reading.moment,
			atEntryDate: false
		}
	if ((entry.branchId ?? null) === (reading.branchId ?? null))
		return { kind: "entry" }
	return {
		kind: "amendment",
		branchId: reading.branchId,
		date: {
			year: entry.year,
			month: entry.month ?? null,
			day: entry.month != null ? (entry.day ?? null) : null
		},
		atEntryDate: true
	}
}

/**
 * The compile of a history entry at one reading — its line and moment — out
 * of the user's compiles. One entry compiled on two lines is two compiles
 * (two runs, two reviews, two places to save), so a reader is shown only the
 * one asked at the reading they stand on.
 */
export function compileActivityAt<
	A extends {
		historyEntryId: number
		branchId: number | null
		moment: StoryDate | null
	}
>(
	activities: readonly A[] | null | undefined,
	historyEntryId: number,
	reading: { branchId: number | null; moment: StoryDate | null }
): A | undefined {
	return (activities ?? []).find(
		(a) =>
			a.historyEntryId === historyEntryId && sameLineAndMoment(a, reading)
	)
}
