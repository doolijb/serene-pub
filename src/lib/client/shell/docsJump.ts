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
 * same index would be two documentations. `matchDocSections` is pure so the
 * ranking can be pinned without a compiled docs-dist.
 */

import type { JumpHit } from "$lib/shared/sockets/jump"
import {
	getDocMeta,
	loadSearchIndex,
	type DocSection
} from "$lib/shared/utils/docsIndex"

/**
 * How well a section answers the needle. Lower sorts first.
 *
 * A heading that CONTAINS the word is what the reader typed it for; prose that
 * merely mentions it is the fallback. A page's own H1 wins among the headings
 * because "Sessions" the page is a better answer to "sessions" than any
 * subsection of it.
 */
function rankOf(section: DocSection, needle: string): number | null {
	if (section.title.toLowerCase().includes(needle))
		return section.depth === 1 ? 0 : 1
	if (section.preview.toLowerCase().includes(needle)) return 2
	return null
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

/**
 * The sections that match, best first, capped.
 *
 * Minimum query length is NOT enforced here — that is `JUMP_MIN_QUERY_LENGTH`
 * and the overlay's rule, applied once for every lane rather than again per
 * lane. An empty needle matches nothing, which is the only guard this owes.
 */
export function matchDocSections(
	sections: DocSection[],
	query: string,
	cap: number
): JumpHit[] {
	const needle = query.trim().toLowerCase()
	if (!needle) return []
	const ranked: { section: DocSection; rank: number }[] = []
	for (const section of sections) {
		const rank = rankOf(section, needle)
		if (rank !== null) ranked.push({ section, rank })
	}
	// `sort` is stable, so equal ranks keep the compiler's reading order —
	// the same order the index and the outline list them in.
	ranked.sort((a, b) => a.rank - b.rank)
	return ranked.slice(0, cap).map(({ section }) => hitOf(section))
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
