/**
 * The one way to link into the documentation from app code.
 *
 * Before this existed, the two places in the app that pointed a user at a guide
 * both pointed at GitHub — `blob/main/docs/hosting.md` — so a self-hosted or
 * offline install sent someone to the internet to read a page it was already
 * serving, at whatever `main` happened to say rather than at their own version.
 *
 * Deliberately pure and free of imports: it is called from `$lib/server` as
 * well as from components, and it is grepped as source text by
 * `docsHref.test.ts`, which checks every literal call in the tree against the
 * compiled manifest. A slug or anchor that stops existing is a failing test
 * rather than a dead link someone finds a release later.
 */
export function docsHref(slug: string, anchor?: string): string {
	return `/docs/${slug}${anchor ? `#${anchor}` : ""}`
}
