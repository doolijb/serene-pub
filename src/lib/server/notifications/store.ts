/**
 * Raising, reading and clearing notifications (vocabulary and kinds:
 * `shared/notifications/kinds.ts`).
 *
 * Producers call `raiseNotification` / `clearNotifications` at the server's
 * DECISION POINTS — where a turn order settles, where a form is written, where
 * a reply fails — never from socket events, which are interest-gated and
 * dropped when nobody watches.
 *
 * ## Never throws
 *
 * The admin logbook's witness rule: a notification is a report about a
 * decision, and a report that fails must never fail the decision it watched.
 * Every public write logs and swallows. Reads used by socket handlers throw
 * normally, as handlers expect.
 *
 * ## Scoped by user, always
 *
 * Ids from a client are guessable integers, so every client-driven write is
 * `WHERE user_id = <asker> AND id IN (…)`.
 */
import { db as appDb } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, desc, eq, inArray, isNotNull, isNull, like, lt, sql } from "drizzle-orm"
import {
	notificationKind,
	notificationKinds,
	type NotificationClearedHow,
	type NotificationRow,
	type NotificationVars
} from "$lib/shared/notifications/kinds"
import type { NotificationsListResponse } from "$lib/shared/sockets/notifications"
import { pushToUser } from "$lib/server/sockets/utils/userPush"
import { userIsViewing } from "./viewing"

/** Cleared rows older than this are pruned. */
export const NOTIFICATION_RETENTION_DAYS = 30
/** And no user keeps more than this many cleared rows. */
export const NOTIFICATION_MAX_CLEARED_PER_USER = 200
/** How many cleared rows `list` returns. */
const LIST_CLEARED_LIMIT = 50
/** Most ids one read/dismiss may name. */
export const NOTIFICATION_IDS_CAP = 200
/** Prune once per this many raises (and on the first raise after boot). */
const PRUNE_EVERY = 100

const T = schema.notifications
let raisesSinceBoot = 0

function dbOf(db?: Db): Db {
	return (db ?? appDb) as unknown as Db
}

type RowRecord = typeof schema.notifications.$inferSelect

function toRow(r: RowRecord): NotificationRow {
	return {
		id: r.id,
		kind: r.kind,
		regarding: r.regarding,
		level: r.level,
		href: r.href,
		vars: r.vars ?? {},
		raisedAt: r.raisedAt.toISOString(),
		lastRaisedAt: r.lastRaisedAt.toISOString(),
		readAt: r.readAt ? r.readAt.toISOString() : null,
		clearedAt: r.clearedAt ? r.clearedAt.toISOString() : null,
		clearedHow: r.clearedHow ?? null
	}
}

export interface RaiseInput {
	userIds: number[]
	/** A registered notification kind id. */
	kind: string
	regarding: string
	href: string
	vars?: NotificationVars
}

/**
 * Raise a notification for each user. An OPEN row with the same `regarding`
 * is bumped rather than duplicated — `last_raised_at` moves and `read_at`
 * resets, so a re-raise lights the row again.
 *
 * **Context aware** (plan §4): each user is asked whether a tab of theirs has
 * `href` on screen right now (`userIsViewing`, from the snapshots the tabs
 * report). If one does:
 *
 * - a kind that clears on view (`view`, `either`) is **not shipped** — they
 *   are looking at it. An open row they already had for this `regarding` is
 *   cleared `viewed` instead of bumped;
 * - a kind that clears only on `resolve` (your move, activity ready) is still
 *   inserted or bumped — it must stay until the thing is done — but already
 *   read, so it sits in the list without lighting the dot.
 *
 * If the viewing check fails, the user is treated as not viewing: shipping is
 * the safe way to be wrong.
 */
