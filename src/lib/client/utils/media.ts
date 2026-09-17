/**
 * Building media URLs on the client (28 §7).
 *
 * A client never receives a filesystem path — it receives an id, and every URL
 * it builds is a proxy through the authenticated `/media` route. That is the
 * whole point of the id-addressed design: a path in `character.avatar` would
 * ship `/images/data/users/1/characters/5/avatar-ab12.png` to every browser.
 *
 * **Two address forms, and `rev` is why the uuid one is preferred.** A browser
 * caches an image against its `<img src>` string, so `/media/{id}?v=thumb` — one
 * string for every revision of that file — keeps serving the pixels it already
 * has when the row behind it changes in place. `/media/{uuid}?v=thumb&r={rev}`
 * changes whenever the bytes do, which is what dislodges them. Build it
 * whenever the payload joined `avatarMedia`; a payload that did not join still
 * gets the by-id redirect, which stays correct and merely stale.
 *
 * Anything that already HAS a `ClientMedia` uses `url` / `thumbUrl` /
 * `originalUrl` off the payload instead. **Those already carry a query string**
 * (`?r={rev}`), so a caller adding a parameter of its own must join with `&` —
 * appending `?download=1` produces `…?r=3?download=1`, which is a silently
 * broken link rather than an error.
 */

import type { MediaFrame } from "$lib/shared/media/frame"

/**
 * The by-id address of a blob.
 *
 * A media URL is normally a **uuid** (`ClientMedia.url` / `.thumbUrl`), which
 * addresses one fixed set of bytes and is therefore cached immutably. This
 * builds the by-id form instead, which the server answers with a small
 * uncached redirect to that uuid — the fallback for a payload that carries
 * `avatarMediaId` and no joined media row.
 */
export function mediaUrl(id: number | null | undefined): string | undefined {
	return id ? `/media/${id}` : undefined
}

/**
 * The thumbnail, resolved server-side from the original's id — falls back to
 * the display form when there is no thumbnail (too small to be worth one, or
 * the encode failed).
 *
 * A thumbnail is derived on FIRST REQUEST rather than at upload, so this URL is
 * what causes one to exist. A fresh upload having no thumb row yet is the
 * healthy state, not a missing derivative.
 */
export function mediaThumbUrl(
	id: number | null | undefined
): string | undefined {
	return id ? `/media/${id}?v=thumb` : undefined
}

/**
 * The uuid form, byte for byte what the server's own `mediaUrl` builds.
 *
 * The two must agree as STRINGS: a pinned scene portrait is matched against a
 * cast member's avatar by URL equality, and a one-character difference in
 * parameter order breaks that match silently.
 */
export function mediaRevUrl(
	uuid: string,
	rev: number,
	opts?: { full?: boolean }
): string {
	const query = opts?.full ? `r=${rev}` : `v=thumb&r=${rev}`
	return `/media/${uuid}?${query}`
}

/** `/media/123` or `/media/123?v=thumb` -> 123. Null for anything else. */
const MEDIA_URL_ID = /^\/media\/(\d+)(?:[?#]|$)/

/** `/media/{uuid}?v=thumb&r=3` -> the uuid and the query it carries. */
const MEDIA_URL_UUID =
	/^\/media\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\?([^#]*))?/

/** A media row's public address and cache token, as a payload carries them
 *  alongside `avatarMediaId`. */
export interface AvatarMedia {
	uuid: string
	rev: number
	/** The stored crop, so an editor opens on what is stored rather than on the
	 *  default rule. Null when nothing was cropped. */
	frame?: MediaFrame | null
}

/** Anything that points at an avatar — a character (a persona is one) or one of
 *  the lightweight view objects the session views build out of them. */
export interface HasAvatar {
	avatarMediaId?: number | null
	/** The avatar file's uuid and cache token, joined by the server. Absent on
	 *  a payload that did not join; null when there is no avatar. */
	avatarMedia?: AvatarMedia | null
	/** A local preview (object URL / data URL) during an unsaved edit. Wins
	 *  over the stored avatar so a just-picked file shows immediately. */
	_avatar?: string | null
	/** A pre-resolved URL, on view objects that already did this conversion. */
	avatar?: string | null
}

/**
 * The `src` for an entity's avatar.
 *
 * Thumbnail by default: the largest routine display is 64px, so shipping a
 * multi-megabyte original to a list of them is pure waste. Pass
 * `{ full: true }` where the image is actually shown large.
 *
 * `full` means the DISPLAY form: whichever full-fidelity representation the
 * file's stored pointer names. It is not necessarily the uploaded bytes —
 * asking for those is `?v=original`, and only a download or a card export ever
 * should.
 */
export function avatarSrc(
	entity: HasAvatar | null | undefined,
	opts?: { full?: boolean }
): string | undefined {
	if (!entity) return undefined
	if (entity._avatar) return entity._avatar

	let id = entity.avatarMediaId ?? null
	let media = entity.avatarMedia ?? null

	// A view object that already resolved to a URL — recover the address from
	// it rather than handing the string back untouched. Several session views
	// build `{ ..., avatar: avatarSrc(char) }` objects, and returning that
	// pre-resolved value verbatim ignores `full`, so the lightbox opens on a
	// thumbnail. `full` has to win over whatever the caller baked in earlier.
	if (!id && !media && entity.avatar) {
		const byId = MEDIA_URL_ID.exec(entity.avatar)
		if (byId) {
			id = Number(byId[1])
		} else {
			const byUuid = MEDIA_URL_UUID.exec(entity.avatar)
			if (!byUuid) return entity.avatar // not ours (external or static asset)
			const rev = Number(
				new URLSearchParams(byUuid[2] ?? "").get("r") ?? ""
			)
			media = {
				uuid: byUuid[1],
				rev: Number.isFinite(rev) ? rev : 0
			}
		}
	}

	if (media) return mediaRevUrl(media.uuid, media.rev, opts)
	if (!id) return undefined
	return opts?.full ? mediaUrl(id) : mediaThumbUrl(id)
}

/** A media row whose bytes changed while keeping its id, as `media:changed`
 *  announces it. */
export interface MediaRevision {
	id: number
	uuid: string
	rev: number
	/** The crop as it now stands, since re-framing IS one of the reasons the
	 *  bytes changed. Absent from an announcement that predates the field. */
	frame?: MediaFrame | null
}

/**
 * The same entity with its avatar re-addressed at a media row that changed in
 * place, or the entity itself when it wears something else.
 *
 * A rev bump writes nothing to the character row, so an open view is
 * holding a correct `avatarMediaId` and stale pixels. Only a different URL
 * string dislodges them, and this is what changes it.
 *
 * The identity of the return value is the signal: a caller reassigning session
 * state can skip the rows that came back unchanged.
 */
export function withRevisedAvatar<T extends HasAvatar>(
	entity: T,
	changed: MediaRevision
): T {
	if (entity.avatarMediaId !== changed.id) return entity
	if (
		entity.avatarMedia?.uuid === changed.uuid &&
		entity.avatarMedia?.rev === changed.rev
	) {
		return entity
	}
	return {
		...entity,
		avatarMedia: {
			uuid: changed.uuid,
			rev: changed.rev,
			// Explicitly absent, not falsy: a CLEARED frame is null and has to
			// replace the old one rather than fall through to it.
			frame:
				changed.frame !== undefined
					? changed.frame
					: (entity.avatarMedia?.frame ?? null)
		}
	}
}
