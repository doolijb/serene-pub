/**
 * The start-a-session flow's pure decisions: the payload every caller sends,
 * the newest-version-per-genre pick, the participant floors, and the
 * pristine-only preset pre-fill.
 */
import { describe, expect, it } from "vitest"
import {
	applyPresetFill,
	autoSessionName,
	buildCreatePayload,
	defaultGenreId,
	enabledPresetsFor,
	genreFacts,
	genreVersion,
	latestGenres,
	lorebookSatisfied,
	oneClickStart,
	participantFloors,
	reconcileToShape,
	STANDARD_GENRE_ID,
	StartSessionFlow,
	type GenreRow,
	type PresetRow
} from "./createSession.svelte"
import { INITIAL_PRESET_FILLABLE_FIELDS } from "./applyPresetDefaults"

function genre(genreId: string, over: Partial<GenreRow> = {}): GenreRow {
	return {
		genreId,
		name: genreId,
		description: "",
		shape: {},
		...over
	} as GenreRow
}

function preset(over: Partial<PresetRow> & { id: number }): PresetRow {
	return {
		name: `preset ${over.id}`,
		description: null,
		genreId: STANDARD_GENRE_ID,
		bindings: {},
		primarySlug: null,
		configSelections: {},
		includedActions: null,
		defaults: null,
		enabled: true,
		isDefault: false,
		isImmutable: false,
		...over
	} as PresetRow
}

describe("buildCreatePayload", () => {
	it("sends the exact sessions:create shape the server reads", () => {
		const params = buildCreatePayload({
			name: "  Night market  ",
			genreId: "core:genre/adventure@2",
			presetId: 7,
			characterIds: [4, 9],
			personaIds: [2],
			scenario: "  A stall of lanterns.  ",
			tags: ["noir"],
			genreFields: { trustNarrator: true },
			swaps: [{ spec: "core:spec/chat-turn-order", node: "strategy", definition: "core:task/turn-manual@1" }],
			lorebookId: 3
		})

		expect(params).toEqual({
			session: {
				name: "Night market",
				scenario: "A stall of lanterns.",
				swaps: [{ spec: "core:spec/chat-turn-order", node: "strategy", definition: "core:task/turn-manual@1" }],
				lorebookId: 3,
				genreId: "core:genre/adventure@2",
				presetId: 7,
				genreFields: { trustNarrator: true }
			},
			characterIds: [4, 9],
			personaIds: [2],
			characterPositions: { 4: 0, 9: 1 },
			tags: ["noir"]
		})
	})

	it("derives characterPositions from the order of the cast", () => {
		const { characterPositions } = buildCreatePayload({
			name: "x",
			genreId: STANDARD_GENRE_ID,
			presetId: null,
			characterIds: [12, 3, 8],
			personaIds: []
		})
		expect(characterPositions).toEqual({ 12: 0, 3: 1, 8: 2 })
	})

	it("fills the optional halves with the blank-form values", () => {
		const params = buildCreatePayload({
			name: "Solo",
			genreId: STANDARD_GENRE_ID,
			presetId: null,
			characterIds: [1],
			personaIds: [2]
		})
		expect(params.session).toMatchObject({
			scenario: "",
			lorebookId: null,
			presetId: null,
			genreFields: {}
		})
		expect(params.tags).toEqual([])
	})

	it("copies the id arrays rather than aliasing the caller's", () => {
		const characterIds = [1, 2]
		const params = buildCreatePayload({
			name: "x",
			genreId: STANDARD_GENRE_ID,
			presetId: 1,
			characterIds,
			personaIds: []
		})
		characterIds.push(3)
		expect(params.characterIds).toEqual([1, 2])
	})
})

describe("latestGenres", () => {
	it("offers each genre once, at its newest version", () => {
		const rows = [
			genre("core:genre/chat"),
			genre("core:genre/adventure@1"),
			genre("core:genre/adventure@3"),
			genre("core:genre/adventure@2")
		]
		expect(latestGenres(rows).map((g) => g.genreId)).toEqual([
			"core:genre/chat",
			"core:genre/adventure@3"
		])
	})

	it("reads a version-less id as version 1", () => {
		expect(genreVersion("core:genre/chat")).toEqual({
			bare: "core:genre/chat",
			version: 1
		})
		expect(genreVersion("core:genre/chat@4")).toEqual({
			bare: "core:genre/chat",
			version: 4
		})
	})

	it("keeps the registration order of the genres it keeps", () => {
		const rows = [genre("b:g/two@2"), genre("a:g/one"), genre("b:g/two@5")]
		expect(latestGenres(rows).map((g) => g.genreId)).toEqual([
			"b:g/two@5",
			"a:g/one"
		])
	})
})

