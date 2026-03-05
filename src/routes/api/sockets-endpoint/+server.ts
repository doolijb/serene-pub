import {
	getPublicSocketsEndpoint,
	loadSocketsServer
} from "$lib/server/sockets/loadSockets.server"
import type { RequestHandler } from "@sveltejs/kit"

let socketsLoaded = false

export const GET: RequestHandler = async ({ url }) => {
	if (!socketsLoaded) {
		socketsLoaded = true
		await loadSocketsServer()
	}

	const endpoint = getPublicSocketsEndpoint(url)
	return new Response(JSON.stringify({ endpoint }), {
		headers: { "Content-Type": "application/json" }
	})
}
