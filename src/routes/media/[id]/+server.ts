/**
 * Serve a media blob (28 §7, resplit by 0182).
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
 *  - `/media/{uuid}?v={variant}&r={rev}` — the real one. One uuid per logical
 *    file, shared by every representation; `rev` changes when the bytes behind
 *    a URL do, which is what lets the response be `immutable` for a year with
 *    nothing to revalidate.
 *  - `/media/{id}` — a redirect to the above, for the one caller that cannot
 *    have a uuid: a character or persona row carries `avatarMediaId` and
 *    nothing else, and joining for a uuid at ~46 read sites would be a large
 *    blast radius.
 *
 * **The by-id redirect is what makes `$lib/client/utils/media.ts` possible.**
 * Those three builders are pinned and cannot know `rev` — an entity row holds
 * an id and no more. This branch already loads the row to permission-check it,
 * so it has `files.rev` in hand for free and injects it into the `no-store`
 * redirect it already answered with. Without that, every avatar read site would
 * have had to learn about revisions.
 *
 * **`r` is read and IGNORED.** It is a cache-buster, not a token: its only job
 * is to make the URL string differ. Rejecting a stale `r` would turn a client
 * holding an old URL into a broken image instead of a merely stale one, which
 * is strictly worse.
 *
 * 404 rather than 403 on denial — the established enumeration-avoidance
 * convention in this codebase.
 */
import type { RequestHandler } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { authenticateRequest } from "$lib/server/auth/authenticateRequest"
import {
	canViewMedia,
	ensureVariant,
	getMedia,
	getMediaByUuid,
	getVariantById,
	variantsFor,
	type FileRow,
	type ResolvedVariant
} from "$lib/server/media"
import {
	MediaFidelity,
	MediaVariant,
	parseMediaVariant,
	type MediaVariantName
} from "$lib/shared/constants/MediaVisibility"

const NOT_FOUND = () => new Response("Not found", { status: 404 })

/**
 * Whether the client says it can DECODE this type. Format capability only —
 * which of the acceptable representations it actually gets is decided by the
 * file's stored display pointer, never by this.
 *
 * No header means no constraint (a crawler, a `fetch()` with no Accept), which
 * is why the `Vary: Accept` below is unconditional on the display branch: a
 * `Vary` that appeared only when negotiation happened to change the answer
 * would poison a shared cache with the first Accept-less request.
 */
function acceptsMime(header: string | null, mime: string): boolean {
	if (!header) return true
	const type = mime.split("/")[0]
	for (const part of header.split(",")) {
		const [raw, ...params] = part.trim().split(";")
		if (params.some((p) => p.trim().replace(/\s/g, "") === "q=0")) continue
		const candidate = raw.trim().toLowerCase()
		if (
			candidate === "*/*" ||
			candidate === `${type}/*` ||
			candidate === mime
		) {
			return true
		}
	}
	return false
}

/**
 * What a bare `/media/{uuid}` serves: the display form, followed from the
 * file's STORED pointer rather than compared at request time — a live
 * comparison would let a newly derived variant change what an
 * already-cached immutable URL serves without changing the URL.
 */
async function resolveDisplay(
	file: FileRow,
	accept: string | null
): Promise<ResolvedVariant | null> {
	let resolved: ResolvedVariant | null = null

	if (file.displayVariantId) {
		const pointed = await getVariantById(db, file.displayVariantId)
		if (pointed) {
			resolved = await ensureVariant(
				db,
				file,
				pointed.variant as MediaVariantName
			)
		}
	}
	// Nothing pointed at yet — a format that needs converting, and this
	// request is the one that pays for it.
	if (!resolved) resolved = await ensureVariant(db, file, MediaVariant.DISPLAY)
	// Last resort: the bytes as uploaded. Better than 404 for a file whose
	// conversion failed.
	if (!resolved) {
		resolved = await ensureVariant(db, file, MediaVariant.ORIGINAL)
	}
	if (!resolved) return null

	if (acceptsMime(accept, resolved.mime)) return resolved

	// The client cannot decode what the pointer names. Fall back to another
	// FULL-FIDELITY representation it can take — smallest first, since they are
	// equivalent by definition of `full`.
	const current = resolved
	const alternates = (await variantsFor(db, file.id))
		.filter(
			(v) =>
				v.id !== current.row?.id &&
				v.fidelity === MediaFidelity.FULL &&
				acceptsMime(accept, v.mime)
		)
		.sort((a, b) => a.bytes - b.bytes)
	for (const alternate of alternates) {
		const usable = await ensureVariant(
			db,
			file,
			alternate.variant as MediaVariantName
		)
		if (usable) return usable
	}
	// Nothing acceptable exists. Serve the pointer anyway — a strict-Accept
	// client is better served than 406'd.
	return current
}

