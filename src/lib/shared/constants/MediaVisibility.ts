/**
 * Per-row media visibility (28 §6).
 *
 * Layer 1 of the permission model is derived from the parent — whoever may view
 * a character may view its media — and needs no column. This is layer 2: the
 * row's own say, which can only ever *narrow* what layer 1 allows.
 *
 * A string enum rather than a boolean because more levels are expected (an
 * instance-wide `public`, say). Adding one is an entry here plus a branch in
 * `canViewMedia` — never a migration.
 */
export const MediaVisibility = {
	/** Defer entirely to the parent. The default, and what every migrated row
	 *  gets — it reproduces today's behaviour exactly. */
	SCOPED: "scoped",
	/** Owner only, regardless of parent. Lets a user keep one image out of a
	 *  shared character without unsharing the character. */
	PRIVATE: "private"
} as const

export type MediaVisibilityType =
	(typeof MediaVisibility)[keyof typeof MediaVisibility]

export const MediaVisibilityLabels: Record<MediaVisibilityType, string> = {
	[MediaVisibility.SCOPED]: "Scoped (Default)",
	[MediaVisibility.PRIVATE]: "Private"
}

export const MediaVisibilityDescriptions: Record<MediaVisibilityType, string> =
	{
		[MediaVisibility.SCOPED]:
			"Anyone who can see what this belongs to can see it",
		[MediaVisibility.PRIVATE]: "Only you can see it"
	}

export const MediaVisibilityOptions = [
	MediaVisibility.SCOPED,
	MediaVisibility.PRIVATE
].map((value) => ({ value, label: MediaVisibilityLabels[value] }))

/** Coarse classification derived from a mime type at insert (28 §3). */
export const MediaKind = {
	IMAGE: "image",
	DOCUMENT: "document",
	AUDIO: "audio",
	VIDEO: "video",
	OTHER: "other"
} as const

export type MediaKindType = (typeof MediaKind)[keyof typeof MediaKind]

/**
 * Which stored representation of a file (0182). A CLOSED enum.
 *
 * Before 0182 this had one member and NULL meant "an original", because an
 * original and its derivative were two rows in one table. Now every row in
 * `variants` names one of these, and the file it belongs to is a row of its
 * own — so "original" is a value here rather than the absence of one.
 *
 * **Closed because the value reaches a path builder.** `variantRelPath` puts it
 * in a filename, and it arrives from `?v=` on a URL, so free text here is a
 * path-traversal surface. Validated at the route with `parseMediaVariant` and
 * again by `variants_variant_check` in the database, which is the backstop for
 * a bug that skips the first.
 */
export const MediaVariant = {
	/** The bytes the user or the backend actually gave us. Irreplaceable. */
	ORIGINAL: "original",
	/** Full-size, lossless, web-safe — what a bare `/media/{uuid}` serves.
	 *  Often IS the original row: a png/jpeg/webp/gif upload needs no second
	 *  copy, and the two roles are not mutually exclusive. */
	DISPLAY: "display",
	/** Long edge capped, for a list or a card. Reduced fidelity, freely
	 *  cullable, re-derived on the next request. */
	THUMB: "thumb"
} as const

export type MediaVariantName = (typeof MediaVariant)[keyof typeof MediaVariant]

export const MediaVariantOptions = [
	MediaVariant.ORIGINAL,
	MediaVariant.DISPLAY,
	MediaVariant.THUMB
] as MediaVariantName[]

/**
 * Validate a `?v=` parameter. Null for anything not in the enum — including
 * the empty string, so `?v=` reads as "no variant asked for" only where the
 * caller checks for a *missing* parameter rather than a failed parse.
 *
 * Returns null instead of throwing because the one caller is an HTTP handler
 * whose answer to junk input is 404, and a thrown error there would be a 500.
 */
export function parseMediaVariant(
	raw: string | null | undefined
): MediaVariantName | null {
	if (!raw) return null
	return MediaVariantOptions.includes(raw as MediaVariantName)
		? (raw as MediaVariantName)
		: null
}

/**
 * Whether a variant is a full-fidelity representation of the file.
 *
 * Only `full` rows compete for the display pointer. Everything stored today is
 * lossless or an untouched original, so "serve the smaller of two" costs
 * nothing — but the moment somebody adds a lossy payload transcode, an
 * unscoped smallest-wins would start shipping degraded images to every user,
 * and it would read as a caching bug rather than a selection bug.
 */
export const MediaFidelity = {
	FULL: "full",
	REDUCED: "reduced"
} as const

export type MediaFidelityType =
	(typeof MediaFidelity)[keyof typeof MediaFidelity]
