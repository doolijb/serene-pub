/**
 * 🚧 **Turn plans** (Lair character turns, owner ruling 2026-09-30): what a
 * planner's row hands on, stored and read back.
 *
 * A planner names who speaks next (`create-message@1`'s `turnPlan`: the
 * planner's document, whose `speakers` are side-character facts). Each named
 * member then takes a **character turn** — a run of their own, fired off the
 * turn order. Two facts make that work, and both live here:
 *
 *  - **the stored plan** (`storedTurnPlan`): the planner's document resolved
 *    at the write into participant references, in order — `metadata.turnPlan`
 *    `{ turns, plan, locationPassage? }`. Resolved once, at the write, by the
 *    rule a voice is resolved by (`characterId` names that seat; a name
 *    matches a seated member's name or nickname, case-insensitively), so the
 *    order and the voice can never name two different people;
 *  - **the standing plan** (`speakerRotation.ts standingTurnPlan`), read off
 *    the history by the narrator strategy and by `core:query/turn-plan@1`.
 *
 * ⚠ Not the planner's *plan* alone (the document), and not the *turn order*
 * (the session's prepared entries): the turn plan is the row's record of
 * which character turns the planner asked for.
 */

import { and, desc, eq, isNull } from "drizzle-orm"
import { liveMessageWhere } from "$lib/server/messages/store"
import * as schema from "$lib/server/db/schema"
import { coreAnnexIn } from "$lib/server/sessions/coreAnnex"
import type { RotationMessage } from "$lib/server/pipelines/runtime/speakerRotation"

/** What a planner's row stores as `metadata.turnPlan`. */
export interface StoredTurnPlan {
	/**
	 * The participant references the plan names, in order — `character:<id>`
	 * for a seated character or a persona seat, 🚧 `player-seat:<id>` for a
	 * card-less player seat. A reference in `waits` is a person's turn.
	 */
	turns: string[]
	/** The planner's document, as it answered. */
	plan: unknown
	/** Prose describing the room the plan heads into, when there was any. */
	locationPassage?: string
	/**
	 * 🚧 **Who the turn waits for** (Lair rewrite D5, 2026-10-21): the seats a
	 * person plays among `turns` — never voiced by the AI; each is that
	 * person's own line. Only when there are any.
	 */
	waits?: string[]
	/**
	 * 🚧 **The roll row the turns wait on** (Lair rewrite D3): the row whose
	 * roll forms are asked of the GM, and those forms' block ids. While one
	 * of them has no answer in the history (a row stamped
	 * `metadata.answersForm` for it), the plan's turns are held
	 * (`speakerRotation.ts plannedTurns`). Only when forms were asked.
	 */
	rolls?: { messageId: number; forms: string[] }
	/**
	 * 🚧 The waiting players the GM's Continue moved past (D5): their turns
	 * are not prepared. Written by `skipWaitingTurn`.
	 */
	skipped?: string[]
}

const bag = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** A row id a write result or a port carried — a number, a numeric string, `{ id }` or `{ ids: { id } }`. */
const rowIdOf = (v: unknown): number | null => {
	if (typeof v === "number" && Number.isInteger(v) && v > 0) return v
	if (typeof v === "string" && /^\d+$/.test(v)) return Number(v)
	const b = bag(v)
	if ("messageId" in b) return rowIdOf(b.messageId)
	if ("id" in b) return rowIdOf(b.id)
	if ("ids" in b) return rowIdOf(bag(b.ids).id ?? b.ids)
	return null
}

/** One seat a plan may name: its reference, the names it answers to, and whether a person plays it. */
interface PlanSeat {
	ref: string
	id: number | null
	names: string[]
	person: boolean
}

/**
 * The plan a `turnPlan` port value stores, or null when it plans nothing —
 * no `plan` on it. Speakers the session does not seat are left out: a turn
 * is somebody's.
 *
 * 🚧 **Seats a person plays are in the order too** (Lair rewrite D5): a
 * persona seat (`character:<persona id>`) and a card-less player seat
 * (`player-seat:<id>`, by its seat name) are resolved by the same name rule
 * as a character, in the plan's order, and listed in `waits` — the port's
 * own `waits` (the turn script's reading) joining them. The turn order shows
 * such a turn as the person's and never generates it.
 */
