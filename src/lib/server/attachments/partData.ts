/**
 * The message part that shows one stored file — `core:image` or `core:file`
 * — written the same way whoever wrote it: a person's attachment
 * (`commitTraySend`), a pipeline's generated image (`host.ts` `mediaParts`)
 * or an outlet's bytes (`core:outlet/attach-image`).
 *
 * Part data (PLAN-composer-attachments §3.1 "Part data", §5.4):
 *
 *  - `core:image` — `{ assetId, alt?, filename?, width?, height? }`. Width and
 *    height are denormalised so the media strip reserves the picture's space
 *    before it loads, and the strip has no layout shift.
 *  - `core:file` — `{ assetId, mime, name?, bytes? }`. `bytes` is the display
 *    form's size, so the strip's chip says "3 KB" without a second read.
 *
 * Every field but `assetId` is a copy of the file row at write time — what a
 * reader shows, never what decides access. One writer, so the three paths
 * cannot drift into three shapes of one part.
 */
import type { FileRow } from "$lib/server/media"

export interface MediaPartInput {
	type: "core:image" | "core:file"
	data: Record<string, unknown>
}

/** Positive finite numbers only — a zero or a null width is "not known". */
const known = (n: number | null | undefined): n is number =>
	typeof n === "number" && Number.isFinite(n) && n > 0

export function mediaPartFor(
	file: Pick<
		FileRow,
		"id" | "kind" | "filename" | "width" | "height" | "displayMime" | "displayBytes"
	>,
	opts: {
		/** Force the part type — an outlet that was told it is attaching an image. */
		as?: "image" | "file"
		alt?: string | null
		/** A name to use when the file row kept none. */
		name?: string | null
		/** The mime to use when the row has no display mime projected yet. */
		mime?: string | null
	} = {}
): MediaPartInput {
	const isImage = opts.as ? opts.as === "image" : file.kind === "image"
	const name = file.filename ?? opts.name ?? null
	if (isImage)
		return {
			type: "core:image",
			data: {
				assetId: file.id,
				...(opts.alt ? { alt: String(opts.alt) } : {}),
				...(name ? { filename: name } : {}),
				...(known(file.width) ? { width: file.width } : {}),
				...(known(file.height) ? { height: file.height } : {})
			}
		}
	return {
		type: "core:file",
		data: {
			assetId: file.id,
			// The display variant's mime, denormalised onto the file row so
			// this stays one query. Null would mean a file with no display
			// pointer, which `createMedia` never leaves behind.
			mime: file.displayMime ?? opts.mime ?? "application/octet-stream",
			...(name ? { name } : {}),
			...(known(file.displayBytes) ? { bytes: file.displayBytes } : {})
		}
	}
}
