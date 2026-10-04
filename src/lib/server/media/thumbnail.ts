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
	cropRaster,
	decodeImage,
	encodeRaster,
	resizeRaster,
	type RasterImage
} from "./convert/codecs"
import {
	clampFrame,
	defaultFrame,
	type MediaFrame
} from "$lib/shared/media/frame"

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
 * The thumbnail is cut from the file's FRAME, and from `defaultFrame` when it
 * has none — see `$lib/shared/media/frame`. A thumbnail is shown in a square
 * cell at every call site, so the crop is decided here, where the pixels are,
 * rather than by whatever `object-cover` happens to reach for.
 *
 * Returns null only when there is nothing to do: the frame is the whole image,
 * the image is already under the target, and the bytes are already webp.
 *
 * ⚠ **Not routed through the conversion router**, and that is the one exception
 * in this directory rather than an oversight. The router refuses to flatten an
 * animation; a thumbnail MAY flatten one, because a still preview of an
 * animated image is the understood contract for a list cell and the row is
 * written `fidelity: 'reduced'` to say so. Routing this would make an animated
 * GIF thumbnail-less. See `deriveThumb`.
 */
export async function makeThumbnail(
	buffer: Buffer | Uint8Array,
	mime: string,
	frame?: MediaFrame | null
): Promise<ThumbnailResult | null> {
	const src = await decodeImage(buffer, mime)
	// Clamped against the DECODED size, not the stored one: a frame is checked
	// against `files.width/height` when it is set, and this is the source of
	// truth for the bytes actually in hand.
	const cut = clampFrame(
		frame ?? defaultFrame(src.width, src.height),
		src.width,
		src.height
	)
	const whole =
		cut.x === 0 &&
		cut.y === 0 &&
		cut.w === src.width &&
		cut.h === src.height

	const longest = Math.max(cut.w, cut.h)
	if (whole && longest <= THUMB_MAX_EDGE && mime === "image/webp") return null

	const cropped: RasterImage = whole
		? src
		: cropRaster(src, cut.x, cut.y, cut.w, cut.h)

	const scale = Math.min(1, THUMB_MAX_EDGE / longest)
	const width = Math.max(1, Math.round(cut.w * scale))
	const height = Math.max(1, Math.round(cut.h * scale))

	const raster: RasterImage =
		scale < 1 ? await resizeRaster(cropped, width, height) : cropped

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
 * Longest edge of the FITTED form (composer attachments plan §4.2).
 *
 * 1568 is the edge Anthropic documents as the size past which it downscales an
 * image itself, so a fitted image goes to a vision model without being shrunk
 * twice — and it is comfortably larger than a message preview ever renders
 * (`max-height: 20rem` at 2× density is 640 px tall).
 */
export const FITTED_MAX_EDGE = 1568
export const FITTED_QUALITY = 90

export interface FittedResult {
	bytes: Buffer
	width: number
	height: number
	mime: "image/webp" | "image/png"
	ext: "webp" | "png"
}

/** Any pixel not fully opaque — RGBA, alpha every fourth byte. */
function hasAlpha(raster: RasterImage): boolean {
	const d = raster.data
	for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true
	return false
}

/**
 * The FITTED form: the WHOLE image (never cropped — a top-anchored square
 * thumbnail crops a landscape photo badly), long edge capped at
 * `FITTED_MAX_EDGE`.
 *
 * Returns null when there is nothing to do: the source already fits and is
 * web-safe, so it IS its own fitted form (and an animated GIF that fits keeps
 * moving in the preview). Otherwise it scales down and encodes lossy WebP —
 * or PNG for a PNG source with transparency, so a cut-out sticker keeps its
 * edges. Like the thumbnail it MAY flatten an animation that has to shrink;
 * the row is written `fidelity: 'reduced'` to say so, and the same reason
 * keeps this off the conversion router.
 */
export async function makeFitted(
	buffer: Buffer | Uint8Array,
	mime: string
): Promise<FittedResult | null> {
	const src = await decodeImage(buffer, mime)
	const longest = Math.max(src.width, src.height)
	if (longest <= FITTED_MAX_EDGE && WEB_SAFE_IMAGE_MIMES.has(mime)) return null

	const scale = Math.min(1, FITTED_MAX_EDGE / longest)
	const width = Math.max(1, Math.round(src.width * scale))
	const height = Math.max(1, Math.round(src.height * scale))
	const raster: RasterImage =
		scale < 1 ? await resizeRaster(src, width, height) : src

	if (mime === "image/png" && hasAlpha(raster)) {
		return {
			bytes: await encodeRaster(raster, "image/png"),
			width: raster.width,
			height: raster.height,
			mime: "image/png",
			ext: "png"
		}
	}
	return {
		bytes: await encodeRaster(raster, "image/webp", {
			quality: FITTED_QUALITY
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
