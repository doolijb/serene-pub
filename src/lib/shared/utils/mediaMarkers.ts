/**
 * **Media markers** — how a placed attachment travels through a rendered
 * prompt to the turn it belongs to (PLAN-composer-attachments §3.5).
 *
 * `core:task/place-attachments@1` writes `<@media:{uuid}>` into a line's
 * `attachments`; the template renders it inside that line's role block; and
 * `parseSplitChatPrompt` lifts it back out onto that message's
 * `attachments`, removing it from the text. The same in-band round trip the
 * role markers make (`ROLE_MARKER_PATTERN`), with the same hazard: a marker
 * a person TYPES would be lifted exactly like one placement wrote.
 *
 * So the three pieces live together, and the neutraliser is applied to
 * every string a template can render EXCEPT a line's `attachments` — the one
 * value placement produced (`neutralizeRenderScope`, called by `render` in
 * `assemble.ts`). Placement neutralises the names, descriptions and text it
 * copies into that value itself. A forged uuid would still be refused at
 * dispatch (ownership), but the marker must not be forgeable to begin with.
 *
 * Neutralised exactly as a role marker is: a zero-width space between the
 * word and the colon (written as an escape, never pasted), invisible to a
 * reader and not a match.
 */

/** The marker, as a pattern SOURCE — each consumer wraps it as it needs. */
export const MEDIA_MARKER_PATTERN = "<@media:([A-Za-z0-9-]{1,64})>"

/** What a placed marker looks like, for the one writer. */
export const mediaMarker = (uuid: string): string => `<@media:${uuid}>`

const OPENER = /<@media:/g

/** Break every marker in `text` so no parser lifts it. */
export function neutralizeMediaMarkers(text: string): string {
	return text.includes("<@media:")
		? text.replace(OPENER, "<@media​:")
		: text
}

/** What a stray marker becomes in a flat (completion) render. */
export const FLAT_MEDIA_PLACEHOLDER = "[attachment]"

/** Replace every live marker in a flat render with its placeholder. */
export function flattenMediaMarkers(text: string): string {
	return text.includes("<@media:")
		? text.replace(new RegExp(MEDIA_MARKER_PATTERN, "g"), FLAT_MEDIA_PLACEHOLDER)
		: text
}

/**
 * Lift the markers out of one message's text: the uuids in order, and the
 * text without them (trimmed, as the parser trims every block).
 */
export function liftMediaMarkers(text: string): {
	content: string
	uuids: string[]
} {
	if (!text.includes("<@media:")) return { content: text, uuids: [] }
	const uuids: string[] = []
	const content = text
		.replace(new RegExp(MEDIA_MARKER_PATTERN, "g"), (_m, uuid: string) => {
			uuids.push(uuid)
			return ""
		})
		// A marker on its own line leaves the line behind; collapse what it left.
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
	return { content, uuids }
}

/**
 * Every string in a template's scope, neutralised — except each transcript
 * line's `attachments`, which placement wrote and neutralised itself.
 *
 * A copy: the input is never mutated. Plain objects and arrays are walked;
 * anything else (a Date, a class instance) is passed through. Returns the
 * input itself when nothing in it holds a marker, so a prompt with none
 * renders from the very object it always did.
 */
export function neutralizeRenderScope<T>(scope: T): T {
	if (!holdsMarker(scope, 0)) return scope
	return walk(scope, 0) as T
}

const MAX_DEPTH = 32

function isPlain(v: unknown): v is Record<string, unknown> {
	if (!v || typeof v !== "object") return false
	const proto = Object.getPrototypeOf(v)
	return proto === Object.prototype || proto === null
}

function holdsMarker(v: unknown, depth: number): boolean {
	if (depth > MAX_DEPTH) return false
	if (typeof v === "string") return v.includes("<@media:")
	if (Array.isArray(v)) return v.some((x) => holdsMarker(x, depth + 1))
	if (isPlain(v))
		return Object.entries(v).some(
			([k, x]) => k !== "sessionMessages" && holdsMarker(x, depth + 1)
		) || holdsMarkerInLines((v as { sessionMessages?: unknown }).sessionMessages, depth)
	return false
}

function holdsMarkerInLines(lines: unknown, depth: number): boolean {
	if (!Array.isArray(lines)) return false
	return lines.some((line) =>
		isPlain(line)
			? Object.entries(line).some(
					([k, x]) => k !== "attachments" && holdsMarker(x, depth + 2)
				)
			: holdsMarker(line, depth + 1)
	)
}

function walk(v: unknown, depth: number): unknown {
	if (depth > MAX_DEPTH) return v
	if (typeof v === "string") return neutralizeMediaMarkers(v)
	if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
	if (!isPlain(v)) return v
	const out: Record<string, unknown> = {}
	for (const [k, x] of Object.entries(v)) {
		out[k] =
			k === "sessionMessages" && Array.isArray(x)
				? x.map((line) => walkLine(line, depth + 1))
				: walk(x, depth + 1)
	}
	return out
}

function walkLine(line: unknown, depth: number): unknown {
	if (!isPlain(line)) return walk(line, depth)
	const out: Record<string, unknown> = {}
	for (const [k, x] of Object.entries(line))
		out[k] = k === "attachments" ? x : walk(x, depth + 1)
	return out
}
