/**
 * Whether this machine can run local ONNX models at all — ONE verdict for both
 * lanes.
 *
 * The embedding lane and the entity lane load the same runtime
 * (`@huggingface/transformers` over `onnxruntime-node`), so they cannot
 * disagree about it. They each probed separately until 2026-10-05, with two
 * copies of the same dynamic import and two caches; a client asking "can I
 * offer the local ONNX types?" had a flag that spoke for embeddings only. Now
 * both lanes' sentences (`getLocalEmbeddingUnsupportedReason`,
 * `getLocalNerUnsupportedReason`) are this verdict, worded for their lane, and
 * `systemSettings:get` sends it as `localOnnxAvailability`.
 *
 * ## Probed, not predicted
 *
 * `onnxruntime-node` ships prebuilt binaries for some platform/arch pairs and
 * not others, and that list moves between releases. A platform denylist would
 * go stale; attempting the import once and caching whether it threw does not.
 * Android is the one hardcoded answer: Bionic cannot dlopen glibc binaries,
 * which is an architectural fact and not a "true today" one, so it answers
 * fast without an import that would fail anyway.
 *
 * ## In memory only, per process
 *
 * Never persisted. A stored "unavailable" would survive an `onnxruntime-node`
 * upgrade that fixes this exact platform. One dynamic import per boot is cheap
 * enough never to need a durable cache.
 *
 * ⚠ **A pure loadability check.** Nothing but the bare `import()` goes in the
 * try block. A failed model download or a full disk is a transient error, not a
 * fact about the machine, and folding one in here would cache it as a
 * permanent "this machine cannot".
 */

import { isAndroidWrapper } from "$lib/server/utils"

/**
 * The verdict. `reason` is a lower-case clause, so each surface can lead it
 * with its own words: _Not available on this machine: <reason>_ on a disabled
 * option, the lane's own sentence in the lanes.
 */
export type LocalOnnxAvailability =
	| { available: true; reason: null }
	| { available: false; reason: string }

let verdict: LocalOnnxAvailability | null = null
let probing: Promise<LocalOnnxAvailability> | null = null

async function probe(): Promise<LocalOnnxAvailability> {
	try {
		await import("@huggingface/transformers")
		return { available: true, reason: null }
	} catch (err: any) {
		return {
			available: false,
			reason: `the ONNX runtime didn't load (${err?.message ?? "no error message"})`
		}
	}
}

/** Whether local ONNX models can run here, and why not when they can't. */
export async function localOnnxAvailability(): Promise<LocalOnnxAvailability> {
	if (isAndroidWrapper())
		return {
			available: false,
			reason: "the Android app can't run the ONNX runtime"
		}
	if (verdict) return verdict
	// Concurrent first callers share one import attempt.
	probing ??= probe().then((v) => (verdict = v))
	return probing
}

/**
 * The refusal a server action answers with when it would need the runtime:
 * a download, adding a model by Hub id, creating a local ONNX connection.
 * Null when the runtime loads.
 */
export async function localOnnxRefusal(): Promise<string | null> {
	const a = await localOnnxAvailability()
	return a.available
		? null
		: `Local ONNX models aren't available on this machine: ${a.reason}.`
}
