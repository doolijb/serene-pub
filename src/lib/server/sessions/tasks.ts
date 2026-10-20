/**
 * 🚧 **Background tasks, resolved for one session** (PLAN-genre-restructure
 * §4, ruled 2026-10-19). The genre declares the tasks, the preset pins the
 * defaults, the session stores its own `tasks` field; the SDK's
 * `resolveTasks` merges the three. What this adds is the **when**: the turn
 * just completed, whether a sweep is due, whether the round has ended (the
 * owner's "wait for everyone's reply before running"), and a `due` flag per
 * task. The genre's pipeline reads the result through
 * `core:task/resolve-tasks@1` and branches on it — one pipeline, never one
 * per toggle.
 */
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { resolveTasks, taskDue, type ResolvedTask, type TaskDecl, type TaskGroup } from "@serene-pub/sdk"
import { genreFieldsFor, getSessionGenre, presetPinnedSettings, STANDARD_GENRE_ID } from "$lib/server/pipelines/entities/sessionGenres"

export interface SessionTasksResolved {
	/** The turn just completed, counted as the model's replies on `main` (1-based). */
	turn: number
	/** The round has ended with this reply: nothing else is prepared to speak. */
	roundEnded: boolean
	/** Whether anything in the after-turn group runs now. */
	reckoning: boolean
	/** Whether the batched every-N call runs now. */
	sweep: boolean
	tasks: Array<ResolvedTask & { due: boolean }>
	/** The sweep's shared frequency and whether the after-turn groups wait for the round. */
	sweepEvery: number | "scene"
	waitForRound: boolean
	/** The ruleset's scripts resolve what they can (rigour `scripts`). */
	scripts: boolean
	/** The modes by key, for a prompt to read in one place. */
	modes: Record<string, "full" | "review" | "off">
}

/**
 * Tasks that write a lorebook: Off when the session has none (lane 1 §5-1).
 * Not Chat's `memory` (★K, lane 2): it files into a notes lorebook it
 * creates on first use, so a session with no book is where it starts.
 */
const LOREBOOK_TASKS: ReadonlySet<string> = new Set(["summary", "lore", "cast", "scenes", "world-state", "places-on-move"])

/**
 * 🚧 Event-group tasks the after-turn reckoning notices (lane 2,
 * 2026-10-19): *Describe new places* reads a move off the reply in the same
 * call, so the reckoning runs when it is on even with every reckoning task
 * Off.
 */
const RIDES_RECKONING: ReadonlySet<string> = new Set(["places-on-move"])

/** The upcoming turn order as stored (canon A9: who speaks is state). */
function orderOf(metadata: unknown): unknown[] {
	const m = metadata as { turnOrder?: { order?: unknown[] } } | null
	return Array.isArray(m?.turnOrder?.order) ? m!.turnOrder!.order! : []
}

/**
 * 🚧 The session's task modes alone, by key — what a host handler reads to
 * obey a task without the turn arithmetic (lane 2, 2026-10-19: the ruleset
 * handler's timed expiry, the tools that file into a lorebook). Only the
 * genre's declared tasks appear: a key absent here is a task the genre does
 * not have, and its reader keeps its old behaviour.
 */
export async function sessionTaskModes(db: Db, sessionId: number): Promise<SessionTasksResolved["modes"]> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId, presetId: schema.sessions.presetId, lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return {}
	const genre = await getSessionGenre(db, session.genreId ?? STANDARD_GENRE_ID)
	const decls = ((genre as any)?.tasks ?? []) as TaskDecl[]
	if (!decls.length) return {}
	const [fields, pinned] = await Promise.all([genreFieldsFor(db, sessionId), presetPinnedSettings(db, session.presetId)])
	const modes: SessionTasksResolved["modes"] = {}
	for (const t of resolveTasks(decls, fields.tasks, pinned?.tasks))
		modes[t.key] = session.lorebookId == null && LOREBOOK_TASKS.has(t.key) ? "off" : t.mode
	return modes
}

export async function resolveSessionTasks(
	db: Db,
	sessionId: number,
	opts: { sceneBoundary?: boolean; ruleset?: { rigour?: string } | null } = {}
): Promise<SessionTasksResolved> {
	const empty: SessionTasksResolved = { turn: 0, roundEnded: true, reckoning: false, sweep: false, sweepEvery: 5, waitForRound: true, scripts: false, tasks: [], modes: {} }
	const [session] = await db
		.select({ genreId: schema.sessions.genreId, presetId: schema.sessions.presetId, metadata: schema.sessions.metadata, lorebookId: schema.sessions.lorebookId, rigour: schema.sessions.rigour })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return empty
	const genre = await getSessionGenre(db, session.genreId ?? STANDARD_GENRE_ID)
	const decls = ((genre as any)?.tasks ?? []) as TaskDecl[]
	if (!decls.length) return empty

	const [fields, pinned] = await Promise.all([genreFieldsFor(db, sessionId), presetPinnedSettings(db, session.presetId)])
	const resolved = resolveTasks(decls, fields.tasks, pinned?.tasks).map((t) =>
		session.lorebookId == null && LOREBOOK_TASKS.has(t.key) ? { ...t, mode: "off" as const } : t
	)

	const replies = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(and(eq(schema.sessionMessages.sessionId, sessionId), inArray(schema.sessionMessages.role, ["character", "assistant", "narrator"])))
	const turn = replies.length
	// 🚧 The round ends when nobody else is prepared: the stored order holds
	// at most the entry that just spoke. Recalculation lands on
	// `messageCompleted`, after this reads, so "one or none" is the test.
	const roundEnded = orderOf(session.metadata).length <= 1
	const sceneBoundary = opts.sceneBoundary === true

	const tasks = resolved.map((t) => {
		const wait = (t.group === "reckoning" || t.group === "sweep") && t.waitForRound && !roundEnded
		return { ...t, due: !wait && taskDue(t, turn, sceneBoundary) }
	})
	const on = (group: TaskGroup) => tasks.some((t) => t.group === group && t.due && t.mode !== "off")
	// A task detached from the after-turn group onto a bucket counts with the sweep.
	const detachedDue = tasks.some((t) => t.group === "reckoning" && t.every !== 1 && t.due && t.mode !== "off")
	// 🚧 An event the reckoning notices rides it (lane 2): *Describe new
	// places* reads the move off the reply, so the after-turn call runs for it.
	const reckoningNow = tasks.some(
		(t) => ((t.group === "reckoning" && t.every === 1) || RIDES_RECKONING.has(t.key)) && t.due && t.mode !== "off"
	)
	const modes: SessionTasksResolved["modes"] = {}
	for (const t of tasks) modes[t.key] = t.mode
	const sweepTask = tasks.find((t) => t.group === "sweep")
	const rigour = opts.ruleset?.rigour ?? session.rigour
	return {
		turn,
		roundEnded,
		reckoning: reckoningNow,
		sweep: on("sweep") || detachedDue,
		sweepEvery: sweepTask?.every ?? 5,
		waitForRound: sweepTask?.waitForRound ?? true,
		scripts: rigour === "scripts",
		tasks,
		modes
	}
}
