/**
 * 🚧 A character's **timbre** — how the character sounds when its lines are
 * spoken (PLAN-speech-connections-and-timbre §4.1; build seam S5). Stored in
 * `characters.extensions.serenepub.timbre`. The server's
 * `characters/timbre.ts` owns the rules (validation, card export/import);
 * this is the shape, the one read a client needs, and the one predicate.
 *
 * ⚠ Not **portrayal** (who plays the part), not the user *voicing* a
 * character, not the adventure **voice** (one character's turn inside a
 * reply), not **ruleset voice**.
 *
 * The prose `description` is the only part guaranteed to travel between pubs.
 * `voice` names a **voicebank** entry by slug and is pub-local: card export
 * drops it. No clip slot (no in-app cloning).
 */

/** The dials a timbre may set; a key the voice's model does not honour is reported `ignored`, never sent. */
export interface TimbreSettings {
	/** Speaking rate multiplier, 1 = the voice's own pace. */
	speed?: number
	/** 0–1, ElevenLabs-style. */
	stability?: number
	/** 0–1, ElevenLabs-style. */
	similarity?: number
	/** 0–1, ElevenLabs-style. */
	style?: number
	/**
	 * 🚧 The voice seed: on a voice-designing model it picks which person the
	 * description becomes; the same description with the same seed is the same
	 * voice. Overrides the voicebank entry's.
	 */
	seed?: number
	/** ElevenLabs-style speaker boost: on emphasises the original speaker. */
	speakerBoost?: boolean
}

/** The keys of {@link TimbreSettings}, in display order. */
export const TIMBRE_SETTING_KEYS = [
	"speed",
	"stability",
	"similarity",
	"style",
	"seed"
] as const satisfies readonly (keyof TimbreSettings)[]

/** Stored in `characters.extensions.serenepub.timbre`; every part optional. */
export interface CharacterTimbreInput {
	/** "a warm low alto, slight Irish lilt, unhurried" — portable prose. */
	description?: string
	/** A voicebank entry's slug on THIS pub. Dropped on card export. */
	voice?: string
	/**
	 * 🚧 The voicebank slug that reads the prose AROUND this character's
	 * lines (speech follow-ups C8, 2026-10-29). Pub-local and admin-only like
	 * `voice`; dropped on card export. Blank uses the session's narrator, then
	 * the pub's narration default.
	 */
	narrationVoice?: string
	/** ISO 639-1 code the character speaks (`en`, `ja`). */
	language?: string
	settings?: TimbreSettings
	/**
	 * `true`: this character's lines are never spoken, whatever the session's
	 * Read aloud says (owner ruling 2026-10-28: the session makes audio, the
	 * character says whether it is spoken). Absent is spoken. Travels with
	 * the card.
	 */
	silent?: boolean
}

/**
 * Who may set `timbre.voice` (A1: members do not pick voices in phase 1).
 * The card's Voice section shows the description to everyone; the picker,
 * and the server's acceptance of a changed `voice`, are behind this.
 */
export function canPickVoice(user: { isAdmin?: boolean | null } | null | undefined): boolean {
	return !!user?.isAdmin
}

/** The stored timbre off a character's `extensions`, unvalidated but shaped. */
export function timbreOfExtensions(extensions: unknown): CharacterTimbreInput {
	const sp = (extensions as { serenepub?: { timbre?: unknown } } | null)
		?.serenepub
	const raw = sp?.timbre
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
	const t = raw as Record<string, unknown>
	const settings: TimbreSettings = {}
	if (t.settings && typeof t.settings === "object" && !Array.isArray(t.settings)) {
		const s = t.settings as Record<string, unknown>
		for (const k of TIMBRE_SETTING_KEYS) {
			const v = s[k]
			if (typeof v === "number" && Number.isFinite(v)) {
				if (k === "seed" && !Number.isInteger(v)) continue
				settings[k] = v
			}
		}
		if (typeof s.speakerBoost === "boolean") settings.speakerBoost = s.speakerBoost
	}
	return {
		...(typeof t.description === "string" ? { description: t.description } : {}),
		...(typeof t.voice === "string" ? { voice: t.voice } : {}),
		...(typeof t.narrationVoice === "string" ? { narrationVoice: t.narrationVoice } : {}),
		...(typeof t.language === "string" ? { language: t.language } : {}),
		...(Object.keys(settings).length ? { settings } : {}),
		...(t.silent === true ? { silent: true } : {})
	}
}
