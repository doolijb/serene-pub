/**
 * 🚧 `actions-seen` (core only): clear the "new" marks on these actions.
 * Core's own lists (the askers table, `./askers.ts`): a plugin's widget does
 * not clear the marks on other packages' actions. No `keys` clears none.
 */

/** What this answer needs of the page. */
export interface ActionsSeenDeps {
	markActionsSeen(keys: string[]): void
}

/** Answer one `actions-seen`. */
export function answerActionsSeen(params: unknown, deps: ActionsSeenDeps): void {
	const p = params as Record<string, unknown>
	deps.markActionsSeen((p.keys as string[] | undefined) ?? [])
}
