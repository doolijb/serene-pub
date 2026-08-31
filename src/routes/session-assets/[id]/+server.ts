/**
 * Serve a session asset by id.
 *
 * Kept as a redirect rather than a second implementation: since 28 a session
 * asset *is* a media row, so `/media/{id}` already serves it under the shared
 * access check. Two copies of that check is exactly the duplication folding the
 * tables together was meant to remove.
 *
 * Existing message parts store bare asset ids and build this URL client-side,
 * so the path has to keep answering — 308 preserves the id and lets the browser
 * cache the hop.
 */
import { redirect, type RequestHandler } from "@sveltejs/kit"

export const GET: RequestHandler = async ({ params, url }) => {
	const id = Number(params.id)
	if (!Number.isInteger(id) || id <= 0) {
		return new Response("Not found", { status: 404 })
	}
	const variant = url.searchParams.get("v")
	// To the by-id form, which resolves the uuid and redirects again.
	redirect(308, `/media/${id}${variant ? `?v=${encodeURIComponent(variant)}` : ""}`)
}
