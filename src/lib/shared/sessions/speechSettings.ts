/**
 * 🚧 A session's **speech settings** (PLAN-speech-build seam S7, 2026-10-28):
 * the client-safe reader of the four genre fields story, guide and lair
 * declare (core-catalog `shared/speechFields.ts`, the declaration; this file
 * is its twin — same key table as literals, lane V pins them equal).
 *
 * Stored in `sessions.genre_fields`, resolved by the session settings
 * cascade into the settings document's `fields`. Pass this either the
 * cascaded `fields` or the raw `genre_fields`; absent keys take the default.
 * No server or core-catalog imports: the client draws from this too.
 */

/** The S7 key table: short name → the genre field key (storage). */
export const SPEECH_FIELD_KEYS = {
	readAloud: "speechReadAloud",
	template: "speechTemplate",
	narratorVoice: "speechNarratorVoice",
	// reserved — not declared until implemented (lead 2026-10-28)
	narrateUser: "speechNarrateUser",
	language: "sessionLanguage"
} as const

/** Off · make the audio · make it and play it. */
export const READ_ALOUD_MODES = ["off", "make", "play"] as const
export type ReadAloudMode = (typeof READ_ALOUD_MODES)[number]

/** The three shipped line template ids (core-catalog `SPOKEN_LINE_TEMPLATE_IDS`, as literals). */
export const SPEECH_TEMPLATE_IDS = {
	whole: "core:template/pipeline-context-template-core-spoken-line-whole@1",
	dialogue: "core:template/pipeline-context-template-core-spoken-line-dialogue@1",
	narration: "core:template/pipeline-context-template-core-spoken-line-narration@1"
} as const

export interface SpeechSessionSettings {
	readAloud: ReadAloudMode
	/** A known line template id the session chose; null = the speak step's own line template. */
	template: string | null
	/** A voicebank slug, or null for none. */
	narratorVoice: string | null
	/** ISO 639-1, lower-cased, or null for none. */
	language: string | null
}

const blank = (v: unknown): string | null =>
	typeof v === "string" && v.trim() ? v.trim() : null

const TEMPLATE_IDS: readonly string[] = Object.values(SPEECH_TEMPLATE_IDS)

/** Defaults applied, blank → null, language lower-cased. Never throws. */
export function readSpeechSessionSettings(fields: unknown): SpeechSessionSettings {
	const f: Record<string, unknown> =
		fields && typeof fields === "object" && !Array.isArray(fields)
			? (fields as Record<string, unknown>)
			: {}
	const mode = f[SPEECH_FIELD_KEYS.readAloud]
	const template = blank(f[SPEECH_FIELD_KEYS.template])
	return {
		readAloud: (READ_ALOUD_MODES as readonly unknown[]).includes(mode)
			? (mode as ReadAloudMode)
			: "off",
		template: template && TEMPLATE_IDS.includes(template) ? template : null,
		narratorVoice: blank(f[SPEECH_FIELD_KEYS.narratorVoice]),
		language: blank(f[SPEECH_FIELD_KEYS.language])?.toLowerCase() ?? null
	}
}

/**
 * 🚧 **Envoy voices** (speech follow-ups B6/C10, 2026-10-29): a keyed family
 * of genre fields, one set per envoy the session's genre enables —
 * `speechEnvoyVoice:<envoySlug>` (a voicebank slug, admin-picked like the
 * narrator voice) and the same for the narration inside that envoy's lines
 * (`speechEnvoyNarrationVoice:`). The old description kinds are gone; stored
 * values are ignored.
 *
 * Not declared per key by any genre (the envoys are the genre's, the slugs
 * open-ended), so they live in `sessions.genre_fields` under these prefixes
 * and are read raw — never through the cascade's declared-key filter.
 * Blank is none; absent keys read as null.
 */
export const SPEECH_ENVOY_FIELD_PREFIXES = {
	voice: "speechEnvoyVoice:",
	narrationVoice: "speechEnvoyNarrationVoice:"
} as const
export type SpeechEnvoyFieldKind = keyof typeof SPEECH_ENVOY_FIELD_PREFIXES

