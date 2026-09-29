/**
 * "Inspect run" on a reply (R55: administrators only): which run to open.
 * The conversation asks with the `inspect-run` widget request; the session
 * page answers it — it owns the socket and the run inspector — and picks
 * the run here.
 */

/**
 * Of the runs a message is an artifact of, the one worth explaining: a
 * message can be the artifact of several runs (regenerated, continued), and
 * the one that WROTE it and sent something wins over a newer preview or a
 * built-in's run (an edit, a hide — R-15), whose receipt has no prompt.
 */
export function runThatWrote(
	runs: Array<{ runId: string; isPreview?: boolean; actions?: string[] }>
): string | null {
	const wrote = (r: { actions?: string[] }) =>
		!r.actions || r.actions.some((a) => a === "created" || a === "updated")
	return (
		runs.find((r) => !r.isPreview && wrote(r))?.runId ??
		runs.find((r) => !r.isPreview)?.runId ??
		runs[0]?.runId ??
		null
	)
}
