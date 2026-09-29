/**
 * An unsaved component's compiled module (C6, P4): `/component-preview/<token>`,
 * the capability URL `components:preview` answers with. Served only to the
 * admin who minted it, while it lives — see `$lib/server/components/preview`.
 *
 * Every refusal is the same 404 (no session, another user, an expired or
 * unknown token, the extension subsystem off), so the route tells a prober
 * nothing about which tokens exist. Same-origin and `text/javascript`, so the
 * UI worker's `script-src 'self'` takes it; `private` because it is one
 * user's, and immutable for its short life because a token never names other
 * bytes.
 */
import type { RequestHandler } from "@sveltejs/kit"
import { authenticateRequest } from "$lib/server/auth/authenticateRequest"
import { pluginsEnabled } from "$lib/server/plugins/flag"
import { PREVIEW_TTL_MS, readComponentPreview } from "$lib/server/components/preview"

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } })

export const GET: RequestHandler = async (event) => {
	if (!pluginsEnabled()) return notFound()
	const user = await authenticateRequest(event)
	if (!user?.isAdmin) return notFound()
	const code = readComponentPreview(event.params.token, user.id)
	if (code === null) return notFound()
	return new Response(code, {
		headers: {
			"Content-Type": "text/javascript; charset=utf-8",
			"Cache-Control": `private, max-age=${PREVIEW_TTL_MS / 1000}, immutable`,
			"X-Content-Type-Options": "nosniff"
		}
	})
}
