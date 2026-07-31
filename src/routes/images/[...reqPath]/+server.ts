// SvelteKit endpoint to serve avatar files from the OS-agnostic app data directory
import type { RequestHandler } from "@sveltejs/kit"
import path from "path"
import fs from "fs/promises"
import { getAppDataDir } from "$lib/server/utils"
import { authenticateRequest } from "$lib/server/auth/authenticateRequest"
import { canViewCharacter, canViewPersona } from "$lib/server/utils/chatAccess"

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

	// Authentication above only proves *who* is asking, not that they should
	// see *this* file — without this, any logged-in user could view any
	// other user's avatars/gallery images/backgrounds by guessing or
	// observing a path. Every server-constructed image URL follows exactly
	// one of three shapes (confirmed by grep across utils/index.ts and
	// import.ts): data/users/{ownerId}/characters/{characterId}/{file},
	// data/users/{ownerId}/personas/{personaId}/{file}, and
	// data/users/{ownerId}/backgrounds/{file} (personal, never shared).
	// A non-owner may view a character/persona's images if they share a
	// chat that includes it (mirrors the existing view-sharing model used
	// elsewhere — canViewCharacter/canViewPersona); backgrounds (and
	// anything else under a user's dir) stay owner-only. 404, not 403, on
	// denial — no signal distinguishing "wrong owner" from "doesn't exist",
	// matching this codebase's established enumeration-avoidance convention.
	const segments = relPath.split("/")
	if (segments[0] === "data" && segments[1] === "users" && segments[2]) {
		const ownerId = Number(segments[2])
		if (!Number.isInteger(ownerId)) {
			return new Response("Not found", { status: 404 })
		}
		if (ownerId !== user.id) {
			const resourceType = segments[3]
			const resourceId = Number(segments[4])
			let allowed = false
			if (
				resourceType === "characters" &&
				Number.isInteger(resourceId)
			) {
				allowed = await canViewCharacter(resourceId, user.id)
			} else if (
				resourceType === "personas" &&
				Number.isInteger(resourceId)
			) {
				allowed = await canViewPersona(resourceId, user.id)
			}
			if (!allowed) {
				return new Response("Not found", { status: 404 })
			}
		}
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
