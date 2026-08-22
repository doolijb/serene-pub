/**
 * Lore bindings, and the two transforms a lore entry needs before a model sees
 * it: decorator stripping and `{{char:#}}` substitution.
 *
 * Moved out of `promptBuilder/LorebookBindingUtils.ts` — the pipeline is now the
 * primary consumer (`host.ts` normalises every lore read through
 * `populateLorebookEntryBindings`, and `templateContext.ts` folds bound lore
 * into the cast), and the legacy engines borrow it until they are deleted.
 */
import type { BasePromptChat } from "$lib/server/connectionAdapters/BaseConnectionAdapter"
import type {
	TemplateContextCharacter,
	TemplateContextPersona
} from "./promptTypes"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { stripCardDecorators } from "$lib/shared/utils/characterCardDecorators"

export function populateLorebookEntryBindings(
	entry: SelectWorldLoreEntry | SelectCharacterLoreEntry | SelectHistoryEntry,
	chat: BasePromptChat
): SelectWorldLoreEntry | SelectCharacterLoreEntry | SelectHistoryEntry {
	// Applies regardless of whether {{char:#}} binding substitution below
	// also applies (the early return right after this doesn't cover every
	// entry), since decorator lines must never leak into the rendered
	// prompt as literal text either way.
	entry.content = stripCardDecorators(entry.content).content

	const lorebook =
		chat.lorebook && chat.lorebook.id === entry.lorebookId
			? chat.lorebook
			: undefined
	if (!lorebook) return entry

	// Handle {{char:#}} syntax by replacing with actual character names
	lorebook.lorebookBindings.forEach((binding) => {
		if (binding.character) {
			const name = resolveCharacterName(binding.character)
			// Extract the number from the binding string (e.g., "{{char:1}}")
			const bindingMatch = binding.binding.match(/\{\{char:(\d+)\}\}/)
			if (bindingMatch) {
				const bindingNumber = bindingMatch[1]
				// Replace {{char:#}} syntax
				entry.content = entry.content.replaceAll(
					`{{char:${bindingNumber}}}`,
					name
				)
			}
		} else if (binding.persona) {
			const name = binding.persona.name
			// Extract the number from the binding string (e.g., "{{char:1}}")
			const bindingMatch = binding.binding.match(/\{\{char:(\d+)\}\}/)
			if (bindingMatch) {
				const bindingNumber = bindingMatch[1]
				// Replace {{char:#}} syntax
				entry.content = entry.content.replaceAll(
					`{{char:${bindingNumber}}}`,
					name
				)
			}
		}
	})

	// Then handle direct binding replacements (legacy approach)
	lorebook.lorebookBindings.forEach((binding) => {
		if (binding.character) {
			const name = resolveCharacterName(binding.character)
			entry.content = entry.content.replaceAll(binding.binding, name)
		} else if (binding.persona) {
			const name = binding.persona.name
			entry.content = entry.content.replaceAll(binding.binding, name)
		}
	})
	return entry
}

/**
 * Character-lore privacy rule, shared by KeywordInfillEngine and
 * RagInfillEngine: a characterLoreEntry bound to a specific character is
 * that character's own private self-knowledge — visible only when
 * generating as that exact character, regardless of chatCharacters.visibility
 * (HIDDEN/MINIMAL only governs description-block display, not lore) or
 * whether that character is even attached to this chat. World lore has no
 * such binding and is never gated by this function.
 *
 * A binding with neither characterId nor personaId is a background/NPC
 * row — its lore is visible only to the Narrator (currentCharacterId ===
 * null, i.e. no-perspective mode), since no specific character can know
 * about a background character's private knowledge, but the omniscient
 * Narrator can. An entry with no lorebookBindingId at all (not bound to
 * any row) stays invisible in every mode — there's no legitimate consumer
 * for it, narrator included.
 */
export function isCharacterLoreEntryVisible(
	entry: SelectCharacterLoreEntry,
	chat: BasePromptChat,
	currentCharacterId: number | null
): boolean {
	if (!entry.lorebookBindingId) return false
	const lorebook = chat.lorebook
	if (!lorebook) return false
	if (chat.lorebookId !== entry.lorebookId) return false

	const binding = lorebook.lorebookBindings?.find(
		(b: SelectLorebookBinding) => b.id === entry.lorebookBindingId
	)
	if (!binding) return false

	if (binding.characterId) {
		return binding.characterId === currentCharacterId
	} else if (binding.personaId) {
		return (chat.chatPersonas || []).some(
			(cp) => cp.persona.id === binding.personaId
		)
	}
	// Background/NPC binding — only the Narrator (no-perspective mode) can
	// know about it.
	return currentCharacterId === null
}

export function attachCharacterLoreToCharacters(
	characters: TemplateContextCharacter[],
	includedCharacterLoreEntries: SelectCharacterLoreEntry[],
	chat: BasePromptChat
): TemplateContextCharacter[] {
	const loreMap: Record<number, Record<string, string>> = {}
	includedCharacterLoreEntries.forEach((entry) => {
		const lorebook =
			chat.lorebook && chat.lorebook.id === entry.lorebookId
				? chat.lorebook
				: undefined
		if (!lorebook) return
		const binding = lorebook.lorebookBindings.find(
			(b: SelectLorebookBinding) => b.id === entry.lorebookBindingId
		)
		if (binding && binding.characterId) {
			if (!loreMap[binding.characterId]) loreMap[binding.characterId] = {}
			loreMap[binding.characterId][entry.name!] = entry.content
		}
	})
	return characters.map((char) => {
		const chatChar = (chat.chatCharacters || []).find(
			(cc) =>
				cc.character.nickname === char.nickname ||
				cc.character.name === char.name
		)
		const charId = chatChar?.character?.id
		return {
			...char,
			"extra lore":
				charId && loreMap[charId] ? loreMap[charId] : undefined
		}
	})
}
