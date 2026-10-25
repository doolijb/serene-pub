/**
 * 🚧 **Back · Forward** — the session's **forward stack** (RF fix 5, owner
 * ruling 2026-10-23: "disable message deletions by default and introduce a
 * back and forward button. If clicking back, rewind the history. On
 * continue/new write, replace the rewound history." NOMENCLATURE §24
 * **rewound turn**).
 *
 * ## Back rewinds one turn
 *
 * The unit is the newest **turn** of the story's lane: the newest person's
 * line and every row after it — the reply, every reply of a group that
 * followed it — and, at a table of several players, the round the turn
 * tally uses (R52, replayed from the live history through the tally's own
 * rule, `replayStoryLane`): when the newest round holds more than one
 * person's line, the turn is that whole round. With it go the rows the
 * turn's runs wrote on other channels (their turn yield: a roll line, a
 * journal line) and every table row anchored to one of them. Never a row
 * before the session's first person line on the story lane: the greetings
 * and the opening stay.
 *
 * Each row is taken **out of the history**, never deleted: `rewind_ordinal`
 * says which Back took it (1 = the first, the newest turn) and the row is
 * hidden, so the prompt never reads it, and every reader of the history
 * leaves it out (`liveMessageWhere`). Everything anchored to it is taken back
 * by the one retraction rule (`retractStateAnchoredTo`, RF fix 4) — values,
 * configurations, proposals, clock moves (its tick too), zone snapshots,
 * lore imprints, the notes' entries — and what the round's runs wrote
 * anchored anywhere else; the annex goes back to where it stood before the
 * round (`reviseAnnexInPlace`), and the story lane's tally to the tally of
 * the history that is left. What was taken is kept on the row
 * (`rewind_taken`), so the forward stack survives a reload.
 *
 * ## Forward restores it
 *
 * The rows of the highest ordinal come back into the history, hidden again
 * only if they were before, and what Back took goes back with the same ids
 * (`restoreRetractedState`) — the clock stepped forward again, the annex and
 * the tally as Back found them.
 *
 * ## A new write replaces it
 *
 * Any new write while rewound deletes the forward stack for good
 * (`discardForwardStack`, `messages/store.ts`) — the one deletion of
 * messages that stays on by default.
 *
 * Neither press runs a routine or a turn: each raises one `message-hidden`
 * under an edit's cause, so the turn order recomputes from the history that
 * is left (and auto-advance, which never fires on an edit, stays still),
 * and the session is pushed to everyone in it. The session's owner presses
 * them; the story's lane alone (other channels are untouched); within this
 * session — rewinding past a branch's fork is refused, pointing at the
 * session it was branched from.
 */

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { RetractedState } from "$lib/server/state/write"
import { REWIND_REFUSALS, type RewindState } from "$lib/shared/sessions/rewind"

/** The story's lanes — `main` and its first lane, as writes canonicalise them. */
const STORY_LANES = ["main", "main:1"]

export { REWIND_REFUSALS, type RewindState } from "$lib/shared/sessions/rewind"

/** What Back keeps on each rewound row (`session_messages.rewind_taken`). */
export interface RewoundTakenV1 {
	v: 1
	/** The row was hidden before Back: Forward leaves it hidden. */
	wasHidden: boolean
	/** What the one retraction rule took back from this row. */
	state: RetractedState | null
	/** On the turn's first row only: what the turn as a whole changed. */
	turn?: {
		/** `sessions.annex` as Back found it (its revision points included). */
		annex: unknown
		/** `sessions.metadata.turnTally` as Back found it; null when there was none. */
		tally: unknown
		/** What the turn's runs wrote anchored outside its rows, taken back. */
		elsewhere: ElsewhereTaken
	}
}

/** The writes of the turn's runs anchored outside its rows (`takeRunWritesElsewhere`). */
interface ElsewhereTaken {
	values: Array<typeof schema.attributeValues.$inferSelect>
	configs: Array<typeof schema.attributeConfigs.$inferSelect>
	proposals: Array<typeof schema.stateProposals.$inferSelect>
	imprints: import("$lib/server/lorebooks/imprints").TakenImprint[]
}

