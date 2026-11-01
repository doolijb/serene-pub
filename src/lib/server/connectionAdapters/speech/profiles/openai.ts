/**
 * 🚧 Speech profile for type `openai` — OpenAI itself and any compatible
 * server (Kokoro-FastAPI, Kitten-TTS-Server, openedai-speech, LocalAI…).
 *
 * Format default (A4): `mp3` on api.openai.com (cloud), `wav` anywhere else.
 * The profile's `defaultFormat` is the cloud one; `OpenAiHostProfile` below
 * overrides it per host by wrapping the base profile in a per-call view.
 */

import { createOpenAiSpeechModule } from "../openAiSpeechDialect"
import type { OpenAiSpeechProfile } from "../speechProfile"
import type { SpeechRequest, SpeechRequestKey } from "../BaseSpeechAdapter"
import type {
	SpeechFacts,
	SpeechVoice
} from "$lib/shared/connectionAdapters/speechFacts"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { modelServerFetch } from "../../modelServerFetch"

export const OPENAI_VOICES = [
	"alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
	"onyx", "sage", "shimmer", "verse", "marin", "cedar"
] as const

/** Models that take `instructions`. Extend here when OpenAI ships another. */
export const OPENAI_INSTRUCTION_MODELS: readonly RegExp[] = [/^gpt-4o-mini-tts/]
/** Models OpenAI shuts down on 2027-01-06. */
const DEPRECATED_MODELS: readonly RegExp[] = [/^gpt-4o-mini-tts/, /^tts-1(-hd)?$/]
const FORMATS = ["mp3", "opus", "aac", "flac", "wav", "pcm"] as const
const BASE_KEYS: readonly SpeechRequestKey[] = ["model", "voice", "format", "speed"]

const isInstructionModel = (m: string) =>
	OPENAI_INSTRUCTION_MODELS.some((re) => re.test(m))

export function openAiSpeechBase(connection: SelectConnection): string {
	return (
		normalizeBaseUrl(connection.baseUrl) ||
		normalizeBaseUrl(CONNECTION_DEFAULTS[CONNECTION_TYPE.OPENAI].baseUrl) ||
		"https://api.openai.com/v1"
	)
}

export const isOpenAiCloud = (connection: SelectConnection) => {
	try {
		return new URL(openAiSpeechBase(connection)).hostname === "api.openai.com"
	} catch {
		return false
	}
}

function voiceFromEntry(v: unknown): SpeechVoice | null {
	if (typeof v === "string") return v.trim() ? { id: v, name: v, kind: "preset" } : null
	if (!v || typeof v !== "object") return null
	const o = v as Record<string, unknown>
	const id = [o.id, o.voice_id, o.name].find((x) => typeof x === "string" && x) as
		| string
		| undefined
	if (!id) return null
	const name = typeof o.name === "string" && o.name ? o.name : id
	return { id, name, kind: "preset" }
}

/** Tolerant: `["a","b"]`, `{voices:[…]}`, `{data:[…]}`; strings or objects. */
export function parseVoices(json: unknown): SpeechVoice[] {
	const list = Array.isArray(json)
		? json
		: Array.isArray((json as any)?.voices)
			? (json as any).voices
			: Array.isArray((json as any)?.data)
				? (json as any).data
				: []
	return list.map(voiceFromEntry).filter((v: SpeechVoice | null): v is SpeechVoice => !!v)
}

async function getJson(url: string, headers: Record<string, string>) {
	try {
		const res = await modelServerFetch(url, {
			headers,
			signal: AbortSignal.timeout(4000)
		})
		return res.ok ? await res.json() : null
	} catch {
		return null
	}
}

const profile: OpenAiSpeechProfile = {
	type: CONNECTION_TYPE.OPENAI,
	baseUrl: openAiSpeechBase,
	route: "/audio/speech",
	honoured: BASE_KEYS,
	honouredFor(model) {
		return isInstructionModel(model) ? [...BASE_KEYS, "direction"] : BASE_KEYS
	},
	formats: FORMATS,
	// Cloud default; the engine cannot see the host, so see `defaultFormatFor`.
	defaultFormat: "mp3",
	directionField: "instructions",
	speedRange: { min: 0.25, max: 4.0 },
	bearerAuth: true,
	defaultModel: "gpt-4o-mini-tts",
	async discoverSpeechFacts(connection, model) {
		if (isOpenAiCloud(connection)) {
			const instruct = isInstructionModel(model)
			const facts: SpeechFacts = {
				voices: OPENAI_VOICES.map((id) => ({
					id,
					name: id[0].toUpperCase() + id.slice(1),
					kind: "preset" as const
				})),
				voicesFrom: "catalogue",
				controls: {
					speed: { min: 0.25, max: 4.0 },
					...(instruct ? { instruction: "prose" as const } : {})
				},
				streams: true,
				formats: FORMATS
			}
			if (DEPRECATED_MODELS.some((re) => re.test(model)))
				facts.deprecatedOn = "2027-01-06"
			return facts
		}
		const base = openAiSpeechBase(connection)
		const root = base.replace(/\/v1$/, "")
		const key = (connection.extraJson as { apiKey?: unknown } | null)?.apiKey
		const headers: Record<string, string> = {}
		if (key) {
			const k = (await import("$lib/server/utils/tokenCrypto")).decryptApiKeyField(key as never)
			if (k) headers.Authorization = `Bearer ${k}`
		}
		for (const url of [`${base}/audio/voices`, `${root}/v1/voices`]) {
			const voices = parseVoices(await getJson(url, headers))
			if (voices.length)
				return {
					voices,
					voicesFrom: "discovered",
					controls: {
						speed: { min: 0.25, max: 4.0 },
						...(isInstructionModel(model) ? { instruction: "prose" as const } : {})
					},
					streams: false,
					formats: FORMATS
				}
		}
		return null
	}
}

/**
 * The engine takes ONE `defaultFormat`; the host-dependent default (A4: wav
 * off api.openai.com) is applied by wrapping `profile` per connection.
 */
const base = createOpenAiSpeechModule(profile)

class HostAwareAdapter extends base.Adapter {
	override synthesizeSpeech(
		req: SpeechRequest,
		opts?: { signal?: AbortSignal }
	) {
		if (isOpenAiCloud(this.connection as never)) return base.Adapter.prototype.synthesizeSpeech.call(this, req, opts)
		return localModule.Adapter.prototype.synthesizeSpeech.call(this, req, opts)
	}
}

// Same profile, `wav` default — the local compatible server (A4).
const localModule = createOpenAiSpeechModule({ ...profile, defaultFormat: "wav" })

export default { ...base, Adapter: HostAwareAdapter }
