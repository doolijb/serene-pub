/**
 * The capped-edge THUMBNAIL (28 §5, 0182), and the list of mimes that decides
 * whether a display variant is a second file at all.
 *
 * The codecs themselves — the one jimp instance, the WASM webp encoder and
 * decoder, and the reasons this stack is what it is — live in
 * `convert/codecs.ts`, and this module is a CONSUMER of them. It kept its own
 * copies until the conversion router arrived; two copies would compile the same
 * `.wasm` twice, on the platform where that compile is the slowest thing an
 * upload does.
 *
 * The full-size lossless display form used to live here as `makeDisplayWebp`.
 * It is a kind-for-kind conversion like any other, so it is now
 * `convertMedia(…, "image/webp", { lossless: true })` and `deriveDisplay` asks
 * the router for it directly.
 */
import {
	decodeImage,
	encodeRaster,
	resizeRaster,
	type RasterImage
} from "./convert/codecs"

/**
 * Longest edge.
 *
 * Was 320, sized off the 64px avatars in CharacterListItem and the persona
 * panel. Character *cards* render their image far larger than an avatar does,
 * and 320 was visibly soft there — so this is sized for the card, and the
 * avatars get the headroom for free.
 *
 * Raising this makes existing thumbnails stale rather than wrong; the backfill
 * pass regenerates any thumbnail smaller than this whose original still has
 * pixels to give (see backfill.ts).
 */
export const THUMB_MAX_EDGE = 480
export const THUMB_QUALITY = 82

export interface ThumbnailResult {
	bytes: Buffer
	width: number
	height: number
	mime: "image/webp"
	ext: "webp"
}

/**
 * Aspect is preserved rather than square-cropped: every call site already
 * applies `object-cover`, so baking a crop in would discard information the CSS
 * is perfectly able to discard itself.
 *
 * Returns null when the source is already smaller than the target — a
 * thumbnail bigger than its original is pure waste, and the original serves.
 *
 * ⚠ **Deliberately NOT routed through the conversion router**, and that is the
 * one exception in this directory rather than an oversight. The router refuses
 * to flatten an animation; a thumbnail MAY flatten one, because a still preview
 * of an animated image is the understood contract for a list cell and the row
 * is written `fidelity: 'reduced'` to say so. Routing this would make an
 * animated GIF thumbnail-less. See `deriveThumb`.
 */
export async function makeThumbnail(
	buffer: Buffer | Uint8Array,
	mime: string
): Promise<ThumbnailResult | null> {
	const src = await decodeImage(buffer, mime)
	const longest = Math.max(src.width, src.height)
	if (longest <= THUMB_MAX_EDGE && mime === "image/webp") return null

	const scale = Math.min(1, THUMB_MAX_EDGE / longest)
	const width = Math.max(1, Math.round(src.width * scale))
	const height = Math.max(1, Math.round(src.height * scale))

	const raster: RasterImage =
		scale < 1 ? await resizeRaster(src, width, height) : src

	return {
		bytes: await encodeRaster(raster, "image/webp", {
			quality: THUMB_QUALITY
		}),
		width: raster.width,
		height: raster.height,
		mime: "image/webp",
		ext: "webp"
	}
}

/**
 * Mimes a browser and every backend can be relied on to take as they are.
 *
 * **This is the list that decides whether a display variant is a second file
 * at all.** When the original is already one of these it IS the display form,
 * and no copy is derived — a ruling with a measured reason rather than an
 * aesthetic one: lossless WebP of a PHOTOGRAPH is usually LARGER than the JPEG
 * it came from, because losslessly compressing photographic noise is
 * expensive. Always deriving one would grow a library of photos on disk, and
 * "cull originals to reclaim space" would then free the small file and keep the
 * big one — the opposite of what an admin means.
 *
 * `image/gif` is in here deliberately. A browser renders an animated GIF
 * natively, so converting one would be a downgrade (see MediaDowngradeError),
 * not an optimisation.
 *
 * A SERVING decision, not a codec fact, which is why it stays a hand-written
 * list here rather than a column on the format table: `image/avif` is
 * web-safe in every browser this app supports and is deliberately absent,
 * because nothing in this build can decode one and a display pointer aimed at
 * an undecodable original could never be re-derived.
 */
export const WEB_SAFE_IMAGE_MIMES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif"
])
