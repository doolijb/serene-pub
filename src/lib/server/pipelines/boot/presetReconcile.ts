/**
 * Which preset bindings the instance can still honour (ruling 2026-09-10).
 *
 * A session whose preset binds an event to a pipeline that has gone runs the
 * genre's default instead — it never refuses the turn, and the run says so on
 * its own receipt. That is enough for the person taking the turn. It is not
 * enough for the administrator, who has no reason to open a receipt and whose
 * preset screen would otherwise keep showing a binding the instance cannot
 * honour, indefinitely and in perfect silence.
 *
 * So this walks every enabled preset at boot and records one row per stale
 * slot. Boot is the right moment because it is the moment the condition is
 * *created*: an upgrade republishing a spec elsewhere, a plugin uninstalled,
 * an import that never brought its pipelines. Nothing else in the product
 * changes the answer without an admin already looking at the screen.
 *
 * ## The same predicate as the run, by construction
 *
 * `presetBindingVerdict` is the single reader (see `presetBindings.ts`). This
 * module contributes no judgement of its own — it supplies preset rows and
 * writes rows down. A second copy of "does this binding resolve" is how the
 * admin screen comes to call healthy a slot the session is falling back on.
 *
 * ## Why it cannot fail the boot
 *
 * The same rule the entry projection states one file over: a reconcile that
 * describes configuration must never be the reason a local-first app will not
 * start. Errors are collected into the report and the boot carries on — a
 * missing notice is a screen that says less, a refused boot is a product that
 * does nothing.
 */

import { and, eq, isNull, notInArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { driverReasonOf } from "$lib/server/db/errors"
import { presetBindingVerdict } from "$lib/server/pipelines/entities/presetBindings"

export interface PresetReconcileReport {
	/** Presets examined — enabled ones only; see `reconcilePresetBindings`. */
	presets: number
	/** Slots found stale on this pass, whether or not the row is new. */
	stale: number
	/** Notices removed because their binding resolves again. */
	cleared: number
	/** What went wrong, per preset, without stopping the walk. */
	errors: string[]
}

/**
 * Record a notice per stale binding, and take away the ones that resolve.
 *
 * Idempotent: the same stale slot on the next boot updates `last_seen_at` and
 * leaves `first_seen_at` alone, so "since when" survives a restart. A binding
 * that resolves again has its row deleted rather than marked — a stale binding
 * is a *condition*, not news, and a condition that can be dismissed is one an
 * administrator can hide from themselves while sessions keep substituting.
 */
export async function reconcilePresetBindings(
	db: Db
): Promise<PresetReconcileReport> {
	const report: PresetReconcileReport = {
		presets: 0,
		stale: 0,
		cleared: 0,
		errors: []
	}

	/**
	 * Enabled presets only, and not the withdrawn ones.
	 *
	 * A disabled preset is one nobody can start a session from, so a notice
	 * about it is a task an administrator cannot act on usefully — and the
	 * screens would fill with rows about presets that were switched off
	 * precisely because they were not wanted. Sessions already running on a
	 * disabled preset still fall back and still say so, on their own receipt
	 * and in their own banner; that path reads the verdict directly and does
	 * not consult this table.
	 *
	 * ⚠ `withdrawn_at` is the same argument for a different reason, and it is
	 * not covered by `enabled`. A plugin's preset keeps the administrator's
	 * `enabled` decision while its plugin is switched off, so an enabled,
	 * withdrawn preset is the *normal* state of a disabled extension — and every
	 * one of its bindings names a spec this instance does not publish. Walking
	 * those files a notice per slot for every extension anybody has turned off,
	 * describing a condition whose cause is an absent plugin rather than a stale
	 * binding, and whose fix is not a rebind.
	 */
	const presets = (await db
		.select()
		.from(schema.sessionPresets)
		.where(
			and(
				eq(schema.sessionPresets.enabled, true),
				isNull(schema.sessionPresets.withdrawnAt)
			)
		)) as Array<typeof schema.sessionPresets.$inferSelect>

	for (const preset of presets) {
		report.presets++
		try {
			const bindings = (preset.bindings ?? {}) as Record<
				string,
				{ spec?: string }
			>
			const staleEvents: string[] = []
			for (const event of Object.keys(bindings)) {
				if (!bindings[event]?.spec) continue
				const verdict = await presetBindingVerdict(
					db,
					preset,
					preset.genreId,
					event
				)
				if (verdict.via !== "fallback") continue
				staleEvents.push(event)
				report.stale++
				await db
					.insert(schema.sessionPresetNotices)
					.values({
						presetId: preset.id,
						event,
						boundSpec: verdict.bound,
						reason: verdict.reason,
						fallbackSpec: verdict.spec
					})
					.onConflictDoUpdate({
						target: [
							schema.sessionPresetNotices.presetId,
							schema.sessionPresetNotices.event
						],
						// `first_seen_at` is deliberately absent: the whole
						// value of the column is that it does not move while
						// the condition persists.
						set: {
							boundSpec: verdict.bound,
							reason: verdict.reason,
							fallbackSpec: verdict.spec,
							lastSeenAt: new Date()
						}
					})
			}

			// Everything else this preset had a notice for now resolves — or
			// the slot was unbound, which is also not a stale binding.
			const gone = await db
				.delete(schema.sessionPresetNotices)
				.where(
					staleEvents.length
						? and(
								eq(
									schema.sessionPresetNotices.presetId,
									preset.id
								),
								notInArray(
									schema.sessionPresetNotices.event,
									staleEvents
								)
							)
						: eq(schema.sessionPresetNotices.presetId, preset.id)
				)
				.returning({ id: schema.sessionPresetNotices.id })
			report.cleared += (gone as unknown[]).length
		} catch (err) {
			// The driver's reason, not drizzle's `Failed query: …` and its
			// values (`driverReasonOf`).
			report.errors.push(
				`preset #${preset.id} '${preset.name}': ${driverReasonOf(err)}`
			)
		}
	}

	return report
}
