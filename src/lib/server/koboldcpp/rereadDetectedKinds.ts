/**
 * One more look at the GGUFs a scan already called text — once per process.
 *
 * A listing re-reads a `local_models` row only while its kind is a guess
 * ("assumed"), a claim ("declared"), "unknown", or its bytes changed. A row the
 * header already DECIDED ("detected") is never read again, which was right
 * while the classifier could only answer text or image. It can now answer
 * `embeddings` (the header's `<arch>.pooling_type`, `modelKind.ts`), and a bge,
 * nomic or Qwen3-Embedding GGUF measured before that is a "detected" `text`
 * row: listed for chat on the managed endpoint, with nothing in its embedding
 * models to choose.
 *
 * So each `detected` text row is read once more, with the classifier this
 * build has:
 *
 *   - **Only `detected`.** A person's answer ("user") is never second-guessed,
 *     and the lower-trust sources are re-read by every listing already.
 *   - **Only to move a row to `embeddings`.** A read that now says anything
 *     else — "unknown" for a file mid-copy, say — is no evidence against a
 *     kind that was decided, and the row stays as it was. The write is
 *     conditional on the row still being `detected` text, so a person's
 *     override landing in between is not overwritten either.
 *   - **Once per process, per file.** The memo below. A second read changes
 *     nothing, so the guard is about not paying a header read per file on
 *     every listing, never about correctness — which is why it is not
 *     persisted: there is no column to keep a classifier version in, and one
 *     boot's worth of 64 KiB reads is cheap.
 *
 * Takes the database handle and imports nothing that opens one, so a boot step
 * can call it as safely as a listing.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { modalityForKind } from "$lib/server/localModels/registry"
import { classifyModelFile } from "./modelKind"
import {
	modelsDirFor,
	resolveModelPath,
	type ModelsDirSettings
} from "./modelsDir"

/** Files this process has already re-read. Claimed BEFORE the read, so two
 * listings running at once (a sync and the manager's own) read a file once. */
const reread = new Set<string>()

/**
 * Re-read every `detected` text row this process has not, and move the ones
 * whose header now says `embeddings`. Returns the filenames it moved, so a
 * caller can re-sync the endpoint rows whose `modality` follows the kind.
 *
 * With no models directory configured (the legacy shape, where koboldcpp
 * resolves bare filenames itself) there is no file to read, and nothing moves.
 */
export async function rereadDetectedTextModels(
	db: Db,
	settings: ModelsDirSettings
): Promise<string[]> {
	if (!modelsDirFor("text", settings)) return []
	const rows = await db
		.select({ filename: schema.localModels.filename })
		.from(schema.localModels)
		.where(
			and(
				eq(schema.localModels.kind, "text"),
				eq(schema.localModels.kindSource, "detected"),
				eq(schema.localModels.status, "complete")
			)
		)

	const moved: string[] = []
	for (const { filename } of rows) {
		if (reread.has(filename)) continue
		reread.add(filename)
		let filePath: string
		try {
			filePath = await resolveModelPath("text", filename, settings, {
				mustExist: true
			})
		} catch {
			// Gone, or not where any directory says. The listing's own sweep
			// is what forgets a missing file; this only reads ones that exist.
			continue
		}
		const verdict = await classifyModelFile(filePath)
		if (verdict.kind !== "embeddings") continue
		const updated = await db
			.update(schema.localModels)
			.set({
				kind: "embeddings",
				modality: modalityForKind("embeddings")
			})
			.where(
				and(
					eq(schema.localModels.filename, filename),
					eq(schema.localModels.kind, "text"),
					eq(schema.localModels.kindSource, "detected")
				)
			)
			.returning({ filename: schema.localModels.filename })
		if (updated.length) moved.push(filename)
	}
	if (moved.length)
		console.log(
			`[KoboldCPP] re-read ${moved.length} model file(s) once called text: now embedding models (${moved.join(", ")})`
		)
	return moved
}

/** Forget what this process has re-read — for tests, which reuse one module. */
export function forgetRereadDetectedTextModels(): void {
	reread.clear()
}