type Outcome =
	| { ok: true; messageIds: number[]; ahead: number }
	| { ok: false; error: string }

const isLive = (column: AnyPgColumn = schema.sessionMessages.rewindOrdinal): SQL => isNull(column)

/** How many turns are rewound in this session — the forward stack's height. */
export async function forwardStackHeight(db: Db, sessionId: number): Promise<number> {
	const [row] = await db
		.select({ top: sql<number | null>`max(${schema.sessionMessages.rewindOrdinal})` })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				isNotNull(schema.sessionMessages.rewindOrdinal)
			)
		)
	return Number(row?.top ?? 0)
}

/**
 * The strip's state for this session (see `RewindState`). Never throws.
 * Read on every page load, so Back's reason is the cheap half of the door —
 * a person's line to go back to, and not a branch's copy — and a press it
 * lets through is judged in full by `rewindUnitOf`.
 */
export async function rewindStateOf(db: Db, sessionId: number): Promise<RewindState> {
	try {
		const ahead = await forwardStackHeight(db, sessionId)
		const m = schema.sessionMessages
		const [newestPerson] = await db
			.select({ metadata: m.metadata })
			.from(m)
			.where(and(eq(m.sessionId, sessionId), isLive(), inArray(m.channel, STORY_LANES), eq(m.role, "user")))
			.orderBy(desc(m.id))
			.limit(1)
		const back = !newestPerson
			? REWIND_REFUSALS.nothing
			: typeof (newestPerson.metadata as { copyOf?: unknown } | null)?.copyOf === "number"
				? REWIND_REFUSALS.fork
				: null
		return { ahead, back, forward: ahead > 0 ? null : REWIND_REFUSALS.noneAhead }
	} catch (e) {
		console.warn("[rewind] the strip's state could not be read:", e)
		return { ahead: 0, back: REWIND_REFUSALS.nothing, forward: REWIND_REFUSALS.noneAhead }
	}
}

/**
 * The rows Back would take now, oldest first — or why there is nothing to
 * take. See the module note for the unit.
 */
export async function rewindUnitOf(
	db: Db,
	sessionId: number
): Promise<{ ok: true; ids: number[]; firstId: number } | { ok: false; refusal: string }> {
	const m = schema.sessionMessages
	const live = and(eq(m.sessionId, sessionId), isLive())
	const story = and(live, inArray(m.channel, STORY_LANES))
	// The floor: the session's first person line on the story lane.
	const [firstPerson] = await db
		.select({ id: m.id })
		.from(m)
		.where(and(story, eq(m.role, "user")))
		.orderBy(asc(m.id))
		.limit(1)
	if (!firstPerson) return { ok: false, refusal: REWIND_REFUSALS.nothing }
	const { replayStoryLane } = await import("$lib/server/pipelines/routines/moments")
	const { lines } = await replayStoryLane(db, sessionId)
	const newest = lines[lines.length - 1]
	if (!newest || newest.id < firstPerson.id) return { ok: false, refusal: REWIND_REFUSALS.nothing }
	// The turn starts at the newest person's line — unless the newest round
	// holds the lines of more than one person (a table of players), which
	// is one turn of the table: then at the round's first line.
	const round = lines.filter((l) => l.round === newest.round)
	const people = new Set(round.filter((l) => l.person).map((l) => l.speaker))
	const newestPerson = [...lines].reverse().find((l) => l.person)
	const start = people.size > 1 ? round[0]!.id : (newestPerson?.id ?? round[0]!.id)
	const firstId = Math.max(start, firstPerson.id)
	const storyRows = await db
		.select({ id: m.id })
		.from(m)
		.where(and(story, gte(m.id, firstId)))
	const ids = new Set(storyRows.map((r) => r.id))
	if (!ids.size) return { ok: false, refusal: REWIND_REFUSALS.nothing }
	// The rows the round's runs wrote anywhere else (their turn yield).
	const runs = await unitRuns(db, [...ids])
	if (runs.length) {
		const { turnYieldOf } = await import("$lib/server/sessions/turnYield")
		for (const run of runs) for (const row of await turnYieldOf(db, run.runId)) ids.add(row.messageId)
	}
	// And every table row anchored to one of them.
	const anchored = await db
		.select({ id: m.id })
		.from(m)
		.where(
			and(
				live,
				inArray(
					sql<string>`${m.metadata} ->> 'anchorMessageId'`,
					[...ids].map(String)
				)
			)
		)
	for (const r of anchored) ids.add(r.id)
	const rows = await db
		.select({ id: m.id, metadata: m.metadata })
		.from(m)
		.where(and(live, inArray(m.id, [...ids])))
		.orderBy(asc(m.id))
	// Within this session: a branch's copies came with its fork.
	if (rows.some((r) => typeof (r.metadata as { copyOf?: unknown } | null)?.copyOf === "number"))
		return { ok: false, refusal: REWIND_REFUSALS.fork }
	if (!rows.length) return { ok: false, refusal: REWIND_REFUSALS.nothing }
	return { ok: true, ids: rows.map((r) => r.id), firstId: rows[0]!.id }
}

