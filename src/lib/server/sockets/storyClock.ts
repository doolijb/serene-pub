/**
 * 🚧 `sessions:storyClock` and `sessions:setStoryClock` (PLAN-core-widgets
 * W3, 2026-10-11) — the two doors core's Chronicle widget asks through, by
 * way of its page (`sessionPage/requests/storyClock.ts`). Thin: the read is
 * `sessionStoryNowOf`'s and `storyNowOf`'s, the set and the clear are the
 * settings form's `sessionLinePatch`, and the step is the *Advance story
 * clock* step's `advanceSessionStoryClock`. Nothing here decides a date.
 *
 * Who: anyone in the session reads the clock (the session's settings show a
 * guest its line and clock too); its owner alone moves it, as the settings
 * form's save does. Moving it never moves the lorebook's present.
 *
 * Why not `sessions:update`: that save is the whole settings form's. Sent
 * with the clock alone it clears the session's tags (absent `tags` reads as
 * none), and its reply closes and toasts every open settings form of the
 * person's.
 *
 * Every answer — reply and refusal — carries the ask's `request` token back:
 * the reply reaches every tab of the person, and only the token tells an ask
 * its own answer.
 */
import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import {
	STORY_TIME_UNITS,
	sessionEvents,
	type StoryTimeUnit
} from "@serene-pub/sdk"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"
import { sessionReadingOf } from "$lib/server/state/reading"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"
import {
	advanceSessionStoryClock,
	bookCalendarOf,
	clockOf,
	clockOfNow,
	clockProblem,
	storyNowOf,
	StoryClockRefusal
} from "$lib/server/state/storyTime"
import type { StoryClock } from "$lib/shared/lorebooks/storyDate"

type Reading = Sockets.Sessions.StoryClock.Reading

const tokenOf = (params: { request?: unknown }) =>
	typeof params?.request === "string" ? { request: params.request } : {}

