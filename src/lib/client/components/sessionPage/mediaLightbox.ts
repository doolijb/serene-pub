/**
 * The media lightbox's reading of a `view-image` request (composer
 * attachments plan §3.4, lane F): the images it pages through, where it
 * starts, which of them are the app's own files (so it can offer a download
 * and an info pane), and how a swipe reads.
 *
 * A **lightbox** is the page's full-size image viewer; this one is opened by
 * a message (its media strip, or an image in its text). Not the character
 * gallery's viewer (`EntityGalleryViewModal`), which browses a character's
 * pictures and keeps its own strip.
 */
import type { MediaInfoV1 } from "$lib/shared/media/info"

export interface LightboxImage {
	src: string
	caption: string | null
	/** `/media/{id|uuid}` — the app's own file, by the id or uuid in its address. */
	mediaRef: string | null
}

export interface LightboxState {
	images: LightboxImage[]
	index: number
}

/** The id or uuid of an app media address (`/media/41`, `/media/<uuid>?v=thumb`), or null. */
export function mediaRefOf(src: string): string | null {
	const m =
		/^\/(?:media|session-assets)\/(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#]|$)/i.exec(
			src
		)
	return m ? m[1] : null
}

/**
 * What the lightbox shows for one `view-image`. A gallery the request names
 * is taken when it holds `src`; anything else — no gallery, an index out of
 * range, a gallery that does not hold the image asked for — is the one image.
 */
export function lightboxStateOf(params: {
	src: string
	gallery?: { srcs?: unknown; index?: unknown; captions?: unknown }
}): LightboxState {
	const image = (src: string, caption: unknown): LightboxImage => ({
		src,
		caption: typeof caption === "string" && caption.trim() ? caption : null,
		mediaRef: mediaRefOf(src)
	})
	const g = params.gallery
	const srcs = Array.isArray(g?.srcs)
		? g.srcs.filter((s): s is string => typeof s === "string")
		: []
	const captions = Array.isArray(g?.captions) ? g.captions : []
	const index = typeof g?.index === "number" ? g.index : -1
	if (srcs.length && srcs.length === (g?.srcs as unknown[]).length && srcs[index] === params.src) {
		return { images: srcs.map((s, i) => image(s, captions[i])), index }
	}
	return { images: [image(params.src, undefined)], index: 0 }
}

/** The next index, wrapping — a gallery is a loop, not a dead end. */
export function stepIndex(index: number, by: 1 | -1, count: number): number {
	if (count <= 0) return 0
	return (index + by + count) % count
}

/** The download address for an app file; null for anything else (not ours to save). */
export function downloadHref(image: LightboxImage): string | null {
	return image.mediaRef ? `/media/${image.mediaRef}?download=1` : null
}

/** The full-size address the lightbox draws: the display form, never a thumbnail. */
export function displaySrc(image: LightboxImage): string {
	return image.mediaRef ? `/media/${image.mediaRef}` : image.src
}

/**
 * A horizontal swipe's direction, or null for a tap, a scroll or a short
 * drag: at least 48px across, and more across than down.
 */
export function swipeDirection(dx: number, dy: number): 1 | -1 | null {
	if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return null
	return dx < 0 ? 1 : -1
}

/** A byte count for the info pane. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The info pane's rows, in reading order: what made it first, then the file. */
export function infoRows(info: MediaInfoV1): { label: string; value: string }[] {
	const rows: { label: string; value: string }[] = []
	const push = (label: string, value: unknown) => {
		if (value === undefined || value === null || value === "") return
		rows.push({ label, value: String(value) })
	}
	const g = info.generated
	if (g) {
		push("Prompt", g.prompt)
		push("Negative prompt", g.negativePrompt)
		push("Model", g.model)
		push("Seed", g.seed)
		push("Steps", g.steps)
		push("Guidance (CFG)", g.cfg)
		push("Sampler", g.sampler)
		push("Scheduler", g.scheduler)
		if (g.width && g.height) push("Requested size", `${g.width} × ${g.height}`)
		push("Sampling", g.samplingConfig)
		push("Connection", g.connectionName)
	}
	push("File name", info.filename)
	push("Type", info.mime)
	if (info.bytes) push("Size", formatBytes(info.bytes))
	if (info.width && info.height) push("Dimensions", `${info.width} × ${info.height}`)
	return rows
}

/** Read one file's info for the pane; null when it is gone or not the viewer's. */
export async function fetchMediaInfo(
	mediaRef: string,
	fetcher: typeof fetch = fetch
): Promise<MediaInfoV1 | null> {
	try {
		const res = await fetcher(`/media/${mediaRef}/info`, {
			credentials: "same-origin"
		})
		if (!res.ok) return null
		return (await res.json()) as MediaInfoV1
	} catch {
		return null
	}
}
