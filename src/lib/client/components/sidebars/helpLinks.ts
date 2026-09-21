/**
 * Where a link inside the **Help** sidebar view goes (NOMENCLATURE §27).
 *
 * The docs compiler rewrites every link between pages to `/docs/<slug>`, which
 * is the right href for the full page and the wrong DESTINATION for the sidebar
 * view: following it navigates the whole window away from whatever the reader
 * was doing, which is the one thing reading the documentation beside your work
 * exists to avoid. So the view intercepts the links it can answer itself, and
 * this is the rule it intercepts by.
 *
 * `helpAnchorId` below is the other half of the same seam: the view renames the
 * ids inside its own article so they cannot collide with `/docs`, and every
 * anchor it is handed has to be read against the renamed ones.
 *
 * Pure, and in its own module, because it is the whole of that decision and the
 * only part of the view a test can reach: the suite runs in `node` with no DOM
 * and no `@testing-library/svelte` (vitest.config.ts), so the delegated click
 * handler that spends this answer cannot be driven from a test.
 */

/** The route the compiler writes its links against (`manifest.linkBase`). */
const DOCS_BASE = "/docs"

export interface InViewLink {
	/** The page to show. `null` is the index. */
	slug: string | null
	/** The heading id to scroll to, without its `#`. Empty means the top. */
	anchor: string
}

/**
 * The in-view destination for one `href`, or `null` to leave it to the browser.
 *
 * `currentSlug` answers the anchor-only links — a page's own cross-references
 * and every row of the "On this page" outline. Those name the page already
 * being read, and left alone they would hang a fragment off the app's URL and
 * scroll the window rather than the view.
 */
export function resolveInViewLink(
	href: string,
	currentSlug: string | null = null
): InViewLink | null {
	if (!href) return null
	if (href.startsWith("#"))
		return { slug: currentSlug, anchor: href.slice(1) }
	// Anything that is not a root-relative path belongs to somebody else: an
	// external site, a `mailto:`, or a protocol-relative host (`//example.com`,
	// which must never be mistaken for a path under /docs).
	if (!href.startsWith("/") || href.startsWith("//")) return null

	const hash = href.indexOf("#")
	const pathname = hash === -1 ? href : href.slice(0, hash)
	const anchor = hash === -1 ? "" : href.slice(hash + 1)

	// A query is a question this view cannot answer, and swallowing the link
	// would answer it by dropping the query on the floor.
	if (pathname.includes("?")) return null
	if (pathname !== DOCS_BASE && !pathname.startsWith(`${DOCS_BASE}/`))
		return null

	// A reference page's slug carries slashes (`sdk/pipelines/core_spec_respond`),
	// so everything after the base is the slug — trailing slash and all, which a
	// hand-written link may have and no manifest key does.
	const slug = pathname.slice(DOCS_BASE.length).replace(/^\/+|\/+$/g, "")
	return { slug: slug || null, anchor }
}

/**
 * The prefix this view puts in front of every id inside its article.
 *
 * `/docs/[...slug]` renders the same compiled page from the same docs-dist,
 * and the sidebar can be open beside it — so without a prefix the document
 * carries two `#the-rail` elements. That is an a11y defect on its own, and it
 * also hands the wrong element to `:target` and to the route's own
 * `getElementById` (`routes/docs/[...slug]/+page.svelte`), which resolve to the
 * FIRST match: the sidebar, which comes before `<main>` in the shell's markup.
 * `/docs` keeps the bare ids — it is the page that owns them, and its URL
 * fragments have to keep working.
 *
 * A colon and not `help-`, because a compiled id can already begin with the
 * word: `help-and-about` is a real heading in the getting-started guide today.
 * With `help-` there would be no way to tell an id this view has already
 * scoped from one that merely starts with "help", and the two answers differ
 * (`help-and-about` must become `help:help-and-about`). The compiler's slugger
 * strips colons, so no doc id can contain one and the test is exact. It also
 * reads as the app's own identifier grammar (NOMENCLATURE §2): a namespace,
 * then the name.
 */
export const HELP_ANCHOR_PREFIX = "help:"

/**
 * The id the Help view gives one doc anchor — the single place that knows the
 * prefix, so the rewrite that spends it and the lookups that follow it can
 * never disagree.
 *
 * Idempotent, because anchors reach it both ways: bare from a Jump hit
 * (`digest.help`), from the outline's `#id` rows and from a cross-page link's
 * fragment, and already scoped from a link inside the article, whose href the
 * same rewrite has rebased onto the new ids.
 *
 * An empty anchor stays empty: it means the top of the page, not an element.
 */
export function helpAnchorId(anchor: string): string {
	if (!anchor) return ""
	return anchor.startsWith(HELP_ANCHOR_PREFIX)
		? anchor
		: `${HELP_ANCHOR_PREFIX}${anchor}`
}
