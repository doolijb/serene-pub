/**
 * Lane V2 — DETERMINISM CONFORMANCE. One fixed line, with a speaker and an
 * inflection, run through the host-side path of the speak step for every
 * shipped speech profile, twice (and once more on a fresh adapter): the
 * requests that reach the wire must be byte-identical.
 *
 * The path, as `dispatchSpeech` drives it (read 2026-10-28):
 *   cueLines -> groupCues -> renderSpokenGroup / renderDirection -> splitForLimit
 *   -> adapter.synthesizeSpeech
 * `dispatchSpeech` itself needs the capability resolver, the voicebank and the
 * media store (a database and files), none of which this question is about, so
 * the pieces are COMPOSED here exactly as it calls them (request built with the
 * same conditionals). Voices are fixed per profile where the dispatcher would
 * resolve them. `fetch` is stubbed and records every request.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: unknown) => (typeof v === "string" ? v : null)
}))
vi.mock("$lib/server/koboldcpp/managedPreflight", () => ({
	ensureManagedReady: async () => ({ baseUrl: "http://127.0.0.1:5999" })
}))

import type { Cue } from "@serene-pub/sdk"
import type { SpeechControls, SpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"
import { cueLines } from "$lib/server/pipelines/speech/cueLines"
import { groupCues } from "$lib/server/pipelines/runtime/dispatchSpeech"
import { renderDirection, renderSpokenGroup } from "$lib/server/pipelines/speech/lineTemplate"
import { splitForLimit } from "$lib/server/pipelines/speech/audio"
import { getSpeechAdapter } from "./getSpeechAdapter"
import type { SpeechRequest } from "./BaseSpeechAdapter"
import { OLLAMA_SPEECH_INPUT_LIMIT } from "./profiles/ollama"

const LINE = `"Well met," she says. *She smiles.* "Sit by the fire!"`
const SPEAKER = { ref: "character:1", name: "Ann" }

interface Recorded {
	url: string
	method: string
	body: string | undefined
}
let recorded: Recorded[]

/** A tiny canonical WAV so the dialect's duration code runs too. */
const WAV = (() => {
	const data = 4800
	const out = new Uint8Array(44 + data)
	const dv = new DataView(out.buffer)
	const tag = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)))
	tag(0, "RIFF"); dv.setUint32(4, 36 + data, true); tag(8, "WAVE"); tag(12, "fmt ")
	dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
	dv.setUint32(24, 24000, true); dv.setUint32(28, 48000, true); dv.setUint16(32, 2, true)
	dv.setUint16(34, 16, true); tag(36, "data"); dv.setUint32(40, data, true)
	return out
})()

const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } })

beforeEach(() => {
	recorded = []
	vi.stubGlobal(
		"fetch",
		vi.fn(async (u: string | URL, init: RequestInit = {}) => {
			const url = String(u)
			const method = init.method ?? "GET"
			// Discovery traffic (GET) is answered but is not part of the speak step.
			if (method === "GET" || url.endsWith("/api/show")) {
				if (url.includes("/v1/models") && url.includes("elevenlabs"))
					return json([{ model_id: "eleven_v3", name: "v3", can_do_text_to_speech: true, languages: [{ language_id: "en" }] }])
				if (url.includes("/v2/voices")) return json({ voices: [{ voice_id: "voice-1", name: "Rachel", category: "premade" }], has_more: false })
				return new Response("not found", { status: 404 })
			}
			recorded.push({ url, method, body: typeof init.body === "string" ? init.body : undefined })
			return new Response(WAV, { headers: { "content-type": "audio/wav" } })
		})
	)
})
afterEach(() => vi.unstubAllGlobals())

interface Profile {
	name: string
	type: string
	connection: Record<string, unknown>
	voice: string
	/** Controls the dispatcher would read from the model's stored facts. */
	facts: (discover: () => Promise<SpeechFacts | null>) => Promise<SpeechControls | null>
	limit?: number
}
const viaDiscovery = (d: () => Promise<SpeechFacts | null>) => d().then((f) => f?.controls ?? null)

