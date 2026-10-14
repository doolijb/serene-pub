/**
 * 🚧 `extend-graph` (PLAN-core-widgets W3): core's Chronicle opens the
 * page's **Extend graph** review — the composer Lore pane's, moved — for
 * this session's scenes on its line that the lorebook's relationship graph
 * has not read. Core's widgets only (the askers table, `./askers.ts`); the
 * review itself is the page's (`GraphBuildModal`), and its writes are the
 * book owner's, as the server judges them. Resolves once it is shown.
 */

/** What this answer needs of the page. */
export interface ExtendGraphDeps {
	/** This session's scenes on its line not yet in the graph (`extendCountsOf`). */
	ungraphedScenes(): number
	/** Open the review. */
	openExtendGraph(): void
}

/** Answer one `extend-graph`. Refused when there is nothing to read. */
export function answerExtendGraph(
	_params: unknown,
	deps: ExtendGraphDeps
): void {
	if (deps.ungraphedScenes() <= 0)
		throw new Error("this session has no scenes waiting for the graph")
	deps.openExtendGraph()
}
