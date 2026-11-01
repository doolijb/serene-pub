import { describe, expect, it } from "vitest"
import { cueLines, castNamesOf, parseQuoteStyle, emphasisOf, LOCALE_QUOTE_STYLES } from "./cueLines"
import { markerInflection, isKnownMarker } from "./markers"

const texts = (s: string, o: Record<string, unknown> = {}) =>
	cueLines({ text: s, ...o }).map((c) => [c.kind, c.text])

describe("cueLines — asterisks inside a quote (owner report 2026-10-29)", () => {
	it("keeps *emphasis* inside an open quote with the speaker as ONE dialogue cue", () => {
		expect(texts('"this one speech *while this is narrated seperately* and this is a third"')).toEqual([
			["dialogue", "this one speech while this is narrated seperately and this is a third"]
		])
	})
	it("still opens an action cue for asterisks outside a quote", () => {
		expect(texts('"Stay," she said. *She sits.* "Please."')).toEqual([
			["dialogue", "Stay,"],
			["narration", "she said."],
			["action", "She sits."],
			["dialogue", "Please."]
		])
	})
	it("underscores inside a quote stay with the speaker too", () => {
		expect(texts('"I _really_ mean it."')).toEqual([["dialogue", "I really mean it."]])
	})
})

describe("cueLines — quote styles", () => {
	it("splits straight quotes into narration and dialogue", () => {
		expect(texts('He said "Hello there!" and left.')).toEqual([
			["narration", "He said"],
			["dialogue", "Hello there!"],
			["narration", "and left."]
		])
	})
	it("reads curly, single, guillemet and CJK quote styles", () => {
		const r = texts("She said “Hi” then ‘there’ and «bonjour» and 「こんにちは」。")
		const dialogue = r.filter((c) => c[0] === "dialogue").map((c) => c[1])
		expect(dialogue).toEqual(["Hi", "there", "bonjour", "こんにちは"])
	})
	it("keeps an apostrophe inside ‘…’ as part of the quote", () => {
		expect(texts("‘I can’t believe it’, he said.")[0]).toEqual(["dialogue", "I can’t believe it"])
	})
	it("ends an unclosed quote at a blank line", () => {
		expect(texts('He said "unclosed quote\n\nNarration after.')).toEqual([
			["narration", "He said"],
			["dialogue", "unclosed quote"],
			["narration", "Narration after."]
		])
	})
	it("does not treat a bare straight apostrophe pair as a default quote style", () => {
		expect(texts("He said 'hi' there")).toEqual([["narration", "He said 'hi' there"]])
	})
	it("a configured quoteStyles replaces the default", () => {
		expect(texts('say "no" and |yes|', { quoteStyles: ["||"] })).toEqual([
			["narration", 'say "no" and'],
			["dialogue", "yes"]
		])
	})
	it("adds the locale quote styles of the language", () => {
		expect(LOCALE_QUOTE_STYLES.de).toContain("„“")
		expect(texts("Er sagte „Hallo“ leise.", { language: "de" }).map((c) => c[0])).toContain("dialogue")
	})
	it("parseQuoteStyle halves entries by code point", () => {
		expect(parseQuoteStyle('""')).toEqual({ open: '"', close: '"' })
		expect(parseQuoteStyle("「」")).toEqual({ open: "「", close: "」" })
		expect(parseQuoteStyle("")).toBeNull()
	})
})

describe("cueLines — asterisks and asides", () => {
	const line = "She *waves* at him."
	it("action: *…* is an action cue", () => {
		expect(texts(line, { asterisks: "action" })).toEqual([
			["narration", "She"],
			["action", "waves"],
			["narration", "at him."]
		])
	})
	it("emphasis and ignore read the words inline in one cue", () => {
		for (const asterisks of ["emphasis", "ignore"])
			expect(texts(line, { asterisks })).toEqual([["narration", "She waves at him."]])
	})
	it("an unknown asterisks mode falls back to action", () => {
		expect(texts(line, { asterisks: "bogus" })).toEqual(texts(line, { asterisks: "action" }))
	})
	it("nested asides are counted to the matching close", () => {
		expect(texts("He (quietly (very quietly) muttered) left.")).toEqual([
			["narration", "He"],
			["aside", "quietly (very quietly) muttered"],
			["narration", "left."]
		])
	})
	it("aside cues are silent by default", () => {
		const c = cueLines({ text: "He (quietly) left." }).find((x) => x.kind === "aside")!
		expect(c.voice).toBe("silent")
	})
	it("voices override per kind and ignore unknown values", () => {
		const c = cueLines({ text: 'a "b"', voices: { dialogue: "narrator", narration: "bogus" as never } })
		expect(c.map((x) => x.voice)).toEqual(["narrator", "narrator"])
	})
})

describe("cueLines — script lines", () => {
	it("Name: lines switch the speaker for the following cues", () => {
		const cues = cueLines({ text: "Alice: Hello there\nBob: Hi back", cast: ["Alice", "Bob"] })
		expect(cues.map((c) => [c.kind, c.text, c.speaker])).toEqual([
			["dialogue", "Hello there", "Alice"],
			["dialogue", "Hi back", "Bob"]
		])
	})
	it("bold **Name:** also switches the speaker", () => {
		const cues = cueLines({ text: '**Alice:** "Hi" she said', cast: ["Alice"] })
		expect(cues[0]).toMatchObject({ kind: "dialogue", text: "Hi", speaker: "Alice" })
	})
	it("a name not in the cast is not a speaker switch", () => {
		const cues = cueLines({ text: "Zed: Hello there", cast: ["Alice"] })
		expect(cues.every((c) => c.speaker === undefined)).toBe(true)
	})
})

