/**
 * Core's components as the UI worker loads them (C7): `/core-ui/<slug>`.
 * Built in `@serene-pub/core-catalog` (`dist/components/`, checked by the
 * same bundler a plugin's `serene-pub build` runs) and inlined into the server
 * build here, so production serves exactly what development does.
 *
 * Core's five modules share their runtime (unit M): Svelte, the component
 * client and the SDK helpers are built once into `shared-<hash>.js` chunks
 * the modules import relatively (`./shared-….js` from `/core-ui/stats` is
 * `/core-ui/shared-….js`), so core's UI worker loads them once. Only core's
 * worker loads `/core-ui`; a plugin's modules stay self-contained.
 * `core-ui.json` is the build's list of what is served, by name.
 *
 * Same-origin, so the worker's `script-src 'self'` takes it; revalidated on
 * every load and answered 304 while unchanged.
 */
import { createHash } from "node:crypto"
import type { RequestHandler } from "@sveltejs/kit"
import served from "@serene-pub/core-catalog/components/core-ui.json?raw"

/** Served name → module: a core component by slug, a shared chunk by its file name. */
const MODULES: Readonly<Record<string, string>> = Object.freeze(
	Object.assign(Object.create(null), JSON.parse(served) as Record<string, string>)
)
const ETAGS = new Map(
	Object.entries(MODULES).map(([slug, code]) => [
		slug,
		`"${createHash("sha256").update(code).digest("hex").slice(0, 32)}"`
	])
)

export const GET: RequestHandler = ({ params, request }) => {
	const slug = params.slug ?? ""
	const code = Object.hasOwn(MODULES, slug) ? MODULES[slug] : undefined
	const etag = ETAGS.get(slug)
	if (code === undefined || !etag) return new Response("Not found", { status: 404 })
	const headers = { ETag: etag, "Cache-Control": "no-cache" }
	if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers })
	return new Response(code, {
		headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8", "X-Content-Type-Options": "nosniff" }
	})
}
