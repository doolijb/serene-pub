/**
 * 🚧 Speech profile for type `ollama` (Ollama >= 0.40.11, Phonon).
 *
 * ⚠ Ollama answers HTTP 400 to any field outside model/input/voice/
 * response_format, so ONLY those are sent; speed, direction, language, seed,
 * tags are `ignored`. Input over 4096 characters is REFUSED here with a clear
 * error (Ollama would 400); the host splits groups, never this adapter.
 */

import type { SpeechRequest } from "../BaseSpeechAdapter"
import { createOpenAiSpeechModule } from "../openAiSpeechDialect"
import type { OpenAiSpeechProfile } from "../speechProfile"
import type { SpeechVoice } from "$lib/shared/connectionAdapters/speechFacts"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { modelServerFetch } from "../../modelServerFetch"

export const OLLAMA_SPEECH_INPUT_LIMIT = 4096

const root = (c: SelectConnection) =>
	normalizeBaseUrl(c.baseUrl) || "http://localhost:11434"

/**
 * Where /api/show puts the voices is not documented beyond "voices": read a
 * top-level `voices`, `details.voices`, or any `model_info` key ending in
 * `.voices` / `voices`; entries are strings or {id|name|voice}.
 */
export function voicesFromShow(show: any): SpeechVoice[] {
	const candidates: unknown[] = [
		show?.voices,
		show?.details?.voices,
		...Object.entries(show?.model_info ?? {})
			.filter(([k]) => k === "voices" || k.endsWith(".voices"))
			.map(([, v]) => v)
	]
	const list = candidates.find((c) => Array.isArray(c) && c.length) as unknown[] | undefined
	if (!list) return []
	const out: SpeechVoice[] = []
	for (const v of list) {
		const id =
			typeof v === "string"
				? v
				: ((v as any)?.id ?? (v as any)?.name ?? (v as any)?.voice)
		if (typeof id === "string" && id.trim())
			out.push({ id, name: typeof (v as any)?.name === "string" ? (v as any).name : id, kind: "preset" })
	}
	return out
}

const profile: OpenAiSpeechProfile = {
	type: CONNECTION_TYPE.OLLAMA,
	baseUrl: root,
	route: "/v1/audio/speech",
	honoured: ["model", "voice", "format"],
	formats: ["wav", "pcm"],
	defaultFormat: "wav",
	async discoverSpeechFacts(connection, model) {
		let show: any
		try {
			const res = await modelServerFetch(`${root(connection)}/api/show`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model }),
				signal: AbortSignal.timeout(5000)
			})
			if (!res.ok) return null
			show = await res.json()
		} catch {
			return null
		}
		if (!Array.isArray(show?.capabilities) || !show.capabilities.includes("speech"))
			return null
		return {
			voices: voicesFromShow(show),
			voicesFrom: "discovered",
			controls: {},
			streams: true,
			formats: ["wav", "pcm"],
			sampleRate: 24000
		}
	}
}

const base = createOpenAiSpeechModule(profile)

class OllamaSpeechAdapter extends base.Adapter {
	override async synthesizeSpeech(
		req: SpeechRequest,
		opts?: { signal?: AbortSignal }
	) {
		if (req.text.length > OLLAMA_SPEECH_INPUT_LIMIT)
			throw new Error(
				`Ollama speaks at most ${OLLAMA_SPEECH_INPUT_LIMIT} characters per request; this group is ${req.text.length}. Split it before sending.`
			)
		return base.Adapter.prototype.synthesizeSpeech.call(this, req, opts)
	}
}

export default { ...base, Adapter: OllamaSpeechAdapter }
