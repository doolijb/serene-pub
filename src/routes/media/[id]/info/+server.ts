/**
 * `GET /media/{id|uuid}/info` — the lightbox info pane's read (composer
 * attachments plan §3.4, lane F). The same access rule as the bytes
 * (`canViewMedia`, decided on the file), and the same 404 for "no such file"
 * and "not yours", so the route is no probe for ids.
 */
import { json, type RequestHandler } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { authenticateRequest } from "$lib/server/auth/authenticateRequest"
import { canViewMedia, getMedia, getMediaByUuid } from "$lib/server/media"
import { mediaInfo } from "$lib/server/media/info"

const NOT_FOUND = () => new Response("Not found", { status: 404 })

export const GET: RequestHandler = async (event) => {
	const param = event.params.id ?? ""
	const user = await authenticateRequest(event)
	if (!user) return new Response("Unauthorized", { status: 401 })

	const file = /^\d+$/.test(param)
		? await getMedia(db, Number(param))
		: await getMediaByUuid(db, param)
	if (!file) return NOT_FOUND()
	if (!(await canViewMedia(file, user.id))) return NOT_FOUND()

	return json(mediaInfo(file, user), {
		headers: { "Cache-Control": "private, no-store" }
	})
}
