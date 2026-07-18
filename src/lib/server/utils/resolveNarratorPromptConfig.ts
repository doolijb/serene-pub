import { db } from "$lib/server/db"
import { getUserConfigurations } from "./getUserConfigurations"

/**
 * Resolves the "Chat Prompts: Narrator" config that should be used for a given
 * chat + user: the chat's own override (set via Edit Chat) always wins;
 * otherwise falls back to the requesting user's active config, then the
 * system default (same chain as every other per-chat override in the app —
 * see resolveTaskConfig.ts's chat-level connection/sampling override).
 *
 * Shared by generateResponse.ts (actual generation), triggerNarratorResponseHandler
 * (stamping the display name onto a new message), and the
 * chats:getNarratorName handler (previewing the name before triggering).
 */
export async function resolveNarratorPromptConfig(
	chat: { narratorPromptConfigId?: number | null } | null | undefined,
	userId: number
): Promise<SelectNarratorPromptConfig | null> {
	if (chat?.narratorPromptConfigId) {
		const override = await db.query.narratorPromptConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, chat.narratorPromptConfigId!)
		})
		if (override) return override
	}

	const { narratorPromptConfig } = await getUserConfigurations(userId)
	return narratorPromptConfig
}
