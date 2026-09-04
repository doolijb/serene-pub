import { db } from "$lib/server/db"
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
	// One per LLM step the graph builder makes. Each maps to its own
	// prompt/connection/sampling triple on graphBuildConfigs — see
	// GRAPH_TASK_SUBTASK below.
	| "graph_node_resolution"
	| "graph_pre_filter"
	| "graph_perspective"
	| "graph_node_description"
	| "graph_state_detection"

/**
 * graph task type → the `graphBuildConfigs` column prefix that configures it.
 *
 * The prefix drives three columns each: `<prefix>SystemPrompt`,
 * `<prefix>ConnectionId` and `<prefix>SamplingConfigId`. Adding a graph step
 * means adding its task type, its entry here, and its three columns — leaving
 * any of them out now throws rather than silently borrowing another step's
 * settings.
 */
export const GRAPH_TASK_SUBTASK: Record<string, string> = {
	graph_node_resolution: "nodeResolution",
	graph_pre_filter: "preFilter",
	graph_perspective: "perspective",
	graph_node_description: "nodeDescription",
	graph_state_detection: "stateDetection"
}

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
 * Resolution order, highest first:
 *   session override → prompt/summarize/graphBuild config sub-task →
 *   the instance's `text->text` default
 *
 * The floor used to be `system_settings.default_connection_id`, read here; it is
 * the capability default now, and `resolveCapabilityTarget` reads it — this
 * function's job is to say which of ITS two tiers spoke, not to have an opinion
 * about the third. Every task type below is a text task, which is why the
 * capability is a constant rather than a parameter.
 */
