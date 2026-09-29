/**
 * The open book's story time — its declared calendar and its clocks — for
 * every date the workspace spells.
 *
 * One book is open at a time, and ~25 places spell a date (the history list,
 * the moment bar, amendments, presences, the Time and Lives lenses). Threading
 * the calendar through each of them as a prop would be the same value handed
 * down twenty-five paths; `historyDates.formatDate` reads it from here instead,
 * so a date spelled anywhere in the workspace is spelled through the book's
 * calendar with no call site knowing.
 *
 * ⚠ Spelling only. Nothing here orders: `compareDates` takes no calendar.
 *
 * Filled by `LorebooksWorkspace` from the `lorebooks:storyTime` family (every
 * reply is the whole book's story time), and reset when another book opens so
 * one book's calendar can never spell another's dates.
 */
import type { StoryCalendar } from "$lib/shared/lorebooks/storyDate"
import { lineOf, type Line } from "$lib/shared/lorebooks/lineReading"

type Clocks = Sockets.Lorebooks.BookStoryTime["clocks"]
type Clock = Sockets.Lorebooks.StoryClock

const NO_CLOCKS: Clocks = { main: null, branches: [] }

class OpenBookTime {
	lorebookId = $state<number | null>(null)
	calendar = $state.raw<StoryCalendar | null>(null)
	clocks = $state.raw<Clocks>(NO_CLOCKS)
	/**
	 * The open book's lines (`amendments:list`), so a screen that draws an
	 * amendment can name its line and read the ancestor chain without being
	 * handed the list through every component between.
	 */
	branches = $state.raw<readonly Sockets.Amendments.Branch[]>([])

	/** A book opened (or closed, with null): forget the last one's time. */
	open(lorebookId: number | null) {
		if (lorebookId === this.lorebookId) return
		this.lorebookId = lorebookId
		this.calendar = null
		this.clocks = NO_CLOCKS
		this.branches = []
	}

	/** The book's lines, from its amendments list; a stale book's is ignored. */
	setBranches(
		lorebookId: number,
		branches: readonly Sockets.Amendments.Branch[]
	) {
		if (lorebookId !== this.lorebookId) return
		this.branches = branches
	}

	/** The line being read (`null` = main), with its ancestor chain. */
	lineOf(branchId: number | null | undefined): Line {
		return lineOf(branchId ?? null, this.branches)
	}

	/** A line's name: `main`, a branch's name, or "a deleted line". */
	lineName(branchId: number | null | undefined): string {
		if (branchId == null) return "main"
		return this.branches.find((b) => b.id === branchId)?.name ?? "a deleted line"
	}

	/** Any reply of the family; a stale book's is ignored. */
	apply = (msg: Sockets.Lorebooks.BookStoryTime) => {
		if (msg.lorebookId !== this.lorebookId) return
		this.calendar = msg.calendar
		this.clocks = msg.clocks
	}

	/** The stored clock on one line (`null` = main), or null when none is. */
	clockOn(branchId: number | null | undefined): Clock | null {
		if (branchId == null) return this.clocks.main
		return (
			this.clocks.branches.find((b) => b.branchId === branchId)?.clock ?? null
		)
	}
}

export const openBookTime = new OpenBookTime()
