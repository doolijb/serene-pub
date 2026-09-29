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

function stringifyArg(arg: unknown): string {
	if (typeof arg === "string") return arg
	if (arg instanceof Error) {
		// The message and the top of the stack: enough to find the line,
		// without twenty frames of node internals per entry.
		const stack = (arg.stack ?? `${arg.name}: ${arg.message}`)
			.split("\n")
			.slice(0, 4)
			.join("\n")
		return stack
	}
	if (arg === undefined) return "undefined"
	try {
		const json = JSON.stringify(arg)
		return json === undefined ? String(arg) : json
	} catch {
		return String(arg)
	}
}

/** Record one console call. Never throws: a failing log must not take its caller down. */
export function recordLogLine(level: "warn" | "error", args: unknown[]): void {
	try {
		let text = args.map(stringifyArg).join(" ").replace(ANSI, "")
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
