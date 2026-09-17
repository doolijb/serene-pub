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
