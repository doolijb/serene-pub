import { db } from "$lib/server/db"
import { getUserConfigurations } from "./getUserConfigurations"

/**
 * Resolves the "Chat Prompts: World" config that should be used for a given
 * chat + user: the chat's own override (set via Edit Chat) always wins;
 * otherwise falls back to the requesting user's active config, then the
 * system default (same chain as every other per-chat override in the app —
 * see resolveTaskConfig.ts's chat-level connection/sampling override).
 *
 * Shared by generateResponse.ts (actual generation), triggerWorldResponseHandler
 * (stamping the display name onto a new message), and the
 * chats:getWorldNarratorName handler (previewing the name before triggering).
 */
export async function resolveChatWorldPromptConfig(
	chat: { chatWorldPromptConfigId?: number | null } | null | undefined,
	userId: number
): Promise<SelectChatWorldPromptConfig | null> {
	if (chat?.chatWorldPromptConfigId) {
		const override = await db.query.chatWorldPromptConfigs.findFirst({
			where: (c, { eq }) => eq(c.id, chat.chatWorldPromptConfigId!)
		})
		if (override) return override
	}

	const { chatWorldPromptConfig } = await getUserConfigurations(userId)
	return chatWorldPromptConfig
}
