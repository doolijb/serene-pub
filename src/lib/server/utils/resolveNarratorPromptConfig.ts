import { db } from "$lib/server/db"
import { getUserConfigurations } from "./getUserConfigurations"

/**
 * Resolves the "Session Prompts: Narrator" config that should be used for a given
 * session + user: the session's own override (set via Edit Session) always wins;
 * otherwise falls back to the requesting user's active config, then the
 * system default (same chain as every other per-session override in the app —
 * see resolveTaskConfig.ts's session-level connection/sampling override).
 *
 * Shared by generateResponse.ts (actual generation), triggerNarratorResponseHandler
 * (stamping the display name onto a new message), and the
 * sessions:getNarratorName handler (previewing the name before triggering).
 */
export async function resolveNarratorPromptConfig(
	session: { narratorPromptConfigId?: number | null } | null | undefined,
	userId: number
): Promise<SelectNarratorPromptConfig | null> {
	if (session?.narratorPromptConfigId) {
		const override = await db.query.narratorPromptConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, session.narratorPromptConfigId!)
		})
		if (override) return override
	}

	const { narratorPromptConfig } = await getUserConfigurations(userId)
	return narratorPromptConfig
}
