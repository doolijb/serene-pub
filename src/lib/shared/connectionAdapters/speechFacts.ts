/**
 * 🚧 **Speech facts** — what a speaking model can be asked for, as one record
 * stored under `connection_models.facts.speech` (json; no migration).
 *
 * Seam S1 of the speech build (PLAN-speech-build-2026-10-28 §1). Written by
 * lane B (the probe, the catalogues, the Refresh socket); read by the
 * voicebank, the runtime and the card's Voice editor. Its shape does not
 * change without the lead.
 *
 * ⚠ **Not `ModelFacts`** (`$lib/shared/connections/modelFacts.ts`). That bag
 * is the host's listing claim — context window, price, size — and is replaced
 * wholesale on every re-listing. Speech facts are a sibling key in the same
 * column, filled by a different writer (voice discovery or a shipped
 * catalogue), so they are read here, never through `readStoredFacts`.
 *
 * Every fact says where it came from (`voicesFrom`): **discovered** when the
 * service can say it (`/v1/audio/voices`, `/v2/voices`, `/api/show`),
 * **catalogue** when the engine is known and the service cannot (KoboldCPP's
 * Kokoro, audio.cpp's embedded presets), **typed** when the admin enters the
 * voice by hand. The UI always says which (the Pickers-explain-why ruling).
 */

/**
 * One voice a speaking model offers.
 *
 * `kind: 'clone'` is READ-ONLY: a clone the service already holds (an
 * ElevenLabs IVC voice, a `--ttsdir` WAV) is listed so it can be picked, but
 * the app never creates one (owner ruling 2026-10-28: no in-app cloning).
 */
export interface SpeechVoice {
	/** The service's own voice id — what goes on the wire as `voice`. */
	id: string
	/** What a person reads in the picker. */
	name: string
	/** BCP 47-ish language the voice speaks ("en-US", "ja"), when known. */
	language?: string
	labels?: {
		gender?: string
		accent?: string
		age?: string
		useCase?: string
	}
	/** A sample the picker can play. Never fetched by the server. */
	previewUrl?: string
	kind: "preset" | "clone" | "designed"
}

/** The expression controls a model honours. An absent key means "not honoured". */
export interface SpeechControls {
	/** Honoured rate range; absent when the service refuses `speed` (Ollama). */
	speed?: { min: number; max: number }
	/** Free prose steering — Qwen3 CustomVoice/VoiceDesign, gpt-4o-mini-tts, audio.cpp instruct families. */
	instruction?: "prose"
	/**
	 * The instruction IS the voice (Qwen3 VoiceDesign): every call designs a
	 * voice from the prose, so the same description with a different seed is
	 * a different person. The speak step pins one seed per voice and keeps
	 * the instruction to the timbre description, so a reply spoken in several
	 * calls stays one voice (owner report, 2026-10-29).
	 */
	designsVoice?: true
	/** Inline tags in the text: ElevenLabs v3/v4-turbo, KittenTTS 2's ten. */
	tags?: { syntax: "bracket"; vocabulary: readonly string[] | "open" }
	/** ElevenLabs-style dials. */
	settings?: readonly ("stability" | "similarity" | "style" | "speakerBoost")[]
	/** Languages the model may be asked to speak in. */
	language?: readonly string[]
	/** One request may carry more than one speaker. */
	multiSpeaker?: boolean
}

export interface SpeechFacts {
	voices: SpeechVoice[]
	voicesFrom: "discovered" | "catalogue" | "typed"
	controls: SpeechControls
	/** The service can stream the audio back (recorded; playback is whole-file in phase 1). */
	streams: boolean
	/** `response_format` values the service accepts. */
	formats: readonly string[]
	/** Hz, when the service says or the engine is known. */
	sampleRate?: number
	/** ISO date the service shuts the model down (OpenAI's speech models: 2027-01-06). */
	deprecatedOn?: string
	/** A notice the picker must show (e.g. KittenTTS 2's "Powered by KittenML"). */
	notice?: string
}

/** The key under `connection_models.facts` this record lives at. */
export const SPEECH_FACTS_KEY = "speech"

const VOICE_KINDS = new Set(["preset", "clone", "designed"])
const VOICES_FROM = new Set(["discovered", "catalogue", "typed"])
const SETTINGS = new Set(["stability", "similarity", "style", "speakerBoost"])

const str = (v: unknown): string | undefined =>
	typeof v === "string" && v.trim() ? v : undefined
