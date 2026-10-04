import {
	QUERY_FAILED_SENTENCE,
	isFailedQuery,
	withoutQueryText
} from "$lib/server/db/errors"

/**
 * Whether a caught error is the server's own failure rather than a sentence
 * written for the person (plan A13 / A24 leftover):
 *
 * - the database's — a failed query under drizzle's wrapper, a message that
 *   quotes one (`Character "Ada": Failed query: …`), or the driver's own error,
 *   which PGlite raises outside any query (at COMMIT) with a SQLSTATE and a
 *   severity and no wrapper: `duplicate key value violates unique constraint
 *   "…"` is nothing a person can act on;
 * - the machine's — a Node system error (`ENOENT: no such file or directory,
 *   open '/tmp/serene-pub-import-…'`), which also names a path on the server;
 * - a bug's (`TypeError`, `ReferenceError`, `RangeError`).
 *
 * Everything else is a refusal a handler wrote for a person, and is kept.
 */
export function isServerFailure(e: unknown): boolean {
	if (isFailedQuery(e)) return true
	if (
		e instanceof TypeError ||
		e instanceof ReferenceError ||
		e instanceof RangeError
	)
		return true
	if (!e || typeof e !== "object") return false
	const { code, severity, syscall, errno, message } = e as {
		code?: unknown
		severity?: unknown
		syscall?: unknown
		errno?: unknown
		message?: unknown
	}
	// A driver error: a five-character SQLSTATE beside a severity.
	if (
		typeof code === "string" &&
		/^[0-9A-Z]{5}$/.test(code) &&
		typeof severity === "string"
	)
		return true
	// A Node system error.
	if (typeof syscall === "string" || typeof errno === "number") return true
	return typeof message === "string" && withoutQueryText(message) !== message
}

/**
 * What an import tells the person about a failure: the handler's own sentence
 * when it wrote one, and otherwise the plain one, `QUERY_FAILED_SENTENCE`,
 * with the whole error in the server log under `context` (what was being
 * imported) — whenever that sentence is the answer, since it says the log
 * has the details. The database's and the machine's words never reach the
 * person.
 */
export function importFailureSentence(e: unknown, context: string): string {
	if (!isServerFailure(e)) {
		if (e instanceof Error && e.message) return e.message
		if (typeof e === "string" && e) return e
	}
	console.error(`[import] ${context}:`, e)
	return QUERY_FAILED_SENTENCE
}

/**
 * `refusable`'s `translate` for an import handler: `sentence` for the
 * server's own failure (`isServerFailure`) — which `refusable` alone would
 * pass on in the driver's words when no drizzle wrapper carries it — and
 * undefined for a refusal a handler wrote, which is kept.
 */
export const serverFailureAs =
	(sentence: string) =>
	(e: unknown): string | undefined =>
		isServerFailure(e) ? sentence : undefined