/** The runs that created or rewrote one of these rows (never a preview). */
async function unitRuns(db: Db, ids: number[]): Promise<Array<{ runId: number; runUuid: string }>> {
	if (!ids.length) return []
	const rows = await db
		.selectDistinct({ runId: schema.pipelineRuns.id, runUuid: schema.pipelineRuns.runId })
		.from(schema.pipelineRunArtifacts)
		.innerJoin(schema.pipelineRuns, eq(schema.pipelineRuns.id, schema.pipelineRunArtifacts.runId))
		.where(
			and(
				eq(schema.pipelineRunArtifacts.kind, "message"),
				eq(schema.pipelineRuns.isPreview, false),
				inArray(schema.pipelineRunArtifacts.entityId, ids)
			)
		)
	return rows
}

/** Is anything running in this session — a row being written, or a run in flight? */
async function sessionBusy(db: Db, sessionId: number): Promise<boolean> {
	const { settleBackgroundRuns } = await import("$lib/server/pipelines/entities/publishedValues")
	await settleBackgroundRuns(db, sessionId)
	const [row] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.isGenerating, true),
				isLive()
			)
		)
		.limit(1)
	if (row) return true
	const runRegistry = await import("$lib/server/pipelines/runtime/runRegistry")
	return runRegistry
		.active()
		.some((h) => h.sessionId === sessionId && h.kind !== "maintenance")
}

/** The door both presses share: the owner, and nothing running. */
async function doorRefusal(db: Db, sessionId: number, userId: number): Promise<string | null> {
	const { sessionAccessFor } = await import("$lib/server/messages/permissions")
	if (!(await sessionAccessFor(db, sessionId, userId)).isOwner) return REWIND_REFUSALS.notOwner
	if (await sessionBusy(db, sessionId)) return REWIND_REFUSALS.busy
	return null
}

/**
 * **Back**: take the newest turn out of the history (see the module note).
 * One transaction; a refusal writes nothing. Returns the rows it took and
 * the stack's height after.
 */
