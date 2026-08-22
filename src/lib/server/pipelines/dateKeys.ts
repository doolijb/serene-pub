/**
 * A history entry's date, as the key a template sees.
 *
 * Split out of `promptBuilder/utils.ts` with its sibling: the pipeline's
 * assemble step keys history blocks by these, so they belong beside the code
 * that reads them rather than in a directory that is being deleted.
 */

export function formatDate(
	year: number,
	month: number | null | undefined,
	day: number | null | undefined
): string {
	let key = String(year)
	if (month != null) key += `-${String(month).padStart(2, "0")}`
	if (day != null) key += `-${String(day).padStart(2, "0")}`
	return key
}

export function formatHistoryDateKey(entry: {
	year?: number
	month?: number | null
	day?: number | null
}): string {
	return formatDate(entry.year ?? 0, entry.month ?? null, entry.day ?? null)
}
