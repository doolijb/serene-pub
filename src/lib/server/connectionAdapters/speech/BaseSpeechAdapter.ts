/**
 * 🚧 The speech-adapter family (PLAN-speech-build S9, 2026-10-28) — a model
 * that SPEAKS: text in, audio out (`text->audio`, `synthesizeSpeech`).
 *
 * A sixth family beside text, image, embedding, NER and transcription, parallel
 * to them for the transcription family's reason: a render of one line has no
 * prompt to assemble, no token budget and no session, so a subclass of the
 * text base would inherit ten construction parameters it must ignore. What is
 * SHARED is the action — `synthesizeSpeech` comes from
 * `$lib/server/adapters/actions` like every other, so "this type can speak" is
 * derived from the class (the conformance test), never asserted twice.
 *
 * Modules: `openAiSpeechDialect.ts` (OpenAI-shaped `/v1/audio/speech`, one
 * profile per type — openai, koboldcpp, koboldcpp_managed, ollama, audiocpp)
 * and `ElevenLabsSpeechAdapter.ts` (native).
 *
 * ⚠ Keys a profile does not honour are NOT SENT — Ollama answers HTTP 400 to
 * any extra field. `applied`/`ignored` on the result say exactly which request
 * keys went out; `pitch` and `volume` are always `ignored` (A3).
 */

import type {
	AdapterActions,
	SpeechRequest,
	SpeechResult
} from "$lib/server/adapters/actions"
import type { SpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"

export type { SpeechRequest, SpeechResult }

/** A request key an adapter may honour or ignore (`text` is always sent). */
export type SpeechRequestKey = Exclude<keyof SpeechRequest, "text">

/** Every request key, in a fixed order, so `applied`/`ignored` read the same everywhere. */
export const SPEECH_REQUEST_KEYS: readonly SpeechRequestKey[] = [
	"model",
	"voice",
	"format",
	"speed",
	"direction",
	"tags",
	"language",
	"seed",
	"pitch",
	"volume"
]

/** Keys no adapter ever sends (PLAN-speech-build A3, ★2). */
export const NEVER_SENT: readonly SpeechRequestKey[] = ["pitch", "volume"]

/**
 * The present keys of `req`, split by whether the adapter will send them.
 *
 * "Present" is `!== undefined` (and a non-empty array for `tags`, a non-blank
 * string for `direction`): a key the caller did not ask for is in neither list.
 * `pitch`/`volume` land in `ignored` whatever `honoured` says.
 */
export function partitionSpeechKeys(
	req: SpeechRequest,
	honoured: readonly SpeechRequestKey[]
): { applied: SpeechRequestKey[]; ignored: SpeechRequestKey[] } {
	const applied: SpeechRequestKey[] = []
	const ignored: SpeechRequestKey[] = []
	for (const key of SPEECH_REQUEST_KEYS) {
		const v = req[key]
		const present =
			v !== undefined &&
			v !== null &&
			!(Array.isArray(v) && v.length === 0) &&
			!(typeof v === "string" && !v.trim())
		if (!present) continue
		if (honoured.includes(key) && !NEVER_SENT.includes(key)) applied.push(key)
		else ignored.push(key)
	}
	return { applied, ignored }
}

/** A model a speech-only module lists (same row shape the text listings use). */
export interface SpeechModelOption {
	id: string
	name?: string
	/** Always `"tts"` from a speech module. */
	modality?: string
	[key: string]: unknown
}

/**
 * What discovery may know beyond the model id: the row's display name, which
 * an admin can set to the engine's name when the service cannot say it.
 */
export interface SpeechDiscoveryHint {
	name?: string | null
}

/** What a concrete speech-adapter module default-exports. */
export interface SpeechAdapterExports {
	Adapter: new (connection: AdapterConnection) => BaseSpeechAdapter
	/**
	 * Voice discovery + catalogue: the speech facts for ONE model on this
	 * connection, or `null` when the service cannot say and no catalogue knows
	 * the engine (the admin then types a voice).
	 */
	discoverSpeechFacts?: (
		connection: SelectConnection,
		model: string,
		hint?: SpeechDiscoveryHint
	) => Promise<SpeechFacts | null>
	/**
	 * ⚠ REQUIRED of a module serving a type whose declared modality is `tts`
	 * (`audiocpp`, `elevenlabs`): this family is that type's only one, so
	 * `adapterIO` lists and tests through them. A module serving a type that
	 * also has a text module (`koboldcpp`, `ollama`, `openai`) leaves both off.
	 */
	listModels?: (
		connection: SelectConnection
	) => Promise<{ models: SpeechModelOption[]; error?: string }>
	testConnection?: (connection: SelectConnection) => Promise<{
		ok: boolean
		error?: string
		extra?: Record<string, unknown>
	}>
}

/**
 * The actions this family does not implement, merged on as an INTERFACE —
 * the other bases' mechanism, for their reason: their ABSENCE is the
 * statement (a speech module implementing `generateText` would make a
 * speaking connection offerable as the chat default).
 */
export interface BaseSpeechAdapter
	extends Partial<Omit<AdapterActions, "synthesizeSpeech">> {}

export abstract class BaseSpeechAdapter implements AdapterActions {
	connection: AdapterConnection

	constructor(connection: AdapterConnection) {
		this.connection = connection
	}

	/** Speak ONE rendered group. `text->audio`. */
	abstract synthesizeSpeech(
		req: SpeechRequest,
		opts?: { signal?: AbortSignal }
	): Promise<SpeechResult>
}
