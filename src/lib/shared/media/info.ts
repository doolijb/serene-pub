/**
 * What the lightbox's info pane shows about one file (composer attachments
 * plan §3.4, lane F): `GET /media/{id|uuid}/info`.
 *
 * A PROJECTION, never the row: `files.meta` is written once by whatever made
 * the file and is never interpreted, so the pane reads only the named fields
 * below and nothing a generator happened to stash there reaches a viewer
 * unasked. Connection identity (`connectionName`) is stripped for anyone who
 * is not an administrator, by the same rule as every other payload
 * (`connections/visibility.ts`).
 */
export interface MediaInfoV1 {
	id: number
	uuid: string
	/** `files.kind` — image, document, … */
	kind: string
	/** The uploader's filename, when one was kept. */
	filename: string | null
	/** The display form's type and size, which is what the viewer downloads. */
	mime: string | null
	bytes: number | null
	width: number | null
	height: number | null
	/** Present only for a file an image connection made. */
	generated: MediaGenerationInfoV1 | null
}

export interface MediaGenerationInfoV1 {
	prompt?: string
	negativePrompt?: string
	seed?: number
	model?: string
	steps?: number
	cfg?: number
	sampler?: string
	scheduler?: string
	width?: number
	height?: number
	samplingConfig?: string
	/** Administrators only. */
	connectionName?: string
}
