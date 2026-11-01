/**
 * 🚧 One connection type's profile in the OpenAI-speech dialect
 * (`openAiSpeechDialect.ts`, PLAN-speech-build S9).
 *
 * Every local server in the build speaks OpenAI's `POST /v1/audio/speech`
 * body (`model`, `input`, `voice`, `response_format`, `speed`); only the
 * voice list, the honoured keys and where the extra controls go differ. A
 * profile states those differences as DATA so one engine serves openai,
 * koboldcpp, koboldcpp_managed, ollama and audiocpp.
 *
 * ⚠ `honoured` is a whitelist of request keys that are SENT. A key outside it
 * is never put on the wire (Ollama answers HTTP 400 to any extra field) and is
 * reported in `ignored`. `pitch`/`volume` are never sent whatever this says.
 */

import type { SpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"
import type {
	SpeechDiscoveryHint,
	SpeechRequestKey,
	SpeechModelOption
} from "./BaseSpeechAdapter"

export interface OpenAiSpeechProfile {
	/** The connection type id this profile serves (`CONNECTION_TYPE.*`). */
	type: string
	/**
	 * The service root the routes below are appended to, resolved per call
	 * (the managed KoboldCPP's comes from its settings, not the row). No
	 * trailing slash.
	 */
	baseUrl(connection: SelectConnection): string | Promise<string>
	/** The speech route, appended to `baseUrl` (e.g. `/v1/audio/speech`, or `/audio/speech` for a `/v1` base). */
	route: string
	/** Request keys this type SENDS. Everything else present is `ignored`. */
	honoured: readonly SpeechRequestKey[]
	/** `response_format` values the service accepts; a request outside them is sent `defaultFormat` and reported `ignored`. */
	formats: readonly string[]
	/** Sent when the request names no format (or one outside `formats`). */
	defaultFormat: string
	/**
	 * Leave `response_format` off the wire when it would be `defaultFormat`
	 * (audio.cpp documents `json|mp3|pcm` and answers WAV when it is absent).
	 */
	omitDefaultFormat?: boolean
	/** Where `direction` goes in the body, when honoured. */
	directionField?: "instructions" | "instruction" | "options.instruct"
	/** Where `language` goes in the body, when honoured. */
	languageField?: "language" | "lang"
	/** Where `seed` goes in the body, when honoured. */
	seedField?: "seed" | "options.seed"
	/** Honoured `speed` range; a value outside it is clamped and reported `ignored`. */
	speedRange?: { min: number; max: number }
	/** `tags` are placed ahead of the text (`"[whispers] Hello"`), when honoured. */
	tagsInline?: boolean
	/** `Authorization: Bearer <apiKey>` from `extraJson.apiKey` when one is stored. */
	bearerAuth?: boolean
	/** The model sent when neither the request nor the connection names one. */
	defaultModel?: string
	/**
	 * Per-MODEL narrowing of `honoured` (e.g. `instructions` only on
	 * `gpt-4o-mini-tts`; `instruction` only on Qwen3 CustomVoice/VoiceDesign).
	 * Returns the keys this model honours; absent ⇒ `honoured` as-is.
	 * `connection` is the merged pair: `connectionModelName` is the row's
	 * display name (`speechEngineKey`).
	 */
	honouredFor?(
		model: string,
		connection?: AdapterConnection
	): readonly SpeechRequestKey[]
	/** Voice discovery + catalogue for one model. */
	discoverSpeechFacts?(
		connection: SelectConnection,
		model: string,
		hint?: SpeechDiscoveryHint
	): Promise<SpeechFacts | null>
	/** Only for a speech-only type (`audiocpp`): lists and tests on its own. */
	listModels?(
		connection: SelectConnection
	): Promise<{ models: SpeechModelOption[]; error?: string }>
	testConnection?(
		connection: SelectConnection
	): Promise<{ ok: boolean; error?: string; extra?: Record<string, unknown> }>
}
