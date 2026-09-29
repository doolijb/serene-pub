/**
 * A face core's conversation box can show (C7).
 *
 * The conversation is core's own component, mirrored into the page by the
 * guarded receiver, and a speaker's face is an `<img src>` it writes —
 * judged by the SDK's `receiverAttribute` for core's box: the app's own
 * media, an `https:` URL, or an inline RASTER image
 * (`data:image/(png|jpeg|gif|webp);base64,…`). An envoy's image may be any
 * `http(s)` URL or `data:image/…` URI (`ENVOY_IMAGE`), and core's own envoys
 * — the Guide's mascot, the Writing Room's scribe — are
 * `data:image/svg+xml`, which Remote DOM's receiver refuses outright (its
 * script-URL floor): no rule may ever let one into a box.
 *
 * So the page hands the conversation a face the box takes, where it builds
 * the dossier (`speaker.face`, `speaker.sprite`):
 *
 * - one the box already takes goes as it is (as the box would write it,
 *   trimmed);
 * - an inline image the box refuses — an SVG above all — is drawn once,
 *   here in the page, to a raster of the same picture (`REMOTE_FACE_DRAWING`:
 *   a WebP at twice the widest avatar box): `null` until it is ready, and
 *   `landed` moves when it is, so the dossier re-projects;
 * - anything else (`http:`, a path that is not the app's media) is no face
 *   at all: the line shows its initial, as a speaker with no picture does.
 *
 * The drawing is the page's, never the remote's: a worker has no `Image`,
 * and what a remote is shown must already be what its box may hold.
 */
import { SvelteMap } from "svelte/reactivity"
import { receiverAttribute } from "@serene-pub/sdk"

/** What becomes of a face on its way into core's box. */
export type RemoteFaceKind = "pass" | "rasterize" | "drop"

/** How a face the box refuses is drawn. */
export interface FaceDrawing {
	/** The drawing's shorter side, in canvas pixels. */
	side: number
	/**
	 * What it is encoded as. A browser that cannot encode it gives a PNG
	 * instead (`toDataURL`'s rule), which the box takes as well.
	 */
	type: "image/webp"
	/** The encoder's quality, 0 to 1. */
	quality: number
}

/** Draws an inline image to one the box takes (a raster data URI), as `drawing` says. */
export type FaceRasterizer = (src: string, drawing: Readonly<FaceDrawing>) => Promise<string>

/**
 * The box a remote face is drawn for, in CSS pixels: the widest avatar a
 * core message skin draws — Dreamlit Cameo's portrait, `--sp-portrait`, at
 * most 13rem (a large, unframed portrait since P3h; Stage's is 2.5rem,
 * Bubbles' 2rem, Compact's 1.75rem).
 */
export const REMOTE_FACE_PX = 208
/** Drawn at twice that, for a high-density screen. */
const REMOTE_FACE_DENSITY = 2

/**
 * The drawing every refused face gets. The drawn face is copied into each
 * line of the dossier an envoy speaks, so its size is paid per line: the
 * Guide's mascot as this WebP is 6.3k characters where the 128px PNG before
 * it was 10.8k (and a PNG at this side 16.6k), and it stays sharp in the
 * widest box.
 */
export const REMOTE_FACE_DRAWING: Readonly<FaceDrawing> = Object.freeze({
	side: REMOTE_FACE_PX * REMOTE_FACE_DENSITY,
	type: "image/webp",
	quality: 0.8
})

/** An inline image of any type: the page can draw it, whatever the box makes of it. */
const INLINE_IMAGE = /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i

/** Whose box the conversation runs in — core's, the one whose `img` takes `https:` and raster data. */
const CORE_OWNER = "core"

/** The value core's box would write for this `img src`, or null when it refuses it. */
function boxTakes(url: string): string | null {
	const judged = receiverAttribute("img", "src", url, CORE_OWNER)
	return "value" in judged && judged.value ? judged.value : null
}

/** Whether a face goes into the box as it is, is drawn first, or goes not at all. */
export function remoteFaceKind(url: string | null | undefined): RemoteFaceKind {
	if (!url) return "drop"
	if (boxTakes(url) !== null) return "pass"
	return INLINE_IMAGE.test(url.trim()) ? "rasterize" : "drop"
}

/**
 * The page's own drawing: decode the image, paint it on a canvas whose
 * shorter side is `drawing.side` (the avatar's `object-fit: cover` then
 * crops it as it would the original), and read it back encoded as
 * `drawing` says. A picture with no size of its own — an SVG with only a
 * `viewBox` — is drawn square.
 */
export const rasterizeFace: FaceRasterizer = async (src, { side, type, quality }) => {
	const img = new Image()
	img.src = src
	await img.decode()
	const draw = (short: number, as: string) => {
		const w = img.naturalWidth || short
		const h = img.naturalHeight || short
		const scale = short / Math.min(w, h)
		const canvas = document.createElement("canvas")
		canvas.width = Math.max(1, Math.round(w * scale))
		canvas.height = Math.max(1, Math.round(h * scale))
		const ctx = canvas.getContext("2d")
		if (!ctx) throw new Error("no 2d canvas to draw a face on")
		ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
		return canvas.toDataURL(as, quality)
	}
	const out = draw(side, type)
	// A browser that cannot encode the type answers PNG (Safari has no WebP
	// canvas encoder): drawn again smaller, so the fallback is never larger
	// per line than the 128px PNG this drawing replaced.
	return out.startsWith(`data:${type}`) ? out : draw(Math.min(side, PNG_FALLBACK_SIDE), "image/png")
}

/** The fallback drawing's shorter side, when the browser cannot encode `REMOTE_FACE_DRAWING.type`. */
export const PNG_FALLBACK_SIDE = 128

/** The page's faces for core's box, each inline image drawn once. */
export interface RemoteFaces {
	/** A face the box takes for `url`, or null: none it may show, or a drawing still under way. */
	face(url: string | null | undefined): string | null
	/**
	 * How many drawings have settled — reactive. A projection that caches
	 * what it built reads it into its cache key, so a face that lands (or
	 * fails, and stays none) re-projects the lines that were waiting on it.
	 */
	readonly landed: number
}

export function createRemoteFaces(opts: { rasterize?: FaceRasterizer } = {}): RemoteFaces {
	const rasterize = opts.rasterize ?? rasterizeFace
	/** Each inline image, once drawn: its raster, or null when it could not be drawn. */
	const drawn = new SvelteMap<string, string | null>()
	/**
	 * Drawings under way. Plain, not state: a drawing starts from inside the
	 * dossier's derived, which may not write state — the drawing lands
	 * later, outside it.
	 */
	const drawing = new Set<string>()

	const draw = (src: string) => {
		drawing.add(src)
		Promise.resolve()
			.then(() => rasterize(src, REMOTE_FACE_DRAWING))
			.then(
				// What the drawing gave must itself be a face the box takes.
				(out) => (typeof out === "string" && boxTakes(out)) || null,
				() => null
			)
			.then((face) => {
				drawing.delete(src)
				drawn.set(src, face)
			})
	}

	return {
		face(url) {
			if (!url) return null
			const taken = boxTakes(url)
			if (taken !== null) return taken
			const src = url.trim()
			if (!INLINE_IMAGE.test(src)) return null
			if (drawn.has(src)) return drawn.get(src) ?? null
			if (!drawing.has(src)) draw(src)
			return null
		},
		get landed() {
			return drawn.size
		}
	}
}
