/**
 * 🚧 ElevenLabs speech — the native module of the `elevenlabs` type
 * (PLAN-speech-build B4). Not the OpenAI speech dialect: its own route,
 * its own auth header (`xi-api-key`), its own voice list.
 *
 * API facts (elevenlabs.io/docs/api-reference, looked up 2026-10-28):
 * - `POST /v1/text-to-speech/{voice_id}?output_format=…`, body `text`,
 *   `model_id`, `voice_settings{speed,…}`, `language_code` (ISO 639-1; ignored
 *   by multilingual_v2), `seed` (0..4294967295). Response: the audio bytes.
 * - `GET /v1/models` → `[{model_id, name, can_do_text_to_speech, languages[]}]`.
 * - `GET /v2/voices?page_size≤100&next_page_token` → `{voices, has_more,
 *   next_page_token}`; `category` premade|cloned|generated|professional|…
 * - Default `mp3_44100_128` is free-tier safe; `mp3_44100_192` needs Creator,
 *   `pcm/wav_44100` needs Pro. We offer only the two free-safe formats.
 * - Inline audio tags (`[whispers]`) belong to the v3 / v4-turbo families.
 *
 * ⚠ The key is sent as a header and never logged or echoed in an error.
 */

import {
	BaseSpeechAdapter,
	partitionSpeechKeys,
	type SpeechAdapterExports,
	type SpeechModelOption,
	type SpeechRequest,
	type SpeechRequestKey,
	type SpeechResult
} from "./BaseSpeechAdapter"
import type {
	SpeechFacts,
	SpeechVoice
} from "$lib/shared/connectionAdapters/speechFacts"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

export const DEFAULT_ELEVENLABS_MODEL = "eleven_flash_v2_5"
const DEFAULT_FORMAT = "mp3_44100_128"
const OPUS_FORMAT = "opus_48000_64"
/** The formats we offer: both free-tier safe. */
export const ELEVENLABS_FORMATS = [DEFAULT_FORMAT, OPUS_FORMAT] as const
/** Documented `voice_settings.speed` range. */
export const ELEVENLABS_SPEED = { min: 0.7, max: 1.2 } as const
/** Models that read inline `[tag]` cues (design list; confirmed for v4 turbo / v3 conversational by the docs). */
const TAG_MODELS: ReadonlySet<string> = new Set([
	"eleven_v3",
	"eleven_v3_conversational",
	"eleven_v4_turbo"
])
const SEED_MAX = 4294967295
const OUTPUT_FORMAT_RE = /^(mp3|opus|pcm|wav|ulaw|alaw)_\d+(_\d+)?$/

export const modelTakesTags = (model: string): boolean => TAG_MODELS.has(model)
/** multilingual_v2 ignores `language_code`; the v2 flash/turbo models are English-only. */
export const modelTakesLanguage = (model: string): boolean =>
	!/multilingual_v2|^eleven_(flash|turbo)_v2$|monolingual/.test(model)

function mimeFor(outputFormat: string): string {
	if (outputFormat.startsWith("opus")) return "audio/ogg"
	if (outputFormat.startsWith("mp3")) return "audio/mpeg"
	if (outputFormat.startsWith("wav")) return "audio/wav"
	return "audio/basic" // pcm/ulaw/alaw: raw, rare; never offered
}

function baseUrl(connection: { baseUrl?: string | null }): string {
	return (
		normalizeBaseUrl(connection.baseUrl) ||
		normalizeBaseUrl(CONNECTION_DEFAULTS[CONNECTION_TYPE.ELEVENLABS].baseUrl) ||
		"https://api.elevenlabs.io"
	)
}

async function apiKeyOf(connection: {
	extraJson?: unknown
}): Promise<string | null> {
	const key = (connection.extraJson as { apiKey?: unknown } | null)?.apiKey
	if (!key) return null
	// Dynamic: tokenCrypto imports the database (see OpenAITranscriptionAdapter).
	return (
		(await import("$lib/server/utils/tokenCrypto")).decryptApiKeyField(
			key as never
		) ?? null
	)
}

