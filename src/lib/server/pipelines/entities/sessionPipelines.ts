/**
 * The pipelines a session runs: its reply's pipeline, then every enabled
 * action's (narrate, the summarize family, plugin actions), then the genre's
 * create spec — the pipeline that created it (owner ruling 2026-09-30) —
 * deduped by slug: one spec serving two actions is one pipeline.
 *
 * Two readers, one answer: the session's settings draw a card per entry
 * (`sessions:pipelines`), and the pipelines panel writes at the session's own
 * scope only for a pipeline in this list (owner Q7, `sockets/pipelines.ts`
 * `viewerFor`) — any other pipeline opened from inside the session is the
 * configuration's.
 */

import { and, asc, eq, or, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

type Db = any

export interface SessionPipeline {
	slug: string
	/** The card's title: an action's name, or the pipeline's own name. */
	label: string
	/**
	 * Set on the session's creation pipeline only: `creating` while its create
	 * run is under way (`sessions/creating.ts`), `created` after — its
	 * settings have done their work, so the session's own values for it are
	 * read-only (`CREATION_READ_ONLY_NOTE`, `Viewer.readOnlyBecause`).
	 */
	creation?: "creating" | "created"
}

/**
 * Why a created session's values for its creation pipeline are read-only —
 * the scope note's sentence, and the start of the refusal a write gets.
 */
export const CREATION_READ_ONLY_NOTE =
	"This session has been created; these settings only applied while creating it."

/** A binding that stopped resolving, so the genre's default runs instead (ruled 2026-09-10). */
export interface SessionPipelineFallback {
	event: string
	bound: string
	reason: string
	fallbackSpec: string | null
}

export async function sessionPipelines(
	db: Db,
	sessionId: number,
	userId: number
): Promise<{ pipelines: SessionPipeline[]; fallbacks: SessionPipelineFallback[] }> {
	const { resolveSubjectVerdict, enabledSessionFunctions, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const { sessionEvents } = await import("@serene-pub/sdk")
	const { actionIdentity } = await import("$lib/shared/actions/identity")
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const genreId = session?.genreId ?? STANDARD_GENRE_ID

	const nameOf = async (slug: string): Promise<string | null> => {
		const [row] = await db
			.select({ name: schema.pipelineSpecs.name })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, slug))
			.limit(1)
		return row?.name ?? null
	}
	const pipelines: SessionPipeline[] = []
	const seen = new Set<string>()
	/** Deduped by event as well: two functions bound to one dead pipeline is one thing wrong. */
	const fallbacks = new Map<string, SessionPipelineFallback>()
	const add = async (
		resolved: { spec: string | null; fallback?: any },
		label: string,
		creation?: SessionPipeline["creation"]
	): Promise<void> => {
		if (resolved.fallback)
			fallbacks.set(resolved.fallback.event, {
				event: resolved.fallback.event,
				bound: resolved.fallback.bound,
				reason: resolved.fallback.reason,
				fallbackSpec: resolved.spec
			})
		const slug = resolved.spec
		if (!slug || seen.has(slug)) return
		seen.add(slug)
		pipelines.push({
			slug,
			label: label || (await nameOf(slug)) || slug,
			...(creation ? { creation } : {})
		})
	}

	// The reply pipeline is always involved, titled by its own name
	// (*Adventure turn*); then every function the session has switched on
	// (19 §4). The verdict rather than the slug (ruled 2026-09-10): a preset
	// binding that stopped resolving must not fail this read, and the list
	// must not show a pipeline the preset does not name as though it had.
	await add(
		await resolveSubjectVerdict(db, genreId, sessionEvents.messageRespond, { sessionId }),
		""
	)
	for (const fn of await enabledSessionFunctions(db, sessionId, genreId, userId))
		await add(
			await resolveSubjectVerdict(db, genreId, actionIdentity(fn), { sessionId }),
			fn.name
		)
	// Last, and only when no other role claimed the slug: a create spec that
	// also answers a running event is a pipeline the session still runs, and
	// stays editable as one. Once created, the card names the spec that
	// actually ran, from its run record — the preset's create binding may
	// name another by now. Only with no record (still creating, or a create
	// that left none) does the current binding answer.
	const { isCreating } = await import("$lib/server/sessions/creating")
	const creating = isCreating(sessionId)
	const ran = creating ? null : await createRunSpec(db, sessionId, sessionEvents.sessionCreated)
	await add(
		ran
			? { spec: ran }
			: await resolveSubjectVerdict(db, genreId, sessionEvents.sessionCreated, { sessionId }),
		"",
		creating ? "creating" : "created"
	)
	return { pipelines, fallbacks: [...fallbacks.values()] }
}

/**
 * The spec of the session's create run: its earliest recorded run whose spec
 * version answers `session-created`. Null when no such run was recorded.
 */
async function createRunSpec(
	db: Db,
	sessionId: number,
	sessionCreated: string
): Promise<string | null> {
	const versions = schema.pipelineSpecVersions
	const [row] = await db
		.select({ slug: schema.pipelineRuns.specSlug })
		.from(schema.pipelineRuns)
		.innerJoin(versions, eq(versions.id, schema.pipelineRuns.specVersionId))
		.where(
			and(
				eq(schema.pipelineRuns.sessionId, sessionId),
				or(
					eq(versions.inputEvent, sessionCreated),
					sql`coalesce(${versions.inputEvents}::jsonb, '[]'::jsonb) @> ${JSON.stringify([sessionCreated])}::jsonb`
				)
			)
		)
		.orderBy(asc(schema.pipelineRuns.id))
		.limit(1)
	return row?.slug ?? null
}
