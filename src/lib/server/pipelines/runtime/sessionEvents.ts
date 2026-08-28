/**
 * Session-event dispatch (24 §3/§5): resolve which pipeline answers an event
 * for a genre — a SELECT over the input-lock columns — and run it through the
 * ordinary executor. This is dispatch keyed on (genre, event), the same rule
 * respond-bucket resolution uses, applied to the lifecycle events.
 *
 * Returns null when nothing serves, and that is a normal state, not a
 * failure: a transitional input-type genre has no create pipeline (the
 * caller keeps its imperative floor, the F29 posture), and today nothing
 * subscribes to the member events — the seam exists so the first pipeline
 * that wants them binds by declaring, not by core growing a call site.
 */
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { runSpec } from "$lib/server/pipelines/runtime/runTurn"
import type { Receipt } from "@serene-pub/sdk"

type Db = any

/** The spec whose active published version answers (genre, event), or null. */
export async function resolveSessionEventSpec(
	db: Db,
	genreId: string,
	event: string
): Promise<string | null> {
	try {
		const rows = await db
			.select({
				slug: schema.pipelineSpecs.slug,
				activeVersionId: schema.pipelineSpecs.activeVersionId,
				versionId: schema.pipelineSpecVersions.id,
				status: schema.pipelineSpecVersions.status,
				inputGenre: schema.pipelineSpecVersions.inputGenre,
				inputEvent: schema.pipelineSpecVersions.inputEvent
			})
			.from(schema.pipelineSpecs)
			.innerJoin(
				schema.pipelineSpecVersions,
				eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
			)
		const hit = (rows as any[]).find(
			(r) =>
				r.activeVersionId === r.versionId &&
				r.status === "published" &&
				r.inputGenre === genreId &&
				r.inputEvent === event
		)
		return hit?.slug ?? null
	} catch {
		return null
	}
}

export interface SessionEventDispatch {
	specSlug: string
	receipt: Receipt
}

/**
 * Run the pipeline serving (genre, event), if one does. The caller shapes
 * `input` for the event's input contract; the run gets the ordinary session
 * scope, receipt, and bindings — an event run is a run like any other.
 */
export async function dispatchSessionEvent(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		genreId: string
		event: string
		input: unknown
		signal?: AbortSignal
	}
): Promise<SessionEventDispatch | null> {
	const specSlug = await resolveSessionEventSpec(db, opts.genreId, opts.event)
	if (!specSlug) return null
	const receipt = await runSpec({
		db,
		sessionId: opts.sessionId,
		userId: opts.userId,
		specId: specSlug,
		input: opts.input,
		signal: opts.signal
	})
	return { specSlug, receipt }
}
