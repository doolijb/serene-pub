/**
 * The UI worker's main script (§3.5, C2).
 *
 * A module worker's CSP is the one its MAIN script's response carries — the
 * page's does not apply inside it. So the page starts the worker here, and
 * this response is nothing but that policy and an `import` of the bundled
 * bootstrap: `script-src 'self'` lets the worker load the app's own modules
 * and a plugin's component from `/plugin-ui/…`, and nothing from elsewhere;
 * `connect-src 'none'` closes `fetch` whatever the bootstrap missed.
 *
 * `boot` is the bundle's own URL as the client build knows it; only a
 * same-origin path is accepted, and the CSP would refuse anything else anyway.
 */
import type { RequestHandler } from "@sveltejs/kit"

const UI_WORKER_CSP = "default-src 'none'; script-src 'self'; connect-src 'none'"

export const GET: RequestHandler = ({ url }) => {
	const boot = url.searchParams.get("boot") ?? ""
	if (!boot.startsWith("/") || boot.startsWith("//") || boot.includes("\\") || /[\s"'<>]/.test(boot))
		return new Response("Not found", { status: 404 })
	return new Response(`import ${JSON.stringify(boot)};\n`, {
		headers: {
			"Content-Type": "text/javascript; charset=utf-8",
			"Content-Security-Policy": UI_WORKER_CSP,
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "no-store"
		}
	})
}
