/**
 * Documentation retrieval — what `core:query/docs-search@1` ranks the
 * compiled docs with (the guide genre's one retrieval mechanism).
 *
 * ## Why this is not a word-overlap count any more (2026-09-27)
 *
 * The guide invented a Python plugin system with `on_load()` hooks when asked
 * how to write a plugin. The docs-search node had run, and handed it the
 * wrong sections: it matched the question's words against each section's
 * title and 200-character preview only, unstemmed and unweighted, so
 * "writing" never met "write", a word every page uses counted as much as
 * "plugin", and the SDK's *Your first plugin* guide was not in the top eight.
 * It also read the assistant's own earlier answers as part of the question,
 * so a first invention steered the next retrieval toward itself.
 *
 * So this scores the question the way a search box would:
 *
 *  - **The person's words only.** User rows, the newest weighted most; the
 *    envoy's own replies are never evidence for what to look up.
 *  - **Stemmed terms** (`writing`/`writes`/`write` → `writ`).
 *  - **BM25 over three fields** — the page's title and slug, the section's
 *    title, and the section's body (`text`, the compiler's ≤1200-character
 *    plain text; the preview for an index compiled before it existed) —
 *    weighted so a page *about* plugins outranks a page that mentions one.
 *  - **A relevance floor.** A section must match at least half of the
 *    distinctive weight (IDF mass) of one message the person wrote, so a
 *    question the docs do not cover retrieves nothing — and the prompt can then say so, instead of
 *    handing the model three loosely related excerpts to extrapolate from.
 *
 * Pure: the index is the compiled `search.json` and the manifest, handed in,
 * so the test drives it with the real docs-dist and the node reads the same.
 */

import type { DocSection, DocsManifest } from "$lib/shared/utils/docsIndex"

/** One retrieved section, ready to become a candidate. */
export interface DocsHit {
	/** `slug#anchor` — stable, and the candidate's id. */
	id: string
	/** "Page › Section", or the page title alone for its top section. */
	name: string
	/** The in-app path, `/docs/<slug>#<anchor>` — always a compiled page's. */
	link: string
	/** The excerpt: the section's body as plain text. */
	body: string
	/** Raw BM25 score. */
	score: number
}

export interface DocsQueryMessage {
	role?: string | null
	content?: string | null
}

/**
 * Words too common in a question to say what it is about. Stemmed forms are
 * matched too (see `docsTerms`), so the list holds the surface words.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
	"the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had",
	"her", "was", "one", "our", "out", "has", "have", "with", "this", "that",
	"from", "they", "will", "what", "when", "your", "how", "does", "into", "there",
	"about", "which", "their", "would", "could", "should", "than", "then", "them",
	"these", "those", "been", "being", "were", "also", "just", "like", "some",
	"more", "very", "here", "where", "who", "why", "its", "it's", "i'm", "don't",
	"doesn't", "can't", "did", "get", "got", "let", "use", "using", "used", "want",
	"is", "it", "do", "to", "of", "in", "on", "a", "an", "i", "me", "my", "we",
	"be", "or", "if", "so", "at", "by", "as", "no", "yes", "please", "thanks",
	"know", "tell", "sure", "really", "okay", "need", "way", "thing", "things"
])

/**
 * A light suffix stemmer — enough to fold the inflections a question and a
 * docs page disagree on (`plugins`/`plugin`, `writing`/`write`,
 * `configured`/`configure`), not a linguistic one. Both sides of the match go
 * through it, so it only has to be consistent.
 */
