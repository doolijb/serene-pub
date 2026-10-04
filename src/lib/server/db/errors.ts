/**
 * When the data directory itself will not open.
 *
 * PGlite's Postgres is WASM, and a data directory it cannot start on does not
 * come back as a Postgres error — it comes back as a raw trap out of the
 * runtime: `RuntimeError: Aborted()`, raised from `_pg_initdb`, with no code,
 * no SQLSTATE and no message worth showing anyone. Nothing in this codebase
 * used to look at it, so a force-quit that damaged the directory surfaced as an
 * unhandled rejection at boot and then `RuntimeError: Aborted()` on every
 * request thereafter, with no mention of the data directory, the backups beside
 * it, or the fact that the data is still sitting there intact.
 *
 * This module is the classification step and nothing more: it decides whether a
 * failure to open is *that* failure, and packages the facts an owner needs.
 * Recovering — restoring a backup, starting fresh, moving the broken directory
 * aside — is P1 of PLAN-pglite-recovery and is deliberately not here; none of
 * it may run before the rulings that plan asks for.
 */
import fs from "fs"
import { DrizzleQueryError } from "drizzle-orm"
import type { LockState } from "./lock.js"
import type { ShutdownMarker } from "./shutdownMarker"

/** Repo-relative, so it is findable in a checkout, a zip, or the Docker image. */
export const TROUBLESHOOTING_DOC = "docs/troubleshooting.md#database-wont-open"

/**
 * ⚠ This link stays a GitHub URL, never
 * `docsHref("troubleshooting", "database-wont-open")`.
 *
 * Every consumer of this constant renders only while the database will not
 * open, and in that state `src/hooks.server.ts` answers *every* path except
 * `/recovery*` with the unopenable page — by design, so no request reaches an
 * app that cannot run. An in-app `/docs/...` link from here would therefore
 * re-render this same page instead of the guide. Making it work would mean
 * letting SvelteKit routes through that guard, which is a ruling about the
 * DB-down surface and not a link change.
 *
 * The app's own copy of the same page is at `/docs/troubleshooting`, once the
 * database opens.
 */
export const TROUBLESHOOTING_URL =
	"https://github.com/doolijb/serene-pub/blob/main/docs/troubleshooting.md#database-wont-open"

/** What `backups/` currently holds, as far as the failure path needs to know. */
export interface BackupSummary {
	backupsDir: string
	backupCount: number
	/** Filename only, newest by modification time. `null` when there are none. */
	newestBackup: string | null
}

export interface DatabaseUnopenableFacts extends BackupSummary {
	dataDir: string
	dbPath: string
	lastShutdown: ShutdownMarker
	cause: unknown
}

/**
 * The database exists and cannot be opened.
 *
 * Carries the facts rather than a rendered message so the boot log and the
 * placeholder page can say the same things in their own shapes without one of
 * them parsing the other's prose.
 */
export class DatabaseUnopenableError
	extends Error
	implements DatabaseUnopenableFacts
{
	readonly dataDir: string
	readonly dbPath: string
	readonly lastShutdown: ShutdownMarker
	readonly backupsDir: string
	readonly backupCount: number
	readonly newestBackup: string | null
	/**
	 * Set by hand rather than through `Error`'s `cause` option: this class is
	 * constructed on a path where the underlying trap is the whole evidence,
	 * and a `cause` that depends on which lib target a build compiled against
	 * is not evidence.
	 */
	readonly cause: unknown

	constructor(facts: DatabaseUnopenableFacts) {
		super(`The Serene Pub database at ${facts.dbPath} could not be opened.`)
		this.name = "DatabaseUnopenableError"
		this.dataDir = facts.dataDir
		this.dbPath = facts.dbPath
		this.lastShutdown = facts.lastShutdown
		this.backupsDir = facts.backupsDir
		this.backupCount = facts.backupCount
		this.newestBackup = facts.newestBackup
		this.cause = facts.cause
	}
}

/**
 * Recognise the error by its shape rather than by `instanceof`.
 *
 * The whole point of this class is to survive a boot that is already going
 * wrong, and `instanceof` is the one check that fails for a reason unrelated to
 * the failure being classified — two copies of this module (a dev reload, a
 * duplicated chunk, a test registry reset) give two distinct constructors.
 */
