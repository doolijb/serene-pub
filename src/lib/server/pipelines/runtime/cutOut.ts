/**
 * 🚧 `core:task/cut-out@1` — each picture with its background removed (plan
 * DESIGN-image-generation §0 *cut-out*, §1.9, §6.3; unit I4).
 *
 * ## What one item goes through
 *
 *  1. The reference is resolved to its FILE row (`getMediaByUuid`). Not an
 *     image, or gone: the item passes through untouched — a cut-out step is
 *     never the reason a sprite set loses a picture.
 *  2. `auto` skips a picture that already has alpha: meta `transparent:
 *     'native'` (the pair drew it), meta `cutOutOf` (it IS a cut-out), or an
 *     original whose pixels already carry transparency.
 *  3. The matte is computed on the FITTED variant (long edge ≤ 1568) — the
 *     matting model resizes to its own 1024² anyway, so feeding it a 4K
 *     original buys decode time and nothing else — then scaled up to the
 *     original's size with jimp and put into the ORIGINAL's alpha channel.
 *  4. A green-screen hint (`plainBackground: '#00ff00'` in the source's meta,
 *     what the sprite prompt asks for) keys that colour out first and lets the
 *     matte refine the edge: the final alpha is the lower of the two.
 *  5. The result is a new PNG through `createMedia`, owned and placed exactly
 *     like the source (user, character, session, message, visibility), with
 *     meta `{ cutOutOf: <source uuid>, model: 'BiRefNet_lite' }`. NOT a child
 *     of the source (`parentMediaId` semantics are thumbnails') — a cut-out is
 *     a picture of its own that a person may keep after deleting the source.
 *
 * The item out is the item in with its reference fields (uuid, kind, mime,
 * bytes, width, height, filename) replaced — every other field, a series `key`
 * among them, rides across unchanged.
 *
 * ## The first run downloads the model
 *
 * Once, into `<app data>/models/matting` (`localModels/matting.ts`). While it
 * downloads the node says so on its status line (*Downloading the background
 * remover, once*) and pulses, which is what the definition's idle timeout
 * counts.
 */

import type { Bindings, TaskCtx } from "@serene-pub/sdk"
import { ok, reads } from "@serene-pub/sdk"
import type * as C from "@serene-pub/contracts"
import type { NodeInput } from "./bindingTypes"
import type { Matte, MattingProgress } from "$lib/server/localModels/matting"
import type { RasterImage } from "$lib/server/media/convert/codecs"

export type CutOutMode = "auto" | "always" | "off"

export function cutOutModeOf(raw: unknown): CutOutMode {
	return raw === "always" || raw === "off" ? raw : "auto"
}

/** Any pixel not fully opaque. */
export function rasterHasAlpha(raster: RasterImage): boolean {
	const d = raster.data
	for (let i = 3; i < d.length; i += 4) if (d[i] !== 255) return true
	return false
}

/** What the source's own meta says about its background, read defensively. */
export function alreadyCutOut(meta: unknown): boolean {
	if (!meta || typeof meta !== "object") return false
	const m = meta as Record<string, unknown>
	return m.transparent === "native" || typeof m.cutOutOf === "string"
}

