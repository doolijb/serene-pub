/**
 * 🚧 **Session moments, emitted as events** (PLAN-layering D7; lane 1's five
 * events, lane 6, 2026-10-20; turns and rounds by speaker, lane F1,
 * 2026-10-21, R51 R52) — the host's half: where each moment happens, what
 * its payload says (each states what its event's `carries` says), and the
 * one emitter they all go through (`emitSessionEvent`).
 *
 * | moment | event | when | payload |
 * |---|---|---|---|
 * | a turn ended | `turn-ended` | a speaker's line landed on a lane (a member's line, a reply, the narrator's) and what it set off settled — after its own event work, the turn-order recompute included | `messageId`, `speaker`, `lane`, `turn`, `round` (story's lane), `turnsBy`, 🚧 `turnSeatChanges` (only when the genre declares `shape.turnSeatChanges: true`) |
 * | a round ended | `round-ended` | on the story's lane, the turn after which every active speaker has had a turn (`turnTally.ts`) | `messageId`, `lane`, `turn`, `round`, `speakers` |
 * | a scene opened / closed | `scene-opened` · `scene-closed` | `openScene` / `closeScene` (a person, a boundary trigger) | `sceneId`, `messageId` |
 * | the story clock moved | `story-clock-moved` | every move of the session's own clock (a time action, the reckoning, a reply tick, a person's step, an accepted proposal) | `clock { from, to }` |
 *
 * **Turns** (R51). Every line on a lane that a speaker took is a turn of
 * that lane: not a greeting, not a host's announcement (a goal reached), not
 * a system row, not a line a routine's run wrote — routines take no turns
 * (R19). `turn` counts those lines of the lane up to and including this one,
 * so a regenerated reply ends its turn again under the same number; each
 * turn records its speaker (`lineSpeaker`: a member's seat or card, a
 * character, an envoy; `narrator` in the tally for the pipeline's own
 * voice) in the session's turn tally. Core's turn cadences count the story's
 * lane (`main`); a line on another lane is still a turn of that lane, which
 * an `onEvent` registration can listen for by its `lane`.
 *
 * **Seat changes** (🚧 owner 2026-11-09, "a read genres opt into"). A genre that
 * declares `shape.turnSeatChanges: true` gets `turnSeatChanges` on each `turn-ended`: the
 * seats added, removed or changed since the previous turn of that lane, read from
 * the session's ledger (`seatChangesOfTurn`), `[]` when none. Absent or false, the
 * payload is as before and no ledger query runs (P1).
 *
 * **Rounds** (R52) are the story's lane's: see `turnTally.ts`.
 *
 * **Not on the ledger.** Like `turn-order-changed`, a moment moves no
 * history: what it describes is already there (the line, the clock's
 * `session-updated`, the scene row). Plugins hear it; registrations and
 * cadences answer it.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { readTurnOrder, sessionEvents as sdkSessionEvents, type EventCause, type TurnSeatChange } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { liveMessageWhere } from "$lib/server/messages/store"
import { speakerRefOf } from "$lib/server/messages/sessionChanges"
import { memberFormOn } from "$lib/server/state/memberForm"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { RunLineage } from "$lib/server/pipelines/runtime/lineage"
import {
	readTurnTally,
	speakerKey,
	tallyTurn,
	writeLaneTally,
	STORY_LANE
} from "$lib/server/pipelines/routines/turnTally"

/** The story's lane — `main` and its first lane, as writes canonicalise them. */
const STORY_LANES = ["main", "main:1"]

/** A line's lane as the tally keys it — its canonical channel (`main:1` is `main`). */
export const laneOf = (channel: string | null | undefined): string => {
	const c = (channel ?? "main").trim() || "main"
	return STORY_LANES.includes(c) ? STORY_LANE : c
}

/** A message row as the turn rule reads it. */
interface LineRow {
	role: string
	userId?: number | null
	channel: string | null
	metadata: unknown
	characterId: number | null
	personaId: number | null
	isNarratorResponse: boolean | null
}

