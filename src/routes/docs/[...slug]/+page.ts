import { error } from "@sveltejs/kit"
import { getDocMeta, loadDocHtml } from "$lib/shared/utils/docsIndex"
import type { PageLoad } from "./$types"

/**
 * Loads one documentation page.
 *
 * A universal `load` rather than the component fetching for itself: the page's
 * HTML is a lazily-imported chunk, and asking for it here means SvelteKit waits
 * for it before it swaps the route in — so a reader never sees an empty article
 * flash into content, and an unknown slug is a real 404 instead of a rendered
 * blank page that quietly redirects a tick later.
 *
 * ⚠ A rest parameter, because a slug can contain slashes: every reference page
 * is namespaced under its source (`sdk/pipelines/core_spec_respond`).
 */
export const load: PageLoad = async ({ params }) => {
	const slug = params.slug
	const meta = getDocMeta(slug)
	const html = meta ? await loadDocHtml(slug) : null

	if (!meta || html === null) {
		error(404, `There is no documentation page called "${slug}".`)
	}

	return { slug, meta, html }
}
