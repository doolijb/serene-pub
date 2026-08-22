/**
 * Character Card V3 `@@decorator` stripping for lorebook entry content.
 * The spec says unrecognized/unimplemented decorators SHOULD be ignored by
 * the consuming app — this strips them so they don't leak into the
 * rendered prompt as literal text, without acting on any decorator
 * behavior yet. Spec:
 * https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md
 */

export type ParsedDecorator = {
	name: string
	value: string
	/** true for a `@@@` (3+ "@") fallback-chain line, false for a primary `@@` line. */
	fallback: boolean
}

// Anchored to the start of the line (after optional leading whitespace) so
// ordinary text containing "@@" mid-string (e.g. an email-like token)
// never matches. Unbounded `@{2,}` rather than a `{2,3}` cap so a
// fallback-chain line (`@@@fallback value`) is recognized by the same
// pattern as a primary `@@decorator value` line.
const DECORATOR_LINE_PATTERN = /^\s*(@{2,})(\S+)(?:[ \t]+(.*))?\s*$/

export function stripCardDecorators(content: string): {
	content: string
	decorators: ParsedDecorator[]
} {
	if (!content) return { content, decorators: [] }

	const lines = content.split("\n")
	const decorators: ParsedDecorator[] = []
	const toRemove = new Set<number>()

	for (let i = 0; i < lines.length; i++) {
		const match = DECORATOR_LINE_PATTERN.exec(lines[i])
		if (!match) continue
		decorators.push({
			name: match[2].toLowerCase(),
			value: (match[3] ?? "").trim(),
			fallback: match[1].length >= 3
		})
		toRemove.add(i)
	}

	if (decorators.length === 0) return { content, decorators }

	// Per the spec, "newlines before and after a decorator block should be
	// trimmed along with it" — swallow one directly-adjacent blank line on
	// each side of every contiguous decorator block, so removing the block
	// doesn't leave a blank-line gap behind. Only the one touching blank
	// line is claimed, not runs of them — this closes the gap the block
	// itself created without touching the author's own paragraph spacing
	// elsewhere in the entry.
	//
	// The loop below anchors only on the original decorator-line indices
	// (never on a blank line it just swallowed) — otherwise a swallowed
	// blank line would itself be treated as a new "block" on the next
	// iteration and cascade into claiming a second, unrelated blank line.
	const blankPadding = new Set<number>()
	let i = 0
	while (i < lines.length) {
		if (!toRemove.has(i)) {
			i++
			continue
		}
		let end = i
		while (end + 1 < lines.length && toRemove.has(end + 1)) end++
		if (i > 0 && lines[i - 1].trim() === "" && !toRemove.has(i - 1)) {
			blankPadding.add(i - 1)
		}
		if (
			end + 1 < lines.length &&
			lines[end + 1].trim() === "" &&
			!toRemove.has(end + 1)
		) {
			blankPadding.add(end + 1)
		}
		i = end + 1
	}

	const finalRemove = new Set([...toRemove, ...blankPadding])
	const kept = lines.filter((_, idx) => !finalRemove.has(idx))
	return { content: kept.join("\n"), decorators }
}
