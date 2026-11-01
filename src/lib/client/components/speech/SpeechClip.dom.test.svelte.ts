/** SpeechClip: one compact row driven by the audio element's events. */
import { afterEach, describe, expect, test } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import SpeechClip from "./SpeechClip.svelte"

let app: ReturnType<typeof mount> | null = null
let plays = 0
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	plays = 0
})
;(HTMLMediaElement.prototype as any).play = function () {
	plays++
	this.dispatchEvent(new Event("play"))
	return Promise.resolve()
}
;(HTMLMediaElement.prototype as any).pause = function () {
	this.dispatchEvent(new Event("pause"))
}
const render = (props: Record<string, unknown>) => {
	app = mount(SpeechClip, { target: document.body, props: { src: "blob:x", ...props } })
	flushSync()
}
const audio = () => document.querySelector("audio") as HTMLAudioElement
const button = () => document.querySelector("button") as HTMLButtonElement

describe("SpeechClip", () => {
	test("shows nothing without a clip", () => {
		render({ src: null })
		expect(document.querySelector("button")).toBeNull()
	})

	test("the button follows play and pause events", () => {
		render({})
		expect(button().getAttribute("aria-label")).toBe("Play the clip")
		button().click()
		flushSync()
		expect(plays).toBe(1)
		expect(button().getAttribute("aria-label")).toBe("Pause the clip")
		button().click()
		flushSync()
		expect(button().getAttribute("aria-label")).toBe("Play the clip")
	})

	test("the clock reads elapsed / duration and the voice chip names the voice", () => {
		render({ voiceLabel: "Aria" })
		const a = audio()
		Object.defineProperty(a, "duration", { value: 65, configurable: true })
		Object.defineProperty(a, "currentTime", { value: 7.4, configurable: true })
		a.dispatchEvent(new Event("loadedmetadata"))
		a.dispatchEvent(new Event("timeupdate"))
		flushSync()
		expect(document.querySelector('[data-testid="speech-clip-clock"]')!.textContent).toBe("0:07 / 1:05")
		expect(document.querySelector('[data-badge="surface"]')!.textContent).toBe("Aria")
		expect(document.querySelector('[role="progressbar"]')).not.toBeNull()
	})

	test("autoplay plays once on mount and a refused play stays quiet", async () => {
		;(HTMLMediaElement.prototype as any).play = () => Promise.reject(new Error("blocked"))
		render({ autoplay: true })
		await new Promise((r) => setTimeout(r, 0))
		expect(button().getAttribute("aria-label")).toBe("Play the clip")
		;(HTMLMediaElement.prototype as any).play = function () {
			plays++
			this.dispatchEvent(new Event("play"))
			return Promise.resolve()
		}
	})

	test("a load error is reported", () => {
		let msg = ""
		render({ onerror: (m: string) => (msg = m) })
		audio().dispatchEvent(new Event("error"))
		expect(msg).toContain("would not load")
	})
})
