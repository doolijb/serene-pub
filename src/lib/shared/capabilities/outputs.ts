/**
 * 🚧 **The requirement a model call's requested outputs derive** (O6).
 *
 * `generate-text@1`'s `outputs` param names the kinds a step asks the model
 * to write; the connection must then meet `text->text+audio` rather than
 * `text->text` (`requirementForOutputs`). The dispatch resolves the pair
 * against this — so the resolver refuses, in its own words, a pair whose
 * model cannot speak — and anything else that judges a step by its outputs
 * reads it here, never by building the id itself.
 *
 * Text alone (or nothing stated) is today's reply and returns `base` as
 * given, so every request that asked for nothing new resolves exactly as it
 * did.
 */
import {
	requirementForOutputs,
	type IoKind,
	type TransformId
} from "@serene-pub/sdk"

/** A reply: text in, text out — the base every requested output widens. */
export const REPLY_TRANSFORM = "text->text"

export function capabilityForOutputs(
	outputs: readonly unknown[] | null | undefined,
	base: string = REPLY_TRANSFORM
): string {
	const kinds = (outputs ?? []).filter(
		(k): k is string => typeof k === "string" && !!k.trim()
	)
	if (!kinds.length || kinds.every((k) => k === "text")) return base
	return requirementForOutputs(base as TransformId, kinds as IoKind[])
}
