/**
 * The lightbox's focus (composer attachments §3.4, lane F): it takes focus
 * into itself when it opens and hands it back to the tile that opened it.
 */
import { afterEach, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import MediaLightbox from "./MediaLightbox.svelte"
import { lightboxStateOf } from "./mediaLightbox"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 50))
	flushSync()
}

test("focus goes in on open and returns to the opener on close", async () => {
	const tile = document.createElement("button")
	tile.textContent = "Open image cat.png"
	document.body.append(tile)
	tile.focus()
	expect(document.activeElement).toBe(tile)

	const props = $state({
		open: false,
		onOpenChange: (e: { open: boolean }) => (props.open = e.open),
		state: lightboxStateOf({ src: "/media/1" })
	})
	const host = document.createElement("div")
	document.body.append(host)
	app = mount(MediaLightbox, { target: host, props })
	await settle()

	props.open = true
	await settle()
	const content = document.querySelector("[data-media-lightbox]")!
	expect(content.contains(document.activeElement)).toBe(true)

	props.open = false
	await settle()
	expect(document.activeElement).toBe(tile)
})
