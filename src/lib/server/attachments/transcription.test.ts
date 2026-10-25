/**
 * 🚧 Which audio a reply cannot hear (O9): the transcribe step's pure half.
 */
import { describe, expect, test } from "vitest"
import { callHears, planTranscription, transcriptionNotes, withTranscripts } from "./transcription"

const aud = (uuid: string, extra: Record<string, unknown> = {}) =>
	({
		uuid,
		kind: "audio",
		mime: "audio/mpeg",
		bytes: 1000,
		filename: `${uuid}.mp3`,
		attachmentKind: "audio",
		...extra
	}) as any

const lines = (n: number) =>
	Array.from({ length: n }, (_, i) => ({
		id: i + 1,
		role: i % 2 ? "assistant" : "user",
		name: i % 2 ? "Mara" : "Ash",
		message: `line ${i + 1}`
	}))

const DEAF = { image: true, pdf: false, kinds: { image: { reads: true } } }
const HEARS = { image: true, pdf: false, kinds: { audio: { reads: true, accepts: ["audio/mpeg"] } } }

describe("planTranscription", () => {
	test("a person's sound the call cannot hear, within the lookback, is wanted once", () => {
		const shared = aud("a-1")
		const plan = planTranscription({
			lines: lines(3),
			attachments: { "1": [shared], "3": [shared, aud("a-3")] },
			hears: DEAF
		})
		expect(plan.wanted.map((f) => f.uuid)).toEqual(["a-1", "a-3"])
	})

	test("nothing is wanted when the call hears it, it is heard already, or it is the model's own", () => {
		expect(planTranscription({ lines: lines(1), attachments: { "1": [aud("a-1")] }, hears: HEARS }).wanted).toEqual([])
		expect(
			planTranscription({ lines: lines(1), attachments: { "1": [aud("a-1", { transcript: "hi" })] }, hears: DEAF }).wanted
		).toEqual([])
		// Line 2 is an assistant line: a spoken reply, whose text is its words.
		expect(planTranscription({ lines: lines(2), attachments: { "2": [aud("r-2")] }, hears: DEAF }).wanted).toEqual([])
	})

	test("a format the call does not take is wanted even when it hears audio", () => {
		const plan = planTranscription({
			lines: lines(1),
			attachments: { "1": [aud("a-1", { mime: "audio/ogg" })] },
			hears: HEARS
		})
		expect(plan.wanted).toHaveLength(1)
		expect(callHears(HEARS as any, { mime: "audio/mpeg" })).toBe(true)
		expect(callHears(HEARS as any, { mime: "audio/ogg" })).toBe(false)
	})

	test("older than the lookback is not wanted — placement names it", () => {
		const plan = planTranscription({
			lines: lines(5),
			attachments: { "1": [aud("a-1")], "5": [aud("a-5")] },
			hears: DEAF,
			mediaLookback: 2
		})
		expect(plan.wanted.map((f) => f.uuid)).toEqual(["a-5"])
	})

	test("pictures and text are never wanted", () => {
		const plan = planTranscription({
			lines: lines(1),
			attachments: { "1": [{ uuid: "i", attachmentKind: "image", mime: "image/png" } as any] },
			hears: DEAF
		})
		expect(plan.wanted).toEqual([])
	})
})

describe("withTranscripts", () => {
	test("every appearance of a heard file carries its words; a description is kept", () => {
		const a = aud("a-1")
		const described = aud("a-2", { text: "my description" })
		const out = withTranscripts({ "1": [a], "3": [a, described] }, { "a-1": "hello", "a-2": "words" })
		expect(out["1"][0]).toMatchObject({ transcript: "hello", text: "hello" })
		expect(out["3"][0]).toMatchObject({ transcript: "hello" })
		expect(out["3"][1]).toMatchObject({ transcript: "words", text: "my description" })
	})

	test("nothing heard is the same record", () => {
		const record = { "1": [aud("a-1")] }
		expect(withTranscripts(record, {})).toBe(record)
	})
})

test("the receipt's sentences", () => {
	expect(transcriptionNotes({ heard: 2, failed: 0, unheard: 0 })).toEqual([
		"2 audio files were transcribed, so the reply reads what they say."
	])
	expect(transcriptionNotes({ heard: 0, failed: 0, unheard: 1, why: "no model is set up." })).toEqual([
		"1 audio file the reply cannot hear was sent as its name: no model is set up."
	])
})