const num = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isFinite(v) ? v : undefined
const strList = (v: unknown): string[] | undefined =>
	Array.isArray(v)
		? v.filter((x): x is string => typeof x === "string" && !!x.trim())
		: undefined

function readVoice(v: unknown): SpeechVoice | null {
	if (!v || typeof v !== "object") return null
	const o = v as Record<string, unknown>
	const id = str(o.id)
	if (!id) return null
	const kind = VOICE_KINDS.has(o.kind as string)
		? (o.kind as SpeechVoice["kind"])
		: "preset"
	const voice: SpeechVoice = { id, name: str(o.name) ?? id, kind }
	const language = str(o.language)
	if (language) voice.language = language
	const previewUrl = str(o.previewUrl)
	if (previewUrl) voice.previewUrl = previewUrl
	if (o.labels && typeof o.labels === "object") {
		const l = o.labels as Record<string, unknown>
		const labels: NonNullable<SpeechVoice["labels"]> = {}
		for (const k of ["gender", "accent", "age", "useCase"] as const) {
			const s = str(l[k])
			if (s) labels[k] = s
		}
		if (Object.keys(labels).length) voice.labels = labels
	}
	return voice
}

function readControls(v: unknown): SpeechControls {
	const out: SpeechControls = {}
	if (!v || typeof v !== "object") return out
	const c = v as Record<string, unknown>
	if (c.speed && typeof c.speed === "object") {
		const s = c.speed as Record<string, unknown>
		const min = num(s.min)
		const max = num(s.max)
		if (min !== undefined && max !== undefined && min <= max)
			out.speed = { min, max }
	}
	if (c.instruction === "prose") out.instruction = "prose"
	if (c.designsVoice === true) out.designsVoice = true
	if (c.tags && typeof c.tags === "object") {
		const t = c.tags as Record<string, unknown>
		if (t.syntax === "bracket") {
			const vocabulary =
				t.vocabulary === "open" ? "open" : strList(t.vocabulary)
			if (vocabulary) out.tags = { syntax: "bracket", vocabulary }
		}
	}
	const settings = strList(c.settings)?.filter((s) => SETTINGS.has(s))
	if (settings?.length)
		out.settings = settings as NonNullable<SpeechControls["settings"]>
	const language = strList(c.language)
	if (language?.length) out.language = language
	if (typeof c.multiSpeaker === "boolean") out.multiSpeaker = c.multiSpeaker
	return out
}

/**
 * The speech facts off a `connection_models.facts` bag, field by field.
 *
 * Takes the WHOLE facts column (not `facts.speech`) so a reader never has to
 * know the key. `null` when the bag has no speech record or it is not one:
 * a reader then says "no voices known — Refresh, or type one", never guesses.
 */
export function readSpeechFacts(facts: unknown): SpeechFacts | null {
	if (!facts || typeof facts !== "object") return null
	const raw = (facts as Record<string, unknown>)[SPEECH_FACTS_KEY]
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
	const s = raw as Record<string, unknown>
	if (!VOICES_FROM.has(s.voicesFrom as string)) return null
	const voices = Array.isArray(s.voices)
		? s.voices.map(readVoice).filter((v): v is SpeechVoice => !!v)
		: []
	const out: SpeechFacts = {
		voices,
		voicesFrom: s.voicesFrom as SpeechFacts["voicesFrom"],
		controls: readControls(s.controls),
		streams: s.streams === true,
		formats: strList(s.formats) ?? []
	}
	const sampleRate = num(s.sampleRate)
	if (sampleRate !== undefined && sampleRate > 0) out.sampleRate = sampleRate
	const deprecatedOn = str(s.deprecatedOn)
	if (deprecatedOn) out.deprecatedOn = deprecatedOn
	const notice = str(s.notice)
	if (notice) out.notice = notice
	return out
}

/**
 * A facts bag with its speech record replaced (or removed, for `null`), every
 * other key kept. The one way a writer puts speech facts into the column.
 */
export function withSpeechFacts(
	facts: unknown,
	speech: SpeechFacts | null
): Record<string, unknown> {
	const bag: Record<string, unknown> =
		facts && typeof facts === "object" && !Array.isArray(facts)
			? { ...(facts as Record<string, unknown>) }
			: {}
	if (speech) bag[SPEECH_FACTS_KEY] = speech
	else delete bag[SPEECH_FACTS_KEY]
	return bag
}
