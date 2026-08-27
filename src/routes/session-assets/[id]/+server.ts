/**
 * Serve a session asset (20 §1) — the bytes behind image/file parts and image
 * blocks. Access is the session's: authenticated, and only participants see a
 * session's attachments (404 on denial, never 403 — the established
 * enumeration-avoidance convention).
 */
import type { RequestHandler } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { authenticateRequest } from "$lib/server/auth/authenticateRequest"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { readSessionAsset } from "$lib/server/messages/assets"

export const GET: RequestHandler = async (event) => {
	const id = Number(event.params.id)
	if (!Number.isInteger(id)) return new Response("Not found", { status: 404 })

	const user = await authenticateRequest(event)
	if (!user) return new Response("Unauthorized", { status: 401 })

	const asset = await readSessionAsset(db, id)
	if (!asset) return new Response("Not found", { status: 404 })

	const access = await checkSessionAccess(asset.row.sessionId, user.id)
	if (!access.hasAccess) return new Response("Not found", { status: 404 })

	return new Response(new Uint8Array(asset.bytes), {
		headers: {
			"Content-Type": asset.row.mime,
			// Hash-addressed on disk and referenced by immutable row id — the
			// bytes for an id can never change, so the cache may keep them.
			"Cache-Control": "private, max-age=31536000, immutable"
		}
	})
}
