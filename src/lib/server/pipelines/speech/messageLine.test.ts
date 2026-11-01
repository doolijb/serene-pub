import { describe, expect, it } from "vitest"
import { messageLineBindings, sayAsInflection, SAY_AS_MAX_CHARS, type StoredMessageLine } from "./messageLine"
import { isKnownMarker, markerInflection } from "./markers"

describe("sayAsInflection", () => {
	it("a label name is that label, case-insensitively", () => {
		expect(sayAsInflection("Joy")).toEqual({ label: "joy" })
		expect(sayAsInflection("  SADNESS ")).toEqual({ label: "sadness" })
	})
	it("a marker word maps through the marker table", () => {
		expect(sayAsInflection("angrily")).toEqual({ label: "anger" })
		expect(sayAsInflection("sighs")).toEqual({ label: "sadness" })
	})
	it("anything else is kept as written, whitespace collapsed", () => {
		expect(sayAsInflection("with a sigh")).toEqual({ label: "with a sigh" })
		expect(sayAsInflection("  with \n  a \t sigh  ")).toEqual({ label: "with a sigh" })
	})
	it("is capped at 120 characters", () => {
		const out = sayAsInflection("x".repeat(500))!
		expect(out.label.length).toBe(SAY_AS_MAX_CHARS)
		expect(SAY_AS_MAX_CHARS).toBe(120)
	})
	it("blank or non-string gives null", () => {
		for (const v of ["", "   ", "\n\t", null, undefined, 3, {}, []]) expect(sayAsInflection(v), String(v)).toBeNull()
	})
})

describe("markerInflection", () => {
	it("stems and normalises", () => {
		expect(markerInflection(" Sighs. ")).toBe("sadness")
		expect(markerInflection("laughing")).toBe(markerInflection("laugh"))
		expect(markerInflection("laugh")).not.toBeNull()
		expect(isKnownMarker("laughed")).toBe(true)
	})
	it("multi-word, blank and unknown give null", () => {
		expect(markerInflection("with a sigh")).toBeNull()
		expect(markerInflection("   ")).toBeNull()
		expect(markerInflection("qwertyuiop")).toBeNull()
	})
})

describe("core:query/message-line@1 binding", () => {
	const hook = messageLineBindings()["core:query/message-line@1"] as unknown as (
		input: unknown,
		ctx: unknown
	) => Promise<{ ok?: boolean; value?: Record<string, unknown> } & Record<string, unknown>>
	const run = async (line: StoredMessageLine | null, input: Record<string, unknown>) => {
		const r = await hook(
			{ scope: { sessionId: 1 }, messageId: 5, ...input },
			{ read: async () => line }
		)
		return (r.value ?? r) as Record<string, unknown>
	}
	const LINE: StoredMessageLine = { text: "Hello there.", speakerRef: "character:3", spriteLabel: "joy" }

	it("empty or whitespace text speaks nothing", async () => {
		expect(await run({ ...LINE, text: "" }, {})).toEqual({ main: "", text: "" })
		expect(await run({ ...LINE, text: "  \n " }, {})).toEqual({ main: "", text: "" })
		expect(await run(null, {})).toEqual({ main: "", text: "" })
	})
	it("a missing messageId speaks nothing", async () => {
		expect(await run(LINE, { messageId: undefined })).toEqual({ main: "", text: "" })
	})
	it("returns the words, speaker and the sprite label as inflection", async () => {
		expect(await run(LINE, {})).toEqual({
			main: "Hello there.",
			text: "Hello there.",
			speaker: "character:3",
			inflection: { label: "joy" }
		})
	})
	it("say beats the sprite", async () => {
		expect((await run(LINE, { say: "angrily" })).inflection).toEqual({ label: "anger" })
	})
	it("a blank say keeps the sprite", async () => {
		expect((await run(LINE, { say: "   " })).inflection).toEqual({ label: "joy" })
	})
	it("neither say nor sprite: no inflection port; no speaker: no speaker port", async () => {
		const out = await run({ text: "Hi.", speakerRef: null, spriteLabel: null }, {})
		expect(out).toEqual({ main: "Hi.", text: "Hi." })
		expect("inflection" in out).toBe(false)
		expect("speaker" in out).toBe(false)
	})
})
