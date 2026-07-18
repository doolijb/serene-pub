// SvelteKit endpoint to serve avatar files from the OS-agnostic app data directory
import type { RequestHandler } from "@sveltejs/kit"
import path from "path"
import fs from "fs/promises"
import { getAppDataDir } from "$lib/server/utils"
import { authenticateRequest } from "$lib/server/auth/authenticateRequest"

export const GET: RequestHandler = async (event) => {
	const { params } = event
	const { reqPath } = params
	if (!reqPath) {
		return new Response("Not found", { status: 404 })
	}

	// hooks.server.ts runs no auth middleware on HTTP routes (only the socket
	// layer enforces it) — without this, every uploaded avatar/gallery/
	// background file was servable to anyone on the internet who could guess
	// or enumerate a path, no login required.
	const user = await authenticateRequest(event)
	if (!user) {
		return new Response("Unauthorized", { status: 401 })
	}
	// reqPath is an array (SvelteKit catchall)
	const relPath = Array.isArray(reqPath) ? reqPath.join("/") : reqPath
	const appData = path.resolve(getAppDataDir())
	const filePath = path.resolve(appData, relPath)
	// Containment check — reqPath is caller-controlled, so without this an
	// encoded/normalized "../" sequence could resolve outside appData and
	// read arbitrary files on disk (same pattern already used by
	// deleteUserBackground for the equivalent write-side risk).
	if (filePath !== appData && !filePath.startsWith(appData + path.sep)) {
		return new Response("Not found", { status: 404 })
	}
	try {
		const data = await fs.readFile(filePath)
		// Guess content type from extension
		const ext = path.extname(filePath).toLowerCase()
		let type = "application/octet-stream"
		if (ext === ".png") type = "image/png"
		else if (ext === ".jpg" || ext === ".jpeg") type = "image/jpeg"
		else if (ext === ".webp") type = "image/webp"
		else if (ext === ".gif") type = "image/gif"
		// SvelteKit Response expects Uint8Array, not Buffer
		return new Response(new Uint8Array(data), {
			headers: {
				"Content-Type": type,
				"Cache-Control": "public, max-age=0"
			}
		})
	} catch (e) {
		return new Response("Not found", { status: 404 })
	}
}