export async function raiseNotification(
	input: RaiseInput,
	db?: Db
): Promise<void> {
	try {
		const decl = notificationKind(input.kind)
		if (!decl) {
			console.error(`[notifications] unknown kind ${input.kind}`)
			return
		}
		const userIds = [...new Set(input.userIds)].filter(
			(id) => Number.isInteger(id) && id > 0
		)
		if (!userIds.length) return
		const now = new Date()
		const vars = input.vars ?? {}
		const d = dbOf(db) as any

		const lit: number[] = []
		const seen: number[] = []
		const suppressed: number[] = []
		for (const userId of userIds) {
			if (!viewingSafely(userId, input.href)) lit.push(userId)
			else if (decl.clearsOn === "resolve") seen.push(userId)
			else suppressed.push(userId)
		}

		const upsert = async (ids: number[], readAt: Date | null) => {
			if (!ids.length) return
			await d
				.insert(T)
				.values(
					ids.map((userId) => ({
						userId,
						kind: input.kind,
						regarding: input.regarding,
						level: decl.level,
						href: input.href,
						vars,
						raisedAt: now,
						lastRaisedAt: now,
						readAt
					}))
				)
				.onConflictDoUpdate({
					target: [T.userId, T.regarding],
					targetWhere: sql`"cleared_at" IS NULL`,
					set: {
						kind: input.kind,
						level: decl.level,
						href: input.href,
						vars,
						lastRaisedAt: now,
						readAt
					}
				})
		}
		await upsert(lit, null)
		await upsert(seen, now)

		let clearedFor: number[] = []
		if (suppressed.length) {
			const cleared: { userId: number }[] = await d
				.update(T)
				.set({
					clearedAt: now,
					clearedHow: "viewed",
					readAt: sql`COALESCE(${T.readAt}, ${now})`
				})
				.where(
					and(
						inArray(T.userId, suppressed),
						eq(T.regarding, input.regarding),
						isNull(T.clearedAt)
					)
				)
				.returning({ userId: T.userId })
			clearedFor = cleared.map((r) => r.userId)
		}

		for (const userId of new Set([...lit, ...seen, ...clearedFor]))
			pushChanged(userId, db)
		if (raisesSinceBoot++ % PRUNE_EVERY === 0)
			await pruneNotifications(dbOf(db))
	} catch (err) {
		console.error(`[notifications] could not raise ${input.kind}:`, err)
	}
}

function viewingSafely(userId: number, href: string): boolean {
	try {
		return userIsViewing(userId, href)
	} catch (err) {
		console.warn(`[notifications] viewing check failed for ${href}:`, err)
		return false
	}
}

export interface ClearTarget {
	/** Exact key, or a prefix ending in `/` or `:` with `prefix: true`. */
	regarding: string
	prefix?: boolean
	/** Only this user's row; absent = every user's. */
	userId?: number
	/** Leave these users' rows open (the person still due, say). */
	exceptUserIds?: number[]
}

/**
 * Clear the open rows matching `target`. Returns how many were cleared. Every
 * affected user is pushed the fresh list.
 */
export async function clearNotifications(
	target: ClearTarget,
	how: NotificationClearedHow,
	db?: Db
): Promise<number> {
	try {
		const conds = [
			isNull(T.clearedAt),
			target.prefix
				? like(T.regarding, `${escapeLike(target.regarding)}%`)
				: eq(T.regarding, target.regarding)
		]
		if (target.userId !== undefined) conds.push(eq(T.userId, target.userId))
		if (target.exceptUserIds?.length)
			conds.push(
				sql`${T.userId} NOT IN (${sql.join(
					target.exceptUserIds.map((id) => sql`${id}`),
					sql`, `
				)})`
			)
		const cleared: { userId: number }[] = await (dbOf(db) as any)
			.update(T)
			.set({ clearedAt: new Date(), clearedHow: how })
			.where(and(...conds))
			.returning({ userId: T.userId })
		for (const userId of new Set(cleared.map((r) => r.userId)))
			pushChanged(userId, db)
		return cleared.length
	} catch (err) {
		console.error(
			`[notifications] could not clear ${target.regarding}:`,
			err
		)
		return 0
	}
}

