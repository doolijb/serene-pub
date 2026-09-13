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
import { runSpec } from "$lib/server/pipelines/runtime/runTurn"
import {
	lockedEventSpec,
	presetEventSpec,
	type PresetFallback
} from "$lib/server/pipelines/entities/presetBindings"
import type { Receipt } from "@serene-pub/sdk"

/**
 * Which spec answers (genre, event) for this session, and how it was reached.
 *
 * Two layers, in this order:
 *
 * 1. **The session's preset**, when a `sessionId` is given and its preset
 *    binds this event (24 §1). A preset that names a pipeline is an
 *    administrator answering the question directly, so it outranks the lock's
 *    own answer — which is the whole reason the binding exists. A binding the
 *    instance cannot resolve does NOT refuse the turn (ruled 2026-09-10): it comes
 *    back as `fallback`, carrying layer 2's answer plus everything a surface
 *    needs to say the substitution out loud. An upgrade or a plugin removal
 *    must never stop a session working without an admin change.
 * 2. **The input lock** — the one published spec whose active version declares
 *    (genre, event) as columns. Unchanged, and still the answer for every
 *    session on no preset and every caller with no session in hand (the seed
 *    backfill, the admin form's defaults).
 *
 * Everything else still degrades to null, which is a normal state and not a
 * failure (the F29 posture).
 */
export interface SessionEventResolution {
	spec: string | null
	/**
	 * Present only when the session's preset bound this event to something
	 * this instance cannot resolve. Its presence IS the fact the receipt, the
	 * banner and the admin notice all state.
	 */
	fallback?: PresetFallback
}

export async function resolveSessionEventVerdict(
	db: Db,
	genreId: string,
	event: string,
	scope?: { sessionId?: number | null }
): Promise<SessionEventResolution> {
	try {
		const verdict = await presetEventSpec(db, {
			sessionId: scope?.sessionId,
			genreId,
			event
		})
		if (verdict.via === "preset") return { spec: verdict.spec }
		if (verdict.via === "fallback") {
			const { via: _via, spec, ...fallback } = verdict
			return { spec, fallback }
		}
		return { spec: await lockedEventSpec(db, genreId, event) }
	} catch {
		// Routing infrastructure failing still degrades to "nothing serves",
		// which the caller answers with its own floor (the F29 posture).
		return { spec: null }
	}
}

/** The same answer, for the callers that only need the slug. */
export async function resolveSessionEventSpec(
	db: Db,
	genreId: string,
	event: string,
	scope?: { sessionId?: number | null }
): Promise<string | null> {
	return (await resolveSessionEventVerdict(db, genreId, event, scope)).spec
}

export interface SessionEventDispatch {
	specSlug: string
	receipt: Receipt
	/** Set when the preset's own choice could not answer — see the resolution. */
	fallback?: PresetFallback
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
	const resolved = await resolveSessionEventVerdict(
		db,
		opts.genreId,
		opts.event,
		// The session is in hand here, so its preset gets to answer first.
		{ sessionId: opts.sessionId }
	)
	if (!resolved.spec) return null
	const receipt = await runSpec({
		db,
		sessionId: opts.sessionId,
		userId: opts.userId,
		specId: resolved.spec,
		input: opts.input,
		signal: opts.signal,
		// A run reached through a substitution says so on its own receipt.
		// The explain surface reads it from there, which is where every other
		// "why did the turn do that" answer already lives.
		...(resolved.fallback
			? { meta: { preset: { via: "fallback", ...resolved.fallback } } }
			: {})
	})
	return {
		specSlug: resolved.spec,
		receipt,
		...(resolved.fallback ? { fallback: resolved.fallback } : {})
	}
}
