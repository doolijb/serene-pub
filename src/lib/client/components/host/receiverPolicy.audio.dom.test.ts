import { describe, expect, it } from "vitest"
import { shouldForward, summarize, TIMEUPDATE_MIN_MS } from "./receiverPolicy"

describe("an audio event's summary (host elements 1.7)", () => {
	it("carries { currentTime, duration, paused } in seconds, 0 until known", () => {
		const audio = document.createElement("audio")
		// jsdom: duration is NaN, currentTime 0, paused true
		expect(summarize(new Event("play"), "play", undefined)).toEqual({ type: "play" })
		const e = new Event("timeupdate")
		Object.defineProperty(e, "target", { value: audio })
		expect(summarize(e, "timeupdate", undefined)).toEqual({
			type: "timeupdate",
			detail: { currentTime: 0, duration: 0, paused: true }
		})
		Object.defineProperty(audio, "currentTime", { value: 1.5, configurable: true })
		Object.defineProperty(audio, "duration", { value: 4, configurable: true })
		Object.defineProperty(audio, "paused", { value: false, configurable: true })
		const p = new Event("pause")
		Object.defineProperty(p, "target", { value: audio })
		expect(summarize(p, "pause", undefined).detail).toEqual({ currentTime: 1.5, duration: 4, paused: false })
	})
	it("carries the same detail for loadedmetadata", () => {
		const audio = document.createElement("audio")
		const e = new Event("loadedmetadata")
		Object.defineProperty(e, "target", { value: audio })
		expect(summarize(e, "loadedmetadata", undefined).detail).toEqual({ currentTime: 0, duration: 0, paused: true })
	})
	it("never adds a detail to an event of another element, or to an audio `error`", () => {
		const audio = document.createElement("audio")
		const e = new Event("error")
		Object.defineProperty(e, "target", { value: audio })
		expect(summarize(e, "error", undefined)).toEqual({ type: "error" })
		const b = new Event("play")
		Object.defineProperty(b, "target", { value: document.createElement("div") })
		expect(summarize(b, "play", undefined)).toEqual({ type: "play" })
	})
	it("a media duration of Infinity reads 0", () => {
		const audio = document.createElement("audio")
		Object.defineProperty(audio, "duration", { value: Infinity, configurable: true })
		const e = new Event("play")
		Object.defineProperty(e, "target", { value: audio })
		expect((summarize(e, "play", undefined).detail as { duration: number }).duration).toBe(0)
	})
})

describe("shouldForward", () => {
	it("gates only timeupdate, at about four a second", () => {
		expect(shouldForward("timeupdate", null, 1000)).toBe(true)
		expect(shouldForward("timeupdate", 1000, 1000 + TIMEUPDATE_MIN_MS - 1)).toBe(false)
		expect(shouldForward("timeupdate", 1000, 1000 + TIMEUPDATE_MIN_MS)).toBe(true)
		expect(shouldForward("play", 1000, 1001)).toBe(true)
		expect(shouldForward("click", 1000, 1001)).toBe(true)
	})
})
