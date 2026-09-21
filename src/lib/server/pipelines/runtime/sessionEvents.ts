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
import { v4 as uuidv4 } from "uuid"
import { runSpec, type SpecRunRequest } from "$lib/server/pipelines/runtime/runTurn"
import {
	lockedEventSpec,
	presetEventSpec,
	type PresetFallback
} from "$lib/server/pipelines/entities/presetBindings"
import {
	admitDescendant,
	type RunLineage
} from "$lib/server/pipelines/runtime/lineage"
import * as runRegistry from "$lib/server/pipelines/runtime/runRegistry"
import { saveReceipt } from "$lib/server/pipelines/runtime/receipts"
import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { Receipt } from "@serene-pub/sdk"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/**
 * The session's own binding for an event (plans/31 V2): the spec its
 * `pipeline_bindings` row at session scope names for `event`, when that spec
 * still answers (genre, event) on its inlet lock — else null, and the layers
 * below decide. Eligibility is re-checked at read for the reason every
 * binding's is: a row whose spec left the bucket falls through rather than
 * routing to something that cannot serve.
 */
export async function sessionBoundEventSpec(
	db: Db,
	sessionId: number,
	genreId: string,
	event: string
): Promise<string | null> {
	const [row] = await db
		.select({ specId: schema.pipelineBindings.specId })
		.from(schema.pipelineBindings)
		.where(
			and(
				eq(schema.pipelineBindings.scopeKind, "session"),
				eq(schema.pipelineBindings.scopeId, sessionId),
				eq(schema.pipelineBindings.genreId, genreId),
				eq(schema.pipelineBindings.subject, event)
			)
		)
		.limit(1)
	if (!row) return null
	const [spec] = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId
		})
		.from(schema.pipelineSpecs)
		.where(eq(schema.pipelineSpecs.id, row.specId))
		.limit(1)
	if (!spec?.activeVersionId) return null
	const [version] = await db
		.select({
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent
		})
		.from(schema.pipelineSpecVersions)
		.where(eq(schema.pipelineSpecVersions.id, spec.activeVersionId))
		.limit(1)
	if (
		!version ||
		version.status !== "published" ||
		version.inputGenre !== genreId ||
		version.inputEvent !== event
	)
		return null
	return spec.slug
}

/**
 * Which spec answers (genre, event) for this session, and how it was reached.
 *
 * Three layers, in this order:
 *
 * 0. **The session's own binding** on the event id (plans/31 V2; closes the
 *    R-6 gap): a `pipeline_bindings` row at session scope whose `subject` is
 *    this event, when its spec still answers (genre, event) — the same
 *    eligibility `resolveSubjectVerdict` re-checks. A session is a work, not
 *    a preference (12 §2): its own choice beats its preset's.
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
		// R-6 (ruled 2026-09-15; the event half built with plans/31 V2): a
		// session's own choice resolves BEFORE its preset, on the same row
		// and the same eligibility the reply's `resolveSubjectVerdict` reads
		// for an event subject, so a reply and a dispatched event cannot
		// route differently.
		if (scope?.sessionId != null) {
			const own = await sessionBoundEventSpec(db, scope.sessionId, genreId, event)
			if (own) return { spec: own }
		}
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
	/**
	 * The run was refused by a cycle cap before it started (01 §8; U5d).
	 * The receipt is the refusal's — `outcome: 'halt'`, the cap in
	 * `haltReason`, lineage filled — saved like any other so the tree's
	 * reader sees where it stopped.
	 */
	refused?: string
}

