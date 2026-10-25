/**
 * 🚧 **Clock proposals** — the state-keeper asking to move the session's story
 * clock (PROPOSAL-live-scenes §6, ★3; lane F, 2026-10-13).
 *
 * The ruling: Adventure's keeper may PROPOSE a clock move, reviewed like its
 * other proposals, and never writes the clock itself; Chat never gets
 * model-driven time. The keeper's answer carries a `clock` list (`[{ by, unit
 * }]`, empty on the ordinary turn); `core:query/resolve-state-changes@1` reads
 * it here (`clockAskOf`), refuses what cannot ride with a sentence, and hands
 * the first move on as a **clock line** `{ kind: 'clock', by, unit }`;
 * `core:task/set-state@1` in `propose` mode holds it as a `state_proposals`
 * row of kind `clock` (`proposeClockChange`). Accepting one advances the
 * session's clock (`decideProposal` → `advanceSessionStoryClock`), and that
 * accept is a **time action** for the boundary watcher.
 *
 * With Trust the narrator on, no proposal: the spec's trusted arm moves the
 * clock through *Advance story clock*, the outlet *Time passes…* uses, and
 * `set-state`'s `apply` passes the clock line over.
 *
 * Forward only. A flashback is not a clock move, and a keeper that wrote a
 * negative step has misread the question.
 */

import { eq } from "drizzle-orm"
import { clockStepRefusal } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	anchorFor,
	type ClockChange,
	StateRefusal,
	type WriteContext
} from "$lib/server/state/write"
import {
	bookCalendarOf,
	clockOf,
	clockOfNow,
	sessionStoryNowOf
} from "$lib/server/state/storyTime"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"
import { stateVersionOf } from "$lib/server/state/resolve"
import { advanceStoryTime, type StoryTimeUnit } from "$lib/shared/lorebooks/storyDate"

/**
 * The clock moves a `clock` port was handed, as written: the keeper's whole
 * answer (its `clock` list, or a lone `{ by, unit }` under it), or a bare
 * `{ by, unit }`. Nothing — the ordinary turn — is an empty list.
 */
export function clockAsksOf(raw: unknown): unknown[] {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return []
	const doc = raw as Record<string, unknown>
	if ("clock" in doc) {
		const asked = doc.clock
		return Array.isArray(asked) ? asked : asked == null ? [] : [asked]
	}
	return "by" in doc || "unit" in doc ? [doc] : []
}

/**
 * Why one asked clock move cannot ride, as a sentence — or null when it can:
 * the collected clock step's own rule (`clockStepRefusal`: a whole `by` other
 * than zero within `CLOCK_STEP_MAX`, a unit of `STORY_TIME_UNITS`), forward
 * only.
 */
export function clockAskRefusal(asked: unknown): string | null {
	const step = clockStepRefusal(asked)
	if (step) return `The keeper's clock move ${step}`
	if ((asked as { by: number }).by < 0)
		return "The keeper's clock move went backwards; story time only moves forward when a scene takes it."
	return null
}

/**
 * Why this session's clock could not move by this step now, as the clock's
 * own sentence — or null when it could. A dry run of
 * `advanceSessionStoryClock`: no book, no present to start from, a result
 * that does not land. Asked when the move is RESOLVED, so a proposal nothing
 * could accept is never shown; an accept asks again, under its lock.
 */
export async function clockMoveProblem(
	db: Db,
	sessionId: number,
	by: number,
	unit: StoryTimeUnit
): Promise<string | null> {
	const [row] = await db
		.select({
			lorebookId: schema.sessions.lorebookId,
			storyClockYear: schema.sessions.storyClockYear,
			storyClockMonth: schema.sessions.storyClockMonth,
			storyClockDay: schema.sessions.storyClockDay,
			storyClockHour: schema.sessions.storyClockHour,
			storyClockMinute: schema.sessions.storyClockMinute
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return `There is no session ${sessionId}.`
	// 🚧 pr-6 (§B-3a): no shared book — the session's own book.
	const book = row.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
	if (book == null) return `There is no session ${sessionId}.`
	const start =
		clockOf(row) ??
		(await sessionStoryNowOf(db, sessionId).then((n) => (n ? clockOfNow(n) : null)))
	if (!start)
		return "This session's lorebook has no present to start from: nothing on its line is dated and no clock is set, so the keeper's clock move has nowhere to start."
	const moved = advanceStoryTime(start, by, unit, await bookCalendarOf(db, book))
	return moved.problem ?? null
}

/**
 * Hold a clock line as a **clock proposal**: a `state_proposals` row of kind
 * `clock`, anchored where the world's changes are (the session's open anchor
 * — on a reply, the reply), so a swipe or a regenerate takes it back with the
 * reply that asked. Checked again before it is held — a step the clock could
 * not take is refused here, never shown as a button.
 */
export async function proposeClockChange(
	db: Db,
	ctx: WriteContext,
	change: ClockChange
): Promise<number> {
	const refusal = clockAskRefusal(change)
	if (refusal) throw new StateRefusal(refusal)
	const problem = await clockMoveProblem(db, ctx.sessionId, change.by, change.unit)
	if (problem) throw new StateRefusal(problem)
	const anchor = await anchorFor(db, ctx, { kind: "session", id: ctx.sessionId })
	const [row] = await db
		.insert(schema.stateProposals)
		.values({
			sessionId: ctx.sessionId,
			messageId: anchor,
			kind: "clock",
			payload: { kind: "clock", by: change.by, unit: change.unit },
			status: "pending",
			proposedBy: ctx.updatedBy,
			// Stamped like every proposal, never judged: a step holds from
			// wherever the clock stands (`decideProposal`).
			baseVersion: await stateVersionOf(db, ctx.sessionId)
		})
		.returning({ id: schema.stateProposals.id })
	return row!.id
}
