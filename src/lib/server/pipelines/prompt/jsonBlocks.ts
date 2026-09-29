/**
 * Cutting a JSON block out of a line of prose.
 *
 * A model imitates the last thing it read, and a multi-agent turn writes JSON
 * into the same session the next turn reads back. Once one reply carries a
 * planner's document at the end of it, every later planner sees its own schema
 * in the transcript and every later keeper sees the PLANNER's — which is how a
 * state keeper answers with `{beats, speakers, worldHints}` and proposes
 * nothing.
 *
 * So the JSON steps read the conversation as prose. The cut happens on the way
 * into their prompt and never on the stored row: the block is part of what the
 * model actually said, a swipe and an edit both work from the stored text, and a
 * repair that rewrites history would make the receipt disagree with the session.
 *
 * ## The rule has edges, which is why this is its own function
 *
 * A brace inside a sentence is not a block. A fence holding a shell command is
 * not a block. What counts is a fenced or bare value that PARSES as a JSON
 * object or array — parsing is the test, not a shape-matching regex, because
 * the failure this exists to stop is a document and a document is exactly the
 * thing `JSON.parse` recognises.
 */

/**
 * Is this a block, as opposed to a number or a string that happens to parse?
 *
 * Scalars are excluded deliberately: a reply ending in `42` is a reply ending
 * in a number, and cutting it would take a sentence's last word away.
 */
function isDocument(text: string): boolean {
	const trimmed = text.trim()
	if (!trimmed) return false
	const first = trimmed[0]
	if (first !== "{" && first !== "[") return false
	try {
		const parsed = JSON.parse(trimmed)
		return typeof parsed === "object" && parsed !== null
	} catch {
		return false
	}
}

/** ```json … ``` and ``` … ```, wherever they sit. */
const FENCE = /```[ \t]*([A-Za-z0-9_-]*)[ \t]*\r?\n?([\s\S]*?)```/g

function stripFenced(text: string): string {
	return text.replace(FENCE, (whole, info: string, body: string) => {
		const label = (info || "").toLowerCase()
		// An unlabelled fence counts, because a model that was told to answer
		// with JSON and reached for a fence rarely labels it. A fence labelled
		// as something else is somebody's code and is left alone.
		if (label && label !== "json") return whole
		return isDocument(body) ? "" : whole
	})
}

/**
 * The end of the value that starts at `from`, or -1.
 *
 * String-aware, because a brace inside a quoted string closes nothing and a
 * naive depth count walks off the end of the message.
 */
function endOfValue(text: string, from: number): number {
	const open = text[from]
	const close = open === "{" ? "}" : "]"
	let depth = 0
	let inString = false
	let escaped = false
	for (let i = from; i < text.length; i++) {
		const ch = text[i]!
		if (inString) {
			if (escaped) escaped = false
			else if (ch === "\\") escaped = true
			else if (ch === '"') inString = false
			continue
		}
		if (ch === '"') inString = true
		else if (ch === open) depth++
		else if (ch === close) {
			depth--
			if (depth === 0) return i + 1
		}
	}
	return -1
}

/**
 * A bare block, at the start of a line.
 *
 * The line boundary is what keeps `He muttered {something} and left.` intact:
 * the contamination this cuts is always a document the model started on a fresh
 * line after its prose, and requiring that costs nothing while a scan over every
 * brace in the message would eventually eat a sentence.
 */
function stripBare(text: string): string {
	let out = ""
	let i = 0
	let atLineStart = true
	while (i < text.length) {
		const ch = text[i]!
		if (atLineStart && (ch === "{" || ch === "[")) {
			const end = endOfValue(text, i)
			if (end > i && isDocument(text.slice(i, end))) {
				i = end
				// Whatever whitespace followed the block belongs to the block:
				// leaving it produces a paragraph break with nothing in it.
				while (i < text.length && /\s/.test(text[i]!)) i++
				atLineStart = true
				continue
			}
		}
		out += ch
		atLineStart =
			ch === "\n" || (atLineStart && (ch === " " || ch === "\t"))
		i++
	}
	return out
}

/**
 * Prose only: fenced blocks, then bare ones, then the holes they left.
 *
 * Returns `""` when the text was nothing but a block, which is a real answer —
 * the caller decides whether a line with no prose in it belongs in a transcript
 * at all.
 */
export function stripJsonBlocks(text: string): string {
	if (!text) return text
	const cut = stripBare(stripFenced(text))
	if (cut === text) return text
	return cut.replace(/\n{3,}/g, "\n\n").trim()
}
