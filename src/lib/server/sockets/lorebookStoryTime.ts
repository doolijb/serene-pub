/**
 * A lorebook's calendar and clock, over the wire (DESIGN-story-time P5 + the
 * lorebook clock). Storage and reads are `$lib/server/state/storyTime.ts`.
 *
 * Four events, one reply shape. Every reply is the book's WHOLE story time —
 * calendar, every line's clock and every line's present (`storyTimeReply`) —
 * with `lorebookId` top-level, so one extractor scopes the family and a
 * partial reply can never be merged wrong.
 *
 *  - `lorebooks:storyTime`    — read.
 *  - `lorebooks:checkCalendar` — the preflight: what a proposed calendar would
 *    strand. Writes nothing.
 *  - `lorebooks:setCalendar`   — declare, change, or clear (`null` = free-form).
 *    Refused while the preflight lists anything.
 *  - `lorebooks:setClock`      — set or clear (`null`) one line's clock.
 *
 * ⚠ Ownership is checked on the BOOK, and a branch id must be one of its lines.
 */
import { and, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import {
	datesThatDoNotLand,
	readStoryCalendar,
	type StoryClock
} from "$lib/shared/lorebooks/storyDate"
import { parseStoryCalendar, storyCalendarProblems } from "@serene-pub/sdk"
import {
	clockColumns,
	clockOfNow,
	clockProblem,
	datedRowsOf,
	readBookStoryTime,
	storyNowOf
} from "$lib/server/state/storyTime"

/**
 * The family's reply: the stored story time plus each line's present as
 * `storyNowOf` reads it — what a session following the line stands at
 * (DESIGN-story-time P3), so session settings can show it and start from it.
 */
async function storyTimeReply(lorebookId: number): Promise<Sockets.Lorebooks.BookStoryTime> {
	const time = await readBookStoryTime(db, lorebookId)
	const presentOn = async (branchId: number | null) => {
		const now = await storyNowOf(db, lorebookId, branchId)
		return now ? clockOfNow(now) : null
	}
	return {
		...time,
		presents: {
			main: await presentOn(null),
			branches: await Promise.all(
				time.clocks.branches.map(async (b) => ({
					branchId: b.branchId,
					present: await presentOn(b.branchId)
				}))
			)
		}
	}
}

async function assertOwnedBook(lorebookId: number, userId: number) {
	const book = await db.query.lorebooks.findFirst({
		where: (l, { and: a, eq: e }) =>
			a(e(l.id, lorebookId), e(l.userId, userId)),
		columns: { id: true }
	})
	if (!book) throw new Error("Lorebook not found or access denied.")
}

export const lorebookStoryTimeHandler: Handler<
	Sockets.Lorebooks.StoryTime.Params,
	Sockets.Lorebooks.StoryTime.Response
> = {
	event: "lorebooks:storyTime",
	handler: async (socket, params, emitToUser) => {
		await assertOwnedBook(params.lorebookId, socket.user!.id)
		const res = await storyTimeReply(params.lorebookId)
		emitToUser("lorebooks:storyTime", res)
		return res
	}
}

/** The preflight's answer, for a proposed calendar. */
async function preflight(lorebookId: number, calendar: unknown) {
	const problems = calendar === null ? [] : storyCalendarProblems(calendar)
	const stranded = problems.length
		? []
		: datesThatDoNotLand(
				await datedRowsOf(db, lorebookId),
				readStoryCalendar(calendar)
			)
	return { problems, stranded }
}

export const lorebookCheckCalendarHandler: Handler<
	Sockets.Lorebooks.CheckCalendar.Params,
	Sockets.Lorebooks.CheckCalendar.Response
> = {
	event: "lorebooks:checkCalendar",
	handler: async (socket, params, emitToUser) => {
		await assertOwnedBook(params.lorebookId, socket.user!.id)
		const { problems, stranded } = await preflight(
			params.lorebookId,
			params.calendar ?? null
		)
		const res: Sockets.Lorebooks.CheckCalendar.Response = {
			lorebookId: params.lorebookId,
			problems,
			stranded
		}
		emitToUser("lorebooks:checkCalendar", res)
		return res
	}
}

/**
 * Declare, change or clear the book's calendar.
 *
 * ⚠ **Refused while any dated row would not land** (§0, "Climbing a rung").
 * The author fixes them in place from the preflight list; the calendar never
 * re-dates a row on their behalf. Going back to free-form (`null`) always
 * passes: it keeps every part the author typed and only stops spelling and
 * stepping by the calendar — nothing stored is derived from it yet (no
 * `day_index`, no schedules; P2 and P4 are not built).
 */
export const lorebookSetCalendarHandler: Handler<
	Sockets.Lorebooks.SetCalendar.Params,
	Sockets.Lorebooks.SetCalendar.Response
> = {
	event: "lorebooks:setCalendar",
	handler: async (socket, params, emitToUser) => {
		await assertOwnedBook(params.lorebookId, socket.user!.id)
		// Throws with every fault named; a malformed calendar is never repaired.
		const calendar = parseStoryCalendar(params.calendar ?? null)
		const { stranded } = await preflight(params.lorebookId, calendar)
		if (stranded.length)
			throw new Error(
				`${stranded.length} dated ${stranded.length === 1 ? "row does" : "rows do"} not fit this calendar: ` +
					stranded
						.slice(0, 5)
						.map((s) => `${s.label} (${s.problem})`)
						.join("; ") +
					(stranded.length > 5 ? "; …" : "")
			)
		await db
			.update(schema.lorebooks)
			.set({ storyCalendar: calendar })
			.where(eq(schema.lorebooks.id, params.lorebookId))
		const res = await storyTimeReply(params.lorebookId)
		emitToUser("lorebooks:setCalendar", res)
		return res
	}
}

/**
 * Set or clear one line's clock. `branchId` null is main; `clock` null clears
 * it, and the line's now falls back to its newest history entry.
 */
export const lorebookSetClockHandler: Handler<
	Sockets.Lorebooks.SetClock.Params,
	Sockets.Lorebooks.SetClock.Response
> = {
	event: "lorebooks:setClock",
	handler: async (socket, params, emitToUser) => {
		await assertOwnedBook(params.lorebookId, socket.user!.id)
		const branchId = params.branchId ?? null
		if (branchId !== null) {
			const [line] = await db
				.select({ id: schema.lorebookBranches.id })
				.from(schema.lorebookBranches)
				.where(
					and(
						eq(schema.lorebookBranches.id, branchId),
						eq(schema.lorebookBranches.lorebookId, params.lorebookId)
					)
				)
			if (!line) throw new Error("That branch is not a line of this book.")
		}
		const clock: StoryClock | null = params.clock ?? null
		if (clock) {
			const time = await readBookStoryTime(db, params.lorebookId)
			const problem = clockProblem(clock, time.calendar)
			if (problem) throw new Error(problem)
		}
		const columns = clockColumns(clock)
		if (branchId === null)
			await db
				.update(schema.lorebooks)
				.set(columns)
				.where(eq(schema.lorebooks.id, params.lorebookId))
		else
			await db
				.update(schema.lorebookBranches)
				.set(columns)
				.where(eq(schema.lorebookBranches.id, branchId))
		const res = await storyTimeReply(params.lorebookId)
		emitToUser("lorebooks:setClock", res)
		return res
	}
}

export function registerLorebookStoryTimeHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, lorebookStoryTimeHandler, emitToUser)
	register(socket, lorebookCheckCalendarHandler, emitToUser)
	register(socket, lorebookSetCalendarHandler, emitToUser)
	register(socket, lorebookSetClockHandler, emitToUser)
}
