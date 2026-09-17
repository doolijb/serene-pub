/**
 * An action's identity — `<spec slug>#<key>` (plans/29 R-15; plans/30 U5c;
 * ruled 2026-09-16, U5c review W1).
 *
 * One string names one declaration: the spec that contributed it and the
 * action's own key within that spec. Everything that keys on an action keys
 * on this — the *new* marker (`seen_actions`), a session's enablement row
 * (`session_functions`), the fire (`sessions:triggerFunction`'s `action`), a
 * binding's R-6 check, a list's `{#each}` key. Never the function: several
 * actions, and several specs, may share one function, and two actions on one
 * function with different audiences are two different things a person may
 * or may not be allowed to press.
 *
 * Core's message verbs are listed under the spec slug `core` (a name, not a
 * row), so `core#edit` is one of them and `core:spec/narrate#narrate` is a
 * contributed action.
 */

import {
	ACTION_IDENTITY,
	ACTION_IDENTITY_MAX_LENGTH,
	CORE_ACTION_SPEC_ID
} from "@serene-pub/sdk"

/** The spec slug core's own verbs are listed under. Not a row; a name. */
export const CORE_ACTION_SPEC = CORE_ACTION_SPEC_ID

/**
 * What an identity looks like on the wire: a spec slug (`core`,
 * `core:spec/narrate`, `acme:spec/roll`) and a key (a lowercase kebab
 * token), joined by `#`. What `sessions:actionsSeen` accepts and nothing
 * looser (U5c review, S3). ONE grammar: the SDK's, which the block
 * validator (`checkMessageBlocks`) and the preset builder (`preset()`) apply
 * on their side of the seam.
 */
export { ACTION_IDENTITY, ACTION_IDENTITY_MAX_LENGTH }

/** `core:spec/narrate` + `narrate` → `core:spec/narrate#narrate`. */
export const actionIdentity = (a: { specSlug: string; key: string }): string =>
	`${a.specSlug}#${a.key}`

/** A well-formed identity, or null. Shape only — nothing about whether it names anything. */
export function parseActionIdentity(
	raw: unknown
): { specSlug: string; key: string } | null {
	if (typeof raw !== "string") return null
	if (raw.length > ACTION_IDENTITY_MAX_LENGTH || !ACTION_IDENTITY.test(raw))
		return null
	const i = raw.lastIndexOf("#")
	return { specSlug: raw.slice(0, i), key: raw.slice(i + 1) }
}

/** Is this identity one of core's message verbs (`core#…`)? */
export const isCoreActionIdentity = (identity: string): boolean =>
	identity.startsWith(`${CORE_ACTION_SPEC}#`)