/** One envoy's speech settings in a session. */
export interface EnvoySpeech {
	/** A voicebank slug for the envoy's dialogue, or null. */
	voice: string | null
	/** A voicebank slug for the narration inside the envoy's lines, or null. */
	narrationVoice: string | null
}

/** The genre field key for one envoy's setting: `speechEnvoyVoice:<envoySlug>`. */
export function speechEnvoyFieldKey(kind: SpeechEnvoyFieldKind, envoySlug: string): string {
	return SPEECH_ENVOY_FIELD_PREFIXES[kind] + envoySlug
}

/** `{ kind, envoySlug }` for a key of the envoy family, else null (also null for an empty slug). */
export function parseSpeechEnvoyFieldKey(
	key: string
): { kind: SpeechEnvoyFieldKind; envoySlug: string } | null {
	for (const kind of Object.keys(SPEECH_ENVOY_FIELD_PREFIXES) as SpeechEnvoyFieldKind[]) {
		const prefix = SPEECH_ENVOY_FIELD_PREFIXES[kind]
		if (key.startsWith(prefix)) {
			const envoySlug = key.slice(prefix.length)
			return envoySlug ? { kind, envoySlug } : null
		}
	}
	return null
}

const fieldsRecord = (fields: unknown): Record<string, unknown> =>
	fields && typeof fields === "object" && !Array.isArray(fields)
		? (fields as Record<string, unknown>)
		: {}

/** One envoy's settings off `genre_fields` (or a cascaded `fields`). Never throws. */
export function readEnvoySpeech(fields: unknown, envoySlug: string): EnvoySpeech {
	const f = fieldsRecord(fields)
	return {
		voice: blank(f[speechEnvoyFieldKey("voice", envoySlug)]),
		narrationVoice: blank(f[speechEnvoyFieldKey("narrationVoice", envoySlug)])
	}
}

/** Every envoy that has at least one key of the family stored, by slug. */
export function readAllEnvoySpeech(fields: unknown): Record<string, EnvoySpeech> {
	const f = fieldsRecord(fields)
	const slugs = new Set<string>()
	for (const key of Object.keys(f)) {
		const parsed = parseSpeechEnvoyFieldKey(key)
		if (parsed) slugs.add(parsed.envoySlug)
	}
	const out: Record<string, EnvoySpeech> = {}
	for (const slug of slugs) out[slug] = readEnvoySpeech(f, slug)
	return out
}

/**
 * 🚧 **Auto voice picks** (narration-fallback lane, 2026-10-30): the per-session
 * sticky choice Auto made for a speaker with no voice of its own, stored in
 * `sessions.genre_fields` as `speechAutoVoice:<speakerRef>` = a voicebank slug.
 * Written only by the resolver (never a client: create/update filter to the
 * genre's declared keys); read raw, like the envoy family.
 */
export const SPEECH_AUTO_VOICE_PREFIX = "speechAutoVoice:"

/** The genre field key of one speaker's auto voice pick. */
export const speechAutoVoiceKey = (speakerRef: string): string => SPEECH_AUTO_VOICE_PREFIX + speakerRef

/** The slug Auto picked for a speaker, or null. Never throws. */
export function readAutoVoice(fields: unknown, speakerRef: string): string | null {
	return blank(fieldsRecord(fields)[speechAutoVoiceKey(speakerRef)])
}

/** Every stored auto pick, by speaker ref. */
export function readAllAutoVoices(fields: unknown): Record<string, string> {
	const out: Record<string, string> = {}
	for (const [k, v] of Object.entries(fieldsRecord(fields))) {
		if (!k.startsWith(SPEECH_AUTO_VOICE_PREFIX) || k.length === SPEECH_AUTO_VOICE_PREFIX.length) continue
		const slug = blank(v)
		if (slug) out[k.slice(SPEECH_AUTO_VOICE_PREFIX.length)] = slug
	}
	return out
}
