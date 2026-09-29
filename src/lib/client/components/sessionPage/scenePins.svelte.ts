/**
 * 🚧 The session page's scene-image pins: the portrait pinned on each side
 * of the stage. This is the ONE state for them. It is loaded per session from
 * this browser (`sceneImages:<sessionId>`), persisted back there, mirrored
 * into the `sceneImages` store the layout draws from, and projected into
 * `characters.v1`. The Scene images tab binds to it and `clear-scene-image`
 * clears it, so page and widget read one answer (R77, F10).
 *
 * Construct it during component init: its effects belong to the component.
 */
import type { Writable } from "svelte/store"
import { sceneImages as sharedSceneImages } from "$lib/client/stores/sceneImages"
import type { SceneImagePins } from "./requests/clearSceneImage"

export type ScenePinsValue = { left: string | null; right: string | null }

/** Where one session's pins are kept in this browser. */
export const scenePinsStorageKey = (sessionId: number) => `sceneImages:${sessionId}`

export class ScenePins implements SceneImagePins {
	left = $state<string | null>(null)
	right = $state<string | null>(null)
	#loaded = $state(false)

	constructor(
		sessionId: () => number | null | undefined,
		store: Writable<ScenePinsValue> = sharedSceneImages
	) {
		// Load: each session opens with its own pins, or none.
		$effect(() => {
			const id = sessionId()
			this.#loaded = false
			this.left = null
			this.right = null
			if (id) {
				try {
					const saved = localStorage.getItem(scenePinsStorageKey(id))
					if (saved) {
						const { left, right } = JSON.parse(saved)
						this.left = left ?? null
						this.right = right ?? null
					}
				} catch {}
			}
			this.#loaded = true
		})
		// Persist every change after the load; an empty stage keeps nothing.
		$effect(() => {
			if (!this.#loaded) return
			const id = sessionId()
			if (!id) return
			const left = this.left
			const right = this.right
			try {
				if (left || right)
					localStorage.setItem(scenePinsStorageKey(id), JSON.stringify({ left, right }))
				else localStorage.removeItem(scenePinsStorageKey(id))
			} catch {}
		})
		// Mirror into the store the layout draws from.
		$effect(() => {
			store.set({ left: this.left, right: this.right })
		})
	}

	/** Take down one side's portrait. An empty side is already clear. */
	clear(side: "left" | "right") {
		if (side === "left") this.left = null
		else this.right = null
	}
}
