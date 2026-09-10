/**
 * Rows out of a RAW `execute`, in one place.
 *
 * `PgDatabase.execute` is typed by the driver's own result HKT, so on a
 * driver-agnostic handle (`Db`, `MigrationDb`) the result is `unknown` — and
 * deliberately: PGlite answers `{ rows }`, other drivers answer the array
 * itself, and a handle that has not named its driver cannot know which.
 *
 * Every raw read in the tree used to spell that fork itself — `res.rows ?? res`
 * behind a `db: any`, or `const rows: any = await db.execute(...)`. The fork is
 * fine; the `any` was not, because it typed every row read out of it `any` as a
 * side effect. This narrows the two shapes once and hands back a row type the
 * caller names, so a raw read is checked like any other.
 *
 * ⚠ The caller's `T` is an ASSERTION about SQL this module cannot see, exactly
 * as it was before. What changes is that the assertion is now written down at
 * the one place it is made, and does not leak past the read.
 */
export function rawRows<T extends Record<string, unknown>>(res: unknown): T[] {
	if (Array.isArray(res)) return res as T[]
	const rows = (res as { rows?: unknown } | null | undefined)?.rows
	return Array.isArray(rows) ? (rows as T[]) : []
}
