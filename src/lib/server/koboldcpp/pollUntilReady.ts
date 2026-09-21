/**
 * Single shared "wait for koboldcpp to become ready" implementation.
 *
 * Previously this logic was duplicated three times (subprocess bootstrap
 * ping, model-load poll, reload_config retry), each with its own fixed
 * timeout guessed to cover "the slowest plausible machine/model" — too
 * short for a huge GGUF on slow CPU hardware, too long to fail fast on a
 * genuinely dead process on a fast one. There's no timeout that's correct
 * for every system.
 *
 * The actual correct signal, when we spawned the process ourselves, is
 * simpler: keep waiting exactly as long as the process is still alive, and
 * stop the moment it isn't — regardless of how slow that machine happens to
 * be. `hardTimeoutMs` remains as a last-resort safety net for a process
 * that's alive but truly wedged forever, not the primary gate.
 *
 * For instances we didn't spawn (an externally-run koboldcpp, or an
 * external instance the Manager has merely adopted) there's no process
 * handle to check — `isAlive` is omitted and refusals are tolerated for a
 * bounded span instead: a consecutive-refusal count by default, or a
 * wall-clock grace (`refusedGraceMs`) where the caller knows refusals are the
 * NORMAL state for a while. A model load is the case that matters: koboldcpp
 * takes its listener down for the entire load — measured at 6s for a warm
 * same-file reload and 23s for a cold 16 GB GGUF, longer on slow disks — so
 * three refused ticks two seconds apart is not a crash signal there, it is
 * every successful load ever.
 */

export type PollResult = "ready" | "not-ready" | "refused"

export interface PollOptions {
	/** How often to re-check. */
	intervalMs?: number
	/** Absolute safety net — only matters if the process never reports
	 * ready and (when isAlive is given) never actually exits either. */
	hardTimeoutMs?: number
	/** How many consecutive "refused" results to tolerate before giving up.
	 * Only consulted when neither `isAlive` nor `refusedGraceMs` is provided
	 * — with a real liveness check available, that's used instead of
	 * counting refusals. */
	refusedStrikeThreshold?: number
	/** How long an unbroken run of "refused" results is tolerated before
	 * giving up, for waits where the listener is EXPECTED to be down for a
	 * while (a model load). Takes precedence over `refusedStrikeThreshold`;
	 * like it, only consulted when `isAlive` isn't provided. */
	refusedGraceMs?: number
	/** Ground-truth liveness check for a process we hold a handle to. When
	 * provided, this — not the refusal count — decides whether a "refused"
	 * result means "still starting up" or "actually gone". */
	isAlive?: () => boolean
	signal?: AbortSignal
	/** Used only in log/error messages. */
	label?: string
	/** Called once per tick with elapsed ms — e.g. to log progress. */
	onTick?: (elapsedMs: number) => void
}

export async function pollUntilReady(
	check: () => Promise<PollResult>,
	opts: PollOptions = {}
): Promise<void> {
	const {
		intervalMs = 2000,
		hardTimeoutMs = 30 * 60_000,
		refusedStrikeThreshold = 3,
		refusedGraceMs,
		isAlive,
		signal,
		label = "KoboldCPP",
		onTick
	} = opts

	const start = Date.now()
	let refusedStreak = 0
	let refusedSince: number | null = null
	let lastLoggedAt = 0

	while (true) {
		signal?.throwIfAborted()

		const result = await check()
		if (result === "ready") return

		if (result === "refused") {
			if (isAlive) {
				// A refusal while the process itself is confirmed alive is
				// expected (koboldcpp closing/reopening its listener mid-load,
				// or just not up yet) — not a crash signal, so it doesn't
				// count against anything as long as the process is real.
				if (!isAlive()) {
					throw new Error(`${label}: process is no longer running`)
				}
			} else if (refusedGraceMs !== undefined) {
				refusedSince ??= Date.now()
				if (Date.now() - refusedSince >= refusedGraceMs) {
					throw new Error(
						`${label} is not reachable — it has refused connections for ${Math.round(refusedGraceMs / 1000)}s and appears to have crashed`
					)
				}
			} else {
				refusedStreak++
				if (refusedStreak >= refusedStrikeThreshold) {
					throw new Error(
						`${label} is not reachable — it appears to have crashed`
					)
				}
			}
		} else {
			refusedStreak = 0
			refusedSince = null
			if (isAlive && !isAlive()) {
				throw new Error(`${label}: process is no longer running`)
			}
		}

		const elapsed = Date.now() - start
		if (elapsed > hardTimeoutMs) {
			throw new Error(
				`${label} did not become ready within ${Math.round(hardTimeoutMs / 60_000)} minutes`
			)
		}
		if (onTick && elapsed - lastLoggedAt >= 30_000) {
			lastLoggedAt = elapsed
			onTick(elapsed)
		}

		await new Promise((r) => setTimeout(r, intervalMs))
	}
}