export async function rewindTurn(
	db: Db,
	opts: { sessionId: number; userId: number; io?: SessionIo }
): Promise<Outcome> {
	const refused = await doorRefusal(db, opts.sessionId, opts.userId)
	if (refused) return { ok: false, error: refused }
	const { StoryClockRefusal } = await import("$lib/server/state/clockMoves")
	let taken: { ids: number[]; ordinal: number }
	try {
		taken = await db.transaction(async (tx) => {
			const t = tx as unknown as Db
			await t.execute(sql`select pg_advisory_xact_lock(hashtext('rewind'), ${opts.sessionId})`)
			const unit = await rewindUnitOf(t, opts.sessionId)
			if (!unit.ok) throw new RewindRefusal(unit.refusal)
			const ordinal = (await forwardStackHeight(t, opts.sessionId)) + 1
			const { retractStateAnchoredTo } = await import("$lib/server/state/write")
			const [session] = await t
				.select({ annex: schema.sessions.annex, metadata: schema.sessions.metadata })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, opts.sessionId))
				.limit(1)
			const rows = await t
				.select({ id: schema.sessionMessages.id, isHidden: schema.sessionMessages.isHidden })
				.from(schema.sessionMessages)
				.where(inArray(schema.sessionMessages.id, unit.ids))
			const hidden = new Map(rows.map((r) => [r.id, r.isHidden]))
			// What the round's runs wrote anchored elsewhere, first: their
			// rows anchored to the turn are the per-row retraction's.
			const elsewhere = await takeRunWritesElsewhere(t, {
				sessionId: opts.sessionId,
				runs: await unitRuns(t, unit.ids),
				unitIds: unit.ids
			})
			const states = new Map<number, RetractedState>()
			// Newest first, as a delete would take them.
			for (const id of [...unit.ids].reverse())
				states.set(id, (await retractStateAnchoredTo(t, id, { ticks: "take" })).taken)
			// The annex, back to where it stood before the round.
			const { reviseAnnexInPlace } = await import("$lib/server/sessions/annexRevisionPoints")
			await reviseAnnexInPlace(t, opts.sessionId, unit.firstId)
			const { updateLegacy } = await import("$lib/server/messages/store")
			for (const id of unit.ids) {
				const record: RewoundTakenV1 = {
					v: 1,
					wasHidden: hidden.get(id) === true,
					state: states.get(id) ?? null,
					...(id === unit.firstId
						? {
								turn: {
									annex: session?.annex ?? null,
									tally:
										(session?.metadata as { turnTally?: unknown } | null)?.turnTally ?? null,
									elsewhere
								}
							}
						: {})
				}
				await updateLegacy(t, id, {
					isHidden: true,
					rewindOrdinal: ordinal,
					rewindTaken: JSON.parse(JSON.stringify(record))
				})
			}
			// The story lane's tally, as the history that is left has it.
			await retallyStoryLane(t, opts.sessionId)
			return { ids: unit.ids, ordinal }
		})
	} catch (e) {
		if (e instanceof RewindRefusal) return { ok: false, error: e.message }
		if (e instanceof StoryClockRefusal) return { ok: false, error: e.message }
		throw e
	}
	await announce(db, opts, taken.ids[0]!, true)
	for (const id of taken.ids) {
		const { clearReplyFailed } = await import("$lib/server/utils/generationStatus")
		await clearReplyFailed(opts.sessionId, id).catch(() => undefined)
	}
	return { ok: true, messageIds: taken.ids, ahead: taken.ordinal }
}

/**
 * **Forward**: bring the newest rewound turn back into the history, with
 * what Back took from it (ids kept). One transaction.
 */
