/**
 * Which run the inspector is showing, if any.
 *
 * Module-scoped because the affordances that open it are scattered — a
 * message's overflow menu, a progress card that just finished, a row in the
 * admin runs list — and threading a callback from each of them to one modal is
 * three prop chains through screens that have nothing else to do with runs.
 * One modal is mounted in the app shell and reads this.
 *
 * The Runs panel does NOT use this: it renders the inspector inline, beside
 * the list it belongs to, and a modal over a list it is already part of would
 * hide the thing being compared.
 */

let runId = $state<string | null>(null)

export const runInspector = {
	/** The open run, or null when the inspector is closed. */
	get runId(): string | null {
		return runId
	},

	open(id: string): void {
		if (id) runId = id
	},

	close(): void {
		runId = null
	}
}
