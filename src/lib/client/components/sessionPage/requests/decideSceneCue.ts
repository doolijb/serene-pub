/**
 * 🚧 `decide-scene-cue` (live scenes §4, lane D; core only): a **scene cue**'s
 * **Yes** — open a scene at the cue's line, the lane's open scene closing at
 * the line before — or **Not here**, which dismisses every cue at that line
 * so it is never offered there again. Through `scenes:decideCue`, settled on
 * its own reply; the server judges who may (the session's owner) and its
 * refusal is the asking widget's to say, never a toast. Resolves with the
 * scene it opened, or null.
 */
import type { WidgetRequests } from "@serene-pub/sdk"

type Result = WidgetRequests["decide-scene-cue"]["result"]

/** What this answer needs of the page: the decide, settled on its reply. */
export interface DecideSceneCueDeps {
	decideSceneCue(cueId: number, accept: boolean): Promise<number | null>
}

/** Answer one `decide-scene-cue`. Rejects, in words, with what a widget got wrong and the server's refusal. */
export async function answerDecideSceneCue(
	params: unknown,
	deps: DecideSceneCueDeps
): Promise<Result> {
	const p = (params ?? {}) as { cueId?: unknown; accept?: unknown }
	const cueId = p.cueId
	if (typeof cueId !== "number" || !Number.isInteger(cueId))
		throw new Error("decide-scene-cue takes the cue's id, a whole number")
	if (typeof p.accept !== "boolean")
		throw new Error("decide-scene-cue takes accept: true (Yes) or false (Not here)")
	return { sceneId: await deps.decideSceneCue(cueId, p.accept) }
}
