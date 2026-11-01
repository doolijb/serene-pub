/**
 * 🚧 The **voicebank** — the pub's named voices (build seam S4; design
 * PLAN-speech-connections-and-timbre §4–§5). One row per voice the pub can
 * speak with: a voice id on one connection model, with the settings it is
 * spoken with. A character's timbre names an entry by slug; a session's
 * narrator voice (`speech.narratorVoice`) names one too; one entry may be
 * the pub's default.
 *
 * ⚠ Not the cast roster or the member roster (★15: the owner said "Roster";
 * the code word is `voicebank`). Not the service's own voice list
 * (`SpeechFacts.voices`): an entry *picks* one of those and names it here.
 *
 * 🚧 Each entry speaks through its own **loadout** (a `text->audio` loadout;
 * voice loadouts, owner 2026-10-29 — retires A7's one speaking pair): the
 * voice id, the facts and the controls are that loadout's model's. An entry
 * whose loadout is gone is **unassigned** and skipped at speak time, with a
 * note. Members never see which loadout a voice is on.
 *
 * Shapes only — the table is `voicebank_voices` (`db/schema.ts`), the rules
 * live in `server/speech/`.
 */

import type { SpeechControls } from "../connectionAdapters/speechFacts"

/** Speaker labels, the same keys a service reports on `SpeechVoice.labels`. */
export interface VoicebankLabels {
	gender?: string
	accent?: string
	age?: string
	useCase?: string
}

/** The settings an entry is spoken with; a character's timbre settings layer over them. */
export interface VoicebankSettings {
	/**
	 * Sampling seed sent with every call (services that honour `seed`). On a
	 * voice-designing model it IS the voice: change it to get a different
	 * person for the same description; blank derives one from the description.
	 */
	seed?: number
	speed?: number
	stability?: number
	similarity?: number
	style?: number
	speakerBoost?: boolean
}

/**
 * 🚧 What a voice's model takes, as the shared voice fields and the try-out
 * read it. Capabilities only — never the loadout, the connection or the model.
 */
export type VoiceControls = Pick<
	SpeechControls,
	"designsVoice" | "instruction" | "settings" | "speed" | "language"
>

/**
 * 🚧 A loadout a voicebank entry may speak through (transform `text->audio`),
 * as the entry form's **Loadout** picker lists it. Administrators only.
 */
export interface VoicebankLoadoutOption {
	id: number
	name: string
	/** The merge root's pair; null when the loadout has no model yet. */
	connectionId: number | null
	connectionModelId: number | null
	/** "Kokoro 82M on KoboldCPP" parts for the picker; null when unfilled. */
	connectionName: string | null
	modelName: string | null
	/** False: no model yet — listed greyed ("no model yet"), not pickable. */
	filled: boolean
	/** The `text->audio` default loadout (a new voice starts on it). */
	isDefault: boolean
	/** The loadout's own **loadout voice** (an entry id on it); null = its first entry. */
	defaultVoiceId: number | null
	/** The entry every speaker without a voice gets; null = **Auto**. */
	otherSpeakersVoiceId: number | null
}

/** `pub` (a person's) or the plugin id that declared it. */
export type VoicebankOwner = "pub" | (string & {})

/** One entry as an administrator sees it (`voicebank:list`). */
export interface VoicebankVoiceView {
	id: number
	slug: string
	name: string
	description: string | null
	owner: VoicebankOwner
	seedKey: string | null
	/**
	 * 🚧 The loadout this voice speaks through; null = **unassigned** (its
	 * loadout was deleted) — skipped at speak time, with a note.
	 */
	loadoutId: number | null
	/** That loadout's name, for the row. */
	loadoutName: string | null
	/**
	 * Derived, never stored: the model of the loadout's merge root; null when
	 * unassigned or the loadout has no model yet.
	 */
	connectionModelId: number | null
	/** The service's voice id on that model. */
	voiceId: string
	/** ISO 639-1, or null for "the voice's own". */
	language: string | null
	settings: VoicebankSettings
	labels: VoicebankLabels
	enabled: boolean
	/** Null when the entry is usable, else why `resolveVoice` will skip it (off, unassigned, its loadout has no model). */
	unusableReason: string | null
	createdAt: string
	updatedAt: string
}

