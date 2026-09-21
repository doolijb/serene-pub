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

import type { WidgetInvokeArgs, WidgetPayload } from "@serene-pub/sdk"
import { CORE_ACTION_SPEC, actionIdentity } from "$lib/shared/actions/identity"

/**
 * ⏳ The app's spelling of an invocation's payload.
 *
 * @deprecated Use `WidgetPayload` — the name the SDK publishes.
 */
export type InvokePayload = WidgetPayload

/**
 * What rides beside an invocation: the subject message, entered values.
 *
 * The contract's own shape (`WidgetInvokeArgs`), under the name this app has
 * always called it. One declaration: a widget's `invoke` and this router take
 * the same object, whichever side of the SDK boundary named it.
 */
export type InvokeArgs = WidgetInvokeArgs

/** The two fields routing reads off an action, whatever list it came from — together, its identity. */
export interface ActionRef {
	specSlug: string
	key: string
}

/**
 * The host's real handlers for core's verbs, by key. A verb with no handler
 * here is refused loudly rather than routed to the generic fire — the fire
 * cannot serve it and a silent drop would tell the caller it ran.
 */
export type CoreVerbHandlers = Partial<
	Record<string, (args?: InvokeArgs) => void>
>

/**
 * A host's routing for one press: both halves, in one bag.
 *
 * ONE bag rather than two props, because the two halves are one decision: a
 * host that threads its core handlers down to a mount but keeps its fire to
 * itself hands that mount a second, lesser fire, and the same action then
 * behaves one way pressed inside a widget and another pressed on the chip
 * beside it. What a host hands a widget is its whole dispatch or nothing.
 */
export interface ActionDispatch {
	/** Core's verbs → the host's handlers. */
	core: CoreVerbHandlers
	/**
	 * A contributed action → the host's OWN audited fire, identity in hand:
	 * the same function its chips and message rows press, so a widget's
	 * press is named as a run (`runId`) and takes the bespoke client flows
	 * (the narrator's modal) rather than a thinner copy of them.
	 */
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
