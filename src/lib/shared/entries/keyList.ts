/**
 * An entry's keys as the list they are, on the client side of the wire
 * (finding #146).
 *
 * The column is `text[]`, the wire carries `string[]`, and the editor draws one
 * chip per element. Nothing between the editor and the matcher joins a list
 * into one string or splits one back, because a key may contain a comma — a
 * regex quantifier `\w{2,4}`, a literal "Smith, John" — and a join-then-split
 * tears it in two.
 *
 * The one comma split left is `keyList` on a *string*: a legacy value (an
 * amendment stored before keys were a list) arriving where a list is expected.
 * It is split once, on the way in, the way the server's `keysToArray` does.
 */

/** A key list as it may arrive: the list, or a legacy comma string. */
export type KeyListInput = string | readonly unknown[] | null | undefined

/**
 * The list, trimmed, empties dropped, duplicates dropped (the chips are keyed
 * on the word, so one key twice is one chip). An array is never re-split.
 */
export function keyList(value: KeyListInput): string[] {
	const raw: readonly unknown[] = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(",")
			: []
	const out: string[] = []
	for (const item of raw) {
		if (typeof item !== "string") continue
		const key = item.trim()
		if (key && !out.includes(key)) out.push(key)
	}
	return out
}

/** A key list as one line a person reads (a search haystack, a summary). */
export const keysText = (value: KeyListInput): string => keyList(value).join(", ")

/**
 * Whether a comma typed at the end of `typed` is still inside the key rather
 * than between two keys.
 *
 * In a regex entry a comma is part of the pattern (`{2,4}`, `(a|b,c)`), so it
 * never ends the key there — Enter does. In a literal entry a comma ends the
 * key, except where the typed text is plainly a pattern in progress: a `/…/`
 * literal, or an open `{`, `[` or `(`.
 */
export function commaStaysInKey(typed: string, regex: boolean): boolean {
	if (regex) return true
	const text = typed.trimStart()
	if (text.startsWith("/")) return true
	return openGroups(text) > 0
}

/**
 * The keys a committed piece of typing (or a paste) makes.
 *
 * A regex entry's typing is ONE key, whatever commas it holds. A literal
 * entry's is split on the commas outside any bracket group, so a pasted
 * "tavern, inn" is two chips while a stray `{1,3}` is not torn.
 */
export function keysFromTyping(typed: string, regex: boolean): string[] {
	const text = typed.trim().replace(/,+$/, "").trim()
	if (!text) return []
	if (regex || text.startsWith("/")) return [text]
	const parts: string[] = []
	let depth = 0
	let start = 0
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch === "\\") {
			i++
			continue
		}
		if (ch === "{" || ch === "[" || ch === "(") depth++
		else if ((ch === "}" || ch === "]" || ch === ")") && depth > 0) depth--
		else if (ch === "," && depth === 0) {
			parts.push(text.slice(start, i))
			start = i + 1
		}
	}
	parts.push(text.slice(start))
	return keyList(parts)
}

/** `list` with `added` appended, keeping order and dropping repeats. */
export const withKeys = (list: readonly string[], added: readonly string[]) =>
	keyList([...list, ...added])

/** `list` without `key`. */
export const withoutKey = (list: readonly string[], key: string) =>
	list.filter((k) => k !== key)

function openGroups(text: string): number {
	let depth = 0
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]
		if (ch === "\\") {
			i++
			continue
		}
		if (ch === "{" || ch === "[" || ch === "(") depth++
		else if ((ch === "}" || ch === "]" || ch === ")") && depth > 0) depth--
	}
	return depth
}
