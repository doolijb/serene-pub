/**
 * The media lightbox (composer attachments plan §3.4, lane F): a message's
 * images paged with the arrow keys and the side buttons, a counter, a
 * Download for the app's own files, an Info pane reading the file's record,
 * Esc to close, and 44px controls.
 */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import MediaLightbox from "./MediaLightbox.svelte"
import {
	lightboxStateOf,
	mediaRefOf,
	stepIndex,
	swipeDirection
} from "./mediaLightbox"
import type { MediaInfoV1 } from "$lib/shared/media/info"

let apps: ReturnType<typeof mount>[] = []

/** Zag's dismissable layer listens after a frame; let it. */
async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 20))
	flushSync()
}
afterEach(() => {
	for (const app of apps) unmount(app)
	apps = []
	document.body.innerHTML = ""
})

const gallery = lightboxStateOf({
	src: "/media/2",
	gallery: {
		srcs: ["/media/1", "/media/2", "/media/3"],
		index: 1,
		captions: ["one.png", "two.png", "three.png"]
	}
})

const generated: MediaInfoV1 = {
	id: 2,
	uuid: "11111111-2222-3333-4444-555555555555",
	kind: "image",
	filename: "generated.png",
	mime: "image/png",
	bytes: 204800,
	width: 832,
	height: 1216,
	generated: { prompt: "a lighthouse at dusk", seed: 42, model: "sdxl", steps: 30 }
}

async function openLightbox(
	state = gallery,
	loadInfo: (ref: string) => Promise<MediaInfoV1 | null> = async () => generated
) {
	const closed: boolean[] = []
	const host = document.createElement("div")
	document.body.append(host)
	apps.push(
		mount(MediaLightbox, {
			target: host,
			props: {
				open: true,
				onOpenChange: (e: { open: boolean }) => closed.push(e.open),
				state,
				loadInfo
			}
		})
	)
	await settle()
	return { closed }
}

const content = () => document.querySelector<HTMLElement>("[data-media-lightbox]")!
const img = () => content().querySelector("img")!
const byLabel = (label: string) =>
	document.querySelector<HTMLElement>(`[aria-label="${label}"]`)
const press = (key: string) => {
	content().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
	flushSync()
}

describe("reading a view-image", () => {
	test("a gallery that holds src opens at its index; anything else is the one image", () => {
		expect(gallery.index).toBe(1)
		expect(gallery.images.map((i) => i.mediaRef)).toEqual(["1", "2", "3"])
		const single = lightboxStateOf({
			src: "/media/9",
			gallery: { srcs: ["/media/1"], index: 0 }
		})
		expect(single).toEqual({
			images: [{ src: "/media/9", caption: null, mediaRef: "9" }],
			index: 0
		})
	})

	test("only the app's own files have a media ref", () => {
		expect(mediaRefOf("/media/41?v=thumb")).toBe("41")
		expect(mediaRefOf("/session-assets/7")).toBe("7")
		expect(mediaRefOf("https://example.com/a.png")).toBeNull()
		expect(mediaRefOf("/media/../x")).toBeNull()
	})

	test("paging wraps, and a swipe needs to be across and long enough", () => {
		expect(stepIndex(2, 1, 3)).toBe(0)
		expect(stepIndex(0, -1, 3)).toBe(2)
		expect(swipeDirection(-80, 10)).toBe(1)
		expect(swipeDirection(80, 10)).toBe(-1)
		expect(swipeDirection(20, 0)).toBeNull()
		expect(swipeDirection(60, 90)).toBeNull()
	})
})

describe("MediaLightbox", () => {
	test("opens on the asked image, full size, with a counter and a download", async () => {
		await openLightbox()
		expect(img().getAttribute("src")).toBe("/media/2")
		expect(img().getAttribute("alt")).toBe("two.png")
		expect(document.querySelector("[data-lightbox-counter]")?.textContent?.trim()).toBe(
			"2 of 3"
		)
		expect(byLabel("Download")?.getAttribute("href")).toBe("/media/2?download=1")
	})

	test("arrow keys and the side buttons page through, wrapping", async () => {
		await openLightbox()
		press("ArrowRight")
		expect(img().getAttribute("src")).toBe("/media/3")
		press("ArrowRight")
		expect(img().getAttribute("src")).toBe("/media/1")
		press("ArrowLeft")
		expect(img().getAttribute("src")).toBe("/media/3")
		byLabel("Previous image")!.click()
		flushSync()
		expect(img().getAttribute("src")).toBe("/media/2")
		expect(document.querySelector("[data-lightbox-counter]")?.textContent?.trim()).toBe(
			"2 of 3"
		)
	})

	test("one image has no paging controls", async () => {
		await openLightbox(lightboxStateOf({ src: "/media/5" }))
		expect(byLabel("Next image")).toBeNull()
		expect(document.querySelector("[data-lightbox-counter]")).toBeNull()
	})

	test("Info reads the shown file's record: a generated image's prompt and seed", async () => {
		const asked: string[] = []
		await openLightbox(gallery, async (ref) => {
			asked.push(ref)
			return generated
		})
		const info = byLabel("Info")!
		expect(info.getAttribute("aria-expanded")).toBe("false")
		info.click()
		flushSync()
		await tick()
		await Promise.resolve()
		flushSync()
		expect(asked).toEqual(["2"])
		const pane = document.querySelector("[data-lightbox-info]")!
		expect(pane.textContent).toContain("a lighthouse at dusk")
		expect(pane.textContent).toContain("42")
		expect(pane.textContent).toContain("generated.png")
		expect(pane.textContent).toContain("200 KB")
	})

	test("Esc closes", async () => {
		const { closed } = await openLightbox()
		byLabel("Close")!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
		)
		await settle()
		expect(closed).toContain(false)
	})

	test("a file that is gone says so instead of a broken image", async () => {
		await openLightbox()
		img().dispatchEvent(new Event("error"))
		flushSync()
		expect(document.querySelector("[data-lightbox-missing]")?.textContent).toContain(
			"File no longer available"
		)
	})

	test("every control is a 44px target", async () => {
		await openLightbox()
		for (const label of ["Info", "Download", "Close", "Previous image", "Next image"]) {
			expect(byLabel(label)?.className, label).toContain("size-11")
		}
	})
})
