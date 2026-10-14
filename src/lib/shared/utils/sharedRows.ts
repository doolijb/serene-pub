/**
 * Rows another person **shared** with the reader (PLAN-private-messages §6.7)
 * ride the same `characters:list` / `lorebooks:list` as the reader's own,
 * marked `isSharedWithMe`. A share grants read and copy only (ruled Q3), so
 * the lists split them out under **Shared with you** and every picker that
 * would put one to use (cast, voice, a session's lorebooks) drops them.
 */

export interface MaybeSharedRow {
	isSharedWithMe?: boolean | null
	ownerName?: string | null
}

/** The reader's own rows and the shared ones, each in the order given. */
export function splitSharedRows<T extends MaybeSharedRow>(
	rows: readonly T[]
): { own: T[]; shared: T[] } {
	const own: T[] = []
	const shared: T[] = []
	for (const row of rows) (row.isSharedWithMe ? shared : own).push(row)
	return { own, shared }
}

/** Only the reader's own rows: what a picker that puts a row to use offers. */
export function withoutShared<T extends MaybeSharedRow>(
	rows: readonly T[] | null | undefined
): T[] {
	return (rows ?? []).filter((row) => !row.isSharedWithMe)
}

/** A shared row's second line: who it came from. */
export function sharedFromLine(row: MaybeSharedRow): string {
	return row.ownerName ? `From ${row.ownerName}` : "Shared with you"
}
