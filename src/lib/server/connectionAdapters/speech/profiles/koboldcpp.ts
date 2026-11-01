/**
 * 🚧 KoboldCPP's speech profiles (PLAN-speech-build, lane B2): the external
 * `koboldcpp` type and the managed `koboldcpp_managed` one, both on
 * koboldcpp's OpenAI-shaped `POST /v1/audio/speech` (koboldcpp.py `tts_generate`,
 * read 2026-10-28).
 *
 * What koboldcpp READS from the body: `input`, `voice`, `instruction`,
 * `language`, `response_format` ("mp3", anything else is WAV), `seed`.
 * It never reads `speed` (so Kokoro's speed is ignored here, whatever the
 * engine could do), and it reads `model` not at all (sent anyway, harmlessly,
 * because the dialect always does). A leading `[label]` in the text becomes the
 * instruction when none is sent, and only the FIRST bracket group is taken —
 * so a tag is never left inline: the wrapper below folds `tags` into
 * `instruction`, otherwise a second tag would be spoken aloud.
 *
 * `instruction` and `language` are honoured only for Qwen3-TTS CustomVoice and
 * VoiceDesign files; every other engine would receive and drop them.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { SpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"
import { catalogueFor, speechEngineKey } from "$lib/shared/speech/catalogues"
import { qwen3Variant } from "$lib/shared/speech/catalogues/qwen3"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import type {
	SpeechAdapterExports,
	SpeechRequest,
	SpeechRequestKey,
	SpeechResult
} from "../BaseSpeechAdapter"
import { ensureManagedReady } from "$lib/server/koboldcpp/managedPreflight"
import { createOpenAiSpeechModule } from "../openAiSpeechDialect"
import type { OpenAiSpeechProfile } from "../speechProfile"

const DEFAULT_BASE_URL = "http://localhost:5001"

const BASE_KEYS: readonly SpeechRequestKey[] = [
	"model",
	"voice",
	"format",
	"seed"
]
const QWEN3_STEERING_KEYS: readonly SpeechRequestKey[] = [
	...BASE_KEYS,
	"direction",
	"language",
	"tags"
]

/** True for the Qwen3-TTS variants that take an instruction and a language. */
function steerable(model: string): boolean {
	return (
		catalogueFor(model)?.family === "qwen3-tts" &&
		qwen3Variant(model) !== "base"
	)
}

/** The service root of an external row: trailing slashes and a trailing `/v1` stripped. */
export function externalRoot(url: string | null | undefined): string {
	return normalizeBaseUrl(url).replace(/\/v1$/i, "") || DEFAULT_BASE_URL
}

/** What the five placeholder names koboldcpp lists (`kobo cheery sleepy shouty chatty`) are. */
async function placeholderFacts(root: string): Promise<SpeechFacts | null> {
	try {
		const res = await fetch(`${root}/v1/audio/voices`, {
			signal: AbortSignal.timeout(5000)
		})
		if (!res.ok) return null
		const data = (await res.json()) as { voices?: unknown }
		const ids = Array.isArray(data.voices)
			? data.voices.filter((v): v is string => typeof v === "string")
			: []
		if (!ids.length) return null
		return {
			voices: ids.map((id) => ({
				id,
				name: id,
				kind: "preset" as const
			})),
			voicesFrom: "discovered",
			controls: {},
			streams: false,
			formats: ["wav", "mp3"],
			notice: "KoboldCPP lists only five placeholder voices and does not say which speech model it holds. Type a voice id if you know the engine (for example a Kokoro id)."
		}
	} catch {
		return null
	}
}

/**
 * The address `ensureManagedReady` answered for this connection's current
 * utterance. The managed adapter sets it just before the dialect asks for the
 * base URL; keyed by the connection object the dialect is handed.
 */
const readyBaseUrls = new WeakMap<object, string>()

function makeProfile(
	type: string,
	baseUrl: OpenAiSpeechProfile["baseUrl"]
): OpenAiSpeechProfile {
	return {
		type,
		baseUrl,
		route: "/v1/audio/speech",
		honoured: BASE_KEYS,
		honouredFor: (model, connection) =>
			steerable(speechEngineKey(model, connection?.connectionModelName))
				? QWEN3_STEERING_KEYS
				: BASE_KEYS,
		formats: ["wav", "mp3"],
		defaultFormat: "wav",
		directionField: "instruction",
		languageField: "language",
		seedField: "seed",
		async discoverSpeechFacts(connection, model, hint) {
			const key = speechEngineKey(model, hint?.name)
			const cat = catalogueFor(key)
			if (cat) {
				const facts = cat.factsFor(key)
				// koboldcpp never reads `speed`, so the catalogue's range is not offered.
				const { speed: _speed, ...controls } = facts.controls
				return {
					...facts,
					controls,
					formats: ["wav", "mp3"],
					streams: false
				}
			}
			// The managed process may be off, and discovery must not start it:
			// only the external service is asked for its placeholder voices.
			return type === CONNECTION_TYPE.KOBOLDCPP
				? placeholderFacts(externalRoot(connection.baseUrl))
				: null
		}
	}
}

