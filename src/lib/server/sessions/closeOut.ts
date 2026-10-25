/**
 * 🚧 **Close out's reads** (pr-6, R-d and pass 9 S4; shapes §B-6): which registration closes a session out, what a
 * close-out would summarize, and the catch-up offer. The orchestration that files and summarizes the scenes needs
 * `emitToUser` and so lives in `sockets/sessionArchive.ts` — a domain module never imports sockets/.
 */
import { and, desc, eq, gt, isNotNull, ne, sql } from "drizzle-orm"
import { closeOutAction } from "@serene-pub/core-catalog"
import { parseActionIdentity, type EffectiveRegistration } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { DEFAULT_CHANNEL } from "$lib/server/messages/channels"
import { liveMessageWhere } from "$lib/server/messages/store"
import { effectiveRegistrations } from "$lib/server/pipelines/registrations/resolve"
import { settledLineOf } from "$lib/server/sessions/settle"
import { playHasWritten } from "$lib/server/sessions/bookLock"
import type { CatchUpOffer } from "$lib/shared/sessions/archive"

/** The session's close-out registration: the effective `action` registration whose identity's key is `closeOutAction.key`, mode not "off"; null when none. */
export async function closeOutRegistrationOf(
	db: Db,
	sessionId: number
): Promise<EffectiveRegistration | null> {
	const resolved = await effectiveRegistrations(db, sessionId)
	return (
		resolved?.effective.find(
			(r) =>
				r.trigger.family === "action" &&
				parseActionIdentity((r.trigger as { action?: unknown }).action)?.key === closeOutAction.key &&
				r.mode !== "off"
		) ?? null
	)
}

/** What a close-out would summarize: the live lines on `main` with id > max(settle line, the newest closed scene's close); null when none. */
export async function closeOutStretchOf(
	db: Db,
	sessionId: number
): Promise<{ fromMessageId: number; throughMessageId: number; lines: number } | null> {
	const settled = (await settledLineOf(db, sessionId)) ?? 0
	const [closed] = await db
		.select({ at: sql<number | null>`max(${schema.scenes.closedAtMessageId})` })
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.channel, DEFAULT_CHANNEL),
				isNotNull(schema.scenes.closedAtMessageId)
			)
		)
	const after = Math.max(settled, closed?.at ?? 0)
	const m = schema.sessionMessages
	const [row] = await db
		.select({
			from: sql<number | null>`min(${m.id})`,
			through: sql<number | null>`max(${m.id})`,
			lines: sql<number>`count(*)::int`
		})
		.from(m)
		.where(
			and(
				eq(m.sessionId, sessionId),
				eq(m.channel, DEFAULT_CHANNEL),
				liveMessageWhere(m.rewindOrdinal),
				gt(m.id, after)
			)
		)
	if (!row || row.from == null || row.through == null || !row.lines) return null
	return { fromMessageId: Number(row.from), throughMessageId: Number(row.through), lines: Number(row.lines) }
}

/** §B-6: non-null only when this session reads a shared book, has not played, and the newest OTHER session of the same owner on the same line has a close-out registration and a non-null stretch. */
export async function catchUpOfferFor(db: Db, sessionId: number): Promise<CatchUpOffer | null> {
	const s = schema.sessions
	const [me] = await db
		.select({ userId: s.userId, lorebookId: s.lorebookId, branchId: s.lorebookBranchId })
		.from(s)
		.where(eq(s.id, sessionId))
		.limit(1)
	if (!me || me.lorebookId == null) return null
	if (await playHasWritten(db, sessionId)) return null
	const [older] = await db
		.select({ id: s.id, name: s.name })
		.from(s)
		.where(
			and(
				eq(s.userId, me.userId),
				ne(s.id, sessionId),
				eq(s.lorebookId, me.lorebookId),
				sql`${s.lorebookBranchId} IS NOT DISTINCT FROM ${me.branchId}`
			)
		)
		.orderBy(desc(s.updatedAt), desc(s.id))
		.limit(1)
	if (!older) return null
	if (!(await closeOutRegistrationOf(db, older.id))) return null
	const stretch = await closeOutStretchOf(db, older.id)
	if (!stretch) return null
	return {
		fromSessionId: older.id,
		fromSessionName: older.name?.trim() || "Untitled session",
		lines: stretch.lines
	}
}