const PROFILES: Profile[] = [
	{
		name: "openai cloud gpt-4o-mini-tts", type: "openai", voice: "coral",
		connection: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini-tts", extraJson: { apiKey: "sk-test" } },
		facts: viaDiscovery
	},
	{
		name: "openai-compatible local kokoro", type: "openai", voice: "af_bella",
		connection: { baseUrl: "http://x:8880/v1", model: "kokoro" },
		// A host with a voices route: speed, no prose instruction, no tags.
		facts: async () => ({ speed: { min: 0.25, max: 4 } }) as SpeechControls
	},
	{
		name: "ollama phonon", type: "ollama", voice: "coral", limit: OLLAMA_SPEECH_INPUT_LIMIT,
		connection: { baseUrl: "http://o:11434", model: "phonon" },
		facts: async () => ({}) as SpeechControls
	},
	{
		name: "koboldcpp Kokoro", type: "koboldcpp", voice: "af_bella",
		connection: { baseUrl: "http://h:5001", model: "Kokoro_no_espeak_Q4.gguf" },
		facts: viaDiscovery
	},
	{
		name: "koboldcpp_managed Kokoro", type: "koboldcpp_managed", voice: "af_bella",
		connection: { baseUrl: "", model: "Kokoro_no_espeak_Q4.gguf" },
		facts: viaDiscovery
	},
	{
		name: "koboldcpp Qwen3 CustomVoice", type: "koboldcpp", voice: "aiden",
		connection: { baseUrl: "http://h:5001", model: "qwen3_tts_1_7b_customvoice_q8_0.gguf" },
		facts: viaDiscovery
	},
	{
		name: "audiocpp Qwen3 CustomVoice", type: "audiocpp", voice: "Vivian",
		connection: { baseUrl: "http://a:8080", model: "qwen3_tts_1_7b_customvoice_q8_0" },
		facts: viaDiscovery
	},
	{
		name: "audiocpp Kitten 2", type: "audiocpp", voice: "Bella",
		connection: { baseUrl: "http://a:8080", model: "kitten_tts2_q8" },
		facts: viaDiscovery
	},
	{
		name: "elevenlabs v3", type: "elevenlabs", voice: "voice-1",
		connection: { baseUrl: "https://api.elevenlabs.io", model: "eleven_v3", extraJson: { apiKey: "xi-test" } },
		facts: viaDiscovery
	}
]

/** The speak step's host-side path for one line, against one adapter. */
async function runLine(p: Profile, adapter: { synthesizeSpeech(r: SpeechRequest): Promise<unknown> }, controls: SpeechControls | null) {
	const cues: Cue[] = cueLines({ text: LINE, inflection: "joy", cast: ["Ann"] })
	const groups = groupCues(cues, { lineSpeaker: SPEAKER.ref, language: "en" })
	for (const group of groups) {
		const text = await renderSpokenGroup({
			template: null,
			sessionTemplateId: null,
			cues: group.cues,
			speaker: { ref: group.speakerRef ?? "narrator", name: SPEAKER.name },
			voice: group.voice,
			controls
		})
		if (!text.trim()) continue
		const direction = await renderDirection({
			prompts: null,
			inflection: group.inflection,
			timbreDescription: "a warm contralto",
			controls
		})
		const pieces = splitForLimit(text, p.limit ?? Infinity)
		for (const piece of pieces) {
			const req: SpeechRequest = {
				text: piece,
				voice: p.voice,
				format: "wav",
				speed: 1.15,
				...(direction?.trim() ? { direction: direction.trim() } : {}),
				language: "en"
			}
			await adapter.synthesizeSpeech(req)
		}
	}
}