export function isDatabaseUnopenableError(
	value: unknown
): value is DatabaseUnopenableError {
	return (
		value instanceof Error &&
		value.name === "DatabaseUnopenableError" &&
		typeof (value as DatabaseUnopenableError).dbPath === "string"
	)
}

/**
 * Is this the WASM trap PGlite raises when it cannot start on a directory?
 *
 * Two halves, and both are load-bearing:
 *
 * - **A trap, not an exception.** Emscripten aborts the whole runtime, so there
 *   is no structured error to test — only `RuntimeError` and one of two
 *   messages. `Aborted()` is what the four real broken directories collected on
 *   2026-09-07 produce; `unreachable` is what a bad `PG_VERSION` or a zeroed
 *   `pg_control` produces. Same trap, same consequence, so both count.
 * - **From `_pg_initdb`.** This is what separates "this directory will not
 *   open" from a trap raised later, by a query, on a database that opened
 *   perfectly well. Only the first is a reason to boot into an explanation
 *   instead of serving the app.
 */
export function isPgliteOpenAbort(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	const trapped =
		error.name === "RuntimeError" ||
		/\bAborted\(/.test(error.message) ||
		/\bunreachable\b/.test(error.message)
	if (!trapped) return false
	return typeof error.stack === "string" && error.stack.includes("_pg_initdb")
}

export interface OpenFailureContext {
	dataDir: string
	dbPath: string
	/**
	 * The lock as it stood **before** this process took it. Read afterwards it
	 * is always our own, which would make the check meaningless.
	 */
	lockState: LockState | null
	lastShutdown: ShutdownMarker
	backups: BackupSummary
}

/**
 * Decide whether an open failure is a broken data directory, or something else
 * entirely that must keep propagating untouched.
 *
 * Three conditions, and each rules out a different thing that looks the same
 * from inside the trap:
 *
 * 1. **The signature** — see `isPgliteOpenAbort`.
 * 2. **The database is actually there.** A missing directory is a first run or
 *    a mistyped `SERENE_PUB_DATA_DIR`, and telling that owner their data is
 *    damaged would be a lie about data that never existed.
 * 3. **Nobody else has the lock.** A second live process opening one PGlite
 *    directory traps identically, and that already has its own handling — the
 *    refusal to start in `acquireDatabaseLock()`. `"self"` is excluded for the
 *    same reason one step in: a `vite dev` module re-execution holds its own
 *    lock and its own PGlite client, and the answer there is "restart the dev
 *    server", not "restore a backup". Both are named in `./index.ts`, and this
 *    is the seam that keeps them distinct.
 */
export function classifyDatabaseOpenFailure(
	error: unknown,
	context: OpenFailureContext
): DatabaseUnopenableError | null {
	if (!isPgliteOpenAbort(error)) return null
	if (!fs.existsSync(context.dbPath)) return null
	if (context.lockState === "held" || context.lockState === "self")
		return null

	return new DatabaseUnopenableError({
		dataDir: context.dataDir,
		dbPath: context.dbPath,
		lastShutdown: context.lastShutdown,
		backupsDir: context.backups.backupsDir,
		backupCount: context.backups.backupCount,
		newestBackup: context.backups.newestBackup,
		cause: error
	})
}

const SHUTDOWN_PHRASE: Record<ShutdownMarker, string> = {
	unclean:
		"unclean — the last run was force-quit, killed, or lost power, which is the usual cause",
	clean: "clean — the last run shut down normally, so this is not a force-quit",
	unknown: "unknown — no marker from the last run"
}

/**
 * The boot log's account of the failure, in plain words.
 *
 * Multi-line on purpose. This is read by somebody whose app has just stopped
 * working, quite possibly from a terminal they opened specifically to find out
 * why, and the three things they need are where the data is, whether there is a
 * backup, and the reassurance that nothing has been touched.
 */
export function describeDatabaseUnopenable(
	error: DatabaseUnopenableError
): string {
	const backups =
		error.backupCount > 0
			? `${error.backupsDir} — ${error.backupCount} file(s), newest: ${error.newestBackup}`
			: `${error.backupsDir} — no backups found`

	return [
		"[db] The database could not be opened. Serene Pub has started anyway, but",
		"     nothing that needs the database will work until this is resolved.",
		"",
		"     Nothing has been changed, moved or deleted. Your data directory is",
		"     exactly as it was.",
		"",
		`     Data directory:    ${error.dataDir}`,
		`     Database:          ${error.dbPath}`,
		`     Previous shutdown: ${SHUTDOWN_PHRASE[error.lastShutdown]}`,
		`     Backups:           ${backups}`,
		"",
		`     What to do:        ${TROUBLESHOOTING_DOC}`,
		`                        ${TROUBLESHOOTING_URL}`,
		"",
		`     Underlying error:  ${String(
			(error.cause as Error)?.message ?? error.cause
		)}`
	].join("\n")
}

/* --- a failed query ------------------------------------------------------ */
//
// Since drizzle-orm 0.44 every failed query is re-thrown as a
// `DrizzleQueryError` whose message is `Failed query: <sql>\nparams: <values>`,
// with the driver's own error — PGlite's, the one carrying the SQLSTATE `code`,
// the `constraint` and the `detail` — under `.cause`. So:
//
// - a check on `e.code` / `e.constraint` must read the driver error
//   (`sqlStateOf`, `isUniqueViolation`), never the wrapper;
// - the wrapper's message is for the server log only. The bound values are
//   whatever the query wrote — message text, lore, an encrypted key — so it
//   never reaches a person or the support report.
//
// Where that is enforced, from the source outwards:
// - the pipeline host answers a failed query with the plain sentence
//   (`errorWithoutQueryText`, `pipelines/runtime/host.ts`), and a receipt's
//   reasons are cleaned before the live row is finished or the run is stored
//   (`receiptWithoutQueryText`);
// - the stored reply error and an activity's error read the plain sentence
//   (`messageWithoutQueryText`, `utils/generationStatus.ts`,
//   `utils/activityStore.ts`);
// - every Socket.IO packet, whatever road it took, passes one guard
//   (`payloadWithoutQueryText`, `sockets/queryTextGuard.ts`);
// - a serialised `DrizzleQueryError` is the plain sentence (its `toJSON`,
//   below);
// - diagnostics that leave the machine keep the SQL and withhold the values
//   (`withoutQueryParams`: `utils/logRing.ts`, `redactForSupport`), and boot
//   reports keep the driver's own reason (`driverReasonOf`).
//
// "Driver error" is internal wording (code and comments), not vocabulary.

/**
 * What a person is told in place of a failed query's text.
 *
 * Plain on purpose: no SQL, no values, no constraint names. Where a handler
 * knows what the failure means (a unique violation, say) it says that instead;
 * this is for everything nobody worded.
 */
export const QUERY_FAILED_SENTENCE =
	"Something went wrong on the server. The server log has the details."

/** The marker drizzle's wrapper message starts with. */
const FAILED_QUERY_MARKER = "Failed query: "
/**
 * What `withoutQueryParams` leaves in place of drizzle's `params:` line.
 *
 * It carries no `params: ` of its own, on purpose: a withheld text is then
 * never mistaken for one with its values still in it, and no value can pass
 * for "already withheld" — a first bound value that reads `[withheld] …`
 * included.
 */
const PARAMS_WITHHELD = "[params withheld]"
/**
 * A failed query with its values still in it: the marker, then drizzle's
 * `params:` line — after a newline, after any space once a caller has
 * collapsed whitespace (`shortDownloadError`), or after an escaped `\n` in
 * text that holds JSON.
 */
const CARRIES_PARAMS = /Failed query: [\s\S]*?(?:\s|\\n)params: /

/**
 * The error the database driver raised, under drizzle's wrapper.
 *
 * Anything that is not a `DrizzleQueryError` (or one with no cause) is
 * returned as it came, so this is safe to call on any caught value.
 */
export function driverErrorOf(e: unknown): unknown {
	return e instanceof DrizzleQueryError && e.cause !== undefined ? e.cause : e
}

/** The SQLSTATE a driver error carries (`"23505"`, `"57014"`, …), if any. */
export function sqlStateOf(e: unknown): string | undefined {
	const code = (driverErrorOf(e) as { code?: unknown } | null)?.code
	return typeof code === "string" ? code : undefined
}

/**
 * Postgres' unique violation — of `constraint` when one is named (a unique
 * index's name counts: Postgres reports it as the constraint).
 */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
	if (sqlStateOf(e) !== "23505") return false
	return (
		constraint === undefined ||
		(driverErrorOf(e) as { constraint?: unknown }).constraint === constraint
	)
}

