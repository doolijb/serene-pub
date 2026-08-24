/**
 * A character lore entry's binding isn't just a display label — it's the
 * actual gate that decides whether this entry can ever reach a generated
 * prompt at all (see isCharacterLoreEntryVisible() in
 * src/lib/server/utils/promptBuilder/LorebookBindingUtils.ts, shared by both
 * the keyword and RAG infill engines): unbound entries are excluded
 * unconditionally, a character binding makes the entry that character's own
 * private self-knowledge (invisible to every other character, even ones in
 * the same session), and a persona binding gates on which persona is currently
 * playing. This mirrors that rule in plain language for display purposes —
 * CharacterLoreManager.svelte's list/view/edit modes — so it's not a
 * surprise the first time an entry silently never shows up.
 */

export type CharacterLoreVisibilityKind =
	| "unbound"
	| "orphaned"
	| "narrator"
	| "character"
	| "persona"

export interface CharacterLoreVisibility {
	kind: CharacterLoreVisibilityKind
	label: string
	description: string
}

export interface BindingLike {
	id: number
	characterId?: number | null
	personaId?: number | null
	character?: { nickname?: string | null; name: string } | null
	persona?: { name: string } | null
}

export function getCharacterLoreVisibility(
	lorebookBindingId: number | null | undefined,
	bindings: BindingLike[]
): CharacterLoreVisibility {
	if (!lorebookBindingId) {
		return {
			kind: "unbound",
			label: "Unbound",
			description:
				"No character or persona binding — this entry will never be included in a generated prompt."
		}
	}
	const binding = bindings.find((b) => b.id === lorebookBindingId)
	if (!binding) {
		return {
			kind: "orphaned",
			label: "Broken binding",
			description:
				"This binding no longer points to a character or persona — this entry will never be included in a generated prompt."
		}
	}
	if (!binding.characterId && !binding.personaId) {
		// A background/NPC binding — not broken, just not attached to a real
		// character or persona. Per the merge plan's decision 3, this entry
		// is visible only in Narrator (no-perspective) generation.
		return {
			kind: "narrator",
			label: "Narrator only",
			description:
				"Bound to a background character with no linked character/persona sheet — only included in prompts generated with no current character (Narrator perspective), never visible to any specific character."
		}
	}
	if (binding.characterId) {
		const name =
			binding.character?.nickname ||
			binding.character?.name ||
			"this character"
		return {
			kind: "character",
			label: `Private to ${name}`,
			description: `Only included in prompts generated from ${name}'s perspective — hidden from every other character, even ones in the same session.`
		}
	}
	const name = binding.persona?.name || "this persona"
	return {
		kind: "persona",
		label: `Private to ${name}`,
		description: `Only included while ${name} is the active persona in the session.`
	}
}
