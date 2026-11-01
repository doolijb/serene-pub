import type { SpeechAdapterExports } from "./BaseSpeechAdapter"
import { ADAPTER_REGISTRY } from "$lib/server/adapters/registry"

/**
 * 🚧 The speech-family module for a connection type (PLAN-speech-build S9) —
 * the same shape as `getTranscriptionAdapter`, over the same registry, so the
 * conformance test walks exactly what this loader walks.
 *
 * Null rather than a throw: the speak step asks this of whatever pair the
 * Narration loadout resolves to, and a type that cannot speak is a sentence on
 * the receipt, not a failed reply.
 */
export async function getSpeechAdapter(
	connectionType: string
): Promise<SpeechAdapterExports | null> {
	const load = ADAPTER_REGISTRY[connectionType]?.speech
	return load ? await load() : null
}
