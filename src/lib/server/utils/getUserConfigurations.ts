import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

/**
 * Gets user's active configurations with fallback to system defaults
 */
export async function getUserConfigurations(userId: number, retryCount = 0): Promise<{
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
}> {
	try {
		// Get user settings
		const userSettings = await db.query.userSettings.findFirst({
			where: (us, { eq }) => eq(us.userId, userId)
		})

		// Get system settings for fallback values
		const systemSettings = await db.query.systemSettings.findFirst()

		// Resolve active configurations with fallback to system defaults
		let activeConnection: SelectConnection | undefined
		let activeSamplingConfig: SelectSamplingConfig | undefined
		let activeContextConfig: SelectContextConfig | undefined
		let activePromptConfig: SelectPromptConfig | undefined

		// Get active connection (userSettings -> systemSettings fallback)
		const activeConnectionId =
			userSettings?.activeConnectionId ?? systemSettings?.defaultConnectionId
		if (activeConnectionId) {
			activeConnection = await db.query.connections.findFirst({
				where: (c, { eq }) => eq(c.id, activeConnectionId)
			})
		}

		// Get active sampling config (userSettings -> systemSettings fallback)
		const activeSamplingConfigId =
			userSettings?.activeSamplingConfigId ??
			systemSettings?.defaultSamplingConfigId
		if (activeSamplingConfigId) {
			activeSamplingConfig = await db.query.samplingConfigs.findFirst({
				where: (sc, { eq }) => eq(sc.id, activeSamplingConfigId)
			})
		}

		// Get active context config (userSettings -> systemSettings fallback)
		const activeContextConfigId =
			userSettings?.activeContextConfigId ??
			systemSettings?.defaultContextConfigId
		if (activeContextConfigId) {
			activeContextConfig = await db.query.contextConfigs.findFirst({
				where: (cc, { eq }) => eq(cc.id, activeContextConfigId)
			})
		}

		// Get active prompt config (userSettings -> systemSettings fallback)
		const activePromptConfigId =
			userSettings?.activePromptConfigId ??
			systemSettings?.defaultPromptConfigId
		if (activePromptConfigId) {
			activePromptConfig = await db.query.promptConfigs.findFirst({
				where: (pc, { eq }) => eq(pc.id, activePromptConfigId)
			})
		}

		// Ensure we have all required configurations
		if (
			!activeConnection ||
			!activeSamplingConfig ||
			!activeContextConfig ||
			!activePromptConfig
		) {
			throw new Error(
				`Missing required configuration for user ${userId}: ${!activeConnection ? "connection " : ""}${!activeSamplingConfig ? "sampling " : ""}${!activeContextConfig ? "context " : ""}${!activePromptConfig ? "prompt" : ""}`
			)
		}

		return {
			connection: activeConnection,
			sampling: activeSamplingConfig,
			contextConfig: activeContextConfig,
			promptConfig: activePromptConfig
		}
	} catch (error: any) {
		// If this is the first attempt and we're missing configurations, try to fix the database
		if (retryCount === 0 && error.message?.includes('Missing required configuration')) {
			console.warn(`Detected missing configurations for user ${userId}, attempting to fix system settings...`)
			
			try {
				// Check if system settings exist
				const systemSettings = await db.query.systemSettings.findFirst({
					where: (s, { eq }) => eq(s.id, 1)
				})

				if (!systemSettings) {
					// Create system settings with defaults
					await db.insert(schema.systemSettings).values({
						id: 1,
						ollamaManagerEnabled: true,
						ollamaManagerBaseUrl: "http://localhost:11434/",
						defaultConnectionId: null,
						defaultSamplingConfigId: 1,
						defaultContextConfigId: 1,
						defaultPromptConfigId: 1
					})
					console.log('Created missing system settings')
				} else {
					// Update existing system settings with missing defaults
					const updates: any = {}
					if (!systemSettings.defaultSamplingConfigId) {
						updates.defaultSamplingConfigId = 1
					}
					if (!systemSettings.defaultContextConfigId) {
						updates.defaultContextConfigId = 1
					}
					if (!systemSettings.defaultPromptConfigId) {
						updates.defaultPromptConfigId = 1
					}

					if (Object.keys(updates).length > 0) {
						await db
							.update(schema.systemSettings)
							.set(updates)
							.where(eq(schema.systemSettings.id, 1))
						console.log('Updated system settings with missing defaults:', updates)
					}
				}

				// Retry once after fixing
				return await getUserConfigurations(userId, retryCount + 1)
			} catch (fixError: any) {
				console.error('Failed to fix system settings:', fixError)
				throw error // Throw original error if fix fails
			}
		}

		// If we've already retried or it's a different error, rethrow
		throw error
	}
}
