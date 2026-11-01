import { describe, expect, it, vi } from "vitest"
import { ensureOneSoundAtATime } from "./oneSoundAtATime"

/** An audio whose play/pause are stubs that keep `paused` honest and raise the events. */
function player(into: Element) {
	const a = document.createElement("audio")
	let paused = true
	Object.defineProperty(a, "paused", { get: () => paused, configurable: true })
	a.pause = vi.fn(() => {
		paused = true
		a.dispatchEvent(new Event("pause"))
	})
	a.play = vi.fn(() => {
		paused = false
		a.dispatchEvent(new Event("play"))
		return Promise.resolve()
	})
	into.appendChild(a)
	return a
}

describe("one sound at a time", () => {
	it("starting B pauses A, and A's pause arrives", () => {
		ensureOneSoundAtATime()
		const a = player(document.body)
		const b = player(document.body)
		const paused = vi.fn()
		a.addEventListener("pause", paused)
		void a.play()
		void b.play()
		expect(a.paused).toBe(true)
		expect(b.paused).toBe(false)
		expect(paused).toHaveBeenCalledTimes(1)
	})
	it("a try-out audio outside any box pauses a box audio, and the reverse", () => {
		ensureOneSoundAtATime()
		const box = document.createElement("div")
		document.body.appendChild(box)
		const inBox = player(box)
		const tryOut = player(document.body)
		void inBox.play()
		void tryOut.play()
		expect(inBox.paused).toBe(true)
		void inBox.play()
		expect(tryOut.paused).toBe(true)
		expect(inBox.paused).toBe(false)
	})
	it("installing twice adds one listener", () => {
		const spy = vi.spyOn(document, "addEventListener")
		const d = document.implementation.createHTMLDocument("x")
		const add = vi.spyOn(d, "addEventListener")
		ensureOneSoundAtATime(d)
		ensureOneSoundAtATime(d)
		expect(add).toHaveBeenCalledTimes(1)
		spy.mockRestore()
	})
})
