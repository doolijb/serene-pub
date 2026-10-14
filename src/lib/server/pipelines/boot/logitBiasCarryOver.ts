/**
 * ⏳ **Stored `logitBias` values become logit bias entries** (plan logit-bias
 * L2, lead decision L-c 2026-10-05).
 *
 * A sampling config's `logitBias` is a list of logit bias entries
 * (`LogitBiasEntry` `{ text, value }`), which the editor shows as rows. A
 * config saved through the JSON textarea holds a `{ "<id>": bias }` object, or
 * a JSON string of one; each key becomes an `[<id>]` row with its bias, in
 * key order, by the SDK's own reader (`readLogitBiasValue`) — the reader the
 * save path's `normalizeSamplingRow` coerces with, so a carried row is
 * byte-identical to one saved through the form.
 *
 * The rules:
 *
 * - Only `sampling_configs.values.logitBias` is touched. Every other key, and
 *   `enabled`, stays as stored: whether the field is switched on is the
 *   person's, and a `{}` becomes `[]`, never the shipped default list.
 * - A value the reader cannot read stays as it is, for the editor to report
 *   beside the field. The adapter sends nothing for it and says so on the
 *   receipt.
 * - Idempotent: a list of entries reads back as itself, so a second boot
 *   writes nothing.
 *
 * Runs before the catalog seed with the other carry-over passes, in one
 * transaction. Delete this module once a release has shipped it.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { readLogitBiasValue } from "$lib/shared/utils/logitBias"

/** Rewrites legacy values in place; returns how many configs it rewrote. */
export async function carryOverLogitBiasEntries(db: Db): Promise<number> {
	return await db.transaction(async (tx) => {
		const rows = await tx
			.select({
				id: schema.samplingConfigs.id,
				values: schema.samplingConfigs.values
			})
			.from(schema.samplingConfigs)
		let rewritten = 0
		for (const row of rows) {
			const values = row.values ?? {}
			if (!("logitBias" in values)) continue
			const stored = values.logitBias
			const entries = readLogitBiasValue(stored)
			if (!entries) continue
			if (JSON.stringify(entries) === JSON.stringify(stored)) continue
			await tx
				.update(schema.samplingConfigs)
				.set({ values: { ...values, logitBias: entries } })
				.where(eq(schema.samplingConfigs.id, row.id))
			rewritten++
		}
		if (rewritten)
			console.log(
				`[sampling] Carried ${rewritten} sampling config(s)' logit bias over to entries.`
			)
		return rewritten
	})
}