export const GET: RequestHandler = async (event) => {
	const param = event.params.id ?? ""
	const user = await authenticateRequest(event)
	if (!user) return new Response("Unauthorized", { status: 401 })

	const rawVariant = event.url.searchParams.get("v")
	// Validated against the closed enum BEFORE it can reach a path builder;
	// junk is a 404, not a 500 and not a traversal.
	const requested = parseMediaVariant(rawVariant)
	if (rawVariant !== null && !requested) return NOT_FOUND()
	const download = event.url.searchParams.get("download") === "1"

	// ---- by-id: resolve to the uuid form and redirect.
	if (/^\d+$/.test(param)) {
		const file = await getMedia(db, Number(param))
		if (!file) return NOT_FOUND()
		if (!(await canViewMedia(file, user.id))) return NOT_FOUND()

		// No variant resolution here — which variant a URL means is the
		// by-uuid branch's job, and doing it twice is how the two forms drift.
		const query = new URLSearchParams()
		if (requested) query.set("v", requested)
		query.set("r", String(file.rev))
		if (download) query.set("download", "1")
		return new Response(null, {
			status: 302,
			headers: {
				Location: `/media/${file.uuid}?${query}`,
				// The redirect is the only part that may change — cache the
				// bytes it points at, never the pointer.
				"Cache-Control": "no-store"
			}
		})
	}

	// ---- by-uuid: the real thing.
	const file = await getMediaByUuid(db, param)
	if (!file) return NOT_FOUND()

	// Access is decided on the FILE, which is where provenance lives. A variant
	// is never looked up independently of its file on any checked path.
	if (!(await canViewMedia(file, user.id))) return NOT_FOUND()

	const accept = event.request.headers.get("accept")
	let negotiated = false
	let resolved: ResolvedVariant | null = null

	if (requested) {
		resolved = await ensureVariant(db, file, requested)
		if (!resolved) {
			// A culled original, or a derivation that failed. Falling back to
			// the display form is the ruled answer for `?v=original` and the
			// sensible one for a thumbnail: an image matters more than its
			// optimisation.
			resolved = await resolveDisplay(file, accept)
			negotiated = true
		}
	} else {
		resolved = await resolveDisplay(file, accept)
		negotiated = true
	}
	if (!resolved) return NOT_FOUND()

	// A sensible name for a file whose on-disk name is a hash: the uploader's
	// filename when we kept one, otherwise the id with the served extension.
	const downloadName =
		file.filename ?? `${file.id}.${resolved.mime.split("/")[1] ?? "bin"}`

	// The RESOLVED variant's hash, not the file's — the file's hash identifies
	// the original, and serving a thumbnail under it would collide two
	// different sets of bytes on one ETag.
	const etag = `"${resolved.hash}"`
	const headers: Record<string, string> = {
		ETag: etag,
		// Unconditionally immutable: `rev` changes whenever the bytes behind
		// this URL could differ, so a cached copy at this address is correct by
		// construction.
		"Cache-Control": "private, max-age=31536000, immutable",
		// Never let a browser sniff a stored document into something
		// executable in the app's own origin.
		"X-Content-Type-Options": "nosniff"
	}
	// Set whenever the answer went through format negotiation at all — see
	// acceptsMime for why this must not depend on whether it changed anything.
	if (negotiated) headers["Vary"] = "Accept"

	if (event.request.headers.get("if-none-match") === etag) {
		return new Response(null, { status: 304, headers })
	}

	return new Response(new Uint8Array(resolved.bytes), {
		headers: {
			...headers,
			"Content-Type": resolved.mime,
			"Content-Length": String(resolved.bytes.byteLength),
			"Content-Disposition": `${
				download ? "attachment" : "inline"
			}; filename="${encodeURIComponent(downloadName)}"`
		}
	})
}
