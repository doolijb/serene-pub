/**
 * The **cap pause** (E1c; PLAN-sdk-1.0 §3.2 *Loops*): a run tree held at a
 * cycle cap for the session owner to decide.
 *
 * A write can cause an event, and a pipeline bound to that event can write
 * again, so a tree of runs can loop: A records, B answers and records, A
 * answers… The cycle caps (`lineage.ts`) bound every tree, and at a session
 * event's door the next run does not start past one. It **parks** here
 * instead, and the session owner is asked:
 *
 *  - **Continue** grants the tree one more window of each cap
 *    (`grantWindow`) and dispatches the parked run on the session's queue.
 *  - **Cancel** ends the tree there: the parked run's receipt is written as
 *    `cancelled`, naming who stopped it and the cap it stood at.
 *
 * Nothing auto-continues: with nobody present the pause waits, and waiting
 * is free (F13). A pause holds its tree open (`openBranch`), so the count it
 * would continue from is still there when the owner answers.
 *
 * ⚠ Not a **review** (`reviewGate.ts`): a review holds one node's write for
 * the run's owner and can edit its payload; a cap pause holds a whole run
 * that has not started, for the session's owner, and has two answers. They
 * share the push transport (`sockets/pipelines.ts`), which is why both push
 * by user.
 *
 * Like the review gate's parking, a pause is **in memory**: it does not
 * survive a restart, and a tree whose pause was lost ends there, as if
 * cancelled, with no receipt.
 */

import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	closeBranch,
	grantWindow,
	openBranch,
	type LaneLineage,
	type RunLineage
} from "$lib/server/pipelines/runtime/lineage"

/** What the session owner is shown. */
export interface CapPauseView {
	id: string
	sessionId: number
	/** The event whose bound pipeline would run next. */
	event: string
	/** The pipeline that would run next. */
	specSlug: string
	/** The runs so far by pipeline name, root first, then the one that would run: `A → B → A`. */
	chain: string[]
	/** The cap's sentence. */
	cap: string
	depth: number
	/** How many runs of this tree are parked on this one pause (at least 1). */
	waiting: number
	requestedAt: number
}

/** One run a cap refused, parked on its tree's pause. */
interface ParkedRun {
	/** The user the parked run would run as. */
	userId: number
	specSlug: string
	lineage: RunLineage
	cap: string
	/** Dispatch the parked run again, on the session's queue. */
	redispatch: () => void
}

/**
 * One pause per run tree: every run of the tree a cap refuses while the owner
 * has not answered waits on the same pause, so one Continue grants one
 * window to all of them and one Stop here ends the tree.
 */
interface Held {
	view: CapPauseView
	ownerId: number
	rootRunId: string
	parked: ParkedRun[]
}

const HELD_KEY = Symbol.for("serene-pub.capPauses")
const held = ((globalThis as Record<symbol, unknown>)[HELD_KEY] ??= new Map<
	string,
	Held
>()) as Map<string, Held>

/** Root run id → the pause being made or held for it, so a tree gets exactly one. */
const BY_ROOT_KEY = Symbol.for("serene-pub.capPausesByRoot")
const byRoot = ((globalThis as Record<symbol, unknown>)[BY_ROOT_KEY] ??=
	new Map<string, Promise<Held | null>>()) as Map<
	string,
	Promise<Held | null>
>

/**
 * Which spec each dispatched child ran, by run id, so a pause can name its
 * chain before every run in it has saved a receipt: a child a write caused
 * dispatches while its parent is still running. `runSpec` notes every root
 * too. Held to the size bound below, oldest out.
 */
const NOTED_KEY = Symbol.for("serene-pub.capPauseRuns")
const noted = ((globalThis as Record<symbol, unknown>)[NOTED_KEY] ??= new Map<
	string,
	{ spec: string; parent?: string }
>()) as Map<string, { spec: string; parent?: string }>
const MAX_NOTED = 4096

/** Record which spec a dispatched run is, and its parent, for the chain. */
export function noteRun(runId: string, spec: string, parent?: string): void {
	if (noted.size >= MAX_NOTED) noted.delete(noted.keys().next().value!)
	noted.set(runId, { spec, parent })
}

