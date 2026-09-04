/**
 * Building media URLs on the client (28 §7).
 *
 * A client never receives a filesystem path — it receives an id, and every URL
 * it builds is a proxy through the authenticated `/media` route. That is the
 * whole point of the id-addressed design: before 28, `character.avatar` *was*
 * the path, and it shipped `/images/data/users/1/characters/5/avatar-ab12.png`
 * to every browser.
 *
 * **Nothing here knows about `rev`, and that is deliberate (0182).** Cache
 * invalidation now rides on `files.rev` in the query string, but a character row
 * carries `avatarMediaId` and nothing else — it has no uuid and no rev to build
 * one from. The by-id route loads the row anyway to permission-check it, so it
 * has `rev` in hand for free and injects it into the uncached redirect it
 * already answers with. That is what lets these three builders stay
 * rev-unaware, and it is why widening them would be a change with no benefit and
 * a ~46-site blast radius.
 *
 * Anything that already HAS a `ClientMedia` uses `url` / `thumbUrl` /
 * `originalUrl` off the payload instead. **Those already carry a query string**
 * (`?r={rev}`), so a caller adding a parameter of its own must join with `&` —
 * appending `?download=1` produces `…?r=3?download=1`, which is a silently
 * broken link rather than an error.
 */

/**
 * The by-id address of a blob.
 *
 * A media URL is normally a **uuid** (`ClientMedia.url` / `.thumbUrl`), which
 * addresses one fixed set of bytes and is therefore cached immutably. This
 * builds the by-id form instead, which the server answers with a small
 * uncached redirect to that uuid — used only where the caller genuinely has no
 * uuid, i.e. a character or persona row holding `avatarMediaId`.
 */
export function mediaUrl(id: number | null | undefined): string | undefined {
	return id ? `/media/${id}` : undefined
}

/**
 * The thumbnail, resolved server-side from the original's id — falls back to
 * the display form when there is no thumbnail (too small to be worth one, or
 * the encode failed).
 *
 * Since 0182 a thumbnail is derived on FIRST REQUEST rather than at upload, so
 * this URL is what causes one to exist. A fresh upload having no thumb row yet
 * is the healthy state, not a missing derivative.
 *
 * The query form exists because a character row carries `avatarMediaId` and
 * nothing else; asking every read site to join for a thumbnail id would be a
 * large blast radius for a URL the server can resolve itself.
 */
export function mediaThumbUrl(
	id: number | null | undefined
): string | undefined {
	return id ? `/media/${id}?v=thumb` : undefined
}

/** `/media/123` or `/media/123?v=thumb` -> 123. Null for anything else,
 *  including the uuid form — that one is already a final address and must be
 *  passed through untouched. */
const MEDIA_URL_ID = /^\/media\/(\d+)(?:[?#]|$)/

/** Anything that points at an avatar — a character, a persona, or one of the
 *  lightweight view objects the session views build out of them. */
export interface HasAvatar {
	avatarMediaId?: number | null
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
 * Note what `full` means since 0182: the DISPLAY form, which is whichever
 * full-fidelity representation the file's stored pointer names. It is not
 * necessarily the uploaded bytes — asking for those is `?v=original`, and only
 * a download or a card export ever should.
 */
export function avatarSrc(
	entity: HasAvatar | null | undefined,
	opts?: { full?: boolean }
): string | undefined {
	if (!entity) return undefined
	if (entity._avatar) return entity._avatar

	let id = entity.avatarMediaId ?? null

	// A view object that already resolved to a URL — recover the id from it
	// rather than handing the string back untouched. Several session views
	// build `{ ..., avatar: avatarSrc(char) }` objects, and returning that
	// pre-resolved value verbatim silently ignored `full`, so the lightbox
	// opened on a thumbnail. `full` has to win over whatever the caller
	// happened to bake in earlier.
	if (!id && entity.avatar) {
		const match = MEDIA_URL_ID.exec(entity.avatar)
		if (!match) return entity.avatar // not ours (external or static asset)
		id = Number(match[1])
	}

	if (!id) return undefined
	return opts?.full ? mediaUrl(id) : mediaThumbUrl(id)
}
