/**
 * The home wizard's quick persona: the **Just call me …** card on the Who
 * you are step, one press to a persona the person plays as.
 *
 * Get started asks "What should we call you?" and promises that is the name
 * the characters will see. The display name it saves is what the APP calls
 * the person; what a character calls them in a story is their persona's
 * name. So the quick persona takes the name typed at Get started, or the
 * display name already saved (the field shows only to someone without one),
 * and falls back to "You" only when there is neither (less-confusing plan
 * A1, 2026-10-11).
 *
 * Pure: the page passes what it holds and emits what comes back.
 */
import { displayNameSchema } from "$lib/shared/validation/displayName"

/** The quick persona's name when the person gave none. */
export const QUICK_PERSONA_FALLBACK_NAME = "You"

/** What the quick persona's description says, whatever its name. */
export const QUICK_PERSONA_DESCRIPTION =
	"This represents you in sessions. You can edit it later to add more about yourself, or create other personas for different kinds of stories."

/**
 * The name the quick persona is created with: the welcome answer, then the
 * saved display name, each read by the display-name rule (trimmed, empty is
 * nothing), then "You".
 */
export function quickPersonaName(
	welcomeAnswer: string | null | undefined,
	displayName: string | null | undefined
): string {
	for (const candidate of [welcomeAnswer, displayName]) {
		const parsed = displayNameSchema.safeParse(candidate ?? "")
		if (parsed.success && parsed.data) return parsed.data
	}
	return QUICK_PERSONA_FALLBACK_NAME
}

/** The character a `characters:create` for the quick persona carries. */
export function quickPersonaCharacter(name: string) {
	return {
		name,
		description: QUICK_PERSONA_DESCRIPTION,
		isPersona: true,
		isDefaultPersona: true
	}
}
