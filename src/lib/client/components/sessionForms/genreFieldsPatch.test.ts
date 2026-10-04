import { describe, expect, it } from "vitest"
import { adoptSavedGenreFields, changedGenreFields } from "./genreFieldsPatch"

const NOTE = { text: "It is raining.", depth: 4, interval: 1, role: "system" }

describe("changedGenreFields — Save sends only what the person changed (2026-10-03)", () => {
	it("an untouched field is not sent; an unchanged form sends no genreFields at all", () => {
		expect(changedGenreFields({ authorsNote: NOTE, mood: "calm" }, { authorsNote: NOTE, mood: "calm" })).toBeUndefined()
		expect(
			changedGenreFields({ authorsNote: { ...NOTE }, mood: "tense" }, { authorsNote: NOTE, mood: "calm" })
		).toEqual({ mood: "tense" })
	})

	it("an object field goes whole when any member moved", () => {
		expect(changedGenreFields({ authorsNote: { ...NOTE, depth: 2 } }, { authorsNote: NOTE })).toEqual({
			authorsNote: { ...NOTE, depth: 2 }
		})
	})

	it("form noise is not a change: '5' is 5, '' is null, key order never counts", () => {
		expect(changedGenreFields({ n: "5", s: "" }, { n: 5, s: null })).toBeUndefined()
		expect(
			changedGenreFields({ authorsNote: { role: "system", interval: 1, depth: 4, text: "It is raining." } }, { authorsNote: NOTE })
		).toBeUndefined()
	})

	it("a value set where none was loaded is a change; changing it back is clean", () => {
		expect(changedGenreFields({ mood: "calm" }, {})).toEqual({ mood: "calm" })
		expect(changedGenreFields({ mood: "" }, {})).toBeUndefined()
	})

	it("limits to the declared keys when told them", () => {
		expect(changedGenreFields({ mood: "tense", stale: 1 }, { mood: "calm" }, ["mood"])).toEqual({ mood: "tense" })
	})
})

describe("adoptSavedGenreFields — a newer save reaches the open form (§6.14)", () => {
	it("an untouched field follows the saved value; the snapshot moves", () => {
		const next = adoptSavedGenreFields(
			{ authorsNote: NOTE, mood: "tense" },
			{ authorsNote: NOTE, mood: "calm" },
			{ authorsNote: { ...NOTE, text: "The storm has passed." }, mood: "calm" }
		)
		expect(next.moved).toBe(true)
		expect(next.current).toEqual({ authorsNote: { ...NOTE, text: "The storm has passed." }, mood: "tense" })
		expect(next.loaded).toEqual({ authorsNote: { ...NOTE, text: "The storm has passed." }, mood: "calm" })
		// The two sides never share an object.
		expect(next.current.authorsNote).not.toBe(next.loaded.authorsNote)
	})

	it("an edited field keeps the edit while the snapshot moves under it", () => {
		const next = adoptSavedGenreFields(
			{ authorsNote: { ...NOTE, text: "Mine" } },
			{ authorsNote: NOTE },
			{ authorsNote: { ...NOTE, text: "Theirs" } }
		)
		expect(next.current.authorsNote).toEqual({ ...NOTE, text: "Mine" })
		expect(next.loaded.authorsNote).toEqual({ ...NOTE, text: "Theirs" })
		expect(changedGenreFields(next.current, next.loaded)).toEqual({ authorsNote: { ...NOTE, text: "Mine" } })
	})

	it("the echo of what the form already holds moves nothing", () => {
		const current = { authorsNote: NOTE }
		const loaded = { authorsNote: NOTE }
		const next = adoptSavedGenreFields(current, loaded, { authorsNote: { ...NOTE } })
		expect(next.moved).toBe(false)
		expect(next.current).toBe(current)
		expect(next.loaded).toBe(loaded)
	})
})
