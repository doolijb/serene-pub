/**
 * 🚧 The OpenAI-speech dialect engine (PLAN-speech-build S9, lane B1):
 * `POST <base><route>` with OpenAI's `/audio/speech` JSON body, driven by one
 * `OpenAiSpeechProfile` per connection type.
 *
 * ⚠ Wire policy. `model` and `voice` are sent whenever they resolve to a
 * non-empty value, whatever `honoured` says about them being "keys": OpenAI
 * requires both and Ollama accepts both. Every OTHER field goes only when the
 * partition put its key in `applied` — nothing in `ignored` is ever sent.
 */

import { withBusyRetry } from "./busyRetry"
import {
	BaseSpeechAdapter,
	partitionSpeechKeys,
	type SpeechAdapterExports,
	type SpeechRequest,
	type SpeechResult,
	type SpeechRequestKey
} from "./BaseSpeechAdapter"
import type { OpenAiSpeechProfile } from "./speechProfile"
import { modelServerFetch } from "../modelServerFetch"

const MIME_BY_FORMAT: Record<string, string> = {
	mp3: "audio/mpeg",
	opus: "audio/ogg",
	aac: "audio/aac",
	flac: "audio/flac",
	wav: "audio/wav",
	pcm: "audio/pcm"
}

export function mimeForFormat(format: string): string {
	return MIME_BY_FORMAT[format.toLowerCase()] ?? "application/octet-stream"
}

/**
 * Duration of a WAV in ms. Streaming servers (Ollama) write the maximum size
 * into the header, so the length comes from the ACTUAL byte count and the
 * header's byteRate. `undefined` when the bytes are not a canonical WAV.
 */
export function wavDurationMs(bytes: Uint8Array): number | undefined {
	if (bytes.length < 44) return undefined
	const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4))
	if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return undefined
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	let off = 12
	let byteRate = 0
	while (off + 8 <= bytes.length) {
		const id = tag(off)
		const size = dv.getUint32(off + 4, true)
		if (id === "fmt " && off + 20 <= bytes.length) {
			byteRate = dv.getUint32(off + 16, true)
		} else if (id === "data") {
			if (!byteRate) return undefined
			const actual = bytes.length - (off + 8)
			const len = size > 0 && size <= actual ? size : actual
			return Math.round((len / byteRate) * 1000)
		}
		off += 8 + size + (size % 2)
		if (size === 0xffffffff) return undefined
	}
	return undefined
}

function setDotted(body: Record<string, unknown>, path: string, value: unknown) {
	const parts = path.split(".")
	let cur = body
	for (let i = 0; i < parts.length - 1; i++) {
		const next = cur[parts[i]]
		if (!next || typeof next !== "object") cur[parts[i]] = {}
		cur = cur[parts[i]] as Record<string, unknown>
	}
	cur[parts[parts.length - 1]] = value
}

/** The service's own error text, trimmed to something readable. */
function errorText(raw: string): string {
	let text = raw.trim()
	try {
		const j = JSON.parse(text)
		const m = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail
		if (typeof m === "string" && m) text = m
	} catch {
		/* plain text */
	}
	return text.length > 300 ? `${text.slice(0, 300)}…` : text
}