/** True for drizzle's wrapper: its message names SQL and bound values. */
export function isFailedQuery(e: unknown): e is DrizzleQueryError {
	return e instanceof DrizzleQueryError
}

/**
 * The reason the database gave, for a diagnostic that is not a person's
 * sentence but may leave the machine — a boot reconcile's report, an
 * install's refusal: the driver's own message under drizzle's wrapper
 * (`duplicate key value violates unique constraint "…"`), and a message that
 * quotes a failed query keeps its SQL and loses its values.
 */
export function driverReasonOf(e: unknown): string {
	const d = driverErrorOf(e)
	return withoutQueryParams(d instanceof Error ? d.message : String(d))
}

/**
 * The text with a failed query's SQL and values replaced by
 * `QUERY_FAILED_SENTENCE`. Words before the query are kept, so
 * `Character "Ada": Failed query: …` becomes `Character "Ada": Something went
 * wrong on the server. …`. Text without the marker is returned unchanged.
 */
export function withoutQueryText(text: string): string {
	const at = text.indexOf(FAILED_QUERY_MARKER)
	return at === -1 ? text : text.slice(0, at) + QUERY_FAILED_SENTENCE
}

/**
 * A caught error's message as a person may read it: drizzle's wrapper is the
 * plain sentence, and a message that quotes a failed query — a wrapper's
 * `${label}: ${e.message}`, a halted run's reason — keeps its own words and
 * loses the query. Anything else is its message (or `String(e)`) as it was.
 */
