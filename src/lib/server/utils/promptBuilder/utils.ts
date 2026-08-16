import type { ChatCompletionMessageParam } from "openai/resources/index.mjs"
import { ROLE_MARKER_PATTERN } from "$lib/shared/utils/PromptBlockFormatter"

// Every rendered message block follows the same "Name: message" convention
// (see assistantBlock/userBlock in defaults.ts's context templates) — used
// to pull the upcoming speaker's name back out for the synthetic handoff
// turn below, so it can address them by name instead of a generic directive.
// The trailing `(?:\s|$)` (not just `\s`) matters: the seed/placeholder turn
// at the very end of a prompt renders as a bare "Name:" with no message yet
// (an empty continuation to be completed) — content is `.trim()`-med
// upstream, so there's no trailing space left for a plain `\s` to match.
const SPEAKER_NAME_PATTERN = /^([^:\n]+):(?:\s|$)/

function extractSpeakerName(content: string): string | null {
	const match = content.match(SPEAKER_NAME_PATTERN)
	return match ? match[1].trim() : null
}

/**
 * Parse a split chat prompt into OpenAI chat format.
 * Injects a synthetic handoff user turn between consecutive assistant
 * messages — chat completion APIs (Ollama, OpenAI, etc.) reject requests with
 * 2+ adjacent same-role messages, which happens in multi-character chats where
 * several characters (or a character then the Narrator) respond in a row.
 *
 * The handoff turn names the upcoming speaker directly — "[Your turn,
 * Narrator]" rather than a generic "[Continue]" — deliberately avoiding any
 * wording that reads as an instruction to advance the plot/story. A literal
 * "[Continue]" was found to actively undermine a Narrator config's own "do
 * not move the plot forward" instruction: the model doesn't distinguish a
 * synthetic structural bridge from a real user directive, so the last thing
 * it sees before generating was, in effect, being told to keep the story
 * moving — the opposite of what a narrate-only turn needs.
 *
 * Merging consecutive same-role turns into one combined message was
 * considered and rejected — that teaches the model multiple named speakers
 * can share a single turn, eroding the one-turn-one-speaker boundary the
 * rest of the prompt structure relies on to keep voices separate.
 */
export function parseSplitChatPrompt(
	prompt: string
): ChatCompletionMessageParam[] {
	const blocks = prompt.split(
		new RegExp(`(?=${ROLE_MARKER_PATTERN}\\s*)`, "g")
	)
	const parsed = blocks
		.map((block) => {
			const match = block.match(
				new RegExp(`^${ROLE_MARKER_PATTERN}\\s*([\\s\\S]*)$`)
			)
			return match ? { role: match[1], content: match[2].trim() } : null
		})
		.filter(Boolean) as ChatCompletionMessageParam[]

	// Only inject synthetic handoff turns in the trailing run of assistant
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
			const upcomingSpeaker = extractSpeakerName(
				(msg.content as string) ?? ""
			)
			fixedTail.push({
				role: "user",
				content: upcomingSpeaker
					? `[Your turn, ${upcomingSpeaker}]`
					: "[Your turn]"
			})
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