/**
 * Folds `tags` into `direction` for a steerable model (see header), then runs
 * the dialect. `tags` is reported `applied` when it went out that way.
 */
function withTagsFolded(module: SpeechAdapterExports): SpeechAdapterExports {
	// The module's Adapter is concrete; its declared type is the abstract base.
	const Base = module.Adapter as unknown as new (
		connection: AdapterConnection
	) => {
		connection: AdapterConnection
		synthesizeSpeech(
			req: SpeechRequest,
			opts?: { signal?: AbortSignal }
		): Promise<SpeechResult>
	}
	class KoboldCppSpeechAdapter extends Base {
		async synthesizeSpeech(
			req: SpeechRequest,
			opts?: { signal?: AbortSignal }
		): Promise<SpeechResult> {
			const model = req.model || this.connection.model || ""
			const key = speechEngineKey(
				model,
				this.connection.connectionModelName
			)
			if (!req.tags?.length || !steerable(key))
				return super.synthesizeSpeech(req, opts)
			const labels = req.tags
				.map((t) =>
					t
						.trim()
						.replace(/^\[|\]$/g, "")
						.trim()
				)
				.filter(Boolean)
			if (!labels.length) return super.synthesizeSpeech(req, opts)
			const { tags: _tags, ...rest } = req
			const direction = [labels.join(", "), req.direction?.trim()]
				.filter(Boolean)
				.join(". ")
			const result = await super.synthesizeSpeech(
				{ ...rest, direction },
				opts
			)
			if (!result.applied.includes("tags")) result.applied.push("tags")
			// `direction` was only the carrier for the tags: not asked, not applied.
			if (!req.direction?.trim())
				result.applied = result.applied.filter((k) => k !== "direction")
			return result
		}
	}
	return {
		...module,
		Adapter:
			KoboldCppSpeechAdapter as unknown as SpeechAdapterExports["Adapter"]
	}
}

export const koboldCppSpeech: SpeechAdapterExports = withTagsFolded(
	createOpenAiSpeechModule(
		makeProfile(CONNECTION_TYPE.KOBOLDCPP, (c) => externalRoot(c.baseUrl))
	)
)

export const koboldCppManagedSpeech: SpeechAdapterExports = withManagedReady(
	withTagsFolded(
		createOpenAiSpeechModule(
			makeProfile(CONNECTION_TYPE.KOBOLDCPP_MANAGED, (c) => {
				const url = readyBaseUrls.get(c)
				if (!url)
					throw new Error(
						"KoboldCPP, run by Serene Pub, was not made ready before speaking."
					)
				return url
			})
		)
	)
)

/**
 * The managed speaker: before each utterance the model manager starts the
 * process if it is down and loads the chosen speech GGUF into koboldcpp's
 * speech slot (a no-op, bar the idle timer, when it already holds it).
 */
function withManagedReady(module: SpeechAdapterExports): SpeechAdapterExports {
	const Base = module.Adapter as unknown as new (
		connection: AdapterConnection
	) => {
		connection: AdapterConnection
		synthesizeSpeech(
			req: SpeechRequest,
			opts?: { signal?: AbortSignal }
		): Promise<SpeechResult>
	}
	class KoboldCppManagedSpeechAdapter extends Base {
		async synthesizeSpeech(
			req: SpeechRequest,
			opts?: { signal?: AbortSignal }
		): Promise<SpeechResult> {
			const file = (req.model || this.connection.model || "").trim()
			if (!file)
				throw new Error(
					"No speech model is chosen on KoboldCPP, run by Serene Pub. Choose one for the Narration loadout under Loadouts."
				)
			const { baseUrl } = await ensureManagedReady(
				{ kind: "audio", file },
				{ connectionId: this.connection.id, signal: opts?.signal }
			)
			readyBaseUrls.set(this.connection, baseUrl)
			return super.synthesizeSpeech(req, opts)
		}
	}
	return {
		...module,
		Adapter:
			KoboldCppManagedSpeechAdapter as unknown as SpeechAdapterExports["Adapter"]
	}
}
