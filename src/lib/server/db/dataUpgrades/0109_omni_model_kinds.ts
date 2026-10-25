/**
 * 0109 — **A model's reads and writes as sets** (O3, PROPOSAL-layering §13).
 * Shape is drizzle's (`connection_models.reads` / `writes`, `files.transcript`);
 * this carries what each generating model was FOR into what it WRITES:
 *
 *  · `text-gen`  → writes `["text"]`  (Writes replies)
 *  · `image-gen` → writes `["image"]` (Draws pictures)
 *  · `tts`       → writes `["audio"]` (Speaks)
 *
 * `reads` stays NULL — "not stated": the single modality never said what a
 * model reads, and the endpoint's capability layers (the Vision switch) went
 * on judging that. Writing `["text"]` here would refuse vision on every
 * upgraded model that reads pictures today. Embedding and NER models keep
 * their single `modality` (one active per modality) and both columns NULL.
 * A row whose modality was NULL ("the host said nothing") stays ungated.
 *
 * Runs inside the anchor migration's transaction; idempotent — a row whose
 * `writes` is already stated is left alone.
 */
import { sql } from "drizzle-orm"
import type { DataUpgradeContext } from "./index"

/** What each generating modality writes. The vocabulary of `modelKinds.ts`, frozen at 0109. */
const WRITES_OF_MODALITY: Readonly<Record<string, string>> = {
	"text-gen": "text",
	"image-gen": "image",
	tts: "audio"
}

export async function run(tx: MigrationTx, _ctx: DataUpgradeContext): Promise<void> {
	for (const [modality, kind] of Object.entries(WRITES_OF_MODALITY))
		await tx.execute(
			sql.raw(
				`UPDATE connection_models SET writes = '["${kind}"]'::json
				 WHERE modality = '${modality}' AND writes IS NULL`
			)
		)
}