/** The service's own words for what went wrong, or a status line. Never the key. */
async function errorMessage(res: Response): Promise<string> {
	let text = ""
	try {
		text = await res.text()
	} catch {
		/* fall through to the status line */
	}
	try {
		const d = (JSON.parse(text) as { detail?: unknown }).detail
		if (typeof d === "string" && d) return d
		if (Array.isArray(d)) {
			const m = d
				.map((e) => (e as { msg?: unknown })?.msg)
				.filter((x) => typeof x === "string")
				.join("; ")
			if (m) return m
		}
		const msg = (d as { message?: unknown } | undefined)?.message
		if (typeof msg === "string" && msg) return msg
	} catch {
		/* not JSON */
	}
	if (res.status === 401)
		return "ElevenLabs rejected the API key (HTTP 401). Check the key on this connection."
	return `ElevenLabs answered HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`
}

async function get(
	connection: SelectConnection,
	path: string,
	signal?: AbortSignal
): Promise<unknown> {
	const apiKey = await apiKeyOf(connection)
	if (!apiKey) throw new Error("This ElevenLabs connection has no API key.")
	const res = await fetch(`${baseUrl(connection)}${path}`, {
		headers: { "xi-api-key": apiKey, Accept: "application/json" },
		signal
	})
	if (!res.ok) throw new Error(await errorMessage(res))
	return res.json()
}

interface ModelRow {
	model_id?: string
	name?: string
	can_do_text_to_speech?: boolean
	languages?: { language_id?: string; name?: string }[]
}

async function fetchModels(
	connection: SelectConnection
): Promise<ModelRow[]> {
	const rows = await get(connection, "/v1/models")
	return Array.isArray(rows) ? (rows as ModelRow[]) : []
}

export class ElevenLabsSpeechAdapter extends BaseSpeechAdapter {
	async synthesizeSpeech(
		req: SpeechRequest,
		opts?: { signal?: AbortSignal }
	): Promise<SpeechResult> {
		const connection = this.connection
		const voice = req.voice?.trim()
		if (!voice)
			throw new Error(
				"ElevenLabs needs a voice: choose one for this speaker (the connection's voice list)."
			)
		const apiKey = await apiKeyOf(connection)
		if (!apiKey) throw new Error("This ElevenLabs connection has no API key.")
		const model = req.model || connection.model || DEFAULT_ELEVENLABS_MODEL

		const honoured: SpeechRequestKey[] = ["model", "voice"]
		const body: Record<string, unknown> = { model_id: model }

		let text = req.text
		if (req.tags?.length && modelTakesTags(model)) {
			text = `${req.tags.join(" ")} ${req.text}`
			honoured.push("tags")
		}
		body.text = text

		if (typeof req.speed === "number" && Number.isFinite(req.speed)) {
			const clamped = Math.min(
				ELEVENLABS_SPEED.max,
				Math.max(ELEVENLABS_SPEED.min, req.speed)
			)
			// A value we had to change is reported ignored (S2 contract).
			if (clamped === req.speed) {
				body.voice_settings = { speed: clamped }
				honoured.push("speed")
			}
		}
		const lang = req.language?.trim().split(/[-_]/)[0]?.toLowerCase()
		if (lang && modelTakesLanguage(model)) {
			body.language_code = lang
			honoured.push("language")
		}
		if (
			typeof req.seed === "number" &&
			Number.isInteger(req.seed) &&
			req.seed >= 0 &&
			req.seed <= SEED_MAX
		) {
			body.seed = req.seed
			honoured.push("seed")
		}

		let outputFormat = DEFAULT_FORMAT
		if (req.format === "opus") outputFormat = OPUS_FORMAT
		else if (req.format === "mp3") outputFormat = DEFAULT_FORMAT
		else if (req.format && OUTPUT_FORMAT_RE.test(req.format))
			outputFormat = req.format
		else if (req.format) {
			/* unknown format: default, and reported ignored below */
		}
		if (
			req.format === "opus" ||
			req.format === "mp3" ||
			(req.format && OUTPUT_FORMAT_RE.test(req.format))
		)
			honoured.push("format")

		const { applied, ignored } = partitionSpeechKeys(req, honoured)

		const url = `${baseUrl(connection)}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${encodeURIComponent(outputFormat)}`
		let res: Response
		try {
			res = await fetch(url, {
				method: "POST",
				headers: {
					"xi-api-key": apiKey,
					"Content-Type": "application/json",
					Accept: "audio/*"
				},
				body: JSON.stringify(body),
				signal: opts?.signal
			})
		} catch (e) {
			if (opts?.signal?.aborted || (e as Error)?.name === "AbortError")
				return {
					media: [],
					isAborted: true,
					applied: [],
					ignored: [],
					spokenAs: { voice, model, connection: connection.id }
				}
			throw e
		}
		if (!res.ok) throw new Error(await errorMessage(res))
		const bytes = Buffer.from(await res.arrayBuffer())
		return {
			media: [
				{
					kind: "audio",
					mime: mimeFor(outputFormat),
					base64: bytes.toString("base64"),
					meta: { outputFormat, requestId: res.headers.get("request-id") }
				}
			],
			isAborted: false,
			applied,
			ignored,
			spokenAs: { voice, model, connection: connection.id }
		}
	}
}

