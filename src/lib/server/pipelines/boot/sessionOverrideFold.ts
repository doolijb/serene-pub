/**
 * ⏳ 🚧 **A session's step values have one store: `registrations.values`**
 * (owner ruling, 2026-11-15; P2 — two writers of one thing is a bug).
 *
 * Session-scope rows of `pipeline_node_overrides` — the older home of a
 * session's tuning, and where the 0.5.3 attic wrote its picks — are folded
 * into the session's own registration values, once per boot.
 *
 * The rule, per session-scope row, against what the run reads
 * (`config/world.ts`: the session's registration layer first, then these
 * rows; the first push at an address wins):
 *
 *  - a row at a connection slot is never read: it is deleted;
 *  - a row whose session is gone, or whose pipeline the session's effective
 *    registrations do not run (or that has no active version), has no layer
 *    to move to: it stays, counted — no layer is invented;
 *  - every registration key the session has for that pipeline is a target (a
 *    run reads its own key, else the first). A key whose session layer already
 *    holds a value the run would use at the address (`readStoredValue` in
 *    `registrations/values.ts`, the one rule) needs nothing; the others need
 *    the row's value;
 *  - no key needs it: the run never read the row; it is deleted;
 *  - a value registration values cannot hold without changing what the run
 *    reads stays, counted as unmappable: `null`, an address the pipeline does
 *    not declare *at that address* (a variables-slot key counts), or a value whose
 *    write onto any needing key's session layer would change another address
 *    of it (`addsOnlyAt`) — and a prompt whose fields a key's own prompt does
 *    not all have (the run reads those fields from it);
 *  - otherwise the value is written onto each needing key's session row with
 *    the settings form's own writer (`patchSessionRow`, origin `upgrade`), and
 *    the row is deleted.
 *
 * Runs once a boot, right after the registrations are projected and refitted
 * (they decide what is in force). Idempotent: rows that stay are judged and
 * left again; a second boot changes nothing. One transaction per session.
 *
 * ⏳ Delete this module once the session scope of `pipeline_node_overrides`
 * is retired.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** What one boot's fold did, as counts of `pipeline_node_overrides` rows. */
export interface SessionOverrideFoldReport {
	/** Written into the session's registration values, then deleted. */
	moved: number
	/** Deleted: every key already held a usable value there, so the run never read the row. */
	shadowed: number
	/** Deleted: a connection slot, which a session row never answers. */
	connections: number
	/** Left: its session is gone. */
	leftNoSession: number
	/** Left: the session's effective registrations do not run its pipeline. */
	leftNoRegistration: number
	/** Left: registration values cannot hold the value without changing what the run reads. */
	leftUnmappable: number
}

const SEP = "\u0000"