type Push = (userId: number, event: string, data: unknown) => void
/** On `globalThis`, like the maps: a Vite SSR reload must not leave pauses with no way to reach anyone. */
const PUSH_KEY = Symbol.for("serene-pub.capPausePush")
const pushToUser = (userId: number, event: string, data: unknown) =>
	((globalThis as Record<symbol, unknown>)[PUSH_KEY] as Push | undefined)?.(
		userId,
		event,
		data
	)

/** The push transport, installed once from the socket layer (shared with the review gate). */
export function setCapPauseTransport(push: Push): void {
	;(globalThis as Record<symbol, unknown>)[PUSH_KEY] = push
}

/**
 * The chain a parked run stands at the end of, root first: from memory for
 * the runs dispatched in this process, from `pipeline_runs` for the rest.
 */
async function chainOf(
	db: Db,
	lineage: RunLineage,
	next: string
): Promise<string[]> {
	// Walked parent by parent: from memory for a child this process
	// dispatched (its row may not be saved yet), from its row otherwise (an
	// action's fire, a root). Human-paced, and bounded by the depth.
	const slugs: Array<string | undefined> = []
	let cur: string | undefined = lineage.parentRunId
	// A listener-lane run (R65) keeps its parent's depth and counts its own
	// hops as `echo`, so the chain it stands at the end of is depth + echo
	// long — bounded by depth alone, an echo park showed only its start.
	const hops = lineage.depth + ((lineage as LaneLineage).echo ?? 0)
	for (let i = 0; cur && i <= hops; i++) {
		let step = noted.get(cur)
		if (!step) {
			const [row] = await db
				.select({
					specSlug: schema.pipelineRuns.specSlug,
					parentRunId: schema.pipelineRuns.parentRunId
				})
				.from(schema.pipelineRuns)
				.where(eq(schema.pipelineRuns.runId, cur))
				.limit(1)
			step = row
				? { spec: row.specSlug, parent: row.parentRunId ?? undefined }
				: undefined
		}
		slugs.unshift(step?.spec)
		cur = cur === lineage.rootRunId ? undefined : step?.parent
	}
	slugs.push(next)
	// Named as the person knows them: the pipeline's name, not its slug.
	const known = slugs.filter((x): x is string => !!x)
	const named = known.length
		? await db
				.select({
					slug: schema.pipelineSpecs.slug,
					name: schema.pipelineSpecs.name
				})
				.from(schema.pipelineSpecs)
				.where(inArray(schema.pipelineSpecs.slug, known))
		: []
	const names = new Map(named.map((r) => [r.slug, r.name]))
	return slugs.map((x) => (x ? (names.get(x) ?? x) : "an earlier run"))
}

/**
 * Park a run a cap refused, for the session owner. A tree that already has a
 * pause waiting gets this run added to it, not a second pause. Returns the
 * pause, or null when the session has no owner to ask — then the caller
 * refuses as it always has.
 */
export async function parkAtCap(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		event: string
		specSlug: string
		lineage: RunLineage
		cap: string
		redispatch: () => void
	}
): Promise<CapPauseView | null> {
	const root = opts.lineage.rootRunId
	const run: ParkedRun = {
		userId: opts.userId,
		specSlug: opts.specSlug,
		lineage: opts.lineage,
		cap: opts.cap,
		redispatch: opts.redispatch
	}
	const making = byRoot.get(root)
	if (making) {
		const h = await making
		// Still waiting on the owner: join it. (Answered meanwhile: fall
		// through and ask again — the answer was for the runs it knew of.)
		if (h && held.has(h.view.id)) {
			openBranch(root)
			h.parked.push(run)
			h.view = { ...h.view, waiting: h.parked.length }
			pushToUser(h.ownerId, "pipelines:capPauseRequested", h.view)
			return h.view
		}
	}
	const made = (async (): Promise<Held | null> => {
		const [session] = await db
			.select({ ownerId: schema.sessions.userId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, opts.sessionId))
			.limit(1)
		if (!session?.ownerId) return null
		const h: Held = {
			view: {
				id: randomUUID(),
				sessionId: opts.sessionId,
				event: opts.event,
				specSlug: opts.specSlug,
				chain: await chainOf(db, opts.lineage, opts.specSlug),
				cap: opts.cap,
				// Hops under the root, listener-lane hops included (R65).
				depth: opts.lineage.depth + ((opts.lineage as LaneLineage).echo ?? 0),
				waiting: 1,
				requestedAt: Date.now()
			},
			ownerId: session.ownerId,
			rootRunId: root,
			parked: [run]
		}
		openBranch(root)
		held.set(h.view.id, h)
		pushToUser(h.ownerId, "pipelines:capPauseRequested", h.view)
		return h
	})()
	byRoot.set(root, made)
	const h = await made
	if (!h && byRoot.get(root) === made) byRoot.delete(root)
	return h?.view ?? null
}

