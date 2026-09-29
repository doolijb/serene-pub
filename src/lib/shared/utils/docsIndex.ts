/**
 * The app's reader for the docs-dist (NOMENCLATURE §27).
 *
 * Rendering happens at build time in @serene-pub/docs (see
 * scripts/build-docs.js), which keeps the parser and the raw markdown out of
 * the client's entry chunk entirely. This module is only a thin index over
 * that build output:
 *
 * - the manifest is small and eager, so nav and titles are available
 *   synchronously (a `load` needs the title before the page HTML exists);
 * - each page's HTML is its own lazily-imported chunk;
 * - the search index is lazier still — it is only fetched on the first
 *   keystroke in the search box.
 *
 * ⚠ All three are read through `import.meta.glob` rather than a direct import.
 * The docs-dist is gitignored build output, so on a fresh checkout — and in
 * `npm test` and `npm run check`, neither of which compiles docs — the files
 * are simply absent. A glob that matches nothing returns `{}`; a bare
 * `import manifest from "..."` would be an unresolvable module and would fail
 * the typecheck and every test run that transitively imports this file.
 */

/** One heading in a page, as the compiler recorded it. */
export interface DocsHeading {
	id: string
	text: string
	depth: number
}

/** A page's entry in the manifest. */
export interface DocsPageMeta {
	slug: string
	title: string
	description: string
	source: string
	order: number
	headings: DocsHeading[]
	bytes: number
}

/** What a source contributes: its group name, its banner, where it came from. */
export interface DocsSourceMeta {
	group: string
	banner?: string
	repo?: { url: string; commit?: string }
}

/** One group in the reading order, in the order its pages should be listed. */
export interface DocsNavGroup {
	group: string
	source: string
	pages: string[]
}

export interface DocsManifest {
	version: string
	generatedAt: string
	linkBase: string
	sources: Record<string, DocsSourceMeta>
	nav: DocsNavGroup[]
	pages: Record<string, DocsPageMeta>
	assets: { count: number; bytes: number; budgetBytes: number }
}

/**
 * One search hit: a heading, the page it lives on and the prose under it.
 *
 * Named for what the reader gets — a section of a page — and kept as the name
 * the docs components already take as a prop. The compiler calls the same shape
 * a `DocsSearchEntry` on its side of the seam.
 */
export interface DocSection {
	slug: string
	anchor: string
	title: string
	depth: number
	preview: string
	/**
	 * The section's body as plain text (≤1200 chars) — what search reads
	 * past the preview. Absent from an index compiled before it existed.
	 */
	text?: string
}

/** A page, everywhere the app lists or titles one. */
export type DocMeta = DocsPageMeta

const DIST_DIR = "/src/lib/generated/docs"

/** Stands in for a docs-dist that was never compiled. Renders as "no docs". */
const EMPTY_MANIFEST: DocsManifest = {
	version: "",
	generatedAt: "",
	linkBase: "/docs",
	sources: {},
	nav: [],
	pages: {},
	assets: { count: 0, bytes: 0, budgetBytes: 0 }
}

const manifestModules = import.meta.glob(
	"/src/lib/generated/docs/manifest.json",
	{ eager: true, import: "default" }
) as Record<string, DocsManifest>

/** The compiled docs-dist manifest, or an empty one when docs are not built. */
export const docsManifest: DocsManifest =
	Object.values(manifestModules)[0] ?? EMPTY_MANIFEST

const pageModules = import.meta.glob(
	"/src/lib/generated/docs/pages/**/*.html",
	{ query: "?raw", import: "default" }
) as Record<string, () => Promise<string>>

const searchModules = import.meta.glob("/src/lib/generated/docs/search.json", {
	import: "default"
}) as Record<string, () => Promise<DocSection[]>>

/**
 * Every page in reading order: groups in the order the manifest lists them,
 * pages in the order within each group.
 *
 * Exported as a pure function as well as the derived constant so the test can
 * drive it with a fixture instead of needing a compiled docs-dist.
 */
export function buildDocsIndex(manifest: DocsManifest): DocMeta[] {
	const out: DocMeta[] = []
	for (const group of manifest.nav) {
		for (const slug of group.pages) {
			const meta = manifest.pages[slug]
			if (meta) out.push(meta)
		}
	}
	return out
}

export const docsIndex: DocMeta[] = buildDocsIndex(docsManifest)

/**
 * A page's metadata by slug, or undefined.
 *
 * `hasOwn` rather than a bare index: the slug comes straight off the URL, and
 * `/docs/constructor` would otherwise resolve to `Object.prototype.constructor`
 * — an object, so truthy, so the page would render as "found" with no title.
 */
export function getDocMeta(slug: string): DocMeta | undefined {
	return Object.hasOwn(docsManifest.pages, slug)
		? docsManifest.pages[slug]
		: undefined
}

/**
 * A page's rendered HTML — the article body only — or null when there is no
 * such page. One network chunk per page, fetched on demand, with no `fetch`:
 * the import is part of the module graph, so it works under SSR too.
 */
export async function loadDocHtml(slug: string): Promise<string | null> {
	const loader = pageModules[`${DIST_DIR}/pages/${slug}.html`]
	if (!loader) return null
	return await loader()
}

let searchIndex: Promise<DocSection[]> | null = null

/**
 * The search index, fetched once per session on first use.
 *
 * Kept out of the docs entry chunk on purpose: it carries a preview of every
 * section of every page, which is most of the documentation's prose a second
 * time, and nobody who is only reading a page should pay for it.
 */
export async function loadSearchIndex(): Promise<DocSection[]> {
	if (!searchIndex) {
		const loader = Object.values(searchModules)[0]
		searchIndex = loader
			? loader().then((entries) => entries ?? [])
			: Promise.resolve([])
	}
	return await searchIndex
}

/**
 * Rewrites a relative markdown link between doc source files (eg.
 * "./characters.md#creator-wizard") into the in-app route it maps to (eg.
 * "/docs/characters#creator-wizard"). Anchor-only and external links pass
 * through unchanged.
 *
 * The compiler now does this rewrite at build time, so no rendered page reaches
 * the app still carrying a `.md` href. Kept because Document View rewrites the
 * *result* (`/docs/` → `/document-view/docs/`) and needs the same shape to
 * match, and because it is the one piece of link handling the app still owns.
 */
export function rewriteDocHref(href: string): string {
	const match = href.match(/^\.?\/?([a-z0-9-]+)\.md(#.*)?$/i)
	if (match) return `/docs/${match[1]}${match[2] ?? ""}`
	return href
}
