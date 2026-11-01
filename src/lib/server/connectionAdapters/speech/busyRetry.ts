/**
 * 🚧 audio.cpp answers `server_busy` (HTTP 503, `error.type: "server_busy"`)
 * when `max_loaded_models` is reached and every loaded model is working —
 * on a CPU build, a transcription during a speech call (lane V finding V-5,
 * 2026-10-29). That is "try again in a moment", not a refusal, so the two
 * callers retry a few times with backoff, honouring the abort signal. Any
 * other answer is returned at once.
 */
export const BUSY_RETRY = { tries: 5, baseMs: 750, maxMs: 6000 } as const

export function isBusyResponse(status: number, bodyText: string): boolean {
	if (status === 429) return true
	if (status !== 503) return false
	return /server_busy|busy;?\s*retry/i.test(bodyText) || bodyText.trim() === ""
}

/**
 * Runs `attempt` until it answers something other than busy, or the tries run
 * out. `attempt` must return the response AND its body text when not ok (so
 * the body is read once).
 */
export async function withBusyRetry<T extends { res: Response; bodyText: string }>(
	attempt: () => Promise<T>,
	opts?: { signal?: AbortSignal; tries?: number; baseMs?: number; maxMs?: number }
): Promise<T> {
	const tries = opts?.tries ?? BUSY_RETRY.tries
	const base = opts?.baseMs ?? BUSY_RETRY.baseMs
	const max = opts?.maxMs ?? BUSY_RETRY.maxMs
	let last: T | null = null
	for (let n = 0; n < tries; n++) {
		opts?.signal?.throwIfAborted()
		last = await attempt()
		if (last.res.ok || !isBusyResponse(last.res.status, last.bodyText)) return last
		if (n === tries - 1) break
		const wait = Math.min(max, base * 2 ** n)
		await new Promise<void>((resolve, reject) => {
			const t = setTimeout(() => {
				opts?.signal?.removeEventListener("abort", onAbort)
				resolve()
			}, wait)
			const onAbort = () => {
				clearTimeout(t)
				reject(opts?.signal?.reason ?? new Error("aborted"))
			}
			opts?.signal?.addEventListener("abort", onAbort, { once: true })
		})
	}
	return last!
}
