/**
 * Lore bindings, and the two transforms a lore entry needs before a model sees
 * it: decorator stripping and `{{char:#}}` substitution — plus the private-lore
 * gate and the name a cast member reads as in a prompt.
 *
 * `host.ts` normalises every lore read through `populateLorebookEntryBindings`
 * and names each character-lore row's cast member with `castTagName`, which is
 * what Assemble's `characterLore` shows beside the entry.
 */
import type { BasePromptSession } from "$lib/server/connectionAdapters/BaseConnectionAdapter"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { stripCardDecorators } from "$lib/shared/utils/characterCardDecorators"
import { castTagNumber, rewriteCastTags } from "$lib/server/utils/castTags"
import {
	CHARACTER_LORE_TYPE_ID,
	type LorebookEntry
} from "$lib/shared/entries/types"

export function populateLorebookEntryBindings<T extends LorebookEntry>(
	entry: T,
	session: BasePromptSession
): T {
	// Applies regardless of whether {{char:N}} substitution below also
	// applies (the early return right after this doesn't cover every entry),
	// since decorator lines must never leak into the rendered prompt as
	// literal text either way.
	entry.content = stripCardDecorators(entry.content).content

	const lorebook =
		session.lorebook && session.lorebook.id === entry.lorebookId
			? session.lorebook
			: undefined
	if (!lorebook) return entry

	const names = new Map<number, string>()
	for (const binding of lorebook.lorebookBindings) {
		const n = castTagNumber(binding.binding)
		const name = castTagName(binding)
		if (n !== null && name) names.set(n, name)
	}
	// One pass: a name holding a tag's text is never read as a tag again.
	entry.content = rewriteCastTags(entry.content, (n) => names.get(n))
	return entry
}

/**
 * What a member's `{{char:N}}` reads as in a prompt (plan A19): their card's
 * name (nickname first), else the member's own name — a background member
 * has no card, and a deleted card is nobody's (the reader leaves it off
 * `character`). The card and the `name` are the ones the session's reading
 * has when the reader resolved them (`castMemberAt`, as the pipeline host's
 * lore read does): `character` is the card a dated change draws them with by
 * then, never the linked one kept on `characterId` for the private-lore gate.
 * Empty when neither has one: the tag is left as written.
 */
export function castTagName(binding: {
	name?: string | null
	character?: { name?: string | null; nickname?: string | null } | null
}): string {
	return (
		resolveCharacterName(binding.character, "") ||
		binding.name?.trim() ||
		""
	)
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

	const cards = memberCards(binding)
	if (currentCharacterId !== null && cards.includes(currentCharacterId))
		return true
	// ⚠ A binding on a character one of this session's users VOICES is
	// visible for the WHOLE session, not just that character's own turn.
	// Keeping only the perspective test above would cut every persona's
	// private lore out of every prompt, because a persona is never the
	// perspective a turn is generated from.
	if (
		(session.sessionPersonas || []).some(
			(cp) => cp.persona?.id != null && cards.includes(cp.persona.id)
		)
	)
		return true
	// Background/NPC binding (no linked card) — only the Narrator
	// (no-perspective mode) can know about it, besides a speaker holding a
	// card a dated change draws them with (above).
	return !binding.characterId && currentCharacterId === null
}

/**
 * Every card that is this member (plan A25): the linked one, and each card a
 * dated change draws them with, when the reader put them on the binding as
 * `memberCards` (`castMemberCards`, as the pipeline host's lore read does). A
 * seat holding any of them is that member, so each one reads their private
 * lore. A binding without `memberCards` has its linked card only.
 */
function memberCards(binding: SelectLorebookBinding): number[] {
	const cards = (binding as { memberCards?: unknown }).memberCards
	if (Array.isArray(cards)) return cards as number[]
	return binding.characterId ? [binding.characterId] : []
}
