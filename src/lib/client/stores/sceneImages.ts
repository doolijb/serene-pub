import { writable } from "svelte/store"

/** Paths for the left and right character scene overlay images. Set from the chat page, read by Layout. */
export const sceneImages = writable<{
	left: string | null
	right: string | null
}>({
	left: null,
	right: null
})
