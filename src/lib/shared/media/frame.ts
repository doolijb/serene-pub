/**
 * A file's FRAME: the region of the original that stands for the whole image
 * wherever one small picture of it is shown.
 *
 * Non-destructive. The frame decides what the THUMBNAIL is cut from; the
 * original and display variants stay whole, so re-framing is always reversible
 * and a lightbox always shows everything.
 *
 * **Source-pixel units of the ORIGINAL variant, and whole numbers.** That is the
 * one coordinate space every consumer agrees on: a viewport size is a display
 * accident, and a fraction of the width re-rounds differently in every renderer.
 *
 * **NULL is the stored default, never an explicit copy of `defaultFrame`.** The
 * default rule is a rule; a row that wrote its output down would keep today's
 * answer after the rule changes.
 */
export interface MediaFrame {
	x: number
	y: number
	w: number
	h: number
}

/**
 * The smallest edge a frame may have, in source pixels.
 *
 * A frame under this is a pointing error rather than an intention, and the
 * thumbnail cut from it carries no usable detail at any display size.
 */
export const MIN_FRAME_EDGE = 16

/**
 * What an unframed image is cut to: the largest square, anchored to the TOP
 * edge and centred horizontally.
 *
 * Top rather than centre because character art is overwhelmingly a portrait
 * with the face in the upper third — a centred square takes the chest. A
 * landscape source keeps its full height and is centred across.
 *
 * ⚠ **The single definition of that rule.** The server cuts the thumbnail with
 * it and the crop editor opens on it, so they cannot disagree about what an
 * uncropped avatar looks like.
 */
export function defaultFrame(width: number, height: number): MediaFrame {
	const edge = Math.min(width, height)
	return { x: Math.floor((width - edge) / 2), y: 0, w: edge, h: edge }
}

/**
 * The same frame pulled inside the image, at or above the minimum edge.
 *
 * Aspect-agnostic: it clamps whatever rectangle it is handed. Keeping a frame
 * square is the editor's business, so a free-aspect mode needs nothing here.
 */
export function clampFrame(
	frame: MediaFrame,
	width: number,
	height: number
): MediaFrame {
	const w = Math.min(Math.max(Math.round(frame.w), MIN_FRAME_EDGE), width)
	const h = Math.min(Math.max(Math.round(frame.h), MIN_FRAME_EDGE), height)
	return {
		x: Math.min(Math.max(Math.round(frame.x), 0), Math.max(0, width - w)),
		y: Math.min(Math.max(Math.round(frame.y), 0), Math.max(0, height - h)),
		w,
		h
	}
}

/** Whether two frames name the same region, with null meaning "the default
 *  rule applies" on both sides. */
export function framesEqual(
	a: MediaFrame | null | undefined,
	b: MediaFrame | null | undefined
): boolean {
	if (!a || !b) return !a && !b
	return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/**
 * Why this frame may not be stored against an image of these dimensions, as a
 * sentence to show the user, or null when it may.
 *
 * A SENTENCE rather than a boolean because every refusal here is something the
 * caller got wrong about an image it can measure, and "invalid frame" sends
 * nobody anywhere.
 */
export function frameProblem(
	frame: MediaFrame,
	width: number | null | undefined,
	height: number | null | undefined
): string | null {
	if (!width || !height) {
		return "That file has no stored dimensions, so a crop cannot be placed on it."
	}
	const values = [frame?.x, frame?.y, frame?.w, frame?.h]
	if (values.some((v) => typeof v !== "number" || !Number.isInteger(v))) {
		return "A crop must be whole pixels of the original image."
	}
	if (frame.w < MIN_FRAME_EDGE || frame.h < MIN_FRAME_EDGE) {
		return `A crop must be at least ${MIN_FRAME_EDGE} pixels on each side.`
	}
	if (
		frame.x < 0 ||
		frame.y < 0 ||
		frame.x + frame.w > width ||
		frame.y + frame.h > height
	) {
		return `That crop falls outside the image, which is ${width} by ${height} pixels.`
	}
	return null
}
