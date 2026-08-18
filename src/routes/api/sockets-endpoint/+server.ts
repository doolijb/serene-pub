import {
	getPublicSocketsEndpoint,
	loadSocketsServer
} from "$lib/server/sockets/loadSockets.server"
import type { RequestHandler } from "@sveltejs/kit"

let socketsLoaded = false

// Takes the whole event, not just `url`: resolving the endpoint needs the
// request headers (Host / x-forwarded-host / x-forwarded-proto) and the raw
// TCP peer from `platform.req`, because the answer is per-request — a tunneled
// request and a direct localhost request to this same process get genuinely
// different, both-correct answers.
export const GET: RequestHandler = async (event) => {
	if (!socketsLoaded) {
		socketsLoaded = true
		await loadSocketsServer()
	}

	const endpoint = getPublicSocketsEndpoint(event)
	return new Response(JSON.stringify({ endpoint }), {
		headers: {
			"Content-Type": "application/json",
			// The correct answer here can change between visits — direct vs.
			// tunneled/reverse-proxied access, dev vs. prod — so a cached
			// response can point the client at a protocol/host that no longer
			// matches this server at all. Without this, a browser that once
			// loaded this same host:port through an https:// tunnel can keep
			// serving that stale answer indefinitely, sending the socket
			// client to an https:// URL against a plain-http socket server
			// (ERR_SSL_PROTOCOL_ERROR / CORS failure that has nothing to do
			// with actual CORS).
			"Cache-Control": "no-store"
		}
	})
}
