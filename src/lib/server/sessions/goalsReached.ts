/**
 * 🚧 **Mark goals reached** (PLAN-genre-restructure §4, events group; lane 2,
 * 2026-10-19).
 *
 * The Story's goals note (`annex.core['story-goals']`) is a checklist — the
 * sweep's *Track goals* writes one goal a line, `- [ ] …` while it is open
 * and `- [x] …` once the story has reached it, and a person may tick one by
 * hand in the Annex. When a write ticks a goal that was not ticked before,
 * and the session's sweep routine has *Mark goals reached* on (its duty,
 * `goal-reached`), the story says so **once**:
 * one line on the table channel where the genre keeps one, else a narrated
 * line on `main`, and every member of the
 * session — the owner and each guest — is told (`GOAL_REACHED`).
 *
 * Fires on the event (the annex write), never per turn, and costs no model
 * call. A goal unticked and ticked again is said again; a goal reworded is a
 * new goal. Never throws past its caller's catch: a note that fails must not
 * fail the write that moved the goals.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The annex key (core-catalog `STORY_GOALS_KEY`). */
export const STORY_GOALS_KEY = "story-goals"

const TICKED = /^\s*(?:[-*+]\s*)?\[[xX✓✔]\]\s*(.+?)\s*$/

/** The goals a note marks reached, by their lower-cased words. */
export function reachedGoals(note: unknown): Map<string, string> {
	const out = new Map<string, string>()
	if (typeof note !== "string") return out
	for (const line of note.split(/\r?\n/)) {
		const m = TICKED.exec(line)
		if (!m) continue
		const goal = m[1].replace(/\s+/g, " ").trim()
		if (goal) out.set(goal.toLowerCase(), goal)
	}
	return out
}

/** The goals `next` ticks that `previous` did not. */
export function newlyReached(previous: unknown, next: unknown): string[] {
	const before = reachedGoals(previous)
	return [...reachedGoals(next)].filter(([key]) => !before.has(key)).map(([, goal]) => goal)
}

/**
 * Say and tell the goals a `core` annex write newly ticked. `previous` and
 * `next` are the `core` owner's annex document before and after the write.
 */
export async function noteGoalsReached(
	db: Db,
	io: unknown,
	sessionId: number,
	previous: Record<string, unknown> | undefined,
	next: Record<string, unknown> | undefined
): Promise<string[]> {
	const goals = newlyReached(previous?.[STORY_GOALS_KEY], next?.[STORY_GOALS_KEY])
	if (!goals.length) return []
	// 🚧 *Mark goals reached* is the sweep routine's duty (lane 6, R37): on
	// at the routine's mode, else nothing is said.
	const { sessionDutiesOf } = await import("$lib/server/pipelines/routines/sessionRoutines")
	const { sweepDuties } = await import("@serene-pub/contracts")
	const mode = (await sessionDutiesOf(db, sessionId, sweepDuties.id))?.["goal-reached"]
	if (!mode || mode === "off") return []

	const [session] = await db
		.select({ userId: schema.sessions.userId, name: schema.sessions.name })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return []
	const line = goals.length === 1 ? `Goal reached: ${goals[0]}.` : `Goals reached: ${goals.join("; ")}.`

	// The table channel where the genre keeps one; else a narrated line on main.
	const { sayOnTable } = await import("$lib/server/sessions/tableLine")
	const onTable = await sayOnTable(db, io, sessionId, line)
	if (!onTable) await sayOnMain(db, io, sessionId, line)

	// Every member: the owner and each guest.
	const guests = await db
		.select({ userId: schema.sessionGuests.userId })
		.from(schema.sessionGuests)
		.where(eq(schema.sessionGuests.sessionId, sessionId))
	const userIds = [
		...new Set([session.userId, ...guests.map((g: { userId: number }) => g.userId)].filter((id): id is number => typeof id === "number"))
	]
	const { raiseNotification } = await import("$lib/server/notifications/store")
	const { GOAL_REACHED, regardingFor, sessionHref } = await import("$lib/shared/notifications/kinds")
	const sessionName = session.name?.trim() || "Untitled session"
	for (const goal of goals)
		await raiseNotification(
			{
				userIds,
				kind: GOAL_REACHED.id,
				regarding: regardingFor.goal(sessionId, goal.toLowerCase().slice(0, 120)),
				href: sessionHref(sessionId),
				vars: { session: sessionName, goal }
			},
			db
		)
	return goals
}

/** A narrated line on `main`, as the story's newest line. */
async function sayOnMain(db: Db, io: unknown, sessionId: number, text: string): Promise<void> {
	const { insertLegacy, attachParts } = await import("$lib/server/messages/store")
	const row = await insertLegacy(db, {
		sessionId,
		role: "assistant",
		channel: "main",
		content: text,
		isNarratorResponse: true,
		metadata: { goalReached: true } as never
	})
	if (io) {
		const { broadcastToSessionUsers } = await import("$lib/server/sockets/utils/broadcastHelpers")
		const [sessionMessage] = await attachParts(db, [row])
		await broadcastToSessionUsers(io as never, sessionId, "sessionMessage", { sessionMessage })
	}
}
