import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

/**
 * The user's active context/prompt configurations, with fallback to the system
 * defaults. The 0.5 archives, in other words — three columns on
 * `system_settings` that still point at three legacy tables.
 *
 * ⚠ It used to hand back a `connection` and a `sampling` too, read from
 * `system_settings.default_connection_id` / `default_sampling_id`. Those columns
 * are gone (0181) and, more to the point, so is the arrangement: this was a
 * SECOND reading of the instance default sitting beside `resolveTaskConfig`'s,
 * and the two were only ever equal because they read the same column. Both call
 * sites promptly used it as a fourth resolution tier — `resolved.sampling ??
 * defaultSampling` in `dispatch.ts`, `synthCfg?.connection ?? connection` in
 * `scenes.ts` — which was a no-op right up until it wouldn't have been.
 *
 * Connection and sampling come from `resolveCapabilityTarget` now, through
 * `resolveTaskConfig` or directly. There is one chain and this is not on it.
 */
export async function getUserConfigurations(
	userId: number,
	retryCount = 0
): Promise<{
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

		if (!contextConfig || !promptConfig) {
			throw new Error(
				`Missing required configuration for user ${userId}:${!contextConfig ? " context" : ""}${!promptConfig ? " prompt" : ""}`
			)
		}

		return {
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
				// ⚠ `defaultSamplingConfigId: 1` used to be here, and it was two
				// rule violations in one line: a hardcoded row id (nothing
				// guarantees the seeded sampling config is at id 1 — see
				// `defaults.ts`, which resolves every seeded row by `seedKey`
				// precisely because a repair pointed at an id once overwrote a
				// user's config), and a REPAIR path writing an instance default,
				// which is now a `connection_defaults` row that only
				// `db/defaults.ts` seeds and only by seedKey.
				//
				// The two context/prompt ids below are the same violation and are
				// deliberately left: they point at the 0.5 archive tables, and
				// unpicking them is its own change. Recorded rather than fixed by
				// halves.
				if (!systemSettings) {
					await db.insert(schema.systemSettings).values({
						id: 1,
						defaultContextConfigId: 1,
						defaultPromptConfigId: 1
					})
				} else {
					const updates: any = {}
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