describe("enabledPresetsFor / defaultGenreId", () => {
	it("keeps only the enabled presets of the chosen genre", () => {
		const presets = [
			preset({ id: 1 }),
			preset({ id: 2, enabled: false }),
			preset({ id: 3, genreId: "core:genre/adventure" })
		]
		expect(
			enabledPresetsFor(presets, STANDARD_GENRE_ID).map((p) => p.id)
		).toEqual([1])
	})

	it("has nothing to offer before a genre is chosen", () => {
		expect(enabledPresetsFor([preset({ id: 1 })], null)).toEqual([])
	})

	it("opens on the genre whose default preset is starred", () => {
		const genres = [genre("a:g/one"), genre("b:g/two")]
		const presets = [
			preset({ id: 1, genreId: "a:g/one" }),
			preset({ id: 2, genreId: "b:g/two", isDefault: true })
		]
		expect(defaultGenreId(genres, presets)).toBe("b:g/two")
	})

	it("opens on the first genre when nothing is starred", () => {
		const genres = [genre("a:g/one"), genre("b:g/two")]
		expect(defaultGenreId(genres, [preset({ id: 1 })])).toBe("a:g/one")
	})

	it("answers null when no genre is registered", () => {
		expect(defaultGenreId([], [])).toBeNull()
	})
})

describe("participantFloors", () => {
	it("keeps the standard genre at one character and one persona", () => {
		expect(
			participantFloors(
				{ characters: { min: 0 }, personas: { min: 0 } },
				STANDARD_GENRE_ID
			)
		).toEqual({ characters: 1, personas: 1 })
	})

	it("reads another genre's floor from its own shape", () => {
		expect(
			participantFloors(
				{ characters: { min: 2, max: 4 }, personas: { min: 0 } },
				"core:genre/adventure"
			)
		).toEqual({ characters: 2, personas: 0 })
	})

	it("floors a capability the shape omits at zero", () => {
		expect(participantFloors({}, "core:genre/solo")).toEqual({
			characters: 0,
			personas: 0
		})
	})

	it("falls back to the standard floor when the shape is unknown", () => {
		expect(participantFloors(null, "plugin:genre/mystery")).toEqual({
			characters: 1,
			personas: 1
		})
	})
})

describe("lorebookSatisfied", () => {
	it("holds a genre that requires a lorebook to having one", () => {
		expect(lorebookSatisfied({ lorebook: "required" }, null)).toBe(false)
		expect(lorebookSatisfied({ lorebook: "required" }, undefined)).toBe(
			false
		)
		expect(lorebookSatisfied({ lorebook: "required" }, 3)).toBe(true)
	})

	it("lets an optional or absent capability start without one", () => {
		expect(lorebookSatisfied({ lorebook: "optional" }, null)).toBe(true)
		expect(lorebookSatisfied({}, null)).toBe(true)
		expect(lorebookSatisfied(null, null)).toBe(true)
	})
})

/**
 * A one-click start — the wizard's character card — creates directly only
 * when the genre it would start on asks nothing the card cannot answer. An
 * administrator-starred Adventure preset made every card's Start a refusal
 * (2026-09-17): its genre requires a lorebook, and the card knows none.
 */
describe("oneClickStart", () => {
	const ADVENTURE = "core:genre/adventure"
	const genres = [
		genre(STANDARD_GENRE_ID, {
			shape: { characters: { min: 0 }, lorebook: "optional" }
		}),
		genre(ADVENTURE, {
			shape: { characters: { min: 1 }, lorebook: "required" }
		})
	]

	it("creates directly on a genre that needs no lorebook", () => {
		expect(
			oneClickStart(genres, [preset({ id: 1, isDefault: true })])
		).toEqual({ genreId: STANDARD_GENRE_ID, presetId: 1, direct: true })
	})

	it("hands a lorebook-requiring genre to the start screen, genre and preset named", () => {
		expect(
			oneClickStart(genres, [
				preset({ id: 1 }),
				preset({ id: 2, genreId: ADVENTURE, isDefault: true })
			])
		).toEqual({ genreId: ADVENTURE, presetId: 2, direct: false })
	})

	it("falls back to the standard genre, preset-less, when nothing is registered", () => {
		expect(oneClickStart([], [])).toEqual({
			genreId: STANDARD_GENRE_ID,
			presetId: null,
			direct: true
		})
	})
})

/**
 * The flow's own gate, driven the way the start screen drives it: the
 * lists land, a genre is chosen, and `canStart` answers. Adventure declares
 * `lorebook: "required"` (core-catalog `genres.ts`); the start screen once
 * offered Start with no lorebook picker at all, and the server refused the
 * create in a sentence the client swallowed (2026-09-17).
 */
