import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

/**
 * Gets user's active context/prompt configurations with fallback to system defaults.
 * Connection and sampling config are resolved separately via resolveTaskConfig.
 */
export async function getUserConfigurations(
	userId: number,
	retryCount = 0
): Promise<{
	connection: SelectConnection | null
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	narratorPromptConfig: SelectNarratorPromptConfig | null
}> {
	try {
		const [userSettings, systemSettings] = await Promise.all([
			db.query.userSettings.findFirst({
				where: (us, { eq }) => eq(us.userId, userId)
			}),
			db.query.systemSettings.findFirst()
		])

		// Resolve context config (userSettings -> systemSettings fallback)
		const contextConfigId =
			userSettings?.activeContextConfigId ??
			systemSettings?.defaultContextConfigId
		const contextConfig = contextConfigId
			? await db.query.contextConfigs.findFirst({
					where: (cc, { eq }) => eq(cc.id, contextConfigId)
				})
			: undefined

		// Resolve prompt config (userSettings -> systemSettings fallback)
		const promptConfigId =
			userSettings?.activePromptConfigId ??
			systemSettings?.defaultPromptConfigId
		const promptConfig = promptConfigId
			? await db.query.promptConfigs.findFirst({
					where: (pc, { eq }) => eq(pc.id, promptConfigId)
				})
			: undefined

		// Resolve narrator prompt config (userSettings -> systemSettings fallback).
		// Optional — a session can generate normally without one configured; only
		// triggering a Narrator response actually requires it.
		const narratorPromptConfigId =
			userSettings?.activeNarratorPromptConfigId ??
			systemSettings?.defaultNarratorPromptConfigId
		const narratorPromptConfig = narratorPromptConfigId
			? await db.query.narratorPromptConfigs.findFirst({
					where: (c, { eq }) => eq(c.id, narratorPromptConfigId)
				})
			: undefined

		// Resolve connection + sampling from system default (no per-user override anymore)
		const connection = systemSettings?.defaultConnectionId
			? await db.query.connections.findFirst({
					where: (c, { eq }) =>
						eq(c.id, systemSettings.defaultConnectionId!)
				})
			: undefined

		const sampling = systemSettings?.defaultSamplingConfigId
			? await db.query.samplingConfigs.findFirst({
					where: (sc, { eq }) =>
						eq(sc.id, systemSettings.defaultSamplingConfigId!)
				})
			: undefined

		if (!sampling || !contextConfig || !promptConfig) {
			throw new Error(
				`Missing required configuration for user ${userId}:${!sampling ? " sampling" : ""}${!contextConfig ? " context" : ""}${!promptConfig ? " prompt" : ""}`
			)
		}

		return {
			connection: connection ?? null,
			sampling,
			contextConfig,
			promptConfig,
			narratorPromptConfig: narratorPromptConfig ?? null
		}
	} catch (error: any) {
		if (
			retryCount === 0 &&
			error.message?.includes("Missing required configuration")
		) {
			console.warn(
				`Detected missing configurations for user ${userId}, attempting to fix system settings...`
			)
			try {
				const systemSettings = await db.query.systemSettings.findFirst({
					where: (s, { eq }) => eq(s.id, 1)
				})
				if (!systemSettings) {
					await db.insert(schema.systemSettings).values({
						id: 1,
						defaultConnectionId: null,
						defaultSamplingConfigId: 1,
						defaultContextConfigId: 1,
						defaultPromptConfigId: 1
					})
				} else {
					const updates: any = {}
					if (!systemSettings.defaultSamplingConfigId)
						updates.defaultSamplingConfigId = 1
					if (!systemSettings.defaultContextConfigId)
						updates.defaultContextConfigId = 1
					if (!systemSettings.defaultPromptConfigId)
						updates.defaultPromptConfigId = 1
					if (Object.keys(updates).length > 0) {
						await db
							.update(schema.systemSettings)
							.set(updates)
							.where(eq(schema.systemSettings.id, 1))
					}
				}
				return await getUserConfigurations(userId, retryCount + 1)
			} catch (fixError: any) {
				console.error("Failed to fix system settings:", fixError)
				throw error
			}
		}
		throw error
	}
}
