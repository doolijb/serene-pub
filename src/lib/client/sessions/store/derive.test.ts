import { describe, expect, it } from "vitest"
import { generatingOf, lorebookFixedOf, rewindOf, sessionBookOf, storyClockKeyOf } from "./derive"

describe("sessionBookOf", () => {
	it("prefers the attached book, falls back to the own book, else null", () => {
		expect(sessionBookOf({ lorebookId: 4, ownBookId: 9 })).toBe(4)
		expect(sessionBookOf({ lorebookId: null, ownBookId: 9 })).toBe(9)
		expect(sessionBookOf({})).toBeNull()
		expect(sessionBookOf(undefined)).toBeNull()
	})
})

describe("rewindOf", () => {
	it("is null without a record, and delegates with one", () => {
		expect(rewindOf(undefined, [])).toBeNull()
		expect(rewindOf({ id: 1 } as any, [])).toBeNull() // no served rewind on the record
	})
	it("returns a state when the record serves one", () => {
		const state = rewindOf({ id: 1, rewind: { back: null, forward: "none", ahead: 0 } } as any, [])
		expect(state === null).toBe(false)
	})
})

describe("generatingOf", () => {
	const run = (kind: string, reply?: { channel: string }) => ({ sessionId: 1, runId: "r", kind, status: "x", reply }) as any
	it("is true when the newest row is generating, not an older one", () => {
		expect(generatingOf([{ isGenerating: false }, { isGenerating: true }], [])).toBe(true)
		expect(generatingOf([{ isGenerating: true }, { isGenerating: false }], [])).toBe(false)
	})
	it("is true while a reply run is in flight, with or without a reply channel", () => {
		expect(generatingOf([], [run("reply", { channel: "main" })])).toBe(true)
		expect(generatingOf([], [run("reply")])).toBe(true)
	})
	it("is true while an action run is in flight", () => {
		expect(generatingOf([], [run("action")])).toBe(true)
	})
	it("is false for a routine or maintenance run, and for nothing", () => {
		expect(generatingOf([], [run("routine")])).toBe(false)
		expect(generatingOf([], [run("maintenance")])).toBe(false)
		expect(generatingOf([], [])).toBe(false)
	})
})

describe("lorebookFixedOf", () => {
	it("is false without a record", () => {
		expect(lorebookFixedOf(undefined, [{ metadata: null } as any])).toBe(false)
	})
	it("follows the server's word", () => {
		expect(lorebookFixedOf({ lorebookFixed: true } as any, [])).toBe(true)
		expect(lorebookFixedOf({} as any, [])).toBe(false)
	})
	it("is true once a line is not a greeting", () => {
		expect(lorebookFixedOf({} as any, [{ metadata: { isGreeting: true } } as any])).toBe(false)
		expect(lorebookFixedOf({} as any, [{ metadata: null } as any])).toBe(true)
	})
})

describe("storyClockKeyOf", () => {
	it("is empty when the session follows its line", () => {
		expect(storyClockKeyOf(undefined)).toBe("")
		expect(storyClockKeyOf({ storyClockYear: null } as any)).toBe("")
	})
	it("keys year, month and day", () => {
		expect(JSON.parse(storyClockKeyOf({ storyClockYear: 3, storyClockMonth: 2 } as any))).toEqual({
			year: 3,
			month: 2,
			day: null
		})
	})
})