/**
 * Run the pipeline serving (genre, event), if one does. The caller shapes
 * `input` for the event's input contract; the run gets the ordinary session
 * scope, receipt, and bindings — an event run is a run like any other.
 *
 * A dispatch made **by a run** — `form-addressed` from the run that wrote
 * the form (U5d) — carries `lineage`, and this is where 01 §8's dynamic
 * cycle guards hold: the child is refused past the per-root depth and
 * descendant caps (`lineage.ts`), and the refusal is receipted rather than
 * dropped. The child is registered as an `action` run under the run owner,
 * so a stop on the parent reaches it, and its receipt names the parent.
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
		/** The dispatching run's lineage plus one — a child run. Absent for a person-less root. */
		lineage?: RunLineage
		/** Where a child's rows are announced — the parent's socket server, when it had one. */
		io?: SessionIo
		runId?: string
		/**
		 * The parent's progress sink and status relay, handed down (U5d
		 * review, S4): a child's frames ride the parent's card, so the person
		 * who pressed sees the answer being made — its stage, its statuses.
		 */
		sink?: SpecRunRequest["sink"]
		onStatus?: SpecRunRequest["onStatus"]
		/** The parent's park relay, handed down — see `SpecRunRequest.onParked`. */
		onParked?: SpecRunRequest["onParked"]
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
	const runId = opts.runId ?? uuidv4()

	if (opts.lineage) {
		const cap = admitDescendant(opts.lineage)
		if (cap) {
			const receipt = await refusalReceipt(db, {
				runId,
				specId: resolved.spec,
				sessionId: opts.sessionId,
				userId: opts.userId,
				lineage: opts.lineage,
				reason: cap
			})
			return {
				specSlug: resolved.spec,
				receipt,
				refused: cap,
				...(resolved.fallback ? { fallback: resolved.fallback } : {})
			}
		}
	}

	// A child is a run somebody can watch and stop — registered like an
	// action's, under the run owner; the parent's stop reaches it through
	// its own handle.
	const handle = opts.lineage
		? runRegistry.start({
				runId,
				userId: opts.userId,
				sessionId: opts.sessionId,
				specId: resolved.spec,
				kind: "action"
			})
		: null
	const onParentAbort = () =>
		runRegistry.cancelAs(
			runId,
			"system:parent-stopped",
			"the run that dispatched this one was stopped"
		)
	if (handle) opts.signal?.addEventListener("abort", onParentAbort, { once: true })
	try {
		const receipt = await runSpec({
			db,
			sessionId: opts.sessionId,
			userId: opts.userId,
			specId: resolved.spec,
			runId,
			input: opts.input,
			io: opts.io,
			signal: handle ? handle.controller.signal : opts.signal,
			...(handle ? { cancelSignal: () => runRegistry.cancellation(handle) } : {}),
			lineage: opts.lineage,
			...(opts.sink ? { sink: opts.sink } : {}),
			...(opts.onStatus ? { onStatus: opts.onStatus } : {}),
			...(opts.onParked ? { onParked: opts.onParked } : {}),
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
	} finally {
		if (handle) {
			opts.signal?.removeEventListener("abort", onParentAbort)
			runRegistry.finish(runId)
		}
	}
}

/**
 * The receipt a refusal leaves (01 §8; U5d): a run that never started,
 * written as one row so the inspector shows the tree ending on a sentence
 * rather than on nothing. No nodes, no seed to replay — there was no run —
 * and `triggerSource: 'event'`, since an event asked for it. Written at both
 * doors a dispatched run has (U5d review, W1): a `form-addressed` child the
 * caps refused here, and the fire an `answer-form` commit could not make —
 * a cap, receipted by `dispatchFires` after the answer's own row (S-b), or
 * `fireAction`'s own refusal at the dispatch.
 *
 * The same row for a fire that was **stopped** before it ran or that
 * **threw** on its way (U5d review, W-a): the answer's receipt names
 * `firedRunId`, so a fire that leaves no row is a run the inspector cannot
 * find. `cancelled` carries the stop's actor and reason the way the
 * executor stamps them; a throw is a `halt` on the error's sentence.
 */
export async function refusalReceipt(
	db: Db,
	opts: {
		runId: string
		specId: string
		sessionId: number
		userId: number
		lineage: RunLineage
		reason: string
		/** `halt` unless a stop is being recorded. */
		outcome?: "halt" | "cancelled"
		/** Who stopped it — set with `outcome: 'cancelled'`. */
		cancelledBy?: string
	}
): Promise<Receipt> {
	const { loadPublished } = await import("$lib/server/pipelines/boot/bootstrap")
	const doc = await loadPublished(db, opts.specId)
	const now = Date.now()
	const receipt: Receipt = {
		runId: opts.runId,
		specId: opts.specId,
		specVersion: doc?.version ?? "0.0.0",
		schemaVersion: 1,
		seed: "",
		triggerSource: "event",
		parentRunId: opts.lineage.parentRunId,
		rootRunId: opts.lineage.rootRunId,
		depth: opts.lineage.depth,
		startedAt: now,
		endedAt: now,
		outcome: opts.outcome ?? "halt",
		haltReason: opts.reason,
		...(opts.outcome === "cancelled" && opts.cancelledBy
			? { cancelledBy: opts.cancelledBy }
			: {}),
		nodes: [],
		emitted: [],
		consumption: { tokens: 0, nodeExecutions: 0 }
	}
	await saveReceipt(db, receipt, {
		sessionId: opts.sessionId,
		userId: opts.userId,
		artifacts: []
	})
	return receipt
}
