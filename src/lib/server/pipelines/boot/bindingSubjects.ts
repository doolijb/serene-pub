/**
 * ⏳ One release: rewrite the bindings a previous release keyed by **function**
 * to the **subject** plans/31 V2 keys them by (ruled 2026-09-17).
 *
 * Until V2 a `pipeline_function_bindings` row named a function key
 * (`narrate`, `respond`) — several actions and several specs could share
 * one, and the row selected among them. A `pipeline_bindings` row names a
 * subject: an action's identity `<spec slug>#<key>` or a core event id. So
 * a bare key left on a row means one of two things, decided here by the
 * same rule migration 0137 and `presetIncludes` use for a preset's bare
 * included keys (`soleDeclarer`: exactly one declarer, of any origin):
 *
 *  · `respond` was the primary turn, which has always been the event
 *    `core:event/message-respond@1` in every other table — the row is
 *    rewritten to that;
 *  · any other bare key becomes the identity of the ONE action declaring it
 *    for the row's genre. A key no action declares, or that several
 *    declare, names nothing a binding can be about any more, and the row
 *    is **dropped** with a notice: a choice among alternatives that are
 *    now two different things cannot be carried as either of them.
 *
 * Rewriting at boot rather than in SQL because the declarer is read through
 * `listGenreActions` — the one reader of a spec's contributed actions,
 * which folds the pre-U5c `triggers` spelling — and the migration cannot
 * call it. Pure over what it reads; idempotent, since a row already carrying
 * a `#` or an event id is left alone; and a no-op from the second boot on.
 * Remove with the release after, together with the table's rename.
 */
import { eq, sql } from "drizzle-orm"
import { isEventId, sessionEvents } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { actionIdentity, parseActionIdentity } from "$lib/shared/actions/identity"

export interface BindingSubjectReport {
	/** Rows rewritten from a bare key to a subject: `(scope, genre) key → subject`. */
	rewritten: string[]
	/** Rows dropped because their bare key names no single action any more, with the reason. */
	dropped: string[]
}

export async function reprojectBindingSubjects(db: Db): Promise<BindingSubjectReport> {
	const report: BindingSubjectReport = { rewritten: [], dropped: [] }
	const rows = await db
		.select({
			id: schema.pipelineBindings.id,
			scopeKind: schema.pipelineBindings.scopeKind,
			scopeId: schema.pipelineBindings.scopeId,
			genreId: schema.pipelineBindings.genreId,
			subject: schema.pipelineBindings.subject
		})
		.from(schema.pipelineBindings)
		// A bare key carries no `#` and no `:` — an identity has the first, an
		// event id both.
		.where(sql`${schema.pipelineBindings.subject} NOT LIKE '%#%'`)
	const bare = rows.filter((r) => !isEventId(r.subject) && !parseActionIdentity(r.subject))
	if (!bare.length) return report

	const { listGenreActions, soleDeclarer } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const offeredByGenre = new Map<string, Awaited<ReturnType<typeof listGenreActions>>>()
	for (const row of bare) {
		const at = `(${row.scopeKind}${row.scopeKind === "session" ? ` ${row.scopeId}` : ""}, ${row.genreId})`
		let subject: string | null = null
		if (row.subject === "respond") subject = sessionEvents.messageRespond
		else {
			let offered = offeredByGenre.get(row.genreId)
			if (!offered) {
				offered = await listGenreActions(db, row.genreId)
				offeredByGenre.set(row.genreId, offered)
			}
			const sole = soleDeclarer(offered, row.subject)
			if (sole) subject = actionIdentity(sole)
			else {
				const several = offered.filter((a) => a.key === row.subject)
				report.dropped.push(
					`${at} '${row.subject}' — ` +
						(several.length
							? `${several.length} actions declare it (${several.map(actionIdentity).join(", ")}); a binding is about one`
							: "no published action declares it")
				)
				await db.delete(schema.pipelineBindings).where(eq(schema.pipelineBindings.id, row.id))
				continue
			}
		}
		// The unique index is on (scope, genre, subject): a row already there
		// under the subject is the newer choice and wins; this one goes.
		const [taken] = await db
			.select({ id: schema.pipelineBindings.id })
			.from(schema.pipelineBindings)
			.where(
				sql`${schema.pipelineBindings.scopeKind} = ${row.scopeKind} AND ${schema.pipelineBindings.scopeId} = ${row.scopeId} AND ${schema.pipelineBindings.genreId} = ${row.genreId} AND ${schema.pipelineBindings.subject} = ${subject}`
			)
			.limit(1)
		if (taken) {
			report.dropped.push(`${at} '${row.subject}' — a binding on '${subject}' already exists`)
			await db.delete(schema.pipelineBindings).where(eq(schema.pipelineBindings.id, row.id))
			continue
		}
		await db
			.update(schema.pipelineBindings)
			.set({ subject })
			.where(eq(schema.pipelineBindings.id, row.id))
		report.rewritten.push(`${at} '${row.subject}' → '${subject}'`)
	}
	return report
}