function toVoice(v: Record<string, unknown>): SpeechVoice | null {
	const id = typeof v.voice_id === "string" ? v.voice_id : ""
	if (!id) return null
	const cat = v.category
	const kind: SpeechVoice["kind"] =
		cat === "generated"
			? "designed"
			: cat === "cloned" || cat === "professional"
				? "clone"
				: "preset"
	const l = (v.labels ?? {}) as Record<string, unknown>
	const s = (x: unknown) => (typeof x === "string" && x.trim() ? x : undefined)
	const out: SpeechVoice = {
		id,
		name: s(v.name) ?? id,
		kind
	}
	const language = s(l.language)
	if (language) out.language = language
	const labels: NonNullable<SpeechVoice["labels"]> = {}
	if (s(l.gender)) labels.gender = s(l.gender)
	if (s(l.accent)) labels.accent = s(l.accent)
	if (s(l.age)) labels.age = s(l.age)
	const useCase = s(l.use_case) ?? s(l.usecase)
	if (useCase) labels.useCase = useCase
	if (Object.keys(labels).length) out.labels = labels
	if (s(v.preview_url)) out.previewUrl = s(v.preview_url)
	return out
}

const module_: SpeechAdapterExports = {
	Adapter: ElevenLabsSpeechAdapter,

	async listModels(connection) {
		try {
			const rows = await fetchModels(connection)
			const models: SpeechModelOption[] = rows
				.filter((m) => m.can_do_text_to_speech && m.model_id)
				.map((m) => ({
					id: m.model_id as string,
					name: m.name || (m.model_id as string),
					modality: "tts",
					languages: (m.languages ?? [])
						.map((l) => l.language_id)
						.filter((x): x is string => !!x)
				}))
			return { models }
		} catch (e) {
			return { models: [], error: (e as Error).message }
		}
	},

	async testConnection(connection) {
		try {
			await get(connection, "/v1/models")
			return { ok: true }
		} catch (e) {
			return { ok: false, error: (e as Error).message }
		}
	},

	async discoverSpeechFacts(connection, model): Promise<SpeechFacts | null> {
		const voices: SpeechVoice[] = []
		let token: string | null = null
		for (let page = 0; page < 100; page++) {
			const q = new URLSearchParams({
				page_size: "100",
				include_total_count: "false"
			})
			if (token) q.set("next_page_token", token)
			const r = (await get(connection, `/v2/voices?${q}`)) as {
				voices?: Record<string, unknown>[]
				has_more?: boolean
				next_page_token?: string | null
			}
			for (const v of r.voices ?? []) {
				const sv = toVoice(v)
				if (sv) voices.push(sv)
			}
			if (!r.has_more || !r.next_page_token) break
			token = r.next_page_token
		}
		const row = (await fetchModels(connection)).find((m) => m.model_id === model)
		const languages = (row?.languages ?? [])
			.map((l) => l.language_id)
			.filter((x): x is string => !!x)
		const controls: SpeechFacts["controls"] = {
			speed: { ...ELEVENLABS_SPEED },
			settings: ["stability", "similarity", "style", "speakerBoost"]
		}
		if (modelTakesTags(model))
			controls.tags = { syntax: "bracket", vocabulary: "open" }
		if (languages.length && modelTakesLanguage(model))
			controls.language = languages
		return {
			voices,
			voicesFrom: "discovered",
			controls,
			streams: true,
			formats: [...ELEVENLABS_FORMATS]
		}
	}
}

export default module_
