/**
 * 🚧 Pure helpers of the shared voice fields (`VoiceFields.svelte`): one draft
 * shape for the parts of a voice a person edits, with adapters to a voicebank
 * entry and to a character's timbre. Nothing here touches a socket.
 *
 * The draft holds only what the form edits. Adapters take the stored
 * `settings` as `base` so a key the form never shows (a dial the model does
 * not list, a plugin's extra) is carried through, never dropped.
 */
import type {
	CharacterTimbreInput,
	TimbreSettings
} from "$lib/shared/characters/timbre"
import type {
	VoiceControls,
	VoicebankSettings,
	VoicebankVoiceView
} from "$lib/shared/speech/voicebank"

export type VoiceDial = "stability" | "similarity" | "style" | "speakerBoost"

/** The fields the voice form edits; `null`/`""` = "the voice's own". */
export interface VoiceDraft {
	description: string
	/** ISO 639-1; "" = none (the voice's own). */
	language: string
	speed: number | null
	/** Sampling seed; on a voice-designing model it picks the person. */
	seed: number | null
	stability: number | null
	similarity: number | null
	style: number | null
	speakerBoost: boolean | null
}

export function emptyVoiceDraft(): VoiceDraft {
	return {
		description: "",
		language: "",
		speed: null,
		seed: null,
		stability: null,
		similarity: null,
		style: null,
		speakerBoost: null
	}
}

/** The keys the draft owns inside `settings`, in display order. */
const OWNED = ["speed", "seed", "stability", "similarity", "style", "speakerBoost"] as const

type SettingsLike = Partial<Record<(typeof OWNED)[number], number | boolean>> & Record<string, unknown>

function draftOfSettings(s: SettingsLike | undefined) {
	const num = (k: string) => (typeof s?.[k] === "number" ? (s![k] as number) : null)
	return {
		speed: num("speed"),
		seed: num("seed"),
		stability: num("stability"),
		similarity: num("similarity"),
		style: num("style"),
		speakerBoost: typeof s?.speakerBoost === "boolean" ? s.speakerBoost : null
	}
}

/** `base` with every key the draft owns replaced by the draft's value (absent when null). */
function settingsOf(d: VoiceDraft, base: SettingsLike | undefined): Record<string, unknown> {
	const out: Record<string, unknown> = { ...(base ?? {}) }
	for (const k of OWNED) {
		const v = d[k]
		if (v == null) delete out[k]
		else out[k] = v
	}
	return out
}

// ── Voicebank entry ────────────────────────────────────────────────────────

export function voiceDraftOfEntry(
	v: Pick<VoicebankVoiceView, "description" | "language" | "settings">
): VoiceDraft {
	return {
		description: v.description ?? "",
		language: v.language ?? "",
		...draftOfSettings(v.settings as SettingsLike)
	}
}

/** The entry parts for a create/update payload; `base` = the stored settings. */
export function voiceDraftToEntryParts(
	d: VoiceDraft,
	base?: VoicebankSettings
): { description: string | null; language: string | null; settings: VoicebankSettings } {
	return {
		description: d.description.trim() || null,
		language: d.language.trim() || null,
		settings: settingsOf(d, base as SettingsLike) as VoicebankSettings
	}
}

// ── Character timbre ───────────────────────────────────────────────────────

type TimbreParts = Pick<CharacterTimbreInput, "description" | "language" | "settings">

export function voiceDraftOfTimbre(t: TimbreParts | null | undefined): VoiceDraft {
	return {
		description: t?.description ?? "",
		language: t?.language ?? "",
		...draftOfSettings(t?.settings as SettingsLike | undefined)
	}
}

/** The timbre parts; blank description/language and empty settings are omitted. */
export function voiceDraftToTimbreParts(d: VoiceDraft, base?: TimbreSettings): TimbreParts {
	const out: TimbreParts = {}
	const description = d.description.trim()
	if (description) out.description = description
	const language = d.language.trim()
	if (language) out.language = language
	const settings = settingsOf(d, base as SettingsLike)
	if (Object.keys(settings).length) out.settings = settings as TimbreSettings
	return out
}

// ── What the model lists ───────────────────────────────────────────────────

/** The dials the model honours, in its own order; none when controls are unknown. */
export function dialsOf(c: VoiceControls | null | undefined): VoiceDial[] {
	return [...(c?.settings ?? [])]
}

export const SPEED_FALLBACK = { min: 0.25, max: 4 } as const

/** Speed bounds: the model's range, else 0.25–4 when controls are known; null when unknown. */
export function speedBoundsOf(
	c: VoiceControls | null | undefined
): { min: number; max: number } | null {
	if (!c) return null
	return c.speed ? { min: c.speed.min, max: c.speed.max } : { ...SPEED_FALLBACK }
}

export function descriptionCopy(c: VoiceControls | null | undefined): {
	label: string
	help: string
	placeholder: string
} {
	if (c?.designsVoice)
		return {
			label: "The voice itself",
			help: "This model designs its voice from this description; there are no named voices to pick. The seed below picks which person.",
			placeholder: "A warm low alto, slight Irish lilt, unhurried"
		}
	return {
		label: "Description",
		help: c?.instruction === "prose"
			? "In your own words. This model also takes it as direction for how the voice speaks."
			: c
				? "In your own words. This model does not read it; a model that takes direction does."
				: "In your own words: who this voice is.",
		placeholder: "Optional: who this voice is for"
	}
}

const DIAL_COPY: Record<Exclude<VoiceDial, "speakerBoost">, string> = {
	stability: "Stability",
	similarity: "Similarity",
	style: "Style"
}
export const dialLabel = (d: VoiceDial) => (d === "speakerBoost" ? "Speaker boost" : DIAL_COPY[d])

/**
 * The overrides the try-out sends, from the draft: speed and the dials the
 * model honours that are set. Seed is not here (VoiceTryout adds it).
 */
export function settingsForTryout(
	d: VoiceDraft,
	c: VoiceControls | null | undefined
): VoicebankSettings {
	const out: VoicebankSettings = {}
	if (d.speed != null) out.speed = d.speed
	for (const k of dialsOf(c)) {
		const v = d[k]
		if (v != null) (out as Record<string, number | boolean>)[k] = v
	}
	return out
}
