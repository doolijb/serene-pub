/**
 * Lore bindings, and the two transforms a lore entry needs before a model sees
 * it: decorator stripping and `{{char:#}}` substitution.
 *
 * Moved out of `promptBuilder/LorebookBindingUtils.ts` — the pipeline is now the
 * primary consumer (`host.ts` normalises every lore read through
 * `populateLorebookEntryBindings`, and `templateContext.ts` folds bound lore
 * into the cast), and the legacy engines borrow it until they are deleted.
 */
import type { BasePromptSession } from "$lib/server/connectionAdapters/BaseConnectionAdapter"
import type {
	TemplateContextCharacter,
	TemplateContextPersona
} from "$lib/server/pipelines/prompt/promptTypes"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { stripCardDecorators } from "$lib/shared/utils/characterCardDecorators"
import {
	CHARACTER_LORE_TYPE_ID,
	type LorebookEntry
} from "$lib/shared/entries/types"

export function populateLorebookEntryBindings<T extends LorebookEntry>(
	entry: T,
	session: BasePromptSession
): T {
	// Applies regardless of whether {{char:#}} binding substitution below
	// also applies (the early return right after this doesn't cover every
	// entry), since decorator lines must never leak into the rendered
	// prompt as literal text either way.
	entry.content = stripCardDecorators(entry.content).content

	const lorebook =
		session.lorebook && session.lorebook.id === entry.lorebookId
			? session.lorebook
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
 * Character-lore privacy rule, shared by the 0.5 keyword path and
 * the 0.5 RAG path: a characterLoreEntry bound to a specific character is
 * that character's own private self-knowledge — visible only when
 * generating as that exact character, regardless of the session's
 * `characterDetail` (which governs the card, not lore) or
 * whether that character is even attached to this session. World lore has no
 * such binding and is never gated by this function.
 *
 * A binding with no characterId is a background/NPC
 * row — its lore is visible only to the Narrator (currentCharacterId ===
 * null, i.e. no-perspective mode), since no specific character can know
 * about a background character's private knowledge, but the omniscient
 * Narrator can.
 *
 * **An UNBOUND character-lore entry — one with no `lorebookBindingId` at all
 * — is visible to the narrator and to the listing query, and invisible to
 * every specific speaker: a private entry nobody was bound to is the world's
 * knowledge, not a secret.** (W3, ruled 2026-09-17.)
 *
 * It read `false` for everyone, narrator included, on the reasoning that such
 * a row had no legitimate consumer. That turned out to be a disappearance
 * rather than a rule: a character-lore entry written before anyone bound it —
 * every suspect a Whodunit session lists, every row whose binding was deleted
 * — never retrieved and never listed, with nothing anywhere saying why. The
 * omniscient read is the honest home for it, and it is exactly the same
 * answer this function already gives a background/NPC binding, which is the
 * shape an unbound row is one step short of.
 */
export function isCharacterLoreEntryVisible(
	entry: LorebookEntry<typeof CHARACTER_LORE_TYPE_ID>,
	session: BasePromptSession,
	currentCharacterId: number | null
): boolean {
	// Unbound: the world's knowledge, so the narrator's — never a speaker's.
	// The lorebook checks below still apply: an entry belonging to another
	// book is not this session's to read, whoever is asking.
	if (!entry.lorebookBindingId) {
		if (currentCharacterId !== null) return false
		const book = session.lorebook
		return !!book && session.lorebookId === entry.lorebookId
	}
	const lorebook = session.lorebook
	if (!lorebook) return false
	if (session.lorebookId !== entry.lorebookId) return false

	const binding = lorebook.lorebookBindings?.find(
		(b: SelectLorebookBinding) => b.id === entry.lorebookBindingId
	)
	if (!binding) return false

	if (binding.characterId) {
		if (binding.characterId === currentCharacterId) return true
		// ⚠ A binding on a character one of this session's users VOICES is
		// visible for the WHOLE session, not just that character's own turn.
		// Keeping only the perspective test above would cut every persona's
		// private lore out of every prompt, because a persona is never the
		// perspective a turn is generated from.
		return (session.sessionPersonas || []).some(
			(cp) => cp.persona?.id === binding.characterId
		)
	}
	// Background/NPC binding — only the Narrator (no-perspective mode) can
	// know about it.
	return currentCharacterId === null
}

export function attachCharacterLoreToCharacters(
	characters: TemplateContextCharacter[],
	includedCharacterLoreEntries: LorebookEntry<
		typeof CHARACTER_LORE_TYPE_ID
	>[],
	session: BasePromptSession
): TemplateContextCharacter[] {
	const loreMap: Record<number, Record<string, string>> = {}
	includedCharacterLoreEntries.forEach((entry) => {
		const lorebook =
			session.lorebook && session.lorebook.id === entry.lorebookId
				? session.lorebook
				: undefined
		if (!lorebook) return
		const binding = lorebook.lorebookBindings.find(
			(b: SelectLorebookBinding) => b.id === entry.lorebookBindingId
		)
		if (binding && binding.characterId) {
			if (!loreMap[binding.characterId]) loreMap[binding.characterId] = {}
			// `?? ""` and not `!`. The `title` column is nullable on the
			// unified table where the three it replaced were `NOT NULL`, so
			// the non-null assertion was a claim the type no longer backs.
			// The empty string is what `toEntryRow` already produces for a
			// title-less row of a type that declares a `title` role — the
			// assertion's runtime behaviour, written down rather than
			// asserted.
			loreMap[binding.characterId][entry.name ?? ""] = entry.content
		}
	})
	return characters.map((char) => {
		const sessionChar = (session.sessionCharacters || []).find(
			(cc) =>
				cc.character.nickname === char.nickname ||
				cc.character.name === char.name
		)
		const charId = sessionChar?.character?.id
		return {
			...char,
			"extra lore":
				charId && loreMap[charId] ? loreMap[charId] : undefined
		}
	})
}
