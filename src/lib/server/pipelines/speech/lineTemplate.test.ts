import { describe, expect, it } from "vitest"
import {
	INFLECTION_SENTENCE_LAYOUT,
	INFLECTION_SENTENCES,
	INFLECTION_TAG_LAYOUT,
	SHIPPED_SPOKEN_LINE_TEMPLATES,
	SPEAK_DIRECTION_SOURCE,
	SPOKEN_LINE_TEMPLATE_IDS
} from "@serene-pub/core-catalog"
import { render, type Cue } from "@serene-pub/sdk"
import type { SpeechControls } from "$lib/shared/connectionAdapters/speechFacts"
import { crosswalkTag, TAG_SYNONYMS } from "./tagCrosswalk"
import {
	escapeDeep,
	escapeForTemplate,
	renderSpeechLayout,
	restoreAfterTemplate,
	spellInteger,
	spellNumbers,
	speechFilters,
	stripCode
} from "./jinja"
import { freeDirectionOf, renderDirection, renderSpokenGroup } from "./lineTemplate"

const cue = (over: Partial<Cue> & { text: string }): Cue =>
	({ kind: "narration", voice: "narrator", ...over }) as Cue

const CUES: Cue[] = [
	cue({ text: "She sighed.", kind: "narration", inflection: "sadness" as never }),
	cue({ text: "Go away!", kind: "dialogue", voice: "speaker", inflection: "anger" as never }),
	cue({ text: "(hush)", kind: "aside", voice: "silent", inflection: "joy" as never }),
	cue({ text: "He left." })
]
const speaker = { ref: "char:1", name: "Ann" }
const OPEN: SpeechControls = { tags: { syntax: "bracket", vocabulary: "open" } }
const CLOSED: SpeechControls = { tags: { syntax: "bracket", vocabulary: ["sad", "furious"] } }
const NO_TAGS: SpeechControls = {}

async function spoken(id: keyof typeof SPOKEN_LINE_TEMPLATE_IDS, controls: SpeechControls | null, cues = CUES) {
	return renderSpokenGroup({
		template: null,
		sessionTemplateId: SPOKEN_LINE_TEMPLATE_IDS[id],
		cues,
		speaker,
		voice: "speaker",
		controls
	})
}

