/**
 * 🚧 `fire-turn` (core only): fire the next turn, as the page's own
 * continue-with-next-character does. Its one param is the `channel` of the
 * composer Continue was pressed in (lair re-plan R5) — the first entry
 * prepared there is the one fired; absent, the page answers for its own
 * composer. It refuses nothing.
 */

/** What this answer needs of the page. */
export interface FireTurnDeps {
	fireTurn(channel?: string): void
}

/** Answer one `fire-turn`. */
export function answerFireTurn(params: unknown, deps: FireTurnDeps): void {
	const channel = (params as { channel?: unknown } | null | undefined)?.channel
	deps.fireTurn(
		typeof channel === "string" && channel.trim() ? channel.trim() : undefined
	)
}
