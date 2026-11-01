/**
 * 🚧 audio.cpp (https://github.com/0xShug0/audio.cpp) in the OpenAI-speech
 * dialect — PLAN-speech-build B3.
 *
 * Wire facts (app/server/README.md + api.md, v0.9.3, looked up 2026-10-28):
 * - `POST /v1/audio/speech` — `model` must be a configured `models[].id`;
 *   `input`, `voice` (preset / `voice_dir` WAV basename / model-native id),
 *   top-level `instructions` (mapped to the model option `instruction`; never
 *   sent together with `instruct`), `speed` (only when the model declares it),
 *   `seed`, top-level `language`. A non-streaming reply is `audio/wav`.
 * - `GET /v1/audio/voices?model=<id>` — `{"voices": ["alba", …]}`, flat strings:
 *   configured presets, cached ids and reference-library names, NOT the
 *   model's embedded presets (the catalogue fills those).
 * - `GET /v1/models` — OpenAI-style entries `{id, configured, device}`; no
 *   family field, so the family is read from the id.
 * - `GET /health` — `{status:"ok", backend, models, …}`.
 */

import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import {
	catalogueFor,
	qwen3Variant,
	speechEngineKey
} from "$lib/shared/speech/catalogues"
import type {
	SpeechFacts,
	SpeechVoice
} from "$lib/shared/connectionAdapters/speechFacts"
import {
	AUDIO_FAMILIES_SNAPSHOT,
	matchAudioFamily
} from "$lib/shared/audio/audioFamilies"
import { modelServerFetch } from "../../modelServerFetch"
import { createOpenAiSpeechModule } from "../openAiSpeechDialect"
import type {
	SpeechAdapterExports,
	SpeechRequest,
	SpeechRequestKey,
	SpeechResult
} from "../BaseSpeechAdapter"
import { ensureAudioCppReadyUrl } from "../../audioCppReady"
import type { OpenAiSpeechProfile } from "../speechProfile"

const DEFAULT_BASE = "http://127.0.0.1:8080"

function root(connection: SelectConnection): string {
	return (
		normalizeBaseUrl(connection.baseUrl) || DEFAULT_BASE
	).replace(/\/v1\/?$/, "")
}

const lower = (s: string) => (s ?? "").toLowerCase()

/** The engine family an id names, in the catalogue's vocabulary. */
export function audiocppFamily(id: string): string | undefined {
	const cat = catalogueFor(id)
	if (cat) return cat.family
	const s = lower(id)
	if (/kitten_?tts2/.test(s)) return "kitten-tts-2"
	if (/voxcpm/.test(s)) return "voxcpm2"
	if (/omnivoice/.test(s)) return "omnivoice"
	return undefined
}

/** Families whose prose `instructions` the engine reads without a catalogue. */
const INSTRUCT_FAMILIES = /voxcpm|omnivoice/i

function honouredFor(
	id: string,
	connection?: AdapterConnection
): readonly SpeechRequestKey[] {
	const model = speechEngineKey(id, connection?.connectionModelName)
	const keys: SpeechRequestKey[] = ["model", "voice", "format", "seed"]
	const cat = catalogueFor(model)
	if (cat) {
		const c = cat.factsFor(model).controls
		if (cat.family === "qwen3-tts" && qwen3Variant(model) === "voicedesign")
			keys.splice(keys.indexOf("voice"), 1)
		if (c.speed) keys.push("speed")
		if (c.instruction) keys.push("direction")
		if (c.language) keys.push("language")
		if (c.tags) keys.push("tags")
	} else if (INSTRUCT_FAMILIES.test(model)) keys.push("direction")
	return keys
}

