import { writable } from "svelte/store"

/**
 * ⏳ Paths for the left and right character scene overlay images, mirrored by
 * the page's `ScenePins`. Nothing pins since W6 (2026-10-11): the pins are
 * seeded into Scene Portraits once and cleared. REMOVE in 0.7.0.
 */
export const sceneImages = writable<{
	left: string | null
	right: string | null
}>({
	left: null,
	right: null
})
