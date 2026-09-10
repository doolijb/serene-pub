/**
 * Backslash escapes for text whose whitespace is the point.
 *
 * A completion template's markers are mostly invisible: `"### User:\n"` is nine
 * characters and a newline, and `"Human: "` ends in a space that decides
 * whether a model sees `Human: Bob` or `Human:Bob`. Neither survives a
 * single-line `<input>`, and neither is legible in a `<textarea>` — a trailing
 * newline there is an empty line the author cannot tell from no line at all.
 *
 * So the editor shows and takes ESCAPES: the author types `\n`, sees `\n`, and
 * the column stores the real character. This is the one conversion between the
 * two, in one place, because a display encoder that does not round-trip through
 * its decoder writes bytes nobody meant into every prompt on the instance.
 *
 * `escapedText.test.ts` pins the round trip over the shipped markers.
 */

/** Real text → what the editor shows. */
export function toEscaped(text: string | null | undefined): string {
	if (!text) return ""
	return text
		.replace(/\\/g, "\\\\")
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t")
}

/**
 * What the editor shows → real text.
 *
 * An escape this does not know is left EXACTLY as typed, backslash and all —
 * `\d` stays `\d`. Swallowing the backslash would quietly delete a character
 * from a marker; inventing a meaning for it would put one in.
 */
export function fromEscaped(text: string | null | undefined): string {
	if (!text) return ""
	let out = ""
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch !== "\\") {
			out += ch
			continue
		}
		const next = text[i + 1]
		if (next === "n") {
			out += "\n"
			i++
		} else if (next === "r") {
			out += "\r"
			i++
		} else if (next === "t") {
			out += "\t"
			i++
		} else if (next === "\\") {
			out += "\\"
			i++
		} else {
			// A lone trailing backslash, or one before anything else: kept.
			out += "\\"
		}
	}
	return out
}
