import { describe, expect, test } from "vitest"
import {
	normalizeLorebookEntryPriority,
	mapImportedEntry,
	entryTypeIdOf,
	matchModeOf,
	parseDelimitedRegexKey,
	secondaryKeysOf,
	selectiveLogicOf,
	useRegexOf,
	hasLorebookEntries,
	normalizeLegacyLorebookData,
	normalizeNativeWorldInfoEntry,
	parseImportedLorebook,
	resolveAnchorEntryLinks,
	resolveParentNodeLinks
} from "./lorebookImportMapper"
import { mapEntry } from "./lorebookExportMapper"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/shared/entries/types"
import {
	buildScanWindow,
	keywordSignal,
	selectiveLogicHolds
} from "$lib/server/pipelines/ranking/signals"

describe("normalizeLorebookEntryPriority", () => {
	test("defaults null/undefined to 1", () => {
		expect(normalizeLorebookEntryPriority(null)).toBe(1)
		expect(normalizeLorebookEntryPriority(undefined)).toBe(1)
	})

	test("clamps values below 1 up to 1", () => {
		expect(normalizeLorebookEntryPriority(0)).toBe(1)
		expect(normalizeLorebookEntryPriority(-5)).toBe(1)
	})

	test("clamps values above 3 down to 3", () => {
		expect(normalizeLorebookEntryPriority(4)).toBe(3)
		expect(normalizeLorebookEntryPriority(100)).toBe(3)
	})

	test("passes through in-range values unchanged", () => {
		expect(normalizeLorebookEntryPriority(1)).toBe(1)
		expect(normalizeLorebookEntryPriority(2)).toBe(2)
		expect(normalizeLorebookEntryPriority(3)).toBe(3)
	})
})