export async function forwardTurn(
	db: Db,
	opts: { sessionId: number; userId: number; io?: SessionIo }
): Promise<Outcome> {
	const refused = await doorRefusal(db, opts.sessionId, opts.userId)
	if (refused) return { ok: false, error: refused }
	let restored: { ids: number[]; ahead: number }
	try {
		restored = await db.transaction(async (tx) => {
			const t = tx as unknown as Db
			await t.execute(sql`select pg_advisory_xact_lock(hashtext('rewind'), ${opts.sessionId})`)
			const top = await forwardStackHeight(t, opts.sessionId)
			if (!top) throw new RewindRefusal(REWIND_REFUSALS.noneAhead)
			const rows = await t
				.select({ id: schema.sessionMessages.id, taken: schema.sessionMessages.rewindTaken })
				.from(schema.sessionMessages)
				.where(
					and(
						eq(schema.sessionMessages.sessionId, opts.sessionId),
						eq(schema.sessionMessages.rewindOrdinal, top)
					)
				)
				.orderBy(asc(schema.sessionMessages.id))
			const { updateLegacy } = await import("$lib/server/messages/store")
			const { restoreRetractedState, reviveRetractedState, reviveDates } = await import(
				"$lib/server/state/write"
			)
			let turn: RewoundTakenV1["turn"] | undefined
			// Back into the history first, so what goes back lands on live rows.
			for (const row of rows) {
				const record = (row.taken ?? {}) as Partial<RewoundTakenV1>
				if (record.turn) turn = record.turn
				await updateLegacy(t, row.id, {
					isHidden: record.wasHidden === true,
					rewindOrdinal: null,
					rewindTaken: null
				})
			}
			for (const row of rows) {
				const state = reviveRetractedState((row.taken as Partial<RewoundTakenV1> | null)?.state)
				if (state) await restoreRetractedState(t, state)
			}
			if (turn) {
				const e = turn.elsewhere
				const back = <T>(table: Parameters<typeof reviveDates>[0], list: unknown[] | undefined) =>
					(list ?? []).map((r) => reviveDates(table, r)) as T[]
				const configs = back(schema.attributeConfigs, e?.configs)
				const values = back(schema.attributeValues, e?.values)
				const proposals = back(schema.stateProposals, e?.proposals)
				if (configs.length) await t.insert(schema.attributeConfigs).values(configs as never)
				if (values.length) await t.insert(schema.attributeValues).values(values as never)
				if (proposals.length) await t.insert(schema.stateProposals).values(proposals as never)
				if (e?.imprints?.length) {
					const revived = reviveRetractedState({ messageId: 0, imprints: e.imprints })
					const { restoreImprints } = await import("$lib/server/lorebooks/imprints")
					if (revived) await restoreImprints(t, revived.imprints)
				}
				// The annex and the tally, as Back found them.
				const { keepTimeless } = await import("$lib/server/sessions/annexRevisionPoints")
				const [now] = await t
					.select({ annex: schema.sessions.annex })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, opts.sessionId))
					.limit(1)
				await t.execute(sql`select pg_advisory_xact_lock(hashtext('annex'), ${opts.sessionId})`)
				await t
					.update(schema.sessions)
					.set({
						annex: keepTimeless(
							(turn.annex && typeof turn.annex === "object" ? turn.annex : {}) as Record<string, unknown>,
							now?.annex
						) as never
					})
					.where(eq(schema.sessions.id, opts.sessionId))
				const { writeTurnTally } = await import("$lib/server/pipelines/routines/turnTally")
				await writeTurnTally(
					t,
					opts.sessionId,
					(turn.tally ?? null) as import("$lib/server/pipelines/routines/turnTally").TurnTallyV1 | null
				)
			}
			return { ids: rows.map((r) => r.id), ahead: top - 1 }
		})
	} catch (e) {
		if (e instanceof RewindRefusal) return { ok: false, error: e.message }
		throw e
	}
	await announce(db, opts, restored.ids[0]!, false)
	return { ok: true, messageIds: restored.ids, ahead: restored.ahead }
}

class RewindRefusal extends Error {}

/**
 * The story lane's tally, replayed over the history that is left (Back): the
 * other lanes' stand as they are.
 */
async function retallyStoryLane(db: Db, sessionId: number): Promise<void> {
	const { replayStoryLane } = await import("$lib/server/pipelines/routines/moments")
	const { readTurnTally, writeTurnTally, STORY_LANE } = await import(
		"$lib/server/pipelines/routines/turnTally"
	)
	const [s] = await db
		.select({ metadata: schema.sessions.metadata })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if ((s?.metadata as { turnTally?: unknown } | null)?.turnTally === undefined) return
	const tally = readTurnTally(s?.metadata)
	const { tally: lane } = await replayStoryLane(db, sessionId)
	if (lane) tally.lanes[STORY_LANE] = lane
	else delete tally.lanes[STORY_LANE]
	await writeTurnTally(db, sessionId, tally)
}

/**
 * What the turn's runs wrote **outside** its rows — a seated card's change
 * kept at its member's own anchor (`dropTurnWritesElsewhere`'s case, the
 * 100-turn walk B8), a lore imprint anchored elsewhere — taken back and
 * returned row for row, so Forward can put it back. Only what landed before
 * each run ended is the run's (`keepLaterState`'s rule): a proposal a person
 * accepted afterwards carries the run's name and stays.
 */
