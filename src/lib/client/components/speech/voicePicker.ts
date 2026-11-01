/**
 * 🚧 The voice picker's data contract (speech build, lane E seam). One picker
 * draws two kinds of list, and every surface that picks a voice uses it:
 *
 * - **service voices** — a speaking model's own voices off its speech facts
 *   (`SpeechFacts.voices`); picked when an admin makes a voicebank entry or
 *   sets the loadout's house voice. The list says where it came from
 *   (`voicesFrom`: discovered · catalogue · typed).
 * - **voicebank entries** — the pub's named voices (`voicebank:pickable`);
 *   picked by a card's Voice section and the session's narrator voice.
 *
 * Pure helpers only; the component is `VoicePicker.svelte` beside this file.
 * Pickers explain why (STYLE-GUIDE §6.6): a lede, the chosen value above the
 * list, the find row on long lists, and one origin line under the lede.
 */
import type {
	SpeechFacts,
	SpeechVoice
} from "$lib/shared/connectionAdapters/speechFacts"
import type { VoicebankPickableVoice } from "$lib/shared/speech/voicebank"

/** Where a picker's list came from — the origin line under the lede. */
export type VoiceListOrigin = SpeechFacts["voicesFrom"] | "voicebank"

/** The label keys a voice may carry, in filter order. */
export const VOICE_LABEL_KEYS = ["gender", "accent", "age", "useCase"] as const
export type VoiceLabelKey = (typeof VOICE_LABEL_KEYS)[number]

/** One row the picker draws. `key` is what the picker writes to `value`. */
export interface PickerVoice {
	/** Service voice id, or voicebank slug. */
	key: string
	name: string
	language?: string | null
	labels?: Partial<Record<VoiceLabelKey, string>>
	previewUrl?: string
	/** `clone` is read-only (listed, never created by the app). */
	kind?: SpeechVoice["kind"]
	/** One muted line under the name (a description, an entry's settings). */
	note?: string
}

export function voicesFromFacts(facts: SpeechFacts | null | undefined): PickerVoice[] {
	return (facts?.voices ?? []).map((v) => ({
		key: v.id,
		name: v.name,
		language: v.language ?? null,
		...(v.labels ? { labels: { ...v.labels } } : {}),
		...(v.previewUrl ? { previewUrl: v.previewUrl } : {}),
		kind: v.kind
	}))
}

export function voicesFromPickable(list: readonly VoicebankPickableVoice[] | null | undefined): PickerVoice[] {
	return (list ?? []).map((v) => ({
		key: v.slug,
		name: v.name,
		language: v.language,
		labels: { ...v.labels },
		...(v.previewUrl ? { previewUrl: v.previewUrl } : {})
	}))
}

/** The sentence under the lede saying where the list came from. */
export function originLine(origin: VoiceListOrigin | null | undefined): string | null {
	switch (origin) {
		case "discovered":
			return "Voices listed by the service itself."
		case "catalogue":
			return "The service cannot list its voices, so these come from Serene Pub's catalogue for this engine."
		case "typed":
			return "Voices typed in by an administrator; the service was not asked."
		case "voicebank":
			return "Voices from this pub's voicebank, set up by an administrator."
		default:
			return null
	}
}

const LABEL_NAMES: Record<VoiceLabelKey | "language", string> = {
	gender: "Gender",
	accent: "Accent",
	age: "Age",
	useCase: "Use case",
	language: "Language"
}

export interface VoiceFacet {
	key: VoiceLabelKey | "language"
	label: string
	/** Each value with how many voices carry it. */
	values: { value: string; count: number }[]
}

/**
 * Filters drawn from the voices' own labels — only the keys at least one
 * voice carries, with two or more distinct values (a one-value filter
 * narrows nothing).
 */
export function voiceFacets(voices: readonly PickerVoice[]): VoiceFacet[] {
	const out: VoiceFacet[] = []
	for (const key of ["language", ...VOICE_LABEL_KEYS] as const) {
		const counts = new Map<string, number>()
		for (const v of voices) {
			const raw = key === "language" ? v.language : v.labels?.[key]
			if (!raw) continue
			counts.set(raw, (counts.get(raw) ?? 0) + 1)
		}
		if (counts.size < 2) continue
		out.push({
			key,
			label: LABEL_NAMES[key],
			values: [...counts.entries()]
				.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
				.map(([value, count]) => ({ value, count }))
		})
	}
	return out
}

export type VoiceFilter = Partial<Record<VoiceLabelKey | "language", string>>

export function filterVoices(
	voices: readonly PickerVoice[],
	query: string,
	filter: VoiceFilter
): PickerVoice[] {
	const q = query.trim().toLowerCase()
	return voices.filter((v) => {
		for (const [k, want] of Object.entries(filter)) {
			if (!want) continue
			const have = k === "language" ? v.language : v.labels?.[k as VoiceLabelKey]
			if (have !== want) return false
		}
		if (!q) return true
		const hay = [v.name, v.key, v.language ?? "", ...Object.values(v.labels ?? {})]
			.join(" ")
			.toLowerCase()
		return hay.includes(q)
	})
}

/** "female · British · young" — a voice's labels as one muted line. */
export function labelLine(v: Pick<PickerVoice, "labels" | "language">): string {
	return [v.language, ...VOICE_LABEL_KEYS.map((k) => v.labels?.[k])]
		.filter((x): x is string => !!x)
		.join(" · ")
}

/** Value of the "no pick" row in the compact picker's list (a voicebank slug is never this). */
export const COMPACT_NONE = "__none__"

/**
 * The compact picker's rows: the optional "no pick" row, the voices, and — when the
 * stored value is not among them — that value kept as typed, so a stale pick is shown, not lost.
 */
export function compactOptions(
	voices: readonly PickerVoice[],
	value: string | null,
	none?: { label: string }
): { value: string; label: string; hint?: string }[] {
	const rows: { value: string; label: string; hint?: string }[] = []
	if (none) rows.push({ value: COMPACT_NONE, label: none.label })
	for (const v of voices) {
		const hint = labelLine(v)
		rows.push({ value: v.key, label: v.name, ...(hint ? { hint } : {}) })
	}
	if (value != null && !voices.some((v) => v.key === value))
		rows.push({ value, label: value, hint: "Not in the voicebank; kept as set." })
	return rows
}