export function stemDocsTerm(word: string): string {
	let w = word
	if (w.length > 4 && w.endsWith("ies")) w = w.slice(0, -3) + "y"
	else if (w.length > 5 && w.endsWith("ing")) {
		w = w.slice(0, -3)
		if (/([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1)
	} else if (w.length > 4 && w.endsWith("ed")) {
		w = w.slice(0, -2)
		if (/([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1)
	} else if (w.length > 4 && /(ss|x|ch|sh)es$/.test(w)) w = w.slice(0, -2)
	else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1)
	if (w.length > 4 && w.endsWith("e")) w = w.slice(0, -1)
	return w
}

/** Stemmed, stop-worded terms of two letters or more. */
export function docsTerms(text: string): string[] {
	const out: string[] = []
	for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9']*/g) ?? []) {
		const word = raw.replace(/'s$/, "").replace(/'/g, "")
		if (word.length < 2 || STOP_WORDS.has(raw) || STOP_WORDS.has(word)) continue
		out.push(stemDocsTerm(word))
	}
	return out
}

/** Field weights: a page about the thing beats a page that mentions it. */
const FIELD_WEIGHT = { page: 3, section: 2, body: 1 } as const
const K1 = 1.2
const B = 0.75
/** Share of the question's IDF mass a section must match to count at all. */
const MIN_COVERAGE = 0.5
/** At most this many sections of one page, so one long page cannot crowd out the rest. */
const PER_PAGE = 3

interface IndexedSection {
	sec: DocSection
	pageTitle: string
	tf: Map<string, number>
	len: number
}

interface BuiltIndex {
	sections: IndexedSection[]
	idf: Map<string, number>
	avgLen: number
}

/** One built index per compiled index — the search.json is loaded once. */
const built = new WeakMap<readonly DocSection[], BuiltIndex>()

function buildIndex(
	sections: readonly DocSection[],
	manifest: Pick<DocsManifest, "pages">
): BuiltIndex {
	const cached = built.get(sections)
	if (cached) return cached
	const df = new Map<string, number>()
	const indexed: IndexedSection[] = sections.map((sec) => {
		const pageTitle = manifest.pages?.[sec.slug]?.title ?? sec.title
		const tf = new Map<string, number>()
		const add = (text: string, weight: number) => {
			for (const t of docsTerms(text)) tf.set(t, (tf.get(t) ?? 0) + weight)
		}
		add(`${pageTitle} ${sec.slug.replace(/[/-]/g, " ")}`, FIELD_WEIGHT.page)
		add(sec.title, FIELD_WEIGHT.section)
		add(sec.text || sec.preview || "", FIELD_WEIGHT.body)
		let len = 0
		for (const [t, n] of tf) {
			len += n
			df.set(t, (df.get(t) ?? 0) + 1)
		}
		return { sec, pageTitle, tf, len }
	})
	const n = indexed.length || 1
	const idf = new Map<string, number>()
	for (const [t, d] of df) idf.set(t, Math.log(1 + (n - d + 0.5) / (d + 0.5)))
	const avgLen = indexed.reduce((s, x) => s + x.len, 0) / n || 1
	const index = { sections: indexed, idf, avgLen }
	built.set(sections, index)
	return index
}

/**
 * The question, as weighted terms: the person's rows only, the newest
 * counting fully and each earlier one half as much as the one after it.
 * A term's weight is the most any one message gives it, not their sum — a
 * word repeated across follow-ups is still one word of the question.
 *
 * `asked` keeps each message's own terms as well, because coverage is judged
 * per message: a follow-up ("are you sure it's Python?") whose own words the
 * docs never use still finds the pages the question before it was about.
 */
export interface DocsQuery {
	weights: Map<string, number>
	asked: Array<Set<string>>
}

export function docsQueryTerms(messages: readonly DocsQueryMessage[]): DocsQuery {
	const rows = messages.filter(
		(m) => (m.role ?? "user") === "user" && String(m.content ?? "").trim()
	)
	const weights = new Map<string, number>()
	const asked: Array<Set<string>> = []
	rows.forEach((m, i) => {
		const w = Math.pow(0.5, rows.length - 1 - i)
		const terms = new Set(docsTerms(String(m.content ?? "")))
		if (terms.size) asked.push(terms)
		for (const t of terms) weights.set(t, Math.max(weights.get(t) ?? 0, w))
	})
	return { weights, asked }
}

/**
 * The best sections for the question, best first — or none, when nothing in
 * the docs covers enough of it (`MIN_COVERAGE`).
 */
export function searchDocs(
	sections: readonly DocSection[],
	manifest: Pick<DocsManifest, "pages" | "linkBase">,
	query: DocsQuery,
	maxEntries: number
): DocsHit[] {
	if (!sections.length || !query.weights.size || maxEntries <= 0) return []
	const index = buildIndex(sections, manifest)
	// A term the docs never use carries no evidence, but it still counts
	// against coverage — at the rarest term's weight: "sourdough recipe"
	// matching "recipe" alone is half a question, not a match.
	const maxIdf = Math.max(...index.idf.values(), 1)
	const idfOf = (t: string) => index.idf.get(t) ?? maxIdf
	const masses = query.asked.map((terms) => {
		let m = 0
		for (const t of terms) m += idfOf(t)
		return m
	})

	const scored: Array<{ s: IndexedSection; score: number }> = []
	for (const s of index.sections) {
		let score = 0
		for (const [t, w] of query.weights) {
			const tf = s.tf.get(t)
			if (!tf) continue
			score +=
				w * idfOf(t) * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * s.len) / index.avgLen)))
		}
		if (score <= 0) continue
		// Relevant when it covers enough of any ONE message the person wrote.
		const covers = query.asked.some((terms, i) => {
			if (masses[i]! <= 0) return false
			let matched = 0
			for (const t of terms) if (s.tf.has(t)) matched += idfOf(t)
			return matched / masses[i]! >= MIN_COVERAGE
		})
		if (covers) scored.push({ s, score })
	}
	scored.sort((a, b) => b.score - a.score)

	const perPage = new Map<string, number>()
	const out: DocsHit[] = []
	const base = manifest.linkBase || "/docs"
	for (const { s, score } of scored) {
		if (out.length >= maxEntries) break
		const seen = perPage.get(s.sec.slug) ?? 0
		if (seen >= PER_PAGE) continue
		perPage.set(s.sec.slug, seen + 1)
		const { sec, pageTitle } = s
		const body = (sec.text || sec.preview || "").trim()
		if (!body) continue
		out.push({
			id: `${sec.slug}#${sec.anchor}`,
			name: pageTitle && pageTitle !== sec.title ? `${pageTitle} › ${sec.title}` : sec.title,
			link: sec.anchor ? `${base}/${sec.slug}#${sec.anchor}` : `${base}/${sec.slug}`,
			body,
			score
		})
	}
	return out
}

/**
 * The excerpt as the prompt carries it: the page's path first, so the model
 * has the one real address to cite sitting beside the text it cites.
 */
export const docsExcerptContent = (hit: Pick<DocsHit, "link" | "body">): string =>
	`Path: ${hit.link}\n${hit.body}`
