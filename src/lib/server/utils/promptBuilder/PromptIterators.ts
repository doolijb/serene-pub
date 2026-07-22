// PromptIterators.ts
// Contains iterator generator functions for PromptBuilder modularization
import type { BasePromptChat } from "../../connectionAdapters/BaseConnectionAdapter"

export function* chatMessageIterator({
	chat,
	priority
}: {
	chat: BasePromptChat
	priority: number
}): IterableIterator<SelectChatMessage> {
	const messages = chat.chatMessages || []
	if (priority === 4) {
		// If there are 3 or fewer messages, yield all in reverse order
		if (messages.length <= 3) {
			for (const msg of messages.slice().reverse()) {
				yield msg
			}
		} else {
			for (const msg of messages.slice(-3).reverse()) {
				yield msg
			}
		}
	} else if (priority === 2) {
		// If there are 3 or fewer messages, yield none
		if (messages.length <= 3) {
			// yield nothing
		} else {
			for (const msg of messages.slice(0, -3).reverse()) {
				yield msg
			}
		}
	}
}

export function* worldLoreEntryIterator({
	chat,
	priority
}: {
	chat: BasePromptChat
	priority: number
}): IterableIterator<SelectWorldLoreEntry> {
	const chatWithLorebook = chat as typeof chat & {
		lorebook?: { worldLoreEntries: SelectWorldLoreEntry[] }
	}
	const entries: SelectWorldLoreEntry[] =
		chatWithLorebook.lorebook?.worldLoreEntries || []
	let filtered: SelectWorldLoreEntry[] = []
	if (priority === 4) {
		filtered = entries.filter((e) => e.constant === true)
	} else if ([3, 2, 1].includes(priority)) {
		filtered = entries.filter((e) => e.priority === priority)
	}
	filtered.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
	for (const entry of filtered) {
		yield entry
	}
}

export function* characterLoreEntryIterator({
	chat,
	priority
}: {
	chat: BasePromptChat
	priority: number
}): IterableIterator<SelectCharacterLoreEntry> {
	const chatWithLorebook = chat as typeof chat & {
		lorebook?: { characterLoreEntries: SelectCharacterLoreEntry[] }
	}
	const entries: SelectCharacterLoreEntry[] =
		chatWithLorebook.lorebook?.characterLoreEntries || []
	let filtered: SelectCharacterLoreEntry[] = []
	if (priority === 4) {
		filtered = entries.filter((e) => e.constant === true)
	} else if ([3, 2, 1].includes(priority)) {
		filtered = entries.filter((e) => e.priority === priority)
	}
	filtered = filtered.filter((e) => {
		if (!e.lorebookBindingId) return false
		const lorebook =
			chat.lorebookId === e.lorebookId ? chat.lorebook : undefined
		if (!lorebook) return false
		const binding = lorebook.lorebookBindings.find(
			(b: SelectLorebookBinding) => b.id === e.lorebookBindingId
		)
		if (!binding) return false
		if (binding.characterId) {
			return chat.chatCharacters?.some(
				(cc) => cc.character.id === binding.characterId
			)
		} else if (binding.personaId) {
			return chat.chatPersonas?.some(
				(cp) => cp.persona.id === binding.personaId
			)
		}
		return false
	})
	filtered.sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
	for (const entry of filtered) {
		yield entry
	}
}

export function* historyEntryIterator({
	chat,
	priority
}: {
	chat: BasePromptChat
	priority: number
}): IterableIterator<SelectHistoryEntry> {
	const chatWithLorebook = chat as typeof chat & {
		lorebook?: { historyEntries: SelectHistoryEntry[] }
	}
	const entries: SelectHistoryEntry[] =
		chatWithLorebook.lorebook?.historyEntries || []
	const sorted = entries.slice().sort((a, b) => {
		const aVal = (a.year ?? 0) * 10000 + (a.month ?? 0) * 100 + (a.day ?? 0)
		const bVal = (b.year ?? 0) * 10000 + (b.month ?? 0) * 100 + (b.day ?? 0)
		return bVal - aVal
	})
	if (priority === 4) {
		yield sorted[0]
		for (const entry of sorted.filter((e) => e.constant === true)) {
			yield entry
		}
	} else if (priority === 2) {
		const yielded = [
			sorted.slice(0, 1),
			...sorted.filter((e) => e.constant === true)
		]
		for (const entry of sorted) {
			if (!yielded.includes(entry)) {
				yield entry
			}
		}
	}
}