export function messageWithoutQueryText(e: unknown): string {
	if (isFailedQuery(e)) return QUERY_FAILED_SENTENCE
	return withoutQueryText(e instanceof Error ? e.message : String(e))
}

/**
 * A caught error that is safe to pass on as text: `e` itself when it carries
 * no failed query, otherwise a plain `Error` whose message is
 * `messageWithoutQueryText(e)`, with `e` as its `cause` so the server log
 * still prints the whole error. For a seam whose catcher keeps only
 * `e.message` — the SDK executor's node reason, a plugin failure reason.
 */
export function errorWithoutQueryText(e: unknown): unknown {
	const text =
		e instanceof Error ? e.message : typeof e === "string" ? e : null
	if (!isFailedQuery(e) && !text?.includes(FAILED_QUERY_MARKER)) return e
	return new Error(messageWithoutQueryText(e), { cause: e })
}

/**
 * The text with a failed query's bound values withheld and its SQL kept — for
 * diagnostics that leave the machine (the support report's log lines, a run's
 * stored reason), where the query's shape helps and its values are content.
 *
 * Nothing in drizzle's message says where its values end — a value may hold
 * newlines, quotes, or a line that reads like a stack frame — so in plain
 * text they are taken to run to the END OF THE TEXT, and anything after them
 * is withheld too: the safe direction. A caller that knows where a message
 * ends (an `Error`'s own `message`, inside its stack) passes just that
 * message. In JSON-escaped text (a payload logged as JSON) the values end at
 * the string's closing quote, which no value can forge. Idempotent: the
 * result carries no `params: ` line to withhold again.
 */