/** The session row's book, line and clock columns. */
async function clockRow(sessionId: number) {
	const [row] = await db
		.select({
			lorebookId: schema.sessions.lorebookId,
			lorebookBranchId: schema.sessions.lorebookBranchId,
			storyClockYear: schema.sessions.storyClockYear,
			storyClockMonth: schema.sessions.storyClockMonth,
			storyClockDay: schema.sessions.storyClockDay,
			storyClockHour: schema.sessions.storyClockHour,
			storyClockMinute: schema.sessions.storyClockMinute
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row ?? null
}

/**
 * Where the session stands: its own clock, its line's present, and the
 * book's calendar to spell them with. Refused to anyone not in the session.
 */
export async function readSessionStoryClock(
	sessionId: number,
	userId: number
): Promise<Reading> {
	const access = await checkSessionAccess(sessionId, userId)
	if (!access.hasAccess)
		throw new StoryClockRefusal("This session is not one you are in.")
	const row = await clockRow(sessionId)
	if (!row?.lorebookId)
		return {
			lorebookId: null,
			branchId: null,
			own: null,
			present: null,
			linePresent: null,
			calendar: null,
			isOwner: access.isOwner
		}
	// The session's reading: its line (a stale one reads main) with the
	// ancestor chain and fork cuts — what its present is read on.
	const reading = await sessionReadingOf(db, sessionId)
	const branchId = reading?.branchId ?? null
	const lineNow = await storyNowOf(db, row.lorebookId, branchId, {
		line: reading?.line ?? null
	})
	const own = clockOf(row)
	const linePresent = lineNow ? clockOfNow(lineNow) : null
	return {
		lorebookId: row.lorebookId,
		branchId,
		own,
		present: own ?? linePresent,
		linePresent,
		calendar: await bookCalendarOf(db, row.lorebookId),
		isOwner: access.isOwner
	}
}

const isWhole = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v)
const isPart = (v: unknown) => v === undefined || v === null || isWhole(v)

/** A clock as it came off the wire, or null when it is not one. */
function clockFrom(raw: unknown): StoryClock | null {
	const c = raw as Record<string, unknown> | null
	if (!c || typeof c !== "object" || !isWhole(c.year)) return null
	if (![c.month, c.day, c.hour, c.minute].every(isPart)) return null
	return {
		year: c.year,
		month: (c.month as number | null | undefined) ?? null,
		day: (c.day as number | null | undefined) ?? null,
		hour: (c.hour as number | null | undefined) ?? null,
		minute: (c.minute as number | null | undefined) ?? null
	}
}

const sameClock = (a: StoryClock | null, b: StoryClock | null) =>
	JSON.stringify(a) === JSON.stringify(b)

/**
 * Move the session's story clock, as its owner: clear it (`follow`), set it
 * (`to`) or step it (`by` + `unit`). Exactly one. A date the book's calendar
 * cannot place, or a step that does not land, is refused with the reason and
 * nothing is written.
 */
export async function setSessionStoryClock(
	sessionId: number,
	userId: number,
	params: Sockets.Sessions.SetStoryClock.Params
): Promise<{ moved: boolean; from?: StoryClock | null; to?: StoryClock | null }> {
	const access = await checkSessionAccess(sessionId, userId)
	if (!access.isOwner)
		throw new StoryClockRefusal(
			"Only the session's owner moves its story clock."
		)
	const follow = params.follow === true
	const stepping = params.by !== undefined || params.unit !== undefined
	const setting = params.to !== undefined
	if (Number(follow) + Number(stepping) + Number(setting) !== 1)
		throw new StoryClockRefusal(
			"Say one way to move the clock: follow its line, a date, or a step."
		)
	const before = await clockRow(sessionId)
	if (!before) throw new StoryClockRefusal(`There is no session ${sessionId}.`)
	// 🚧 pr-6 (§B-3a): no shared book — the session's own book.
	const book = before.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
	if (book == null) throw new StoryClockRefusal(`There is no session ${sessionId}.`)
	const was = clockOf(before)

	if (stepping) {
		if (!STORY_TIME_UNITS.includes(params.unit as StoryTimeUnit))
			throw new StoryClockRefusal(
				`Step by one of ${STORY_TIME_UNITS.join(", ")}.`
			)
		// The step's own refusals (no present, a step of nothing, a date
		// that does not land) are StoryClockRefusals with their sentence.
		const stepped = await advanceSessionStoryClock(
			db,
			sessionId,
			params.by as number,
			params.unit as StoryTimeUnit
		)
		await noteTimeActionQuietly(sessionId)
		return { moved: true, from: stepped.from, to: stepped.clock }
	}

	const clock = follow ? null : clockFrom(params.to)
	if (!follow && !clock)
		throw new StoryClockRefusal(
			"A clock is a whole year, with a month, a day, an hour and a minute where it has them."
		)
	if (clock) {
		const problem = clockProblem(
			clock,
			await bookCalendarOf(db, book)
		)
		if (problem)
			throw new StoryClockRefusal(
				`That clock does not fit this lorebook. ${problem}`
			)
	}
	if (sameClock(was, clock)) return { moved: false }
	// The settings form's own write: checked against the calendar again and
	// written under the book's calendar lock, in one transaction.
	const { sessionLinePatch } = await import("$lib/server/sockets/sessions")
	await db.transaction(async (tx) => {
		const patch = await sessionLinePatch(tx, {
			before: {
				lorebookId: before.lorebookId,
				lorebookBranchId: before.lorebookBranchId
			},
			session: { id: sessionId, name: null },
			clock
		})
		await tx
			.update(schema.sessions)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(schema.sessions.id, sessionId))
	})
	// A person setting the clock is a time action; following the line's
	// present again is not — it moves back to where the book stands.
	if (!follow) await noteTimeActionQuietly(sessionId)
	// 🚧 Where it stood and where it stands, for `story-clock-moved` — a set
	// date; following the line again names no date of its own.
	return { moved: true, ...(clock ? { from: was, to: clock } : {}) }
}

/**
 * 🚧 A person moved the clock (a step or a set): a **time action** for the
 * boundary watcher (live scenes §4) — the next line of each lane may begin a
 * new scene. Never fails the move.
 */
