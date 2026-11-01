/**
 * Typographic quotes for display: straight `"` become “ ” and straight `'`
 * become ’ (‘ when it opens a word). A quote opens after the start of the
 * text, whitespace, an opening bracket, a dash or an opening curly quote;
 * anywhere else it closes.
 * Text already curly passes through untouched. Display only — never the
 * value that is sent.
 */
export function curlyQuotes(text: string): string {
	// An opening curly quote counts too: a filled preview reads “"Stay…" —
	// the template's own quote, then the line's.
	const opens = (prev: string | undefined) => prev === undefined || /[\s(\[{<—–\-“‘]/.test(prev)
	let out = ""
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch === '"') out += opens(text[i - 1]) ? "“" : "”"
		else if (ch === "'") out += opens(text[i - 1]) ? "‘" : "’"
		else out += ch
	}
	return out
}
