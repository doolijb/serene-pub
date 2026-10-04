import { toaster } from "$lib/client/utils/toaster"

/**
 * The scenes whose summarize run a Process scene window in this tab is
 * showing, counted: a lorebook docked beside a session page can hold two
 * windows on one scene.
 */
const shown = new Map<number, number>()

/**
 * Held while a Process scene window shows a run of `sceneId` (its running
 * step): the window says the run's failure in place, so nothing else in this
 * tab does. Returns the release.
 */
export function showSceneRun(sceneId: number): () => void {
	shown.set(sceneId, (shown.get(sceneId) ?? 0) + 1)
	let released = false
	return () => {
		if (released) return
		released = true
		const left = (shown.get(sceneId) ?? 1) - 1
		if (left > 0) shown.set(sceneId, left)
		else shown.delete(sceneId)
	}
}

/**
 * A summarize run's failure (`scenes:process:error`), said once in the tab
 * that started the run — the server answers only that tab.
 *
 * The window showing the run says it in place. When none is (it was closed
 * while the run went on, or it shows another scene), it is said here, as a
 * toast. Layout declares this, once per tab, so a lorebook docked beside a
 * session page does not say it a second time.
 *
 * Declared on the bare key, which the interest registry dispatches before the
 * scoped key the window hears; and a window lets go of its hold in an effect,
 * after the dispatch is over. Either way the hold still stands when this reads
 * it.
 */
export function sayUnshownSceneRunFailure(msg: {
	sceneId?: unknown
	error?: string
}): void {
	if (typeof msg?.sceneId === "number" && shown.has(msg.sceneId)) return
	toaster.error({
		title: "The scene was not summarized",
		description: msg?.error
	})
}
