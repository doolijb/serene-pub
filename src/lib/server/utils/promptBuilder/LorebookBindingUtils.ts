// LorebookBindingUtils.ts
// Contains lorebook binding logic for PromptBuilder modularization
import type { BasePromptChat } from "../../connectionAdapters/BaseConnectionAdapter"
import type { TemplateContextCharacter, TemplateContextPersona } from "./index"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"

export function populateLorebookEntryBindings(
	entry: SelectWorldLoreEntry | SelectCharacterLoreEntry | SelectHistoryEntry,
	chat: BasePromptChat
): SelectWorldLoreEntry | SelectCharacterLoreEntry | SelectHistoryEntry {
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

export function attachCharacterLoreToPersonas(
	personas: TemplateContextPersona[],
	includedCharacterLoreEntries: SelectCharacterLoreEntry[],
	chat: BasePromptChat
): TemplateContextPersona[] {
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
		if (binding && binding.personaId) {
			if (!loreMap[binding.personaId]) loreMap[binding.personaId] = {}
			loreMap[binding.personaId][entry.name!] = entry.content
		}
	})
	return personas.map((persona) => {
		const chatPersona = (chat.chatPersonas || []).find(
			(cp) => cp.persona.name === persona.name
		)
		const personaId = chatPersona?.persona?.id
		return {
			...persona,
			"extra lore":
				personaId && loreMap[personaId] ? loreMap[personaId] : undefined
		}
	})
}
