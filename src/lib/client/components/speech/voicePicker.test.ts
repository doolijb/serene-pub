import { describe, expect, it } from "vitest"
import type { SpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"
import {
	filterVoices,
	labelLine,
	originLine,
	voiceFacets,
	voicesFromFacts,
	voicesFromPickable,
	type PickerVoice
} from "./voicePicker"
import {
	draftOf,
	draftProblem,
	draftToInput,
	loadoutModelLine,
	emptyDraft,
	consequenceLine,
	shutsDownLine,
	speechFactsOfRow
} from "./voicebankRows"
import type { VoicebankVoiceView } from "$lib/shared/speech/voicebank"

const V: PickerVoice[] = [
	{ key: "a1", name: "Aria", language: "en", labels: { gender: "female", accent: "British" } },
	{ key: "b2", name: "Bruno", language: "en", labels: { gender: "male", accent: "British" } },
	{ key: "c3", name: "Chloé", language: "fr", labels: { gender: "female" } }
]

describe("voiceFacets", () => {
	it("draws a facet only for labels with two or more distinct values", () => {
		const keys = voiceFacets(V).map((f) => f.key)
		expect(keys).toContain("language")
		expect(keys).toContain("gender")
		expect(keys).not.toContain("accent") // one value only
		expect(keys).not.toContain("age") // nobody carries it
	})
	it("counts values, most common first", () => {
		const lang = voiceFacets(V).find((f) => f.key === "language")!
		expect(lang.values).toEqual([
			{ value: "en", count: 2 },
			{ value: "fr", count: 1 }
		])
	})
	it("an empty or one-voice list has no facets", () => {
		expect(voiceFacets([])).toEqual([])
		expect(voiceFacets(V.slice(0, 1))).toEqual([])
	})
})

describe("filterVoices", () => {
	it("an empty query and filter keeps everything (the 'N of M' is length of both)", () => {
		expect(filterVoices(V, "", {})).toHaveLength(3)
		expect(filterVoices(V, "  ", { gender: "" })).toHaveLength(3)
	})
	it("matches the name, key, language and labels, case-insensitively", () => {
		expect(filterVoices(V, "ARIA", {}).map((v) => v.key)).toEqual(["a1"])
		expect(filterVoices(V, "b2", {}).map((v) => v.key)).toEqual(["b2"])
		expect(filterVoices(V, "fr", {}).map((v) => v.key)).toEqual(["c3"])
		expect(filterVoices(V, "british", {}).map((v) => v.key)).toEqual(["a1", "b2"])
		expect(filterVoices(V, "nobody", {})).toEqual([])
	})
	it("facet filters narrow, and combine with the query", () => {
		expect(filterVoices(V, "", { gender: "female" }).map((v) => v.key)).toEqual(["a1", "c3"])
		expect(filterVoices(V, "", { gender: "female", language: "en" }).map((v) => v.key)).toEqual(["a1"])
		expect(filterVoices(V, "chlo", { gender: "male" })).toEqual([])
	})
})

describe("voice lists", () => {
	const facts = {
		voices: [
			{ id: "alloy", name: "Alloy", kind: "preset", language: "en", labels: { gender: "female" }, previewUrl: "u" },
			{ id: "mine", name: "My clone", kind: "clone" }
		],
		voicesFrom: "discovered",
		controls: {},
		streams: false,
		formats: ["wav"]
	} as SpeechFacts
	it("service voices keep their kind (clones are read-only) and preview", () => {
		const v = voicesFromFacts(facts)
		expect(v.map((x) => [x.key, x.kind])).toEqual([
			["alloy", "preset"],
			["mine", "clone"]
		])
		expect(v[0]).toMatchObject({ language: "en", previewUrl: "u", labels: { gender: "female" } })
		expect(v[1]!.language).toBeNull()
		expect(voicesFromFacts(null)).toEqual([])
	})
	it("voicebank entries are keyed by slug", () => {
		const v = voicesFromPickable([{ name: "Bruno", slug: "bruno", language: "en", labels: { age: "old" } }])
		expect(v).toEqual([{ key: "bruno", name: "Bruno", language: "en", labels: { age: "old" } }])
		expect(voicesFromPickable(undefined)).toEqual([])
	})
	it("origin line and label line", () => {
		for (const o of ["discovered", "catalogue", "typed", "voicebank"] as const)
			expect(originLine(o), o).toEqual(expect.any(String))
		expect(originLine(null)).toBeNull()
		expect(labelLine({ language: "en", labels: { gender: "female", useCase: "news" } })).toBe("en · female · news")
		expect(labelLine({})).toBe("")
	})
})

describe("voicebank rows", () => {
	const row = {
		id: 1,
		slug: "bruno",
		name: "Bruno",
		description: null,
		owner: "pub",
		seedKey: null,
		loadoutId: 3,
		loadoutName: "Narration",
		connectionModelId: 7,
		voiceId: "v1",
		language: "en",
		settings: { speed: 1.2, stability: 0.4 },
		labels: { gender: "male" },
		enabled: true,
		unusableReason: null,
		createdAt: "",
		updatedAt: ""
	} as VoicebankVoiceView
	it("consequence line: unusable > off > normal", () => {
		expect(consequenceLine({ ...row, unusableReason: "gone" })).toContain("gone")
		expect(consequenceLine({ ...row, enabled: false })).toMatch(/off/i)
		expect(consequenceLine(row)).toMatch(/name/i)
	})
	it("draft problems", () => {
		const e = emptyDraft(3)
		expect(draftProblem(emptyDraft())).toMatch(/name/i)
		expect(draftProblem({ ...e, name: "x", loadoutId: null })).toMatch(/loadout/i)
		expect(draftProblem({ ...e, name: "x" })).toMatch(/voice/i)
		expect(draftProblem({ ...e, name: "x", voiceId: "v" })).toBeNull()
		// A voice-designing model: the description is the voice, no id needed.
		expect(draftProblem({ ...e, name: "x" }, { designsVoice: true })).toMatch(/describe/i)
		expect(
			draftProblem({ ...e, name: "x", voice: { ...e.voice, description: "warm" } }, { designsVoice: true })
		).toBeNull()
		expect(draftProblem({ ...e, name: "  ", voiceId: "v" })).not.toBeNull()
	})
	it("an edit keeps the settings the form does not edit; null speed removes speed", () => {
		const d = draftOf(row)
		expect(d.loadoutId).toBe(3)
		expect(draftToInput(d, row).settings).toEqual({ speed: 1.2, stability: 0.4 })
		expect(draftToInput({ ...d, voice: { ...d.voice, speed: null } }, row).settings).toEqual({ stability: 0.4 })
		expect(draftToInput({ ...d, voice: { ...d.voice, speed: 2 } }, row).settings).toEqual({ speed: 2, stability: 0.4 })
	})
	it("a create payload trims, nulls blanks and sends the loadout", () => {
		const d = emptyDraft(9)
		const input = draftToInput({ ...d, name: " N ", voiceId: " v ", voice: { ...d.voice, description: " " } })
		expect(input).toEqual({
			name: "N",
			description: null,
			loadoutId: 9,
			voiceId: "v",
			language: null,
			settings: {},
			labels: {},
			enabled: true
		})
	})
	it("labels are trimmed and blanks dropped; the entry's try carries its loadout", () => {
		const d = { ...emptyDraft(9), name: "N", voiceId: "v", labels: { gender: " female ", accent: "" } }
		expect(draftToInput(d).labels).toEqual({ gender: "female" })
		expect(requestOfEntry({ ...row, loadoutId: 3 }).loadoutId).toBe(3)
		expect(loadoutModelLine({ filled: false, modelName: null, connectionName: null })).toBe("no model yet")
		expect(loadoutModelLine({ filled: true, modelName: "Kokoro", connectionName: "KoboldCPP" })).toBe("Kokoro on KoboldCPP")
	})
	it("shuts-down line and defensive facts read", () => {
		expect(shutsDownLine(null)).toBeNull()
		expect(shutsDownLine({ deprecatedOn: "2027-01-06" } as SpeechFacts)).toBe("Shuts down 2027-01-06")
		expect(speechFactsOfRow(null)).toBeNull()
		expect(speechFactsOfRow({})).toBeNull()
	})
})

import { COMPACT_NONE, compactOptions } from "./voicePicker"
import { requestOfEntry, sortVoices, voiceChips } from "./voicebankRows"

describe("compact picker rows and voicebank row helpers", () => {
	const pv = (key: string, name: string, language: string | null = null): PickerVoice => ({ key, name, language, labels: {} })
	it("compactOptions: none row first, voices after, a stale value kept as set", () => {
		const rows = compactOptions([pv("a", "Anna", "en")], "gone", { label: "Pub default" })
		expect(rows.map((r) => r.value)).toEqual([COMPACT_NONE, "a", "gone"])
		expect(rows[1].hint).toBe("en")
		expect(rows[2].hint).toMatch(/kept as set/)
		expect(compactOptions([pv("a", "Anna")], "a").map((r) => r.value)).toEqual(["a"])
	})
	it("sortVoices orders by name, case-blind, ties by slug, without mutating", () => {
		const input = [
			{ name: "zed", slug: "z" },
			{ name: "Amy", slug: "b" },
			{ name: "amy", slug: "a" }
		]
		expect(sortVoices(input).map((v) => v.slug)).toEqual(["a", "b", "z"])
		expect(input[0].slug).toBe("z")
	})
	it("voiceChips shows only what is set", () => {
		expect(voiceChips({ language: null, settings: {} })).toEqual([])
		expect(voiceChips({ language: "en", settings: { seed: 355260212, speed: 1.2 } })).toEqual(["en", "seed 355260212", "speed 1.2"])
		expect(voiceChips({ language: null, settings: { speed: 0 } })).toEqual(["speed 0"])
	})
	it("requestOfEntry carries the saved entry and leaves the seed to the try-out", () => {
		expect(requestOfEntry({ voiceId: " v ", description: null, language: null, settings: { speed: 1, seed: 5 } })).toEqual({
			voiceId: "v",
			description: "",
			language: "",
			settings: { speed: 1 }
		})
	})
})
