/**
 * 🚧 audio.cpp transcription (`POST {root}/v1/audio/transcriptions`) — the
 * `transcription` module of both audio.cpp connection types.
 *
 * `AudioCppTranscriptionAdapter` serves `audiocpp`: a server the person runs
 * themselves, reached at the connection's base URL. The managed subclass
 * serves `audiocpp_managed` (audio.cpp, run by Serene Pub): the base URL comes
 * from the process Serene Pub runs (`ensureAudioCppReadyUrl`, which starts it
 * when it is down), never from the row.
 *
 * The wire is audio.cpp 0.9.3's: multipart `file` + `model` (a configured
 * model id) + optional `language`, answered with `{ text, timing }`. Nothing
 * else is sent. Requests go through `modelServerFetch`, whose timeouts sit
 * above undici's five-minute defaults — a long recording on slow hardware
 * answers its headers only when the whole transcript is ready.
 *
 * ⚠ Refusals (no model, recording too big) happen BEFORE any network or
 * ready call, so a request that will be refused never starts the process.
 */

import { withBusyRetry } from "$lib/server/connectionAdapters/speech/busyRetry"
import {
	BaseTranscriptionAdapter,
	type TranscribeRequest,
	type TranscribeResult,
	type TranscriptionAdapterExports
} from "./BaseTranscriptionAdapter"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { extensionForMime } from "$lib/shared/media/formats"
import { ensureAudioCppReadyUrl } from "$lib/server/connectionAdapters/audioCppReady"
import { modelServerFetch } from "$lib/server/connectionAdapters/modelServerFetch"

/** The largest recording sent (OpenAI's documented limit, kept as ours). */
export const AUDIOCPP_MAX_UPLOAD_BYTES = 25 * 1024 * 1024

const DEFAULT_ROOT = "http://127.0.0.1:8080"

/** A server root with no trailing slash and no `/v1` suffix. */
function stripRoot(url: string): string {
	return url.replace(/\/+$/, "").replace(/\/v1$/i, "")
}

/** The most useful words of an error reply, at most ~300 characters. */
function errorDetail(body: string): string {
	let detail = body.trim()
	try {
		const json = JSON.parse(body) as { error?: unknown }
		const err = json?.error
		if (typeof err === "string") detail = err
		else if (err && typeof (err as { message?: unknown }).message === "string")
			detail = (err as { message: string }).message
	} catch {
		// Not JSON: the raw text stands.
	}
	return detail.slice(0, 300)
}

export class AudioCppTranscriptionAdapter extends BaseTranscriptionAdapter {
	/** Said when the connection names no model. */
	protected noModelMessage =
		"No transcription model is chosen on this audio.cpp connection. Choose one for the Transcription loadout under Loadouts."

	/** Where the server listens. External: the row's own address. */
	protected async baseUrl(_signal?: AbortSignal): Promise<string> {
		return stripRoot(normalizeBaseUrl(this.connection.baseUrl) || DEFAULT_ROOT)
	}

	async transcribeAudio(
		req: TranscribeRequest,
		opts?: { signal?: AbortSignal }
	): Promise<TranscribeResult> {
		const signal = opts?.signal
		const model = (this.connection.model || "").trim()
		if (!model) throw new Error(this.noModelMessage)
		if (req.audio.bytes.byteLength > AUDIOCPP_MAX_UPLOAD_BYTES) {
			throw new Error(
				`This recording is larger than the 25 MB limit for transcription. Use a shorter recording.`
			)
		}
		if (signal?.aborted) return { text: "", isAborted: true }

		const buildForm = () => {
			const form = new FormData()
			const ext = extensionForMime(req.audio.mime) ?? "wav"
			const name =
				req.audio.filename && /\.[a-z0-9]+$/i.test(req.audio.filename)
					? req.audio.filename
					: `audio.${ext}`
			form.append(
				"file",
				new Blob([new Uint8Array(req.audio.bytes)], { type: req.audio.mime }),
				name
			)
			form.append("model", model)
			if (req.language) form.append("language", req.language)
			return form
		}

		let res: Response
		let busyBody = ""
		try {
			const root = await this.baseUrl(signal)
			// A multipart body can be sent once, so each try rebuilds it.
			const got = await withBusyRetry(
				async () => {
					const r = await modelServerFetch(`${root}/v1/audio/transcriptions`, {
						method: "POST",
						body: buildForm(),
						signal
					})
					return { res: r, bodyText: r.ok ? "" : await r.text().catch(() => "") }
				},
				{ signal }
			)
			res = got.res
			busyBody = got.bodyText
		} catch (err: any) {
			if (signal?.aborted) return { text: "", isAborted: true }
			throw new Error(
				`The transcription request did not reach audio.cpp: ${err?.message ?? err}`
			)
		}
		if (!res.ok) {
			const body = busyBody
			const detail = errorDetail(body)
			throw new Error(
				`audio.cpp could not transcribe the recording (HTTP ${res.status})${detail ? `: ${detail}` : "."}`
			)
		}
		let json: { text?: unknown }
		try {
			json = (await res.json()) as { text?: unknown }
		} catch (err: any) {
			if (signal?.aborted) return { text: "", isAborted: true }
			throw new Error(
				`audio.cpp answered the transcription request with something that is not JSON: ${err?.message ?? err}`
			)
		}
		return { text: String(json?.text ?? "").trim(), isAborted: false, raw: json }
	}
}

/** audio.cpp, run by Serene Pub: the address comes from the process. */
export class AudioCppManagedTranscriptionAdapter extends AudioCppTranscriptionAdapter {
	protected noModelMessage =
		"No transcription model is chosen on audio.cpp, run by Serene Pub. Choose one for the Transcription loadout under Loadouts."

	protected async baseUrl(signal?: AbortSignal): Promise<string> {
		return stripRoot((await ensureAudioCppReadyUrl({ signal })).baseUrl)
	}
}

const exports: TranscriptionAdapterExports = {
	Adapter: AudioCppTranscriptionAdapter
}

export default exports

export const audioCppManagedTranscription: TranscriptionAdapterExports = {
	Adapter: AudioCppManagedTranscriptionAdapter
}
