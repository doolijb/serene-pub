/**
 * The `/` palette's logic (R-15 slash names, F38; U5c). No component test
 * pattern exists in this repo (the suite runs in a node environment with no
 * `@testing-library/svelte`), so the palette's behaviour is pinned here on
 * the pure half and the markup is driven by hand — see docs/sessions.md
 * "Slash commands".
 */
import { describe, expect, it } from "vitest"
import { CORE_ACTIONS, CORE_VERB_REASONS, partitionEnabledWhen } from "@serene-pub/sdk"
import { itemValuesOf } from "$lib/shared/actions/itemValues"
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
	specSlug: "core:spec/narrate",
	name: "Narrate",
	slash: "narrate",
	audience: { act: ["owner"] },
	canAct: true,
	isNew: false,
	venue: "composer",
	...over
})

const ACTIONS: PaletteAction[] = [
	action({}),
	action({
		key: "narrate-character",
		specSlug: "core:spec/narrate-character",
		name: "Side character",
		slash: "narrate-character"
	}),
	action({
		key: "generate-image",
		specSlug: "core:spec/generate-image",
		name: "Image",
		slash: "generate-image"
	}),
	action({
		key: "roll",
		specSlug: "acme:spec/roll",
		name: "Roll the dice",
		slash: "acme.roll",
		isNew: true
	}),
	action({
		key: "continue",
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
 * One row per slash name (plans/31 V2: one slash name means one action, so
 * two declarations under one name never reach a session — the dedupe folds
 * one declaration's several venues, and holds core's verb to its name).
 */
describe("one row per slash name", () => {
	it("one declaration listed under two venues is one row, in its first place", () => {
		const twice = [...ACTIONS, action({ venue: "extra" })]
		const rows = dedupePaletteActions(twice)
		expect(rows.map((a) => a.slash)).toEqual([
			"narrate",
			"narrate-character",
			"generate-image",
			"acme.roll",
			"continue"
		])
		expect(rows[0]).toMatchObject({ specSlug: "core:spec/narrate", venue: "composer" })
		expect(exactPaletteMatch(twice, "/narrate")).toMatchObject({ specSlug: "core:spec/narrate" })
	})

	it("a core verb holds its name (S1): the verb's row, whichever side of it a stale alternative was listed", () => {
		const alternative = action({
			key: "continue",
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
		}
	})
})

describe("a row's state", () => {
	/** The audience half every row carries off the list: the name and who may act. */
	const roll = { name: "Roll", audience: { act: ["owner"] } }
	/** The audience's sentence — `core:verdict/audience`'s own, quoted (01 §13). */
	const notYours = "'Roll' is not yours to use here — its audience is owner."

	it("is greyed by the audience first, then while a reply streams — like the chips and the More menu (S5)", () => {
		expect(paletteRowState({ ...roll, canAct: true }, { generating: false })).toEqual({ disabled: false })
		expect(paletteRowState({ ...roll, canAct: false }, { generating: false })).toEqual({
			disabled: true,
			reason: notYours
		})
		expect(paletteRowState({ ...roll, canAct: true }, { generating: true })).toEqual({
			disabled: true,
			reason: "wait for the reply to finish"
		})
		// The audience's sentence wins: a greyed chip does not change its
		// reason because something else is busy.
		expect(paletteRowState({ ...roll, canAct: false }, { generating: true }).reason).toBe(notYours)
	})

	it("reads the declared enabled-when verdict between the two, with its reason (U5e)", () => {
		const grey = { ...roll, canAct: true, enabled: false, reason: "Set a location first" }
		expect(paletteRowState(grey, { generating: false })).toEqual({
			disabled: true,
			reason: "Set a location first"
		})
		// The audience's word still first; the declared reason over the busy rule.
		expect(paletteRowState({ ...grey, canAct: false }, { generating: false }).reason).toBe(notYours)
		expect(paletteRowState(grey, { generating: true }).reason).toBe("Set a location first")
		// An older server sends no verdict: enabled.
		expect(paletteRowState({ ...roll, canAct: true, enabled: undefined }, { generating: false })).toEqual({
			disabled: false
		})
		// A verdict with no sentence still greys — the row says nothing rather than lying.
		expect(paletteRowState({ ...roll, canAct: true, enabled: false }, { generating: false })).toEqual({
			disabled: true
		})
	})

	it("judges an extra row's item.* predicates against the newest row, and a session with no row fails them with the newest reason (U5e live walk)", () => {
		const retry = CORE_ACTIONS.find((a) => a.key === "retry")!
		const itemPredicates = partitionEnabledWhen(retry.enabledWhen!, "item").under
		// Regenerate / `/retry`: core's `retry` at the extra venue, acting on the newest row.
		const row = { name: "Regenerate", audience: { act: ["item"] }, canAct: true, enabled: true, itemPredicates, venue: "extra" }
		// No row at all: `/retry` is grey exactly as the Regenerate chip is.
		expect(paletteRowState(row, { generating: false, newest: null })).toEqual({
			disabled: true,
			reason: CORE_VERB_REASONS.notNewest.en
		})
		// A newest reply the road can redo: open.
		const reply = itemValuesOf({ id: 9, role: "assistant" }, { isNewest: true, mine: true })
		expect(paletteRowState(row, { generating: false, newest: reply })).toEqual({ disabled: false })
		// …a hidden one, or a greeting: grey with that predicate's reason.
		expect(
			paletteRowState(row, {
				generating: false,
				newest: itemValuesOf({ id: 9, isHidden: true }, { isNewest: true, mine: true })
			}).reason
		).toBe(CORE_VERB_REASONS.hidden.en)
		expect(
			paletteRowState(row, {
				generating: false,
				newest: itemValuesOf({ id: 9, metadata: { isGreeting: true } }, { isNewest: true, mine: true })
			}).reason
		).toBe(CORE_VERB_REASONS.greeting.en)
		// A surface offering no row leaves them unjudged; a row with none is untouched.
		expect(paletteRowState(row, { generating: false })).toEqual({ disabled: false })
		expect(paletteRowState({ ...roll, canAct: true, enabled: true }, { generating: false, newest: null })).toEqual({
			disabled: false
		})
		// The audience and the list's own verdict still come first; the busy rule after.
		expect(paletteRowState({ ...row, canAct: false }, { generating: false, newest: null }).reason).toBe(
			"'Regenerate' is not yours to use here — its audience is item."
		)
		expect(paletteRowState(row, { generating: true, newest: reply }).reason).toBe(
			"wait for the reply to finish"
		)
	})

	it("a composer row's press names no row, so its item.* predicates are judged against none — as the door judges them (W4)", () => {
		const onlyMine = [{ on: "item.mine", truthy: true, reason: { en: "only on your own line" } }]
		const newest = itemValuesOf({ id: 9, role: "assistant" }, { isNewest: true, mine: true })
		// A message action listed in the composer too: grey there whatever the newest row says.
		expect(
			paletteRowState(
				{ ...roll, canAct: true, enabled: true, itemPredicates: onlyMine, venue: "composer" },
				{ generating: false, newest }
			)
		).toEqual({ disabled: true, reason: "only on your own line" })
		// A row with no venue named reads as the composer's.
		expect(
			paletteRowState({ ...roll, canAct: true, enabled: true, itemPredicates: onlyMine }, { generating: false, newest })
				.disabled
		).toBe(true)
		// The same predicates at the extra venue act on the newest row.
		expect(
			paletteRowState(
				{ ...roll, canAct: true, enabled: true, itemPredicates: onlyMine, venue: "extra" },
				{ generating: false, newest }
			)
		).toEqual({ disabled: false })
	})

	it("the turn controls' chips read the same verdict: Regenerate is grey while generating, hidden, or with nothing to redo (pass 3)", () => {
		// What the page's `extraChip` hands over: the listed `retry` at the
		// extra venue, the reason resolved, the newest row beside it.
		const retry = CORE_ACTIONS.find((a) => a.key === "retry")!
		const listed = (enabled: boolean, reason?: string) => ({
			...roll,
			canAct: true,
			enabled,
			venue: "extra",
			...(reason ? { reason } : {}),
			itemPredicates: partitionEnabledWhen(retry.enabledWhen!, "item").under
		})
		const newest = itemValuesOf({ id: 3, role: "assistant" }, { isNewest: true, mine: true })
		// The start push: the server said no.
		expect(
			paletteRowState(listed(false, CORE_VERB_REASONS.generating.en), { generating: false, newest })
		).toEqual({ disabled: true, reason: CORE_VERB_REASONS.generating.en })
		// The end push, a reply to redo: open.
		expect(paletteRowState(listed(true), { generating: false, newest })).toEqual({ disabled: false })
		// …a hidden newest row, or none: grey with the row's reason.
		expect(
			paletteRowState(listed(true), {
				generating: false,
				newest: itemValuesOf({ id: 3, isHidden: true }, { isNewest: true, mine: true })
			}).reason
		).toBe(CORE_VERB_REASONS.hidden.en)
		expect(paletteRowState(listed(true), { generating: false, newest: null }).reason).toBe(
			CORE_VERB_REASONS.notNewest.en
		)
		// The client's own busy flag still holds between pushes.
		expect(paletteRowState(listed(true), { generating: true, newest }).reason).toBe(
			CORE_VERB_REASONS.generating.en
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
