/**
 * How much STRUCTURE an imported JSON text may build, measured on the text
 * before `JSON.parse` (lorebooks plan S4, review).
 *
 * The byte ceilings (`IMPORT_FILE_CAPS`) bound a file's size, not what parsing
 * it costs: V8 spends ~64 bytes on an empty object and 3 bytes of text write
 * one, so a 16 MiB card JSON of `{}`s parsed to 5.6 million objects, and the
 * card reader's clone of it (`toSpecV3`) doubled that — +716 MB of heap for
 * ONE import under every byte ceiling, and two people with two imports each
 * took the server past its heap limit. A text is refused here past
 * `IMPORT_JSON_LIMITS.maxItems` pieces of data, which bounds every parsed
 * copy to tens of megabytes whatever the file holds.
 *
 * It is refused past `maxDepth` levels of nesting too: `JSON.parse` itself
 * reads a million nested lists, but the recursive walks after it (the clone,
 * a canonical hash) overflowed the stack and reached the person as "Maximum
 * call stack size exceeded".
 *
 * ⚠ One pass, no allocation, stops at the first ceiling it crosses. It does
 * not validate the JSON — a text it passes may still fail to parse, and the
 * caller's parse says so in its own sentence.
 */

export const IMPORT_JSON_LIMITS = {
	/**
	 * Pieces of data: every object, list, string, number, true, false and
	 * null — a key and its value count once. A SillyTavern book at the
	 * 5,000-entry ceiling, 49 to an entry, is 245,000; a million parsed `{}`s
	 * cost 64 MB, and the card reader's clone of them 64 MB more.
	 */
	maxItems: 1_000_000,
	/** Levels of nesting. A card or book nests about ten deep. */
	maxDepth: 64
} as const

const OPEN_OBJECT = 0x7b // {
const OPEN_LIST = 0x5b // [
const CLOSE_OBJECT = 0x7d // }
const CLOSE_LIST = 0x5d // ]
const COMMA = 0x2c
const QUOTE = 0x22
const BACKSLASH = 0x5c
const isSpace = (c: number) =>
	c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09

const fmt = (n: number) => n.toLocaleString("en")

/**
 * Throws a sentence beginning with `subject` ("This card's JSON", "This
 * lorebook file") when `text` would parse to more than
 * `IMPORT_JSON_LIMITS.maxItems` pieces of data or nest deeper than
 * `maxDepth`.
 *
 * Counted as the parse would build them without building them: the root, then
 * one more for every comma between members and for the first member of every
 * object or list that has one.
 */
export function assertImportJsonShape(text: string, subject: string): void {
	const { maxItems, maxDepth } = IMPORT_JSON_LIMITS
	let items = 1
	let depth = 0
	/** The last structural character opened an object or list. */
	let opened = false
	const n = text.length
	for (let i = 0; i < n && items <= maxItems; i++) {
		const c = text.charCodeAt(i)
		if (isSpace(c)) continue
		if (opened) {
			opened = false
			if (c !== CLOSE_OBJECT && c !== CLOSE_LIST) items++
		}
		if (c === QUOTE) {
			// Jump to the closing quote: the next one not escaped by an odd
			// run of backslashes. An unterminated string ends the scan; the
			// parse will refuse it.
			let end = i
			for (;;) {
				end = text.indexOf('"', end + 1)
				if (end < 0) return
				let slashes = 0
				while (text.charCodeAt(end - 1 - slashes) === BACKSLASH)
					slashes++
				if (slashes % 2 === 0) break
			}
			i = end
		} else if (c === OPEN_OBJECT || c === OPEN_LIST) {
			if (++depth > maxDepth) {
				throw new Error(
					`${subject} is nested more than ${fmt(maxDepth)} levels deep; Serene Pub reads up to ${fmt(maxDepth)}.`
				)
			}
			opened = true
		} else if (c === CLOSE_OBJECT || c === CLOSE_LIST) {
			depth--
		} else if (c === COMMA) {
			items++
		}
	}
	if (items > maxItems) {
		throw new Error(
			`${subject} holds more than ${fmt(maxItems)} pieces of data; Serene Pub reads up to ${fmt(maxItems)}.`
		)
	}
}
