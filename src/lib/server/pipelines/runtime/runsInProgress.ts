/**
 * 🚧 **Runs in progress** — what the session page
 * is told about every registered run, and what the server's door reads to
 * hold re-run and remove actions.
 *
 * One source: the run registry. A run's frame (`sessions:runStatus`) carries
 * its shown **name**, **since**, the line that caused it (**readsMessageId**),
 * whether it waits at review (**parked**) and whether the hearer may stop it
 * (**mayStop**); the session's first page carries every run in progress as
 * the same frames (`runsInProgressFor`). No second channel.
 *
 * What holds what is the shared rule (`$lib/shared/sessions/runsInProgress`):
 * the page greys the held buttons with the sentence the door refuses with.
 * Names are names a person knows — a routine's label, an action's shown name,
 * the pipeline's shown name — never a model, connection, loadout or prompt.
 */

import { eq } from "drizzle-orm"
import type { StatusText } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import type { RunHandle } from "$lib/server/pipelines/runtime/runRegistry"
import { membersMayStopRun, personMay, type ActingPerson } from "$lib/server/auth/actingPerson"
import { routineRunOf } from "$lib/server/pipelines/routines/runs"
import type { RunStatusFrame } from "$lib/server/pipelines/runtime/runStatus"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import {
	REPLY_RUN_NAME,
	RUN_WORKING_WORDS,
	runHoldsReruns,
	waitForRunSentence
} from "$lib/shared/sessions/runsInProgress"

// db is the global Db — see db/types.d.ts

/** The facts a frame carries about its run, beyond status and kind. */
export interface RunFrameFacts {
	name?: string
	since?: number
	readsMessageId?: number
	parked?: true
	mayStop?: boolean
}

/** Pipeline shown names by slug, per process; a miss is never kept. */
const specNames = new Map<string, string>()

/**
 * The name a run is shown by. The handle's own name; else a routine's; else
 * `REPLY_RUN_NAME` for a reply; else the pipeline's shown name; else its id.
 */
export async function runShownName(db: Db, handle: RunHandle): Promise<string> {
	if (handle.name) return handle.name
	const routine = routineRunOf(handle.runId)?.shownAs?.name
	if (routine) return routine
	if (handle.kind === "reply") return REPLY_RUN_NAME
	const slug = handle.specId
	if (slug) {
		const cached = specNames.get(slug)
		if (cached) return cached
		try {
			const [row] = await db
				.select({ name: schema.pipelineSpecs.name })
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, slug))
				.limit(1)
			if (row?.name) {
				specNames.set(slug, row.name)
				return row.name
			}
		} catch {
			// The id says it.
		}
		return slug
	}
	return handle.kind === "routine" ? "the routine" : "the action"
}

/**
 * The facts a run's frame carries, read off its registry handle; `{}` for a
 * run the registry does not hold (a preview, a run never registered). `since`
 * is present exactly on registered runs. `mayStop` is what EVERY person who
 * hears the frame may do (`membersMayStopRun`: every hearer of a session
 * broadcast is a member).
 */
export async function runFrameFacts(
	db: Db,
	runId: string
): Promise<RunFrameFacts> {
	const handle = runRegistry.active().find((h) => h.runId === runId)
	if (!handle) return {}
	return factsOf(
		handle,
		await runShownName(db, handle),
		membersMayStopRun(handle)
	)
}

function factsOf(
	handle: RunHandle,
	name: string,
	mayStop: boolean
): RunFrameFacts {
	return {
		name,
		since: handle.startedAt,
		...(handle.readsMessageId !== undefined
			? { readsMessageId: handle.readsMessageId }
			: {}),
		...(handle.parked ? { parked: true as const } : {}),
		mayStop
	}
}

/**
 * The first registered run of the session that holds re-run and remove
 * actions, oldest first; an aborted run (stopped, not yet finished) holds
 * nothing.
 */
export function heldBy(sessionId: number): RunHandle | undefined {
	return runRegistry
		.active()
		.filter(
			(h) =>
				h.sessionId === sessionId &&
				!h.controller.signal.aborted &&
				runHoldsReruns({
					kind: h.kind,
					since: h.startedAt,
					lineBound: h.lineBound,
					parked: h.parked
				})
		)
		.sort((a, b) => a.startedAt - b.startedAt)[0]
}

/** The sentence a held action is refused with, or null when nothing holds it. */
export async function quietRefusal(
	db: Db,
	sessionId: number
): Promise<string | null> {
	const held = heldBy(sessionId)
	return held ? waitForRunSentence(await runShownName(db, held)) : null
}

/** The frames' name for `personMay`'s `run` rule: may this person stop this run? */
export async function mayStopRun(db: Db, runId: string, person: ActingPerson): Promise<boolean> {
	return (await personMay(db, person, "write", { kind: "run", runId })).ok
}

