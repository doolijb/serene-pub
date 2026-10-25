/**
 * 🚧 **What a session's routines did, and how they stand** (PLAN-layering
 * A7, R23, R39; lane 6, 2026-10-20) — the data under lane 7's *While you
 * were away* widget and the composer's Routines sub-menu.
 *
 *  · `routineLog` — the session's recent routine runs, newest first: what
 *    ran and what it wrote (the run's artifacts), what was skipped or paused
 *    and why (the inspector lines, `routines/run.ts`). All of it is
 *    `pipeline_runs` rows with `trigger_family = 'routine'`.
 *  · `sessionRoutines` — each routine the session has, as it stands now:
 *    its cadence, mode, whether it is waiting or running, paused (by a cap,
 *    or since a restart until someone plays) or needing a story clock, and
 *    whether the viewer may Run it now (R39: the session's owner, a routine
 *    not Off).
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm"
import { cadenceClock, getCadence } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { isResumed, pauseOf } from "$lib/server/pipelines/routines/interaction"

/** One line of the log. */
export interface RoutineLogEntry {
	runId: string
	registrationKey: string
	pipeline: string
	name: string
	kind: "ran" | "skipped" | "paused" | "failed" | "stopped"
	reason?: string
	startedAt: number
	endedAt: number
	wrote: Array<{ kind: string; entityId: number; action: string }>
	runNow?: boolean
}

const i18nText = (v: unknown): string | undefined => {
	if (typeof v === "string") return v
	const en = (v as { en?: unknown } | null | undefined)?.en
	return typeof en === "string" ? en : undefined
}

/** A session's recent routine runs, newest first (at most `limit`, since `since` when given). */
export async function routineLog(
	db: Db,
	sessionId: number,
	opts: { since?: number | null; limit?: number } = {}
): Promise<RoutineLogEntry[]> {
	const limit = Math.max(1, Math.min(200, Math.floor(opts.limit ?? 50)))
	const r = schema.pipelineRuns
	const rows = await db
		.select({
			id: r.id,
			runId: r.runId,
			specSlug: r.specSlug,
			registrationKey: r.registrationKey,
			outcome: r.outcome,
			haltReason: r.haltReason,
			startedAt: r.startedAt,
			endedAt: r.endedAt,
			routine: sql<Record<string, unknown> | null>`(${r.receipt}::jsonb -> 'meta' -> 'routine')`
		})
		.from(r)
		.where(
			and(
				eq(r.sessionId, sessionId),
				eq(r.triggerFamily, "routine"),
				...(typeof opts.since === "number" ? [gte(r.startedAt, new Date(opts.since))] : [])
			)
		)
		.orderBy(desc(r.id))
		.limit(limit)
	if (!rows.length) return []
	const artifacts = await db
		.select({
			runId: schema.pipelineRunArtifacts.runId,
			kind: schema.pipelineRunArtifacts.kind,
			entityId: schema.pipelineRunArtifacts.entityId,
			action: schema.pipelineRunArtifacts.action
		})
		.from(schema.pipelineRunArtifacts)
		.where(inArray(schema.pipelineRunArtifacts.runId, rows.map((x) => x.id)))
		.orderBy(schema.pipelineRunArtifacts.seq)
	const names = new Map(
		(
			await db
				.select({ slug: schema.pipelineSpecs.slug, name: schema.pipelineSpecs.name })
				.from(schema.pipelineSpecs)
				.where(inArray(schema.pipelineSpecs.slug, [...new Set(rows.map((x) => x.specSlug))]))
		).map((x) => [x.slug, x.name])
	)
	return rows.map((row) => {
		const meta = (row.routine ?? {}) as Record<string, unknown>
		const kind: RoutineLogEntry["kind"] =
			meta.skipped === true
				? "skipped"
				: meta.paused === true
					? "paused"
					: row.outcome === "ok"
						? "ran"
						: row.outcome === "cancelled"
							? "stopped"
							: "failed"
		return {
			runId: row.runId,
			registrationKey: row.registrationKey ?? "",
			pipeline: row.specSlug,
			name: i18nText(meta.name) ?? names.get(row.specSlug) ?? row.specSlug,
			kind,
			...(row.haltReason ? { reason: row.haltReason } : {}),
			startedAt: row.startedAt.getTime(),
			endedAt: (row.endedAt ?? row.startedAt).getTime(),
			wrote: artifacts
				.filter((a) => a.runId === row.id)
				.map((a) => ({ kind: a.kind, entityId: a.entityId, action: a.action })),
			...(meta.runNow === true ? { runNow: true } : {})
		}
	})
}

