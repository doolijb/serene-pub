import type { ChatCompletionMessageParam } from "openai/resources/index.mjs"

/**
 * Parse a split chat prompt into OpenAI chat format
 */
export function parseSplitChatPrompt(prompt: string): ChatCompletionMessageParam[] {
	const blocks = prompt.split(/(?=<@role:(user|assistant|system)>\s*)/g)
	// TODO: populate the name param, but local models may ignore it anyway
	const messages = blocks
		.map((block) => {
			const match = block.match(
				/^<@role:(user|assistant|system)>\s*([\s\S]*)$/
			)
			return match ? { role: match[1], content: match[2].trim() } : null
		})
		.filter(Boolean)

	return messages as ChatCompletionMessageParam[]
}

/**
 * Type guard for history entries
 */
export function isHistoryEntry(entry: any): entry is SelectHistoryEntry {
	return entry && typeof entry === "object" && "date" in entry
}

/**
 * Helper type guard for extended lorebook
 */
export function hasLorebookEntries(lorebook: any): lorebook is SelectLorebook & {
	worldLoreEntries: SelectWorldLoreEntry[]
	characterLoreEntries: SelectCharacterLoreEntry[]
	historyEntries: SelectHistoryEntry[]
} {
	return (
		lorebook &&
		Array.isArray(lorebook.worldLoreEntries) &&
		Array.isArray(lorebook.characterLoreEntries) &&
		Array.isArray(lorebook.historyEntries)
	)
}