async function noteTimeActionQuietly(sessionId: number): Promise<void> {
	const { noteTimeAction } = await import("$lib/server/scenes/boundaryWatcher")
	await noteTimeAction(db, { sessionId, cause: "person" })
}

/**
 * What every moved clock says, as the settings form's save says it: every
 * tab re-reads the session's state (what it inherits is read as of its
 * clock), and `session-updated` names the clock under the person's
 * `settings` cause — which never fires a turn. Best-effort: the clock moved
 * either way.
 */
async function announceMoved(
	socket: any,
	sessionId: number,
	userId: number,
	move: { from?: StoryClock | null; to?: StoryClock | null } = {}
) {
	// 🚧 The owner moved a setting of the session: an interaction (R11, R21).
	const { noteInteraction } = await import("$lib/server/pipelines/routines/interaction")
	await noteInteraction(db, sessionId, "setting")
	try {
		await broadcastToSessionUsers(socket.io, sessionId, "state:changed", {
			sessionId
		} satisfies Sockets.State.Changed.Response)
		const { emitSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		await emitSessionEvent(db, {
			sessionId,
			userId,
			event: sessionEvents.sessionUpdated,
			payload: {
				sessionId,
				changed: ["storyClock"],
				cause: { kind: "settings", userId }
			},
			io: socket.io
		})
		// 🚧 The session moment (PLAN-layering D7, lane 6): once per move.
		if (move.from && move.to) {
			const { noteStoryClockMoved } = await import("$lib/server/pipelines/routines/moments")
			await noteStoryClockMoved(db, {
				sessionId,
				userId,
				cause: { kind: "settings", userId },
				from: move.from,
				to: move.to,
				io: socket.io
			})
		}
	} catch (err) {
		console.warn("[storyClock] session-updated emit failed:", err)
	}
}

export const sessionsStoryClock: Handler<
	Sockets.Sessions.StoryClock.Params,
	Sockets.Sessions.StoryClock.Response
> = {
	event: "sessions:storyClock",
	handler: async (socket, params, emitToUser) => {
		const token = tokenOf(params)
		try {
			const reading = await readSessionStoryClock(
				params.sessionId,
				socket.user!.id
			)
			const res = { sessionId: params.sessionId, ...token, ...reading }
			emitToUser("sessions:storyClock", res)
			return res
		} catch (error: any) {
			const res = {
				sessionId: params?.sessionId,
				...token,
				error:
					error instanceof StoryClockRefusal
						? error.message
						: "The story clock could not be read."
			}
			if (!(error instanceof StoryClockRefusal))
				console.warn("[storyClock] read failed:", error)
			emitToUser("sessions:storyClock:error", res)
			return res
		}
	}
}

export const sessionsSetStoryClock: Handler<
	Sockets.Sessions.SetStoryClock.Params,
	Sockets.Sessions.SetStoryClock.Response
> = {
	event: "sessions:setStoryClock",
	handler: async (socket, params, emitToUser) => {
		const token = tokenOf(params)
		const userId = socket.user!.id
		try {
			const { moved, from, to } = await setSessionStoryClock(
				params.sessionId,
				userId,
				params
			)
			if (moved) await announceMoved(socket, params.sessionId, userId, { from, to })
			const reading = await readSessionStoryClock(
				params.sessionId,
				userId
			)
			const res = { sessionId: params.sessionId, ...token, ...reading }
			emitToUser("sessions:setStoryClock", res)
			return res
		} catch (error: any) {
			const res = {
				sessionId: params?.sessionId,
				...token,
				error:
					error instanceof StoryClockRefusal
						? error.message
						: "The story clock could not be moved."
			}
			if (!(error instanceof StoryClockRefusal))
				console.warn("[storyClock] write failed:", error)
			emitToUser("sessions:setStoryClock:error", res)
			return res
		}
	}
}

export function registerStoryClockHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sessionsStoryClock, emitToUser)
	register(socket, sessionsSetStoryClock, emitToUser)
}