/** One routine of a session, as it stands. */
export interface SessionRoutineView {
	registrationKey: string
	pipeline: string
	name: string
	cadence: { id: string; name: string; options: Record<string, unknown> }
	clock?: "system" | "story"
	mode: "off" | "review" | "full"
	allowStacking: boolean
	waiting: number
	running: boolean
	/** Why it does not run now, when it does not: a cap, or the app restarted and nobody has played since. */
	paused?: string
	/** What it needs and the session lacks: "Needs a story clock", or 🚧 (R56) "Unavailable: needs a model that can draw pictures." */
	needs?: string
	/** Whether the viewer may fire it by hand (R39). */
	runNow: boolean
}

/** The sentence a system-clock routine shows after a restart, until someone plays (R21). */
export const PAUSED_SINCE_RESTART = "Paused until someone plays — the app restarted"

/** Every routine the session has, for `viewer` (the owner may Run now). */
export async function sessionRoutines(
	db: Db,
	sessionId: number,
	viewer: { isOwner: boolean }
): Promise<SessionRoutineView[]> {
	const { effectiveRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const resolved = await effectiveRegistrations(db, sessionId)
	if (!resolved) return []
	const routines = resolved.effective.filter((r) => r.trigger.family === "routine")
	if (!routines.length) return []
	const names = new Map(
		(
			await db
				.select({ slug: schema.pipelineSpecs.slug, name: schema.pipelineSpecs.name })
				.from(schema.pipelineSpecs)
				.where(inArray(schema.pipelineSpecs.slug, [...new Set(routines.map((r) => r.pipeline))]))
		).map((x) => [x.slug, x.name])
	)
	const { routineQueue } = await import("$lib/server/pipelines/routines/run")
	const queue = routineQueue.view(sessionId)
	// 🚧 R56: a routine whose pipeline needs a model nothing here serves.
	const { unservedPipelines } = await import("$lib/server/pipelines/registrations/unserved")
	const unserved = await unservedPipelines(db, routines.map((r) => r.pipeline))
	return routines.map((r) => {
		const ref = (r.trigger as { cadence: { id: string; options: Record<string, unknown> } }).cadence
		const clock = cadenceClock(ref)
		const mode = r.mode ?? "full"
		const paused =
			clock === "system" ? (pauseOf(sessionId, r.key) ?? (isResumed(sessionId) ? undefined : PAUSED_SINCE_RESTART)) : undefined
		return {
			registrationKey: r.key,
			pipeline: r.pipeline,
			name: i18nText(r.label) ?? names.get(r.pipeline) ?? r.pipeline,
			cadence: { id: ref.id, name: i18nText(getCadence(ref.id)?.i18n.name) ?? ref.id, options: { ...ref.options } },
			...(clock ? { clock } : {}),
			mode,
			allowStacking: r.allowStacking === true,
			waiting: queue.waiting.filter((w) => w.registrationKey === r.key).length,
			running: queue.running?.registrationKey === r.key,
			...(mode !== "off" && paused ? { paused } : {}),
			...(unserved.has(r.pipeline) ? { needs: unserved.get(r.pipeline)!.sentence } : {}),
			runNow: viewer.isOwner && mode !== "off" && !unserved.has(r.pipeline)
		}
	})
}
