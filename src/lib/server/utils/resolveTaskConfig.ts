import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"

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
 * Resolution order (first non-null wins):
 *   session override → prompt/summarize/graphBuild config sub-task → system default
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

	const systemSettings = await db.query.systemSettings.findFirst()

	let overrideConnectionId: number | null = null
	let overrideSamplingId: number | null = null

	// ── Session-level override (highest priority) ────────────────────────────────
	if (sessionId) {
		const session = await db.query.sessions.findFirst({
			where: (c, { eq }) => eq(c.id, sessionId),
			columns: { connectionId: true, samplingConfigId: true }
		})
		overrideConnectionId = session?.connectionId ?? null
		overrideSamplingId = session?.samplingConfigId ?? null
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

	// ── System default (fallback) ─────────────────────────────────────────────
	const connectionId =
		overrideConnectionId ?? systemSettings?.defaultConnectionId ?? null
	const samplingId =
		overrideSamplingId ?? systemSettings?.defaultSamplingConfigId ?? null

	const [connection, sampling] = await Promise.all([
		connectionId
			? db.query.connections.findFirst({
					where: (c, { eq }) => eq(c.id, connectionId)
				})
			: Promise.resolve(undefined),
		samplingId
			? db.query.samplingConfigs.findFirst({
					where: (c, { eq }) => eq(c.id, samplingId)
				})
			: Promise.resolve(undefined)
	])

	return {
		connection: connection ?? null,
		sampling: sampling ?? null,
		connectionName: connection?.name ?? "System default",
		samplingName: sampling?.name ?? "System default"
	}
}
