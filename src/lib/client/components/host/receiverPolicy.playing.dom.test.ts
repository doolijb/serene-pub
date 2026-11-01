import { describe, expect, it, vi } from "vitest"
import { createGuardedReceiver, syncPlaying } from "./receiverPolicy"

function audio(log: string[] = [], name = "a") {
	const a = document.createElement("audio")
	a.play = vi.fn(() => {
		log.push(`play ${name}`)
		return Promise.resolve()
	})
	a.pause = vi.fn(() => {
		log.push(`pause ${name}`)
	})
	return a
}
const tick = () => new Promise((r) => setTimeout(r, 0))
function boxWithGuard() {
	const box = document.createElement("div")
	document.body.appendChild(box)
	const g = createGuardedReceiver(box, { idPrefix: "t", fnFor: () => () => {}, warn: () => {}, owner: "core" })
	return { box, g }
}

describe("syncPlaying (host elements 1.8)", () => {
	it("on plays, off pauses, a non-audio is ignored", () => {
		const a = audio()
		syncPlaying(a, true)
		syncPlaying(a, false)
		expect((a.play as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
		expect((a.pause as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1)
		expect(() => syncPlaying(document.createElement("div"), true)).not.toThrow()
	})
	it("a refused play answers with a pause event", async () => {
		const a = audio()
		a.play = vi.fn(() => Promise.reject(new Error("NotAllowedError")))
		const paused = vi.fn()
		a.addEventListener("pause", paused)
		syncPlaying(a, true)
		await tick()
		expect(paused).toHaveBeenCalledTimes(1)
	})
	it("a play that throws synchronously answers with a pause event too", () => {
		const a = audio()
		a.play = vi.fn(() => {
			throw new Error("x")
		})
		const paused = vi.fn()
		a.addEventListener("pause", paused)
		syncPlaying(a, true)
		expect(paused).toHaveBeenCalledTimes(1)
	})
})

describe("the guarded box's observer", () => {
	it("plays an audio landing with playing, leaves one landing without it alone, finds a nested one", async () => {
		const { box, g } = boxWithGuard()
		const log: string[] = []
		const withIt = audio(log, "with")
		withIt.setAttribute("playing", "")
		const without = audio(log, "without")
		const wrap = document.createElement("div")
		const nested = audio(log, "nested")
		nested.setAttribute("playing", "")
		wrap.appendChild(nested)
		box.append(withIt, without, wrap)
		await tick()
		expect(log.sort()).toEqual(["play nested", "play with"])
		g.dispose()
	})
	it("toggling playing plays then pauses", async () => {
		const { box, g } = boxWithGuard()
		const log: string[] = []
		const a = audio(log)
		box.appendChild(a)
		await tick()
		a.setAttribute("playing", "")
		await tick()
		a.removeAttribute("playing")
		await tick()
		expect(log).toEqual(["play a", "pause a"])
		g.dispose()
	})
	it("in one batch, every playing removal runs before any addition", async () => {
		const { box, g } = boxWithGuard()
		const log: string[] = []
		const first = audio(log, "first")
		const second = audio(log, "second")
		first.setAttribute("playing", "")
		box.append(first, second)
		await tick()
		log.length = 0
		// the new line flips ON before the old flips OFF in record order
		second.setAttribute("playing", "")
		first.removeAttribute("playing")
		await tick()
		expect(log).toEqual(["pause first", "play second"])
		g.dispose()
	})
})