/** Does this landed line take a turn (see the module note)? Pure. (Not the Messages widget's *turn line*.) */
export function takesTurn(row: LineRow): boolean {
	if (!row || row.role === "system") return false
	const m = (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>
	if (m.isGreeting === true || m.goalReached === true) return false
	return true
}

/**
 * Whose line it is, as a participant reference; null for narration. A
 * member's line names its seat (`speakerRefOf`: the member form once the flip
 * is on, the card voiced before it), else their card-less seat or an envoy
 * (`metadata.speaker`), else the member (`user:<id>`).
 */
export function lineSpeaker(row: LineRow): string | null {
	const seat = speakerRefOf(row)
	if (seat !== null) return seat
	const said = (row.metadata as { speaker?: unknown } | null)?.speaker
	if (typeof said === "string" && said.includes(":")) return said
	if (row.role === "user" && row.userId != null) return `user:${row.userId}`
	return null
}

/**
 * ⏳ A speaker as the tally keys it once the flip is on: a card-form speaker (a
 * line from before the stamp) read as its seat's member form, the form the
 * turn order's seats hold. Anything else, or off, unchanged.
 */
async function tallySpeakerOf(db: Db, sessionId: number, speaker: string | null): Promise<string | null> {
	if (!speaker || !memberFormOn()) return speaker
	const { storedSeatRef } = await import("$lib/server/state/seatRefs")
	return (await storedSeatRef(db, sessionId, speaker)) ?? speaker
}

/** The rule for which lines are turns of a lane (R51) — `turnNumber` counts them, `seatChangesOfTurn` finds the previous one. */
function turnLineWhere(sessionId: number, lane: string) {
	const m = schema.sessionMessages
	return and(
		eq(m.sessionId, sessionId),
		sql`${m.role} <> 'system'`,
		lane === STORY_LANE ? inArray(m.channel, STORY_LANES) : eq(m.channel, lane),
		sql`coalesce(${m.metadata}::jsonb ->> 'isGreeting', '') <> 'true'`,
		sql`coalesce(${m.metadata}::jsonb ->> 'goalReached', '') <> 'true'`,
		sql`not exists (
			select 1 from ${schema.pipelineRunArtifacts} a
			join ${schema.pipelineRuns} r on r.id = a.run_id
			where a.kind = 'message' and a.entity_id = ${m.id} and a.action = 'created'
			and r.trigger_family = 'routine'
		)`
	)
}

/** The lane's turn count through `messageId` — the turn this line is in its lane. */
async function turnNumber(db: Db, sessionId: number, messageId: number, lane: string): Promise<number> {
	const m = schema.sessionMessages
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(m)
		.where(and(sql`${m.id} <= ${messageId}`, turnLineWhere(sessionId, lane)))
	return Number(row?.n ?? 0)
}

/** 🚧 Does this session's genre declare `shape.turnSeatChanges: true` (owner 2026-11-09)? Absent is off (P1). */
export async function sessionReadsSeatChanges(db: Db, sessionId: number): Promise<boolean> {
	const { sessionGenreOf } = await import("$lib/server/sessions/annexFields")
	const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
	const shape = (await getSessionGenre(db, await sessionGenreOf(db, sessionId)))?.shape
	return (shape as { turnSeatChanges?: unknown } | null | undefined)?.turnSeatChanges === true
}


/**
 * 🚧 The seats that changed in the turn `messageId` ended on `lane` (owner
 * 2026-11-09). Built from the session's ledger, never by re-diffing seats: the
 * window is the ledger ids after the previous turn-taking line of the lane
 * landed, through this line's latest landing; the seat announcements in it
 * (`member-added`, `member-removed`, `cast-changed`) are netted per seat. An
 * add and a remove inside the window cancel; a seat switched on or off or
 * re-portrayed (not a reorder) with no net add or remove is `changed`.
 * `[]` when the line has no landing on the ledger.
 */
export async function seatChangesOfTurn(
	db: Db,
	at: { sessionId: number; messageId: number; lane: string }
): Promise<TurnSeatChange[]> {
	const { latestLandingId, latestChangeIdAtOrBefore, seatEventRowsBetween } = await import(
		"$lib/server/messages/sessionChanges"
	)
	const through = await latestLandingId(db, at.sessionId, at.messageId)
	if (through == null) return []
	const m = schema.sessionMessages
	const [prev] = await db
		.select({ id: m.id, createdAt: m.createdAt })
		.from(m)
		.where(and(sql`${m.id} < ${at.messageId}`, turnLineWhere(at.sessionId, at.lane)))
		.orderBy(desc(m.id))
		.limit(1)
	let after = 0
	if (prev) {
		after =
			(await latestLandingId(db, at.sessionId, prev.id)) ??
			(await latestChangeIdAtOrBefore(db, at.sessionId, prev.createdAt)) ??
			0
	}
	const rows = await seatEventRowsBetween(db, at.sessionId, after, through)
	if (rows.length === 0) return []
	const { seatOf } = await import("$lib/server/sessions/seats")
	const { hostSeatRefOf } = await import("$lib/server/pipelines/prompt/seatCards")
	const seats = new Map<
		string,
		{ seat: { kind: "character" | "player"; castMemberId: number | null }; sum: number; recast: boolean }
	>()
	for (const r of rows) {
		const seat = await seatOf(db, at.sessionId, r.ref)
		if (!seat) continue
		const ref = hostSeatRefOf(seat)
		if (ref == null) continue
		const entry = seats.get(ref) ?? { seat, sum: 0, recast: false }
		if (r.event === sdkSessionEvents.memberAdded) entry.sum += 1
		else if (r.event === sdkSessionEvents.memberRemoved) entry.sum -= 1
		else if (r.change !== "position") entry.recast = true
		seats.set(ref, entry)
	}
	const out: TurnSeatChange[] = []
	for (const [ref, e] of seats) {
		const change = e.sum > 0 ? "added" : e.sum < 0 ? "removed" : e.recast ? "changed" : null
		if (change) out.push({ ref, seatKind: e.seat.kind, castMemberId: e.seat.castMemberId, change })
	}
	return out
}

/**
 * The story lane's active seats (R52): the turn order's candidates and the
 * speakers its prepared entries name (`narrator` for an entry in the
 * pipeline's own voice). Read after the line's own event work, so the order
 * is the one its recompute wrote.
 */
async function seatedOf(db: Db, sessionId: number): Promise<{ seated: string[]; core: { turnOrder: unknown; turnTally: unknown } }> {
	const [s] = await db
		.select({ turnOrder: schema.sessions.turnOrder, turnTally: schema.sessions.turnTally })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const core = s ?? { turnOrder: null, turnTally: null }
	const order = readTurnOrder(core)
	const seated = new Set<string>()
	// ⏳ Flip on: the seats are read in the form the tally keys a speaker by
	// (a card-form candidate or entry as its seat's member form), whoever
	// computed the order.
	const asTallied = async (ref: string) => (await tallySpeakerOf(db, sessionId, ref)) ?? ref
	for (const c of order.candidates) seated.add(await asTallied(c.ref))
	for (const e of order.order) seated.add(await asTallied(speakerKey(e.ref)))
	return { seated: [...seated], core }
}

/**
 * 🚧 **The story lane, replayed** (RF fix 5, 2026-10-23): every turn of the
 * live history on the story's lane (`takesTurn`; a rewound row is not in it,
 * nor a line a routine's run wrote), noted through the tally's own rule
 * (`tallyTurn`) against the seats the turn order holds now — so what Back
 * reads the rounds the turn tally uses (R52), and the tally Back leaves is
 * the lane's as it would stand had the rewound turn never been played. Each
 * line comes back with the round it falls in, whether a person said it, and
 * its speaker as the tally keys it.
 */
export async function replayStoryLane(
	db: Db,
	sessionId: number
): Promise<{ tally: LaneTallyOf | undefined; lines: ReplayedLine[] }> {
	const m = schema.sessionMessages
	const rows = await db
		.select({
			id: m.id,
			role: m.role,
			userId: m.userId,
			channel: m.channel,
			metadata: m.metadata,
			characterId: m.characterId,
			personaId: m.personaId,
			isNarratorResponse: m.isNarratorResponse
		})
		.from(m)
		.where(
			and(
				eq(m.sessionId, sessionId),
				inArray(m.channel, STORY_LANES),
				liveMessageWhere(),
				sql`not exists (
					select 1 from ${schema.pipelineRunArtifacts} a
					join ${schema.pipelineRuns} r on r.id = a.run_id
					where a.kind = 'message' and a.entity_id = ${m.id} and a.action = 'created'
					and r.trigger_family = 'routine'
				)`
			)
		)
		.orderBy(m.id)
	const { seated } = await seatedOf(db, sessionId)
	// ⏳ Flip on: a line from before the stamp is read as its seat's member form.
	const { loadSeatMap, memberFormOf } = await import("$lib/server/state/seatRefs")
	const seatMap = memberFormOn() ? await loadSeatMap(db, sessionId) : null
	let tally: LaneTallyOf | undefined
	let turn = 0
	const taking = rows.filter((row) => takesTurn(row as LineRow))
	const planOf = (row: { metadata: unknown }): number | null => {
		const p = (row.metadata as { planRowId?: unknown } | null)?.planRowId
		return typeof p === "number" ? p : null
	}
	const answersOf = (row: { metadata: unknown }): number | null => {
		const q = Number((row.metadata as { answersForm?: { messageId?: unknown } } | null)?.answersForm?.messageId)
		return Number.isInteger(q) && q > 0 ? q : null
	}
	// Pass 1: how far each standing plan's turn reaches.
	const spanEnd = new Map<number, number>()
	for (const row of taking) {
		const p = planOf(row)
		if (p !== null) spanEnd.set(p, Math.max(spanEnd.get(p) ?? 0, row.id))
	}
	// Pass 2: the line that opens each line's turn (R-c).
	const lines: ReplayedLine[] = []
	const turnOfLine = new Map<number, number>()
	/** The turn of the newest replayed line before `id`, else `fallback`. */
	const openerOf = (id: number, fallback: number): number => {
		for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.id < id) return lines[i]!.turnOf
		return fallback
	}
	let current: number | null = null
	for (const row of taking) {
		turn++
		const speaker = speakerKey(
			seatMap ? (memberFormOf(seatMap, lineSpeaker(row as LineRow) ?? "") ?? lineSpeaker(row as LineRow)) : lineSpeaker(row as LineRow)
		)
		const person = row.role === "user"
		const step = tallyTurn(tally, { messageId: row.id, turn, speaker, person }, seated)
		tally = step.next
		const plan = planOf(row)
		const answered = answersOf(row)
		let turnOf: number
		if (plan !== null) turnOf = openerOf(plan, row.id)
		else if (answered !== null) turnOf = turnOfLine.get(answered) ?? openerOf(answered, row.id)
		else {
			const standing = person
				? [...spanEnd].find(([p, end]) => p < row.id && row.id < end)?.[0]
				: undefined
			if (standing !== undefined) turnOf = openerOf(standing, row.id)
			else if (person) turnOf = row.id
			else turnOf = current ?? row.id
		}
		current = turnOf
		turnOfLine.set(row.id, turnOf)
		lines.push({ id: row.id, round: step.round ?? 1, person, speaker, userId: row.userId ?? null, turnOf })
	}
	return { tally, lines }
}

