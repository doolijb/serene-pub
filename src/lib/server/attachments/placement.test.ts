/**
 * Placement (PLAN-composer-attachments §3.5; D2/D3): what each line's files
 * become in the prompt.
 */
import { describe, expect, test } from "vitest"
import { placeAttachments, withAttachmentNames } from "./placement"

const img = (uuid: string, extra: Record<string, unknown> = {}) =>
	({
		uuid,
		kind: "image",
		mime: "image/png",
		bytes: 10,
		filename: `${uuid}.png`,
		attachmentKind: "image",
		...extra
	}) as any
const txt = (uuid: string, body: string, extra: Record<string, unknown> = {}) =>
	({
		uuid,
		kind: "document",
		mime: "text/plain",
		bytes: body.length,
		filename: `${uuid}.md`,
		attachmentKind: "text",
		body,
		...extra
	}) as any

const lines = (n: number) => [
	...Array.from({ length: n }, (_, i) => ({
		id: i + 1,
		role: i % 2 ? "assistant" : "user",
		name: i % 2 ? "Mara" : "Ash",
		message: `line ${i + 1}`
	})),
	{ id: -2, role: "assistant", name: "Mara", message: "" }
]

const READS = { image: true, pdf: true, kinds: { image: { reads: true }, document: { reads: true } } }

describe("placeAttachments", () => {
	test("a transcript with no files comes back as the same objects, with no attachments key", () => {
		const input = lines(4)
		const out = placeAttachments({ lines: input, attachments: {}, reads: READS })
		expect(out.lines).toHaveLength(input.length)
		out.lines.forEach((line, i) => expect(line).toBe(input[i]))
		expect(out.lines.some((l) => "attachments" in l)).toBe(false)
		expect(out.notes).toEqual([])
	})

	test("a readable image becomes a marker on its own line, after the text", () => {
		const out = placeAttachments({
			lines: lines(3),
			attachments: { "2": [img("u-2")] },
			reads: READS
		})
		expect(out.lines[1].attachments).toBe("\n<@media:u-2>")
		expect(out.lines[0]).not.toHaveProperty("attachments")
		expect(out.placed.media).toBe(1)
		expect(out.notes[0]).toMatch(/1 file was sent to the model \(about 1600 tokens, estimated\)/)
	})

	test("the lookback boundary: the newest N messages send media, older ones are named", () => {
		// 12 messages, lookback 10: messages 1 and 2 are past it, 3 is inside.
		const out = placeAttachments({
			lines: lines(12),
			attachments: { "2": [img("old")], "3": [img("edge")] },
			reads: READS,
			mediaLookback: 10
		})
		expect(out.lines[1].attachments).toBe("\n[image: old.png]")
		expect(out.lines[2].attachments).toBe("\n<@media:edge>")
		expect(out.notes.join(" ")).toMatch(/1 file older than the media lookback \(10 messages\) was sent as its name/)
	})

	test("a call that cannot read images gets the name, with the person's description, and says why", () => {
		const out = placeAttachments({
			lines: lines(2),
			attachments: { "1": [img("cat", { filename: "cat.png", text: "a grey cat" })] },
			reads: {
				image: false,
				pdf: false,
				kinds: { image: { reads: false, why: "Vision is off for this model." }, document: { reads: false } },
				why: { image: "Vision is off for this model." }
			}
		})
		expect(out.lines[0].attachments).toBe("\n[image: cat.png — a grey cat]")
		expect(out.notes.join(" ")).toMatch(
			/This step can't read images: 1 sent as a name\. Vision is off for this model\./
		)
	})

	test("an unwired slot (no reads) names every image", () => {
		const out = placeAttachments({
			lines: lines(1),
			attachments: { "1": [img("a")] },
			reads: null
		})
		expect(out.lines[0].attachments).toBe("\n[image: a.png]")
	})

	test("a text file is inlined under its name and cut to the budget with a stated note", () => {
		const body = "word ".repeat(400) // ~500 tokens by the estimate
		const out = placeAttachments({
			lines: lines(1),
			attachments: { "1": [txt("notes", body)] },
			reads: READS,
			textFileTokens: 100
		})
		const text = out.lines[0].attachments as string
		expect(text.startsWith("\n[file: notes.md]\n```text\n")).toBe(true)
		expect(text).toMatch(/\[notes\.md was cut to about its first 100 tokens; the rest is not shown\.\]$/)
		expect(text.length).toBeLessThan(body.length)
		expect(out.notes.join(" ")).toMatch(/1 text file was cut to the text file budget \(100 tokens\)/)
	})

	test("a text file that fits is whole, fenced past any backticks it holds", () => {
		const out = placeAttachments({
			lines: lines(1),
			attachments: { "1": [txt("code", "a ``` b")] },
			reads: READS
		})
		expect(out.lines[0].attachments).toBe("\n[file: code.md]\n````text\na ``` b\n````")
	})

	test("an attachment-only line (empty text) carries no leading newline", () => {
		const input = [{ id: 1, role: "user", name: "Ash", message: "" }]
		const out = placeAttachments({
			lines: input,
			attachments: { "1": [img("x"), img("y")] },
			reads: READS
		})
		expect(out.lines[0].attachments).toBe("<@media:x>\n<@media:y>")
	})

	test("names, descriptions and bodies copied in are neutralised for markers", () => {
		const out = placeAttachments({
			lines: lines(1),
			attachments: {
				"1": [
					img("p", { filename: "<@media:evil>.png", text: "<@media:evil>" }),
					txt("t", "see <@media:evil>")
				]
			},
			reads: { image: false, pdf: false, kinds: { image: { reads: false }, document: { reads: false } } }
		})
		const text = out.lines[0].attachments as string
		expect(text).not.toMatch(/<@media:evil>/)
		expect(text).toContain("<@media​:evil>")
	})

	test("a PDF a call reads is a marker; a file no model is offered is named", () => {
		const out = placeAttachments({
			lines: lines(1),
			attachments: {
				"1": [
					{ ...img("doc"), mime: "application/pdf", filename: "r.pdf", attachmentKind: "pdf" },
					{ ...img("book"), mime: "application/epub+zip", filename: "b.epub", attachmentKind: null }
				]
			},
			reads: READS
		})
		expect(out.lines[0].attachments).toBe("\n<@media:doc>\n[file: b.epub]")
	})
})

