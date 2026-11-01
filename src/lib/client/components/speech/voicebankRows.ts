/**
 * 🚧 Pure helpers for the Voices panel (Loadouts) and the model page's Voices
 * table — speech build, lane E2. Nothing here touches a socket.
 */
import {
	readSpeechFacts,
	type SpeechFacts
} from "$lib/shared/connectionAdapters/speechFacts"
import type {
	VoicebankLabels,
	VoicebankLoadoutOption,
	VoicebankVoiceInput,
	VoicebankVoiceView
} from "$lib/shared/speech/voicebank"
import { emptyVoiceDraft, voiceDraftOfEntry, voiceDraftToEntryParts, type VoiceDraft } from "./voiceFields"

/**
 * A model row's speech facts. ⏳ `connections:models` rows do not carry
 * `speech` yet (★E1): read it defensively so this lights up the day the
 * server adds the field; the `models:refreshSpeech` reply fills in meanwhile.
 */
export function speechFactsOfRow(row: unknown): SpeechFacts | null {
	if (!row || typeof row !== "object") return null
	return readSpeechFacts({ speech: (row as { speech?: unknown }).speech })
}

/**
 * ONE consequence line for a row — describes what the entry does, never
 * grades it (§6.6).
 */
export function consequenceLine(v: VoicebankVoiceView): string {
	if (v.unusableReason) return `Skipped when speaking: ${v.unusableReason}`
	if (!v.enabled) return "Switched off: skipped when speaking."
	return "Picked by name from cards and sessions."
}

/** The form's working copy: the entry's own fields plus the shared voice draft. */
export interface VoicebankDraft {
	name: string
	/** The loadout the voice speaks through; null until picked. */
	loadoutId: number | null
	voiceId: string
	enabled: boolean
	labels: VoicebankLabels
	/** Description, language, speed, seed and dials (the shared `VoiceFields` draft). */
	voice: VoiceDraft
}

/** A new voice starts on `loadoutId` (the default text→audio loadout), when given. */
export function emptyDraft(loadoutId: number | null = null): VoicebankDraft {
	return { name: "", loadoutId, voiceId: "", enabled: true, labels: {}, voice: emptyVoiceDraft() }
}

export function draftOf(v: VoicebankVoiceView): VoicebankDraft {
	return {
		name: v.name,
		loadoutId: v.loadoutId,
		voiceId: v.voiceId,
		enabled: v.enabled,
		labels: { ...v.labels },
		voice: voiceDraftOfEntry(v)
	}
}

/** Why the draft cannot be saved yet, or null. */
export function draftProblem(d: VoicebankDraft, opts?: { designsVoice?: boolean }): string | null {
	if (!d.name.trim()) return "Give the voice a name."
	if (d.loadoutId == null) return "Pick a loadout."
	if (opts?.designsVoice) {
		if (!d.voice.description.trim()) return "Describe the voice."
		return null
	}
	if (!d.voiceId.trim()) return "Pick a voice."
	return null
}

/**
 * The draft as a create/update payload. `base` carries the settings the form
 * does not edit so an edit never drops them. Blank labels are dropped.
 * `loadoutId` must be set (`draftProblem` guards it).
 */
export function draftToInput(d: VoicebankDraft, base?: VoicebankVoiceView): VoicebankVoiceInput {
	const parts = voiceDraftToEntryParts(d.voice, base?.settings)
	const labels: VoicebankLabels = {}
	for (const k of ["gender", "accent", "age", "useCase"] as const) {
		const t = d.labels[k]?.trim()
		if (t) labels[k] = t
	}
	return {
		name: d.name.trim(),
		description: parts.description,
		loadoutId: d.loadoutId as number,
		voiceId: d.voiceId.trim(),
		language: parts.language,
		settings: parts.settings,
		labels,
		enabled: d.enabled
	}
}

