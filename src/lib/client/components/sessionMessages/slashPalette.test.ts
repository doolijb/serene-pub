/**
 * The `/` palette's logic (R-15 slash names, F38; U5c). No component test
 * pattern exists in this repo (the suite runs in a node environment with no
 * `@testing-library/svelte`), so the palette's behaviour is pinned here on
 * the pure half and the markup is driven by hand — see docs/sessions.md
 * "Slash commands".
 */
import { describe, expect, it } from "vitest"
import {
	dedupePaletteActions,
	exactPaletteMatch,
	filterPaletteActions,
	paletteRowState,
	slashQueryOf,
	stepHighlight,
	type PaletteAction
} from "./slashPalette"

const action = (over: Partial<PaletteAction>): PaletteAction => ({
	key: "narrate",
	function: "narrate",
	specSlug: "core:spec/narrate",
	name: "Narrate",
	slash: "narrate",
	canAct: true,
	isNew: false,
	venue: "composer",
	...over
})

const ACTIONS: PaletteAction[] = [
	action({}),
	action({
		key: "narrate-character",
		function: "narrate-character",
		specSlug: "core:spec/narrate-character",
		name: "Side character",
		slash: "narrate-character"
	}),
	action({
		key: "generate-image",
		function: "generate-image",
		specSlug: "core:spec/generate-image",
		name: "Image",
		slash: "generate-image"
	}),
	action({
		key: "roll",
		function: "roll",
		specSlug: "acme:spec/roll",
		name: "Roll the dice",
		slash: "acme.roll",
		isNew: true
	}),
	action({
		key: "continue",
		function: "continue",
		specSlug: "core",
		name: "Continue",
		slash: "continue",
		venue: "extra"
	})
]

describe("the draft as a slash query", () => {
	it("opens on a leading slash with no whitespace, and on nothing else", () => {
		expect(slashQueryOf("/")).toBe("")
		expect(slashQueryOf("/nar")).toBe("nar")
		expect(slashQueryOf("/acme.roll")).toBe("acme.roll")
		expect(slashQueryOf("")).toBeNull()
		expect(slashQueryOf("hello /narrate")).toBeNull()
		expect(slashQueryOf("/narrate now")).toBeNull()
		expect(slashQueryOf("/nar\n")).toBeNull()
	})
})

describe("filtering", () => {
	it("lists everything for a bare slash, one row per slash name", () => {
		const twice = [...ACTIONS, action({ specSlug: "core:spec/narrate-b" })]
		expect(filterPaletteActions(twice, "").map((a) => a.slash)).toEqual([
			"narrate",
			"narrate-character",
			"generate-image",
			"acme.roll",
			"continue"
		])
	})

	it("matches slash-name prefixes first, then labels — case-insensitively", () => {
		expect(filterPaletteActions(ACTIONS, "nar").map((a) => a.slash)).toEqual([
			"narrate",
			"narrate-character"
		])
		// `Image` by label; `generate-image` by the name containing `image`.
		expect(filterPaletteActions(ACTIONS, "IMA").map((a) => a.slash)).toEqual([
			"generate-image"
		])
		// A plugin's namespaced name is reachable by either half.
		expect(filterPaletteActions(ACTIONS, "roll").map((a) => a.slash)).toEqual([
			"acme.roll"
		])
		expect(filterPaletteActions(ACTIONS, "acme").map((a) => a.slash)).toEqual([
			"acme.roll"
		])
		expect(filterPaletteActions(ACTIONS, "zzz")).toEqual([])
	})
})

