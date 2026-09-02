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
	 * Record an event.
	 *
	 * Merged onto whatever is already there rather than replacing it: a progress
	 * event carries only what changed, so an event with no `label` must not erase
	 * the one the run started with — which is what makes the card's title flicker
	 * and vanish mid-render.
	 *
	 * A terminal event removes the run instead of storing it. There is nothing to
	 * show about a run that is over, and leaving it would need every consumer to
	 * remember to filter `done` out.
	 */
	apply(event: RunProgress): void {
		if (!event?.runId) return
		if (event.done || event.error) {
			runs.delete(event.runId)
			return
		}
		runs.set(event.runId, { ...(runs.get(event.runId) ?? {}), ...event })
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

	clearAll(): void {
		runs.clear()
	}
}