export function withoutQueryParams(text: string): string {
	if (!text.includes(FAILED_QUERY_MARKER)) return text
	return (
		text
			// Plain text first: a real newline (or a collapsed space) before
			// `params: `, values to the end.
			.replace(
				/(Failed query: [\s\S]*?\s)params: [\s\S]*/,
				`$1${PARAMS_WITHHELD}`
			)
			// JSON-escaped: inside one string literal, to its closing quote.
			.replace(
				/(Failed query: (?:[^"\\]|\\.)*?\\n)params: (?:[^"\\]|\\.)*/g,
				`$1${PARAMS_WITHHELD}`
			)
	)
}

/**
 * Does this text carry a whole failed-query message with its values — the
 * marker AND a `params:` line after it?
 *
 * The stricter test, for text that may be a person's own words or a whole
 * document: a message that merely quotes "Failed query: " is left alone, and
 * so is text whose values are already withheld (the support report quotes the
 * log ring, whose lines keep the SQL). Only drizzle's own shape, which always
 * has the `params:` line, is taken for an error.
 */
function carriesFailedQuery(text: string): boolean {
	return text.includes(FAILED_QUERY_MARKER) && CARRIES_PARAMS.test(text)
}

/** Deeper than any payload this app sends; a bound on a hostile shape. */
const PAYLOAD_DEPTH_MAX = 32

/**
 * A socket payload with no failed query's text in it — the backstop behind
 * every handler that forwards a caught `e.message`, wherever it put it.
 *
 * The whole value is walked the way `JSON.stringify` would see it — nested
 * objects, arrays, a class instance's own fields, a `toJSON` result — because
 * a failed query turns up as `{ result: { error } }` and
 * `{ failures: [{ error }] }` as readily as at the top. The rule for a string:
 * - in an `…:error` event every string is an error, so any marker is enough;
 * - anywhere else only drizzle's whole shape with its values still in it
 *   (`carriesFailedQuery`), so a person's own text is never rewritten and a
 *   document that quotes a withheld line — the support report — is sent
 *   whole.
 *
 * Copy-on-write: returns the very same value when there is nothing to
 * replace, and never mutates what it was given. Bytes (a Buffer, a typed
 * array, an ArrayBuffer) and functions pass through untouched. `onReplaced`
 * hears each original string, so the caller can put the whole error in the
 * server log. Walked only after a cheap test says a marker is present
 * (`sockets/queryTextGuard.ts`), so its cost is paid by failures alone.
 */
export function payloadWithoutQueryText<T>(
	event: string,
	data: T,
	onReplaced?: (original: string) => void
): T {
	const isError = event.endsWith(":error")
	const hit = (v: string) =>
		isError ? v.includes(FAILED_QUERY_MARKER) : carriesFailedQuery(v)
	// One answer per object, so a value shared by two keys is cleaned at
	// both; `active` stops a cycle (which JSON.stringify would refuse anyway).
	const done = new Map<object, unknown>()
	const active = new Set<object>()
	const walkObject = (value: object, depth: number): unknown => {
		if (Array.isArray(value)) {
			let out: unknown[] | null = null
			for (let i = 0; i < value.length; i++) {
				const next = walk(value[i], depth + 1)
				if (next !== value[i]) (out ??= value.slice())[i] = next
			}
			return out ?? value
		}
		// What JSON.stringify would send for it: a `toJSON` answer (a Date's
		// string, a failed query's plain sentence) is walked in its place.
		const toJSON = (value as { toJSON?: unknown }).toJSON
		if (typeof toJSON === "function") {
			const json = toJSON.call(value)
			const next = walk(json, depth + 1)
			return next === json ? value : next
		}
		const source = value as Record<string, unknown>
		let out: Record<string, unknown> | null = null
		for (const key of Object.keys(source)) {
			const next = walk(source[key], depth + 1)
			if (next !== source[key]) (out ??= { ...source })[key] = next
		}
		return out ?? value
	}
	const walk = (value: unknown, depth: number): unknown => {
		if (typeof value === "string") {
			if (!hit(value)) return value
			onReplaced?.(value)
			return withoutQueryText(value)
		}
		if (typeof value !== "object" || value === null) return value
		if (done.has(value)) return done.get(value)
		if (depth > PAYLOAD_DEPTH_MAX || active.has(value)) return value
		if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer)
			return value
		active.add(value)
		const result = walkObject(value, depth)
		active.delete(value)
		done.set(value, result)
		return result
	}
	return walk(data, 0) as T
}

/**
 * A failed query serialised is the plain sentence and its SQLSTATE.
 *
 * drizzle sets `query`, `params` and `cause` as ordinary enumerable fields, so
 * `JSON.stringify(e)` — a socket payload, a jsonb column, an HTTP body, the
 * log ring's JSON of an object that holds one — would otherwise carry every
 * value the query wrote. The server log is unaffected: `console.error`
 * inspects an error, it does not serialise it. A method drizzle does not
 * define, added to its exported class (not an internal), so an upgrade cannot
 * silently undo it without the test in `errors.failedQuery.test.ts` failing.
 */
Object.defineProperty(DrizzleQueryError.prototype, "toJSON", {
	value: function toJSON(this: DrizzleQueryError) {
		const code = sqlStateOf(this)
		return code
			? { message: QUERY_FAILED_SENTENCE, code }
			: { message: QUERY_FAILED_SENTENCE }
	},
	writable: true,
	configurable: true,
	enumerable: false
})
