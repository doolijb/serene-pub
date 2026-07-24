/** Shared low-level HTTP helpers for talking to a koboldcpp instance's public API. */

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
		if (!resp.ok) return { modelName: null, refused: false }
		const data = await resp.json()
		const result: string = data.result ?? ""
		return { modelName: result || null, refused: false }
	} catch (err) {
		const cause = (err as { cause?: { code?: string } })?.cause
		return { modelName: null, refused: cause?.code === "ECONNREFUSED" }
	}
}

/** Raw (unnormalized) name of the currently loaded model, or null if none/unreachable. */
export async function fetchCurrentModelName(
	baseUrl: string,
	timeoutMs = 5000
): Promise<string | null> {
	return (await fetchModelStatus(baseUrl, timeoutMs)).modelName
}

/** Model name plus whether the process is confirmed dead (connection
 * refused), in one request — see ModelStatus. */
export async function fetchModelStatusForPoll(
	baseUrl: string,
	timeoutMs = 5000
): Promise<ModelStatus> {
	return fetchModelStatus(baseUrl, timeoutMs)
}