/** Everything held for this person, oldest first. */
export function pendingCapPausesFor(userId: number): CapPauseView[] {
	return [...held.values()]
		.filter((h) => h.ownerId === userId)
		.map((h) => h.view)
		.sort((a, b) => a.requestedAt - b.requestedAt)
}

export class CapPauseNotFoundError extends Error {}

/** Take a pause out of the store, closing each parked run's branch after `each`. */
async function release(
	h: Held,
	each: (run: ParkedRun) => Promise<void> | void
): Promise<void> {
	held.delete(h.view.id)
	if (byRoot.get(h.rootRunId) && (await byRoot.get(h.rootRunId)) === h)
		byRoot.delete(h.rootRunId)
	try {
		for (const run of h.parked) {
			try {
				await each(run)
			} finally {
				closeBranch(h.rootRunId)
			}
		}
	} finally {
		pushToUser(h.ownerId, "pipelines:capPauseClosed", { id: h.view.id })
	}
}

/**
 * The session owner's answer. `continue` grants the tree one window and
 * dispatches every run parked on the pause; `cancel` receipts each as
 * stopped. Either way the pause is gone, and every tab the owner has open is
 * told. Ownership is read again now, not trusted from when the run parked:
 * a pause on a session that is gone is dropped, and one whose session
 * changed hands is its new owner's to answer.
 */
export async function resolveCapPause(
	db: Db,
	id: string,
	userId: number,
	action: "continue" | "cancel"
): Promise<void> {
	const h = held.get(id)
	// Someone else's pause reads as missing, so its existence is not disclosed.
	if (!h || h.ownerId !== userId)
		throw new CapPauseNotFoundError("That pause is no longer waiting.")
	// Taken synchronously, before any await, so a second tab's answer finds nothing.
	held.delete(id)
	const [session] = await db
		.select({ ownerId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, h.view.sessionId))
		.limit(1)
	if (!session) {
		await release(h, () => {})
		throw new CapPauseNotFoundError(
			"That session no longer exists; nothing more will run."
		)
	}
	if (session.ownerId !== userId) {
		held.set(id, { ...h, ownerId: session.ownerId })
		pushToUser(h.ownerId, "pipelines:capPauseClosed", { id })
		pushToUser(session.ownerId, "pipelines:capPauseRequested", h.view)
		throw new CapPauseNotFoundError("That pause is no longer waiting.")
	}
	if (action === "continue") {
		grantWindow(h.rootRunId)
		await release(h, (run) => run.redispatch())
		return
	}
	const { refusalReceipt } = await import(
		"$lib/server/pipelines/runtime/sessionEvents"
	)
	await release(h, async (run) => {
		await refusalReceipt(db, {
			runId: randomUUID(),
			specId: run.specSlug,
			sessionId: h.view.sessionId,
			userId: run.userId,
			lineage: run.lineage,
			outcome: "cancelled",
			cancelledBy: `user:${userId}`,
			reason: `stopped at the cycle cap by the session owner — ${run.cap}`
		})
	})
}

/** Test seam. */
export function _resetCapPauses(): void {
	held.clear()
	byRoot.clear()
	noted.clear()
}
