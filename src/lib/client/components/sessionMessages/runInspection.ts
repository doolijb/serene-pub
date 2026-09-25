/**
 * "Inspect run" on a reply (R55: administrators only), as the page hands it
 * to the message controls. The page owns the socket and the inspector; the
 * controls ask through this context and never import either (C0's rule for
 * the widgets under `sessionMessages/`).
 *
 * ⏳ A Svelte context set by the session page until C0b moves the page's
 * logic behind the widget context, where this becomes a core verb.
 */
import { getContext, setContext } from "svelte"

export interface RunInspection {
	/** The run that wrote this reply, or `null` when none is recorded. */
	runOf: (messageId: number) => Promise<string | null>
	/** Open the run inspector on a run. */
	openRun: (runId: string) => void
}

const KEY = Symbol("sp-run-inspection")

export const setRunInspection = (r: RunInspection): void => {
	setContext(KEY, r)
}

export const getRunInspection = (): RunInspection | undefined => getContext<RunInspection | undefined>(KEY)

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