function escapeLike(s: string): string {
	return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** The open rows matching `regarding` — for a producer deciding whether to clear. */
export async function openNotifications(
	regarding: string,
	db?: Db
): Promise<NotificationRow[]> {
	const rows: RowRecord[] = await (dbOf(db) as any)
		.select()
		.from(T)
		.where(and(eq(T.regarding, regarding), isNull(T.clearedAt)))
	return rows.map(toRow)
}

/**
 * The open rows whose `regarding` starts with `prefix` — every open-form row
 * of one session, say, for a producer re-checking them after a line lands.
 */
export async function openNotificationsWithPrefix(
	prefix: string,
	db?: Db
): Promise<NotificationRow[]> {
	const rows: RowRecord[] = await (dbOf(db) as any)
		.select()
		.from(T)
		.where(
			and(like(T.regarding, `${escapeLike(prefix)}%`), isNull(T.clearedAt))
		)
	return rows.map(toRow)
}

/** Every open row of a kind — for the boot sweep's re-checks. */
export async function openNotificationsOfKind(
	kind: string,
	db?: Db
): Promise<NotificationRow[]> {
	const rows: RowRecord[] = await (dbOf(db) as any)
		.select()
		.from(T)
		.where(and(eq(T.kind, kind), isNull(T.clearedAt)))
	return rows.map(toRow)
}

function capIds(ids: unknown): number[] {
	if (!Array.isArray(ids)) return []
	return [
		...new Set(
			ids.filter((id): id is number => Number.isInteger(id) && id > 0)
		)
	].slice(0, NOTIFICATION_IDS_CAP)
}

/**
 * Mark the user's rows read. Rows of a kind that clears on view (`view`,
 * `either`) are cleared as `viewed` in the same breath.
 */
export async function markNotificationsRead(
	userId: number,
	ids: unknown,
	db?: Db
): Promise<void> {
	const wanted = capIds(ids)
	if (!wanted.length) return
	const d = dbOf(db) as any
	const now = new Date()
	await d
		.update(T)
		.set({ readAt: now })
		.where(
			and(eq(T.userId, userId), inArray(T.id, wanted), isNull(T.readAt))
		)
	const viewKinds = notificationKinds()
		.filter((k) => k.clearsOn !== "resolve")
		.map((k) => k.id)
	if (viewKinds.length)
		await d
			.update(T)
			.set({ clearedAt: now, clearedHow: "viewed" })
			.where(
				and(
					eq(T.userId, userId),
					inArray(T.id, wanted),
					isNull(T.clearedAt),
					inArray(T.kind, viewKinds)
				)
			)
	pushChanged(userId, db)
}

/** Clear the user's rows as `dismissed`. */
export async function dismissNotifications(
	userId: number,
	ids: unknown,
	db?: Db
): Promise<void> {
	const wanted = capIds(ids)
	if (!wanted.length) return
	const now = new Date()
	await (dbOf(db) as any)
		.update(T)
		.set({ clearedAt: now, clearedHow: "dismissed", readAt: now })
		.where(
			and(eq(T.userId, userId), inArray(T.id, wanted), isNull(T.clearedAt))
		)
	pushChanged(userId, db)
}

export async function listNotifications(
	userId: number,
	db?: Db
): Promise<NotificationsListResponse> {
	const d = dbOf(db) as any
	const open: RowRecord[] = await d
		.select()
		.from(T)
		.where(and(eq(T.userId, userId), isNull(T.clearedAt)))
		.orderBy(desc(T.lastRaisedAt), desc(T.id))
	const cleared: RowRecord[] = await d
		.select()
		.from(T)
		.where(and(eq(T.userId, userId), isNotNull(T.clearedAt)))
		.orderBy(desc(T.clearedAt), desc(T.id))
		.limit(LIST_CLEARED_LIMIT)
	return { open: open.map(toRow), cleared: cleared.map(toRow) }
}

/** Push the fresh list to every interested socket of the user. */
export function pushChanged(userId: number, db?: Db): void {
	pushToUser(userId, "notifications:changed", () =>
		listNotifications(userId, db)
	)
}

/**
 * Boot: every open row of a memory-backed kind points at something this
 * process never saw. One statement.
 */
export async function lapseMemoryBackedNotifications(db?: Db): Promise<number> {
	const kinds = notificationKinds()
		.filter((k) => k.memoryBacked)
		.map((k) => k.id)
	if (!kinds.length) return 0
	const rows: unknown[] = await (dbOf(db) as any)
		.update(T)
		.set({ clearedAt: new Date(), clearedHow: "lapsed" })
		.where(and(isNull(T.clearedAt), inArray(T.kind, kinds)))
		.returning({ id: T.id })
	return rows.length
}

/**
 * Drop cleared rows past retention: older than `NOTIFICATION_RETENTION_DAYS`,
 * or beyond each user's newest `NOTIFICATION_MAX_CLEARED_PER_USER`. Open rows
 * are never pruned.
 */
export async function pruneNotifications(
	db: Db,
	now: Date = new Date(),
	opts: { days?: number; maxPerUser?: number } = {}
): Promise<void> {
	const days = opts.days ?? NOTIFICATION_RETENTION_DAYS
	const max = opts.maxPerUser ?? NOTIFICATION_MAX_CLEARED_PER_USER
	const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
	const d = db as any
	await d.delete(T).where(and(isNotNull(T.clearedAt), lt(T.clearedAt, cutoff)))
	await d.execute(sql`
		DELETE FROM "notifications" WHERE "id" IN (
			SELECT "id" FROM (
				SELECT "id", row_number() OVER (
					PARTITION BY "user_id" ORDER BY "cleared_at" DESC, "id" DESC
				) AS rn
				FROM "notifications" WHERE "cleared_at" IS NOT NULL
			) ranked WHERE rn > ${max}
		)`)
}
