/**
 * Core's components as the UI worker loads them (C7): `/core-ui/<slug>`.
 * Same-origin, so the worker's `script-src 'self'` takes it; revalidated on
 * every load and answered 304 while the module is unchanged.
 */
import { dev } from "$app/environment"
import type { RequestHandler } from "@sveltejs/kit"

export const GET: RequestHandler = async ({ params, request }) => {
	// Built from the app's source until the cutover ships them prebuilt.
	if (!dev) return new Response("Not found", { status: 404 })
	const { coreComponentModule } = await import("$lib/server/coreComponents")
	const mod = await coreComponentModule(params.slug ?? "")
	if (!mod) return new Response("Not found", { status: 404 })
	const headers = { ETag: mod.etag, "Cache-Control": "no-cache" }
	if (request.headers.get("if-none-match") === mod.etag) return new Response(null, { status: 304, headers })
	return new Response(mod.code, {
		headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8", "X-Content-Type-Options": "nosniff" }
	})
}
