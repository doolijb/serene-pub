import { error } from "@sveltejs/kit"
import { getDocMeta, loadDocHtml } from "$lib/shared/utils/docsIndex"
import type { PageLoad } from "./$types"

/**
 * The same page, loaded for Document View.
 *
 * The one difference is the href rewrite: the compiler renders cross-links as
 * `/docs/<slug>`, which is correct for the standard site and would drop a
 * Document View reader onto it mid-read. Done here rather than in the component
 * so the markup arrives already correct and there is no second pass over it on
 * every render.
 */
export const load: PageLoad = async ({ params }) => {
	const slug = params.slug
	const meta = getDocMeta(slug)
	const html = meta ? await loadDocHtml(slug) : null

	if (!meta || html === null) {
		error(404, `There is no documentation page called "${slug}".`)
	}

	return {
		slug,
		meta,
		html: html.replaceAll('href="/docs/', 'href="/document-view/docs/')
	}
}