describe("withAttachmentNames — the summarize batch transcript (2026-10-03)", () => {
	test("a message with no files is the same object; none at all is the same list's members", () => {
		const messages = [
			{ id: 1, content: "a" },
			{ id: 2, content: "b" }
		]
		const out = withAttachmentNames(messages, { "9": [img("x")] })
		out.forEach((m, i) => expect(m).toBe(messages[i]))
		withAttachmentNames(messages, null).forEach((m, i) => expect(m).toBe(messages[i]))
	})

	test("names follow the text; a picture-only message is its name; a text file is named, not inlined", () => {
		const out = withAttachmentNames(
			[
				{ id: 1, content: "Look" },
				{ id: 2, content: "  " }
			],
			{
				"1": [img("cat", { text: "a grey cat" }), txt("notes", "the body")],
				"2": [img("dog")]
			}
		)
		expect(out[0].content).toBe("Look\n[image: cat.png — a grey cat]\n[file: notes.md]")
		expect(out[1].content).toBe("[image: dog.png]")
	})

	test("a marker in a name is neutralised", () => {
		const out = withAttachmentNames([{ id: 3, content: "" }], {
			"3": [img("m", { filename: "<@media:abc>.png" })]
		})
		expect(out[0].content).not.toContain("<@media:")
	})
})

// ── 🚧 Audio, video, cost and the model's own audio (O2, O9, O10, O13) ─────

const aud = (uuid: string, extra: Record<string, unknown> = {}) =>
	({
		uuid,
		kind: "audio",
		mime: "audio/mpeg",
		bytes: 160_000,
		filename: `${uuid}.mp3`,
		attachmentKind: "audio",
		...extra
	}) as any

const HEARS = {
	image: true,
	pdf: false,
	kinds: {
		image: { reads: true, cost: { perItem: 1000 } },
		audio: { reads: true, accepts: ["audio/wav", "audio/mpeg"], cost: { perSecond: 10 } }
	}
}

