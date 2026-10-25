/**
 * 🚧 Any OpenAI-compatible `/audio/transcriptions` endpoint (O9, 2026-10-21) —
 * OpenAI itself (`whisper-1`, `gpt-4o-transcribe`, …) and the compatible
 * servers that answer the route.
 *
 * The `transcription` module of the `openai` type (`adapters/registry.ts`):
 * one OpenAI-compatible connection per service chats through
 * `OpenAIChatAdapter` and hears through this — a module of its own because
 * `/audio/transcriptions` is a different route, a multipart upload rather
 * than JSON, the case the manifest makes for images and embeddings. Whether a
 * service hears is the `audio->text` switch (its preset's claim, or the
 * person's); which model hears is the model's reads (O3).
 *
 * The base URL is the chat adapter's: the stored one, else OpenAI's own, and
 * the route goes after it the way the OpenAI client puts `/chat/completions`.
 */

import {
	BaseTranscriptionAdapter,
	type TranscribeRequest,
	type TranscribeResult,
	type TranscriptionAdapterExports
} from "./BaseTranscriptionAdapter"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { extensionForMime } from "$lib/shared/media/formats"

/** The model a connection that names none hears with — OpenAI's own. */
export const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1"

/** The route, after the base URL. */
export function openAITranscriptionsUrl(baseUrl: string | null | undefined): string {
	const base =
		normalizeBaseUrl(baseUrl) ||
		normalizeBaseUrl(CONNECTION_DEFAULTS[CONNECTION_TYPE.OPENAI].baseUrl) ||
		"https://api.openai.com/v1"
	return `${base}/audio/transcriptions`
}

/**
 * The multipart body: the file under a name with its format's extension
 * (servers sniff by it), the model, and the two optional hints.
 */
export function transcriptionForm(
	req: TranscribeRequest,
	model: string
): FormData {
	const form = new FormData()
	const ext = extensionForMime(req.audio.mime) ?? "wav"
	const name =
		req.audio.filename && /\.[a-z0-9]+$/i.test(req.audio.filename)
			? req.audio.filename
			: `audio.${ext}`
	// A copy into a plain ArrayBuffer-backed view: what `Blob` takes, whatever
	// the caller's buffer was backed by.
	const bytes = new Uint8Array(req.audio.bytes)
	form.append("file", new Blob([bytes], { type: req.audio.mime }), name)
	form.append("model", model)
	form.append("response_format", "json")
	if (req.language) form.append("language", req.language)
	if (req.prompt) form.append("prompt", req.prompt)
	return form
}

export class OpenAITranscriptionAdapter extends BaseTranscriptionAdapter {
	async transcribeAudio(
		req: TranscribeRequest,
		opts?: { signal?: AbortSignal }
	): Promise<TranscribeResult> {
		const key = (this.connection.extraJson as { apiKey?: unknown } | null)?.apiKey
		// Dynamic, for the reason `embeddingApiKey` gives: `tokenCrypto`
		// imports the database, which a module load must not pay for.
		const apiKey = key
			? ((await import("$lib/server/utils/tokenCrypto")).decryptApiKeyField(key as never) ?? null)
			: null
		const model = this.connection.model || DEFAULT_TRANSCRIPTION_MODEL
		let res: Response
		try {
			res = await fetch(openAITranscriptionsUrl(this.connection.baseUrl), {
				method: "POST",
				headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
				body: transcriptionForm(req, model),
				signal: opts?.signal
			})
		} catch (err: any) {
			if (opts?.signal?.aborted) return { text: "", isAborted: true }
			throw new Error(`The transcription request did not reach the service: ${err?.message ?? err}`)
		}
		if (!res.ok) {
			let detail = ""
			try {
				detail = (await res.text()).slice(0, 500)
			} catch {
				detail = ""
			}
			throw new Error(
				`The transcription request failed (${res.status})${detail ? `: ${detail}` : ""}`
			)
		}
		const raw = (await res.json()) as { text?: unknown }
		const text = typeof raw?.text === "string" ? raw.text.trim() : ""
		return { text, isAborted: false, raw }
	}
}

const exports: TranscriptionAdapterExports = {
	Adapter: OpenAITranscriptionAdapter
}

export default exports
