/**
 * Links that name a VIEW rather than a page.
 *
 * `/admin/...` and `/docs/...` are the Admin and Help views' addresses
 * (`viewRoutes.ts`). An ordinary `<a href>` to one of them, followed as a
 * link, would load the empty route page there — taking the reader away from
 * the session or view they were in — and only then open the view in Focus.
 * The shell catches those clicks instead (Layout.svelte) and opens the view
 * where the reader is, at that section or page. Links keep their real hrefs,
 * so a new tab, a copied link and a crawler still get the address.
 *
 * Pure, so the rule is testable without a DOM.
 */

export type ViewLink =
	| { view: "admin"; href: string }
	| { view: "help"; slug: string | null; anchor: string }

export function viewLinkFor(href: string): ViewLink | null {
	if (!href.startsWith("/") || href.startsWith("//")) return null
	const hashAt = href.indexOf("#")
	const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt)
	const anchor = hashAt === -1 ? "" : href.slice(hashAt + 1)
	const queryAt = beforeHash.indexOf("?")
	const pathname = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt)

	if (pathname === "/admin" || pathname.startsWith("/admin/"))
		return { view: "admin", href }
	if (pathname === "/docs" || pathname.startsWith("/docs/")) {
		// A query is a question the Help view cannot answer; leave it be.
		if (queryAt !== -1) return null
		const slug = pathname.slice("/docs".length).replace(/^\/+|\/+$/g, "")
		return {
			view: "help",
			slug: slug ? decodeURIComponent(slug) : null,
			anchor: decodeURIComponent(anchor)
		}
	}
	return null
}

/** A click the shell may take over: plain, primary, same-tab, no download. */
export function isPlainClick(event: MouseEvent): boolean {
	return (
		!event.defaultPrevented &&
		event.button === 0 &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	)
}