/**
 * Every run of the session a page should show, as its current frame with
 * `mayStop` for this viewer — the session's first page. A routine shows once
 * it has been shown (`shownAs`); any other run once it has a status, waits
 * at review or holds re-run actions.
 */
export async function runsInProgressFor(
	db: Db,
	sessionId: number,
	viewerUserId: number
): Promise<RunStatusFrame[]> {
	const handles = runRegistry
		.active()
		.filter(
			(h) => h.sessionId === sessionId && !h.controller.signal.aborted
		)
		.filter((h) =>
			h.kind === "routine"
				? !!routineRunOf(h.runId)?.shownAs
				: !!h.status ||
					h.parked === true ||
					runHoldsReruns({
						kind: h.kind,
						since: h.startedAt,
						lineBound: h.lineBound,
						parked: h.parked
					})
		)
		.sort((a, b) => a.startedAt - b.startedAt)
	if (!handles.length) return []
	const [viewerRow] = await db
		.select({ isAdmin: schema.users.isAdmin })
		.from(schema.users)
		.where(eq(schema.users.id, viewerUserId))
		.limit(1)
	// The first page is served only to a member of the session.
	const viewer: ActingPerson = {
		userId: viewerUserId,
		isAdmin: viewerRow?.isAdmin === true,
		via: "view"
	}
	const frames: RunStatusFrame[] = []
	for (const handle of handles) {
		const name = await runShownName(db, handle)
		const status: StatusText = handle.status ?? {
			i18n: { en: RUN_WORKING_WORDS }
		}
		frames.push({
			sessionId,
			runId: handle.runId,
			status,
			kind: handle.kind,
			...(handle.lineBound ? { lineBound: true as const } : {}),
			...(handle.kind === "routine" ? { routine: { name } } : {}),
			...factsOf(handle, name, await mayStopRun(db, handle.runId, viewer))
		})
	}
	return frames
}

/** Where a run's frames go: noted by whoever sends its frames, dropped when the run ends. */
const notes = new Map<
	string,
	{ io: SessionIo; sessionId: number; db: Db; announced?: true }
>()

/** Note the socket server a run's frames leave on, so a park can announce it (`announceRun`). */
export function noteRunIo(
	runId: string,
	note: { io: SessionIo; sessionId: number; db: Db }
): void {
	if (!note.io) return
	// Notes of runs that left the registry are dropped here, so none outlives its run.
	if (notes.size >= 64) {
		const live = new Set(runRegistry.active().map((h) => h.runId))
		for (const id of notes.keys()) if (!live.has(id)) notes.delete(id)
	}
	notes.set(runId, note)
}

/**
 * Drop a run's note: its relay ended or the run finished. True when the run
 * was announced (`announceRun`) — the page holds a frame for it that only an
 * end frame clears, whether or not a status ever showed.
 */
export function forgetRunIo(runId: string): boolean {
	const announced = notes.get(runId)?.announced === true
	notes.delete(runId)
	return announced
}

/**
 * Send this run's current frame now — a park or an unpark changes what the
 * page shows without a status changing. A no-op for a run that finished or
 * has no noted socket server (a preview, a test).
 */
export function announceRun(runId: string): Promise<void> {
	// One at a time, in call order: a park's frame never lands after the unpark's.
	return (announceChain = announceChain.then(() => announceNow(runId)))
}

let announceChain: Promise<void> = Promise.resolve()

async function announceNow(runId: string): Promise<void> {
	const note = notes.get(runId)
	const handle = runRegistry.active().find((h) => h.runId === runId)
	if (!note || !handle) {
		notes.delete(runId)
		return
	}
	try {
		note.announced = true
		const name = await runShownName(note.db, handle)
		if (handle.kind === "routine" && handle.parked) {
			// A parked routine shows as waiting even if it parked before it was shown.
			const fact = routineRunOf(runId)
			if (fact && !fact.shownAs) fact.shownAs = { name }
		}
		const frame: RunStatusFrame = {
			sessionId: note.sessionId,
			runId,
			status: handle.status ?? { i18n: { en: RUN_WORKING_WORDS } },
			kind: handle.kind,
			...(handle.lineBound ? { lineBound: true as const } : {}),
			...(handle.kind === "routine" ? { routine: { name } } : {}),
			...factsOf(
				handle,
				name,
				membersMayStopRun(handle)
			)
		}
		const { broadcastToSessionUsers } = await import(
			"$lib/server/sockets/utils/broadcastHelpers"
		)
		await broadcastToSessionUsers(
			note.io!,
			note.sessionId,
			"sessions:runStatus",
			frame
		)
	} catch {
		// A frame that did not go out is not the run's failure.
	}
}
