/**
 * The thumbnail is the face a message skin draws: `avatarSrc` / `spriteSrc`
 * hand the conversation `/media/{uuid}?v=thumb&r={rev}`, and the widest box a
 * core skin draws it in is `REMOTE_FACE_PX` (Dreamlit Cameo's portrait,
 * pinned to the skins' own CSS in `remoteFace.dom.test.svelte.ts`). So the
 * thumbnail's edge is held to twice that box, for a high-density screen: a
 * skin that grows past it must raise `THUMB_MAX_EDGE` too (and run
 * `sweepThumbnails()` to re-cut the stored ones), or every portrait goes soft.
 */
import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { REMOTE_FACE_PX } from "$lib/client/components/sessionPage/remoteFace"
import { makeThumbnail, THUMB_MAX_EDGE } from "./thumbnail"

describe("the thumbnail as a message face", () => {
	test("covers the widest face box a core skin draws, at twice its size", () => {
		expect(THUMB_MAX_EDGE).toBeGreaterThanOrEqual(REMOTE_FACE_PX * 2)
	})

	test("a tall portrait gives a square face of the full edge, cut from its top", async () => {
		// The app's own 1024×1536 mascot, a card-shaped portrait.
		const png = readFileSync("static/mascot.png")
		const thumb = await makeThumbnail(png, "image/png")
		expect(thumb).not.toBeNull()
		expect(thumb!.mime).toBe("image/webp")
		expect([thumb!.width, thumb!.height]).toEqual([THUMB_MAX_EDGE, THUMB_MAX_EDGE])
		expect(thumb!.width).toBeGreaterThanOrEqual(REMOTE_FACE_PX * 2)
	}, 60_000)
})
