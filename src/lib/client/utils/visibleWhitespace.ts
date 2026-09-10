/**
 * Whitespace, shown.
 *
 * Delimiters are mostly invisible characters — `"### User:\n"` is a line of
 * text and a newline, and a control that renders it faithfully renders the
 * newline as a line break, which tells the author nothing about whether it is
 * there, whether there are two of them, or whether the line ends in a space.
 * That is precisely the thing a person authoring a completion template is
 * trying to see.
 *
 * So: newlines, tabs and carriage returns become their escapes, and a trailing
 * space becomes `␣` — trailing, because a space in the MIDDLE of a marker reads
 * fine and one at the end is invisible and load-bearing (`"Human: "`).
 *
 * Display only. Nothing round-trips through this — the stored value is always
 * the real characters.
 */
export function visibleWhitespace(text: string | null | undefined): string {
	if (!text) return ""
	return text
		.replace(/\r/g, "\\r")
		.replace(/\n/g, "\\n")
		.replace(/\t/g, "\\t")
		.replace(/ +$/, (run) => "␣".repeat(run.length))
}
