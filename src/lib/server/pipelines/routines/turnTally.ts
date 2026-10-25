/**
 * 🚧 **The turn tally** (R51, R52; lane F1, 2026-10-21) — who has taken a
 * turn, on which lane, and where the round stands: the bookkeeping the
 * session moments (`moments.ts`) read and the published values
 * (`session.turn`, `session.round`, `session.lastSpeaker`) show.
 *
 * Stored at `sessions.annex -> 'core' -> 'turnTally'` (`TurnTallyV1`), one entry per
 * lane — a canonical channel string (`main`, `main:2`, `sanctum`):
 *
 *  · `turn` — the index of the last turn noted on the lane (lines that take
 *    a turn, counted from 1 — `moments.ts` derives it from the rows, so a
 *    regenerated or re-landed line keeps its number);
 *  · `lastSpeaker` — who took it: a participant reference, or `narrator`
 *    for the pipeline's own voice (`NARRATOR_SPEAKER`);
 *  · `turnsBy` — how many turns each speaker has taken this round (on a lane
 *    with no rounds: every turn of the lane);
 *  · `spoke` — this round's speakers in order of first turn, and `persons`
 *    those of them who are people (a member's line);
 *  · `round` — the round in progress, from 1 (the story's lane only).
 *
 * **A round** (R52) is a layer over the turns, on the story's lane: it ends
 * with the turn after which every ACTIVE speaker has had one — the turn
 * order's seated participants (its candidates, and whoever its prepared
 * entries name, the narrator included) plus every person who spoke this
 * round. Read after the line's own event work, so the order is the one its
 * recompute wrote: in a one-to-one session a person's line never closes the
 * round (the order then prepares the reply), and the reply does.
 *
 * ⚠ Not the ruleset handler's *round* (`rulesets/rounds.ts`: one reply from
 * the story's side, what a timed piece counts) — a separate count kept as
 * it was (R1 collision, flagged for the owner).
 */
import { sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { coreAnnexKeySql, coreAnnexSetSql, lockSessionAnnex } from "$lib/server/sessions/coreAnnex"

/** The speaker key of the pipeline's own voice — a narrator line names no participant. */
export const NARRATOR_SPEAKER = "narrator"

/** The story's lane — the one with rounds (where the turn order applies). */
export const STORY_LANE = "main"

/** One lane's tally — see the module note. */
export interface LaneTally {
	turn: number
	lastMessageId: number
	lastSpeaker: string
	turnsBy: Record<string, number>
	spoke: string[]
	persons: string[]
	/** The round in progress — the story's lane only. */
	round?: number
}

/** The `core` annex document's `turnTally`. */
export interface TurnTallyV1 {
	v: 1
	lanes: Record<string, LaneTally>
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** The tally the `core` annex document holds — empty when missing or unreadable. Never throws. */
export function readTurnTally(core: unknown): TurnTallyV1 {
	const t = isRecord(core) ? core.turnTally : undefined
	if (!isRecord(t) || t.v !== 1 || !isRecord(t.lanes)) return { v: 1, lanes: {} }
	const lanes: Record<string, LaneTally> = {}
	for (const [lane, raw] of Object.entries(t.lanes)) {
		if (!isRecord(raw) || typeof raw.turn !== "number") continue
		lanes[lane] = {
			turn: raw.turn,
			lastMessageId: typeof raw.lastMessageId === "number" ? raw.lastMessageId : 0,
			lastSpeaker: typeof raw.lastSpeaker === "string" ? raw.lastSpeaker : NARRATOR_SPEAKER,
			turnsBy: isRecord(raw.turnsBy)
				? Object.fromEntries(Object.entries(raw.turnsBy).filter(([, n]) => typeof n === "number")) as Record<string, number>
				: {},
			spoke: Array.isArray(raw.spoke) ? raw.spoke.filter((x): x is string => typeof x === "string") : [],
			persons: Array.isArray(raw.persons) ? raw.persons.filter((x): x is string => typeof x === "string") : [],
			...(typeof raw.round === "number" ? { round: raw.round } : {})
		}
	}
	return { v: 1, lanes }
}

/** A speaker as the tally keys it: the participant reference, or `narrator` for none. */
export const speakerKey = (speaker: string | null | undefined): string =>
	typeof speaker === "string" && speaker ? speaker : NARRATOR_SPEAKER

/** One noted turn — what `turn-ended` (and, when it closed one, `round-ended`) say. */
export interface TallyStep {
	next: LaneTally
	/** False when the line was already noted (a regenerate, a re-landed line): nothing moved. */
	counted: boolean
	/** The round the turn belongs to (story's lane only). */
	round?: number
	/** Each speaker's turns this round, this one included. */
	turnsBy: Record<string, number>
	/** Set when this turn closed the round. */
	roundEnded?: { round: number; speakers: string[] }
}

/**
 * Note one turn on a lane (pure). `seated` is the active seat list of the
 * story's lane (the turn order's candidates and entry speakers) — `null` on
 * a lane with no rounds. A line at or before the last one noted counts
 * nothing (a regenerate ends its turn again under the same number).
 */
export function tallyTurn(
	prev: LaneTally | undefined,
	line: { messageId: number; turn: number; speaker: string; person: boolean },
	seated: readonly string[] | null
): TallyStep {
	const rounds = seated !== null
	if (prev && line.messageId <= prev.lastMessageId)
		return {
			next: prev,
			counted: false,
			...(rounds ? { round: prev.round ?? 1 } : {}),
			turnsBy: { ...prev.turnsBy }
		}
	const round = rounds ? (prev?.round ?? 1) : undefined
	const turnsBy = { ...(prev?.turnsBy ?? {}) }
	turnsBy[line.speaker] = (turnsBy[line.speaker] ?? 0) + 1
	const spoke = prev?.spoke.includes(line.speaker) ? [...prev.spoke] : [...(prev?.spoke ?? []), line.speaker]
	const persons =
		line.person && !(prev?.persons ?? []).includes(line.speaker)
			? [...(prev?.persons ?? []), line.speaker]
			: [...(prev?.persons ?? [])]
	const base = { turn: line.turn, lastMessageId: line.messageId, lastSpeaker: line.speaker }
	if (!rounds) return { next: { ...base, turnsBy, spoke, persons }, counted: true, turnsBy }
	const active = new Set([...seated, ...persons])
	const complete = [...active].every((a) => (turnsBy[a] ?? 0) >= 1)
	if (!complete)
		return { next: { ...base, turnsBy, spoke, persons, round }, counted: true, round, turnsBy }
	return {
		next: { ...base, turnsBy: {}, spoke: [], persons: [], round: round! + 1 },
		counted: true,
		round,
		turnsBy,
		roundEnded: { round: round!, speakers: spoke }
	}
}

/** Write one lane of the tally — the one `turnTally` key of the `core` annex document, like the turn order's write. */
export async function writeLaneTally(db: Db, sessionId: number, lane: string, tally: LaneTally): Promise<void> {
	await db.transaction(async (tx: Db) => {
		await lockSessionAnnex(tx, sessionId)
		const [row] = rawRows<{ tally: unknown }>(
			await tx.execute(sql`
				select ${coreAnnexKeySql("turnTally")} as tally
				from ${schema.sessions}
				where ${schema.sessions.id} = ${sessionId}
			`)
		)
		if (!row) return
		const current = readTurnTally({ turnTally: row.tally })
		current.lanes[lane] = tally
		await tx.execute(sql`
			update ${schema.sessions}
			set ${sql.identifier("annex")} = ${coreAnnexSetSql("turnTally", sql`${JSON.stringify(current)}::jsonb`)}
			where ${schema.sessions.id} = ${sessionId}
		`)
	})
}

/**
 * 🚧 Put a session's whole tally back as it stood (RF fix 5): **Forward**
 * restores the document Back read before it rewound. `null` removes the key
 * (a session that had noted no turn yet). Under the annex lock.
 */
export async function writeTurnTally(db: Db, sessionId: number, tally: TurnTallyV1 | null): Promise<void> {
	await db.transaction(async (tx: Db) => {
		await lockSessionAnnex(tx, sessionId)
		await tx.execute(sql`
			update ${schema.sessions}
			set ${sql.identifier("annex")} = ${coreAnnexSetSql("turnTally", tally ? sql`${JSON.stringify(tally)}::jsonb` : null)}
			where ${schema.sessions.id} = ${sessionId}
		`)
	})
}

/** What a session publishes of its story lane's tally (`session.turn` · `round` · `lastSpeaker` · `turnsBy`). */
export function publishedTurns(core: unknown): {
	turn: number
	round: number
	lastSpeaker: string | null
	turnsBy: Record<string, number>
} {
	const lane = readTurnTally(core).lanes[STORY_LANE]
	return {
		turn: lane?.turn ?? 0,
		round: lane?.round ?? 1,
		lastSpeaker: lane?.lastSpeaker ?? null,
		turnsBy: { ...(lane?.turnsBy ?? {}) }
	}
}
