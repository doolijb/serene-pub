/**
 * Retired by 28. Every stored reference was rewritten to a `/media/{id}` proxy
 * by the 0166 data upgrade, so nothing the server builds points here any more.
 *
 * The route stays for one release, answering 404, so a stale browser tab fails
 * visibly instead of hanging — not for compatibility. It deliberately does not
 * fall back to reading the old tree: this URL *was* a filesystem path, and
 * serving from a caller-controlled path is precisely what `/media/{id}`
 * replaced.
 */
import type { RequestHandler } from "@sveltejs/kit"

export const GET: RequestHandler = async () =>
	new Response("Not found", { status: 404 })