describe("placeAttachments — sounds and costs", () => {
	test("a sound the call hears, in a format it takes, is a marker costed by its seconds", () => {
		const out = placeAttachments({
			lines: lines(3),
			attachments: { "3": [aud("a-3", { duration: 12 })] },
			reads: HEARS
		})
		expect(out.lines[2].attachments).toBe("\n<@media:a-3>")
		expect(out.lines[2].mediaTokens).toBe(120)
		expect(out.lines[2].attachmentsAsText).toBe("\n[audio: a-3.mp3]")
		expect(out.placed).toEqual({ media: 1, estimatedTokens: 120 })
	})

	test("with no duration, a sound's seconds are estimated from its size", () => {
		const out = placeAttachments({
			lines: lines(1),
			attachments: { "1": [aud("a-1")] },
			reads: HEARS
		})
		// 160 000 bytes ≈ 10 s at 16 KB/s, 10 tokens a second.
		expect(out.placed.estimatedTokens).toBe(100)
	})

	test("a format the pair does not take is named, never sent", () => {
		const out = placeAttachments({
			lines: lines(1),
			attachments: { "1": [aud("a-1", { mime: "audio/ogg", filename: "n.ogg" })] },
			reads: HEARS
		})
		expect(out.lines[0].attachments).toBe("\n[audio: n.ogg]")
		expect(out.placed.media).toBe(0)
		expect(out.notes.join(" ")).toMatch(/can't read audio files/)
	})

	test("a heard sound is named with its words, quoted", () => {
		const out = placeAttachments({
			lines: lines(1),
			attachments: { "1": [aud("a-1", { transcript: 'Meet me "at" noon.', filename: "note.mp3" })] },
			reads: READS
		})
		expect(out.lines[0].attachments).toBe("\n[audio: note.mp3 — \"Meet me 'at' noon.\"]")
		expect(out.notes.join(" ")).toMatch(/named with what it says \(transcribed\)/)
	})

	test("the model's own earlier audio goes back as its words — no name, a note", () => {
		const out = placeAttachments({
			lines: lines(2),
			// Line 2 is the model's (an assistant line): a spoken reply.
			attachments: { "2": [aud("r-2")] },
			reads: HEARS
		})
		expect(out.lines[1]).not.toHaveProperty("attachments")
		expect(out.notes.join(" ")).toMatch(/1 spoken reply went back as the words said/)
	})

	test("…and as audio only where the pair takes audio on the model's own turns", () => {
		const out = placeAttachments({
			lines: lines(2),
			attachments: { "2": [aud("r-2", { duration: 3 })] },
			reads: {
				...HEARS,
				kinds: { ...HEARS.kinds, audio: { ...HEARS.kinds.audio, assistantTurns: true } }
			}
		})
		expect(out.lines[1].attachments).toBe("\n<@media:r-2>")
		expect(out.placed.media).toBe(1)
	})

	test("a video, which no pair reads yet, is named", () => {
		const out = placeAttachments({
			lines: lines(1),
			attachments: {
				"1": [{ uuid: "v-1", kind: "video", mime: "video/mp4", bytes: 9, filename: "clip.mp4", attachmentKind: "video" } as any]
			},
			reads: HEARS
		})
		expect(out.lines[0].attachments).toBe("\n[video: clip.mp4]")
	})

	test("an unknown kind passes through as a file's name (O1)", () => {
		const out = placeAttachments({
			lines: lines(1),
			attachments: {
				"1": [{ uuid: "h-1", kind: "hologram", mime: "model/x-holo", bytes: 9, filename: "h.holo", attachmentKind: null } as any]
			},
			reads: HEARS
		})
		expect(out.lines[0].attachments).toBe("\n[file: h.holo]")
	})

	test("an image's cost is the pair's stated per-item figure", () => {
		const out = placeAttachments({
			lines: lines(1),
			attachments: { "1": [img("u-1")] },
			reads: HEARS
		})
		expect(out.placed.estimatedTokens).toBe(1000)
		expect(out.lines[0].attachmentsAsText).toBe("\n[image: u-1.png]")
	})
})
