import { and, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY,
	type CapabilityCandidate,
	type CapabilityProblem
} from "$lib/server/connections/capabilityTarget"

export type TaskType =
	| "session"
	| "narratorPrompt"
	| "session_title"
	| "field_generation"
	| "summarize_batch"
	| "summarize_synth"
	| "summarize_name"
	| "character_extraction"
	// One per LLM step the graph builder makes.
	| "graph_node_resolution"
	| "graph_pre_filter"
	| "graph_perspective"
	| "graph_node_description"
	| "graph_state_detection"

export interface ResolvedTaskConfig {
	connection: SelectConnection | null
	/**
	 * Why there is no connection, when there is none.
	 *
	 * Carried rather than thrown, because every caller of this already answers a
	 * missing connection its own way — one persists an error row on the message,
	 * one returns a socket response, one throws a `DispatchError` — and a
	 * resolver that threw would need a mode flag to serve all three. What they
	 * were each doing instead was writing their own sentence ("No AI connection
	 * configured. Please set up a connection first."), which is one sentence for
	 * four different situations: nothing registered, a default cleared by a
	 * deleted connection, a dangling id, and a connection that cannot do chat.
	 * This is the resolver's own words for which of those it was.
	 */
	problem?: CapabilityProblem
	/**
	 * The row, not the parameters. `values` on it is unfiltered — it still holds
	 * the keys a user switched off, and the ones this build's shape does not
	 * declare — so anything handing this to an adapter must put it through
	 * `resolveSampling()` first (utils/resolveSampling.ts). The row is what
	 * `samplingName` below is read from, which is the other half of why it stays
	 * a row here.
	 */
	sampling: SelectSamplingConfig | null
	/** Human-readable label for task queue display */
	connectionName: string
	samplingName: string
}

/**
 * Resolves connection + sampling for a given task context.
 *
 * Resolution order, highest first — and the two halves do not run to the same
 * depth, because a session names no connection:
 *
 *   pair      the calling node's own slots → the instance's `text->text`
 *             default
 *   sampling  the session's own pick (its pipeline panel row on the oracle's
 *             `sampling` slot) → the node's own slot → the instance default
 *
 * The floor is the capability default, and `resolveCapabilityTarget` reads it
 * — this function's job is to say what ITS own tiers said, not to have an
 * opinion about the floor. Every task type below is a text task, which is why
 * the capability is a constant rather than a parameter.
 *
 * ⚠ The session tier is handed over as an ID, not as a candidate. Overrides are
 * by model now, never by connection: `CapabilityTargetRequest` has nowhere for
 * a session to put an endpoint, so this function cannot reintroduce one by
 * accident.
 */
export async function resolveTaskConfig(params: {
	taskType: TaskType
	/** ID of the session (optional per-session override) */
	sessionId?: number | null
	/**
	 * The calling provider NODE's own `connection` / `sampling` slots. The
	 * pipeline path forwards these; other callers pass nothing.
	 */
	pipelineConnectionId?: number | null
	/**
	 * The MODEL half of that node's `connection` slot (0114). Null means the
	 * endpoint's default model.
	 */
	pipelineConnectionModelId?: number | null
	pipelineSamplingId?: number | null
}): Promise<ResolvedTaskConfig> {
	const { sessionId } = params

	// ── The session's own override — SAMPLING, and nothing else ──────────────
	const sessionSamplingId = sessionId
		? await sessionSamplingPick(sessionId)
		: null

	// ── The instance's capability default, and the guard ──────────────────────
	//
	// `resolveCapabilityTarget` checks that the row still exists and that the
	// connection can do chat, and supplies the sentence for each way it can go
	// wrong. Merged per HALF, not as a pair, because the resolver walks the two
	// independently: a node that names a connection but no sampling profile must
	// keep the instance's sampling default rather than clearing it.
	const candidate: CapabilityCandidate = {
		connectionId: params.pipelineConnectionId ?? null,
		connectionModelId:
			params.pipelineConnectionId != null
				? (params.pipelineConnectionModelId ?? null)
				: null,
		samplingConfigId: params.pipelineSamplingId ?? null
	}
	const target = await resolveCapabilityTarget(db, {
		capability: TEXT_CAPABILITY,
		pipelineConfig: candidate,
		// Tier 3, and an id rather than a candidate — the one override a session
		// still makes. It is a separate field from `pipelineConfig` above, on a
		// different chain, so a session's sampling and a config's connection can
		// both be in the request at once.
		sessionSampling: sessionSamplingId
	})

	if (!target.ok)
		return {
			connection: null,
			sampling: null,
			connectionName: "System default",
			samplingName: "System default",
			problem: target.problem
		}

	return {
		connection: target.connection,
		sampling: target.sampling,
		connectionName: target.connection.name ?? "System default",
		samplingName: target.sampling?.name ?? "System default"
	}
}

/**
 * The session's own sampling pick: the session-scope pipeline panel row on the
 * `sampling` slot of the model call (`oracleNodeKeyOf`) of the pipeline
 * serving its turns (`sessionPipeline`), or null when it set none.
 *
 * The one session layer — the same row the executor projects at `session`
 * scope (`world.ts`, `applyPipelineLayer`), so a run outside the executor
 * samples with the pick the session's Pipelines card shows. The panel stores
 * the id as a JSON number; a value that is not a whole id is no pick.
 */
async function sessionSamplingPick(sessionId: number): Promise<number | null> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return null
	const [{ sessionPipeline }, { oracleNodeKeyOf, ORACLE_NODE_KEY }] = await Promise.all([
		import("$lib/server/pipelines/entities/sessionGenres"),
		import("$lib/server/pipelines/config/world")
	])
	const pipeline = await sessionPipeline(db, sessionId, session.genreId)
	if (!pipeline) return null
	// The pipeline's own reply call, read off its document (`buildWorld`'s rule).
	const oracle = (await oracleNodeKeyOf(db, { id: pipeline.specId })) ?? ORACLE_NODE_KEY
	const [row] = await db
		.select({ value: schema.pipelineNodeOverrides.value })
		.from(schema.pipelineNodeOverrides)
		.where(
			and(
				eq(schema.pipelineNodeOverrides.specId, pipeline.specId),
				eq(schema.pipelineNodeOverrides.scopeKind, "session"),
				eq(schema.pipelineNodeOverrides.scopeId, sessionId),
				eq(schema.pipelineNodeOverrides.nodeKey, oracle),
				eq(schema.pipelineNodeOverrides.slot, "sampling"),
				eq(schema.pipelineNodeOverrides.path, "")
			)
		)
		.limit(1)
	const id = Number(row?.value)
	return row?.value != null && Number.isInteger(id) && id > 0 ? id : null
}
