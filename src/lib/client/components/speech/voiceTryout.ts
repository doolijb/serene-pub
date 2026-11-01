/**
 * 🚧 Pure helpers of the voice try-out control (`VoiceTryout.svelte`): the
 * request it sends, the seed it rolls, the words under the clip.
 */
import {
	VOICE_SEED_MAX,
} from "$lib/shared/speech/voiceTryout"

type Params = Sockets.Voicebank.Preview.Params
type Reply = Sockets.Voicebank.Preview.Response

/** What the host supplies; the control adds the line, seed, mood and request id. */
export type VoiceTryoutRequest = Omit<Params, "requestId" | "text" | "inflection">

export function previewParams(
	base: VoiceTryoutRequest,
	opts: {
		requestId: string
		text: string
		seed: number | null
		inflection: string | null
	}
): Params {
	const { settings: baseSettings, voice, voiceId, description, language, ...rest } = base
	const { seed: _drop, ...others } = (baseSettings ?? {}) as Record<string, unknown>
	const settings = (opts.seed == null ? others : { ...others, seed: opts.seed }) as Params["settings"]
	const out: Params = { ...rest, requestId: opts.requestId }
	const text = opts.text.trim()
	if (text) out.text = text
	if (typeof voice === "string" && voice.trim()) out.voice = voice
	if (typeof voiceId === "string" && voiceId.trim()) out.voiceId = voiceId.trim()
	if (typeof description === "string" && description.trim()) out.description = description
	if (typeof language === "string" && language.trim()) out.language = language.trim()
	if (opts.inflection && opts.inflection.trim()) out.inflection = opts.inflection
	if (settings && Object.keys(settings).length) out.settings = settings
	return out
}

/** A fresh seed: an integer from 0 to VOICE_SEED_MAX. */
export function rerollSeed(random: () => number = Math.random): number {
	return Math.min(VOICE_SEED_MAX, Math.floor(random() * (VOICE_SEED_MAX + 1)))
}

/** A number-input value to a seed, or null when it is not a usable one. */
export function parseSeedInput(raw: unknown): number | null {
	if (typeof raw !== "number" || !Number.isInteger(raw)) return null
	return raw >= 0 && raw <= VOICE_SEED_MAX ? raw : null
}

export function seedHint(designsVoice: boolean): string {
	return designsVoice
		? "This model designs its voice from the description; the seed picks which person. Re-roll until you like one, and the voice then stays the same in every line."
		: "Sent to services that take a seed. Blank sends none."
}

export function clipCaption(res: Pick<Reply, "spokenAs" | "seed">): string {
	const parts: string[] = []
	const as = res.spokenAs
	const who = [as?.voice, as?.model].filter((s) => !!s).join(" · ")
	if (who) parts.push(`Spoken as ${who}`)
	if (typeof res.seed === "number") parts.push(`seed ${res.seed}`)
	return parts.join(" · ")
}

export function bytesToBlob(base64: string, mime: string): Blob {
	const bin = atob(base64)
	const arr = new Uint8Array(bin.length)
	for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
	return new Blob([arr], { type: mime })
}

/** Seconds to a clock: 0:07, 1:05. Unknown or negative reads 0:00. */
export function formatClock(sec: number | null | undefined): string {
	const s = typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** The seed as a person: "person #355260212". */
export function seedChipLabel(seed: number): string {
	return `person #${seed}`
}
