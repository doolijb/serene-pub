/** Shared low-level HTTP helpers for talking to a koboldcpp instance's public API. */

import { flagsFrom } from "./probeCapabilities"

/** Simple reachability check — true if the instance responded OK within timeoutMs. */
export async function pingKoboldCPP(
	baseUrl: string,
	timeoutMs = 2000
): Promise<boolean> {
	try {
		const resp = await fetch(`${baseUrl}/api/extra/version`, {
			signal: AbortSignal.timeout(timeoutMs)
		})
		return resp.ok
	} catch {
		return false
	}
}

export interface ModelStatus {
	/** Raw (unnormalized) name of the currently loaded model, or null if none. */
	modelName: string | null
	/** True if the OS itself refused the connection (nothing listening on
	 * that port at all) — a fast, unambiguous "the process is not there"
	 * signal, distinct from a timeout/non-200 (which just means "not
	 * answering yet", the expected state throughout a slow model load). */
	refused: boolean
	/**
	 * Whether this answer is trustworthy as a statement about what is loaded.
	 *
	 * `modelName: null` has three very different causes and callers must not
	 * treat them alike:
	 *   - koboldcpp answered "nothing loaded"  → determined, act on it
	 *   - the OS refused the connection        → determined, the process is gone
	 *   - the request timed out or 5xx'd       → NOT determined, we simply
	 *     could not ask, which is the normal state while a large model is
	 *     loading or a long generation is holding the single worker
	 *
	 * Collapsing the third case into "no model is loaded" is what produced a
	 * reload loop: a busy instance looked unloaded, so the caller reloaded it,
	 * which interrupted the very load it was waiting on, forever. See
	 * modelManager.ensureModelLoaded.
	 */
	determined: boolean
}

/** Single-request combination of "what model is loaded" and "did the OS
 * refuse the connection" — used by a load-wait poll loop that needs both
 * pieces of info every tick without doubling its request rate. */
async function fetchModelStatus(
	baseUrl: string,
	timeoutMs: number
): Promise<ModelStatus> {
	try {
		const resp = await fetch(`${baseUrl}/api/v1/model`, {
			signal: AbortSignal.timeout(timeoutMs)
		})
		// A non-OK response is ambiguous — koboldcpp serves errors while it is
		// mid-swap — so it is explicitly not a statement that nothing is loaded.
		if (!resp.ok)
			return { modelName: null, refused: false, determined: false }
		const data = await resp.json()
		const result: string = data.result ?? ""
		return { modelName: result || null, refused: false, determined: true }
	} catch (err) {
		const cause = (err as { cause?: { code?: string } })?.cause
		const refused = cause?.code === "ECONNREFUSED"
		// Refusal is definitive; a timeout or abort tells us nothing.
		return { modelName: null, refused, determined: refused }
	}
}

/** Raw (unnormalized) name of the currently loaded model, or null if none/unreachable. */
export async function fetchCurrentModelName(
	baseUrl: string,
	timeoutMs = 5000
): Promise<string | null> {
	return (await fetchModelStatus(baseUrl, timeoutMs)).modelName
}

/**
 * Like {@link fetchCurrentModelName} but keeps the `determined` flag, so a
 * caller deciding whether to *reload* can tell "nothing is loaded" apart from
 * "I could not ask". Prefer this for any decision with a side effect.
 */
export async function fetchCurrentModelStatus(
	baseUrl: string,
	timeoutMs = 5000
): Promise<ModelStatus> {
	return fetchModelStatus(baseUrl, timeoutMs)
}

/** Model name plus whether the process is confirmed dead (connection
 * refused), in one request — see ModelStatus. */
export async function fetchModelStatusForPoll(
	baseUrl: string,
	timeoutMs = 5000
): Promise<ModelStatus> {
	return fetchModelStatus(baseUrl, timeoutMs)
}

export interface ImageModelStatus {
	/**
	 * An image model is resident — NOT which one.
	 *
	 * `/api/extra/version` reports a `txt2img` boolean and nothing else about
	 * the image model, so identity can only come from this process's own record
	 * of what it loaded. That is the same asymmetry gpuLayers/batchSize already
	 * have on the text side, and it is why a server restart with koboldcpp still
	 * running costs one deliberate reload on the first render.
	 */
	present: boolean
	/** The OS refused the connection — the process is genuinely not there. */
	refused: boolean
	/** Whether this answer is trustworthy at all; see {@link ModelStatus}. */
	determined: boolean
}

/**
 * Whether koboldcpp currently has an image model loaded.
 *
 * The image counterpart of {@link fetchModelStatusForPoll}, and a separate
 * endpoint because `/api/v1/model` answers about the TEXT model only — with an
 * image-only load it reports the literal string `"inactive"`, which no expected
 * filename will ever match. Polling it for an image load is a guaranteed hang
 * for the caller's whole timeout budget, once per render.
 *
 * Reuses the same flag set the Manager's own capability badges are built from,
 * so the two cannot disagree about the same server.
 */
export async function fetchImageModelStatus(
	baseUrl: string,
	timeoutMs = 5000
): Promise<ImageModelStatus> {
	try {
		const resp = await fetch(`${baseUrl}/api/extra/version`, {
			signal: AbortSignal.timeout(timeoutMs)
		})
		// Same reasoning as fetchModelStatus: koboldcpp serves errors while it
		// is mid-swap, so a non-OK response is not a statement that nothing is
		// loaded.
		if (!resp.ok)
			return { present: false, refused: false, determined: false }
		const data = await resp.json()
		return {
			present: flagsFrom(data).txt2img,
			refused: false,
			determined: true
		}
	} catch (err) {
		const cause = (err as { cause?: { code?: string } })?.cause
		const refused = cause?.code === "ECONNREFUSED"
		return { present: false, refused, determined: refused }
	}
}
