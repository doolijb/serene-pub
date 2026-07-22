import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"

export type TaskType =
	| "chat"
	| "narratorPrompt"
	| "chat_title"
	| "field_generation"
	| "summarize_batch"
	| "summarize_synth"
	| "summarize_name"
	| "character_extraction"
	| "graph_pre_filter"
	| "graph_perspective"

export interface ResolvedTaskConfig {
	connection: SelectConnection | null
	sampling: SelectSamplingConfig | null
	/** Human-readable label for task queue display */
	connectionName: string
	samplingName: string
}

/**
 * Resolves connection + sampling for a given task context.
 *
 * Resolution order (first non-null wins):
 *   chat override → prompt/summarize/graphBuild config sub-task → system default
 */
export async function resolveTaskConfig(params: {
	taskType: TaskType
	/** ID of the prompt config (chat generation) */
	promptConfigId?: number | null
	/** ID of the narrator prompt config (Narrator response generation) */
	narratorPromptConfigId?: number | null
	/** ID of the active summarize config (summarization tasks) */
	summarizeConfigId?: number | null
	/** Type of summarize config table */
	summarizeConfigType?: "world" | "character" | "scene"
	/** ID of the graph build config */
	graphBuildConfigId?: number | null
	/** ID of the chat (optional per-chat override) */
	chatId?: number | null
}): Promise<ResolvedTaskConfig> {
	const {
		taskType,
		promptConfigId,
		narratorPromptConfigId,
		summarizeConfigId,
		summarizeConfigType,
		graphBuildConfigId,
		chatId
	} = params

	const systemSettings = await db.query.systemSettings.findFirst()

	let overrideConnectionId: number | null = null
	let overrideSamplingId: number | null = null

	// ── Chat-level override (highest priority) ────────────────────────────────
	if (chatId) {
		const chat = await db.query.chats.findFirst({
			where: (c, { eq }) => eq(c.id, chatId),
			columns: { connectionId: true, samplingConfigId: true }
		})
		overrideConnectionId = chat?.connectionId ?? null
		overrideSamplingId = chat?.samplingConfigId ?? null
	}

	// ── Prompt/config-level override ──────────────────────────────────────────
	if (!overrideConnectionId && !overrideSamplingId) {
		if (taskType === "chat" && promptConfigId) {
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
			taskType.startsWith("summarize_") &&
			summarizeConfigId &&
			summarizeConfigType
		) {
			const subTask = taskType.replace("summarize_", "") as
				| "batch"
				| "synth"
				| "name"
			type SumCfgCols = {
				batchConnectionId: number | null
				batchSamplingConfigId: number | null
				synthConnectionId: number | null
				synthSamplingConfigId: number | null
				nameConnectionId: number | null
				nameSamplingConfigId: number | null
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
						nameSamplingConfigId: true
					}
				})) as SumCfgCols | undefined
			}
			overrideConnectionId = cfg?.[`${subTask}ConnectionId`] ?? null
			overrideSamplingId = cfg?.[`${subTask}SamplingConfigId`] ?? null
		} else if (taskType.startsWith("graph_") && graphBuildConfigId) {
			const subTask =
				taskType === "graph_pre_filter" ? "preFilter" : "perspective"
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