/** `#rgb` / `#rrggbb` → [r, g, b], or null. */
export function parseHexColour(raw: unknown): [number, number, number] | null {
	if (typeof raw !== "string") return null
	const s = raw.trim().replace(/^#/, "")
	const full =
		/^[0-9a-f]{3}$/i.test(s)
			? s
					.split("")
					.map((c) => c + c)
					.join("")
			: /^[0-9a-f]{6}$/i.test(s)
				? s
				: null
	if (!full) return null
	return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [
		number,
		number,
		number
	]
}

/**
 * A chroma key's alpha for one pixel: 0 on the key colour, 255 well away from
 * it, a ramp between — so the matte, not the key, decides the soft edge.
 */
const KEY_INNER = 60
const KEY_OUTER = 140
function keyAlpha(
	r: number,
	g: number,
	b: number,
	key: readonly [number, number, number]
): number {
	const dist = Math.sqrt(
		(r - key[0]) ** 2 + (g - key[1]) ** 2 + (b - key[2]) ** 2
	)
	if (dist <= KEY_INNER) return 0
	if (dist >= KEY_OUTER) return 255
	return Math.round(((dist - KEY_INNER) / (KEY_OUTER - KEY_INNER)) * 255)
}

/**
 * Scale a one-channel matte to `width × height` through jimp's resize (the
 * one resize this codebase has): the matte is spread into a grey RGBA raster,
 * resized, and read back off its red channel.
 */
export async function scaleMatte(
	matte: { alpha: Uint8ClampedArray; width: number; height: number },
	width: number,
	height: number
): Promise<Uint8ClampedArray> {
	if (matte.width === width && matte.height === height) return matte.alpha
	const { resizeRaster } = await import("$lib/server/media/convert/codecs")
	const grey = new Uint8ClampedArray(matte.width * matte.height * 4)
	for (let i = 0; i < matte.alpha.length; i++) {
		const v = matte.alpha[i]
		grey[i * 4] = v
		grey[i * 4 + 1] = v
		grey[i * 4 + 2] = v
		grey[i * 4 + 3] = 255
	}
	const scaled = await resizeRaster(
		{ data: grey, width: matte.width, height: matte.height },
		width,
		height
	)
	const out = new Uint8ClampedArray(width * height)
	for (let i = 0; i < out.length; i++) out[i] = scaled.data[i * 4]
	return out
}

/**
 * The original's pixels with `alpha` as their alpha channel — the lower of
 * the matte, the key (when there is one) and whatever alpha the original
 * already had, so cutting out a picture twice never makes it LESS transparent.
 */
export function composeCutOut(
	original: RasterImage,
	alpha: Uint8ClampedArray,
	key: readonly [number, number, number] | null = null
): RasterImage {
	const data = new Uint8ClampedArray(original.data)
	for (let i = 0; i < alpha.length; i++) {
		const o = i * 4
		let a = Math.min(alpha[i], data[o + 3])
		if (key) a = Math.min(a, keyAlpha(data[o], data[o + 1], data[o + 2], key))
		data[o + 3] = a
	}
	return { data, width: original.width, height: original.height }
}

export interface CutOutDeps {
	/** The matting model. Defaults to the local BiRefNet-lite pipeline. */
	matte?: Matte
	/** The first-use download's progress, for the status line. */
	onProgress?: MattingProgress
}

function uuidOf(item: unknown): string | null {
	if (typeof item === "string") return item
	const u = (item as { uuid?: unknown } | null)?.uuid
	return typeof u === "string" ? u : null
}

/**
 * The whole node, minus the SDK plumbing: one item out per item in.
 */
export async function cutOutItems(
	db: Db,
	items: readonly unknown[],
	mode: CutOutMode,
	deps: CutOutDeps = {}
): Promise<unknown[]> {
	if (mode === "off" || !items.length) return [...items]
	const media = await import("$lib/server/media")
	const { decodeImage, encodeRaster } = await import(
		"$lib/server/media/convert/codecs"
	)
	const { MediaVariant } = await import(
		"$lib/shared/constants/MediaVisibility"
	)

	const out: unknown[] = []
	for (const item of items) {
		const uuid = uuidOf(item)
		const file = uuid ? await media.getMediaByUuid(db, uuid) : null
		if (!file || file.kind !== "image") {
			out.push(item)
			continue
		}
		if (mode === "auto" && alreadyCutOut(file.meta)) {
			out.push(item)
			continue
		}
		const original = await media.readMedia(db, file.id)
		if (!original) {
			out.push(item)
			continue
		}
		const source = await decodeImage(original.bytes, original.mime)
		if (mode === "auto" && rasterHasAlpha(source)) {
			out.push(item)
			continue
		}

		// The matte from the fitted form when there is a smaller one.
		const fitted = await media
			.readMedia(db, file.id, MediaVariant.FITTED)
			.catch(() => null)
		const modelInput =
			fitted && fitted.width != null && fitted.width < source.width
				? await decodeImage(fitted.bytes, fitted.mime)
				: source

		const matte = deps.matte
			? deps.matte
			: (await import("$lib/server/localModels/matting")).mattingMatte(db, {
					userId: file.userId,
					onProgress: deps.onProgress
				})
		const mask = await matte(modelInput)
		const alpha = await scaleMatte(mask, source.width, source.height)
		const key = parseHexColour(
			(file.meta as Record<string, unknown> | null)?.plainBackground
		)
		const cut = composeCutOut(source, alpha, key)
		const png = await encodeRaster(cut, "image/png")

		const { MATTING_MODEL_NAME } = await import(
			"$lib/server/localModels/matting"
		)
		const { file: made } = await media.createMedia(db, {
			userId: file.userId,
			characterId: file.characterId,
			sessionId: file.sessionId,
			messageId: file.messageId,
			...(file.sessionId == null && file.characterId == null
				? { bucket: "generated" }
				: {}),
			visibility: file.visibility as any,
			bytes: png,
			filename: "cut-out.png",
			meta: { cutOutOf: file.uuid, model: MATTING_MODEL_NAME }
		})

		const base =
			typeof item === "object" && item !== null
				? (item as Record<string, unknown>)
				: {}
		out.push({
			...base,
			uuid: made.uuid,
			kind: "image",
			mime: made.displayMime ?? "image/png",
			bytes: made.displayBytes ?? png.byteLength,
			width: made.width ?? cut.width,
			height: made.height ?? cut.height,
			filename: "cut-out.png"
		})
	}
	return out
}

export function cutOutBindings(): Bindings {
	return {
		"core:task/cut-out@1": reads<typeof C.cutOut>(
			async (input: NodeInput<typeof C.cutOut>, ctx: TaskCtx) => {
				const raw = input?.media as unknown
				const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
				const mode = cutOutModeOf(input?.params?.mode)
				const { db } = await import("$lib/server/db")
				const media = await cutOutItems(db, items, mode, {
					onProgress: ({ percent }) => {
						ctx.pulse?.()
						ctx.status?.(
							percent == null
								? {
										i18n: {
											en: "Downloading the background remover, once"
										}
									}
								: {
										i18n: {
											en: "Downloading the background remover, once ({percent}%)"
										},
										vars: { percent }
									}
						)
					}
				})
				return ok({ main: media as any, media: media as any })
			},
			{ ports: ["media"], params: ["mode"] }
		)
	}
}