describe("Enter on an exact name", () => {
	it("names the action whether or not the palette is open", () => {
		expect(exactPaletteMatch(ACTIONS, "/narrate")?.key).toBe("narrate")
		expect(exactPaletteMatch(ACTIONS, "/NARRATE")?.key).toBe("narrate")
		expect(exactPaletteMatch(ACTIONS, "/acme.roll")?.key).toBe("roll")
		expect(exactPaletteMatch(ACTIONS, "/nar")).toBeUndefined()
		expect(exactPaletteMatch(ACTIONS, "narrate")).toBeUndefined()
	})

	it("with no highlight, Enter runs the first filtered row — the documented rule (S5)", () => {
		// The component's Enter reads: the highlighted row, else the exact
		// match, else the first row of a narrowed list. Pinned here on the
		// pure half: `/gen` narrows to one row, and that row is the pick.
		const rows = filterPaletteActions(ACTIONS, "gen")
		expect(rows.map((a) => a.slash)).toEqual(["generate-image"])
		expect(exactPaletteMatch(ACTIONS, "/gen")).toBeUndefined()
		expect(rows[0]?.key).toBe("generate-image")
	})
})

/**
 * W-D (U5c review, second pass): a slash name two specs offer for one
 * function is ONE row that stands for the name, marked `shared`, and the
 * page fires it legacy-shaped — naming no declaration — so the server's
 * binding layer selects the spec. Firing the first declaration's identity
 * ran that spec and skipped every binding.
 */
describe("a shared slash name", () => {
	const twoSpecs = [
		...ACTIONS,
		action({ specSlug: "core:spec/narrate-b", name: "Narrate (b)" })
	]

	it("is one row, marked shared, in the first declaration's place; a lone name is unmarked", () => {
		const rows = dedupePaletteActions(twoSpecs)
		expect(rows.map((a) => a.slash)).toEqual([
			"narrate",
			"narrate-character",
			"generate-image",
			"acme.roll",
			"continue"
		])
		expect(rows[0]).toMatchObject({ specSlug: "core:spec/narrate", shared: true })
		expect(rows.slice(1).every((a) => a.shared === undefined)).toBe(true)
	})

	it("reaches the page through filtering and the exact match alike", () => {
		expect(filterPaletteActions(twoSpecs, "narr")[0]?.shared).toBe(true)
		expect(exactPaletteMatch(twoSpecs, "/narrate")?.shared).toBe(true)
		// The lone name stays a declaration.
		expect(exactPaletteMatch(twoSpecs, "/acme.roll")?.shared).toBeUndefined()
	})

	it("one declaration listed under two venues is one action, not a shared name", () => {
		const twice = [...ACTIONS, action({ venue: "extra" })]
		expect(dedupePaletteActions(twice)[0]?.shared).toBeUndefined()
	})

	it("a core verb holds its name (S1): the verb's row, never shared, whichever side it was listed on", () => {
		const alternative = action({
			key: "continue",
			function: "continue",
			specSlug: "core:spec/keep-going",
			name: "Keep going",
			slash: "continue"
		})
		for (const list of [
			[...ACTIONS, alternative],
			[alternative, ...ACTIONS]
		]) {
			const row = dedupePaletteActions(list).find((a) => a.slash === "continue")
			expect(row).toMatchObject({ specSlug: "core", key: "continue" })
			expect(row?.shared).toBeUndefined()
		}
	})
})

describe("a row's state", () => {
	it("is greyed by the audience first, then while a reply streams — like the chips and the More menu (S5)", () => {
		expect(paletteRowState({ canAct: true }, { generating: false })).toEqual({ disabled: false })
		expect(paletteRowState({ canAct: false }, { generating: false })).toEqual({
			disabled: true,
			reason: "not yours to use here"
		})
		expect(paletteRowState({ canAct: true }, { generating: true })).toEqual({
			disabled: true,
			reason: "wait for the reply to finish"
		})
		// The audience's sentence wins: a greyed chip does not change its
		// reason because something else is busy.
		expect(paletteRowState({ canAct: false }, { generating: true }).reason).toBe(
			"not yours to use here"
		)
	})
})

describe("the highlight", () => {
	it("steps and wraps, and starts at either end", () => {
		expect(stepHighlight(-1, 3, 1)).toBe(0)
		expect(stepHighlight(-1, 3, -1)).toBe(2)
		expect(stepHighlight(2, 3, 1)).toBe(0)
		expect(stepHighlight(0, 3, -1)).toBe(2)
		expect(stepHighlight(0, 0, 1)).toBe(-1)
	})
})
