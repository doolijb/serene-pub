/**
 * The HOST-DECLARED capability layer: what a model's own host says it can do,
 * read as capability switches.
 *
 * ## Where it sits
 *
 * Between the preset and the probe (PLAN-composer-attachments §5.5):
 *
 *     adapter defaults → preset → HOST-DECLARED → probe → the person's switches
 *
 * A preset knows the SERVICE ("OpenRouter models can see"); the host's listing
 * knows the MODEL ("this one takes text and images, that one takes text"). The
 * more specific claim wins, so an OpenRouter text-only model is not offered
 * images just because its service usually can. A probe outranks it (it is what
 * the backend actually answered when asked), and a person's switch outranks
 * everything — an explicit Off is final.
 *
 * ## What counts as a declaration
 *
 * - **`facts.inputModalities`** (the host's listing, `connection_models.facts`):
 *   a list WITH `image` declares vision on; a list WITHOUT it declares it off.
 *   An absent list declares nothing — silence is unknown, never a no (the
 *   model-facts rule: a silent fact is left out, never guessed).
 * - **A vision projector the app launches the model with** (the managed
 *   KoboldCPP's `mmproj`, on the model row's `extra_json`). Serene Pub is the
 *   host there, and launching with a projector IS the declaration.
 *
 * Only `text+image->text` in v1. A host's `file` modality would map to
 * `text+document->text`, but no adapter that lists such facts declares that
 * key, so the line would be inert (`resolveCapabilities` walks `supports`).
 *
 * Booleans with the preset's meaning: `true` asserts the capability at the
 * protocol's ceiling, `false` switches it off. That is why the resolver can
 * hand this layer to the SDK in the preset's slot, laid over the preset —
 * `resolveConnectionCapabilities` in `server/connections/resolve.ts`.
 *
 * ⚠ Client-safe: no adapter, SDK or Svelte import.
 */

import { readStoredFacts, type ModelFacts } from "./modelFacts"

/** Capability id → asserted on (`true`) or off (`false`). */
export type HostDeclaredCapabilities = Partial<Record<string, boolean>>

/** The vision transform, spelled once for this layer. */
const VISION = "text+image->text"

/**
 * The model row's `extra_json.mmproj`, when it names a file.
 *
 * Read here rather than by the managed adapter alone because the capability
 * resolver must see it without importing an adapter (`manifest.ts`' rule).
 */
export function visionProjectorOf(extraJson: unknown): string | null {
	const value = (extraJson as { mmproj?: unknown } | null | undefined)?.mmproj
	return typeof value === "string" && value.trim() ? value.trim() : null
}

/**
 * The layer for one model, or `undefined` when its host declared nothing.
 *
 * `facts` is the stored column verbatim (validated here, never cast);
 * `extraJson` the model row's own bag.
 */
export function hostDeclaredCapabilities(model: {
	facts?: ModelFacts | Record<string, unknown> | null
	extraJson?: unknown
}): HostDeclaredCapabilities | undefined {
	const out: HostDeclaredCapabilities = {}
	const modalities = readStoredFacts(model.facts)?.inputModalities
	if (modalities?.length)
		out[VISION] = modalities.some((m) => m.toLowerCase() === "image")
	// After the facts, so a projector the app loads wins over a listing that
	// predates it.
	if (visionProjectorOf(model.extraJson)) out[VISION] = true
	return Object.keys(out).length ? out : undefined
}
