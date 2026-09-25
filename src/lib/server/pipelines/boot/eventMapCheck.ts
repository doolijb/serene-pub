/**
 * The event map's two laws, run over what this instance installed
 * (PLAN-turn-order §B3, app side): C28 — every event a genre lists is
 * caused or a declared root — and C29 — every loop in a genre's event map
 * has a termination policy. The SDK owns both judgements
 * (`uncausedGenreEvents`, `unterminatedCycles`); this module supplies the
 * installed genres, the maps `eventMap` draws, and the host's termination
 * policies. Findings are boot warnings: a plugin genre that breaks a law
 * still loads, and the log says what will not fire or will not stop.
 */

import {
	eventById,
	sessionEvents,
	uncausedGenreEvents,
	unterminatedCycles
} from "@serene-pub/sdk"
import { listSessionGenres } from "$lib/server/pipelines/entities/sessionGenres"
import {
	AUTO_ADVANCE_LISTENER_ID,
	eventMap,
	type EventMap
} from "$lib/server/pipelines/entities/eventMap"
import { MAX_RUN_DEPTH } from "$lib/server/pipelines/runtime/lineage"
import { MAX_AUTO_ADVANCE_PER_SEND } from "$lib/server/sessions/autoAdvance"

/**
 * This host's termination policy for a node of the map, or undefined.
 *
 * Every data event a run causes is dispatched on that run's listener lane
 * (R65, `listenerLineage`), so a loop through it meets the cap on writes in
 * a row and parks the tree for the session owner. `turn-order-changed` is the exception: it is dispatched as
 * a fresh root, and the auto-advance listener that answers it stops the
 * loop by its own cause rule and cap. A spec has no policy of its own, and
 * plugin listeners cause nothing, so no loop passes through them.
 */
export function terminationOf(
	map: EventMap,
	id: string
): string | undefined {
	if (id === AUTO_ADVANCE_LISTENER_ID)
		return `fires only on a turn order it did not cause, at most ${MAX_AUTO_ADVANCE_PER_SEND} times since the last send`
	if (id === sessionEvents.turnOrderChanged) return undefined
	const node = map.nodes.find((n) => n.id === id)
	if (node?.kind === "event" && eventById(id)?.family === "data")
		return `dispatched on its run's listener lane: at most ${MAX_RUN_DEPTH} writes in a row answering their own events, then the tree waits for the session owner`
	return undefined
}

/** Every C28 and C29 finding over the installed genres, as log lines. */
export async function eventMapFindings(db: Db): Promise<string[]> {
	const out: string[] = []
	for (const g of await listSessionGenres(db)) {
		for (const f of uncausedGenreEvents({ id: g.genreId, events: g.events }))
			out.push(`C28 ${f.sentence}`)
		const map = await eventMap(db, { genreId: g.genreId })
		for (const f of unterminatedCycles(map, (id) => terminationOf(map, id)))
			out.push(`C29 genre '${g.genreId}': ${f.sentence}`)
	}
	return out
}
