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
import * as schema from "$lib/server/db/schema"
import type { RotationMessage } from "$lib/server/pipelines/runtime/speakerRotation"

/** What a planner's row stores as `metadata.turnPlan`. */
export interface StoredTurnPlan {
	/** The participant references the plan names, in order — `character:<id>`. */
	turns: string[]
	/** The planner's document, as it answered. */
	plan: unknown
	/** Prose describing the room the plan heads into, when there was any. */
	locationPassage?: string
}

const bag = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/**
 * The plan a `turnPlan` port value stores, or null when it plans nothing —
 * no `plan` on it (the Castellan speaking for the party hands on none).
 * Speakers the session does not seat are left out: a turn is somebody's.
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
	const seats = await db
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
		)
	const turns: string[] = []
	for (const fact of speakers) {
		const f = bag(fact)
		const byId = typeof f.characterId === "number" ? f.characterId : null
		const name = typeof f.name === "string" ? f.name.trim().toLowerCase() : ""
		const seat =
			byId !== null
				? seats.find((s) => s.id === byId)
				: name
					? seats.find((s) =>
							[s.name, s.nickname].some(
								(n) => typeof n === "string" && n.trim().toLowerCase() === name
							)
						)
					: undefined
		if (!seat) continue
		const ref = `character:${seat.id}`
		if (!turns.includes(ref)) turns.push(ref)
	}
	const passage =
		typeof given.locationPassage === "string" && given.locationPassage.trim()
			? given.locationPassage.trim()
			: undefined
	return { turns, plan, ...(passage ? { locationPassage: passage } : {}) }
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
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.sessionId, sessionId))
		.orderBy(desc(schema.sessionMessages.id))
		.limit(TURN_PLAN_WINDOW)
	const history: RotationMessage[] = rows.reverse().map((r) => ({
		id: r.id,
		role: r.role,
		channel: r.channel,
		isHidden: r.isHidden,
		turnPlan: (bag(r.metadata).turnPlan ?? null) as { turns?: unknown } | null
	}))
	const standing = standingTurnPlan(history, before)
	return typeof standing?.row.id === "number" ? standing.row.id : null
}
