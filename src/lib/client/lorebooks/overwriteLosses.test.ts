import { describe, expect, test } from "vitest"
import { describeOverwriteLosses } from "./overwriteLosses"

describe("describeOverwriteLosses", () => {
	test("says nothing when nothing would be lost", () => {
		expect(describeOverwriteLosses(undefined)).toBeNull()
		expect(
			describeOverwriteLosses({
				amendments: 0,
				presences: 0,
				branches: 0,
				sceneLinks: 0,
				stats: 0,
				places: 0,
				items: 0,
				sessionStats: 0,
				sheets: 0,
				sessionLoreRefs: 0,
				charactersRewritten: 0
			})
		).toBeNull()
	})

	test("counts each kind, singular and plural", () => {
		expect(
			describeOverwriteLosses({
				amendments: 3,
				presences: 1,
				branches: 2,
				sceneLinks: 1,
				stats: 0,
				places: 0,
				items: 0,
				sessionStats: 0,
				sheets: 0,
				sessionLoreRefs: 0,
				charactersRewritten: 0
			})
		).toBe(
			"Overwriting also deletes 3 dated changes, 1 presence, 2 branches and 1 scene captured from a session. The file does not carry them, so they cannot come back."
		)
		expect(
			describeOverwriteLosses({
				amendments: 0,
				presences: 0,
				branches: 1,
				sceneLinks: 0,
				stats: 0,
				places: 0,
				items: 0,
				sessionStats: 0,
				sheets: 0,
				sessionLoreRefs: 0,
				charactersRewritten: 0
			})
		).toBe(
			"Overwriting also deletes 1 branch. The file does not carry it, so it cannot come back."
		)
	})

	test("an older file names the stats it cannot carry and the places and items it brings back as world lore", () => {
		const none = {
			amendments: 0,
			presences: 0,
			branches: 0,
			sceneLinks: 0,
			stats: 0,
			places: 0,
			items: 0,
			sessionStats: 0,
			sheets: 0,
			sessionLoreRefs: 0,
			charactersRewritten: 0
		}
		expect(describeOverwriteLosses({ ...none, stats: 4 })).toBe(
			"Overwriting also deletes 4 stats. The file does not carry them, so they cannot come back."
		)
		expect(
			describeOverwriteLosses({ ...none, amendments: 1, stats: 1, places: 2, items: 1 })
		).toBe(
			"Overwriting also deletes 1 dated change and 1 stat. The file does not carry them, so they cannot come back. 2 places and 1 item come back as world lore, because this file is older than places and items."
		)
		expect(describeOverwriteLosses({ ...none, places: 1 })).toBe(
			"1 place comes back as world lore, because this file is older than places and items."
		)
	})

	test("what no file carries — a session's stats on a place, a stat sheet — is counted from any file", () => {
		const none = {
			amendments: 0,
			presences: 0,
			branches: 0,
			sceneLinks: 0,
			stats: 0,
			places: 0,
			items: 0,
			sessionStats: 0,
			sheets: 0,
			sessionLoreRefs: 0,
			charactersRewritten: 0
		}
		expect(describeOverwriteLosses({ ...none, sessionStats: 2, sheets: 1 })).toBe(
			"Overwriting also deletes 2 stats sessions set on its places and 1 stat sheet. The file does not carry them, so they cannot come back."
		)
		expect(describeOverwriteLosses({ ...none, sessionStats: 1 })).toBe(
			"Overwriting also deletes 1 stat a session set on its places. The file does not carry it, so it cannot come back."
		)
		expect(describeOverwriteLosses({ ...none, branches: 1, sheets: 3 })).toBe(
			"Overwriting also deletes 1 branch and 3 stat sheets. The file does not carry them, so they cannot come back."
		)
	})

	test("what sessions hold of the book's entries is named, since every entry is new", () => {
		const none = {
			amendments: 0,
			presences: 0,
			branches: 0,
			sceneLinks: 0,
			stats: 0,
			places: 0,
			items: 0,
			sessionStats: 0,
			sheets: 0,
			sessionLoreRefs: 0,
			charactersRewritten: 0
		}
		expect(describeOverwriteLosses({ ...none, sessionLoreRefs: 1 })).toBe(
			"A session loses 1 thing it holds from this book, such as an item carried or the place someone is in, because overwriting replaces every entry."
		)
		expect(describeOverwriteLosses({ ...none, sheets: 1, sessionLoreRefs: 3 })).toBe(
			"Overwriting also deletes 1 stat sheet. The file does not carry it, so it cannot come back. Sessions lose 3 things they hold from this book, such as an item carried or the place someone is in, because overwriting replaces every entry."
		)
	})

	test("names the user's characters the file rewrites by uuid", () => {
		const none = {
			amendments: 0,
			presences: 0,
			branches: 0,
			sceneLinks: 0,
			stats: 0,
			places: 0,
			items: 0,
			sessionStats: 0,
			sheets: 0,
			sessionLoreRefs: 0,
			charactersRewritten: 0
		}
		expect(describeOverwriteLosses({ ...none, charactersRewritten: 1 })).toBe(
			"Importing this file also rewrites 1 of your characters from the copy it carries, whichever you choose."
		)
		expect(describeOverwriteLosses({ ...none, charactersRewritten: 2 })).toBe(
			"Importing this file also rewrites 2 of your characters from the copies it carries, whichever you choose."
		)
	})
})
