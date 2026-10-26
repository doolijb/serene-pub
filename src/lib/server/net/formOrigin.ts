/**
 * The **form origin check** — the one guard on HTML form submissions, in
 * place of SvelteKit's own (`kit.csrf.checkOrigin` is off in
 * `svelte.config.js`; this runs first in `hooks.server.ts` instead).
 *
 * SvelteKit compares the browser's `Origin` header with `url.origin`, and
 * `url.origin` is `ORIGIN` whenever that is set — which `preloadEnv.js`
 * derives from `PUBLIC_URL`. So on a pub with a public URL, a form posted from
 * any OTHER address of the same server (`http://localhost:3000`, a LAN
 * address) was refused as cross-site: *Cross-site POST form submissions are
 * forbidden*. The only forms in the app are the recovery pages, and recovery
 * is allowed ONLY from those local addresses (`db/recoveryAccess.ts`), so the
 * two rules could never both hold on a pub reached by its public URL.
 *
 * The rule here is the one the live connections already use
 * (`sockets/originAllowlist.ts`, "same-hostname, zero-config"): a form may
 * be posted from the origin the request itself arrived on — the client-facing
 * host, read through the trusted proxy's headers when there is one — or from
 * the configured origin, or from an allowlisted host. A page on any other
 * site cannot forge `Origin` (the browser sets it to that page's own origin),
 * so this keeps exactly the protection the framework's check gave, less the
 * false refusal. A form post with NO `Origin` is refused, as the framework
 * refused it: every browser sends one on a cross-origin or same-origin form
 * post, so its absence means a non-browser client, which has no business
 * posting a form.
 *
 * Applied to the methods and content types the framework guarded, nothing
 * else: a JSON request from the page's own scripts never had this check and
 * still has none.
 */
import type { RequestEvent } from "@sveltejs/kit"
import { isOriginAllowed } from "$lib/server/sockets/originAllowlist"
import { resolveRequestPublicHost } from "$lib/server/net/publicUrl"

/** The framework's sentence, kept word for word: docs and tests name it. */
export const FORM_ORIGIN_REFUSED = (method: string): string =>
	`Cross-site ${method} form submissions are forbidden`

const GUARDED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/** The content types a browser sends for a form (the framework's list). */
export function isFormContentType(request: Request): boolean {
	const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? ""
	return (
		type === "application/x-www-form-urlencoded" ||
		type === "multipart/form-data" ||
		type === "text/plain"
	)
}

export type FormOriginEvent = Pick<RequestEvent, "request" | "url"> & {
	platform?: unknown
}

/**
 * Whether this form submission's `Origin` is one of this pub's own. Pure
 * over the event; reads the same configuration the live connections do.
 */
export function isFormOriginAllowed(event: FormOriginEvent): boolean {
	const origin = event.request.headers.get("origin")
	if (!origin) return false
	if (origin === event.url.origin) return true
	// The origin the request arrived on, as the client sees it.
	return isOriginAllowed(origin, resolveRequestPublicHost(event))
}

/**
 * The 403 for a form post from elsewhere, or null when the request is not a
 * guarded form post or its origin is this pub's.
 */
export function formOriginRefusal(event: FormOriginEvent): Response | null {
	const { request } = event
	if (!GUARDED_METHODS.has(request.method)) return null
	if (!isFormContentType(request)) return null
	if (isFormOriginAllowed(event)) return null
	const message = FORM_ORIGIN_REFUSED(request.method)
	if (request.headers.get("accept") === "application/json")
		return new Response(JSON.stringify({ message }), {
			status: 403,
			headers: { "content-type": "application/json" }
		})
	return new Response(message, { status: 403, headers: { "content-type": "text/plain" } })
}
