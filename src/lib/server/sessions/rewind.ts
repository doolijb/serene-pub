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
 * anchored anywhere else; the annex deltas anchored to its rows
 * (`annexChanges.ts`), and the story lane's tally to the tally of
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

import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import { actionsOf, i18nText, type I18n } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { liveMessageWhere } from "$lib/server/messages/store"
import { coreAnnexIn } from "$lib/server/sessions/coreAnnex"
import { SettledRefusal, sessionHistorySettle, settledLineOf } from "$lib/server/sessions/settle"
import {
	creatingRunOf,
	entryOf,
	rowNaming,
	turnRunOf,
	turnYieldOf,
	type TurnYieldRow
} from "$lib/server/sessions/turnYield"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { RetractedState } from "$lib/server/state/write"
import { REWIND_REFUSALS, type RewindState } from "$lib/shared/sessions/rewind"
import { sessionArchivedRefusal } from "$lib/server/sessions/archive"

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
		/** The `core` annex document's `turnTally` as Back found it; null when there was none. */
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
 * Read on every page load; Back's reason is the refusal `turnUnitOf` gives.
 */
export async function rewindStateOf(db: Db, sessionId: number): Promise<RewindState> {
	try {
		const ahead = await forwardStackHeight(db, sessionId)
		// 🚧 pr-6 R-k: an archived session is read-only — Back, Forward and Regenerate greyed with its sentence.
		const archived = await sessionArchivedRefusal(db, sessionId)
		if (archived) return { ahead, back: archived, forward: archived, regenerate: archived }
		const verdict = await turnUnitOf(db, sessionId, { includePersonLines: true })
		const redo = await turnUnitOf(db, sessionId, { includePersonLines: false })
		return {
			ahead,
			back: verdict.ok ? null : verdict.refusal,
			forward: ahead > 0 ? null : REWIND_REFUSALS.noneAhead,
			regenerate: redo.ok ? null : redo.refusal
		}
	} catch (e) {
		console.warn("[rewind] the strip's state could not be read:", e)
		return {
			ahead: 0,
			back: REWIND_REFUSALS.nothing,
			forward: REWIND_REFUSALS.noneAhead,
			regenerate: REWIND_REFUSALS.nothing
		}
	}
}

/**
 * 🚧 **One turn of the story, as Back and Regenerate take it** (pr-6 R-c,
 * ruled 2026-10-24: "the story-lane replay learns `planRowId` and
 * `answersForm`; one definition of "the last turn" for every genre"; shapes
 * §A-1). Back's unit holds the person lines that opened the turn;
 * Regenerate's never holds a person's line.
 */
export interface TurnUnit {
	/** Every row the unit takes, oldest first: its story-lane lines, the rows its runs created on every channel, and every table row anchored to one of them. With `includePersonLines: false`, never a `role: 'user'` row. */
	ids: number[]
	/** The oldest of them. */
	firstId: number
	/** The runs whose work the unit holds, never a preview: the opening run first, then every run that created or rewrote a row of it, then each plan row's creating run. */
	runs: Array<{ runId: number; runUuid: string }>
	/** The opening run — the turn run of the unit's oldest non-person line whose run is a reply run; null when none is. */
	run: { runId: number; runUuid: string; specSlug: string } | null
	/** The greatest `metadata.planRowId` among the unit's lines; null when it planned none. */
	planRowId: number | null
	/** What Regenerate fires again: the opening run's inlet entry; null when `run` is. */
	entry: { ref: string | null; via: string } | null
	/** The unit's non-person rows as the confirm dialog names them. */
	rows: import("$lib/server/sessions/turnYield").TurnYieldRow[]
}

/** The newest turn, or why there is none to take. */
export type TurnUnitVerdict =
	| { ok: true; unit: TurnUnit }
	| {
			ok: false
			reason: "nothing" | "fork" | "settled" | "every-turn-kept" | "empty" | "own-line" | "action" | "not-a-turn"
			refusal: string
	  }

/**
 * 🚧 The newest turn of the session's story (shapes §A-1): Back's
 * (`includePersonLines: true`) or Regenerate's (`false`). One definition of
 * "the last turn" for every genre: the story-lane replay's `turnOf`.
 */
