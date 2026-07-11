/** Shared low-level HTTP helpers for talking to a koboldcpp instance's public API. */

/** Simple reachability check — true if the instance responded OK within timeoutMs. */
export async function pingKoboldCpp(baseUrl: string, timeoutMs = 2000): Promise<boolean> {
	try {
		const resp = await fetch(`${baseUrl}/api/extra/version`, {
			signal: AbortSignal.timeout(timeoutMs)
		})
		return resp.ok
	} catch {
		return false
	}
}

/** Raw (unnormalized) name of the currently loaded model, or null if none/unreachable. */
export async function fetchCurrentModelName(baseUrl: string, timeoutMs = 5000): Promise<string | null> {
	try {
		const resp = await fetch(`${baseUrl}/api/v1/model`, { signal: AbortSignal.timeout(timeoutMs) })
		if (!resp.ok) return null
		const data = await resp.json()
		const result: string = data.result ?? ""
		return result || null
	} catch {
		return null
	}
}
