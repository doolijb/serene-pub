/** Joins a list of names into a grammatically correct, Oxford-comma string:
 * `[]` -> `""`, `["A"]` -> `"A"`, `["A","B"]` -> `"A and B"`,
 * `["A","B","C"]` -> `"A, B, and C"`. */
export function joinWithAnd(items: string[]): string {
	const filtered = items.filter((s) => !!s && s.trim().length > 0)
	if (filtered.length === 0) return ""
	if (filtered.length === 1) return filtered[0]
	if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`
	return `${filtered.slice(0, -1).join(", ")}, and ${filtered[filtered.length - 1]}`
}