describe("cueLines — markers", () => {
	it("lifts markers off the text and labels the cue", () => {
		const cues = cueLines({ text: "<sigh> Fine. [angry] No! (((laugh))) ok" })
		expect(cues).toHaveLength(1)
		expect(cues[0]!.text).toBe("Fine. No! ok")
		expect(cues[0]!.markers).toEqual(["sigh", "angry", "laugh"])
		expect(cues[0]!.inflection).toBe("sadness")
	})
	it("*sighs* is a marker, not an action, when the table knows it", () => {
		const cues = cueLines({ text: "Hello *sighs* and *big wind blows*" })
		expect(cues.find((c) => c.markers?.includes("sighs"))?.inflection).toBe("sadness")
		expect(cues.some((c) => c.kind === "action" && c.text === "big wind blows")).toBe(true)
	})
	it("an unknown multi-word marker is lifted but unlabelled", () => {
		const cues = cueLines({ text: 'a [sighs heavily] b "c"' })
		expect(cues[0]).toMatchObject({ text: "a b", markers: ["sighs heavily"] })
		expect(cues[0]!.inflection).toBeUndefined()
	})
	it("a marker's label beats the line's inflection; the line's fills the rest", () => {
		expect(cueLines({ text: "[angry] Go.", inflection: "joy" })[0]!.inflection).toBe("anger")
		expect(cueLines({ text: "Hello.", inflection: "joy" })[0]!.inflection).toBe("joy")
		expect(cueLines({ text: "Hello.", inflection: { label: "anger" } })[0]!.inflection).toBe("anger")
	})
	it("a marker alone with no words gives no cues", () => {
		expect(cueLines({ text: "[sighs]" })).toEqual([])
	})
	it("marker table stems verb endings and the label names themselves", () => {
		for (const [m, label] of [
			["sigh", "sadness"],
			["sighs", "sadness"],
			["sighing", "sadness"],
			["Sighed.", "sadness"],
			["angry", "anger"],
			["joy", "joy"]
		] as const)
			expect(markerInflection(m), m).toBe(label)
		expect(markerInflection("sighs heavily")).toBeNull()
		expect(markerInflection("")).toBeNull()
		expect(isKnownMarker("blorp")).toBe(false)
		expect(isKnownMarker("sigh")).toBe(true)
	})
})

describe("cueLines — code, emphasis, CJK, determinism", () => {
	it("drops fenced and inline code", () => {
		expect(texts("```js\ncode\n```\nHello `x` world.")).toEqual([["narration", "Hello world."]])
		expect(cueLines({ text: "```\nonly code\n```" })).toEqual([])
	})
	it("flattens markdown bold, headings and links to their words", () => {
		expect(texts("# Title\n**bold** and [a link](http://x.y)")[0]![1]).toBe("Title bold and a link")
	})
	it("emphasis is the cue's final ! ? …", () => {
		expect(emphasisOf("What?")).toBe("?")
		expect(emphasisOf('Stop!"')).toBe("!")
		expect(emphasisOf("Well...")).toBe("…")
		expect(emphasisOf("Well…")).toBe("…")
		expect(emphasisOf("Fine.")).toBeUndefined()
		expect(cueLines({ text: 'He cried "Stop!"' }).at(-1)!.emphasis).toBe("!")
	})
	it("reads a Japanese line with 「…」 quotes", () => {
		expect(texts("日本語の文章です。「こんにちは」と言った。", { language: "ja" })).toEqual([
			["narration", "日本語の文章です。"],
			["dialogue", "こんにちは"],
			["narration", "と言った。"]
		])
	})
	it("empty / non-string text gives no cues", () => {
		expect(cueLines({ text: "" })).toEqual([])
		expect(cueLines({ text: undefined as never })).toEqual([])
		expect(cueLines({ text: "   \n " })).toEqual([])
	})
	it("is deterministic", () => {
		const input = {
			text: 'Alice: "Hi!" *waves* (aside) <sigh> and 「x」',
			cast: ["Alice"],
			inflection: "joy"
		}
		expect(cueLines(input)).toEqual(cueLines(structuredClone(input)))
	})
})

describe("castNamesOf", () => {
	it("accepts string[], dedupes, trims, drops blanks", () => {
		expect(castNamesOf([" Ann ", "Ann", "", "Bo"])).toEqual(["Ann", "Bo"])
	})
	it("accepts a session cast with seats, nicknames and aliases", () => {
		const cast = {
			sessionCharacters: [
				{ character: { name: "Ann", nickname: "A", aliases: ["Annie"] } },
				{ enabled: false, character: { name: "Off" } },
				{ removedAt: "x", character: { name: "Gone" } }
			],
			sessionPersonas: [{ seatName: "Player", persona: { name: "Pat" } }, { removedAt: "x", seatName: "Left" }]
		}
		expect(castNamesOf(cast)).toEqual(["Ann", "A", "Annie", "Player", "Pat"])
	})
	it("accepts a settings document carrying .cast, and objects with name / character", () => {
		expect(castNamesOf({ cast: ["X"] })).toEqual(["X"])
		expect(castNamesOf([{ name: "N" }, { character: { name: "C" } }])).toEqual(["N", "C"])
	})
	it("null and junk give []", () => {
		expect(castNamesOf(null)).toEqual([])
		expect(castNamesOf(42)).toEqual([])
	})
})
