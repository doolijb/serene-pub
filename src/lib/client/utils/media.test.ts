/**
 * `avatarSrc` — and specifically the rule that `full` wins over whatever the
 * caller already resolved.
 *
 * Several session views build lightweight objects like
 * `{ id, name, avatar: avatarSrc(char) }` and pass those on. When the fallback
 * returned that pre-resolved string verbatim, `full: true` was silently
 * ignored — so clicking a character avatar in a session opened the lightbox on
 * the thumbnail instead of the original.
 */
import { describe, expect, test } from "vitest"
import { avatarSrc, mediaUrl, mediaThumbUrl } from "./media"

describe("mediaUrl / mediaThumbUrl", () => {
	test("build proxy URLs, never paths", () => {
		expect(mediaUrl(12)).toBe("/media/12")
		expect(mediaThumbUrl(12)).toBe("/media/12?v=thumb")
	})

	test("are undefined for a missing id", () => {
		expect(mediaUrl(null)).toBeUndefined()
		expect(mediaThumbUrl(undefined)).toBeUndefined()
		expect(mediaUrl(0)).toBeUndefined()
	})
})

describe("avatarSrc", () => {
	test("thumbnail by default, original on request", () => {
		const char = { avatarMediaId: 5 }
		expect(avatarSrc(char)).toBe("/media/5?v=thumb")
		expect(avatarSrc(char, { full: true })).toBe("/media/5")
	})

	test("recovers the id from a pre-resolved thumbnail URL so `full` still wins", () => {
		// This is the lightbox regression, in one assertion.
		const viewObject = { avatar: "/media/5?v=thumb" }
		expect(avatarSrc(viewObject, { full: true })).toBe("/media/5")
		expect(avatarSrc(viewObject)).toBe("/media/5?v=thumb")
	})

	test("recovers the id from a pre-resolved original URL too", () => {
		const viewObject = { avatar: "/media/9" }
		expect(avatarSrc(viewObject)).toBe("/media/9?v=thumb")
		expect(avatarSrc(viewObject, { full: true })).toBe("/media/9")
	})

	test("passes through a URL that is not ours", () => {
		// A shipped static asset, or anything else we did not mint. There is
		// no id to recover, so it is returned untouched rather than dropped.
		expect(avatarSrc({ avatar: "/backgrounds/defaults/x.webp" })).toBe(
			"/backgrounds/defaults/x.webp"
		)
	})

	test("an unsaved local preview beats everything", () => {
		expect(
			avatarSrc(
				{ _avatar: "blob:local-preview", avatarMediaId: 5 },
				{ full: true }
			)
		).toBe("blob:local-preview")
	})

	test("is undefined when there is nothing to show", () => {
		expect(avatarSrc(null)).toBeUndefined()
		expect(avatarSrc(undefined)).toBeUndefined()
		expect(avatarSrc({})).toBeUndefined()
		expect(avatarSrc({ avatarMediaId: null, avatar: null })).toBeUndefined()
	})
})
