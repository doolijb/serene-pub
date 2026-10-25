/**
 * 🚧 **Media a model wrote, stored** (O5, 2026-10-21) — a spoken reply's audio,
 * a picture a text model drew in its reply. The text oracle's twin of what
 * `dispatchImage` does for a render: bytes in, one `files` row each through
 * `createMedia` (provenance: run, step, model), and a `MediaRef` out for the
 * port. Bytes never travel the graph; a reference does.
 */
import type { MediaRef } from "@serene-pub/sdk"
import type { GeneratedMediaItem } from "$lib/shared/imageGen/types"
import { extensionForMime } from "$lib/shared/media/formats"

export async function storeGeneratedMedia(
	db: Db,
	items: readonly GeneratedMediaItem[],
	scope: {
		userId?: number | null
		sessionId?: number | null
		/** Which run and which step wrote it — the file's provenance. */
		runId?: number | string | null
		step?: string | null
	}
): Promise<MediaRef[]> {
	if (!items.length) return []
	const { createMedia } = await import("$lib/server/media")
	const refs: MediaRef[] = []
	for (const item of items) {
		const bytes = Buffer.from(item.base64, "base64")
		if (!bytes.length) continue
		const ext = extensionForMime(item.mime) ?? "bin"
		const { file, original } = await createMedia(db, {
			userId: scope.userId ?? 0,
			bytes,
			filename: `${item.kind === "audio" ? "spoken-reply" : "generated"}.${ext}`,
			...(scope.sessionId != null
				? { sessionId: scope.sessionId }
				: { bucket: "generated" }),
			allowMedia: true,
			meta: {
				...(item.meta ?? {}),
				...(scope.runId != null ? { runId: scope.runId } : {}),
				...(scope.step ? { step: scope.step } : {})
			}
		})
		refs.push({
			uuid: file.uuid,
			kind: file.kind as MediaRef["kind"],
			mime: file.displayMime ?? original.mime,
			bytes: file.displayBytes ?? original.bytes,
			...(file.width != null ? { width: file.width } : {}),
			...(file.height != null ? { height: file.height } : {}),
			...(file.durationMs != null ? { duration: file.durationMs / 1000 } : {}),
			...(file.filename ? { filename: file.filename } : {})
		})
	}
	return refs
}