/** "Shuts down 2027-01-06" for the ⏳ chip. */
export function shutsDownLine(facts: SpeechFacts | null): string | null {
	return facts?.deprecatedOn ? `Shuts down ${facts.deprecatedOn}` : null
}

/** Rows in the panel: by name (locale, case-blind), then slug. No drag, no stored order. */
export function sortVoices<T extends { name: string; slug: string }>(voices: readonly T[]): T[] {
	return [...voices].sort(
		(a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.slug.localeCompare(b.slug)
	)
}

/** The small facts a row shows as chips: language, voice seed, speed — only those the entry sets. */
export function voiceChips(v: Pick<VoicebankVoiceView, "language" | "settings">): string[] {
	const out: string[] = []
	if (v.language) out.push(v.language)
	if (v.settings.seed != null) out.push(`seed ${v.settings.seed}`)
	if (v.settings.speed != null) out.push(`speed ${v.settings.speed}`)
	return out
}

/** What **Try** sends for a saved entry (unsaved edits use the form's own try-out). */
export function requestOfEntry(
	v: Pick<VoicebankVoiceView, "voiceId" | "description" | "language" | "settings"> & {
		loadoutId?: number | null
	}
) {
	return {
		...(v.loadoutId != null ? { loadoutId: v.loadoutId } : {}),
		voiceId: v.voiceId.trim(),
		description: v.description ?? "",
		language: v.language ?? "",
		settings: (() => {
			const { seed: _seed, ...rest } = v.settings ?? {}
			return rest
		})()
	}
}

/** "Kokoro 82M on KoboldCPP" for a loadout option's second line; "no model yet" when unfilled. */
export function loadoutModelLine(
	l: Pick<VoicebankLoadoutOption, "filled" | "modelName" | "connectionName">
): string {
	if (!l.filled) return "no model yet"
	return [l.modelName, l.connectionName].filter(Boolean).join(" on ")
}

/** The loadout fields a group header reads (the option carries them; tests pass less). */
export type GroupLoadout = Pick<VoicebankLoadoutOption, "id" | "name"> & {
	defaultVoiceId?: number | null
	otherSpeakersVoiceId?: number | null
}

export interface VoiceGroup<V> {
	/** The loadout, or null for entries with no loadout (listed last). */
	loadout: GroupLoadout | null
	voices: V[]
	/** The loadout voice's name, or null: "none yet". */
	voiceName: string | null
	/** The pinned other-speakers voice's name, or null: Auto. */
	otherSpeakersName: string | null
	/** The entry that is the loadout's Voice (for the row chip). */
	voiceId: number | null
}

/**
 * The panel's sections: one per loadout that has entries, in the loadouts
 * list's order, names inside; entries with no loadout last. Loadouts with
 * no entries are not drawn (their sheet is the place for them).
 */
export function groupVoicesByLoadout<V extends { id: number; name: string; slug: string; loadoutId: number | null }>(
	voices: readonly V[],
	loadouts: readonly GroupLoadout[]
): VoiceGroup<V>[] {
	const out: VoiceGroup<V>[] = []
	const nameOf = (id: number | null | undefined) =>
		id == null ? null : (voices.find((v) => v.id === id)?.name ?? null)
	for (const l of loadouts) {
		const mine = sortVoices(voices.filter((v) => v.loadoutId === l.id))
		if (!mine.length) continue
		out.push({
			loadout: l,
			voices: mine,
			voiceName: nameOf(l.defaultVoiceId),
			otherSpeakersName: nameOf(l.otherSpeakersVoiceId),
			voiceId: l.defaultVoiceId ?? null
		})
	}
	const known = new Set(loadouts.map((l) => l.id))
	const loose = sortVoices(voices.filter((v) => v.loadoutId == null || !known.has(v.loadoutId)))
	if (loose.length) out.push({ loadout: null, voices: loose, voiceName: null, otherSpeakersName: null, voiceId: null })
	return out
}
