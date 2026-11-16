/**
 * 🚧 The `summaries-to-routine` pass (owner rulings 2026-11-12 and
 * 2026-11-13): where the *Summarize finished scenes* routine exists, the
 * routine's Full / Review / Off replaces the session's stored **Summaries**
 * value (`metadata.scenes.summary`: On close / On request / Never). A session
 * saved as Never gets the routine at Off; one saved as On close gets Review.
 *
 * **Owns:** writing the routine's mode on the session's own registration row
 * (through `patchSessionRow`, the owner of those rows) and clearing the stored
 * Summaries value, for a session that has the routine. It does **not** own the
 * routine, the scene context that stops reading the stored value, or the
 * registrations resolver that says whether a session has the routine.
 *
 * - **Which sessions.** Those whose effective registrations hold a routine
 *   whose pipeline is `core:spec/scene-summaries` (one set Off still counts). A
 *   session without it is never touched.
 * - **The mode.** Written only where the session's row for that routine has no
 *   mode yet: a mode the owner already chose is kept.
 * - **A second run is a no-op:** a converted session's stored value is cleared,
 *   so it is not selected again; a session without the routine keeps its value,
 *   is selected on every boot and is never written; an existing mode is never
 *   overwritten.
 * - **Not critical.** A session whose routines cannot be read is logged and
 *   left, and is not a failure: the pass may never have had anything to write
 *   there. A session whose own conversion throws is counted in `failed`, logged
 *   by id, and left; after the loop a non-zero `failed` throws one error naming
 *   the count (`failsHealth`).
 */
import { sql } from "drizzle-orm"
import { SCENE_SUMMARIES_SPEC_ID } from "@serene-pub/core-catalog"
import { rawRows } from "$lib/server/db/rawRows"
import {
	SCENE_SETTINGS_METADATA_KEY,
	storedSceneSettings
} from "$lib/shared/sessions/sceneSettings"

export interface SummariesToRoutineReport {
	/** Sessions whose stored Summaries value is Never or On close. */
	sessions: number
	converted: number
	/** Sessions whose conversion threw. */
	failed: number
}

/**
 * Convert one session: its routine's mode gets the stored Summaries value's
 * meaning and the stored value is cleared. Returns the mode written, or null
 * when the session has no such routine or holds no Never / On close.
 */
export async function convertSummariesSetting(
	db: Db,
	sessionId: number
): Promise<"off" | "review" | null> {
	const { sessionRoutineOf } = await import(
		"$lib/server/pipelines/routines/sessionRoutines"
	)
	const reg = await sessionRoutineOf(db, sessionId, SCENE_SUMMARIES_SPEC_ID)
	if (!reg) return null
	const [row] = rawRows<{ metadata: unknown }>(
		await db.execute(
			sql`select metadata from sessions where id = ${sessionId}`
		)
	)
	const stored = storedSceneSettings(row?.metadata)?.summary
	if (stored !== "never" && stored !== "onClose") return null
	const mode = stored === "never" ? "off" : "review"

	const { patchSessionRow } = await import("$lib/server/sessions/settingsForm")
	await db.transaction(async (tx) => {
		await patchSessionRow(
			tx as unknown as Db,
			sessionId,
			reg.key,
			(r) => (r.mode == null ? { mode } : {}),
			"upgrade"
		)
		// `updated_at` stays: a boot pass is not activity. The guard on the
		// stored value lets a concurrent write win.
		await tx.execute(sql`
			update sessions
			set metadata = (
				case
					when (metadata::jsonb -> ${SCENE_SETTINGS_METADATA_KEY}::text) - 'summary' = '{}'::jsonb
						then metadata::jsonb - ${SCENE_SETTINGS_METADATA_KEY}::text
					else jsonb_set(
						metadata::jsonb,
						${`{${SCENE_SETTINGS_METADATA_KEY}}`}::text[],
						(metadata::jsonb -> ${SCENE_SETTINGS_METADATA_KEY}::text) - 'summary'
					)
				end
			)::json
			where id = ${sessionId}
				and metadata::jsonb -> ${SCENE_SETTINGS_METADATA_KEY}::text ->> 'summary' = ${stored}
		`)
	})
	const { invalidateRegistrations } = await import(
		"$lib/server/pipelines/registrations/resolve"
	)
	invalidateRegistrations()
	return mode
}

export async function summariesToRoutine(
	db: Db
): Promise<SummariesToRoutineReport> {
	const report: SummariesToRoutineReport = {
		sessions: 0,
		converted: 0,
		failed: 0
	}
	const ids = rawRows<{ id: number }>(
		await db.execute(sql`
			select id from sessions
			where metadata::jsonb -> ${SCENE_SETTINGS_METADATA_KEY}::text ->> 'summary' in ('never', 'onClose')
			order by id
		`)
	).map((r) => Number(r.id))
	report.sessions = ids.length
	const { sessionRoutineOf } = await import(
		"$lib/server/pipelines/routines/sessionRoutines"
	)
	for (const id of ids) {
		try {
			if (!(await sessionRoutineOf(db, id, SCENE_SUMMARIES_SPEC_ID))) continue
		} catch (err) {
			console.warn(`[summaries-to-routine] session ${id}: its routines could not be read; left as it is:`, err)
			continue
		}
		try {
			if ((await convertSummariesSetting(db, id)) !== null) report.converted++
		} catch (err) {
			report.failed++
			console.error(`[summaries-to-routine] session ${id} failed and was left:`, err)
		}
	}
	if (report.failed > 0)
		throw new Error(
			`${report.failed} session(s) could not have their Summaries setting converted; see the log`
		)
	return report
}
