/**
 * What is running right now, and how far along.
 *
 * One store for every long pipeline run, keyed by run id, because progress is the
 * same fact whatever produced it — an image render, a graph build, a summarize
 * pass. The alternative is a store per feature and a progress bar per feature,
 * which is how the codebase ended up with two different progress conventions
 * before this.
 *
 * `SvelteMap`, not `$state(new Map())`: a plain Map inside `$state` is reactive
 * on *reassignment* only, so `.set()` and `.delete()` update nothing and the card
 * never moves. Learned the hard way; see the same note on the Set/Map rune trap.
 */

import { SvelteMap } from "svelte/reactivity"
import type { RunProgress } from "$lib/shared/sockets/progress"

const runs = new SvelteMap<string, RunProgress>()

/**
 * The run that most recently ended in each session — its terminal frame
 * merged onto everything the run had reported — so a card can still offer
 * the receipt after the store has forgotten the run.
 *
 * Held HERE rather than in the card that shows it, because two subscribers
 * take the same frames off the wire (the session page and the progress card
 * both `apply` them) and whichever runs first deletes the run. A card that
 * read the store at its own turn found nothing and titled the receipt
 * "Working" (2026-09-17). Recording the merge in the one place both go
 * through makes the answer the same whoever applied the frame first, and a
 * second application of the same terminal frame a no-op.
 */
const finished = new SvelteMap<number, RunProgress>()

export const runProgress = {
	/** Every run currently in flight, newest last. */
	get all(): RunProgress[] {
		return [...runs.values()]
	},

	/** The runs belonging to one session — what a session view should show. */
	forSession(sessionId: number | null | undefined): RunProgress[] {
		if (sessionId == null) return []
		return [...runs.values()].filter((r) => r.sessionId === sessionId)
	},

	get(runId: string): RunProgress | undefined {
		return runs.get(runId)
	},

	/**
	 * The run that ended most recently in this session, as its terminal frame
	 * left it — `label` from the frame that started it where the terminal one
	 * carried none — or undefined when nothing has ended since the last
	 * `started` / `clearAll`.
	 */
	lastFinished(
		sessionId: number | null | undefined
	): RunProgress | undefined {
		if (sessionId == null) return undefined
		return finished.get(sessionId)
	},

	/**
	 * Record an event.
	 *
	 * Merged onto whatever is already there rather than replacing it: a progress
	 * event carries only what changed, so an event with no `label` must not erase
	 * the one the run started with — which is what makes the card's title flicker
	 * and vanish mid-render.
	 *
	 * A terminal event removes the run instead of storing it. There is nothing to
	 * show about a run that is over, and leaving it would need every consumer to
	 * remember to filter `done` out. What it knew is kept once, under the
	 * session, as `lastFinished`.
	 */
	apply(event: RunProgress): void {
		if (!event?.runId) return
		if (event.done || event.error) {
			const known = runs.get(event.runId)
			const sessionId = event.sessionId ?? known?.sessionId
			// The same terminal frame applied a second time finds the run gone
			// and reads what the first application kept, so the label survives.
			const prior =
				sessionId != null ? finished.get(sessionId) : undefined
			const base =
				known ?? (prior?.runId === event.runId ? prior : undefined)
			runs.delete(event.runId)
			if (sessionId == null) return
			// Only what the card reads of a finished run — its key, title,
			// outcome, reason and where it halted. The last preview frame is a
			// whole image and the last status was about a node that is over;
			// neither is kept.
			const {
				preview: _preview,
				status: _status,
				...kept
			} = { ...(base ?? {}), ...event }
			finished.set(sessionId, {
				...kept,
				sessionId,
				label: event.label ?? base?.label
			})
			return
		}
		runs.set(event.runId, { ...(runs.get(event.runId) ?? {}), ...event })
	},

	/**
	 * A run has started: what last ended in its session yields to it, then the
	 * frame is applied like any other. The card's "just ended" receipt is about
	 * the question still being asked; a new run in the same session answers it.
	 */
	started(event: RunProgress): void {
		if (event?.sessionId != null) finished.delete(event.sessionId)
		this.apply(event)
	},

	/**
	 * Forget a run without waiting for the server to say it ended.
	 *
	 * For the case where the socket dropped mid-run: the client will never hear
	 * the terminal event, and a card that cannot be dismissed is worse than one
	 * that disappears a little early.
	 */
	clear(runId: string): void {
		runs.delete(runId)
	},

	/** Forget what ended in a session — the card's Dismiss. */
	dismissFinished(sessionId: number): void {
		finished.delete(sessionId)
	},

	clearAll(): void {
		runs.clear()
		finished.clear()
	}
}