export async function resolveTaskConfig(params: {
	taskType: TaskType
	/** ID of the prompt config (session generation) */
	promptConfigId?: number | null
	/** ID of the narrator prompt config (Narrator response generation) */
	narratorPromptConfigId?: number | null
	/** ID of the active summarize config (summarization tasks) */
	summarizeConfigId?: number | null
	/** Type of summarize config table */
	summarizeConfigType?: "world" | "character" | "scene"
	/** ID of the graph build config */
	graphBuildConfigId?: number | null
	/** ID of the session (optional per-session override) */
	sessionId?: number | null
	/**
	 * Tier 2 — the calling provider NODE's own `connection` / `sampling` slots.
	 *
	 * The pipeline path forwards these; the legacy callers do not have them and
	 * pass nothing. They outrank the legacy per-config override below because
	 * they are a statement about THIS node in THIS pipeline, which is more
	 * specific than a prompt config's blanket choice — and because they are the
	 * control the panel actually shows on the reply step. Before they were
	 * threaded through, that control changed nothing an admin could observe.
	 */
	pipelineConnectionId?: number | null
	pipelineSamplingId?: number | null
}): Promise<ResolvedTaskConfig> {
	const {
		taskType,
		promptConfigId,
		narratorPromptConfigId,
		summarizeConfigId,
		summarizeConfigType,
		graphBuildConfigId,
		sessionId
	} = params

	let overrideConnectionId: number | null = null
	let overrideSamplingId: number | null = null
	/**
	 * Which of the two tiers above the default supplied the pair.
	 *
	 * One pair rather than two, because the `if` below is an either/or: a session
	 * that set ANYTHING stops the config layer being consulted at all. That is
	 * pre-existing behaviour and deliberately left alone here, but the resolver
	 * wants to know which tier it is looking at — the failure sentence names
	 * where a bad value was set, and "the pipeline's configuration" pointed at a
	 * session override would send somebody to the wrong screen.
	 */
	let overrideTier: "pipelineConfig" | "sessionOverride" = "pipelineConfig"

	// ── Session-level override (highest priority) ────────────────────────────────
	if (sessionId) {
		const session = await db.query.sessions.findFirst({
			where: (c, { eq }) => eq(c.id, sessionId),
			columns: { connectionId: true, samplingConfigId: true }
		})
		overrideConnectionId = session?.connectionId ?? null
		overrideSamplingId = session?.samplingConfigId ?? null
		if (overrideConnectionId || overrideSamplingId)
			overrideTier = "sessionOverride"
	}

	// ── Prompt/config-level override ──────────────────────────────────────────
	if (!overrideConnectionId && !overrideSamplingId) {
		if (taskType === "session" && promptConfigId) {
			const cfg = await db.query.promptConfigs.findFirst({
				where: (c, { eq }) => eq(c.id, promptConfigId),
				columns: { connectionId: true, samplingConfigId: true }
			})
			overrideConnectionId = cfg?.connectionId ?? null
			overrideSamplingId = cfg?.samplingConfigId ?? null
		} else if (taskType === "narratorPrompt" && narratorPromptConfigId) {
			const cfg = await db.query.narratorPromptConfigs.findFirst({
				where: (c, { eq }) => eq(c.id, narratorPromptConfigId),
				columns: { connectionId: true, samplingConfigId: true }
			})
			overrideConnectionId = cfg?.connectionId ?? null
			overrideSamplingId = cfg?.samplingConfigId ?? null
		} else if (
			(taskType.startsWith("summarize_") ||
				// character_extraction doesn't carry a "summarize_" prefix
				// (it's shared with the graph-builder's own extraction call,
				// see graph_* below) — only the scene config table has
				// dedicated override columns for it, since only scene
				// summarization has a character-extraction sub-task.
				(taskType === "character_extraction" &&
					summarizeConfigType === "scene")) &&
			summarizeConfigId &&
			summarizeConfigType
		) {
			const subTask =
				taskType === "character_extraction"
					? "characterExtraction"
					: (taskType.replace("summarize_", "") as
							| "batch"
							| "synth"
							| "name")
			type SumCfgCols = {
				batchConnectionId: number | null
				batchSamplingConfigId: number | null
				synthConnectionId: number | null
				synthSamplingConfigId: number | null
				nameConnectionId: number | null
				nameSamplingConfigId: number | null
				characterExtractionConnectionId?: number | null
				characterExtractionSamplingConfigId?: number | null
			}
			let cfg: SumCfgCols | undefined
			if (summarizeConfigType === "world") {
				cfg = (await db.query.worldSummarizeConfigs.findFirst({
					where: (c, { eq }) => eq(c.id, summarizeConfigId!),
					columns: {
						batchConnectionId: true,
						batchSamplingConfigId: true,
						synthConnectionId: true,
						synthSamplingConfigId: true,
						nameConnectionId: true,
						nameSamplingConfigId: true
					}
				})) as SumCfgCols | undefined
			} else if (summarizeConfigType === "character") {
				cfg = (await db.query.characterSummarizeConfigs.findFirst({
					where: (c, { eq }) => eq(c.id, summarizeConfigId!),
					columns: {
						batchConnectionId: true,
						batchSamplingConfigId: true,
						synthConnectionId: true,
						synthSamplingConfigId: true,
						nameConnectionId: true,
						nameSamplingConfigId: true
					}
				})) as SumCfgCols | undefined
			} else {
				cfg = (await db.query.sceneSummarizeConfigs.findFirst({
					where: (c, { eq }) => eq(c.id, summarizeConfigId!),
					columns: {
						batchConnectionId: true,
						batchSamplingConfigId: true,
						synthConnectionId: true,
						synthSamplingConfigId: true,
						nameConnectionId: true,
						nameSamplingConfigId: true,
						characterExtractionConnectionId: true,
						characterExtractionSamplingConfigId: true
					}
				})) as SumCfgCols | undefined
			}
			overrideConnectionId = cfg?.[`${subTask}ConnectionId`] ?? null
			overrideSamplingId = cfg?.[`${subTask}SamplingConfigId`] ?? null
		} else if (taskType.startsWith("graph_") && graphBuildConfigId) {
			// Explicit map, not a ternary. This was
			// `taskType === "graph_pre_filter" ? "preFilter" : "perspective"`,
			// which silently resolved every graph step that was not the
			// pre-filter to the perspective columns — so a new task type would
			// have inherited perspective's model and sampling without any
			// indication it had not been wired up.
			const subTask = GRAPH_TASK_SUBTASK[taskType]
			if (!subTask) {
				throw new Error(
					`resolveTaskConfig: no graphBuildConfigs sub-task mapped for "${taskType}"`
				)
			}
			const cfg = await db.query.graphBuildConfigs.findFirst({
				where: (c, { eq }) => eq(c.id, graphBuildConfigId),
				columns: {
					[`${subTask}ConnectionId`]: true,
					[`${subTask}SamplingConfigId`]: true
				} as any
			})
			overrideConnectionId =
				(cfg as any)?.[`${subTask}ConnectionId`] ?? null
			overrideSamplingId =
				(cfg as any)?.[`${subTask}SamplingConfigId`] ?? null
		}
	}

	// ── The instance's capability default, and the guard ──────────────────────
	//
	// This block used to be `overrideConnectionId ?? systemSettings
	// .defaultConnectionId`, plus two `findFirst`s, and it neither checked that
	// the row still existed nor that the connection could do chat. Both are now
	// the resolver's, along with the sentence for each way it can go wrong.
	// Merged per HALF, not as a pair, because the resolver walks the two
	// independently: a node that names a connection but no sampling profile must
	// keep the instance's sampling default rather than clearing it.
	const candidate: CapabilityCandidate = {
		connectionId: params.pipelineConnectionId ?? overrideConnectionId,
		samplingConfigId: params.pipelineSamplingId ?? overrideSamplingId
	}
	const target = await resolveCapabilityTarget(db, {
		capability: TEXT_CAPABILITY,
		...(overrideTier === "sessionOverride"
			? { sessionOverride: candidate }
			: { pipelineConfig: candidate })
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