export async function foldSessionOverrides(
	db: Db
): Promise<SessionOverrideFoldReport> {
	const report: SessionOverrideFoldReport = {
		moved: 0,
		shadowed: 0,
		connections: 0,
		leftNoSession: 0,
		leftNoRegistration: 0,
		leftUnmappable: 0
	}
	const rows = await db
		.select()
		.from(schema.pipelineNodeOverrides)
		.where(eq(schema.pipelineNodeOverrides.scopeKind, "session"))
	if (!rows.length) return report

	const [
		{ declarationsAndVariableKeys },
		{ referenceSlotsOf, readStoredValue, sessionLayerAt, addsOnlyAt, sessionRegistrationKeys }
	] = await Promise.all([
		import("$lib/server/pipelines/config/panel/declarations"),
		import("$lib/server/pipelines/registrations/values")
	])
	const { patchSessionRow, valuesWith } = await import(
		"$lib/server/sessions/settingsForm"
	)
	const { invalidateRegistrations } = await import(
		"$lib/server/pipelines/registrations/resolve"
	)

	const specs = new Map(
		(
			await db
				.select({
					id: schema.pipelineSpecs.id,
					slug: schema.pipelineSpecs.slug,
					activeVersionId: schema.pipelineSpecs.activeVersionId
				})
				.from(schema.pipelineSpecs)
		).map((s) => [s.id, s])
	)
	const sessionIds = new Set(
		(
			await db.select({ id: schema.sessions.id }).from(schema.sessions)
		).map((s) => s.id)
	)

	const bySession = new Map<number, typeof rows>()
	for (const r of rows)
		bySession.set(r.scopeId, [...(bySession.get(r.scopeId) ?? []), r])

	for (const [sessionId, sessionRows] of bySession) {
		let wrote = false
		await db.transaction(async (tx) => {
			const t = tx as unknown as Db
			const at = (r: { nodeKey: string; slot: string }) =>
				`${r.nodeKey}${SEP}${r.slot}`
			const remove = (id: number) =>
				tx
					.delete(schema.pipelineNodeOverrides)
					.where(eq(schema.pipelineNodeOverrides.id, id))

			for (const row of sessionRows.sort((a, b) => a.id - b.id)) {
				const spec = specs.get(row.specId)
				if (!spec) continue
				const { decls, variableKeys } = spec.activeVersionId
					? await declarationsAndVariableKeys(t, spec.activeVersionId)
					: { decls: [], variableKeys: [] }

				// A connection slot is never read at session scope.
				if (
					decls.some(
						(d) => d.matrixSlot === "connection" && at(d) === at(row)
					)
				) {
					await remove(row.id)
					report.connections++
					continue
				}
				if (!sessionIds.has(sessionId)) {
					report.leftNoSession++
					continue
				}
				const keys = spec.activeVersionId
					? await sessionRegistrationKeys(t, sessionId, spec.slug)
					: []
				if (!keys.length) {
					report.leftNoRegistration++
					continue
				}

				const kinds = referenceSlotsOf(decls, variableKeys)
				const address = {
					nodeKey: row.nodeKey,
					slot: row.slot,
					path: row.path ?? ""
				}
				const addressKey = `${address.nodeKey}${SEP}${address.slot}${SEP}${address.path}`

				// A prompt reaches the run one field at a time, the first push per
				// field winning: a registration prompt hides the row's prompt only
				// where it has every field the row's prompt has.
				const rowReading = !address.path
					? await readStoredValue(t, kinds, address, row.value)
					: undefined
				const rowFields =
					rowReading?.kind === "prompt" ? Object.keys(rowReading.fields) : []
				let partial = false

				const needing: {
					key: string
					values: Awaited<ReturnType<typeof sessionLayerAt>>["values"]
				}[] = []
				for (const key of keys) {
					const { values, reading } = await sessionLayerAt(t, {
						specId: spec.id,
						specSlug: spec.slug,
						sessionId,
						key,
						decls,
						kinds,
						at: address
					})
					if (!reading) needing.push({ key, values })
					else if (rowFields.length && reading.kind === "prompt") {
						const fields = Object.keys(reading.fields)
						if (!rowFields.every((f) => fields.includes(f))) partial = true
					}
				}
				// Moving or deleting the row would lose the fields it supplies.
				if (partial) {
					report.leftUnmappable++
					continue
				}
				if (!needing.length) {
					await remove(row.id)
					report.shadowed++
					continue
				}

				const declared =
					decls.some(
						(d) =>
							d.nodeKey === row.nodeKey &&
							d.slot === row.slot &&
							d.path === (row.path ?? "")
					) || kinds.layoutVariables.has(addressKey)
				if (
					row.value === null ||
					row.value === undefined ||
					!declared ||
					!needing.every((n) =>
						addsOnlyAt(
							n.values,
							valuesWith(n.values, address, row.value),
							decls,
							address,
							row.value
						)
					)
				) {
					report.leftUnmappable++
					continue
				}

				for (const { key } of needing)
					await patchSessionRow(
						t,
						sessionId,
						key,
						(r) => ({ values: valuesWith(r.values, address, row.value) as never }),
						"upgrade"
					)
				await remove(row.id)
				report.moved++
				wrote = true
			}
		})
		if (wrote) invalidateRegistrations()
	}

	const { moved, shadowed, connections } = report
	const left =
		report.leftNoSession + report.leftNoRegistration + report.leftUnmappable
	if (moved || shadowed || connections)
		console.log(
			`[pipelines] folded session settings into registration values: ${moved} moved, ` +
				`${shadowed} already set there (removed), ${connections} connection pick(s) never read (removed)`
		)
	if (left)
		console.warn(
			`[pipelines] ${left} session setting row(s) stay in pipeline_node_overrides ` +
				`(${report.leftNoSession} session gone, ${report.leftNoRegistration} pipeline not run by the session, ` +
				`${report.leftUnmappable} not storable as a registration value)`
		)
	return report
}
