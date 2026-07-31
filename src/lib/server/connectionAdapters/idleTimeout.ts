// 10 minutes with no new data — not total duration. Generous enough to
// tolerate slow prefill/decode on CPU-only hardware; only fires on a
// genuine stall (dead socket, crashed process, network black hole).
export const LLM_IDLE_TIMEOUT_MS = 600_000

// Flat bound for non-streaming responses only, where no intermediate chunk
// exists to reset against — a real, accepted exception to the idle-based
// design above, sized generously to cover a full slow generation
// end-to-end rather than a gap.
export const LLM_NONSTREAMING_TIMEOUT_MS = 1_800_000

export function createIdleWatchdog(idleMs: number, onIdle: () => void) {
	let timer: ReturnType<typeof setTimeout> | undefined
	const poke = () => {
		if (timer) clearTimeout(timer)
		timer = setTimeout(onIdle, idleMs)
	}
	const clear = () => {
		if (timer) clearTimeout(timer)
		timer = undefined
	}
	poke()
	return { poke, clear }
}
