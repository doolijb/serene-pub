/**
 * A character lore entry's cast member isn't just a display label — it's the
 * gate that decides which prompts read the entry (the server's rule is
 * `isCharacterLoreEntryVisible`, `server/pipelines/prompt/characterLore.ts`):
 *
 * - **No cast member**: the world's knowledge, so the narrator's — read in a
 *   reply generated from no character's perspective, never by a speaker.
 * - **A member missing from the book's cast**: read by nobody.
 * - **A background member** (no card): the narrator's only.
 * - **A member with a card**: that character's private self-knowledge, read
 *   on their own turns and hidden from every other character — except that a
 *   card someone in the session plays as their persona has its lore read for
 *   the WHOLE session, since a persona is never the perspective a turn is
 *   generated from.
 *
 * This says that rule in plain language for the Character Lore row and
 * editor, so an entry is never left out of a prompt with nothing saying why.
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
			label: "Narrator only",
			description:
				"No cast member — only the narrator reads this entry, in replies written from no character's perspective. No character ever sees it."
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
		binding.character?.nickname ||
		binding.character?.name ||
		"this character"
	return {
		kind: "character",
		label: `Private to ${name}`,
		description: `Included in prompts generated from ${name}'s perspective, and hidden from every other character — unless someone in the session plays ${name} as their persona, when every prompt in that session includes it.`
	}
}
