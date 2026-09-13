import type { PoolItem } from "./poolFilter"

/**
 * Whether one row is named in some text — the matcher every reference is built
 * on.
 *
 * ⚠ **A mention is a text match, never a retrieval decision.** The engine
 * weighs regex keys, case sensitivity, trigram folding and a scan window; this
 * looks for a word in one string. It answers "what else in this book talks
 * about this", which is the question a reader asks before deleting something;
 * the Read in? tab is what answers whether an entry reached a prompt, and the
 * Refs board's own copy has to keep saying so.
 */

const KEYWORD_ESCAPE = /[.*+?^${}()|[\]\\]/g

/**
 * Whether a keyword appears in the text as a word of its own.
 *
 * `\b` is asserted only on an edge that is itself a word character: a keyword
 * spelled `{{char:1}}` has punctuation at both ends, and a boundary asserted
 * there can never match — which would silently drop every binding tag from
 * every reference list.
 */
export function mentions(text: string, keyword: string): boolean {
	const left = /^\w/.test(keyword) ? "\\b" : ""
	const right = /\w$/.test(keyword) ? "\\b" : ""
	const pattern = keyword.replace(KEYWORD_ESCAPE, "\\$&")
	return new RegExp(`${left}${pattern}${right}`, "i").test(text)
}

/** The keywords as authored: comma-delimited, trimmed, blanks dropped. */
export function keywordsOf(item: PoolItem): string[] {
	return item.keys
		.split(",")
		.map((k) => k.trim())
		.filter(Boolean)
}