export async function storedTurnPlan(
	db: Db,
	sessionId: number,
	raw: unknown
): Promise<StoredTurnPlan | null> {
	const given = bag(raw)
	if (!("plan" in given) || given.plan == null) return null
	const plan = given.plan
	const speakers = Array.isArray(bag(plan).speakers) ? (bag(plan).speakers as unknown[]) : []
	const [characters, personas] = await Promise.all([
		db
			.select({
				id: schema.characters.id,
				name: schema.characters.name,
				nickname: schema.characters.nickname
			})
			.from(schema.sessionCharacters)
			.innerJoin(schema.characters, eq(schema.characters.id, schema.sessionCharacters.characterId))
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					isNull(schema.sessionCharacters.removedAt)
				)
			),
		db
			.select({
				seatId: schema.sessionPersonas.id,
				personaId: schema.sessionPersonas.personaId,
				seatName: schema.sessionPersonas.seatName,
				name: schema.characters.name,
				nickname: schema.characters.nickname
			})
			.from(schema.sessionPersonas)
			.leftJoin(schema.characters, eq(schema.characters.id, schema.sessionPersonas.personaId))
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					isNull(schema.sessionPersonas.removedAt)
				)
			)
	])
	const names = (...n: Array<string | null | undefined>) =>
		n.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim().toLowerCase())
	const seats: PlanSeat[] = [
		...characters.map((c) => ({ ref: `character:${c.id}`, id: c.id, names: names(c.name, c.nickname), person: false })),
		...personas.map((p) =>
			p.personaId != null
				? { ref: `character:${p.personaId}`, id: p.personaId, names: names(p.seatName, p.name, p.nickname), person: true }
				: { ref: `player-seat:${p.seatId}`, id: null, names: names(p.seatName), person: true }
		)
	]
	const turns: string[] = []
	const waits = new Set<string>(
		(Array.isArray(given.waits) ? given.waits : []).filter(
			(w): w is string => typeof w === "string" && seats.some((s) => s.person && s.ref === w)
		)
	)
	for (const fact of speakers) {
		const f = bag(fact)
		const byId = typeof f.characterId === "number" ? f.characterId : null
		const name = typeof f.name === "string" ? f.name.trim().toLowerCase() : ""
		const seat =
			byId !== null
				? seats.find((s) => s.id === byId)
				: name
					? seats.find((s) => s.names.includes(name))
					: undefined
		if (!seat) continue
		if (seat.person) waits.add(seat.ref)
		if (!turns.includes(seat.ref)) turns.push(seat.ref)
	}
	const passage =
		typeof given.locationPassage === "string" && given.locationPassage.trim()
			? given.locationPassage.trim()
			: undefined
	const rolls = await rollsOf(db, sessionId, given.rolls)
	return {
		turns,
		plan,
		...(passage ? { locationPassage: passage } : {}),
		...(waits.size ? { waits: [...waits] } : {}),
		...(rolls ? { rolls } : {})
	}
}

/**
 * 🚧 The roll row a plan's turns wait on (D3): the row the port names —
 * this session's, holding at least one roll form — and its forms' ids.
 * Null when no forms were asked (the port absent, or a row with none).
 */
async function rollsOf(
	db: Db,
	sessionId: number,
	raw: unknown
): Promise<{ messageId: number; forms: string[] } | null> {
	const messageId = rowIdOf(raw)
	if (messageId === null) return null
	const [row] = await db
		.select({ sessionId: schema.sessionMessages.sessionId })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!row || row.sessionId !== sessionId) return null
	const { blockTreesOf } = await import("$lib/server/messages/blocks")
	const { formBlocksOf } = await import("@serene-pub/sdk")
	const forms = (await blockTreesOf(db, messageId))
		.flatMap((tree) => formBlocksOf(tree))
		.map((f) => f.id)
		.filter((id): id is string => typeof id === "string" && !!id)
	return forms.length ? { messageId, forms } : null
}

/** How many of the newest rows, across every channel, a standing plan is searched in. */
export const TURN_PLAN_WINDOW = 200

/**
 * 🚧 **The plan row** a planned character turn takes its turn from: the row
 * carrying the standing turn plan (`standingTurnPlan`, the reading the turn
 * order prepares the planned turns from), or null when none stands.
 * `before`, a row id: only rows older than it count — a regenerate of a
 * planned turn's row reads the plan it was played from.
 *
 * Read once per planned run (`runReply`, `via: 'plan'`) and stamped on the
 * rows that run writes as `metadata.planRowId` (`HostScope.planRowId`): the
 * fact that a planned turn's rows belong to the turn that planned them.
 */