export async function turnUnitOf(
	db: Db,
	sessionId: number,
	opts: { includePersonLines: boolean }
): Promise<TurnUnitVerdict> {
	return buildTurnUnit(db, sessionId, opts, null)
}

/**
 * The unit of the turn that holds `messageId`, a live story-lane line (else
 * `not-a-turn`) — the same builder, for any turn, not only the newest.
 */
export async function turnUnitAt(
	db: Db,
	sessionId: number,
	messageId: number,
	opts: { includePersonLines: boolean }
): Promise<TurnUnitVerdict> {
	return buildTurnUnit(db, sessionId, opts, messageId)
}

type ReplyRun =
	| { kind: "run"; run: typeof schema.pipelineRuns.$inferSelect }
	| { kind: "action"; name: string }
	| { kind: "none" }

/** The reply run whose turn a row belongs to: not an action's, not a create run's. */
async function replyRunOf(db: Db, messageId: number): Promise<ReplyRun> {
	const run = await turnRunOf(db, messageId)
	if (!run) return { kind: "none" }
	const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
	const doc = await loadPublished(db, run.specSlug).catch(() => null)
	if (!doc) return { kind: "none" }
	const [action] = actionsOf(doc as { id: string; contributes?: unknown })
	if (action) return { kind: "action", name: i18nText(action.label as I18n | undefined) || action.key }
	const role = ((doc as { taxonomy?: { role?: unknown } }).taxonomy ?? {}).role
	return role === "create" ? { kind: "none" } : { kind: "run", run }
}