export function createOpenAiSpeechModule(
	profile: OpenAiSpeechProfile
): SpeechAdapterExports {
	class OpenAiSpeechAdapter extends BaseSpeechAdapter {
		async synthesizeSpeech(
			req: SpeechRequest,
			opts?: { signal?: AbortSignal }
		): Promise<SpeechResult> {
			const conn = this.connection
			const model = req.model || conn.model || profile.defaultModel || ""
			const honoured: readonly SpeechRequestKey[] =
				profile.honouredFor?.(model, conn) ?? profile.honoured
			const { applied, ignored } = partitionSpeechKeys(req, honoured)
			const drop = (k: SpeechRequestKey) => {
				const i = applied.indexOf(k)
				if (i >= 0) applied.splice(i, 1)
				if (!ignored.includes(k)) ignored.push(k)
			}
			const has = (k: SpeechRequestKey) => applied.includes(k)

			const body: Record<string, unknown> = {}
			if (model) body.model = model
			let input = req.text
			if (has("tags") && profile.tagsInline && req.tags?.length)
				input = `${req.tags.join(" ")} ${input}`
			else if (has("tags")) drop("tags")
			body.input = input
			const voice = req.voice?.trim() ?? ""
			if (voice) body.voice = voice

			let format = profile.defaultFormat
			if (req.format) {
				if (has("format") && profile.formats.includes(req.format.toLowerCase()))
					format = req.format.toLowerCase()
				else drop("format")
			}
			if (!(profile.omitDefaultFormat && format === profile.defaultFormat))
				body.response_format = format

			if (has("speed")) {
				const r = profile.speedRange
				const clamped = r
					? Math.min(r.max, Math.max(r.min, req.speed as number))
					: (req.speed as number)
				if (clamped !== req.speed) ignored.push("speed")
				body.speed = clamped
			}
			if (has("direction")) {
				if (profile.directionField)
					setDotted(body, profile.directionField, req.direction)
				else drop("direction")
			}
			if (has("language")) {
				if (profile.languageField) body[profile.languageField] = req.language
				else drop("language")
			}
			if (has("seed")) {
				if (profile.seedField) setDotted(body, profile.seedField, req.seed)
				else drop("seed")
			}

			const headers: Record<string, string> = {
				"Content-Type": "application/json"
			}
			if (profile.bearerAuth) {
				const key = (conn.extraJson as { apiKey?: unknown } | null)?.apiKey
				const apiKey = key
					? ((await import("$lib/server/utils/tokenCrypto")).decryptApiKeyField(
							key as never
						) ?? null)
					: null
				if (apiKey) headers.Authorization = `Bearer ${apiKey}`
			}

			const spokenAs = { voice, model, connection: conn.id }
			const url = `${await profile.baseUrl(conn)}${profile.route}`
			let res: Response
			let busyText = ""
			try {
				const got = await withBusyRetry(
					async () => {
						const r = await modelServerFetch(url, {
							method: "POST",
							headers,
							body: JSON.stringify(body),
							signal: opts?.signal
						})
						return { res: r, bodyText: r.ok ? "" : await r.text().catch(() => "") }
					},
					{ signal: opts?.signal }
				)
				res = got.res
				busyText = got.bodyText
			} catch (err: any) {
				if (opts?.signal?.aborted)
					return { media: [], isAborted: true, applied, ignored, spokenAs }
				throw new Error(
					`The speech request did not reach the service: ${err?.message ?? err}`
				)
			}
			if (!res.ok) {
				const text = busyText
				throw new Error(
					`The service refused the speech request (HTTP ${res.status}): ${errorText(text) || res.statusText}`
				)
			}
			let bytes: Uint8Array
			try {
				bytes = new Uint8Array(await res.arrayBuffer())
			} catch (err: any) {
				if (opts?.signal?.aborted)
					return { media: [], isAborted: true, applied, ignored, spokenAs }
				throw err
			}
			const ctype = res.headers.get("content-type")?.split(";")[0].trim()
			const mime =
				ctype && ctype.startsWith("audio/") ? ctype : mimeForFormat(format)
			const durationMs = mime.includes("wav") ? wavDurationMs(bytes) : undefined
			return {
				media: [
					{
						kind: "audio",
						mime,
						base64: Buffer.from(bytes).toString("base64"),
						...(durationMs !== undefined ? { durationMs } : {})
					}
				],
				isAborted: false,
				applied,
				ignored,
				spokenAs,
				raw: { status: res.status, contentType: ctype ?? null, bytes: bytes.length }
			}
		}
	}

	return {
		Adapter: OpenAiSpeechAdapter,
		...(profile.discoverSpeechFacts
			? { discoverSpeechFacts: profile.discoverSpeechFacts.bind(profile) }
			: {}),
		...(profile.listModels ? { listModels: profile.listModels.bind(profile) } : {}),
		...(profile.testConnection
			? { testConnection: profile.testConnection.bind(profile) }
			: {})
	}
}