export async function standingPlanRowId(
	db: Db,
	sessionId: number,
	before?: number
): Promise<number | null> {
	const { standingTurnPlan } = await import("$lib/server/pipelines/runtime/speakerRotation")
	const rows = await db
		.select({
			id: schema.sessionMessages.id,
			role: schema.sessionMessages.role,
			channel: schema.sessionMessages.channel,
			isHidden: schema.sessionMessages.isHidden,
			personaId: schema.sessionMessages.personaId,
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				// 🚧 The live history (RF fix 5): a rewound plan stands for nobody.
				liveMessageWhere()
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(TURN_PLAN_WINDOW)
	const history: RotationMessage[] = rows.reverse().map((r) => ({
		id: r.id,
		role: r.role,
		channel: r.channel,
		isHidden: r.isHidden,
		personaId: r.personaId ?? null,
		// A seat's own line reads as its turn (`senderRefOf`, D5).
		...(typeof bag(r.metadata).speaker === "string" ? { speaker: bag(r.metadata).speaker as string } : {}),
		turnPlan: (bag(r.metadata).turnPlan ?? null) as { turns?: unknown } | null
	}))
	const standing = standingTurnPlan(history, before)
	return typeof standing?.row.id === "number" ? standing.row.id : null
}

/**
 * 🚧 **Continue moves past a waiting player** (Lair rewrite D5, 2026-10-21):
 * the GM's Continue, pressed while the head of the story's order is a
 * planned turn a person plays, records that seat as skipped on the standing
 * plan (`turnPlan.skipped`, so no later recompute prepares it again), takes
 * it out of the stored order and pushes the order. Returns the order as it
 * now stands — the caller fires its next entry, as Continue would have — or
 * null when no plan stands or it does not wait for `ref`.
 *
 * The press is the owner's alone (the socket handler decides): a guest's
 * Continue never skips anybody.
 */
export async function skipWaitingTurn(
	db: Db,
	sessionId: number,
	ref: string,
	io?: import("$lib/server/pipelines/runtime/liveRow").SessionIo
): Promise<import("@serene-pub/sdk").TurnOrderV1 | null> {
	const planRowId = await standingPlanRowId(db, sessionId)
	if (planRowId === null) return null
	const [row] = await db
		.select({ metadata: schema.sessionMessages.metadata })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, planRowId))
		.limit(1)
	const plan = bag(bag(row?.metadata).turnPlan)
	const waits = Array.isArray(plan.waits) ? (plan.waits as unknown[]) : []
	if (!waits.includes(ref)) return null
	const skipped = Array.isArray(plan.skipped) ? (plan.skipped as unknown[]).filter((s) => typeof s === "string") : []
	if (!skipped.includes(ref)) skipped.push(ref)
	await db
		.update(schema.sessionMessages)
		.set({
			metadata: { ...bag(row?.metadata), turnPlan: { ...plan, skipped } } as never
		})
		.where(eq(schema.sessionMessages.id, planRowId))
	const { readTurnOrder } = await import("@serene-pub/sdk")
	const [session] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const core = coreAnnexIn(session?.annex)
	const stored = readTurnOrder(core)
	const next = {
		...stored,
		order: stored.order.filter((e) => !(e.ref === ref && e.via === "plan")),
		computedAt: Date.now()
	}
	const { writeTurnOrder } = await import("$lib/server/sessions/turnOrder")
	await writeTurnOrder(db, sessionId, next)
	/**
	 * A pass is the seat's turn this round (`turnTally.ts`): the round ends
	 * once everyone else has had theirs too — a player the GM moves past
	 * never holds the round, and the routines that wait on it, open.
	 */
	{
		const { readTurnTally, writeLaneTally, STORY_LANE } = await import("$lib/server/pipelines/routines/turnTally")
		const lane = readTurnTally(core).lanes[STORY_LANE]
		if (lane && !(lane.turnsBy[ref] >= 1))
			await writeLaneTally(db, sessionId, STORY_LANE, { ...lane, turnsBy: { ...lane.turnsBy, [ref]: 1 } })
	}
	if (io) {
		const { pushTurnOrder } = await import("$lib/server/sessions/turnOrderPush")
		await pushTurnOrder(io, sessionId, next)
	}
	return next
}