async function buildTurnUnit(
	db: Db,
	sessionId: number,
	opts: { includePersonLines: boolean },
	at: number | null
): Promise<TurnUnitVerdict> {
	const m = schema.sessionMessages
	const live = and(eq(m.sessionId, sessionId), liveMessageWhere())
	const story = and(live, inArray(m.channel, STORY_LANES))
	const refuse = (
		reason: Extract<TurnUnitVerdict, { ok: false }>["reason"],
		refusal: string
	): TurnUnitVerdict => ({ ok: false, reason, refusal })
	const { replayStoryLane } = await import("$lib/server/pipelines/routines/moments")
	const { lines } = await replayStoryLane(db, sessionId)
	const byId = new Map(lines.map((l) => [l.id, l]))
	let storyIds: number[]

	if (opts.includePersonLines) {
		// The floor: the session's first person line on the story lane.
		const [firstPerson] = await db
			.select({ id: m.id })
			.from(m)
			.where(and(story, eq(m.role, "user")))
			.orderBy(asc(m.id))
			.limit(1)
		if (!firstPerson) return refuse("nothing", REWIND_REFUSALS.nothing)
		const newest = at === null ? lines[lines.length - 1] : byId.get(at)
		if (!newest) return refuse(at === null ? "nothing" : "not-a-turn", at === null ? REWIND_REFUSALS.nothing : NOT_A_TURN)
		if (newest.id < firstPerson.id) return refuse("nothing", REWIND_REFUSALS.nothing)
		let start = newest.turnOf
		if (at === null) {
			// A table of players: the newest round holding the lines of more
			// than one person (counting only those that open a turn) is one
			// turn of the table — it starts at the round's first line.
			const round = lines.filter((l) => l.round === newest.round)
			const people = new Set(round.filter((l) => l.person && l.turnOf === l.id).map((l) => l.speaker))
			if (people.size > 1) start = round[0]!.turnOf
		}
		const firstId = Math.max(start, firstPerson.id)
		if (at === null) {
			storyIds = (await db.select({ id: m.id }).from(m).where(and(story, gte(m.id, firstId)))).map((r) => r.id)
		} else {
			storyIds = lines.filter((l) => l.turnOf === newest.turnOf).map((l) => l.id)
		}
	} else {
		let headId = at
		if (headId === null) {
			const [newest] = await db
				.select({ id: m.id, role: m.role })
				.from(m)
				.where(story)
				.orderBy(desc(m.id))
				.limit(1)
			if (!newest)
				return refuse("empty", REWIND_REFUSALS.empty)
			if (newest.role === "user") return refuse("own-line", REWIND_REFUSALS.ownLine)
			headId = newest.id
		} else {
			const [row] = await db
				.select({ id: m.id, role: m.role })
				.from(m)
				.where(and(story, eq(m.id, headId)))
				.limit(1)
			if (!row) return refuse("not-a-turn", NOT_A_TURN)
			if (row.role === "user") return refuse("own-line", REWIND_REFUSALS.ownLine)
		}
		const reply = await replyRunOf(db, headId)
		if (reply.kind === "none") return refuse("not-a-turn", NOT_A_TURN)
		if (reply.kind === "action")
			return refuse("action", `The newest message came from ${reply.name}. Regenerate it from its own menu.`)
		const head = byId.get(headId)
		if (!head) return refuse("not-a-turn", NOT_A_TURN)
		storyIds = lines.filter((l) => !l.person && l.turnOf === head.turnOf).map((l) => l.id)
	}
	if (!storyIds.length) return refuse("nothing", REWIND_REFUSALS.nothing)

	const ids = new Set(storyIds)
	const storyRows = await db
		.select({ id: m.id, role: m.role, metadata: m.metadata })
		.from(m)
		.where(and(live, inArray(m.id, storyIds)))
		.orderBy(asc(m.id))
	let planRowId: number | null = null
	const planIds = new Set<number>()
	for (const r of storyRows) {
		const p = (r.metadata as { planRowId?: unknown } | null)?.planRowId
		if (typeof p === "number") {
			planIds.add(p)
			planRowId = Math.max(planRowId ?? 0, p)
		}
	}

	// The opening run: the oldest non-person line whose run is a reply run.
	let opening: typeof schema.pipelineRuns.$inferSelect | null = null
	for (const r of storyRows) {
		if (r.role === "user") continue
		const reply = await replyRunOf(db, r.id)
		if (reply.kind === "run") {
			opening = reply.run
			break
		}
	}

	// The runs whose work the unit holds, and the rows they created.
	const runs = new Map<number, string>()
	const add = (list: Array<{ runId: number; runUuid: string }>) => {
		for (const r of list) if (!runs.has(r.runId)) runs.set(r.runId, r.runUuid)
	}
	if (opening) add([{ runId: opening.id, runUuid: opening.runId }])
	add(await unitRuns(db, [...ids]))
	for (const p of planIds) {
		const by = await creatingRunOf(db, p)
		if (by && !by.isPreview) add([{ runId: by.id, runUuid: by.runId }])
	}
	for (const runId of runs.keys())
		for (const row of await turnYieldOf(db, runId)) ids.add(row.messageId)
	add(await unitRuns(db, [...ids]))

	// And every table row anchored to one of them.
	const anchored = await db
		.select({ id: m.id })
		.from(m)
		.where(and(live, inArray(sql<string>`${m.metadata} ->> 'anchorMessageId'`, [...ids].map(String))))
	for (const r of anchored) ids.add(r.id)

	const found = await db
		.select({
			id: m.id,
			channel: m.channel,
			role: m.role,
			characterId: m.characterId,
			metadata: m.metadata,
			characterName: schema.characters.name
		})
		.from(m)
		.leftJoin(schema.characters, eq(schema.characters.id, m.characterId))
		.where(
			and(
				live,
				inArray(m.id, [...ids]),
				opts.includePersonLines ? undefined : ne(m.role, "user")
			)
		)
		.orderBy(asc(m.id))
	// Within this session: a branch's copies came with its fork.
	if (found.some((r) => typeof (r.metadata as { copyOf?: unknown } | null)?.copyOf === "number"))
		return refuse("fork", REWIND_REFUSALS.fork)
	if (!found.length) return refuse("nothing", REWIND_REFUSALS.nothing)
	const firstId = found[0]!.id

	if ((await sessionHistorySettle(db, sessionId)) === "on-write")
		return refuse("every-turn-kept", REWIND_REFUSALS.everyTurnKept)
	const line = await settledLineOf(db, sessionId)
	if (line !== null && firstId <= line) return refuse("settled", REWIND_REFUSALS.settled)

	const naming = await rowNaming(db, sessionId)
	const rows: TurnYieldRow[] = found
		.filter((r) => r.role !== "user")
		.map((r) => {
			const meta = r.metadata as { narratorName?: string; speaker?: unknown } | null
			return {
				messageId: r.id,
				channel: r.channel,
				role: r.role,
				characterId: r.characterId,
				name: r.characterName ?? naming.envoyName(meta?.speaker) ?? meta?.narratorName ?? naming.ownVoice
			}
		})
	return {
		ok: true,
		unit: {
			ids: found.map((r) => r.id),
			firstId,
			runs: [...runs].map(([runId, runUuid]) => ({ runId, runUuid })),
			run: opening ? { runId: opening.id, runUuid: opening.runId, specSlug: opening.specSlug } : null,
			planRowId,
			entry: opening ? entryOf(opening.receipt) : null,
			rows
		}
	}
}

