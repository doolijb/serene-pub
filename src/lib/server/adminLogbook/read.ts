/**
 * Reading the admin logbook — the query behind Admin → History.
 *
 * Newest first, filtered on the server (one record, object, actor, action,
 * date range, text) and paged by cursor: `before` is the last id the client holds, so a
 * record written while someone is paging never shifts the page under them.
 */
import * as schema from "$lib/server/db/schema"
import { and, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm"
import {
	LOGBOOK_ACTIONS,
	type LogbookAction,
	type LogbookRecordView
} from "$lib/shared/adminLogbook"

export const LOGBOOK_PAGE_MAX = 200

export interface LogbookQuery {
	/** One record by its id (History's change view); the other filters still apply. */
	recordId?: number | null
	objectType?: string | null
	/** With `objectType`: one object's history. `""` is a singleton's (no id). */
	objectId?: string | null
	actorUserId?: number | null
	action?: LogbookAction | null
	/** ISO 8601, inclusive. */
	since?: string | null
	/** ISO 8601, exclusive. */
	until?: string | null
	/** Matched against summary, object label, actor and event. */
	text?: string | null
	/** Cursor: only records with a smaller id. */
	before?: number | null
	limit?: number | null
}

function validDate(s: string | null | undefined): Date | null {
	if (!s) return null
	const d = new Date(s)
	return Number.isNaN(d.getTime()) ? null : d
}

/** `%` and `_` are ILIKE wildcards; a search for "50%" means the characters. */
function likeLiteral(s: string): string {
	return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export function toView(
	row: typeof schema.adminLogbook.$inferSelect
): LogbookRecordView {
	return {
		id: row.id,
		at: new Date(row.createdAt).toISOString(),
		actorUserId: row.actorUserId ?? null,
		actorName: row.actorName,
		event: row.event,
		objectType: row.objectType,
		objectId: row.objectId ?? null,
		objectLabel: row.objectLabel,
		action: row.action,
		summary: row.summary,
		changes: Array.isArray(row.changes) ? row.changes : []
	}
}

export async function listLogbook(
	db: Db,
	q: LogbookQuery = {}
): Promise<{
	records: LogbookRecordView[]
	hasMore: boolean
	actors: Array<{ id: number | null; name: string }>
}> {
	const t = schema.adminLogbook
	const where: SQL[] = []
	if (q.recordId != null && Number.isInteger(q.recordId))
		where.push(eq(t.id, q.recordId))
	if (q.objectType) {
		where.push(eq(t.objectType, q.objectType))
		if (q.objectId === "") where.push(isNull(t.objectId))
		else if (q.objectId != null) where.push(eq(t.objectId, String(q.objectId)))
	}
	if (q.actorUserId != null) where.push(eq(t.actorUserId, q.actorUserId))
	if (q.action && LOGBOOK_ACTIONS.includes(q.action))
		where.push(eq(t.action, q.action))
	const since = validDate(q.since)
	if (since) where.push(gte(t.createdAt, since))
	const until = validDate(q.until)
	if (until) where.push(lt(t.createdAt, until))
	const text = q.text?.trim()
	if (text) {
		const like = likeLiteral(text.slice(0, 200))
		where.push(
			or(
				ilike(t.summary, like),
				ilike(t.objectLabel, like),
				ilike(t.actorName, like),
				ilike(t.event, like)
			)!
		)
	}
	if (q.before != null && Number.isInteger(q.before))
		where.push(lt(t.id, q.before))

	const limit = Math.min(
		Math.max(1, Math.floor(q.limit ?? 50)),
		LOGBOOK_PAGE_MAX
	)
	const rows = await (db as any)
		.select()
		.from(t)
		.where(where.length ? and(...where) : undefined)
		.orderBy(desc(t.id))
		.limit(limit + 1)

	// Who has changed anything at all — the actor filter's options. The
	// newest name per id, so a renamed admin appears once.
	const actorRows = await (db as any)
		.select({
			id: t.actorUserId,
			name: sql<string>`(array_agg(${t.actorName} order by ${t.id} desc))[1]`
		})
		.from(t)
		.groupBy(t.actorUserId)

	return {
		records: rows.slice(0, limit).map(toView),
		hasMore: rows.length > limit,
		actors: actorRows.map((r: any) => ({
			id: r.id ?? null,
			name: String(r.name ?? "")
		}))
	}
}
