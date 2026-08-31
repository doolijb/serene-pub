/**
 * Serve a media blob (28 §7).
 *
 * The URL is a proxy, never a location. That is the substantive change from
 * `/images/[...reqPath]`, where the URL *was* a filesystem path — so that
 * handler had to run a `../` containment check on caller-controlled input and
 * re-derive the owner by parsing `segments[2]` out of the path, trusting that
 * every URL the server ever built matched one of three hardcoded shapes. Here
 * the row supplies both, and none of it comes from the caller.
 *
 * **Two address forms, deliberately.**
 *
 *  - `/media/{uuid}` — the real one. A uuid addresses one fixed set of bytes
 *    forever, and is rotated whenever what the row serves could change, so the
 *    response is `immutable` for a year and can never go stale. A changed image
 *    is a changed URL; there is nothing to revalidate.
 *  - `/media/{id}` — a redirect to the above, for the one caller that cannot
 *    have a uuid: a character or persona row carries `avatarMediaId` and
 *    nothing else, and joining for a uuid at ~46 read sites would be a large
 *    blast radius. The redirect itself is `no-store` (it is the part that
 *    changes); the bytes it points at stay cached.
 *
 * 404 rather than 403 on denial — the established enumeration-avoidance
 * convention in this codebase.
 */
import type { RequestHandler } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { authenticateRequest } from "$lib/server/auth/authenticateRequest"
import {
	canViewMedia,
	getMedia,
	getMediaByUuid,
	readMedia,
	thumbsByParent
} from "$lib/server/media"

const NOT_FOUND = () => new Response("Not found", { status: 404 })

export const GET: RequestHandler = async (event) => {
	const param = event.params.id ?? ""
	const user = await authenticateRequest(event)
	if (!user) return new Response("Unauthorized", { status: 401 })

	const wantsThumb = event.url.searchParams.get("v") === "thumb"
	const download = event.url.searchParams.get("download") === "1"

	// ---- by-id: resolve to the uuid form and redirect.
	if (/^\d+$/.test(param)) {
		const row = await getMedia(db, Number(param))
		if (!row) return NOT_FOUND()
		if (!(await canViewMedia(row, user.id))) return NOT_FOUND()

		let target = row
		if (wantsThumb && !row.variant) {
			target = (await thumbsByParent(db, [row.id])).get(row.id) ?? row
		}
		const query = download ? "?download=1" : ""
		return new Response(null, {
			status: 302,
			headers: {
				Location: `/media/${target.uuid}${query}`,
				// The redirect is the only part that may change — cache the
				// bytes it points at, never the pointer.
				"Cache-Control": "no-store"
			}
		})
	}

	// ---- by-uuid: the real thing.
	const row = await getMediaByUuid(db, param)
	if (!row) return NOT_FOUND()

	// Access is always decided on the ORIGINAL, never on the derivative — a
	// thumbnail carries no provenance of its own (28 §5), so it has nothing to
	// be checked against. canViewMedia resolves the parent itself.
	if (!(await canViewMedia(row, user.id))) return NOT_FOUND()

	const found = await readMedia(db, row.id)
	if (!found) return NOT_FOUND()

	// A sensible name for a file whose on-disk name is a hash: the uploader's
	// filename when we kept one, otherwise the id with the real extension.
	const downloadName =
		found.row.filename ??
		`${found.row.id}.${found.row.mime.split("/")[1] ?? "bin"}`

	const etag = `"${found.row.hash}"`
	if (event.request.headers.get("if-none-match") === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } })
	}

	return new Response(new Uint8Array(found.bytes), {
		headers: {
			"Content-Type": found.row.mime,
			"Content-Length": String(found.bytes.byteLength),
			ETag: etag,
			// Unconditionally immutable: the uuid is rotated whenever the
			// served content could differ, so a cached copy at this address is
			// correct by construction.
			"Cache-Control": "private, max-age=31536000, immutable",
			// Never let a browser sniff a stored document into something
			// executable in the app's own origin.
			"X-Content-Type-Options": "nosniff",
			"Content-Disposition": `${
				download ? "attachment" : "inline"
			}; filename="${encodeURIComponent(downloadName)}"`
		}
	})
}
