/**
 * The documentation, as jump hits.
 *
 * The docs are the one thing Jump searches WITHOUT asking the server
 * (`CLIENT_JUMP_KINDS`): the search index is already a chunk of this bundle,
 * and the documentation is the same for every reader, so there is nothing for a
 * handler to decide and nothing to fetch twice.
 *
 * One module because there are two callers — the Jump overlay's Everywhere and
 * `doc:` lanes, and the Help view's registered scope — and two rankings of the
 * same index would be two documentations. `searchDocSections` is pure so the
 * ranking can be pinned without a compiled docs-dist.
 */

import type { JumpHit } from "$lib/shared/sockets/jump"
import {
	getDocMeta,
	loadSearchIndex,
	type DocSection
} from "$lib/shared/utils/docsIndex"

/** The words of a query: lowercased, split on whitespace, repeats dropped. */
export function queryWords(query: string): string[] {
	return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))]
}

/**
 * Guides first, then reference. The SDK reference is two thirds of the index
 * and reads like a spec; a reader who typed "lorebook" wants the guide on
 * lorebooks before any declaration that mentions one.
 */
const REFERENCE_PENALTY = 100

/**
 * How well a section answers the query. Lower sorts first; null is no match.
 *
 * Every word has to appear somewhere — in the heading, the page's title or the
 * section's text — in any order. Where they appear decides the rank: the whole
 * query in the heading beats every word in the heading, which beats a heading
 * that needed the page title or the prose to complete it, which beats the
 * prose alone. A page's own H1 wins a tie, because "Sessions" the page is a
 * better answer to "sessions" than any subsection of it.
 */
function rankOf(
	section: DocSection,
	words: string[],
	phrase: string,
	pageTitle: string,
	isReference: boolean
): number | null {
	const title = section.title.toLowerCase()
	const page = pageTitle.toLowerCase()
	const body = (section.text || section.preview).toLowerCase()
	let inTitle = 0
	for (const word of words) {
		if (title.includes(word)) inTitle++
		else if (!page.includes(word) && !body.includes(word)) return null
	}
	let rank: number
	if (title.includes(phrase)) rank = 0
	else if (inTitle === words.length) rank = 1
	else if (inTitle > 0) rank = 2
	else if (body.includes(phrase)) rank = 3
	else rank = 4
	if (section.depth === 1) rank -= 0.5
	return isReference ? rank + REFERENCE_PENALTY : rank
}

function hitOf(section: DocSection): JumpHit {
	return {
		kind: "doc",
		// A doc hit's id is its SLUG — the one jump kind whose rows are not
		// integer-keyed, which is why `openJumpHit` takes it before the
		// numeric-id guard.
		id: section.slug,
		// "" is the top of a page, which is the absence of an anchor rather
		// than an anchor named "".
		anchor: section.anchor || undefined,
		title: section.title,
		// The page a heading lives on: without it a row called "Overview" says
		// nothing about which guide it is the overview of.
		subtitle: getDocMeta(section.slug)?.title ?? section.slug
	}
}

/** A matched section, with what the Help view needs to draw it. */
export interface DocMatch {
	section: DocSection
	hit: JumpHit
	/** From the SDK reference rather than the guides. */
	reference: boolean
	/** A stretch of the section's text around the first word, or its preview. */
	snippet: string
}

/**
 * Where a query's first word falls in a section's text, with a little either
 * side — so a row matched by its prose shows the reader why it matched.
 */
export function snippetOf(section: DocSection, words: string[]): string {
	const text = section.text || section.preview
	const lower = text.toLowerCase()
	let at = -1
	for (const word of words) {
		at = lower.indexOf(word)
		if (at !== -1) break
	}
	if (at <= 60) return text.length > 160 ? text.slice(0, 160) + "…" : text
	const start = text.lastIndexOf(" ", at - 50) + 1
	const slice = text.slice(start, start + 160)
	return "…" + slice + (start + 160 < text.length ? "…" : "")
}

/** One run of a highlighted string: matched or not. */
export interface TextPart {
	text: string
	match: boolean
}

/**
 * A string cut into runs around every occurrence of the query's words, so a
 * view can mark them without building HTML from text it did not write.
 */
export function highlightParts(text: string, words: string[]): TextPart[] {
	const lower = text.toLowerCase()
	const marks = new Array<boolean>(text.length).fill(false)
	for (const word of words) {
		if (!word) continue
		for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length))
			marks.fill(true, at, at + word.length)
	}
	const parts: TextPart[] = []
	for (let i = 0; i < text.length; ) {
		let j = i
		while (j < text.length && marks[j] === marks[i]) j++
		parts.push({ text: text.slice(i, j), match: marks[i] })
		i = j
	}
	return parts
}

/**
 * The sections that match, best first, capped.
 *
 * Minimum query length is NOT enforced here — that is `JUMP_MIN_QUERY_LENGTH`
 * and the overlay's rule, applied once for every lane rather than again per
 * lane. An empty query matches nothing, which is the only guard this owes.
 *
 * `sourceOf` answers which source a page came from; the manifest by default,
 * a fixture's own answer in a test.
 */
export function searchDocSections(
	sections: DocSection[],
	query: string,
	cap: number,
	sourceOf: (slug: string) => string | undefined = (slug) =>
		getDocMeta(slug)?.source
): DocMatch[] {
	const words = queryWords(query)
	if (words.length === 0) return []
	const phrase = words.join(" ")
	const ranked: { section: DocSection; rank: number; reference: boolean }[] = []
	for (const section of sections) {
		const source = sourceOf(section.slug)
		const reference = source !== undefined && source !== "app"
		const pageTitle = getDocMeta(section.slug)?.title ?? ""
		const rank = rankOf(section, words, phrase, pageTitle, reference)
		if (rank !== null) ranked.push({ section, rank, reference })
	}
	// `sort` is stable, so equal ranks keep the compiler's reading order —
	// the same order the index and the outline list them in.
	ranked.sort((a, b) => a.rank - b.rank)
	return ranked.slice(0, cap).map(({ section, reference }) => ({
		section,
		reference,
		hit: hitOf(section),
		snippet: snippetOf(section, words)
	}))
}

/** The same answer as jump hits, for the overlay and the Help view's scope. */
export function matchDocSections(
	sections: DocSection[],
	query: string,
	cap: number,
	sourceOf?: (slug: string) => string | undefined
): JumpHit[] {
	return searchDocSections(sections, query, cap, sourceOf).map((m) => m.hit)
}

/**
 * The same match, fetching the index on first use.
 *
 * `loadSearchIndex` is memoised, so this is one fetch per session however many
 * keystrokes it is called with — and nothing at all until someone searches.
 */
export async function docsJumpHits(
	query: string,
	cap: number
): Promise<JumpHit[]> {
	if (!query.trim()) return []
	return matchDocSections(await loadSearchIndex(), query, cap)
}

/** The Help view's richer answer, fetching the index on first use. */
export async function docsSearch(
	query: string,
	cap: number
): Promise<DocMatch[]> {
	if (!query.trim()) return []
	return searchDocSections(await loadSearchIndex(), query, cap)
}
