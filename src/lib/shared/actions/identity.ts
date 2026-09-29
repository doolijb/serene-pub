/**
 * An action's identity — `<spec slug>#<key>` (plans/29 R-15; plans/30 U5c;
 * ruled 2026-09-16, U5c review W1).
 *
 * One string names one declaration: the spec that contributed it and the
 * action's own key within that spec. Everything that keys on an action keys
 * on this — the *new* marker (`seen_actions`), a session's enablement row
 * (`session_functions`), the fire (`sessions:fireAction`'s `action`), a
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

/**
 * Build and split an identity — the SDK's, beside the grammar (core's
 * conversation reads them there too). Shape only: whether one names anything
 * is the list's business.
 */
export { actionIdentity, parseActionIdentity } from "@serene-pub/sdk"

/** Is this identity one of core's message verbs (`core#…`)? */
export const isCoreActionIdentity = (identity: string): boolean =>
	identity.startsWith(`${CORE_ACTION_SPEC}#`)

/**
 * The two narrator actions by identity (plans/31 V2) — the composer's
 * narrator button and its side-character half. Both have a bespoke road: the
 * client opens the narrator modal for either and fires the dedicated event,
 * and `fireAction` refuses them by name. The slugs are the catalog's
 * (`NARRATE_SPEC_ID`, `NARRATE_CHARACTER_SPEC_ID`), spelled here so the
 * client never imports the catalog for two strings.
 */
export const NARRATE_ACTION = "core:spec/narrate#narrate"
export const NARRATE_CHARACTER_ACTION = "core:spec/narrate-character#narrate-character"