/** One entry as a member may see it (`voicebank:pickable`) — enabled, usable entries only. */
export interface VoicebankPickableVoice {
	name: string
	slug: string
	language: string | null
	labels: VoicebankLabels
	/** From the model's `SpeechFacts.voices[].previewUrl`, when the service gave one. */
	previewUrl?: string
	/** 🚧 What this voice's model takes (the card's voice fields read it); null when its loadout has no model. */
	controls?: VoiceControls | null
	/** 🚧 Administrators only (members never see loadouts): the loadout it speaks through. */
	loadoutId?: number
	loadoutName?: string
}

/** What `voicebank:create` takes, and `voicebank:update` takes partially (plus `id`). */
export interface VoicebankVoiceInput {
	/** Derived from `name` when absent; unique per owner. */
	slug?: string
	name: string
	description?: string | null
	/** 🚧 A `text->audio` loadout with a model; the voice id is one of its model's. */
	loadoutId: number
	voiceId: string
	language?: string | null
	settings?: VoicebankSettings
	labels?: VoicebankLabels
	enabled?: boolean
}

/**
 * Where a resolved voice came from (design §5, seam S4). Dialogue with a
 * speaker = timbre → envoy → other-speakers → auto → the narrator chain;
 * narration in a line = narration-timbre → envoy-narration → the narrator
 * chain; plain narration = the narrator chain; the narrator chain = session →
 * loadout-voice → loadout-first → loadout (sampling voice) → service.
 * Stored `voiceFrom` values may be any string (retired: `voicebank-default`,
 * `narration-default`); readers must tolerate them.
 */
export const VOICE_FROM = [
	"timbre",
	"envoy",
	"narration-timbre",
	"envoy-narration",
	"session",
	"other-speakers",
	"auto",
	"loadout-voice",
	"loadout-first",
	"loadout",
	"service"
] as const
export type VoiceFrom = (typeof VOICE_FROM)[number]

/** Where the line's language came from (A2's simple chain). */
export const VOICE_LANGUAGE_FROM = [
	"cue",
	"script",
	"timbre",
	"session",
	"pub"
] as const
export type VoiceLanguageFrom = (typeof VOICE_LANGUAGE_FROM)[number]

/** A voicebank entry the chain reached but could not use, and why. */
export interface VoiceSkip {
	from: VoiceFrom
	slug: string
	reason: string
}

/** `resolveVoice`'s answer when a voice was found. */
export interface ResolvedVoice {
	ok: true
	/** The model the line is spoken on: the entry's loadout's, else the fallback pair's. */
	connectionModelId: number
	/**
	 * 🚧 The entry's loadout — the line's group is spoken through it. Null =
	 * the fallback pair (the speak step's slot, else the speaking loadout):
	 * the `loadout` and `service` arms.
	 */
	loadoutId: number | null
	/** The service's voice id; null means "send none, the service's default". */
	voiceId: string | null
	/** Entry settings with the speaker's timbre settings layered over them. */
	settings: VoicebankSettings
	/** ISO 639-1, or null when nothing in the chain named one. */
	language: string | null
	from: VoiceFrom
	languageFrom: VoiceLanguageFrom | null
	/** The voicebank entry used, when `from` names an entry (every arm but `loadout` / `service`). */
	voicebankSlug: string | null
	/** The speaker's timbre description (the standing instruction where a model takes prose). */
	description: string | null
	/** Entries the chain reached and skipped (disabled, missing, unassigned, no model). */
	skipped: VoiceSkip[]
}

/** `resolveVoice`'s answer when the line cannot be spoken at all. */
export interface VoiceRefusal {
	ok: false
	reason: string
}

export type VoiceResolution = ResolvedVoice | VoiceRefusal