const NOT_A_TURN = "The newest message did not come from a turn, so there is no turn to regenerate."
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
export async function sessionBusy(db: Db, sessionId: number): Promise<boolean> {
	const { settleBackgroundRuns } = await import("$lib/server/pipelines/entities/publishedValues")
	await settleBackgroundRuns(db, sessionId)
	const [row] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.isGenerating, true),
				liveMessageWhere()
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
	const archived = await sessionArchivedRefusal(db, sessionId)
	if (archived) return archived
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
	opts: {
		sessionId: number
		userId: number
		io?: SessionIo
		/** Back: true (default). Regenerate: false — the unit never holds a person's line, and what somebody else wrote against it is re-anchored first (`keepLaterState`). */
		includePersonLines?: boolean
	}
): Promise<Outcome> {
	const refused = await doorRefusal(db, opts.sessionId, opts.userId)
	if (refused) return { ok: false, error: refused }
	const includePersonLines = opts.includePersonLines !== false
	const { StoryClockRefusal } = await import("$lib/server/state/clockMoves")
	let taken: { ids: number[]; ordinal: number }
	try {
		taken = await db.transaction(async (tx) => {
			const t = tx as unknown as Db
			await t.execute(sql`select pg_advisory_xact_lock(hashtext('rewind'), ${opts.sessionId})`)
			const verdict = await turnUnitOf(t, opts.sessionId, { includePersonLines })
			if (!verdict.ok) throw new RewindRefusal(verdict.refusal)
			const unit = verdict.unit
			const ordinal = (await forwardStackHeight(t, opts.sessionId)) + 1
			const { retractStateAnchoredTo } = await import("$lib/server/state/write")
			const [session] = await t
				.select({ annex: schema.sessions.annex })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, opts.sessionId))
				.limit(1)
			const rows = await t
				.select({ id: schema.sessionMessages.id, isHidden: schema.sessionMessages.isHidden })
				.from(schema.sessionMessages)
				.where(inArray(schema.sessionMessages.id, unit.ids))
			const hidden = new Map(rows.map((r) => [r.id, r.isHidden]))
			// Regenerate: what somebody else wrote against the turn moves to
			// the surviving anchor first, so only the turn's own work goes.
			if (!includePersonLines)
				await keepLaterState(t, { sessionId: opts.sessionId, yieldIds: unit.ids, runs: unit.runs })
			// What the round's runs wrote anchored elsewhere, first: their
			// rows anchored to the turn are the per-row retraction's.
			const elsewhere = await takeRunWritesElsewhere(t, {
				sessionId: opts.sessionId,
				runs: unit.runs,
				unitIds: unit.ids
			})
			const states = new Map<number, RetractedState>()
			// Newest first, as a delete would take them.
			for (const id of [...unit.ids].reverse())
				states.set(id, (await retractStateAnchoredTo(t, id, { ticks: "take", scenes: "take" })).taken)
			const { updateLegacy } = await import("$lib/server/messages/store")
			for (const id of unit.ids) {
				const record: RewoundTakenV1 = {
					v: 1,
					wasHidden: hidden.get(id) === true,
					state: states.get(id) ?? null,
					...(id === unit.firstId
						? {
								turn: {
									tally: coreAnnexIn(session?.annex).turnTally ?? null,
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
		if (e instanceof SettledRefusal) return { ok: false, error: e.message }
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
				// The tally, as Back found it (the annex deltas came back with the state).
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
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const core = coreAnnexIn(s?.annex)
	if (core.turnTally === undefined) return
	const tally = readTurnTally(core)
	const { tally: lane } = await replayStoryLane(db, sessionId)
	if (lane) tally.lanes[STORY_LANE] = lane
	else delete tally.lanes[STORY_LANE]
	await writeTurnTally(db, sessionId, tally)
}

/**
 * One "take back a run's writes elsewhere" for Back, Regenerate, Delete and
 * the revision branch: what the runs wrote **outside** the unit's rows — a
 * seated card's change kept at its member's own anchor (the 100-turn walk
 * B8), a lore imprint anchored elsewhere — taken back and returned row for
 * row, so Forward can put it back. `landedBefore` (default): only what landed
 * before each run ended is the run's (`keepLaterState`'s rule): a proposal a
 * person accepted afterwards carries the run's name and stays. Off for a
 * revision branch (its copies were stamped at the copy). `unitIds` empty = no
 * anchor filter.
 */
export async function takeRunWritesElsewhere(
	db: Db,
	opts: {
		sessionId: number
		runs: Array<{ runId: number; runUuid: string }>
		/** The unit's rows: rows anchored to them are the per-row retraction's. Empty = no anchor filter. */
		unitIds: number[]
		landedBefore?: boolean
	}
): Promise<ElsewhereTaken> {
	const none: ElsewhereTaken = { values: [], configs: [], proposals: [], imprints: [] }
	if (!opts.runs.length) return none
	const landed = opts.landedBefore !== false
	const byTheRuns = (by: AnyPgColumn, at: AnyPgColumn): SQL =>
		or(
			...opts.runs.map((r) =>
				landed
					? and(
							eq(by, `run:${r.runUuid}`),
							sql`${at} <= (SELECT ${schema.pipelineRuns.createdAt} FROM ${schema.pipelineRuns} WHERE ${schema.pipelineRuns.id} = ${r.runId})`
						)!
					: eq(by, `run:${r.runUuid}`)
			)
		)!
	const outside = (anchor: AnyPgColumn): SQL | undefined =>
		opts.unitIds.length ? or(sql`${anchor} IS NULL`, notInArray(anchor, opts.unitIds))! : undefined
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
	const verdict = await turnUnitOf(db, sessionId, { includePersonLines: true })
	return verdict.ok ? verdict.unit.ids : []
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

/**
 * Before a yield is deleted: move every state row anchored to it that the
 * turn's own run did NOT write onto the surviving anchor, so the delete's
 * cascade takes only the turn's own work (R2 hazard, owner ruling 2026-09-28,
 * option b). No schema change: the facts are the rows' own.
 *
 * **Written by the turn's run** = the writer is that run (`run:<run_id>`, the
 * keeper's applied values and proposals) AND the row landed before the run
 * ended. Those cascade. A turn whose planned character turns wrote rows of
 * the yield (🚧 Lair character turns) has several runs (`TurnYield.runs`),
 * and each one's own work is the turn's. "Ended" is when the run's own record was written
 * (`pipeline_runs.created_at`: `saveReceipt` runs once, at the end) — the
 * database's clock, the same one that stamps the state rows, so no host
 * time zone can skew the comparison.
 *
 * Everything else anchored to a yield row survives:
 *  - a Nudge (`direction`) or a whisper — an action run's writes;
 *  - a person's own edit (`user`);
 *  - a proposal the person applied after the turn — `decideProposal` writes
 *    it under the proposal's `proposed_by`, so it carries the run's name, but
 *    it landed after the run ended. The proposal row itself was the run's and
 *    goes.
 *
 * **The surviving anchor** is the newest message in the session, before the
 * row it was anchored to, that is not in the yield. Session-wide, not
 * per-channel: the turn lock (`turnMessages`) and the resolver's "highest
 * anchor wins" both read every channel, so a per-channel anchor could drop a
 * row below an older one filed on another channel's message. When nothing
 * survives before it (a retake of the first turn) the anchor is NULL — "from
 * the beginning", which the resolver ranks below every anchored row and the
 * turn lock treats as open.
 *
 * Kept rows keep their ids, so on a tie at the new anchor the later write
 * still wins — the order the resolver read before the retake.
 */
export async function keepLaterState(
	db: Db,
	opts: {
		sessionId: number
		yieldIds: number[]
		runs: Array<{ runId: number; runUuid: string }>
	}
): Promise<void> {
	if (!opts.yieldIds.length) return
	/** Not any of the turn's runs' own work: for each, another writer, or landed after it ended. */
	const notTheRuns = (by: AnyPgColumn, at: AnyPgColumn | SQL): SQL =>
		and(
			...opts.runs.map(
				(r) =>
					or(
						ne(by, `run:${r.runUuid}`),
						sql`${at} > (SELECT ${schema.pipelineRuns.createdAt} FROM ${schema.pipelineRuns} WHERE ${schema.pipelineRuns.id} = ${r.runId})`
					)!
			)
		)!

	const values = await db
		.select({
			id: schema.attributeValues.id,
			anchor: schema.attributeValues.validFromMessageId
		})
		.from(schema.attributeValues)
		.where(
			and(
				inArray(
					schema.attributeValues.validFromMessageId,
					opts.yieldIds
				),
				notTheRuns(
					schema.attributeValues.updatedBy,
					schema.attributeValues.createdAt
				)
			)
		)
	const configs = await db
		.select({
			id: schema.attributeConfigs.id,
			anchor: schema.attributeConfigs.validFromMessageId
		})
		.from(schema.attributeConfigs)
		.where(
			and(
				inArray(
					schema.attributeConfigs.validFromMessageId,
					opts.yieldIds
				),
				notTheRuns(
					schema.attributeConfigs.updatedBy,
					schema.attributeConfigs.createdAt
				)
			)
		)
	const proposals = await db
		.select({
			id: schema.stateProposals.id,
			anchor: schema.stateProposals.messageId
		})
		.from(schema.stateProposals)
		.where(
			and(
				inArray(schema.stateProposals.messageId, opts.yieldIds),
				notTheRuns(
					schema.stateProposals.proposedBy,
					// 🚧 An accepted CLOCK proposal landed when it was decided
					// (live scenes §15 G5): the row is its own move, with no
					// value row beside it, so one accepted after the turn's
					// run is kept the way that run's accepted value is.
					sql`(CASE WHEN ${schema.stateProposals.kind} = 'clock' AND ${schema.stateProposals.status} = 'accepted' THEN coalesce(${schema.stateProposals.decidedAt}, ${schema.stateProposals.createdAt}) ELSE ${schema.stateProposals.createdAt} END)`
				)
			)
		)

	const anchors = new Set(
		[...values, ...configs, ...proposals]
			.map((r) => r.anchor)
			.filter((a): a is number => a !== null)
	)
	for (const anchor of anchors) {
		const [kept] = await db
			.select({ id: schema.messages.id })
			.from(schema.messages)
			.where(
				and(
					eq(schema.messages.sessionId, opts.sessionId),
					lt(schema.messages.id, anchor),
					notInArray(schema.messages.id, opts.yieldIds)
				)
			)
			.orderBy(desc(schema.messages.id))
			.limit(1)
		const to = kept?.id ?? null
		const on = (rs: Array<{ id: number; anchor: number | null }>) =>
			rs.filter((r) => r.anchor === anchor).map((r) => r.id)
		const v = on(values)
		if (v.length)
			await db
				.update(schema.attributeValues)
				.set({ validFromMessageId: to })
				.where(inArray(schema.attributeValues.id, v))
		const c = on(configs)
		if (c.length)
			await db
				.update(schema.attributeConfigs)
				.set({ validFromMessageId: to })
				.where(inArray(schema.attributeConfigs.id, c))
		const p = on(proposals)
		if (p.length)
			await db
				.update(schema.stateProposals)
				.set({ messageId: to })
				.where(inArray(schema.stateProposals.id, p))
	}
}
