/**
 * 🚧 The card's Voice section draft (speech build E1): the timbre as the
 * form holds it, and how a save writes it into `extensions.serenepub.timbre`.
 * Pure helpers; `VoiceTab.svelte` is the surface.
 */
import {
	timbreOfExtensions,
	type CharacterTimbreInput,
	type TimbreSettings
} from "$lib/shared/characters/timbre"

export interface TimbreDraft {
	description: string
	/** Voicebank slug, or null for the pub default. */
	voice: string | null
	/** Voicebank slug that reads the prose around this character's lines, or null (session narrator). */
	narrationVoice: string | null
	/** ISO 639-1, or "" for none. */
	language: string
	/** Kept whole so dials this form does not edit survive a save. */
	settings: TimbreSettings
	/** Whether this character's lines are spoken at all (the inverse of the stored `silent`). */
	spoken: boolean
}

export const EMPTY_TIMBRE_DRAFT: TimbreDraft = {
	description: "",
	voice: null,
	narrationVoice: null,
	language: "",
	settings: {},
	spoken: true
}

export function timbreDraftOf(extensions: unknown): TimbreDraft {
	const t = timbreOfExtensions(extensions)
	return {
		description: t.description ?? "",
		voice: t.voice ?? null,
		narrationVoice: t.narrationVoice ?? null,
		language: t.language ?? "",
		settings: { ...(t.settings ?? {}) },
		spoken: t.silent !== true
	}
}

/** The draft as a timbre to store; empty parts omitted. `voice` and `narrationVoice` only for an admin. */
export function timbreOfDraft(
	d: TimbreDraft,
	opts: { canPickVoice: boolean }
): CharacterTimbreInput {
	const out: CharacterTimbreInput = {}
	const description = d.description.trim()
	if (description) out.description = description
	if (opts.canPickVoice && d.voice) out.voice = d.voice
	if (opts.canPickVoice && d.narrationVoice) out.narrationVoice = d.narrationVoice
	const language = d.language.trim().toLowerCase()
	if (language) out.language = language
	if (Object.keys(d.settings).length) out.settings = { ...d.settings }
	if (!d.spoken) out.silent = true
	return out
}

/**
 * The `extensions` a save sends, or `undefined` when the timbre did not
 * move (so a save never re-sends a possibly stale `extensions`). The stored
 * extensions are kept whole with `serenepub.timbre` replaced (`{}` clears).
 * A member's stored `voice` is left to the server, which keeps it.
 */
export function extensionsForSave(
	stored: unknown,
	draft: TimbreDraft,
	original: TimbreDraft,
	opts: { canPickVoice: boolean }
): Record<string, unknown> | undefined {
	const same = JSON.stringify(draft) === JSON.stringify(original)
	if (same) return undefined
	const base =
		stored && typeof stored === "object" && !Array.isArray(stored)
			? { ...(stored as Record<string, unknown>) }
			: {}
	const sp =
		base.serenepub &&
		typeof base.serenepub === "object" &&
		!Array.isArray(base.serenepub)
			? { ...(base.serenepub as Record<string, unknown>) }
			: {}
	sp.timbre = timbreOfDraft(draft, opts)
	base.serenepub = sp
	return base
}

/**
 * The try-out overrides for the card's own voice: the picked voicebank voice
 * (administrators only; a member's `voice` is refused server-side). The
 * description, language and dials come from the shared voice fields' draft.
 */
export function voiceTryRequest(timbre: TimbreDraft, mayPick: boolean) {
	return mayPick && timbre.voice ? { voice: timbre.voice } : {}
}

/**
 * The try-out for the override narrator: only the picked voicebank voice and
 * the card's language. No description, no dials: the narrator uses its own
 * settings. `null` when there is nothing to try (no narrator, or a member).
 */
export function narratorTryRequest(timbre: TimbreDraft, mayPick: boolean) {
	if (!mayPick || !timbre.narrationVoice) return null
	const language = timbre.language.trim().toLowerCase()
	return { voice: timbre.narrationVoice, ...(language ? { language } : {}) }
}
