/**
 * The info-pane projection of a file (`MediaInfoV1`). Pure: the route does
 * the access check and hands the row in.
 */
import type {
	MediaGenerationInfoV1,
	MediaInfoV1
} from "$lib/shared/media/info"
import {
	redactConnections,
	type ConnectionSubject
} from "$lib/server/connections/visibility"
import type { FileRow } from "./index"

const str = (v: unknown): string | undefined =>
	typeof v === "string" && v.trim() ? v : undefined
const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined

/**
 * The generation fields, read by name from `files.meta` (and its `request`,
 * which holds what was asked for). Null when the file was not generated —
 * which is "no prompt was recorded", the one field every render has.
 */
function generationOf(
	meta: Record<string, unknown> | null
): MediaGenerationInfoV1 | null {
	if (!meta) return null
	const prompt = str(meta.prompt)
	if (prompt === undefined) return null
	const req =
		meta.request && typeof meta.request === "object"
			? (meta.request as Record<string, unknown>)
			: {}
	const out: MediaGenerationInfoV1 = {
		prompt,
		negativePrompt: str(meta.negativePrompt) ?? str(req.negativePrompt),
		seed: num(meta.seed) ?? num(req.seed),
		model: str(meta.model) ?? str(req.model),
		steps: num(req.steps),
		cfg: num(req.cfg),
		sampler: str(req.sampler),
		scheduler: str(req.scheduler),
		width: num(req.width),
		height: num(req.height),
		samplingConfig: str(meta.samplingConfig),
		connectionName: str(meta.connectionName)
	}
	for (const key of Object.keys(out) as (keyof MediaGenerationInfoV1)[]) {
		if (out[key] === undefined) delete out[key]
	}
	return out
}

export function mediaInfo(
	file: FileRow,
	subject: ConnectionSubject | null | undefined
): MediaInfoV1 {
	return redactConnections(
		{
			id: file.id,
			uuid: file.uuid,
			kind: file.kind,
			filename: file.filename ?? null,
			mime: file.displayMime ?? null,
			bytes: file.displayBytes ?? null,
			width: file.width ?? null,
			height: file.height ?? null,
			generated: generationOf(file.meta ?? null)
		},
		subject
	)
}