describe("StartSessionFlow.canStart", () => {
	const ADVENTURE = "core:genre/adventure"
	function flowOn(genreId: string, shape: GenreRow["shape"]) {
		const flow = new StartSessionFlow()
		flow.rawGenres = [genre(genreId, { shape })]
		flow.rawPresets = [preset({ id: 1, genreId })]
		flow.presetsLoaded = true
		flow.chooseGenre(genreId)
		flow.choosePreset(1)
		flow.characterIds = [4]
		flow.personaIds = [2]
		return flow
	}

	it("refuses to start a required-lorebook genre until one is chosen", () => {
		const flow = flowOn(ADVENTURE, {
			characters: { min: 1 },
			personas: { min: 1 },
			lorebook: "required"
		})
		expect(flow.fields.lorebookId).toBeNull()
		expect(flow.canStart).toBe(false)
		flow.fields.lorebookId = 7
		expect(flow.canStart).toBe(true)
		expect(flow.payload("x").session.lorebookId).toBe(7)
	})

	it("starts an optional-lorebook genre without one", () => {
		const flow = flowOn("core:genre/mystery", {
			characters: { min: 1 },
			personas: { min: 1 },
			lorebook: "optional"
		})
		expect(flow.canStart).toBe(true)
		expect(flow.payload("x").session.lorebookId).toBeNull()
	})

	it("detaches a held lorebook when the chosen genre has no such capability", () => {
		const flow = flowOn(ADVENTURE, {
			characters: { min: 1 },
			personas: { min: 1 },
			lorebook: "required"
		})
		flow.fields.lorebookId = 7
		flow.rawGenres = [
			...flow.rawGenres,
			genre("core:genre/solo", { shape: { personas: { min: 1 } } })
		]
		flow.chooseGenre("core:genre/solo")
		expect(flow.fields.lorebookId).toBeNull()
	})
})

describe("applyPresetFill", () => {
	it("fills a pristine field from the preset's creation defaults", () => {
		const result = applyPresetFill(
			{ ...INITIAL_PRESET_FILLABLE_FIELDS },
			{},
			preset({ id: 1, defaults: { scenario: "A quiet inn." } })
		)
		expect(result.fields.scenario).toBe("A quiet inn.")
		expect(result.fillState.scenario).toBe("A quiet inn.")
	})

	it("never overwrites what the person starting the session typed", () => {
		const typed = {
			...INITIAL_PRESET_FILLABLE_FIELDS,
			scenario: "My own opening."
		}
		const result = applyPresetFill(
			typed,
			{},
			preset({ id: 2, defaults: { scenario: "A quiet inn." } })
		)
		expect(result.fields.scenario).toBe("My own opening.")
		expect(result.fillState.scenario).toBeUndefined()
	})

	it("replaces what the last preset left when a second one is chosen", () => {
		const first = applyPresetFill(
			{ ...INITIAL_PRESET_FILLABLE_FIELDS },
			{},
			preset({ id: 1, defaults: { scenario: "A quiet inn." } })
		)
		const second = applyPresetFill(
			first.fields,
			first.fillState,
			preset({ id: 2, defaults: { scenario: "A loud dock." } })
		)
		expect(second.fields.scenario).toBe("A loud dock.")
	})

	it("leaves everything alone for a preset that declares no defaults", () => {
		const result = applyPresetFill(
			{ ...INITIAL_PRESET_FILLABLE_FIELDS },
			{},
			preset({ id: 1 })
		)
		expect(result.fields).toEqual(INITIAL_PRESET_FILLABLE_FIELDS)
	})
})

describe("reconcileToShape", () => {
	it("trims fields, cast and lorebook to what the genre declares", () => {
		expect(
			reconcileToShape(
				{
					characters: { min: 1, max: 1 },
					personas: { min: 1 },
					fields: { trustNarrator: {} }
				},
				{
					genreFields: { trustNarrator: true, stray: 1 },
					characterIds: [1, 2, 3],
					personaIds: [7],
					lorebookId: 4
				}
			)
		).toEqual({
			genreFields: { trustNarrator: true },
			characterIds: [1],
			personaIds: [7],
			lorebookId: null
		})
	})

	it("drops the cast of a capability the shape omits", () => {
		expect(
			reconcileToShape(
				{ personas: { min: 1 }, lorebook: "optional" },
				{
					genreFields: {},
					characterIds: [1, 2],
					personaIds: [5],
					lorebookId: 9
				}
			)
		).toEqual({
			genreFields: {},
			characterIds: [],
			personaIds: [5],
			lorebookId: 9
		})
	})

	it("returns an unknown genre's selection untouched", () => {
		const held = {
			genreFields: { anything: 1 },
			characterIds: [1, 2],
			personaIds: [3],
			lorebookId: 8
		}
		expect(reconcileToShape(null, held)).toBe(held)
	})
})

describe("autoSessionName", () => {
	it("names a one-character session after its character", () => {
		expect(autoSessionName(["Wren"], ["Sable"])).toBe("Session with Wren")
	})

	it("names a group after everyone in it", () => {
		expect(autoSessionName(["Wren", "Brother Alder"], ["Sable"])).toBe(
			"Wren, Brother Alder and Sable"
		)
	})

	it("falls back when there is no cast yet", () => {
		expect(autoSessionName([], [])).toBe("New session")
	})
})

describe("genreFacts", () => {
	it("says what the genre's shape allows", () => {
		expect(
			genreFacts({
				characters: { min: 1, max: 4 },
				personas: { min: 1 },
				lorebook: "optional",
				voice: "narrator"
			})
		).toBe(
			"characters 1–4 · personas 1+ · lorebook optional · narrator voice"
		)
	})

	it("says what it forbids", () => {
		expect(
			genreFacts({ characters: { min: 0, max: 0 }, composer: "none" })
		).toBe("no characters · no personas · no composer")
	})

	it("says nothing for an unknown shape", () => {
		expect(genreFacts(null)).toBe("")
	})
})
