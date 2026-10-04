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
 *
 * The class is the session side's too (plan B6): a session tab reading its
 * own book — which need not be the one open in the workspace — holds a
 * `BookTime` of its own and `listen`s it to that book: the story time family
 * and the book's lines (`lorebooks:lines`), and nothing else. It asked for
 * the whole `amendments:list` for the line names before.
 */
import { untrack } from "svelte"
import type { StoryCalendar } from "$lib/shared/lorebooks/storyDate"
import { lineOf, type Line } from "$lib/shared/lorebooks/lineReading"
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import { interestKey } from "$lib/shared/sockets/interest"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"

type Clocks = Sockets.Lorebooks.BookStoryTime["clocks"]
type Clock = Sockets.Lorebooks.StoryClock

const NO_CLOCKS: Clocks = { main: null, branches: [] }

export class BookTime {
	lorebookId = $state<number | null>(null)
	calendar = $state.raw<StoryCalendar | null>(null)
	clocks = $state.raw<Clocks>(NO_CLOCKS)
	/** Each line's present, as the server reads it; null until it arrives. */
	presents = $state.raw<Sockets.Lorebooks.BookStoryTime["presents"] | null>(
		null
	)
	/** Whether the story time and the lines have arrived for the book. */
	timeLoaded = $state(false)
	linesLoaded = $state(false)
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
		this.presents = null
		this.branches = []
		this.timeLoaded = false
		this.linesLoaded = false
	}

	/** The book's lines, from its amendments list; a stale book's is ignored. */
	setBranches(
		lorebookId: number,
		branches: readonly Sockets.Amendments.Branch[]
	) {
		if (lorebookId !== this.lorebookId) return
		this.branches = branches
		this.linesLoaded = true
	}

	/** The book's lines (`lorebooks:lines`); a stale book's is ignored. */
	applyLines = (msg: Sockets.Lorebooks.Lines.Response) => {
		if (msg.lorebookId !== this.lorebookId) return
		this.setBranches(
			msg.lorebookId,
			msg.lines
				.filter((line) => line.id != null)
				.map((line) => ({
					id: line.id as number,
					lorebookId: msg.lorebookId,
					name: line.name,
					forkedFromBranchId: line.forkedFromBranchId,
					forkYear: line.forkYear,
					forkMonth: line.forkMonth,
					forkDay: line.forkDay
				}))
		)
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
		if (msg.presents) this.presents = msg.presents
		this.timeLoaded = true
	}

	/**
	 * Turn this reader to `lorebookId` and keep it current: the story time
	 * family and the book's lines, SCOPED to the book, then one read of each
	 * (the keys are declared first; the typed `emit` flushes their sync ahead
	 * of the requests). Returns the release — for an `$effect` keyed on the
	 * book. The workspace's own `openBookTime` is filled by the workspace and
	 * never listened this way.
	 */
	listen(socket: Pick<TypedSocket, "emit">, lorebookId: number): () => void {
		// Untracked: called from an effect, and `open` reads the state it
		// writes — tracked, the effect would re-run on its own write and ask
		// twice.
		untrack(() => this.open(lorebookId))
		const releases = [
			...(
				[
					"lorebooks:storyTime",
					"lorebooks:setCalendar",
					"lorebooks:setClock"
				] as const
			).map((event) =>
				declareInterest<typeof event>(interestKey(event, lorebookId), this.apply)
			),
			declareInterest<"lorebooks:lines">(
				interestKey("lorebooks:lines", lorebookId),
				this.applyLines
			)
		]
		socket.emit("lorebooks:storyTime", { lorebookId })
		socket.emit("lorebooks:lines", { lorebookId })
		return () => {
			for (const release of releases) release()
		}
	}

	/** The stored clock on one line (`null` = main), or null when none is. */
	clockOn(branchId: number | null | undefined): Clock | null {
		if (branchId == null) return this.clocks.main
		return (
			this.clocks.branches.find((b) => b.branchId === branchId)?.clock ?? null
		)
	}
}

export const openBookTime = new BookTime()