/** One replayed line of the story lane (see `replayStoryLane`). */
export interface ReplayedLine {
	id: number
	round: number
	person: boolean
	speaker: string
	/** The account that wrote the row (session_messages.user_id); null when none. */
	userId: number | null
	/** The id of the line that opens this line's turn (R-c). */
	turnOf: number
}

/** One lane's tally (`turnTally.ts`), as the replay builds it. */
type LaneTallyOf = import("$lib/server/pipelines/routines/turnTally").LaneTally

/** What every moment emission takes beside its payload. */
interface MomentEmit {
	sessionId: number
	userId: number
	cause?: EventCause
	lineage?: RunLineage
	depthOnly?: boolean
	io?: SessionIo
}

async function emitMoment(db: Db, at: MomentEmit, event: string, payload: Record<string, unknown>): Promise<void> {
	const { emitSessionEvent } = await import("$lib/server/pipelines/runtime/sessionEvents")
	await emitSessionEvent(db, {
		sessionId: at.sessionId,
		userId: at.userId,
		event,
		payload: {
			sessionId: at.sessionId,
			...payload,
			...(at.cause ? { cause: at.cause } : {}),
			...(at.lineage ? { lineage: at.lineage } : {})
		},
		...(at.lineage ? { lineage: at.lineage, ...(at.depthOnly ? { depthOnly: true } : {}) } : {}),
		...(at.io ? { io: at.io } : {})
	})
}

