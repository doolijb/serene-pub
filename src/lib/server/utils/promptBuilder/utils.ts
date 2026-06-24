import type { ChatCompletionMessageParam } from "openai/resources/index.mjs"

/**
 * Parse a split chat prompt into OpenAI chat format.
 * Injects a synthetic `[Continue]` user turn between consecutive assistant
 * messages — chat completion APIs (Ollama, OpenAI, etc.) reject requests with
 * 2+ adjacent same-role messages, which happens in multi-character chats where
 * several characters respond in a row. Using a continuation prompt rather than
 * merging preserves the alternating turn structure the model expects.
 */
export function parseSplitChatPrompt(
	prompt: string
): ChatCompletionMessageParam[] {
	const blocks = prompt.split(/(?=<@role:(user|assistant|system)>\s*)/g)
	const parsed = blocks
		.map((block) => {
			const match = block.match(
				/^<@role:(user|assistant|system)>\s*([\s\S]*)$/
			)
			return match ? { role: match[1], content: match[2].trim() } : null
		})
		.filter(Boolean) as ChatCompletionMessageParam[]

	// Only inject synthetic [Continue] turns in the trailing run of assistant
	// messages (i.e. after the last user message). Older history is left intact
	// so the model's perception of the conversation structure is not distorted.
	const lastUserIdx = parsed.reduce(
		(acc, msg, i) => (msg.role === "user" ? i : acc),
		-1
	)
	const head = lastUserIdx >= 0 ? parsed.slice(0, lastUserIdx + 1) : []
	const tail = parsed.slice(lastUserIdx + 1)

	const fixedTail: ChatCompletionMessageParam[] = []
	for (const msg of tail) {
		const prev = fixedTail[fixedTail.length - 1]
		if (prev && prev.role === msg.role) {
			fixedTail.push({ role: "user", content: "[Continue]" })
		}
		fixedTail.push(msg)
	}

	return [...head, ...fixedTail]
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
export function hasLorebookEntries(
	lorebook: any
): lorebook is SelectLorebook & {
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