async function takeRunWritesElsewhere(
	db: Db,
	opts: { sessionId: number; runs: Array<{ runId: number; runUuid: string }>; unitIds: number[] }
): Promise<ElsewhereTaken> {
	const none: ElsewhereTaken = { values: [], configs: [], proposals: [], imprints: [] }
	if (!opts.runs.length) return none
	const byTheRuns = (by: AnyPgColumn, at: AnyPgColumn): SQL =>
		or(
			...opts.runs.map(
				(r) =>
					and(
						eq(by, `run:${r.runUuid}`),
						sql`${at} <= (SELECT ${schema.pipelineRuns.createdAt} FROM ${schema.pipelineRuns} WHERE ${schema.pipelineRuns.id} = ${r.runId})`
					)!
			)
		)!
	const outside = (anchor: AnyPgColumn): SQL =>
		or(sql`${anchor} IS NULL`, notInArray(anchor, opts.unitIds))!
	const values = await db
		.delete(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.sessionId, opts.sessionId),
				byTheRuns(schema.attributeValues.updatedBy, schema.attributeValues.createdAt),
				outside(schema.attributeValues.validFromMessageId)
			)
		)
		.returning()
	const configs = await db
		.delete(schema.attributeConfigs)
		.where(
			and(
				eq(schema.attributeConfigs.sessionId, opts.sessionId),
				byTheRuns(schema.attributeConfigs.updatedBy, schema.attributeConfigs.createdAt),
				outside(schema.attributeConfigs.validFromMessageId)
			)
		)
		.returning()
	const proposals = await db
		.delete(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, opts.sessionId),
				byTheRuns(schema.stateProposals.proposedBy, schema.stateProposals.createdAt),
				outside(schema.stateProposals.messageId),
				// A clock move is the clock's: its anchor's retraction steps it.
				ne(schema.stateProposals.kind, "clock")
			)
		)
		.returning()
	const { retractImprints } = await import("$lib/server/lorebooks/imprints")
	const imprints = await retractImprints(db, {
		sessionId: opts.sessionId,
		runIds: opts.runs.map((r) => r.runUuid)
	})
	return { values, configs, proposals, imprints }
}

/**
 * After a press: one `message-hidden` under an edit's cause, so the turn
 * order recomputes from the history that is left (auto-advance never fires
 * on an edit, and no routine wakes on it); every sheet re-reads; the session
 * goes to everyone in it.
 */
async function announce(
	db: Db,
	opts: { sessionId: number; userId: number; io?: SessionIo },
	messageId: number,
	hidden: boolean
): Promise<void> {
	try {
		const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
		await emitSessionEvent(db, {
			sessionId: opts.sessionId,
			userId: opts.userId,
			event: "core:event/message-hidden@1",
			payload: {
				sessionId: opts.sessionId,
				messageId,
				hidden,
				// Which press raised it: no routine wakes on either
				// (`onSessionEvent`, routines/evaluate.ts).
				rewind: hidden ? "back" : "forward",
				cause: { kind: "edit", userId: opts.userId }
			},
			...(opts.io ? { io: opts.io } : {})
		})
	} catch (e) {
		console.warn("[rewind] the turn order was not told:", e)
	}
	if (!opts.io) return
	try {
		const { broadcastToSessionUsers } = await import("$lib/server/sockets/utils/broadcastHelpers")
		await broadcastToSessionUsers(opts.io as never, opts.sessionId, "state:changed", {
			sessionId: opts.sessionId
		})
	} catch (e) {
		console.warn("[rewind] telling the session its state moved failed:", e)
	}
}

/** Rows a Back would take, for a test or a tool: the unit, by id. */
export async function rewindUnitIds(db: Db, sessionId: number): Promise<number[]> {
	const unit = await rewindUnitOf(db, sessionId)
	return unit.ok ? unit.ids : []
}

/** The rewound rows of a session, highest ordinal first — the forward stack, row by row. */
export async function forwardStackRows(
	db: Db,
	sessionId: number
): Promise<Array<{ id: number; ordinal: number }>> {
	const rows = await db
		.select({ id: schema.sessionMessages.id, ordinal: schema.sessionMessages.rewindOrdinal })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				isNotNull(schema.sessionMessages.rewindOrdinal)
			)
		)
		.orderBy(desc(schema.sessionMessages.rewindOrdinal), asc(schema.sessionMessages.id))
	return rows.map((r) => ({ id: r.id, ordinal: r.ordinal! }))
}