describe("shipped line templates — golden renders", () => {
	it("whole: every voiced cue; tags open", async () => {
		expect(await spoken("whole", OPEN)).toBe("[sad] She sighed. [angry] Go away! He left.")
	})
	it("whole: tags closed vocabulary crosswalks (angry→furious) and drops what it lacks", async () => {
		expect(await spoken("whole", CLOSED)).toBe("[sad] She sighed. [furious] Go away! He left.")
		expect(
			await spoken("whole", { tags: { syntax: "bracket", vocabulary: ["zzz"] } })
		).toBe("She sighed. Go away! He left.")
	})
	it("whole: a model with no tags (or no controls) gets the bare words, never the label", async () => {
		expect(await spoken("whole", NO_TAGS)).toBe("She sighed. Go away! He left.")
		expect(await spoken("whole", null)).toBe("She sighed. Go away! He left.")
	})
	it("dialogue: only the dialogue cues", async () => {
		expect(await spoken("dialogue", OPEN)).toBe("[angry] Go away!")
		expect(await spoken("dialogue", CLOSED)).toBe("[furious] Go away!")
		expect(await spoken("dialogue", NO_TAGS)).toBe("Go away!")
	})
	it("narration: everything but dialogue (silent asides stay silent)", async () => {
		expect(await spoken("narration", OPEN)).toBe("[sad] She sighed. He left.")
		expect(await spoken("narration", CLOSED)).toBe("[sad] She sighed. He left.")
		expect(await spoken("narration", NO_TAGS)).toBe("She sighed. He left.")
	})
	it("a neutral or missing inflection writes no tag", async () => {
		const cues = [cue({ text: "A.", inflection: "neutral" as never }), cue({ text: "B." })]
		expect(await spoken("whole", OPEN, cues)).toBe("A. B.")
	})
	it("with the tag filter missing the template renders no tag and no label", () => {
		for (const t of SHIPPED_SPOKEN_LINE_TEMPLATES) {
			const out = render(t.source, { cues: CUES, controls: OPEN }).replace(/\s+/g, " ").trim()
			expect(out, t.name).not.toMatch(/\[|sad|anger|sadness/i)
		}
	})
	it("a template that falls to the default speaks the whole line", async () => {
		const out = await renderSpokenGroup({
			template: null,
			cues: CUES,
			speaker,
			voice: "speaker",
			controls: NO_TAGS
		})
		expect(out).toBe("She sighed. Go away! He left.")
	})
	it("the escape hazard: cue text containing braces comes out literally", async () => {
		const cues = [
			cue({ text: "say {{x}} and {% if 1 %}no{% endif %} and { }", inflection: "sadness" as never })
		]
		expect(await spoken("whole", OPEN, cues)).toBe("[sad] say {{x}} and {% if 1 %}no{% endif %} and { }")
	})
	it("is deterministic", async () => {
		expect(await spoken("whole", OPEN)).toBe(await spoken("whole", OPEN))
	})
})

describe("escaping", () => {
	it("round-trips and leaves no brace through the engine", () => {
		const s = "a {{b}} {%c%} } {"
		expect(escapeForTemplate(s)).not.toMatch(/[{}]/)
		expect(restoreAfterTemplate(escapeForTemplate(s))).toBe(s)
		expect(escapeDeep({ a: ["{x}", { b: "}" }], n: 1 })).toEqual({
			a: [escapeForTemplate("{x}"), { b: escapeForTemplate("}") }],
			n: 1
		})
	})
})

describe("filters", () => {
	const f = speechFilters()
	const r = (src: string, scope: Record<string, unknown>) => render(src, scope, { filters: f })
	it("exposes exactly the five speech filters", () => {
		expect(Object.keys(f).sort()).toEqual(["dialogue", "narration", "spell_numbers", "strip_code", "tag"])
	})
	it("an unknown filter yields nothing", () => {
		expect(r("[{{ a | nope }}]", { a: "x" })).toBe("[]")
	})
	it("dialogue / narration filters split a cue list", () => {
		const scope = { cues: CUES }
		expect(r("{% for c in cues | dialogue %}{{ c.text }};{% endfor %}", scope)).toBe("Go away!;")
		expect(r("{% for c in cues | narration %}{{ c.text }};{% endfor %}", scope)).toBe("She sighed.;(hush);He left.;")
	})
	it("strip_code removes fenced and inline code", () => {
		expect(stripCode("a ```x\ny``` b `c` d")).toBe("a  b  d")
		expect(r("{{ t | strip_code }}", { t: "hi `code` there" })).toBe("hi  there")
	})
	it("spell_numbers spells English numbers, leaves other languages alone", () => {
		expect(spellNumbers("3 apples")).toBe("three apples")
		expect(spellNumbers("1,200")).toBe("one thousand two hundred")
		expect(spellNumbers("-4")).toBe("minus four")
		expect(spellNumbers("2.5")).toBe("two point five")
		expect(spellNumbers("21st")).toBe("twenty-first")
		expect(spellNumbers("a1b")).toBe("a1b")
		expect(spellInteger(0)).toBe("zero")
		expect(spellInteger(-1)).toBeNull()
		expect(spellInteger(1e15)).toBeNull()
		expect(r("{{ t | spell_numbers }}", { t: "I have 3" })).toBe("I have three")
		expect(r("{{ t | spell_numbers }}", { t: "I have 3", language: "en-GB" })).toBe("I have three")
		expect(r("{{ t | spell_numbers }}", { t: "J'ai 3", language: "fr" })).toBe("J'ai 3")
	})
	it("tag filter: empty without controls.tags", () => {
		expect(r("[{{ l | tag }}]", { l: "sadness" })).toBe("[]")
		expect(r("[{{ l | tag }}]", { l: "sadness", controls: {} })).toBe("[]")
		expect(r("[{{ l | tag }}]", { l: "sadness", controls: OPEN })).toBe("[[sad]]")
		expect(r("[{{ l | tag }}]", { l: "neutral", controls: OPEN })).toBe("[]")
	})
})

describe("renderSpeechLayout", () => {
	it("falls to the shipped floor with no row, uses a selected Jinja row, ignores another engine", () => {
		expect(renderSpeechLayout(undefined, INFLECTION_TAG_LAYOUT, "joy")).toBe("[happy]")
		const row = { engine: INFLECTION_TAG_LAYOUT.engine, source: "<{{ inflectionTag }}>" }
		expect(renderSpeechLayout(row, INFLECTION_TAG_LAYOUT, "joy")).toBe("<joy>")
		const other = { engine: "core:template/liquid@1", source: "zzz" }
		expect(renderSpeechLayout(other, INFLECTION_TAG_LAYOUT, "joy")).toBe("[happy]")
	})
})

describe("tag crosswalk", () => {
	it("open vocabulary keeps core's word", () => {
		expect(crosswalkTag("happy", "joy", "open")).toBe("happy")
	})
	it("exact word wins, in the vocabulary's own case", () => {
		expect(crosswalkTag("sad", "sadness", ["Sad", "Happy"])).toBe("Sad")
	})
	it("falls through synonyms in order, then the label itself", () => {
		expect(crosswalkTag("happy", "joy", ["joyful", "excited"])).toBe("joyful")
		expect(crosswalkTag("happy", "joy", ["excited", "joyful"])).toBe("joyful")
		expect(crosswalkTag("unknownword", "joy", ["joy"])).toBe("joy")
	})
	it("returns null when nothing is close, or the vocabulary is empty or absent", () => {
		expect(crosswalkTag("happy", "joy", ["zzz"])).toBeNull()
		expect(crosswalkTag("happy", "joy", [])).toBeNull()
		expect(crosswalkTag("happy", "joy", undefined)).toBeNull()
		expect(crosswalkTag("  ", "joy", "open")).toBeNull()
	})
	it("every tag word the shipped layout can write has synonyms", () => {
		const words = new Set(
			Object.values(
				// the tag table, read back through the layout's floor
				Object.fromEntries(
					Object.keys(INFLECTION_SENTENCES).map((l) => [l, INFLECTION_TAG_LAYOUT.render(l)])
				)
			)
				.filter(Boolean)
				.map((t) => t.slice(1, -1))
		)
		for (const w of words) expect(Object.keys(TAG_SYNONYMS), w).toContain(w)
	})
})

describe("direction", () => {
	const prose: SpeechControls = { instruction: "prose" }
	const base = { prompts: { direction: SPEAK_DIRECTION_SOURCE }, controls: prose }

	it("a standard label renders its sentence (and the timbre first)", async () => {
		expect(await renderDirection({ ...base, inflection: "sadness" })).toBe(INFLECTION_SENTENCES.sadness)
		expect(await renderDirection({ ...base, inflection: "sadness", timbreDescription: "Deep voice." })).toBe(
			`Deep voice. ${INFLECTION_SENTENCES.sadness}`
		)
	})
	it("neutral directs nothing", async () => {
		expect(await renderDirection({ ...base, inflection: "neutral" })).toBeUndefined()
		expect(await renderDirection({ ...base, inflection: null })).toBeUndefined()
		expect(await renderDirection({ ...base, inflection: "neutral", timbreDescription: "Deep." })).toBe("Deep.")
	})
	it("a free label is directed as written, trailing punctuation trimmed", async () => {
		expect(await renderDirection({ ...base, inflection: "with a sigh..." })).toBe("Speak it this way: with a sigh.")
		expect(freeDirectionOf(" with a sigh!? ")).toBe("Speak it this way: with a sigh.")
		expect(freeDirectionOf("Joy")).toBe("")
		expect(freeDirectionOf("")).toBe("")
	})
	it("a model that takes no prose gets no direction", async () => {
		expect(await renderDirection({ ...base, controls: {}, inflection: "sadness" })).toBeUndefined()
		expect(await renderDirection({ ...base, controls: null, inflection: "sadness" })).toBeUndefined()
	})
	it("a custom layout returning '' for a standard label gives nothing (not the free sentence)", async () => {
		const variables = {
			inflectionSentence: {
				engine: INFLECTION_SENTENCE_LAYOUT.engine,
				variableId: INFLECTION_SENTENCE_LAYOUT.variableId,
				source: "{% if inflectionSentence.label == 'joy' %}Smile.{% endif %}"
			}
		}
		expect(await renderDirection({ ...base, inflection: "sadness", variables })).toBeUndefined()
		expect(await renderDirection({ ...base, inflection: "joy", variables })).toBe("Smile.")
	})
	it("a prompt row's own direction source is rendered; a bare string prompts works", async () => {
		expect(
			await renderDirection({ prompts: { direction: "Be {{ inflection }}." }, controls: prose, inflection: "joy" })
		).toBe("Be joy.")
		expect(await renderDirection({ prompts: "Say: {{ inflection }}", controls: prose, inflection: "joy" })).toBe(
			"Say: joy"
		)
	})
	it("braces in a timbre description come out literally", async () => {
		expect(
			await renderDirection({ ...base, inflection: "neutral", timbreDescription: "voice {{x}}" })
		).toBe("voice {{x}}")
	})
})
