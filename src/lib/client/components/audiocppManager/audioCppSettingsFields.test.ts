import { describe, expect, test } from "vitest"
import {
	diffSettings,
	draftsFrom,
	msToSeconds,
	runsOnLine,
	secondsToMs
} from "./audioCppSettingsFields"

const saved = {
	port: 5002,
	modelsDir: null,
	idleUnloadMs: 60000,
	maxLoadedModels: null,
	subprocessTimeoutMinutes: 30
}

describe("audio.cpp settings fields", () => {
	test("ms and seconds convert both ways, null stays null", () => {
		expect(msToSeconds(60000)).toBe(60)
		expect(msToSeconds(null)).toBe(null)
		expect(secondsToMs(1.5)).toBe(1500)
		expect(secondsToMs(null)).toBe(null)
	})
	test("unchanged drafts diff to nothing", () => {
		expect(diffSettings(saved, draftsFrom(saved))).toEqual({})
	})
	test("only changed fields are sent", () => {
		const d = { ...draftsFrom(saved), port: 6000, idleSeconds: null }
		expect(diffSettings(saved, d)).toEqual({ port: 6000, idleUnloadMs: null })
	})
	test("a blank models folder is null; blank port is skipped", () => {
		const d = { ...draftsFrom(saved), modelsDir: "  /x ", port: null }
		expect(diffSettings(saved, d)).toEqual({ modelsDir: "/x" })
	})
	test("runs-on line", () => {
		expect(
			runsOnLine({ backendLabel: "CPU", deviceIndex: null, threads: null })
		).toBe(
			"Runs on: CPU · default device · automatic threads — chosen in Admin › Hardware."
		)
	})
})
