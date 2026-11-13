import { loreRoute } from "../loreRoute.svelte"
import { DEFAULT_LENS } from "$lib/shared/lorebooks/loreRoute"
import { lensListsPool } from "../lenses/registry"

/**
 * Where an unfiled scene opens from the Time lens or the graph (★S2-2): the
 * History door's *Not yet compiled* group, at the scene's date. The scene has
 * no entry to open, so the opener leaves a handoff the group takes.
 */
let focus = $state<{ lorebookId: number; sceneId: number } | null>(null)

export function openUnfiledScene(scene: { id: number; lorebookId: number }) {
	focus = { lorebookId: scene.lorebookId, sceneId: scene.id }
	return (async () => {
		await loreRoute.navigate({ type: "openScope", scope: "history" })
		// The group is the list's head, so the lens must draw the list.
		if (!lensListsPool(loreRoute.route.lens ?? DEFAULT_LENS))
			await loreRoute.navigate({ type: "setLens", lens: "list" })
	})()
}

/** The handoff when it names this book — returned once, then cleared. */
export function takeUnfiledFocus(lorebookId: number): number | null {
	if (!focus || focus.lorebookId !== lorebookId) return null
	const sceneId = focus.sceneId
	focus = null
	return sceneId
}
