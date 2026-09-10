/**
 * Can this connection continue a partial reply — and if not, why not.
 *
 * ## The fact this exists to stop being silent
 *
 * "Continue" hands the model the text a reply has produced so far and asks for
 * the next characters of it. That is a TRUE PREFILL, and only two shapes deliver
 * one:
 *
 *   - **Completion wire.** The assembled prompt already ends with an OPEN
 *     assistant block carrying the partial (`contextHandlebarsHelpers`'
 *     `includeClose: messageId !== -2`), so the model writes into it. Every
 *     completion-capable type does this, in that wire, by construction.
 *   - **A chat protocol that accepts a trailing assistant turn as a prefill.**
 *     Anthropic's Messages API does. An OpenAI-compatible endpoint does not: a
 *     trailing `{role: "assistant"}` message is handed to the chat template, and
 *     whether the model carries that turn on or opens a fresh one is the
 *     template's decision, not ours to promise.
 *
 * Everything else LOOKS like a continuation and is not: the model starts a new
 * reply, `joinContinuation` glues it onto the partial, and the seam reads as the
 * model repeating itself. Nothing errors. So the answer is declared, refused at
 * the verb, and shown on the capability panel.
 *
 * ## Two questions, kept apart
 *
 *   - **CAN this code do it?** The type's wire modes that carry a prefill —
 *     `AdapterManifestEntry.continuesIn`, static, and the same fact the adapter
 *     routes on (`BaseConnectionAdapter.continuationRoute`).
 *   - **MAY this connection?** The `continue_reply` capability, resolved through
 *     the same four layers as every other one. Anthropic is the case that needs
 *     both: the API prefills, and Claude 4.6 and later reject a trailing
 *     assistant turn with a 400 — a per-MODEL fact this layer cannot see, so the
 *     manifest declares it unproven and a person switches it on.
 *
 * The effective answer is the pair, and it is computed HERE so the server's
 * refusal, the capability panel's row and the adapter's own routing cannot
 * disagree — the standing warning in `capabilityRows.ts` and `wireMode.ts`,
 * applied to a third reader.
 *
 * ## Client-safe
 *
 * Only the SDK, the static manifest and `wireMode` are imported; no adapter
 * module is reachable. Same rule and same reason as `wireMode.ts` — the panel
 * renders in a browser, and `@lmstudio/sdk` cannot be parsed on Android.
 */

import {
	WIRE_CAPABILITY,
	capabilityLabel,
	type CapabilitySet,
	type FeatureId,
	type WireMode
} from "@serene-pub/sdk"
import { ADAPTER_MANIFEST } from "./manifest"
import { wireModeFor } from "./wireMode"

/**
 * The capability id, spelled once.
 *
 * Exported rather than typed inline at six call sites: this string is a database
 * value, a manifest key and a panel row id, and a typo in any of them resolves
 * to "off" in silence.
 */
export const CONTINUE_REPLY = "continue_reply" satisfies FeatureId

/**
 * Which of a type's wire modes carry a continuation as a true prefill.
 *
 * Read straight off the manifest, so it costs nothing and reaches the browser.
 * Empty for a type that declares none — an image adapter, or one nobody
 * declared at all — which is the honest answer rather than an absent one.
 */
export function continueWireModes(
	type: string | null | undefined
): readonly WireMode[] {
	return (type ? ADAPTER_MANIFEST[type]?.continuesIn : undefined) ?? []
}

/**
 * Does this connection continue a reply as a true prefill?
 *
 * Both halves, in the order a reader should think about them: the capability the
 * four layers resolved, and then the wire it is actually sent on. `have` is a
 * RESOLVED set — this never re-resolves the layers, for the reason
 * `capabilityRows.ts` gives at length.
 *
 * ⚠ An absent `continue_reply` key is OFF, not unknown. `resolveCapabilities`
 * omits a capability that resolved to 0, so absence is what "switched off" looks
 * like and a fallback to the type's declaration would quietly overrule an
 * explicit off. The cost is that a connection whose cached set predates this
 * capability reads as unable until it is next tested or saved — which is why
 * every server answer resolves LIVE from the row (`connections/resolve.ts`)
 * rather than off the cache.
 */
export function continuesReply(
	type: string | null | undefined,
	have: CapabilitySet | null | undefined
): boolean {
	if (!((have?.[CONTINUE_REPLY] ?? 0) > 0)) return false
	return continueWireModes(type).includes(wireModeFor(type, have))
}

/** How a wire mode is named to a person — "Chat messages", "Text completion". */
const modeName = (mode: WireMode): string =>
	capabilityLabel(WIRE_CAPABILITY[mode])

/**
 * Why the CODE cannot continue a reply on this type in this wire, or `null`.
 *
 * The "can", without the "may" — no capability is consulted, because an adapter
 * asking this is not asking permission: it is routing, and it needs the answer
 * for the wire it is about to send on. `BaseConnectionAdapter.continuationRoute`
 * is the one caller that wants it alone; everything user-facing goes through
 * `continueRefusal` below, which asks both halves.
 */
export function continueWireRefusal(
	type: string | null | undefined,
	mode: WireMode
): string | null {
	const modes = continueWireModes(type)
	if (!modes.length)
		return (
			"This connection cannot continue a partial reply: its API has no way to hand a model " +
			"the text so far and have it write the next words. Regenerating replaces the reply instead."
		)
	if (modes.includes(mode)) return null
	return (
		`This connection is sent as ${modeName(mode)}, and a reply can only be continued when it is ` +
		`sent as ${modes.map(modeName).join(" or ")} — otherwise the model starts a fresh reply ` +
		`rather than carrying this one on. Change its wire mode under its capabilities.`
	)
}

/**
 * Why this connection will not continue a reply, in words a person can act on,
 * or `null` when it will.
 *
 * Three refusals, because there are three different things to do about them, and
 * a single sentence covering all three would send two thirds of its readers to
 * the wrong screen:
 *
 *   1. The type cannot, in any wire. Nothing to switch; say so and stop.
 *   2. The capability is off. Name the switch and where it lives.
 *   3. The wire cannot carry it. Name BOTH modes — the one it is on and the one
 *      that works — because "switch the wire mode" without them is a hunt.
 *
 * The capability is asked SECOND, between the two wire questions, and the order
 * is deliberate: a type that can never continue has no switch to offer, so
 * telling somebody to flip one would be worse than saying nothing.
 *
 * ⚠ No capability ids and no `wire_*` spellings ever reach these strings. They
 * are rendered on a button's title and returned as a socket error; `text->text`
 * is an address, not a name, and `wire_chat` is neither.
 */
export function continueRefusal(
	type: string | null | undefined,
	have: CapabilitySet | null | undefined
): string | null {
	if (!continueWireModes(type).length)
		return continueWireRefusal(type, "chat")

	if (!((have?.[CONTINUE_REPLY] ?? 0) > 0))
		return (
			`"${capabilityLabel(CONTINUE_REPLY)}" is off for this connection. Switch it on under ` +
			`its capabilities, if the model you are using can continue a partial reply.`
		)

	return continueWireRefusal(type, wireModeFor(type, have))
}
