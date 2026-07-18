/**
 * Resolves the display name for a character: prefer its nickname, fall back
 * to its real name, then to a caller-supplied fallback.
 *
 * This is the intended replacement for the `character.nickname || character.name`
 * (or `??` variant) pattern that was copy-pasted across the codebase. Use `||`
 * semantics here deliberately, not `??` — a blank nickname is commonly stored
 * as `""` rather than `null`/`undefined`, and `""` isn't nullish, so a `??`
 * check would keep the empty string instead of falling through to the
 * character's real name (see the historical bug this caused in
 * `src/routes/chats/[id]/+page.svelte`, `handleAvatarClick`).
 *
 * New call sites that need a nickname-or-name string should use this helper
 * instead of re-deriving the fallback chain inline, so future edits (and
 * future fixes to edge cases like the one above) converge on one place.
 */
export function resolveCharacterName(
	character: { name?: string | null; nickname?: string | null } | null | undefined,
	fallback = "assistant"
): string {
	return character?.nickname?.trim() || character?.name?.trim() || fallback
}

/**
 * Resolves the display name for a persona. Personas only have a `name`
 * column (no `nickname`), so this simply trims and falls back — kept as a
 * separate helper (rather than overloading `resolveCharacterName`) so call
 * sites that only ever have a persona don't need to reason about a
 * `nickname` field that can't exist on that type.
 */
export function resolvePersonaName(
	persona: { name?: string | null } | null | undefined,
	fallback = "user"
): string {
	return persona?.name?.trim() || fallback
}
