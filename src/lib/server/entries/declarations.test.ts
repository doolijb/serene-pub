/**
 * The boot assertion, and proof that it fires.
 *
 * `DEFAULT_SIGNAL_WEIGHTS` is a **total map over a closed union**. A type
 * declaring a band that map does not carry gets its candidates scored against
 * `undefined` and dropped — with a green parity suite, because no fixture holds
 * a type nothing declared, and with nothing in the receipt. That has already
 * happened once: history was absent from every prompt between spec 1.8.0 and
 * 1.10.0, and the thing that would have caught it is this.
 *
 * ⚠ **Testing the guard rather than trusting it** is the point of the file. The
 * SDK refuses an unbanded `sourceKind` at the author's line, but the SDK's list
 * and this app's weight map are two lists, and two lists drift. What is checked
 * here is that they are the same list *today*, and that the check would say so
 * if they stopped being.
 */

import { describe, it, expect } from "vitest"
import {
	assertEntryDeclarations,
	declaredFields,
	declaresPriority,
	entryDeclaration,
	entryDeclarations,
	fieldDefault,
	bandOfType
} from "./declarations"
import { DEFAULT_SIGNAL_WEIGHTS } from "$lib/server/pipelines/ranking/weights"
import { RETRIEVAL_MECHANISM_BANDS } from "$lib/server/pipelines/ranking/entitySearch"
import {
	CHARACTER_LORE_TYPE_ID,
	ENTRY_TYPE_IDS,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"

const BANDS = Object.keys(DEFAULT_SIGNAL_WEIGHTS)

describe("the declarations this build reads", () => {
	it("has all three, which is what proves the catalog's side effect ran", () => {
		expect(
			entryDeclarations()
				.map((d) => d.typeId)
				.sort()
		).toEqual([...ENTRY_TYPE_IDS].sort())
	})

	it("passes the boot assertion against the real weight map", () => {
		expect(assertEntryDeclarations(BANDS)).toEqual([])
	})

	it("refuses a band the weight map does not carry, naming what to do", () => {
		// The exact failure mode: history's band removed from the map, which
		// is what a rename or a sixth source would look like from here.
		const findings = assertEntryDeclarations(
			BANDS.filter((b) => b !== "history")
		)
		expect(findings).toHaveLength(1)
		expect(findings[0]).toContain(HISTORY_TYPE_ID)
		expect(findings[0]).toContain("scored against undefined")
	})

	it("refuses every type at once when the weight map is empty", () => {
		// Which is also the shape of "the declarations did not load" from the
		// other side: no bands, so nothing fits.
		expect(assertEntryDeclarations([])).toHaveLength(ENTRY_TYPE_IDS.length)
	})

	it("passes the retrieval mechanisms' own bands against the real weight map", () => {
		// `sourceKind` totality is a property of *candidates*, and not every
		// candidate comes from an entry type: the entity mechanism returns transcript
		// in the `messages` band, which no entry type declares because a message
		// is not an entry. One assertion covers both producers.
		expect(
			assertEntryDeclarations(BANDS, RETRIEVAL_MECHANISM_BANDS)
		).toEqual([])
	})

	it("refuses a mechanism whose band the weight map does not carry", () => {
		// The same silent failure from the other producer: candidates scored
		// against `undefined` and dropped, with a green suite and nothing in
		// the receipt.
		const findings = assertEntryDeclarations(
			BANDS.filter((b) => b !== "messages"),
			RETRIEVAL_MECHANISM_BANDS
		)
		expect(findings).toHaveLength(1)
		expect(findings[0]).toContain("core:query/entity-search@1")
		expect(findings[0]).toContain("scored against")
	})
})

describe("the questions the engine asks a type", () => {
	it("maps each type to its budget band", () => {
		expect(bandOfType(WORLD_LORE_TYPE_ID)).toBe("worldLore")
		expect(bandOfType(CHARACTER_LORE_TYPE_ID)).toBe("characterLore")
		expect(bandOfType(HISTORY_TYPE_ID)).toBe("history")
	})

	it("gives the priority bonus to the two types that declare the field role, and not to history", () => {
		// ⚠ **Absent means no bonus**, never "absent means 1 and gets the
		// bonus". History has never had a priority column; under one table the
		// missing column is a missing *field role*, and this is the whole test.
		expect(declaresPriority(WORLD_LORE_TYPE_ID)).toBe(true)
		expect(declaresPriority(CHARACTER_LORE_TYPE_ID)).toBe(true)
		expect(declaresPriority(HISTORY_TYPE_ID)).toBe(false)
	})

	it("answers the title field role for the named types and not for the dated one", () => {
		expect(entryDeclaration(WORLD_LORE_TYPE_ID)?.roles.title).toBe("title")
		expect(entryDeclaration(HISTORY_TYPE_ID)?.roles.title).toBeUndefined()
		// A history entry is not named, it is *dated* — its heading is the
		// order key, which is what `order` carries.
		expect(entryDeclaration(HISTORY_TYPE_ID)?.roles.order).toEqual([
			{ field: "year", dir: "desc", nulls: "last" },
			{ field: "month", dir: "desc", nulls: "last" },
			{ field: "day", dir: "desc", nulls: "last" }
		])
	})

	it("names the anchor column and its policy for character lore alone", () => {
		expect(entryDeclaration(CHARACTER_LORE_TYPE_ID)?.roles.anchor).toEqual({
			column: "anchorBindingId",
			policy: "core:policy/binding-visibility@1"
		})
		// World lore is about the world, so there is nobody it could be
		// private from. The absence is the declaration doing its job.
		expect(
			entryDeclaration(WORLD_LORE_TYPE_ID)?.roles.anchor
		).toBeUndefined()
	})

	it("carries each field's declared default, which is what an absent key reads as", () => {
		expect(fieldDefault(WORLD_LORE_TYPE_ID, "priority")).toBe(1)
		expect(fieldDefault(HISTORY_TYPE_ID, "year")).toBe(1)
		expect(fieldDefault(HISTORY_TYPE_ID, "graphed")).toBe(false)
		// Declared with no default reads the same as absent: `null`.
		expect(fieldDefault(WORLD_LORE_TYPE_ID, "category")).toBeNull()
		expect(fieldDefault(HISTORY_TYPE_ID, "month")).toBeNull()
	})

	it("lists the declared fields in declaration order, which the wire depends on", () => {
		expect(declaredFields(WORLD_LORE_TYPE_ID)).toEqual([
			"category",
			"priority"
		])
		expect(declaredFields(HISTORY_TYPE_ID)).toEqual([
			"year",
			"month",
			"day",
			"isCompleted",
			"graphed"
		])
	})
})
