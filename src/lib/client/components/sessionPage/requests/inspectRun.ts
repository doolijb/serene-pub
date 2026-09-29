/**
 * 🚧 `inspect-run` (anyone may ask): open the run that wrote one line. A
 * request is not a grant: runs are for admins, and a line no run is recorded
 * as writing is refused.
 */

/** What this answer needs of the page. */
export interface InspectRunDeps {
	isAdmin: boolean
	runOfMessage(messageId: number): Promise<string | null>
	openRun(runId: string): void
}

/** Answer one `inspect-run`. */
export async function answerInspectRun(params: unknown, deps: InspectRunDeps): Promise<void> {
	const p = params as Record<string, unknown>
	if (!deps.isAdmin) throw new Error("runs are for admins")
	const runId = await deps.runOfMessage(Number(p.messageId))
	if (!runId) throw new Error("no run is recorded as writing that message")
	deps.openRun(runId)
}
