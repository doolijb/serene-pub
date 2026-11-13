/**
 * The transcript preamble names the cast by what `session_cast` carries: a
 * member's own name (§0-D) is applied before the read leaves the host (the
 * card as the seat shows it), so `castNames` reads it through with no rule of its own.
 */
import { describe, expect, it } from "vitest"
import { castNames } from "./transcript"

describe("castNames over a retold cast", () => {
	it("gives the member's own name, not the card's", () => {
		const card = { id: 1, name: "Verity Hale", nickname: null }
		// The card as a seat shows it for a member whose own name is "Maren".
		const shown = { id: 1, name: "Maren", nickname: null }
		expect(castNames({ characters: [shown], personas: [] })).toEqual([
			{ name: "Maren" }
		])
		expect(castNames([card])).toEqual([{ name: "Verity Hale" }])
	})
})