describe("mapImportedEntry — world lore", () => {
	test("maps a full entry", () => {
		const mapped = mapImportedEntry(
			{
				keys: ["alpha", "beta"],
				content: "Some lore content",
				enabled: true,
				constant: true,
				name: "Entry Name",
				priority: 2
			},
			WORLD_LORE_TYPE_ID,
			3
		)

		expect(mapped).toEqual({
			name: "Entry Name",
			content: "Some lore content",
			position: 3,
			keys: "alpha, beta",
			// Always present, exactly as `keys` is, and empty for a file that
			// states no condition. `selectiveLogic` is the opposite — omitted
			// entirely, so the column stays NULL. See `selectiveLogicOf`.
			secondaryKeys: "",
			enabled: true,
			constant: true,
			caseSensitive: false,
			useRegex: false,
			priority: 2,
			category: null,
			extraJson: {}
		})
	})

	test("restores case_sensitive from the incoming entry, and useRegex from the keys", () => {
		const mapped = mapImportedEntry(
			{
				keys: ["/^alpha$/i"],
				content: "",
				enabled: true,
				case_sensitive: true,
				use_regex: true
			},
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.caseSensitive).toBe(true)
		// Not restored from `use_regex` — see the useRegexOf suite below.
		expect(mapped.useRegex).toBe(true)
	})

	test("preserves foreign extension data into extraJson", () => {
		const mapped = mapImportedEntry(
			{
				keys: [],
				content: "",
				enabled: true,
				extensions: { probability: 80, depth: 4, group: "weather" }
			},
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.extraJson).toEqual({
			probability: 80,
			depth: 4,
			group: "weather"
		})
	})

	test("strips a previously-exported serenepub key out of extraJson, restoring category instead", () => {
		const mapped = mapImportedEntry(
			{
				keys: [],
				content: "",
				enabled: true,
				extensions: {
					probability: 80,
					serenepub: { entryType: "world", category: "Locations" }
				}
			},
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.category).toBe("Locations")
		expect(mapped.extraJson).toEqual({ probability: 80 })
	})

	test("falls back to comment, then 'Imported Entry', when name is missing", () => {
		const withComment = mapImportedEntry(
			{ keys: [], content: "", enabled: true, comment: "A comment" },
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(withComment.name).toBe("A comment")

		const withNeither = mapImportedEntry(
			{ keys: [], content: "", enabled: true },
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(withNeither.name).toBe("Imported Entry")
	})

	test("joins multiple keys with a comma-space separator", () => {
		const mapped = mapImportedEntry(
			{ keys: ["one", "two", "three"], content: "", enabled: true },
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.keys).toBe("one, two, three")
	})

	test("defaults enabled to true and constant to false when omitted", () => {
		const mapped = mapImportedEntry(
			{ keys: [], content: "", enabled: undefined as unknown as boolean },
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.enabled).toBe(true)
		expect(mapped.constant).toBe(false)
	})

	test("normalizes out-of-range priority", () => {
		const mapped = mapImportedEntry(
			{ keys: [], content: "", enabled: true, priority: 99 },
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.priority).toBe(3)
	})
})

describe("matchModeOf", () => {
	// SillyTavern carries whole-word matching as a tri-state under
	// extensions.match_whole_words in a character_book, and as a top-level
	// camelCase matchWholeWords in its own native World Info JSON. Its global
	// default is ON (default/content/settings.json ships
	// world_info_match_whole_words: true), but that global never travels in
	// the file — so null/absent stays unknowable rather than guessed.
	const entry = (extra: Record<string, any> = {}) => ({
		keys: [],
		content: "",
		enabled: true,
		...extra
	})

	test("maps a declared whole-word entry to 'word'", () => {
		expect(
			matchModeOf(entry({ extensions: { match_whole_words: true } }))
		).toBe("word")
	})

	test("maps an explicitly non-whole-word entry to 'substring'", () => {
		expect(
			matchModeOf(entry({ extensions: { match_whole_words: false } }))
		).toBe("substring")
	})

	test("declares nothing when the flag is null (SillyTavern's defer-to-global)", () => {
		expect(
			matchModeOf(entry({ extensions: { match_whole_words: null } }))
		).toBeUndefined()
	})

	test("declares nothing when the book carries no flag at all", () => {
		expect(matchModeOf(entry())).toBeUndefined()
		expect(
			matchModeOf(entry({ extensions: { probability: 80 } }))
		).toBeUndefined()
	})

	test("reads SillyTavern's native top-level camelCase matchWholeWords", () => {
		expect(matchModeOf(entry({ matchWholeWords: true }))).toBe("word")
		expect(matchModeOf(entry({ matchWholeWords: false }))).toBe("substring")
		expect(matchModeOf(entry({ matchWholeWords: null }))).toBeUndefined()
	})

	test("prefers the character_book extensions key over the native one", () => {
		expect(
			matchModeOf(
				entry({
					matchWholeWords: false,
					extensions: { match_whole_words: true }
				})
			)
		).toBe("word")
	})

	test("regex wins over whole-word, leaving matchMode undeclared", () => {
		// Regex-ness comes from the keys' `/pattern/flags` shape, not the flag.
		expect(
			matchModeOf(
				entry({
					keys: ["/king/i"],
					use_regex: true,
					extensions: { match_whole_words: true }
				})
			)
		).toBeUndefined()
		expect(
			matchModeOf(
				entry({
					keys: ["/king/i"],
					use_regex: false,
					extensions: { match_whole_words: false }
				})
			)
		).toBeUndefined()
	})

	test("honours whole-word on an entry SillyTavern flagged regex with literal keys", () => {
		// The flag is a constant `true` in SillyTavern's exporter, so reading it
		// here used to suppress the whole-word intent of practically every book
		// it wrote. Plain keys are not a regex, so the declaration stands.
		expect(
			matchModeOf(
				entry({
					keys: ["king", "queen"],
					use_regex: true,
					extensions: { match_whole_words: true }
				})
			)
		).toBe("word")
		expect(
			matchModeOf(
				entry({
					keys: ["king"],
					use_regex: true,
					extensions: { match_whole_words: false }
				})
			)
		).toBe("substring")
	})

	test("a mixed key set is not a regex entry, so whole-word still applies", () => {
		expect(
			matchModeOf(
				entry({
					keys: ["/king/i", "queen"],
					use_regex: true,
					extensions: { match_whole_words: true }
				})
			)
		).toBe("word")
	})

	test("ignores a non-boolean value a foreign tool wrote there", () => {
		expect(
			matchModeOf(entry({ extensions: { match_whole_words: "true" } }))
		).toBeUndefined()
		expect(
			matchModeOf(entry({ extensions: { match_whole_words: 1 } }))
		).toBeUndefined()
	})
})

describe("matchMode on the imported entry mappers", () => {
	const wholeWord = {
		keys: ["king"],
		content: "The king",
		enabled: true,
		extensions: { match_whole_words: true }
	}

	test("carries a declared whole-word intent onto all three tables", () => {
		expect(
			mapImportedEntry(wholeWord, WORLD_LORE_TYPE_ID, 0).matchMode
		).toBe("word")
		expect(
			mapImportedEntry(wholeWord, CHARACTER_LORE_TYPE_ID, 0).matchMode
		).toBe("word")
		expect(mapImportedEntry(wholeWord, HISTORY_TYPE_ID, 0).matchMode).toBe(
			"word"
		)
	})

	test("carries an explicit substring intent through as 'substring'", () => {
		expect(
			mapImportedEntry(
				{
					keys: [],
					content: "",
					enabled: true,
					extensions: { match_whole_words: false }
				},
				WORLD_LORE_TYPE_ID,
				0
			).matchMode
		).toBe("substring")
	})

	test("omits matchMode entirely for a book that declares neither", () => {
		const mapped = mapImportedEntry(
			{ keys: [], content: "", enabled: true },
			WORLD_LORE_TYPE_ID,
			0
		)
		// Absent, not null: the column stays NULL and ranking/signals.ts's own
		// substring default applies, exactly as before this mapping existed.
		expect("matchMode" in mapped).toBe(false)
	})

	test("leaves a regex entry's matchMode unset so useRegex still decides", () => {
		const mapped = mapImportedEntry(
			{
				keys: ["/king/i"],
				content: "",
				enabled: true,
				use_regex: true,
				extensions: { match_whole_words: true }
			},
			WORLD_LORE_TYPE_ID,
			0
		)
		expect("matchMode" in mapped).toBe(false)
		expect(mapped.useRegex).toBe(true)
	})

	test("still preserves match_whole_words in extraJson, mapping doesn't consume it", () => {
		const mapped = mapImportedEntry(
			{
				keys: [],
				content: "",
				enabled: true,
				extensions: { match_whole_words: true, probability: 80 }
			},
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.extraJson).toEqual({
			match_whole_words: true,
			probability: 80
		})
	})

	test("export/import round trip reproduces the foreign extensions bag verbatim", () => {
		const imported = mapImportedEntry(
			{
				keys: ["king"],
				content: "The king",
				enabled: true,
				name: "King",
				extensions: {
					match_whole_words: true,
					probability: 80,
					depth: 4,
					group: "royalty"
				}
			},
			WORLD_LORE_TYPE_ID,
			0
		)
		const exported = mapEntry(
			{ ...imported, id: 7, typeId: WORLD_LORE_TYPE_ID },
			0
		)

		expect(exported.extensions).toEqual({
			match_whole_words: true,
			probability: 80,
			depth: 4,
			group: "royalty",
			serenepub: { entryType: "world" }
		})

		// ...and re-importing that export lands on the same matchMode again.
		expect(
			mapImportedEntry(exported, WORLD_LORE_TYPE_ID, 0).matchMode
		).toBe("word")
	})
})

describe("secondaryKeysOf", () => {
	const entry = (overrides: Record<string, any>) => ({
		keys: ["dragon"],
		content: "",
		enabled: true,
		...overrides
	})

	test("reads the CCv2/V3 spec name", () => {
		expect(
			secondaryKeysOf(entry({ secondary_keys: ["statue", "mural"] }))
		).toEqual(["statue", "mural"])
	})

	test("reads SillyTavern's native keysecondary", () => {
		expect(secondaryKeysOf(entry({ keysecondary: ["statue"] }))).toEqual([
			"statue"
		])
	})

	test("prefers the spec name over the empty keysecondary the dialog adds", () => {
		// LorebooksSidebar normalizes `keysecondary` onto *every* entry it
		// uploads, empty array included, so a `character_book` arriving through
		// the dialog carries both names — and the spec one is the real list.
		expect(
			secondaryKeysOf(
				entry({ secondary_keys: ["statue"], keysecondary: [] })
			)
		).toEqual(["statue"])
	})

	test("is empty for an entry that declares neither, or declares junk", () => {
		expect(secondaryKeysOf(entry({}))).toEqual([])
		// A singular string is normalized upstream (normalizeLegacyLorebookData)
		// rather than guessed at here, exactly as the primary keys are.
		expect(
			secondaryKeysOf(entry({ keysecondary: "statue" as any }))
		).toEqual([])
	})
})

describe("selectiveLogicOf", () => {
	const entry = (overrides: Record<string, any>) => ({
		keys: ["dragon"],
		content: "",
		enabled: true,
		secondary_keys: ["statue"],
		selective: true,
		...overrides
	})

	// ⚠ The whole reason a table exists: 1 and 3 are NOT the pair anybody
	// guesses (`AND_ANY = 0, NOT_ALL = 1, NOT_ANY = 2, AND_ALL = 3`), so an
	// importer indexing a four-element array in the obvious order silently
	// inverts every book that used either.
	test("translates SillyTavern's four codes, including the two that look swapped", () => {
		const modeOf = (selectiveLogic: number) =>
			selectiveLogicOf(entry({ extensions: { selectiveLogic } }))
		expect(modeOf(0)).toBe("andAny")
		expect(modeOf(1)).toBe("notAll")
		expect(modeOf(2)).toBe("notAny")
		expect(modeOf(3)).toBe("andAll")
	})

	test("reads the native top-level integer, with the character_book one winning", () => {
		expect(selectiveLogicOf(entry({ selectiveLogic: 2 }))).toBe("notAny")
		expect(
			selectiveLogicOf(
				entry({ selectiveLogic: 2, extensions: { selectiveLogic: 3 } })
			)
		).toBe("andAll")
	})

	test("declares nothing for a code SillyTavern does not define", () => {
		// A mode from a later SillyTavern is no condition rather than a guess
		// at which of the four it meant.
		expect(
			selectiveLogicOf(entry({ extensions: { selectiveLogic: 7 } }))
		).toBeUndefined()
		expect(
			selectiveLogicOf(
				entry({ extensions: { selectiveLogic: "notAny" } })
			)
		).toBeUndefined()
	})

	test("declares nothing when there are no condition keys", () => {
		// SillyTavern stamps `selectiveLogic: 0` onto every entry it writes,
		// exactly as it stamps `use_regex: true` — reading it unconditionally
		// would put "andAny" on every row of every imported book.
		expect(
			selectiveLogicOf(
				entry({ secondary_keys: [], extensions: { selectiveLogic: 0 } })
			)
		).toBeUndefined()
	})

	test("honours an explicit selective: false, but not an absent one", () => {
		// ST's own scanner gates the condition on this flag, so a false there
		// means the book does not apply the condition and neither do we. Absent
		// is not false — its entry template defaults it to true.
		expect(
			selectiveLogicOf(
				entry({ selective: false, extensions: { selectiveLogic: 2 } })
			)
		).toBeUndefined()
		expect(
			selectiveLogicOf(
				entry({
					selective: undefined,
					extensions: { selectiveLogic: 2 }
				})
			)
		).toBe("notAny")
	})
})

describe("the condition on the imported entry mappers", () => {
	const stEntry = (overrides: Record<string, any> = {}) => ({
		keys: ["dragon"],
		content: "A dragon.",
		enabled: true,
		name: "Dragon",
		secondary_keys: ["statue", "mural"],
		selective: true,
		extensions: { selectiveLogic: 1, probability: 80 },
		...overrides
	})

	test("carries the condition keys and mode onto the row", () => {
		const mapped = mapImportedEntry(stEntry(), WORLD_LORE_TYPE_ID, 0)
		expect(mapped.secondaryKeys).toBe("statue, mural")
		expect(mapped.selectiveLogic).toBe("notAll")
	})

	test("the imported row is the condition the file described", () => {
		// The mode alone proves the table was consulted; this proves the row
		// the table produced actually excludes what the file meant it to.
		const mapped = mapImportedEntry(
			stEntry({ extensions: { selectiveLogic: 2 } }),
			WORLD_LORE_TYPE_ID,
			0
		)
		const holds = (text: string) =>
			selectiveLogicHolds(
				mapped as any,
				buildScanWindow([{ content: text }], 1)
			)
		expect(holds("a dragon")).toBe(true)
		expect(holds("a dragon beside the statue")).toBe(false)
	})

	test("keeps the keys even when no mode is declared", () => {
		// The keys are the author's data. A mode arriving later — a re-import,
		// or the editor — then has something to read, and until then
		// `selectiveLogicHolds` sees no mode and excludes nothing.
		const mapped = mapImportedEntry(
			stEntry({ selective: false }),
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.secondaryKeys).toBe("statue, mural")
		expect("selectiveLogic" in mapped).toBe(false)
	})

	test("omits selectiveLogic entirely for a book that declares no condition", () => {
		// Absent, not null: the column stays NULL, which is Serene Pub's own
		// "no opinion" — the same shape matchMode uses.
		const mapped = mapImportedEntry(
			{ keys: ["dragon"], content: "", enabled: true },
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.secondaryKeys).toBe("")
		expect("selectiveLogic" in mapped).toBe(false)
	})

	test("strips the delimiters off a regex entry's condition keys", () => {
		// selectiveLogicHolds tests a condition key with the same matchesKey
		// the primary keys go through, so a stored `/statue/i` would compile to
		// a pattern matching literal slashes and never hold.
		const mapped = mapImportedEntry(
			stEntry({
				keys: ["/dra.on/i"],
				secondary_keys: ["/stat.e/i", "mural"]
			}),
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.useRegex).toBe(true)
		expect(mapped.secondaryKeys).toBe("stat.e, mural")
	})

	test("the mode still rides in extraJson, mapping doesn't consume it", () => {
		// Same rule as match_whole_words: the foreign bag is preserved
		// verbatim, and the promoted column is derived from it rather than
		// eating it.
		const mapped = mapImportedEntry(stEntry(), WORLD_LORE_TYPE_ID, 0)
		expect(mapped.extraJson).toEqual({ selectiveLogic: 1, probability: 80 })
	})
})

describe("parseDelimitedRegexKey", () => {
	// Mirrors SillyTavern's parseRegexFromString (public/scripts/world-info.js),
	// which is what its scanner actually consults — see useRegexOf.
	test("returns the bare pattern for a delimited key, with or without flags", () => {
		expect(parseDelimitedRegexKey("/king/")).toBe("king")
		expect(parseDelimitedRegexKey("/^the king$/gi")).toBe("^the king$")
	})

	test("returns null for a plain literal key, metacharacters and all", () => {
		expect(parseDelimitedRegexKey("king")).toBeNull()
		expect(parseDelimitedRegexKey("a.b")).toBeNull()
		expect(parseDelimitedRegexKey("St. Louis (MO)")).toBeNull()
		// A leading or trailing slash alone is not the delimited form.
		expect(parseDelimitedRegexKey("/king")).toBeNull()
		expect(parseDelimitedRegexKey("king/")).toBeNull()
	})

	test("returns null for an empty body", () => {
		expect(parseDelimitedRegexKey("//")).toBeNull()
		expect(parseDelimitedRegexKey("//g")).toBeNull()
	})

	test("returns null when the body holds an unescaped delimiter", () => {
		// SillyTavern rejects these outright rather than guessing where the
		// pattern ends, so a path-shaped key stays plain text.
		expect(parseDelimitedRegexKey("/and/or/")).toBeNull()
	})

	test("keeps an escaped delimiter in the body verbatim", () => {
		// `\/` and `/` are the same thing to RegExp, so unescaping would only
		// risk corrupting a `\\/`; signals.ts compiles this to the same matcher
		// SillyTavern would have built.
		expect(parseDelimitedRegexKey("/and\\/or/")).toBe("and\\/or")
		expect(new RegExp("and\\/or").test("and/or")).toBe(true)
	})

	test("returns null for a body that does not compile", () => {
		expect(parseDelimitedRegexKey("/[unclosed/")).toBeNull()
		// Duplicate flags throw too, so this is a literal like any other.
		expect(parseDelimitedRegexKey("/king/gg")).toBeNull()
	})

	test("returns null for characters that are not real RegExp flags", () => {
		expect(parseDelimitedRegexKey("/king/x")).toBeNull()
	})

	test("returns null for anything that is not a string", () => {
		expect(parseDelimitedRegexKey(undefined)).toBeNull()
		expect(parseDelimitedRegexKey(null)).toBeNull()
		expect(parseDelimitedRegexKey(42)).toBeNull()
	})
})

describe("useRegexOf", () => {
	const entry = (extra: Record<string, any> = {}) => ({
		keys: [],
		content: "",
		enabled: true,
		...extra
	})

	test("ignores use_regex when the keys are plainly literal", () => {
		// SillyTavern's exporter writes `use_regex: true` on every entry
		// ("ST keys are always regex"), which its own scanner does not honour.
		expect(useRegexOf(entry({ keys: ["king"], use_regex: true }))).toBe(
			false
		)
		expect(
			useRegexOf(entry({ keys: ["a.b", "who?"], use_regex: true }))
		).toBe(false)
	})

	test("reads a delimited key set as regex even when use_regex is false", () => {
		expect(useRegexOf(entry({ keys: ["/king/i"], use_regex: false }))).toBe(
			true
		)
		expect(
			useRegexOf(
				entry({ keys: ["/king/", "/^queen$/"], use_regex: false })
			)
		).toBe(true)
	})

	test("treats a mixed key set as literal", () => {
		// Serene Pub stores one useRegex per entry, so a mixed set cannot be
		// represented; literal is the direction that never silently re-reads a
		// plain key as a pattern.
		expect(
			useRegexOf(entry({ keys: ["/king/i", "queen"], use_regex: true }))
		).toBe(false)
	})

	test("treats a key that only looks delimited as literal", () => {
		// Invalid syntax, so SillyTavern matches the whole string as text.
		expect(
			useRegexOf(entry({ keys: ["/[unclosed/"], use_regex: true }))
		).toBe(false)
	})

	test("treats a keyless entry as literal", () => {
		expect(useRegexOf(entry({ use_regex: true }))).toBe(false)
	})

	test("does not exempt an entry carrying our own serenepub marker", () => {
		// The shape is the one rule, for every file. Our exporter holds up its
		// end by writing regex keys delimited (see toDelimitedRegexKey), so a
		// bare key in a serenepub-marked file is a literal like any other —
		// which is also the honest answer for a hand-edited or forged bag.
		expect(
			useRegexOf(
				entry({
					keys: ["a.b"],
					use_regex: true,
					extensions: { serenepub: { entryType: "world" } }
				})
			)
		).toBe(false)
		expect(
			useRegexOf(
				entry({
					keys: ["/a.b/i"],
					use_regex: false,
					extensions: { serenepub: { entryType: "world" } }
				})
			)
		).toBe(true)
	})
})

describe("regex decided by key shape on the imported entry mappers", () => {
	const scan = (text: string) => buildScanWindow([{ content: text }], 1)

	test("a SillyTavern entry with literal keys imports as literal", () => {
		const mapped = mapImportedEntry(
			{
				keys: ["a.b", "St. Louis"],
				content: "",
				enabled: true,
				use_regex: true
			},
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.useRegex).toBe(false)
		expect(mapped.keys).toBe("a.b, St. Louis")
		// The regression this replaces: as a regex, `a.b` fired on "axb".
		expect(keywordSignal(mapped, scan("axb"))).toBe(0)
		expect(keywordSignal(mapped, scan("a.b"))).toBe(0.5)
	})

	test("...and now honours a whole-word flag it declared alongside use_regex", () => {
		const declared = {
			keys: ["king"],
			content: "",
			enabled: true,
			use_regex: true,
			extensions: { match_whole_words: true }
		}
		expect(
			mapImportedEntry(declared, WORLD_LORE_TYPE_ID, 0).matchMode
		).toBe("word")
		expect(
			mapImportedEntry(declared, CHARACTER_LORE_TYPE_ID, 0).matchMode
		).toBe("word")
		expect(mapImportedEntry(declared, HISTORY_TYPE_ID, 0).matchMode).toBe(
			"word"
		)
	})

	test("a delimited key set imports as regex, stripped of its delimiters", () => {
		const entry = {
			keys: ["/a.b/i", "/^the king$/"],
			content: "",
			enabled: true,
			use_regex: true
		}
		for (const mapped of [
			mapImportedEntry(entry, WORLD_LORE_TYPE_ID, 0),
			mapImportedEntry(entry, CHARACTER_LORE_TYPE_ID, 0),
			mapImportedEntry(entry, HISTORY_TYPE_ID, 0)
		]) {
			expect(mapped.useRegex).toBe(true)
			// Stripped because signals.ts compiles the stored key directly:
			// a stored "/a.b/i" would be a pattern matching literal slashes.
			expect(mapped.keys).toBe("a.b, ^the king$")
			expect("matchMode" in mapped).toBe(false)
		}
		expect(
			keywordSignal(
				mapImportedEntry(entry, WORLD_LORE_TYPE_ID, 0),
				scan("axb")
			)
		).toBe(0.5)
	})

	test("a delimited key set imports as regex even when use_regex is false", () => {
		// Deliberate: the shape is the declaration, in both directions. A tool
		// that writes `/pattern/` keys and forgets the flag still gets the
		// matching SillyTavern would have given it.
		const mapped = mapImportedEntry(
			{
				keys: ["/a.b/"],
				content: "",
				enabled: true,
				use_regex: false
			},
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.useRegex).toBe(true)
		expect(mapped.keys).toBe("a.b")
	})

	test("a mixed key set imports as literal, keys kept verbatim", () => {
		// Serene Pub has one useRegex per entry, so this entry cannot be
		// represented faithfully; the delimited key is left visible in the key
		// list (where a user can split the entry) rather than the plain keys
		// being silently promoted to patterns.
		const mapped = mapImportedEntry(
			{
				keys: ["/a.b/i", "queen"],
				content: "",
				enabled: true,
				use_regex: true
			},
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.useRegex).toBe(false)
		expect(mapped.keys).toBe("/a.b/i, queen")
		expect(keywordSignal(mapped, scan("axb"))).toBe(0)
		expect(keywordSignal(mapped, scan("the queen"))).toBe(0.5)
	})

	test("a keyless entry imports as literal whatever the flag said", () => {
		const mapped = mapImportedEntry(
			{ keys: [], content: "", enabled: true, use_regex: true },
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.useRegex).toBe(false)
		expect(mapped.keys).toBe("")
	})

	const row = (overrides: Record<string, any> = {}) => ({
		id: 7,
		typeId: WORLD_LORE_TYPE_ID as string,
		name: "Pattern",
		content: "Lore",
		keys: "a.b",
		enabled: true,
		constant: false,
		useRegex: true,
		caseSensitive: false,
		priority: 2,
		category: null,
		extraJson: { probability: 80 },
		...overrides
	})

	test("a Serene Pub export round-trips its own regex entry unchanged", () => {
		// The identity round trip the serenepub exemption used to protect, now
		// held up by the export side instead: a native regex entry's keys go
		// out delimited, so shape-sniffing reads them straight back as a regex.
		const exported = mapEntry(row(), 0)
		expect(exported.keys).toEqual(["/a.b/i"])

		const reimported = mapImportedEntry(exported, WORLD_LORE_TYPE_ID, 0)
		expect(reimported.useRegex).toBe(true)
		expect(reimported.keys).toBe("a.b")
		expect(reimported.extraJson).toEqual({ probability: 80 })
		// Still a real pattern, not the literal text "a.b" (which "axb" would
		// not contain).
		expect(keywordSignal(reimported, scan("axb"))).toBe(1)

		// ...and stable: a second export reproduces the first byte for byte,
		// which is what keeps the re-import hash comparison meaningful.
		expect(
			mapEntry(
				{
					...reimported,
					id: 7,
					typeId: WORLD_LORE_TYPE_ID,
					category: null
				},
				0
			)
		).toEqual(exported)
	})

	test("a case-sensitive regex entry exports without the i flag", () => {
		// The flag is the faithful translation of Serene Pub's own behaviour
		// (signals.ts lowercases both sides when caseSensitive is false), not a
		// default — and SillyTavern ignores case_sensitive on a regex key, so
		// the flag is the only thing carrying that intent across.
		expect(mapEntry(row({ caseSensitive: true }), 0).keys).toEqual([
			"/a.b/"
		])
		// Either way the flag itself is dropped on the way back in: Serene Pub
		// has nowhere to keep flags, and case_sensitive rides its own field.
		expect(
			mapImportedEntry(
				mapEntry(row({ caseSensitive: true }), 0),
				WORLD_LORE_TYPE_ID,
				0
			)
		).toMatchObject({ useRegex: true, keys: "a.b", caseSensitive: true })
	})

	test("a literal entry's keys are exported bare", () => {
		// Delimiting these would be the same bug in reverse — a plain key
		// silently promoted to a pattern on the next import.
		expect(mapEntry(row({ useRegex: false }), 0).keys).toEqual(["a.b"])
		expect(mapEntry(row({ useRegex: null }), 0).keys).toEqual(["a.b"])
	})

	test("a pattern containing a delimiter exports escaped and re-imports", () => {
		const exported = mapEntry(row({ keys: "and/or" }), 0)
		expect(exported.keys).toEqual(["/and\\/or/i"])
		// Exactly what the importer's parser accepts — an unescaped delimiter
		// would have made SillyTavern (and now us) read the key as plain text.
		expect(parseDelimitedRegexKey(exported.keys[0])).toBe("and\\/or")

		const reimported = mapImportedEntry(exported, WORLD_LORE_TYPE_ID, 0)
		expect(reimported.useRegex).toBe(true)
		// The escape survives verbatim (the parser never unescapes, so that a
		// `\\/` is not corrupted) — `\/` and `/` are the same to RegExp, so the
		// stored key still matches the same text.
		expect(reimported.keys).toBe("and\\/or")
		expect(keywordSignal(reimported, scan("and/or"))).toBe(1)
		// And it is a fixed point from here: escaping only ever touches an
		// *unescaped* delimiter, so the next export is the same bytes again.
		expect(
			mapEntry(
				{
					...reimported,
					id: 7,
					typeId: WORLD_LORE_TYPE_ID,
					category: null
				},
				0
			).keys
		).toEqual(exported.keys)
	})

	test("an already-escaped delimiter is not double-escaped", () => {
		// `\\/` is an escaped backslash before a real delimiter, which does
		// need escaping; `\/` is already the delimiter escape and does not.
		expect(mapEntry(row({ keys: "and\\/or" }), 0).keys).toEqual([
			"/and\\/or/i"
		])
		expect(mapEntry(row({ keys: "a\\\\/b" }), 0).keys).toEqual([
			"/a\\\\\\/b/i"
		])
		expect(parseDelimitedRegexKey("/a\\\\\\/b/i")).toBe("a\\\\\\/b")
	})

	test("a pattern that does not compile is left bare", () => {
		// parseDelimitedRegexKey rejects it either way, so delimiting would
		// only bake `/…/i` into the key text the user typed.
		expect(mapEntry(row({ keys: "[unclosed" }), 0).keys).toEqual([
			"[unclosed"
		])
		expect(
			mapImportedEntry(
				mapEntry(row({ keys: "[unclosed" }), 0),
				WORLD_LORE_TYPE_ID,
				0
			).keys
		).toBe("[unclosed")
	})

	test("a foreign regex entry's unmapped fields survive the round trip", () => {
		const imported = mapImportedEntry(
			{
				keys: ["/a.b/i"],
				content: "Lore",
				enabled: true,
				name: "Pattern",
				use_regex: true,
				extensions: { probability: 80, depth: 4, group: "royalty" }
			},
			WORLD_LORE_TYPE_ID,
			0
		)
		const exported = mapEntry(
			{ ...imported, id: 7, typeId: WORLD_LORE_TYPE_ID },
			0
		)

		expect(exported.extensions).toEqual({
			probability: 80,
			depth: 4,
			group: "royalty",
			serenepub: { entryType: "world" }
		})
		// The keys survive as the same delimited key they arrived as: stripped
		// to a bare pattern for storage, re-delimited on the way out, with
		// use_regex now telling the truth about them either way.
		expect(exported.keys).toEqual(["/a.b/i"])
		expect(exported.use_regex).toBe(true)
	})
})

describe("export → import round trip", () => {
	/**
	 * A world lore row as it sits in the database after a SillyTavern import:
	 * a real condition, a declared whole-word intent, a priority, and the
	 * foreign bag the file arrived with.
	 */
	const row = (overrides: Record<string, any> = {}) => ({
		id: 7,
		typeId: WORLD_LORE_TYPE_ID as string,
		name: "Dragon",
		content: "A dragon of the old wars.",
		keys: "dragon, wyrm",
		secondaryKeys: "statue, mural",
		selectiveLogic: "notAll",
		matchMode: "word",
		useRegex: false,
		caseSensitive: false,
		enabled: true,
		constant: false,
		priority: 2,
		category: "Bestiary",
		extraJson: {
			match_whole_words: true,
			selectiveLogic: 1,
			probability: 80
		},
		...overrides
	})

	test("every matcher fact survives the trip, and the second export is the first", () => {
		const exported = mapEntry(row(), 3)
		const reimported = mapImportedEntry(
			exported,
			WORLD_LORE_TYPE_ID,
			// The file's own ordering, which is what the real importers assign
			// from as they walk the entries in order.
			exported.insertion_order
		)

		expect(reimported).toMatchObject({
			keys: "dragon, wyrm",
			secondaryKeys: "statue, mural",
			selectiveLogic: "notAll",
			matchMode: "word",
			useRegex: false,
			priority: 2,
			position: 3
		})

		// A fixed point from here: re-exporting the re-imported row reproduces
		// the same bytes, which is what keeps the importer's "unchanged vs
		// conflict" hash comparison meaningful.
		expect(
			mapEntry({ ...reimported, id: 7, typeId: WORLD_LORE_TYPE_ID }, 3)
		).toEqual(exported)
	})

	test("a regex entry's condition keys survive as patterns, not as text", () => {
		const exported = mapEntry(
			row({
				keys: "dra.on",
				secondaryKeys: "stat.e",
				useRegex: true,
				// Regex wins over whole-word, so a regex row declares no
				// matchMode — see matchModeOf.
				matchMode: null,
				extraJson: { probability: 80 }
			}),
			0
		)
		expect(exported.keys).toEqual(["/dra.on/i"])
		expect(exported.secondary_keys).toEqual(["/stat.e/i"])

		const reimported = mapImportedEntry(exported, WORLD_LORE_TYPE_ID, 0)
		expect(reimported).toMatchObject({
			keys: "dra.on",
			secondaryKeys: "stat.e",
			selectiveLogic: "notAll",
			useRegex: true
		})
		expect("matchMode" in reimported).toBe(false)
		// Still a real pattern on both sides of the condition: `statue` would
		// not contain the literal text "stat.e".
		expect(
			selectiveLogicHolds(
				reimported as any,
				buildScanWindow([{ content: "a dragon and a statue" }], 1)
			)
		).toBe(false)
	})

	test("a mode the author cleared stays cleared", () => {
		// The keys are still the author's, so they travel; the mode does not
		// come back from the stale integer the import left in extraJson.
		const exported = mapEntry(row({ selectiveLogic: null }), 0)
		const reimported = mapImportedEntry(exported, WORLD_LORE_TYPE_ID, 0)
		expect(reimported.secondaryKeys).toBe("statue, mural")
		expect("selectiveLogic" in reimported).toBe(false)
	})

	test("⚠ a matchMode with no `match_whole_words` behind it does NOT survive", () => {
		// A pre-existing gap of the same family as the one the condition tests
		// close, pinned here rather than fixed because **nothing can reach it
		// today**: `matchMode` is written by this importer alone (no editor
		// binds it), and the importer only ever sets it *from* an
		// `extensions.match_whole_words` that then rides in `extraJson` and
		// carries it back out — which is the only reason the round trip above
		// holds. The moment a control writes `matchMode` on its own, the
		// exporter needs the same column-derived key the condition just got.

		const exported = mapEntry(
			row({ extraJson: {}, secondaryKeys: "", selectiveLogic: null }),
			0
		)
		expect(exported.extensions).toEqual({
			serenepub: { entryType: "world", category: "Bestiary" }
		})
		expect(
			"matchMode" in mapImportedEntry(exported, WORLD_LORE_TYPE_ID, 0)
		).toBe(false)
	})
})

describe("entryTypeIdOf", () => {
	test("defaults to world lore for entries with no serenepub marker", () => {
		expect(entryTypeIdOf({ keys: [], content: "", enabled: true })).toBe(
			WORLD_LORE_TYPE_ID
		)
	})

	test("defaults to world lore for an unrecognized entryType value", () => {
		expect(
			entryTypeIdOf({
				keys: [],
				content: "",
				enabled: true,
				extensions: { serenepub: { entryType: "something-else" } }
			})
		).toBe(WORLD_LORE_TYPE_ID)
	})

	test("routes character and history entries by their serenepub marker", () => {
		expect(
			entryTypeIdOf({
				keys: [],
				content: "",
				enabled: true,
				extensions: { serenepub: { entryType: "character" } }
			})
		).toBe(CHARACTER_LORE_TYPE_ID)
		expect(
			entryTypeIdOf({
				keys: [],
				content: "",
				enabled: true,
				extensions: { serenepub: { entryType: "history" } }
			})
		).toBe(HISTORY_TYPE_ID)
	})
})

describe("mapImportedEntry — character lore", () => {
	test("maps shared fields, with no category field (world-only)", () => {
		const mapped = mapImportedEntry(
			{
				keys: ["a"],
				content: "c",
				enabled: true,
				name: "N",
				priority: 2
			},
			CHARACTER_LORE_TYPE_ID,
			1
		)
		expect(mapped).toEqual({
			name: "N",
			content: "c",
			position: 1,
			keys: "a",
			secondaryKeys: "",
			enabled: true,
			constant: false,
			caseSensitive: false,
			useRegex: false,
			priority: 2,
			extraJson: {}
		})
	})
})

describe("mapImportedEntry — history", () => {
	test("maps year/month/day/isCompleted/graphed from extensions.serenepub, with no name/priority field", () => {
		const mapped = mapImportedEntry(
			{
				keys: ["a"],
				content: "c",
				enabled: true,
				extensions: {
					serenepub: {
						entryType: "history",
						year: 5,
						month: 3,
						day: 12,
						isCompleted: true,
						graphed: true
					}
				}
			},
			HISTORY_TYPE_ID,
			2
		)
		expect(mapped).toEqual({
			content: "c",
			position: 2,
			keys: "a",
			secondaryKeys: "",
			enabled: true,
			constant: false,
			caseSensitive: false,
			useRegex: false,
			extraJson: {},
			year: 5,
			month: 3,
			day: 12,
			isCompleted: true,
			graphed: true
		})
	})

	test("defaults year to 1 and month/day to null when missing", () => {
		const mapped = mapImportedEntry(
			{ keys: [], content: "", enabled: true },
			HISTORY_TYPE_ID,
			0
		)
		expect(mapped.year).toBe(1)
		expect(mapped.month).toBeNull()
		expect(mapped.day).toBeNull()
	})
})

describe("hasLorebookEntries", () => {
	test("true for a non-empty entries array", () => {
		expect(hasLorebookEntries({ entries: [{ keys: [] }] })).toBe(true)
	})

	test("false for an empty entries array", () => {
		expect(hasLorebookEntries({ entries: [] })).toBe(false)
	})

	test("true for legacy object-keyed-by-index entries", () => {
		expect(hasLorebookEntries({ entries: { "0": {}, "1": {} } })).toBe(true)
	})

	test("false for an empty object-keyed entries value", () => {
		expect(hasLorebookEntries({ entries: {} })).toBe(false)
	})

	test("false for a missing/null book, or a book with no entries key", () => {
		expect(hasLorebookEntries(null)).toBe(false)
		expect(hasLorebookEntries(undefined)).toBe(false)
		expect(hasLorebookEntries({})).toBe(false)
	})
})

describe("normalizeLegacyLorebookData", () => {
	test("converts legacy object-keyed-by-index entries into an array", () => {
		const result = normalizeLegacyLorebookData({
			name: "Book",
			entries: { "0": { keys: ["a"] }, "1": { keys: ["b"] } }
		})
		expect(Array.isArray(result.entries)).toBe(true)
		expect(result.entries).toHaveLength(2)
	})

	test("normalizes a singular string 'key' field into a 'keys' array", () => {
		const result = normalizeLegacyLorebookData({
			entries: [{ key: "trigger", content: "..." }]
		})
		expect(result.entries[0].keys).toEqual(["trigger"])
		expect(result.entries[0].key).toEqual(["trigger"])
	})

	test("prefers an existing 'keys' array over a singular 'key' when both are present", () => {
		const result = normalizeLegacyLorebookData({
			entries: [
				{ key: "ignored", keys: ["real", "keys"], content: "..." }
			]
		})
		expect(result.entries[0].keys).toEqual(["real", "keys"])
	})

	test("normalizes a singular string 'keysecondary' into an array", () => {
		const result = normalizeLegacyLorebookData({
			entries: [{ keys: ["a"], keysecondary: "b", content: "..." }]
		})
		expect(result.entries[0].keysecondary).toEqual(["b"])
	})

	test("leaves an already-normalized (array-shaped, array keys) lorebook untouched in structure", () => {
		const input = {
			name: "Book",
			entries: [{ keys: ["a", "b"], keysecondary: ["c"], content: "..." }]
		}
		const result = normalizeLegacyLorebookData(input)
		expect(result.entries[0].keys).toEqual(["a", "b"])
		expect(result.entries[0].keysecondary).toEqual(["c"])
	})

	test("never invents key/keysecondary fields on an entry that never had them (round-trip stability)", () => {
		// A Serene-Pub-exported entry has neither a `key` nor a `keysecondary`
		// field at all (only `keys`) — this must come back byte-identical, or
		// re-importing an unedited export would always hash differently from
		// the original and never report "unchanged".
		const input = { entries: [{ keys: ["a", "b"], content: "..." }] }
		const result = normalizeLegacyLorebookData(input)
		expect(result.entries[0]).toEqual({ keys: ["a", "b"], content: "..." })
		expect("key" in result.entries[0]).toBe(false)
		expect("keysecondary" in result.entries[0]).toBe(false)
	})

	test("passes through non-object input unchanged", () => {
		expect(normalizeLegacyLorebookData(null)).toBe(null)
		expect(normalizeLegacyLorebookData(undefined)).toBe(undefined)
	})

	test("passes through when entries is missing or not array-like", () => {
		const noEntries = { name: "Book" }
		expect(normalizeLegacyLorebookData(noEntries)).toEqual(noEntries)
	})
})

describe("resolveParentNodeLinks", () => {
	test("resolves a simple parent link", () => {
		const nodes = [{ localId: 1, parentLocalId: 2 }, { localId: 2 }]
		const realIds = new Map([
			[1, 101],
			[2, 102]
		])
		expect(resolveParentNodeLinks(nodes, realIds)).toEqual([
			{ realId: 101, parentRealId: 102 }
		])
	})

	test("drops a self-referencing node", () => {
		const nodes = [{ localId: 1, parentLocalId: 1 }]
		const realIds = new Map([[1, 101]])
		expect(resolveParentNodeLinks(nodes, realIds)).toEqual([])
	})

	test("drops a link that would create a 3rd alias level", () => {
		// 1 -> 2 -> 3: linking 1 to 2 would make 1 a grandchild of 3 once
		// 2 -> 3 is linked, since 2 already has its own parent.
		const nodes = [
			{ localId: 1, parentLocalId: 2 },
			{ localId: 2, parentLocalId: 3 },
			{ localId: 3 }
		]
		const realIds = new Map([
			[1, 101],
			[2, 102],
			[3, 103]
		])
		expect(resolveParentNodeLinks(nodes, realIds)).toEqual([
			{ realId: 102, parentRealId: 103 }
		])
	})

	test("skips links whose localId/parentLocalId never resolved to a real row", () => {
		const nodes = [{ localId: 1, parentLocalId: 99 }]
		const realIds = new Map([[1, 101]])
		expect(resolveParentNodeLinks(nodes, realIds)).toEqual([])
	})

	test("ignores nodes with no parentLocalId or malformed localId types", () => {
		const nodes = [
			{ localId: 1 },
			{ localId: 2, parentLocalId: "3" },
			{ parentLocalId: 1 }
		]
		const realIds = new Map([
			[1, 101],
			[2, 102]
		])
		expect(resolveParentNodeLinks(nodes as any, realIds)).toEqual([])
	})
})

describe("resolveAnchorEntryLinks", () => {
	const realIds = new Map([
		[1, 101],
		[2, 102],
		[3, 103]
	])

	test("resolves a parent stated by local id", () => {
		expect(
			resolveAnchorEntryLinks(
				[{ realId: 201, localId: null, anchorLocalId: 1 }],
				realIds
			)
		).toEqual([{ realId: 201, anchorRealId: 101 }])
	})

	test("nests one level under another", () => {
		expect(
			resolveAnchorEntryLinks(
				[
					{ realId: 102, localId: 2, anchorLocalId: 1 },
					{ realId: 103, localId: 3, anchorLocalId: 2 }
				],
				realIds
			)
		).toEqual([
			{ realId: 102, anchorRealId: 101 },
			{ realId: 103, anchorRealId: 102 }
		])
	})

	test("drops an entry filed under itself", () => {
		expect(
			resolveAnchorEntryLinks(
				[{ realId: 101, localId: 1, anchorLocalId: 1 }],
				realIds
			)
		).toEqual([])
	})

	test("drops both links of a cycle — neither is a tree", () => {
		expect(
			resolveAnchorEntryLinks(
				[
					{ realId: 101, localId: 1, anchorLocalId: 2 },
					{ realId: 102, localId: 2, anchorLocalId: 1 }
				],
				realIds
			)
		).toEqual([])
	})

	test("drops a parent this import never inserted", () => {
		expect(
			resolveAnchorEntryLinks(
				[{ realId: 201, localId: null, anchorLocalId: 99 }],
				realIds
			)
		).toEqual([])
	})
})

// SillyTavern's native World Info entry — its `worlds/*.json` storage shape,
// which the bulk data-directory import walks. Only the field *names* differ
// from a `character_book` entry, so this renames them and the one mapper does
// the rest; the bulk path used to carry a second copy of the whole mapping.
describe("normalizeNativeWorldInfoEntry", () => {
	const nativeEntry = (overrides: Record<string, any> = {}) => ({
		uid: 0,
		key: ["the Ashguard"],
		keysecondary: [],
		comment: "Ashguard",
		content: "An order of wardens.",
		constant: false,
		selective: false,
		order: 100,
		position: 0,
		disable: false,
		...overrides
	})

	test("renames key/disable/caseSensitive onto the names the mapper reads", () => {
		const normalized = normalizeNativeWorldInfoEntry(
			nativeEntry({ disable: true, caseSensitive: true })
		)
		expect(normalized.keys).toEqual(["the Ashguard"])
		expect(normalized.enabled).toBe(false)
		expect(normalized.case_sensitive).toBe(true)
		expect(normalized.comment).toBe("Ashguard")
	})

	test("carries the native whole-word flag through to matchModeOf", () => {
		expect(
			matchModeOf(
				normalizeNativeWorldInfoEntry(
					nativeEntry({ matchWholeWords: true })
				)
			)
		).toBe("word")
		expect(
			matchModeOf(
				normalizeNativeWorldInfoEntry(
					nativeEntry({ matchWholeWords: false })
				)
			)
		).toBe("substring")
		// null is SillyTavern's "defer to my global setting", and that global
		// never travels in the file.
		expect(
			matchModeOf(
				normalizeNativeWorldInfoEntry(
					nativeEntry({ matchWholeWords: null })
				)
			)
		).toBeUndefined()
	})

	test("does not turn ST's insertion order into a priority", () => {
		// `order` defaults to 100 in SillyTavern; clamping it into the 1-3 band
		// would read "every imported entry is maximum priority".
		expect(
			mapImportedEntry(
				normalizeNativeWorldInfoEntry(nativeEntry({ order: 100 })),
				WORLD_LORE_TYPE_ID,
				0
			).priority
		).toBe(1)
	})

	test("is strictly additive — a native name never overrides a stated one", () => {
		// `!entry.disable` on an entry that never had `disable` would read
		// `enabled: true` and quietly re-enable a disabled entry.
		expect(
			normalizeNativeWorldInfoEntry({
				keys: ["gate"],
				content: "",
				enabled: false
			} as any).enabled
		).toBe(false)
		expect(
			normalizeNativeWorldInfoEntry({
				keys: ["gate"],
				content: "",
				case_sensitive: false,
				caseSensitive: true
			} as any).case_sensitive
		).toBe(false)
	})

	test("tolerates a missing or malformed key list and body", () => {
		const normalized = normalizeNativeWorldInfoEntry({
			comment: 7,
			key: "gate"
		} as any)
		expect(normalized.keys).toEqual([])
		expect(normalized.content).toBe("")
		// A non-string comment is not a title, so the mapper's own default
		// stands rather than a number reaching a text column.
		expect(mapImportedEntry(normalized, WORLD_LORE_TYPE_ID, 0).name).toBe(
			"Imported Entry"
		)
	})

	test("leaves the foreign extensions bag for extraJson to pick up", () => {
		const normalized = normalizeNativeWorldInfoEntry(
			nativeEntry({ extensions: { probability: 80 } })
		)
		expect(
			mapImportedEntry(normalized, WORLD_LORE_TYPE_ID, 0).extraJson
		).toEqual({ probability: 80 })
	})
})

/**
 * The reader bypass (R7).
 *
 * `CharacterBook.from_json` used to stand here, and its constructor split every
 * key on `[,|;，；]`. These are the shapes it understood — kept working — and
 * the four things it filled in on the way, each of which has to still arrive.
 */
describe("parseImportedLorebook", () => {
	const entry = (keys: string[]) => ({
		keys,
		content: "An order of wardens.",
		enabled: true
	})

	test("keeps a key the card reader would have shredded", () => {
		// The defect itself: `/foo|bar/i` came back as `/foo` and `bar/i`, and
		// two half-patterns are correctly judged a literal.
		const parsed = parseImportedLorebook({
			entries: [entry(["/foo|bar/i"])]
		})
		expect(parsed.entries[0].keys).toEqual(["/foo|bar/i"])
		expect(useRegexOf(parsed.entries[0])).toBe(true)
		expect(
			mapImportedEntry(parsed.entries[0], WORLD_LORE_TYPE_ID, 0).keys
		).toBe("foo|bar")
	})

	test("reads entries from all three shapes the reader accepted", () => {
		const one = entry(["a"])
		expect(parseImportedLorebook([one]).entries).toEqual([one])
		expect(parseImportedLorebook({ entries: [one] }).entries).toEqual([one])
		expect(
			parseImportedLorebook({
				data: { character_book: { entries: [one] } }
			}).entries
		).toEqual([one])
	})

	test("an unrecognised shape is an empty book, not an error", () => {
		expect(parseImportedLorebook({}).entries).toEqual([])
		expect(parseImportedLorebook({ entries: "nonsense" }).entries).toEqual(
			[]
		)
	})

	test("a keyless entry imports rather than failing the whole book", () => {
		// One deliberate behaviour change: `_keys_fix` iterated `entry.keys`
		// unguarded, so a nested card whose entry had no key list at all threw
		// "keys is not iterable" and took the import down with it. The bulk
		// door always mapped that same entry happily, which is the divergence
		// this bypass exists to close.
		const parsed = parseImportedLorebook({
			data: { character_book: { entries: [{ content: "No keys." }] } }
		})
		const mapped = mapImportedEntry(
			parsed.entries[0],
			WORLD_LORE_TYPE_ID,
			0
		)
		expect(mapped.keys).toBe("")
		expect(mapped.useRegex).toBe(false)
		expect(mapped.content).toBe("No keys.")
	})

	test("takes name/description/extensions from the book, wherever it sits", () => {
		const bare = parseImportedLorebook({
			name: "Silverwood",
			description: "A wood of pale trees.",
			extensions: { serenepub: { bindings: [] } },
			entries: []
		})
		expect(bare.name).toBe("Silverwood")
		expect(bare.description).toBe("A wood of pale trees.")
		expect(bare.extensions).toEqual({ serenepub: { bindings: [] } })

		const nested = parseImportedLorebook({
			data: {
				character_book: {
					name: "Vera Lorebook",
					description: "",
					extensions: { serenepub: { characters: [] } },
					entries: []
				}
			}
		})
		expect(nested.name).toBe("Vera Lorebook")
		expect(nested.extensions).toEqual({ serenepub: { characters: [] } })
	})

	test("leaves name/description undefined when the file states neither", () => {
		// Not "unknown"/"" — the reader assigned over its own class defaults
		// too, and the caller's `card.name || "Imported Lorebook"` is what
		// names the row.
		const parsed = parseImportedLorebook({ entries: [] })
		expect(parsed.name).toBeUndefined()
		expect(parsed.description).toBeUndefined()
	})

	test("defaults extensions to an empty bag", () => {
		expect(parseImportedLorebook({ entries: [] }).extensions).toEqual({})
	})

	test("carries none of the reader's scan defaults", () => {
		// recursive_scanning ?? true / scan_depth ?? 10 were fabricated values
		// the file never stated; extractLorebookLevelExtraJson reads all three
		// off the raw payload instead.
		const parsed = parseImportedLorebook({
			entries: []
		}) as unknown as Record<string, unknown>
		expect(parsed.scan_depth).toBeUndefined()
		expect(parsed.recursive_scanning).toBeUndefined()
		expect(parsed.token_budget).toBeUndefined()
	})

	test("refuses a payload that is not an object", () => {
		expect(() => parseImportedLorebook(null)).toThrow()
		expect(() => parseImportedLorebook("{}" as any)).toThrow()
		expect(() => parseImportedLorebook(undefined)).toThrow()
	})

	test("does not rewrite the payload it was handed", () => {
		// The reader deep-cloned its entries so `_keys_fix` had something of
		// its own to rewrite. Nothing is rewritten now, so nothing is cloned —
		// and the payload, which is also what the conflict response hands back
		// to the client, is left exactly as it arrived.
		const data = { entries: [entry(["a|b"])] }
		const parsed = parseImportedLorebook(data)
		expect(parsed.entries[0]).toBe(data.entries[0])
		expect(data.entries[0].keys).toEqual(["a|b"])
	})
})
