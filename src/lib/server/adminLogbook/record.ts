/**
 * Writing the admin logbook — the half the socket wrapper calls.
 *
 * `logbookBegin` runs before a handler: it decides whether this dispatch is
 * recorded at all and, if so, snapshots the object as it was. `logbookCommit`
 * runs after the handler SUCCEEDED and writes the record. Neither ever throws:
 * the logbook is a witness, and a witness that fails must not fail the change
 * it watched — so every error is logged and swallowed.
 *
 * ⚠ Written right after the change rather than inside its transaction. The
 * handlers own their transactions and the wrapper cannot reach into them; the
 * cost is that a crash between the two loses the record, never the change.
 */
import * as schema from "$lib/server/db/schema"
import { lt, lte, sql } from "drizzle-orm"
import {
	LOGBOOK_OBJECT_TYPES,
	type LogbookChange
} from "$lib/shared/adminLogbook"
import {
	diffSnapshots,
	idFromResult,
	isRefusal,
	paramChanges,
	summarize
} from "./diff"
import {
	logbookSpecFor,
	resolveObjectType,
	type LogbookEventSpec,
	type ObjectSnapshot
} from "./events"

/** Records older than this are pruned. */
export const LOGBOOK_RETENTION_DAYS = 90
/** And never more than this many are kept. */
export const LOGBOOK_MAX_RECORDS = 20_000
/** Prune once per this many writes (and on the first write after boot). */
const PRUNE_EVERY = 100

export interface LogbookPending {
	event: string
	spec: LogbookEventSpec
	params: any
	actorUserId: number | null
	actorName: string
	objectId: string | null
	before: ObjectSnapshot | null
}

interface Actor {
	id?: number | null
	isAdmin?: boolean
	username?: string | null
	displayName?: string | null
}

async function defaultDb(): Promise<Db> {
	return (await import("$lib/server/db")).db as unknown as Db
}

const asId = (v: unknown): string | null =>
	v == null || v === "" ? null : String(v)

/** Whether this dispatch is one the logbook records. Synchronous and cheap. */
export function logbookWants(
	actor: Actor | null | undefined,
	event: string,
	params: any
): boolean {
	try {
		const spec = logbookSpecFor(event)
		if (!spec || !actor?.isAdmin) return false
		return !spec.when || spec.when(params)
	} catch {
		return false
	}
}

/**
 * Before the handler. Null when this dispatch is not one the logbook records:
 * an unlisted event, a non-admin actor, or a spec whose `when` says no.
 */
export async function logbookBegin(
	actor: Actor | null | undefined,
	event: string,
	params: any,
	dbIn?: Db
): Promise<LogbookPending | null> {
	try {
		if (!actor || !logbookWants(actor, event, params)) return null
		const spec = logbookSpecFor(event)!
		const objectId = asId(spec.id?.(params))
		let before: ObjectSnapshot | null = null
		if (spec.snapshot && spec.action !== "add") {
			const db = dbIn ?? (await defaultDb())
			before = await spec.snapshot(db, objectId, params)
		}
		return {
			event,
			spec,
			params,
			actorUserId: actor.id ?? null,
			actorName: actor.displayName || actor.username || `user #${actor.id}`,
			objectId,
			before
		}
	} catch (err) {
		console.error(`[adminLogbook] could not prepare a record for ${event}:`, err)
		return null
	}
}

let writesSinceBoot = 0

/**
 * After the handler. `result` is its return value, or the payload it emitted
 * on its own event when it returned nothing. A refusal (`{ error }`) writes
 * nothing. Resolves to the record written, or null.
 */
export async function logbookCommit(
	pending: LogbookPending,
	result: unknown,
	dbIn?: Db
): Promise<typeof schema.adminLogbook.$inferSelect | null> {
	try {
		if (isRefusal(result)) return null
		const db = dbIn ?? (await defaultDb())
		const { spec, params } = pending

		let objectId = pending.objectId
		if (!objectId && spec.idFromResult)
			objectId = idFromResult(
				result,
				spec.idFromResult === true ? undefined : spec.idFromResult
			)

		let after: ObjectSnapshot | null = null
		if (spec.snapshot && spec.action !== "delete")
			after = await spec.snapshot(db, objectId, params)
		// An add found by name, not by id: the snapshot is the new row.
		if (!objectId && after && spec.action === "add") {
			const fid = (after.fields as any)?.id
			if (fid != null) objectId = String(fid)
		}

		const objectType = resolveObjectType(spec, params)
		const objectLabel =
			after?.label ||
			pending.before?.label ||
			(spec.label?.(params) ?? "") ||
			objectId ||
			""

		let changes: LogbookChange[] = []
		if (spec.action === "change" && spec.snapshot)
			changes = diffSnapshots(pending.before?.fields, after?.fields)
		if (spec.fields?.length)
			changes = [...changes, ...paramChanges(params, spec.fields)]

		const summary = summarize({
			action: spec.action,
			objectTypeLabel: LOGBOOK_OBJECT_TYPES[objectType].label,
			objectLabel,
			changes,
			verb: spec.verb?.(params, objectLabel) ?? null
		})

		const [row] = await (db as any)
			.insert(schema.adminLogbook)
			.values({
				actorUserId: pending.actorUserId,
				actorName: pending.actorName,
				event: pending.event,
				objectType,
				objectId,
				objectLabel,
				action: spec.action,
				summary,
				changes
			})
			.returning()

		if (writesSinceBoot++ % PRUNE_EVERY === 0) await pruneLogbook(db)
		return row ?? null
	} catch (err) {
		console.error(
			`[adminLogbook] could not record ${pending.event}:`,
			err
		)
		return null
	}
}

/**
 * Drop what is past retention: older than `LOGBOOK_RETENTION_DAYS`, or beyond
 * the newest `LOGBOOK_MAX_RECORDS`. Two statements, both on indexed columns.
 */
export async function pruneLogbook(
	db: Db,
	now: Date = new Date(),
	opts: { days?: number; max?: number } = {}
): Promise<void> {
	const days = opts.days ?? LOGBOOK_RETENTION_DAYS
	const max = opts.max ?? LOGBOOK_MAX_RECORDS
	const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
	await (db as any)
		.delete(schema.adminLogbook)
		.where(lt(schema.adminLogbook.createdAt, cutoff))
	const [edge] = await (db as any)
		.select({ id: schema.adminLogbook.id })
		.from(schema.adminLogbook)
		.orderBy(sql`${schema.adminLogbook.id} desc`)
		.offset(max)
		.limit(1)
	if (edge)
		await (db as any)
			.delete(schema.adminLogbook)
			.where(lte(schema.adminLogbook.id, edge.id))
}
