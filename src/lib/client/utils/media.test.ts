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
import { avatarSrc, mediaUrl, mediaThumbUrl, withRevisedAvatar } from "./media"

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

describe("avatarSrc — the revision-bearing uuid form", () => {
	test("builds the uuid form when the payload joined the media row", () => {
		const char = {
			avatarMediaId: 5,
			avatarMedia: {
				uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
				rev: 3
			}
		}
		expect(avatarSrc(char)).toBe(
			"/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?v=thumb&r=3"
		)
		expect(avatarSrc(char, { full: true })).toBe(
			"/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?r=3"
		)
	})

	test("a rev bump changes the URL string, which is the whole point", () => {
		const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
		const before = avatarSrc({
			avatarMediaId: 5,
			avatarMedia: { uuid, rev: 3 }
		})
		const after = avatarSrc({
			avatarMediaId: 5,
			avatarMedia: { uuid, rev: 4 }
		})
		expect(after).not.toBe(before)
	})

	test("falls back to the by-id form when the payload did not join", () => {
		expect(avatarSrc({ avatarMediaId: 5, avatarMedia: null })).toBe(
			"/media/5?v=thumb"
		)
	})

	test("recovers uuid and rev from a pre-resolved URL so `full` still wins", () => {
		const viewObject = {
			avatar: "/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?v=thumb&r=7"
		}
		expect(avatarSrc(viewObject, { full: true })).toBe(
			"/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?r=7"
		)
		expect(avatarSrc(viewObject)).toBe(
			"/media/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee?v=thumb&r=7"
		)
	})

	test("an unsaved local preview still beats a joined media row", () => {
		expect(
			avatarSrc({
				_avatar: "blob:local-preview",
				avatarMediaId: 5,
				avatarMedia: {
					uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
					rev: 3
				}
			})
		).toBe("blob:local-preview")
	})
})

describe("withRevisedAvatar", () => {
	const uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"

	test("re-points an entity wearing the changed file", () => {
		const entity = { avatarMediaId: 5, avatarMedia: { uuid, rev: 3 } }
		const next = withRevisedAvatar(entity, { id: 5, uuid, rev: 4 })
		expect(next).not.toBe(entity)
		expect(avatarSrc(next)).toBe(`/media/${uuid}?v=thumb&r=4`)
	})

	test("teaches an un-joined entity the uuid it never had", () => {
		const entity = { avatarMediaId: 5 }
		const next = withRevisedAvatar(entity, { id: 5, uuid, rev: 4 })
		expect(avatarSrc(next)).toBe(`/media/${uuid}?v=thumb&r=4`)
	})

	test("returns the same reference for an entity wearing something else", () => {
		const entity = { avatarMediaId: 6, avatarMedia: { uuid, rev: 3 } }
		expect(withRevisedAvatar(entity, { id: 5, uuid, rev: 4 })).toBe(entity)
	})

	test("returns the same reference for an entity with no avatar at all", () => {
		const entity = { avatarMediaId: null }
		expect(withRevisedAvatar(entity, { id: 5, uuid, rev: 4 })).toBe(entity)
	})
})
