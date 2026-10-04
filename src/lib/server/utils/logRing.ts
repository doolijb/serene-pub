/**
 * The **log ring** — the last few hundred console warnings and errors, kept
 * in memory so the admin support report (`admin/supportReport`) can say what
 * the server complained about without anyone opening a terminal.
 *
 * Fed by `installPrettyConsole`'s wrapper, so it sees every `console.warn` /
 * `console.error` in the process. Bounded (`LOG_RING_SIZE` lines, each cut to
 * `LOG_LINE_MAX` characters) and never written anywhere: a restart empties
 * it. Lines are stored as logged; redaction happens when a report is made,
 * because that is the one place that knows the instance's user names.
 *
 * Kept on `globalThis` rather than in a module variable: a Vite SSR reload
 * can load this module twice, and the half that records and the half that
 * reads must still share one ring.
 */

import { DrizzleQueryError } from "drizzle-orm"
import { withoutQueryParams } from "$lib/server/db/errors"

export const LOG_RING_SIZE = 300
export const LOG_LINE_MAX = 600

export interface LogRingLine {
	/** ISO 8601. */
	at: string
	level: "warn" | "error"
	text: string
}

const RING_KEY = Symbol.for("serene-pub.logRing")

function ring(): LogRingLine[] {
	const g = globalThis as unknown as Record<symbol, LogRingLine[] | undefined>
	return (g[RING_KEY] ??= [])
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g

/**
 * A failed query as the ring keeps it: the reason Postgres gave (SQLSTATE,
 * constraint, message — read off the driver error under drizzle's wrapper)
 * and the query's shape, never its bound values. The wrapper's own message is
 * `Failed query: <sql>\nparams: <values>`, and the values are whatever the
 * query wrote — message text, lore — which the support report promises never
 * to carry.
 */
function describeFailedQuery(e: DrizzleQueryError): string {
	const c = e.cause as
		| { code?: unknown; constraint?: unknown; message?: unknown }
		| undefined
	const code = typeof c?.code === "string" ? c.code : "no sqlstate"
	const constraint = typeof c?.constraint === "string" ? ` ${c.constraint}` : ""
	const reason = typeof c?.message === "string" ? c.message : "no cause"
	const query = String(e.query ?? "").replace(/\s+/g, " ").slice(0, 200)
	return `Failed query (${code}${constraint}): ${reason}\n  query: ${query}`
}

/**
 * An error's stack with any failed query in its MESSAGE withheld
 * (`withoutQueryParams`) and its frames kept.
 *
 * The message is known exactly here, so the values end where it ends. Read
 * off the whole stack instead, nothing would say where they stop — a value
 * may hold a line like `   at the crossroads`, which a frame-shaped rule
 * would take for the stack and leave the rest of the value in the ring.
 */
function stackWithoutQueryParams(e: Error): string {
	const stack = e.stack ?? `${e.name}: ${e.message}`
	const message = withoutQueryParams(e.message)
	if (message === e.message) return withoutQueryParams(stack)
	const at = stack.indexOf(e.message)
	// A stack that does not hold the message verbatim (it was set after the
	// stack was taken) is withheld to its end — the safe direction.
	return at === -1
		? withoutQueryParams(stack)
		: stack.slice(0, at) + message + stack.slice(at + e.message.length)
}

function stringifyArg(arg: unknown): string {
	// Strings and JSON are withheld to the end of the text (or the JSON
	// string) — nothing in them says where a failed query's values stop.
	if (typeof arg === "string") return withoutQueryParams(arg)
	if (arg instanceof DrizzleQueryError) return describeFailedQuery(arg)
	if (arg instanceof Error) {
		// The message and the top of the stack: enough to find the line,
		// without twenty frames of node internals per entry.
		const stack = stackWithoutQueryParams(arg)
			.split("\n")
			.slice(0, 4)
			.join("\n")
		// One line for a cause, so a wrapped reason (a guard refusal, a
		// driver error re-thrown with context) reaches the ring too.
		const cause = arg.cause
		if (cause instanceof DrizzleQueryError)
			return `${stack}\n  caused by: ${describeFailedQuery(cause)}`
		if (cause instanceof Error)
			return `${stack}\n  caused by: ${cause.name}: ${withoutQueryParams(cause.message)}`
		return stack
	}
	if (arg === undefined) return "undefined"
	try {
		// A failed query inside serialises as its plain sentence (its
		// `toJSON`, `db/errors.ts`); a message string inside is withheld.
		const json = JSON.stringify(arg)
		return json === undefined ? String(arg) : withoutQueryParams(json)
	} catch {
		return withoutQueryParams(String(arg))
	}
}

/** Record one console call. Never throws: a failing log must not take its caller down. */
export function recordLogLine(level: "warn" | "error", args: unknown[]): void {
	try {
		// Each argument withholds a failed query's values (`stringifyArg`);
		// the pass over the whole line is a backstop, and a no-op on what the
		// arguments already withheld (the result has no `params:` line).
		let text = withoutQueryParams(
			args.map(stringifyArg).join(" ").replace(ANSI, "")
		)
		if (text.length > LOG_LINE_MAX) text = text.slice(0, LOG_LINE_MAX) + " …"
		const r = ring()
		r.push({ at: new Date().toISOString(), level, text })
		if (r.length > LOG_RING_SIZE) r.splice(0, r.length - LOG_RING_SIZE)
	} catch {
		// Deliberately silent — see above.
	}
}

/** Oldest first; a copy. */
export function readLogRing(): LogRingLine[] {
	return ring().slice()
}

/** Tests only. */
export function clearLogRing(): void {
	ring().length = 0
}
