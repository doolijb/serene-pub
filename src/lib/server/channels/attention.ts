/**
 * 🚧 **Attention** per channel (PLAN-sheet-widget-redesign §11; SDK
 * INTEGRATING §1h): `SessionV1.channels`, one entry per channel the genre
 * declares, as one viewer has it —
 *
 *  - `lanes` — `shared` or `personal` (`ChannelDecl.lanes`);
 *  - `mine` — the viewer's own lane on a personal channel (canonical, e.g.
 *    `parley:2`), absent while they have none and on a shared channel;
 *  - `unseen` — lines on the lanes they may read written since they last
 *    read each lane, their own lines and hidden or still-generating rows
 *    not counted;
 *  - `waitingOnYou` — the first prepared turn on a lane they may read is
 *    theirs to take, by the session's STORED turn order (canon A9: read,
 *    never recomputed) and who portrays its speaker (`resolvePortrayals`).
 *
 * ## The last-read mark
 *
 * No per-person read mark existed for session lanes, and no table is added
 * for one: the mark lives under annex owner `core` as `laneReads` — a core
 * runtime key (`sessions/coreAnnex.ts`): `{ "<userId>": { "<canonical lane>":
 * <message id> } }`, moved forward only, by one statement under the annex
 * lock (`markLaneRead`), so two tabs never wind a mark back.
 */

import { and, eq, sql, type SQL } from "drizzle-orm"
import { formatChannel, parseChannel, readTurnOrder, type ParticipantRef, type SessionChannelV1 } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { DEFAULT_CHANNEL } from "$lib/server/messages/channels"
import { coreAnnexIn, coreAnnexKeySql, coreAnnexSetSql, lockSessionAnnex } from "$lib/server/sessions/coreAnnex"
import { laneViewAllows, laneViewWhere, type LaneView } from "./lanes"

/** One person's read marks in a session: canonical lane → newest message id read. */
export function laneReadsOf(core: unknown, userId: number): Record<string, number> {
	const all = (core as Record<string, unknown> | null)?.laneReads
	const mine = all && typeof all === "object" ? (all as Record<string, unknown>)[String(userId)] : undefined
	const out: Record<string, number> = {}
	if (mine && typeof mine === "object" && !Array.isArray(mine))
		for (const [k, v] of Object.entries(mine as Record<string, unknown>))
			if (typeof v === "number" && Number.isInteger(v)) out[k] = v
	return out
}

/**
 * Move one person's read mark on one lane forward to `messageId` (never
 * back). `channel` is canonicalised; a bare slug is lane 1.
 */
export async function markLaneRead(
	db: Db,
	sessionId: number,
	userId: number,
	channel: string,
	messageId: number
): Promise<void> {
	const lane = formatChannel(parseChannel(channel))
	const uid = String(userId)
	const reads = coreAnnexKeySql("laneReads")
	await db.transaction(async (tx: Db) => {
		await lockSessionAnnex(tx, sessionId)
		await tx.execute(sql`
			update ${schema.sessions}
			set ${sql.identifier("annex")} = ${coreAnnexSetSql(
				"laneReads",
				sql`coalesce(${reads}, '{}'::jsonb) || jsonb_build_object(${uid}::text, coalesce(${reads} -> ${uid}::text, '{}'::jsonb) || jsonb_build_object(${lane}::text, greatest(coalesce((${reads} -> ${uid}::text ->> ${lane}::text)::int, 0), ${messageId}::int)))`
			)}
			where ${schema.sessions.id} = ${sessionId}
		`)
	})
}

/**
 * The channels view for one viewer — `SessionV1.channels`. Three reads: the
 * session row (marks, order), the unseen counts, and — only when the order
 * has entries on lanes the viewer reads — who portrays them.
 */
export async function sessionChannelsFor(db: Db, view: LaneView): Promise<SessionChannelV1[]> {
	const [session] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, view.sessionId))
		.limit(1)
	if (!session) return []
	const core = coreAnnexIn(session.annex)
	const marks = laneReadsOf(core, view.userId)

	// Unseen: rows past the viewer's mark on each lane they may read.
	const m = schema.sessionMessages
	const markEntries = Object.entries(marks)
	const past: SQL = markEntries.length
		? sql`${m.id} > (case ${m.channel} ${sql.join(
				markEntries.map(([lane, id]) => sql`when ${lane} then ${id}`),
				sql` `
			)} else 0 end)`
		: sql`true`
	const counted = await db
		.select({ channel: m.channel, n: sql<number>`count(*)::int` })
		.from(m)
		.where(
			and(
				eq(m.sessionId, view.sessionId),
				eq(m.isHidden, false),
				eq(m.isGenerating, false),
				sql`(${m.userId} is null or ${m.userId} <> ${view.userId})`,
				laneViewWhere(m.channel, view),
				past
			)
		)
		.groupBy(m.channel)
	const unseen = new Map<string, number>()
	for (const row of counted) {
		const slug = parseChannel(row.channel).slug
		unseen.set(slug, (unseen.get(slug) ?? 0) + Number(row.n))
	}

	// Waiting on you: the first prepared turn on each lane the viewer reads.
	const order = readTurnOrder(core).order
	const firstPerLane = new Map<string, string>()
	for (const entry of order) {
		const lane = formatChannel(parseChannel(entry.channel ?? DEFAULT_CHANNEL))
		if (firstPerLane.has(lane) || !laneViewAllows(view, lane)) continue
		if (typeof entry.ref === "string") firstPerLane.set(lane, entry.ref)
		else firstPerLane.set(lane, "")
	}
	const waiting = new Set<string>()
	const refs = [...new Set([...firstPerLane.values()].filter(Boolean))]
	if (refs.length) {
		try {
			const { resolvePortrayals } = await import("$lib/server/pipelines/runtime/portrayals")
			const portrayals = await resolvePortrayals(db, {
				sessionId: view.sessionId,
				runOwnerUserId: view.ownerUserId,
				refs: refs as ParticipantRef[]
			})
			for (const [lane, ref] of firstPerLane) {
				const p = ref ? (portrayals as Record<string, { by?: string; userId?: unknown }>)[ref] : undefined
				if (p?.by === "person" && Number(p.userId) === view.userId) waiting.add(parseChannel(lane).slug)
			}
		} catch {
			// A ref that names no participant names nobody: no dot.
		}
	}

	return view.channels.map((c) => {
		const mine = c.lanes === "personal" ? view.mine.get(c.slug) : null
		const n = unseen.get(c.slug) ?? 0
		return {
			slug: c.slug,
			lanes: c.lanes,
			...(mine ? { mine } : {}),
			...(waiting.has(c.slug) ? { waitingOnYou: true } : {}),
			...(n > 0 ? { unseen: n } : {})
		}
	})
}

/** The newest message id on one lane (canonical match), or null — what "read to here" with no id marks. */
export async function newestOnLane(db: Db, sessionId: number, channel: string): Promise<number | null> {
	const lane = formatChannel(parseChannel(channel))
	const [row] = rawRows<{ id: number | null }>(
		await db.execute(sql`
			select max(${schema.sessionMessages.id}) as id from ${schema.sessionMessages}
			where ${schema.sessionMessages.sessionId} = ${sessionId} and ${schema.sessionMessages.channel} = ${lane}
		`)
	)
	return row?.id == null ? null : Number(row.id)
}
