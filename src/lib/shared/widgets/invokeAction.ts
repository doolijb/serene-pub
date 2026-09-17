/**
 * Invoking one action, wherever it was pressed (plans/29 R-15; plans/30 U5c;
 * U5c review W1/W4, 2026-09-16).
 *
 * ONE routing rule for the chips, the **More** menu, the `/` palette, a
 * message's ⋮ menu, a widget's `invoke(key)` and a frame's `{ t: "invoke" }`:
 *
 * - **Core's verbs** (`specSlug === "core"` — stop · edit · branch · retry ·
 *   continue · swipe · hide · delete) go to the host's *real* handlers. They
 *   are built-ins with lifecycles of their own (`sessionMessages:*`,
 *   `sessions:triggerGenerateMessage`); `sessions:triggerFunction` refuses
 *   `continue` by name and serves none of the rest, so a widget that fired
 *   `invoke('continue')` through the generic fire got a refusal for doing
 *   exactly what the envelope invited.
 * - **Everything else** is the audited fire, carrying the action's
 *   **identity** (`<spec slug>#<key>`) so the server checks *that*
 *   declaration's audience and enablement and runs *that* spec (W1) — never
 *   the union of every action that happens to share the function.
 *
 * The page and `makeInvoke` (the widget contract) both call this; neither
 * restates it.
 */

import { CORE_ACTION_SPEC, actionIdentity } from "$lib/shared/actions/identity"

export type InvokePayload = Record<string, unknown>

/** What rides beside an invocation: the subject message, entered values. */
export interface InvokeArgs {
	messageId?: number
	payload?: InvokePayload
}

/** The three fields routing reads off an action, whatever list it came from. */
export interface ActionRef {
	specSlug: string
	key: string
	function: string
}

/**
 * The host's real handlers for core's verbs, by key. A verb with no handler
 * here is refused loudly rather than routed to the generic fire — the fire
 * cannot serve it and a silent drop would tell the caller it ran.
 */
export type CoreVerbHandlers = Partial<
	Record<string, (args?: InvokeArgs) => void>
>

export interface ActionDispatch {
	/** Core's verbs → the host's handlers. */
	core: CoreVerbHandlers
	/** A contributed action → the audited fire, identity in hand. */
	fire: (action: ActionRef, args?: InvokeArgs) => void
}

/**
 * Route one action. Throws for a core verb the host wired no handler for,
 * so a widget cannot believe it fired what it did not.
 */
export function dispatchAction(
	action: ActionRef,
	dispatch: ActionDispatch,
	args?: InvokeArgs
): void {
	if (action.specSlug === CORE_ACTION_SPEC) {
		const handler = dispatch.core[action.key]
		if (!handler)
			throw new Error(
				`'${actionIdentity(action)}' is one of core's verbs and this host wired no handler for it — ` +
					`it cannot be fired as a function`
			)
		handler(args)
		return
	}
	dispatch.fire(action, args)
}
