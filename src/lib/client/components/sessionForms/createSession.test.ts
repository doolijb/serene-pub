/**
 * The start-a-session flow's pure decisions: the payload every caller sends,
 * the newest-version-per-genre pick, the participant floors, and the
 * pristine-only preset pre-fill.
 */
import { describe, expect, it } from "vitest"
import {
	preselectsDefaultPersona,
	addToCast,
	applyPresetFill,
	autoSessionName,
	buildCreatePayload,
	castCountHint,
	castOptions,
	defaultGenreId,
	enabledPresetsFor,
	filterPickRows,
	finalSessionName,
	firstUnmetStartRule,
	genreFacts,
	genreVersion,
	genreVersionLabel,
	latestGenres,
	moveInCast,
	oneClickStart,
	participantFloors,
	playAsOptions,
	reconcileToShape,
	STANDARD_GENRE_ID,
	StartSessionFlow,
	WELCOME_SESSION_NAME,
	welcomeSessionInput,
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
			genreId: "core:genre/story@2",
			presetId: 7,
			characterIds: [4, 9],
			personaIds: [2],
			scenario: "  A stall of lanterns.  ",
			tags: ["noir"],
			genreFields: { showDice: true },
			swaps: [{ spec: "core:spec/story-turn-order", node: "strategy", definition: "core:task/turn-manual@1" }],
			lorebookId: 3
		})

		expect(params).toEqual({
			session: {
				name: "Night market",
				scenario: "A stall of lanterns.",
				swaps: [{ spec: "core:spec/story-turn-order", node: "strategy", definition: "core:task/turn-manual@1" }],
				lorebookId: 3,
				genreId: "core:genre/story@2",
				presetId: 7,
				genreFields: { showDice: true }
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
			genre("core:genre/story@1"),
			genre("core:genre/story@3"),
			genre("core:genre/story@2")
		]
		expect(latestGenres(rows).map((g) => g.genreId)).toEqual([
			"core:genre/chat",
			"core:genre/story@3"
		])
	})

	it("says a genre's version in words, from the id's @N", () => {
		expect(genreVersionLabel("core:genre/chat@2")).toBe("version 2")
		expect(genreVersionLabel("core:genre/story")).toBe("version 1")
	})

	it("reads a version-less id as version 1", () => {
		expect(genreVersion("core:genre/story")).toEqual({
			bare: "core:genre/story",
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
			preset({ id: 3, genreId: "core:genre/lair" })
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
	it("reads the standard genre's floor from its shape too (2026-10-19: Story may start with nobody)", () => {
		expect(
			participantFloors(
				{ characters: { min: 0 }, personas: { min: 0 } },
				STANDARD_GENRE_ID
			)
		).toEqual({ characters: 0, personas: 0 })
	})

	it("reads another genre's floor from its own shape", () => {
		expect(
			participantFloors(
				{ characters: { min: 2, max: 4 }, personas: { min: 0 } },
				"core:genre/story"
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


/**
 * A one-click start — the wizard's character card — creates directly. An
 * administrator-starred Adventure preset once made every card's Start a
 * refusal (2026-09-17): its genre required a lorebook, and the card knew
 * none. ⏳ Since RF fix 2 (2026-10-23) no genre requires one — a session
 * always has its own book — so a one-click start is always direct.
 */
describe("oneClickStart", () => {
	const LAIR = "core:genre/lair" // the genre that once required a lorebook (was Adventure, retired 2026-10-19)
	const genres = [
		genre(STANDARD_GENRE_ID, {
			shape: { characters: { min: 0 }, lorebook: "optional" }
		}),
		genre(LAIR, {
			shape: { characters: { min: 1 }, lorebook: "optional" }
		})
	]

	it("creates directly on a genre that needs no lorebook", () => {
		expect(
			oneClickStart(genres, [preset({ id: 1, isDefault: true })])
		).toEqual({ genreId: STANDARD_GENRE_ID, presetId: 1, direct: true })
	})

	it("starts the Lair directly too: no genre requires a lorebook (RF fix 2)", () => {
		expect(
			oneClickStart(genres, [
				preset({ id: 1 }),
				preset({ id: 2, genreId: LAIR, isDefault: true })
			])
		).toEqual({ genreId: LAIR, presetId: 2, direct: true })
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
 * lists land, a genre is chosen, and `canStart` answers. ⏳ A genre that
 * still says `lorebook: "required"` (retired RF fix 2, 2026-10-23) reads as
 * optional: a session may always start without a book — its own (the
 * own book) is its world.
 */
describe("StartSessionFlow.canStart", () => {
	const LAIR = "core:genre/lair" // the genre that once required a lorebook (was Adventure, retired 2026-10-19)
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

	it("starts a genre that still says 'required' without a lorebook, and sends a chosen one (RF fix 2)", () => {
		const flow = flowOn(LAIR, {
			characters: { min: 1 },
			personas: { min: 1 },
			lorebook: "required"
		})
		expect(flow.fields.lorebookId).toBeNull()
		expect(flow.canStart).toBe(true)
		expect(flow.payload("x").session.lorebookId).toBeNull()
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

	it("names the first unmet rule while Start is refused, and none once it is not — never a lorebook", () => {
		const flow = flowOn(LAIR, {
			characters: { min: 1 },
			personas: { min: 1 },
			lorebook: "optional"
		})
		flow.characterIds = []
		expect(flow.startBlocker).toBe("Add at least one character.")
		flow.characterIds = [4]
		expect(flow.startBlocker).toBeNull()
		expect(flow.canStart).toBe(true)
	})

	it("detaches a held lorebook when the chosen genre has no such capability", () => {
		const flow = flowOn(LAIR, {
			characters: { min: 1 },
			personas: { min: 1 },
			lorebook: "optional"
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
					fields: { showDice: {} }
				},
				{
					genreFields: { showDice: true, stray: 1 },
					characterIds: [1, 2, 3],
					personaIds: [7],
					lorebookId: 4
				}
			)
		).toEqual({
			genreFields: { showDice: true },
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
			"characters 1–4 · 1+ characters you play · lorebook optional · a narrator tells the story"
		)
	})

	it("says what it forbids", () => {
		expect(
			genreFacts({ characters: { min: 0, max: 0 }, composer: "none" })
		).toBe("no characters · no character you play · you don't type messages")
	})

	it("says one seat as the character you play", () => {
		expect(
			genreFacts({
				characters: { min: 1 },
				personas: { min: 1, max: 1 }
			})
		).toBe("characters 1+ · a character you play")
	})

	it("says nothing for an unknown shape", () => {
		expect(genreFacts(null)).toBe("")
	})
})

describe("castCountHint", () => {
	it("says exactly when the floor and the cap agree", () => {
		expect(castCountHint(1, 1)).toBe("exactly 1")
	})
	it("gives the range when both bounds hold", () => {
		expect(castCountHint(1, 3)).toBe("1–3")
	})
	it("says at least when there is no cap", () => {
		expect(castCountHint(1, undefined)).toBe("at least 1")
	})
	it("says up to when there is no floor", () => {
		expect(castCountHint(0, 4)).toBe("up to 4")
	})
	it("says nothing when neither bound holds", () => {
		expect(castCountHint(0, undefined)).toBe("")
	})
})

describe("genreFacts, equal bounds", () => {
	it("says exactly rather than a 1–1 range", () => {
		expect(genreFacts({ characters: { min: 1, max: 1 } })).toBe(
			"characters exactly 1 · no character you play"
		)
	})
})

describe("playAsOptions — who you play as", () => {
	const row = (
		id: number,
		name: string,
		over: { isPersona?: boolean; isDefaultPersona?: boolean } = {}
	) => ({ id, name, isPersona: false, isDefaultPersona: false, ...over })

	it("offers every character when nobody is flagged as a persona", () => {
		const options = playAsOptions([row(1, "Mara"), row(2, "Aldo")], [])
		expect(options.map((o) => o.id)).toEqual([2, 1])
		expect(options.every((o) => !o.isPersona)).toBe(true)
	})

	it("lists personas first, the default leading, then everyone else", () => {
		const options = playAsOptions(
			[
				row(1, "Zed"),
				row(2, "Bea", { isPersona: true }),
				row(3, "Cy", { isPersona: true, isDefaultPersona: true }),
				row(4, "Abe")
			],
			[]
		)
		expect(options.map((o) => o.id)).toEqual([3, 2, 4, 1])
	})

	it("leaves out a character already in the cast", () => {
		const options = playAsOptions([row(1, "Mara"), row(2, "Aldo")], [1])
		expect(options.map((o) => o.id)).toEqual([2])
	})
})

describe("StartSessionFlow — playing a cast character", () => {
	function flowWith() {
		const flow = new StartSessionFlow()
		flow.rawGenres = [genre(STANDARD_GENRE_ID)]
		flow.rawPresets = [preset({ id: 1 })]
		flow.presetsLoaded = true
		flow.chooseGenre(STANDARD_GENRE_ID)
		flow.choosePreset(1)
		return flow
	}

	it("starts with a non-persona character as the player", () => {
		const flow = flowWith()
		flow.toggleCharacter(1)
		flow.playAs(2)
		expect(flow.canStart).toBe(true)
		const body = flow.payload("Night walk")
		expect(body.characterIds).toEqual([1])
		expect(body.personaIds).toEqual([2])
	})

	it("adding the player to the cast takes them out of the player seat", () => {
		const flow = flowWith()
		flow.playAs(2)
		flow.toggleCharacter(2)
		expect(flow.characterIds).toEqual([2])
		expect(flow.personaIds).toEqual([])
	})

	it("playing a cast character takes them out of the cast", () => {
		const flow = flowWith()
		flow.toggleCharacter(1)
		flow.toggleCharacter(2)
		flow.playAs(2)
		expect(flow.characterIds).toEqual([1])
		expect(flow.personaIds).toEqual([2])
	})

	it("holds the cast to the genre's cap", () => {
		const flow = new StartSessionFlow()
		flow.rawGenres = [
			genre("core:genre/duet", {
				shape: { characters: { min: 1, max: 1 } }
			})
		]
		flow.chooseGenre("core:genre/duet")
		flow.toggleCharacter(1)
		flow.toggleCharacter(2)
		expect(flow.characterIds).toEqual([1])
	})
})

describe("castOptions — the cast picker (note 33)", () => {
	it("hides the character the person plays as, keeping list order", () => {
		const rows = [{ id: 3 }, { id: 1 }, { id: 2 }]
		expect(castOptions(rows, [1]).map((r) => r.id)).toEqual([3, 2])
	})

	it("offers everyone when nobody is played yet", () => {
		expect(castOptions([{ id: 1 }, { id: 2 }], []).map((r) => r.id)).toEqual([
			1, 2
		])
	})

	it("with playAsOptions, no row is ever offered on both sides", () => {
		const rows = [1, 2, 3, 4].map((id) => ({ id, name: `C${id}` }))
		const cast = [2]
		const seat = [3]
		const castSide = castOptions(rows, seat).map((r) => r.id)
		const seatSide = playAsOptions(rows, cast).map((r) => r.id)
		expect(castSide).not.toContain(3)
		expect(seatSide).not.toContain(2)
	})
})

describe("addToCast / moveInCast — the cast's order", () => {
	it("appends picks in the order picked, skipping anyone already in", () => {
		expect(addToCast([4], [7, 4, 2])).toEqual([4, 7, 2])
	})

	it("stops at the genre's cap", () => {
		expect(addToCast([4], [7, 2], 2)).toEqual([4, 7])
		expect(addToCast([4, 7], [2], 2)).toEqual([4, 7])
	})

	it("moves one member a place up or down", () => {
		expect(moveInCast([1, 2, 3], 2, -1)).toEqual([2, 1, 3])
		expect(moveInCast([1, 2, 3], 2, 1)).toEqual([1, 3, 2])
	})

	it("leaves the ends and unknown ids where they are", () => {
		const cast = [1, 2, 3]
		expect(moveInCast(cast, 1, -1)).toEqual([1, 2, 3])
		expect(moveInCast(cast, 3, 1)).toEqual([1, 2, 3])
		expect(moveInCast(cast, 9, 1)).toEqual([1, 2, 3])
	})
})

describe("StartSessionFlow — adding and ordering the cast", () => {
	function flowOn(shape: GenreRow["shape"]) {
		const flow = new StartSessionFlow()
		flow.rawGenres = [genre("core:genre/troupe", { shape })]
		flow.chooseGenre("core:genre/troupe")
		return flow
	}

	it("adds several in the order picked, and the payload keeps that order", () => {
		const flow = flowOn({ characters: { min: 1 } })
		flow.addCharacters([5, 3])
		flow.addCharacters([8])
		expect(flow.characterIds).toEqual([5, 3, 8])
		expect(flow.payload("x").characterPositions).toEqual({
			5: 0,
			3: 1,
			8: 2
		})
	})

	it("holds the cast to the genre's cap", () => {
		const flow = flowOn({ characters: { min: 1, max: 2 } })
		flow.addCharacters([5, 3, 8])
		expect(flow.characterIds).toEqual([5, 3])
	})

	it("takes an added character out of the player seat", () => {
		const flow = flowOn({ characters: { min: 1 }, personas: { min: 1 } })
		flow.playAs(3)
		flow.addCharacters([3, 5])
		expect(flow.characterIds).toEqual([3, 5])
		expect(flow.personaIds).toEqual([])
	})

	it("reorders, and the turn order follows", () => {
		const flow = flowOn({ characters: { min: 1 } })
		flow.addCharacters([5, 3, 8])
		flow.moveCharacter(8, -1)
		expect(flow.characterIds).toEqual([5, 8, 3])
		flow.moveCharacter(5, 1)
		expect(flow.characterIds).toEqual([8, 5, 3])
		expect(flow.payload("x").characterPositions).toEqual({
			8: 0,
			5: 1,
			3: 2
		})
	})
})

describe("filterPickRows — both pickers' filter", () => {
	const rows = [
		{ id: 1, name: "Mara", nickname: "The Fox", characterTags: [{ tag: { name: "noir" } }] },
		{ id: 2, name: "Aldo", nickname: null, characterTags: [] }
	]

	it("keeps everyone for a blank query", () => {
		expect(filterPickRows(rows, "  ")).toHaveLength(2)
	})

	it("matches name, nickname and tag, ignoring case", () => {
		expect(filterPickRows(rows, "ALD").map((r) => r.id)).toEqual([2])
		expect(filterPickRows(rows, "fox").map((r) => r.id)).toEqual([1])
		expect(filterPickRows(rows, "Noir").map((r) => r.id)).toEqual([1])
	})
})

describe("finalSessionName", () => {
	it("keeps what the person typed, trimmed", () => {
		expect(finalSessionName("  Night walk ", "Session with Mara")).toBe(
			"Night walk"
		)
	})
	it("falls back to the automatic name when left blank", () => {
		expect(finalSessionName("   ", "Session with Mara")).toBe(
			"Session with Mara"
		)
	})
})

describe("StartSessionFlow — the preset's name", () => {
	it("fills the name from the preset's creation defaults", () => {
		const flow = new StartSessionFlow()
		flow.rawGenres = [genre(STANDARD_GENRE_ID)]
		flow.rawPresets = [
			preset({ id: 1, defaults: { name: "Tavern night" } as any })
		]
		flow.presetsLoaded = true
		flow.chooseGenre(STANDARD_GENRE_ID)
		flow.choosePreset(1)
		expect(flow.fields.name).toBe("Tavern night")
	})
})

describe("the wizard's first Guide session", () => {
	it("is named Welcome to Serene Pub, and carries no scenario and no lorebook", () => {
		const input = welcomeSessionInput(
			{ genreId: "core:genre/guide@1.0.0", presetId: 7 },
			3
		)
		expect(WELCOME_SESSION_NAME).toBe("Welcome to Serene Pub")
		const body = buildCreatePayload(input)
		expect(body.session.name).toBe("Welcome to Serene Pub")
		expect(body.session.scenario).toBe("")
		expect(body.session.lorebookId).toBeNull()
		expect(body.session.genreId).toBe("core:genre/guide@1.0.0")
		expect(body.session.presetId).toBe(7)
		expect(body.characterIds).toEqual([])
		expect(body.personaIds).toEqual([3])
	})

	it("starts with no persona when the person has none", () => {
		const input = welcomeSessionInput(
			{ genreId: "core:genre/guide@1.0.0", presetId: 7 },
			null
		)
		expect(buildCreatePayload(input).personaIds).toEqual([])
	})
})

describe("firstUnmetStartRule", () => {
	const ready = {
		genreId: "core:genre/story",
		noPresetsForGenre: false,
		characterCount: 1,
		personaCount: 1,
		floors: { characters: 1, personas: 1 }
	}

	it("is null when every rule is met", () => {
		expect(firstUnmetStartRule(ready)).toBeNull()
	})

	it("asks for a genre before anything else", () => {
		expect(
			firstUnmetStartRule({ ...ready, genreId: null, characterCount: 0 })
		).toBe("Choose a genre.")
	})

	it("says when the genre has no preset to start from", () => {
		expect(
			firstUnmetStartRule({ ...ready, noPresetsForGenre: true })
		).toBe("No preset is available for this genre.")
	})

	it("asks for the cast the floor needs, counted", () => {
		expect(firstUnmetStartRule({ ...ready, characterCount: 0 })).toBe(
			"Add at least one character."
		)
		expect(
			firstUnmetStartRule({
				...ready,
				characterCount: 1,
				floors: { characters: 2, personas: 1 }
			})
		).toBe("Add at least 2 characters.")
	})

	it("asks who you play as after the cast", () => {
		expect(firstUnmetStartRule({ ...ready, personaCount: 0 })).toBe(
			"Choose who you play as."
		)
	})

	it("never asks for a lorebook: a session may always start without one (RF fix 2)", () => {
		expect(firstUnmetStartRule(ready)).toBeNull()
	})
})

describe("preselectsDefaultPersona", () => {
	it("never preselects unless the genre says so outright (ruled 2026-10-19)", () => {
		expect(preselectsDefaultPersona(null)).toBe(false)
		expect(preselectsDefaultPersona({ personas: { min: 0 } })).toBe(false)
		expect(preselectsDefaultPersona({ personas: { min: 1, max: 1 } })).toBe(false)
		expect(preselectsDefaultPersona({ personas: { min: 0, preselectDefault: true } })).toBe(true)
		expect(
			preselectsDefaultPersona({ personas: { min: 0, preselectDefault: false } })
		).toBe(false)
		expect(preselectsDefaultPersona({ personas: { min: 0, max: 0 } })).toBe(false)
		expect(preselectsDefaultPersona({})).toBe(false)
	})
})

/**
 * fix7 (2026-10-23, owner: "In lair, I can't choose a ruleset"): a book on
 * Freeform, every book's default, brings no rules of its own — the pick
 * travels with it; a book with its own rules is still adopted server-side.
 * A preset's How strict is stored as a setting decision (`{ value, lock }`).
 */
describe("StartSessionFlow — Rules beside a book, and a preset's How strict (fix7)", () => {
	const FREEFORM = "core:ruleset/freeform@1"
	const VIS = "core:ruleset/vis-itineris@1"
	const LAIR = "core:genre/lair"
	const RULES = {
		choices: [
			{ id: FREEFORM, name: "Freeform", subtitle: "", recommended: true, rigours: ["prose"] },
			{ id: VIS, name: "Vis Itineris", subtitle: "", recommended: true }
		],
		only: false,
		defaultId: FREEFORM,
		rigour: { options: ["prose", "mechanics", "scripts"], default: "mechanics" }
	}

	function lairFlow(settings: Record<string, unknown> | null = null) {
		const flow = new StartSessionFlow()
		flow.rawGenres = [genre(LAIR, { rules: RULES } as Partial<GenreRow>)]
		flow.rawPresets = [preset({ id: 1, genreId: LAIR, settings } as any)]
		flow.presetsLoaded = true
		flow.chooseGenre(LAIR)
		flow.choosePreset(1)
		flow.toggleCharacter(1)
		return flow
	}

	it("a book on Freeform: the person's pick is sent, and How strict follows it", () => {
		const flow = lairFlow()
		flow.fields.lorebookId = 7
		flow.lorebookRules = FREEFORM
		expect(flow.adoptedRules).toBeNull()
		expect(flow.rulesShown).toEqual({ value: FREEFORM, fromLorebook: null })
		flow.rulesPick = VIS
		const { session } = flow.payload("Into the deep")
		expect(session.lorebookId).toBe(7)
		expect(session.primaryRuleset).toBe(VIS)
		expect(session.rigour).toBe("mechanics")
	})

	it("a book with its own rules: adopted, and no pick is sent", () => {
		const flow = lairFlow()
		flow.fields.lorebookId = 8
		flow.lorebookRules = VIS
		flow.rulesPick = FREEFORM
		expect(flow.adoptedRules).toBe(VIS)
		expect(flow.rulesShown).toEqual({ value: VIS, fromLorebook: "From the lorebook: Vis Itineris" })
		const { session } = flow.payload("Into the deep")
		expect(session.primaryRuleset).toBeUndefined()
		expect(session.rigour).toBe("mechanics")
	})

	it("reads a preset's locked How strict as stored, and starts on rules that play it", () => {
		const flow = lairFlow({ rigour: { value: "scripts", lock: true } })
		expect(flow.presetRigour).toBe("scripts")
		expect(flow.rulesNowId).toBe(VIS)
		expect(flow.payload("Into the deep").session).toMatchObject({ primaryRuleset: VIS, rigour: "scripts" })
		// A bare string still reads.
		expect(lairFlow({ rigour: "prose" }).presetRigour).toBe("prose")
		expect(lairFlow().presetRigour).toBeNull()
	})
})