async function getJson(
	connection: SelectConnection,
	path: string
): Promise<{ ok: boolean; status: number; json?: any }> {
	const res = await modelServerFetch(`${root(connection)}${path}`, {
		method: "GET",
		headers: { Accept: "application/json" }
	})
	if (!res.ok) return { ok: false, status: res.status }
	return { ok: true, status: res.status, json: await res.json().catch(() => null) }
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

function modelEntries(json: any): any[] {
	if (Array.isArray(json)) return json
	for (const k of ["data", "models"])
		if (Array.isArray(json?.[k])) return json[k]
	return []
}

function voiceEntries(json: any): SpeechVoice[] {
	const raw: unknown[] = Array.isArray(json)
		? json
		: Array.isArray(json?.voices)
			? json.voices
			: Array.isArray(json?.data)
				? json.data
				: []
	const out: SpeechVoice[] = []
	for (const v of raw) {
		const id =
			typeof v === "string"
				? v
				: typeof (v as any)?.id === "string"
					? (v as any).id
					: typeof (v as any)?.name === "string"
						? (v as any).name
						: ""
		if (!id.trim()) continue
		out.push({ id, name: (v as any)?.name ?? id, kind: "preset" })
	}
	return out
}

/**
 * The facts for one audio.cpp model: the catalogue's, merged with the voices
 * the server listed (listed first, then catalogue voices not listed).
 */
export function audiocppSpeechFacts(
	id: string,
	hint: { name?: string | null } | undefined,
	listedIn: SpeechVoice[]
): SpeechFacts {
	let listed = listedIn
	// The SERVER is asked by its own id; the catalogue by the engine key.
	const model = speechEngineKey(id, hint?.name)
	const cat = catalogueFor(model)
	const base: SpeechFacts = cat
		? cat.factsFor(model)
		: {
				voices: [],
				voicesFrom: "catalogue",
				controls: INSTRUCT_FAMILIES.test(model) ? { instruction: "prose" } : {},
				streams: true,
				formats: ["wav"]
			}
	const facts: SpeechFacts = {
		...base,
		voices: base.voices.map((v) => ({ ...v })),
		formats: ["wav"],
		streams: base.streams && !/kitten_?tts2|kitten-tts-2/i.test(`${model} ${cat?.family ?? ""}`)
	}
	// Qwen3 Base speaks only from a reference recording: every name the
	// server lists for it is a library entry, shown read-only.
	const refOnly = cat?.family === "qwen3-tts" && qwen3Variant(model) === "base"
	if (refOnly) listed = listed.map((v) => ({ ...v, kind: "clone" as const }))
	if (listed.length) {
		const seen = new Set(listed.map((v) => lower(v.id)))
		listed = [...listed]
		for (const v of base.voices)
			if (!seen.has(lower(v.id))) listed.push({ ...v })
		facts.voices = listed
		facts.voicesFrom = "discovered"
	} else facts.voicesFrom = "catalogue"
	return facts
}

export const audiocppProfile: OpenAiSpeechProfile = {
	type: CONNECTION_TYPE.AUDIOCPP,
	baseUrl: root,
	route: "/v1/audio/speech",
	honoured: ["model", "voice", "format", "seed"],
	honouredFor,
	// audio.cpp answers audio/wav by default; other formats are streaming PCM.
	formats: ["wav"],
	defaultFormat: "wav",
	omitDefaultFormat: true,
	directionField: "instructions",
	languageField: "language",
	seedField: "seed",
	speedRange: { min: 0.5, max: 2 },
	tagsInline: true,

	async listModels(connection) {
		try {
			const r = await getJson(connection, "/v1/models")
			if (!r.ok)
				return { models: [], error: `audio.cpp answered HTTP ${r.status} to /v1/models.` }
			const models = modelEntries(r.json)
				.map((m) => (typeof m === "string" ? { id: m } : m))
				.filter((m) => typeof m?.id === "string" && m.id)
				.map((m) => {
					const id = m.id as string
					// An id the audio families list files as transcription is a
					// model that HEARS: filed `asr` with its reads and writes
					// stated, so the Transcription loadout can use it and the
					// Narration one never offers it. Everything else speaks.
					// (The id is whatever the person's server.json called it,
					// so this is the detector's rule over the shipped list.)
					const heard =
						matchAudioFamily(AUDIO_FAMILIES_SNAPSHOT, {
							repoId: id,
							files: [id]
						})?.task === "asr"
					return heard
						? {
								id,
								name: id,
								modality: "asr",
								reads: ["audio"],
								writes: ["text"]
							}
						: { id, name: id, modality: "tts", family: audiocppFamily(id) }
				})
			return { models }
		} catch (err) {
			return { models: [], error: messageOf(err) }
		}
	},

	async testConnection(connection) {
		try {
			const r = await getJson(connection, "/health")
			if (!r.ok)
				return { ok: false, error: `audio.cpp answered HTTP ${r.status} to /health.` }
			const j = r.json ?? {}
			return {
				ok: j.status === undefined || j.status === "ok",
				...(j.status !== undefined && j.status !== "ok"
					? { error: `audio.cpp reports status "${j.status}".` }
					: {}),
				extra: { backend: j.backend, models: j.models, version: j.version }
			}
		} catch (err) {
			return { ok: false, error: messageOf(err) }
		}
	},

	async discoverSpeechFacts(connection, id, hint): Promise<SpeechFacts | null> {
		let listed: SpeechVoice[] = []
		try {
			const r = await getJson(
				connection,
				`/v1/audio/voices?model=${encodeURIComponent(id)}`
			)
			if (r.ok) listed = voiceEntries(r.json)
		} catch {
			/* the catalogue still answers */
		}
		return audiocppSpeechFacts(id, hint, listed)
	}
}

export default createOpenAiSpeechModule(audiocppProfile)

/**
 * The address `ensureAudioCppReadyUrl` answered for this connection's current
 * utterance; keyed by the connection object the dialect is handed.
 */
const readyBaseUrls = new WeakMap<object, string>()

/** audio.cpp, run by Serene Pub: the same dialect, another address and listing. */
export const audiocppManagedProfile: OpenAiSpeechProfile = {
	...audiocppProfile,
	type: CONNECTION_TYPE.AUDIOCPP_MANAGED,
	baseUrl: (c) => {
		const url = readyBaseUrls.get(c)
		if (!url)
			throw new Error(
				"audio.cpp, run by Serene Pub, was not made ready before speaking."
			)
		return url
	},
	listModels: (c) => managedAdapter().then((m) => m.listModels(c)),
	testConnection: (c) => managedAdapter().then((m) => m.testConnection(c)),

	// Never starts the process: the catalogue always answers, and the server's
	// own voices are merged in only when it is already up.
	async discoverSpeechFacts(_connection, id, hint): Promise<SpeechFacts | null> {
		let listed: SpeechVoice[] = []
		try {
			const { audioCppUpBaseUrl } = await managedAdapter()
			const base = await audioCppUpBaseUrl()
			if (base) {
				const res = await modelServerFetch(
					`${base}/v1/audio/voices?model=${encodeURIComponent(id)}`,
					{ method: "GET", headers: { Accept: "application/json" } }
				)
				if (res.ok) listed = voiceEntries(await res.json().catch(() => null))
			}
		} catch {
			/* the catalogue still answers */
		}
		return audiocppSpeechFacts(id, hint, listed)
	}
}

const managedAdapter = () => import("../../AudioCppManagedAdapter")

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
	class AudioCppManagedSpeechAdapter extends Base {
		async synthesizeSpeech(
			req: SpeechRequest,
			opts?: { signal?: AbortSignal }
		): Promise<SpeechResult> {
			const model = (req.model || this.connection.model || "").trim()
			if (!model)
				throw new Error(
					"No speech model is chosen on audio.cpp, run by Serene Pub. Choose one for the Narration loadout under Loadouts."
				)
			const { baseUrl } = await ensureAudioCppReadyUrl({
				signal: opts?.signal
			})
			readyBaseUrls.set(
				this.connection,
				baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")
			)
			return super.synthesizeSpeech(req, opts)
		}
	}
	return {
		...module,
		Adapter:
			AudioCppManagedSpeechAdapter as unknown as SpeechAdapterExports["Adapter"]
	}
}

export const audiocppManagedSpeech: SpeechAdapterExports = withManagedReady(
	createOpenAiSpeechModule(audiocppManagedProfile)
)
