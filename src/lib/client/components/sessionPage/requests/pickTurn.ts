/**
 * 🚧 `pick-turn` (anyone may ask): open the page's turn picker. It takes no
 * params and refuses nothing.
 */

/** What this answer needs of the page. */
export interface PickTurnDeps {
	showTurnPicker(): void
}

/** Answer one `pick-turn`. */
export function answerPickTurn(_params: unknown, deps: PickTurnDeps): void {
	deps.showTurnPicker()
}
