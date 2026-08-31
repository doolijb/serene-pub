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

/** The one and only derivative kind today. NULL means "an original". */
export const MediaVariant = {
	THUMB: "thumb"
} as const
