import { describe, expect, it } from "vitest"
import type { Cue } from "@serene-pub/sdk"
import { cueMapOf, groupCues, MIN_GROUP_WORDS } from "./dispatchSpeech"

const cue = (over: Partial<Cue> & { text: string }): Cue =>
	({ kind: "dialogue", voice: "speaker", ...over }) as Cue

describe("groupCues", () => {
	it("merges consecutive cues with the same voice, speaker, inflection and language", () => {
		const g = groupCues([cue({ text: "a" }), cue({ text: "b" })], { lineSpeaker: "char:1" })
		expect(g).toHaveLength(1)
		expect(g[0]).toMatchObject({ voice: "speaker", speakerRef: "char:1", indexes: [0, 1] })
	})
	it("splits on narrator/speaker and on inflection change", () => {
		const g = groupCues(
			[
				// Three words each: a shorter cue folds into its neighbour (MIN_GROUP_WORDS).
				cue({ text: "n n n", kind: "narration", voice: "narrator" }),
				cue({ text: "s s s" }),
				cue({ text: "t t t", inflection: "joy" })
			],
			{ lineSpeaker: "char:1" }
		)
		expect(g.map((x) => [x.voice, x.inflection])).toEqual([
			["narrator", null],
			["speaker", null],
			["speaker", "joy"]
		])
		expect(g[0]!.speakerRef).toBeNull()
	})
	it("folds neutral and blank inflections to null (same group)", () => {
		const g = groupCues([cue({ text: "a", inflection: "neutral" }), cue({ text: "b", inflection: " " })], {
			lineSpeaker: null
		})
		expect(g).toHaveLength(1)
		expect(g[0]!.inflection).toBeNull()
	})
	it("leaves silent and empty cues out but keeps indexes into the script", () => {
		const g = groupCues(
			[cue({ text: "a" }), cue({ text: "x", voice: "silent" }), cue({ text: "  " }), cue({ text: "b" })],
			{ lineSpeaker: null }
		)
		expect(g).toHaveLength(1)
		expect(g[0]!.indexes).toEqual([0, 3])
	})
	it("a Name: cue speaks as that cast member; unknown names use the line speaker", () => {
		const g = groupCues(
			[cue({ text: "a", speaker: "Bob" }), cue({ text: "b", speaker: "Nobody" })],
			{
				lineSpeaker: "char:1",
				refOfName: (n) => (n === "Bob" ? { ref: "char:2", name: "Bob" } : null)
			}
		)
		expect(g.map((x) => [x.speakerRef, x.speakerName])).toEqual([
			["char:2", "Bob"],
			["char:1", undefined]
		])
	})
	it("carries the language, lower-cased, and splits on it", () => {
		const g = groupCues([cue({ text: "a" })], { lineSpeaker: null, language: " EN " })
		expect(g[0]!.language).toBe("en")
	})
	it("a narrator group inside a line carries the line's speaker as lineSpeakerRef; plain narration does not", () => {
		const n = { kind: "narration", voice: "narrator" } as const
		const inLine = groupCues([cue({ ...n, text: "a" })], { lineSpeaker: "char:1" })
		expect(inLine[0]).toMatchObject({ voice: "narrator", speakerRef: null, lineSpeakerRef: "char:1" })
		const plain = groupCues([cue({ ...n, text: "a" })], { lineSpeaker: null })
		expect(plain[0]).not.toHaveProperty("lineSpeakerRef")
		const dlg = groupCues([cue({ text: "a" })], { lineSpeaker: "char:1" })
		expect(dlg[0]).not.toHaveProperty("lineSpeakerRef")
	})
})

describe("cueMapOf", () => {
	it("keeps each cue's words on its span, so the spoken line can caption the cue playing", () => {
		const groups = [
			{ indexes: [0, 1], cues: [cue({ text: " Hello. " }), cue({ text: "Come in." })] },
			{ indexes: [2], cues: [cue({ text: "" })] }
		]
		const map = cueMapOf(groups, [{ startMs: 0, endMs: 900 }, { startMs: 900, endMs: 1500 }], "concatenated")
		expect(map.spans).toEqual([
			{ cue: 0, startMs: 0, endMs: 900, text: "Hello." },
			{ cue: 1, startMs: 0, endMs: 900, text: "Come in." },
			{ cue: 2, startMs: 900, endMs: 1500 }
		])
	})
	it("groups without cues (older callers) still map, with no text", () => {
		const map = cueMapOf([{ indexes: [0] }], [{ startMs: 0, endMs: 10 }], "concatenated")
		expect(map.spans).toEqual([{ cue: 0, startMs: 0, endMs: 10 }])
	})
})

describe("tiny groups fold into a same-voice neighbour (owner report 2026-10-29)", () => {
	const cue = (text: string, voice: "speaker" | "narrator", inflection?: string): Cue =>
		({ kind: voice === "narrator" ? "narration" : "dialogue", text, voice, inflection, markers: [] }) as never
	it('"Or," alone between two narration cues of the narrator joins the previous group', () => {
		const groups = groupCues(
			[cue("She paused at the door.", "narrator"), cue("Or,", "narrator", "sadness"), cue("so it seemed.", "narrator")],
			{ lineSpeaker: "character:1" }
		)
		expect(groups).toHaveLength(1)
		expect(groups[0]!.cues.map((c) => c.text)).toEqual(["She paused at the door.", "Or,", "so it seemed."])
		expect(groups[0]!.inflection).toBeNull()
	})
	it("a one-word dialogue fragment folds forward when the previous group is another voice", () => {
		const groups = groupCues(
			[cue("He waited.", "narrator"), cue("No.", "speaker"), cue("I will not go there again.", "speaker")],
			{ lineSpeaker: "character:1" }
		)
		expect(groups.map((g) => [g.voice, g.cues.map((c) => c.text).join(" ")])).toEqual([
			["narrator", "He waited."],
			["speaker", "No. I will not go there again."]
		])
	})
	it("a fragment with no same-voice neighbour stays its own group", () => {
		const groups = groupCues([cue("He waited.", "narrator"), cue("No.", "speaker")], { lineSpeaker: "character:1" })
		expect(groups).toHaveLength(2)
	})
	it("MIN_GROUP_WORDS is three", () => expect(MIN_GROUP_WORDS).toBe(3))
})