/**
 * A line landed (`message-completed`) and its own event work has run: note
 * the turn in the session's turn tally and emit `turn-ended` when it was a
 * turn, and `round-ended` when it closed the story lane's round. Run on the
 * session's event chain, after the line's dispatch. Never throws.
 */
export async function noteLineLanded(
	db: Db,
	at: MomentEmit & { messageId: number; fromRoutine?: boolean }
): Promise<void> {
	if (at.fromRoutine) return
	try {
		const m = schema.sessionMessages
		const [row] = await db
			.select({
				role: m.role,
				userId: m.userId,
				channel: m.channel,
				metadata: m.metadata,
				characterId: m.characterId,
				personaId: m.personaId,
				isNarratorResponse: m.isNarratorResponse,
				sessionId: m.sessionId
			})
			.from(m)
			.where(eq(m.id, at.messageId))
			.limit(1)
		if (!row || row.sessionId !== at.sessionId || !takesTurn(row as LineRow)) return
		const lane = laneOf(row.channel)
		const turn = await turnNumber(db, at.sessionId, at.messageId, lane)
		const speaker = await tallySpeakerOf(db, at.sessionId, lineSpeaker(row as LineRow))
		const { seated, core } = await seatedOf(db, at.sessionId)
		const prev = readTurnTally(core).lanes[lane]
		const step = tallyTurn(
			prev,
			{ messageId: at.messageId, turn, speaker: speakerKey(speaker), person: row.role === "user" },
			lane === STORY_LANE ? seated : null
		)
		if (step.counted) await writeLaneTally(db, at.sessionId, lane, step.next)
		// 🚧 Off in core until the genre opts in (`shape.turnSeatChanges`): then the
		// list rides the payload, `[]` when nothing changed. A failed read never
		// holds back the turn: the payload then goes without it.
		let turnSeatChanges: TurnSeatChange[] | null = null
		try {
			if (await sessionReadsSeatChanges(db, at.sessionId))
				turnSeatChanges = await seatChangesOfTurn(db, { sessionId: at.sessionId, messageId: at.messageId, lane })
		} catch (err) {
			console.warn(`[routines] the seat changes of message ${at.messageId}'s turn were not read:`, err)
		}
		await emitMoment(db, at, sdkSessionEvents.turnEnded, {
			messageId: at.messageId,
			speaker,
			lane,
			turn,
			...(step.round != null ? { round: step.round } : {}),
			turnsBy: step.turnsBy,
			...(turnSeatChanges ? { turnSeatChanges } : {})
		})
		if (step.roundEnded)
			await emitMoment(db, at, sdkSessionEvents.roundEnded, {
				messageId: at.messageId,
				lane,
				turn,
				round: step.roundEnded.round,
				speakers: step.roundEnded.speakers
			})
		// 🚧 pr-6 G2 (R-m): a genre whose history settles `on-write` settles
		// each line as it lands (`sessions/settle.ts`; never throws).
		const { settleOnWrite } = await import("$lib/server/sessions/settle")
		await settleOnWrite(db, {
			sessionId: at.sessionId,
			messageId: at.messageId,
			userId: at.userId,
			...(at.io ? { io: at.io } : {})
		})
	} catch (err) {
		console.warn(`[routines] the turn of message ${at.messageId} was not noted:`, err)
	}
}

/** A scene opened or closed: `scene-opened` / `scene-closed`. Never throws. */
export async function noteScene(
	db: Db,
	at: MomentEmit & { opened: boolean; sceneId: number; messageId?: number | null }
): Promise<void> {
	try {
		await emitMoment(db, at, at.opened ? sdkSessionEvents.sceneOpened : sdkSessionEvents.sceneClosed, {
			sceneId: at.sceneId,
			...(at.messageId != null ? { messageId: at.messageId } : {})
		})
	} catch (err) {
		console.warn(`[routines] scene ${at.sceneId} ${at.opened ? "opening" : "closing"} was not noted:`, err)
	}
}

/** The session's story clock moved from `from` to `to`: `story-clock-moved`, once per move. Never throws. */
export async function noteStoryClockMoved(
	db: Db,
	at: MomentEmit & { from: unknown; to: unknown }
): Promise<void> {
	if (!at.from || !at.to) return
	try {
		await emitMoment(db, at, sdkSessionEvents.storyClockMoved, { clock: { from: at.from, to: at.to } })
	} catch (err) {
		console.warn(`[routines] a story clock move in session ${at.sessionId} was not noted:`, err)
	}
}
