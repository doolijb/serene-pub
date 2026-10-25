/**
 * 🚧 The omni bindings (O5, O6, O7, O9): what the text oracle forwards and
 * publishes as PARTS, the transcribe step's pure decision, and the context
 * budget's `reads`. Bindings called directly with a stub ctx — the executor's
 * half (does a run hand them anything at all) is the wiring tests'.
 */
import { describe, expect, it, vi } from "vitest"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { roughTokens } from "@serene-pub/sdk"

const b = coreBindings()

describe("generate-text: requested outputs in, parts out", () => {
	it("forwards the outputs and the speech sampling, and lays the reply out as parts in order", async () => {
		const ref = { uuid: "aud-1", kind: "audio", mime: "audio/wav", bytes: 10 }
		const call = vi.fn(async () => ({
			text: "Hello there.",
			reasoning: "think",
			media: [ref],
			via: "openai"
		}))
		const out: any = await b["core:oracle/generate-text@1"]!(
			{
				context: { messages: [] },
				params: { outputs: ["text", "audio"] },
				speechSampling: { voice: "verse" }
			} as any,
			{ call, countTokens: roughTokens } as any
		)
		const payload = (call.mock.calls[0] as any[])[0]
		expect(payload.outputs).toEqual(["text", "audio"])
		expect(payload.speechSampling).toEqual({ voice: "verse" })
		expect(out.value.text).toBe("Hello there.")
		expect(out.value.parts).toEqual([
			{ t: "reasoning", text: "think" },
			{ t: "text", text: "Hello there." },
			{ t: "media", ref }
		])
	})

	it("a text reply's parts are its prose alone; nothing asked is nothing forwarded", async () => {
		const call = vi.fn(async () => ({ text: "Hi.", via: "openai" }))
		const out: any = await b["core:oracle/generate-text@1"]!(
			{ context: { messages: [] } } as any,
			{ call, countTokens: roughTokens } as any
		)
		const payload = (call.mock.calls[0] as any[])[0]
		expect(payload.outputs).toBeUndefined()
		expect(out.value.parts).toEqual([{ t: "text", text: "Hi." }])
	})
})

describe("transcribe-audio", () => {
	const lines = [{ id: 1, role: "user", name: "Ash", message: "listen" }]
	const note = { uuid: "a-1", kind: "audio", mime: "audio/ogg", bytes: 9, filename: "n.ogg", attachmentKind: "audio" }

	it("sends nothing when there is nothing to hear, and hands the record on", async () => {
		const call = vi.fn()
		const attachments = { "1": [{ ...note, transcript: "already heard" }] }
		const out: any = await b["core:oracle/transcribe-audio@1"]!(
			{ messages: lines, attachments, hears: null } as any,
			{ call, countTokens: roughTokens } as any
		)
		expect(call).not.toHaveBeenCalled()
		expect(out.value.attachments).toBe(attachments)
		expect(out.value.notes).toEqual([])
	})

	it("asks the host to hear what the call cannot, and puts the words back", async () => {
		const call = vi.fn(async () => ({ transcripts: { "a-1": "meet at noon" }, notes: ["1 audio file was transcribed."] }))
		const out: any = await b["core:oracle/transcribe-audio@1"]!(
			{
				messages: lines,
				attachments: { "1": [note] },
				hears: { image: true, pdf: false, kinds: { audio: { reads: true, accepts: ["audio/wav"] } } },
				params: { language: " en " }
			} as any,
			{ call, countTokens: roughTokens } as any
		)
		const payload = (call.mock.calls[0] as any[])[0]
		expect(payload.files).toEqual([{ uuid: "a-1", mime: "audio/ogg", filename: "n.ogg" }])
		expect(payload.language).toBe("en")
		expect(out.value.attachments["1"][0]).toMatchObject({ transcript: "meet at noon", text: "meet at noon" })
		expect(out.value.notes).toEqual(["1 audio file was transcribed."])
	})
})

describe("context-budget publishes what its pair reads", () => {
	it("the model's own verdict, else the endpoint's", async () => {
		const reads = { image: true, pdf: false, kinds: { audio: { reads: true } } }
		const out: any = await b["core:task/context-budget@1"]!(
			{
				sampling: { contextTokens: 8000, responseTokens: 500 },
				connection: { metadata: { reads }, modelId: null }
			} as any,
			{ countTokens: roughTokens } as any
		)
		expect(out.value.reads).toEqual(reads)
		const none: any = await b["core:task/context-budget@1"]!(
			{ sampling: { contextTokens: 8000 } } as any,
			{ countTokens: roughTokens } as any
		)
		expect(none.value.reads).toBeNull()
	})
})
