/**
 * A character lore entry's binding isn't just a display label — it's the
 * actual gate that decides whether this entry can ever reach a generated
 * prompt at all (see isCharacterLoreEntryVisible() in
 * src/lib/server/utils/promptBuilder/LorebookBindingUtils.ts, shared by both
 * the 0.5 keyword and RAG paths): unbound entries are excluded
 * unconditionally, and a character binding makes the entry that character's own
 * private self-knowledge (invisible to every other character, even ones in
 * the same session) — INCLUDING when that character is the one a user voices,
 * because a persona IS a character and a persona binding IS a character
 * binding. This mirrors that rule in plain language for display purposes —
 * the Character Lore row and editor — so it's not a
 * surprise the first time an entry silently never shows up.
 */

export type CharacterLoreVisibilityKind =
	| "unbound"
	| "orphaned"
	| "narrator"
	| "character"

export interface CharacterLoreVisibility {
	kind: CharacterLoreVisibilityKind
	label: string
	description: string
}

export interface BindingLike {
	id: number
	characterId?: number | null
	character?: { nickname?: string | null; name: string } | null
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
	if (!binding.characterId) {
		// A background/NPC binding — not broken, just not attached to a real
		// character. Per the merge plan's decision 3, this entry
		// is visible only in Narrator (no-perspective) generation.
		return {
			kind: "narrator",
			label: "Narrator only",
			description:
				"Bound to a background character with no linked character sheet — only included in prompts generated with no current character (Narrator perspective), never visible to any specific character."
		}
	}
	const name =
		binding.character?.nickname || binding.character?.name || "this character"
	return {
		kind: "character",
		label: `Private to ${name}`,
		description: `Only included in prompts generated from ${name}'s perspective — hidden from every other character, even ones in the same session.`
	}
}
