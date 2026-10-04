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
 * And beside them, `lorebooks:lines` (plan B6): the book's lines alone — id,
 * name, the line it forked from and the fork date — for a surface that reads
 * a line's ancestor chain or names its lines and has no use for every
 * amendment in the book (the session tabs asked `amendments:list` for that).
 * Re-sent by the three branch writes (fork, rename, delete).
 *
 * ⚠ Ownership is checked on the BOOK, and a branch id must be one of its lines.
 */
import { and, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
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
	lockBookCalendar,
	readBookStoryTime,
	storyNowOf
} from "$lib/server/state/storyTime"
import { assertOwnedBook } from "$lib/server/utils/ownedBook"

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

export const lorebookStoryTimeHandler: Handler<
	Sockets.Lorebooks.StoryTime.Params,
	Sockets.Lorebooks.StoryTime.Response
> = refusable(
	"lorebooks:storyTime",
	async (socket, params: Sockets.Lorebooks.StoryTime.Params, emitToUser) => {
		await assertOwnedBook(db, socket.user!.id, params.lorebookId)
		const res = await storyTimeReply(params.lorebookId)
		emitToUser("lorebooks:storyTime", res)
		return res
	},
	"The book's story time could not be read."
)

/**
 * The book's lines (plan B6, contract E-6): main first (`id` null, named
 * "main"), then every branch in the order it was made.
 */
export async function bookLinesReply(
	lorebookId: number
): Promise<Sockets.Lorebooks.Lines.Response> {
	const branches = await db
		.select({
			id: schema.lorebookBranches.id,
			name: schema.lorebookBranches.name,
			forkedFromBranchId: schema.lorebookBranches.forkedFromBranchId,
			forkYear: schema.lorebookBranches.forkYear,
			forkMonth: schema.lorebookBranches.forkMonth,
			forkDay: schema.lorebookBranches.forkDay
		})
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, lorebookId))
		.orderBy(schema.lorebookBranches.id)
	return {
		lorebookId,
		lines: [
			{
				id: null,
				name: "main",
				forkedFromBranchId: null,
				forkYear: null,
				forkMonth: null,
				forkDay: null
			},
			...branches.map((b) => ({
				id: b.id,
				name: b.name,
				forkedFromBranchId: b.forkedFromBranchId ?? null,
				forkYear: b.forkYear ?? null,
				forkMonth: b.forkMonth ?? null,
				forkDay: b.forkDay ?? null
			}))
		]
	}
}

export const lorebookLinesHandler: Handler<
	Sockets.Lorebooks.Lines.Params,
	Sockets.Lorebooks.Lines.Response
> = refusable(
	"lorebooks:lines",
	async (socket, params: Sockets.Lorebooks.Lines.Params, emitToUser) => {
		await assertOwnedBook(db, socket.user!.id, params.lorebookId)
		const res = await bookLinesReply(params.lorebookId)
		emitToUser("lorebooks:lines", res)
		return res
	},
	"The book's lines could not be read."
)

/** The preflight's answer, for a proposed calendar, read through `handle`. */
async function preflight(handle: Db, lorebookId: number, calendar: unknown) {
	const problems = calendar === null ? [] : storyCalendarProblems(calendar)
	const stranded = problems.length
		? []
		: datesThatDoNotLand(
				await datedRowsOf(handle, lorebookId),
				readStoryCalendar(calendar)
			)
	return { problems, stranded }
}

export const lorebookCheckCalendarHandler: Handler<
	Sockets.Lorebooks.CheckCalendar.Params,
	Sockets.Lorebooks.CheckCalendar.Response
> = refusable(
	"lorebooks:checkCalendar",
	async (socket, params: Sockets.Lorebooks.CheckCalendar.Params, emitToUser) => {
		await assertOwnedBook(db, socket.user!.id, params.lorebookId)
		const { problems, stranded } = await preflight(
			db,
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
	},
	"The calendar could not be checked."
)

/**
 * Declare, change or clear the book's calendar.
 *
 * ⚠ **Refused while any dated row would not land** (§0, "Climbing a rung").
 * The author fixes them in place from the preflight list; the calendar never
 * re-dates a row on their behalf. Going back to free-form (`null`) always
 * passes: it keeps every part the author typed and only stops spelling and
 * stepping by the calendar — nothing stored is derived from it yet (no
 * `day_index`, no schedules; P2 and P4 are not built).
 *
 * ⚠ The preflight and the write are one transaction under the book's lock
 * (`lockBookCalendar`, A18(d)), which every dated write takes around its own
 * check and row: a date written between the two could not be listed and would
 * land outside the calendar.
 */
export const lorebookSetCalendarHandler: Handler<
	Sockets.Lorebooks.SetCalendar.Params,
	Sockets.Lorebooks.SetCalendar.Response
> = refusable(
	"lorebooks:setCalendar",
	async (socket, params: Sockets.Lorebooks.SetCalendar.Params, emitToUser) => {
		await assertOwnedBook(db, socket.user!.id, params.lorebookId)
		// Throws with every fault named; a malformed calendar is never repaired.
		const calendar = parseStoryCalendar(params.calendar ?? null)
		await db.transaction(async (tx) => {
			await lockBookCalendar(tx, params.lorebookId)
			const { stranded } = await preflight(tx, params.lorebookId, calendar)
			if (stranded.length)
				throw new Error(
					`${stranded.length} dated ${stranded.length === 1 ? "row does" : "rows do"} not fit this calendar: ` +
						stranded
							.slice(0, 5)
							.map((s) => `${s.label} (${s.problem})`)
							.join("; ") +
						(stranded.length > 5 ? "; …" : "")
				)
			await tx
				.update(schema.lorebooks)
				.set({ storyCalendar: calendar })
				.where(eq(schema.lorebooks.id, params.lorebookId))
		})
		const res = await storyTimeReply(params.lorebookId)
		emitToUser("lorebooks:setCalendar", res)
		return res
	},
	"The calendar could not be saved."
)

/**
 * Set or clear one line's clock. `branchId` null is main; `clock` null clears
 * it, and the line's now falls back to its newest history entry.
 */
export const lorebookSetClockHandler: Handler<
	Sockets.Lorebooks.SetClock.Params,
	Sockets.Lorebooks.SetClock.Response
> = refusable(
	"lorebooks:setClock",
	async (socket, params: Sockets.Lorebooks.SetClock.Params, emitToUser) => {
		await assertOwnedBook(db, socket.user!.id, params.lorebookId)
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
		const columns = clockColumns(clock)
		// Checked and written under the book's lock, as every dated write is
		// (`lockBookCalendar`).
		await db.transaction(async (tx) => {
			await lockBookCalendar(tx, params.lorebookId)
			if (clock) {
				const time = await readBookStoryTime(tx, params.lorebookId)
				const problem = clockProblem(clock, time.calendar)
				if (problem) throw new Error(problem)
			}
			if (branchId === null)
				await tx
					.update(schema.lorebooks)
					.set(columns)
					.where(eq(schema.lorebooks.id, params.lorebookId))
			else
				await tx
					.update(schema.lorebookBranches)
					.set(columns)
					.where(eq(schema.lorebookBranches.id, branchId))
		})
		const res = await storyTimeReply(params.lorebookId)
		emitToUser("lorebooks:setClock", res)
		return res
	},
	"The clock could not be set."
)

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
	register(socket, lorebookLinesHandler, emitToUser)
}