async function build(p: Profile) {
	const mod = (await getSpeechAdapter(p.type))!
	const conn = { id: 5, type: p.type, extraJson: {}, ...p.connection } as any
	const controls = await p.facts(async () =>
		mod.discoverSpeechFacts ? await mod.discoverSpeechFacts(conn, conn.model) : null
	)
	return { mod, conn, controls }
}

describe.each(PROFILES.map((p) => [p.name, p] as const))("determinism: %s", (_name, p) => {
	test("two runs, and a fresh adapter, put byte-identical requests on the wire", async () => {
		const { mod, conn, controls } = await build(p)

		const adapter = new mod.Adapter(conn)
		recorded = []
		await runLine(p, adapter, controls)
		const first = structuredClone(recorded)

		recorded = []
		await runLine(p, adapter, controls)
		const second = structuredClone(recorded)

		recorded = []
		await runLine(p, new mod.Adapter({ ...conn }), controls)
		const fresh = structuredClone(recorded)

		// Something was sent: narration and dialogue are two voices, so two groups.
		expect(first.length).toBeGreaterThanOrEqual(2)
		for (const r of first) {
			expect(r.method).toBe("POST")
			expect(r.body).toBeDefined()
			expect(() => JSON.parse(r.body!)).not.toThrow()
		}
		// Byte-identical: url + method + body bytes.
		expect(Buffer.from(JSON.stringify(second))).toEqual(Buffer.from(JSON.stringify(first)))
		expect(Buffer.from(JSON.stringify(fresh))).toEqual(Buffer.from(JSON.stringify(first)))

		// The markup of the line never reaches the wire: no asterisks, no quote marks.
		const spoken = first.map((r) => r.body).join("")
		expect(spoken).not.toContain("*")
		expect(spoken).toContain("fire")
	})

	test("the pipeline pieces themselves are pure (cue list and groups equal across calls)", () => {
		const a = cueLines({ text: LINE, inflection: "joy", cast: ["Ann"] })
		const b = cueLines({ text: LINE, inflection: "joy", cast: ["Ann"] })
		expect(JSON.stringify(b)).toBe(JSON.stringify(a))
		const ga = groupCues(a, { lineSpeaker: SPEAKER.ref, language: "en" })
		const gb = groupCues(b, { lineSpeaker: SPEAKER.ref, language: "en" })
		expect(JSON.stringify(gb)).toBe(JSON.stringify(ga))
	})
})

describe("the profiles take what their facts say they take", () => {
	test("the requests differ across profiles (the test is not comparing nothing)", async () => {
		const bodies: string[] = []
		for (const p of PROFILES) {
			const { mod, conn, controls } = await build(p)
			recorded = []
			await runLine(p, new mod.Adapter(conn), controls)
			bodies.push(recorded.map((r) => r.url + r.body).join("\n"))
		}
		expect(new Set(bodies).size).toBe(PROFILES.length)
	})
	test("an inflection reaches a prose-instruction model as a direction, and a tag model as an inline tag", async () => {
		const get = async (name: string) => {
			const p = PROFILES.find((x) => x.name === name)!
			const { mod, conn, controls } = await build(p)
			recorded = []
			await runLine(p, new mod.Adapter(conn), controls)
			return recorded.map((r) => JSON.parse(r.body!))
		}
		const gpt = await get("openai cloud gpt-4o-mini-tts")
		expect(gpt.every((b) => typeof b.instructions === "string" && b.instructions.length > 0)).toBe(true)
		const kokoro = await get("koboldcpp Kokoro")
		expect(kokoro.some((b) => "instruction" in b || "instructions" in b)).toBe(false)
		const eleven = await get("elevenlabs v3")
		expect(eleven.some((b) => /\[[a-z ]+\]/i.test(b.text))).toBe(true)
		const kitten = await get("audiocpp Kitten 2")
		expect(kitten.some((b) => /\[[a-z]+\]/i.test(b.input))).toBe(true)
	})
})
