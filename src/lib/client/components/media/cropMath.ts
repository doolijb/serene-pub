/**
 * The crop editor's arithmetic, with no DOM in it.
 *
 * **The frame is the state.** Pan, zoom and nudge are operations that return a
 * new frame in source pixels; the image element's placement is derived from the
 * frame at render time (`frameTransform`). Storing a scroll offset and a scale
 * instead would mean two numbers that have to agree with the frame, and the
 * frame is the only one that gets saved.
 *
 * **The mask is a square**, because an avatar is drawn round or square
 * everywhere it appears and a non-square frame would be cropped again by CSS at
 * every call site. Every operation keeps `w === h`; a free-aspect mode is one
 * flag through `zoomFrameAt` and `frameAtZoom`, and needs no change to the
 * stored shape or to the server, which clamps any rectangle.
 */
import {
	MIN_FRAME_EDGE,
	clampFrame,
	defaultFrame,
	framesEqual,
	type MediaFrame
} from "$lib/shared/media/frame"

/** How far in the editor may go, as a multiple of the default frame's edge.
 *  Past this the mask is showing single pixels and the thumbnail encoder has
 *  nothing left to work with. */
export const MAX_ZOOM = 8

/** The largest and smallest square edge this image allows, in source pixels. */
export function zoomBounds(
	imageWidth: number,
	imageHeight: number
): { minEdge: number; maxEdge: number } {
	const maxEdge = Math.max(
		MIN_FRAME_EDGE,
		Math.min(imageWidth, imageHeight) || MIN_FRAME_EDGE
	)
	return {
		minEdge: Math.max(MIN_FRAME_EDGE, Math.round(maxEdge / MAX_ZOOM)),
		maxEdge
	}
}

/** The source pixel under a point measured from the mask's top-left corner. */
export function viewportToSource(
	point: { x: number; y: number },
	frame: MediaFrame,
	maskSize: number
): { x: number; y: number } {
	const perPixel = frame.w / maskSize
	return { x: frame.x + point.x * perPixel, y: frame.y + point.y * perPixel }
}

/** Where a source pixel lands inside the mask. The inverse of
 *  `viewportToSource`, and the two are tested as a round trip. */
export function sourceToViewport(
	point: { x: number; y: number },
	frame: MediaFrame,
	maskSize: number
): { x: number; y: number } {
	const scale = maskSize / frame.w
	return { x: (point.x - frame.x) * scale, y: (point.y - frame.y) * scale }
}

/**
 * How to place the image element so the frame fills the mask: scale it, then
 * offset it by the frame's origin.
 *
 * `left` and `top` are in mask pixels and are normally negative — the part of
 * the image above and left of the frame hangs outside the mask, which is what
 * the editor dims rather than hides.
 */
export function frameTransform(
	frame: MediaFrame,
	maskSize: number
): { scale: number; left: number; top: number } {
	const scale = maskSize / frame.w
	return { scale, left: -frame.x * scale, top: -frame.y * scale }
}

/**
 * Drag the image by a viewport delta.
 *
 * The window walks the opposite way to the pointer: dragging the picture right
 * shows what is to its left.
 */
export function panFrame(
	frame: MediaFrame,
	dxViewport: number,
	dyViewport: number,
	maskSize: number,
	imageWidth: number,
	imageHeight: number
): MediaFrame {
	const perPixel = frame.w / maskSize
	return clampFrame(
		{
			...frame,
			x: frame.x - dxViewport * perPixel,
			y: frame.y - dyViewport * perPixel
		},
		imageWidth,
		imageHeight
	)
}

/** Move the frame by whole source pixels — what an arrow key does. */
export function nudgeFrame(
	frame: MediaFrame,
	dx: number,
	dy: number,
	imageWidth: number,
	imageHeight: number
): MediaFrame {
	return clampFrame(
		{ ...frame, x: frame.x + dx, y: frame.y + dy },
		imageWidth,
		imageHeight
	)
}

/** The frame's edge at a zoom level, bounded both ways. */
function edgeAtZoom(
	zoom: number,
	imageWidth: number,
	imageHeight: number
): number {
	const { minEdge, maxEdge } = zoomBounds(imageWidth, imageHeight)
	const wanted = Math.round(maxEdge / (Number.isFinite(zoom) ? zoom : 1))
	return Math.min(Math.max(wanted, minEdge), maxEdge)
}

/**
 * Zoom by a factor, holding the source pixel under `anchor` still.
 *
 * `anchor` is measured from the mask's top-left, so a wheel event anchors on
 * the pointer and a pinch anchors on the midpoint between the two touches.
 */
export function zoomFrameAt(
	frame: MediaFrame,
	factor: number,
	anchor: { x: number; y: number },
	maskSize: number,
	imageWidth: number,
	imageHeight: number
): MediaFrame {
	const held = viewportToSource(anchor, frame, maskSize)
	const edge = edgeAtZoom(
		frameZoom(frame, imageWidth, imageHeight) * factor,
		imageWidth,
		imageHeight
	)
	// Put the held pixel back under the anchor at the new scale, then clamp —
	// so an anchor near an edge slides rather than refusing to zoom.
	return clampFrame(
		{
			x: held.x - (anchor.x / maskSize) * edge,
			y: held.y - (anchor.y / maskSize) * edge,
			w: edge,
			h: edge
		},
		imageWidth,
		imageHeight
	)
}

/** The slider's value for a frame: 1 at the default frame, `MAX_ZOOM` at the
 *  tightest crop. */
export function frameZoom(
	frame: MediaFrame,
	imageWidth: number,
	imageHeight: number
): number {
	const { maxEdge } = zoomBounds(imageWidth, imageHeight)
	return Math.min(Math.max(maxEdge / frame.w, 1), MAX_ZOOM)
}

/**
 * What the editor hands its caller: null when the frame is the default rule's
 * own answer, otherwise a PLAIN copy of it.
 *
 * Null keeps the file on the rule rather than freezing today's output of it.
 *
 * ⚠ A copy, never the editor's own object. The caller keeps this value past
 * the close, and the close unmounts the editor: what crosses that boundary is
 * plain, so nothing is read out of a destroyed component.
 */
export function savedFrame(
	frame: MediaFrame,
	imageWidth: number,
	imageHeight: number
): MediaFrame | null {
	if (framesEqual(frame, defaultFrame(imageWidth, imageHeight))) return null
	return { x: frame.x, y: frame.y, w: frame.w, h: frame.h }
}

/** The frame at a slider value, zoomed about its own centre. */
export function frameAtZoom(
	frame: MediaFrame,
	zoom: number,
	imageWidth: number,
	imageHeight: number
): MediaFrame {
	const edge = edgeAtZoom(zoom, imageWidth, imageHeight)
	const cx = frame.x + frame.w / 2
	const cy = frame.y + frame.h / 2
	return clampFrame(
		{ x: cx - edge / 2, y: cy - edge / 2, w: edge, h: edge },
		imageWidth,
		imageHeight
	)
}
