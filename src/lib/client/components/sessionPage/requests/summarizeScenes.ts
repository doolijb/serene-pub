/**
 * 🚧 `summarize-scenes` (live scenes §5, §7, lane D; core only): Chronicle's
 * background summaries — a scene row's *Summarize*, the open scene's *Close
 * and summarize* (after its close), and *Summarize all (N)* (no `sceneIds`:
 * every closed scene of the session whose summary has not run or failed).
 * Through `scenes:processAll`, settled on its own reply; each scene then runs
 * through `scenes:process` on the server, its activity card and review as
 * ever. The server judges who may (the owner) and refuses when the session's
 * summaries are `never`; its refusal is the asking widget's to say. Resolves
 * with how many were queued.
 */
import type { WidgetRequests } from "@serene-pub/sdk"

type Result = WidgetRequests["summarize-scenes"]["result"]

/** What this answer needs of the page: the background summaries, settled on their reply. */
export interface SummarizeScenesDeps {
	summarizeScenes(sceneIds?: number[]): Promise<number>
}

/** Answer one `summarize-scenes`. Rejects, in words. */
export async function answerSummarizeScenes(
	params: unknown,
	deps: SummarizeScenesDeps
): Promise<Result> {
	const raw = (params ?? {}) as { sceneIds?: unknown }
	let sceneIds: number[] | undefined
	if (raw.sceneIds !== undefined) {
		if (
			!Array.isArray(raw.sceneIds) ||
			!raw.sceneIds.every((id) => typeof id === "number" && Number.isInteger(id))
		)
			throw new Error("summarize-scenes takes sceneIds as a list of whole numbers")
		if (!raw.sceneIds.length) return { started: 0 }
		sceneIds = raw.sceneIds as number[]
	}
	return { started: await deps.summarizeScenes(sceneIds) }
}
