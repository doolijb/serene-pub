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
import { PNG } from "pngjs"
import {
	MediaVariant,
	parseMediaVariant
} from "$lib/shared/constants/MediaVisibility"
import {
	FITTED_MAX_EDGE,
	makeFitted,
	makeThumbnail,
	THUMB_MAX_EDGE
} from "./thumbnail"

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

describe("the fitted form (composer attachments §4.2)", () => {
	function rgba(width: number, height: number, alpha: number): Buffer {
		const p = new PNG({ width, height })
		for (let i = 0; i < p.data.length; i += 4) {
			p.data[i] = 30
			p.data[i + 1] = i % 251
			p.data[i + 2] = 200
			p.data[i + 3] = alpha
		}
		return PNG.sync.write(p)
	}

	test("the route accepts ?v=fitted", () => {
		expect(parseMediaVariant("fitted")).toBe(MediaVariant.FITTED)
		expect(parseMediaVariant("fitted/../x")).toBeNull()
	})

	test("a web-safe image that already fits is its own fitted form", async () => {
		// The mascot is 1024×1536 — inside the cap on both edges.
		const png = readFileSync("static/mascot.png")
		expect(await makeFitted(png, "image/png")).toBeNull()
	}, 60_000)

	test("an opaque oversize image scales uncropped to lossy WebP", async () => {
		const fitted = await makeFitted(rgba(2000, 3000, 255), "image/png")
		expect(fitted).not.toBeNull()
		expect(fitted!.mime).toBe("image/webp")
		expect(fitted!.height).toBe(FITTED_MAX_EDGE)
		expect(fitted!.width).toBe(Math.round(2000 * (FITTED_MAX_EDGE / 3000)))
	}, 60_000)

	test("a transparent oversize PNG stays PNG so its edges survive", async () => {
		const fitted = await makeFitted(rgba(1800, 900, 128), "image/png")
		expect(fitted!.mime).toBe("image/png")
		expect([fitted!.width, fitted!.height]).toEqual([FITTED_MAX_EDGE, 784])
	}, 60_000)
})
