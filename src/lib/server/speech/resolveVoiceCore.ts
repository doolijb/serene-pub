/**
 * The pure core of `resolveVoice` (design §5, seam S4). Everything is loaded
 * by the caller; this decides. No db, no `$lib` runtime imports, so lane V and
 * a tsx script can run it.
 */
import type { CharacterTimbreInput } from "../../shared/characters/timbre"
import type {
	ResolvedVoice,
	VoiceFrom,
	VoiceResolution,
	VoiceSkip,
	VoicebankSettings
} from "../../shared/speech/voicebank"
import { resolveLanguage } from "./language"

/** A voicebank row, as much of it as resolution needs. */
export interface VoiceEntryFacts {
	slug: string
	/** The entry's loadout; null = unassigned (refused by `refusalOf`). */
	loadoutId: number | null
	/** Derived from the loadout's merge root; null when unassigned / unfilled. */
	connectionModelId: number | null
	voiceId: string
	language: string | null
	settings: VoicebankSettings
	enabled: boolean
	/** The entry's own "who this voice is" prose; the design prose when no card names one. */
	description?: string | null
}

/** A named lookup: what was asked for, and the row found (null = no such slug). */
export interface AskedEntry {
	slug: string
	entry: VoiceEntryFacts | null
}

export interface ResolveVoiceFacts {
	/**
	 * The FALLBACK pair's model (the speak step's slot, else the speaking
	 * loadout): used only by the `loadout` and `service` arms. Null = none yet.
	 */
	pairModelId: number | null
	/** The loadout's sampling `voice`. */
	loadoutVoice: string | null
	timbre: CharacterTimbreInput | null
	/** The entry `timbre.voice` names (null when the timbre names none). */
	timbreEntry: AskedEntry | null
	/** The entry `speech.narratorVoice` names. */
	sessionEntry: AskedEntry | null
	/** The entry the character's `timbre.narrationVoice` names. */
	timbreNarrationEntry?: AskedEntry | null
	/** The entry the speaking envoy's session voice names. */
	envoyEntry?: AskedEntry | null
	/** The entry the speaking envoy's session narration voice names. */
	envoyNarrationEntry?: AskedEntry | null
	/** The speaking loadout's pinned "other speakers" entry (`other_speakers_voice_id`). */
	otherSpeakersEntry?: AskedEntry | null
	/** The entry Auto picked (or reused) for this speaker; null = Auto has none (only the narrator's voice). */
	autoEntry?: AskedEntry | null
	/** The speaking loadout's default voice (the narrator: `default_voice_id`). */
	loadoutVoiceEntry?: AskedEntry | null
	/** The speaking loadout's first enabled, usable entry (lowest id). */
	loadoutFirstEntry?: AskedEntry | null
	/** The cue group's voice kind; absent = 'speaker' (dialogue). */
	cueVoice?: "speaker" | "narrator"
	/** Whether a character/envoy speaks the line this cue sits in (false = plain narration). */
	hasSpeaker?: boolean
	sessionNarratorVoice: string | null
	/** Injected: the real one is `voicebankRefusal` (off / unassigned / loadout unfilled). */
	refusalOf: (entry: VoiceEntryFacts) => string | null
	cueLanguage?: string | null
	text?: string | null
	sessionLanguage?: string | null
	pubLanguage?: string | null
	/** The pair model's first listed voice — the service step's voice when nothing above names one. */
	serviceVoice?: string | null
}

export const NO_PAIR_REASON =
	"The Narration loadout has no model yet — fill it in Loadouts."

/**
 * Resolution by cue kind. First arm that names a usable entry wins; an
 * unknown / off / refused slug is recorded in `skipped` and the chain moves on.
 *   dialogue with a speaker (cueVoice absent or 'speaker'):
 *     timbre → envoy → other-speakers → auto → the narrator chain
 *   narration inside a speaker's line (cueVoice 'narrator', hasSpeaker):
 *     narration-timbre → envoy-narration → the narrator chain
 *   plain narration, or a dialogue cue with no speaker: the narrator chain
 *   narrator chain: session → loadout-voice → loadout-first
 *     → loadout (the fallback pair's sampling voice) → service (model's first voice)
 * Description: dialogue = the card's `timbre.description`, else the chosen
 * entry's own; narration = the chosen entry's own only.
 * Settings (speed, seed, dials): the card's layer over the chosen entry's on
 * DIALOGUE only; a narration cue takes the chosen entry's settings alone.
 */
/** The entry the narrator chain names (first usable of session → loadout voice → first), or null. */
export function narratorChainEntry(
	facts: Pick<ResolveVoiceFacts, "sessionEntry" | "loadoutVoiceEntry" | "loadoutFirstEntry" | "refusalOf">
): VoiceEntryFacts | null {
	for (const asked of [facts.sessionEntry, facts.loadoutVoiceEntry, facts.loadoutFirstEntry]) {
		const e = asked?.entry
		if (e && e.enabled && !facts.refusalOf(e)) return e
	}
	return null
}

export function resolveVoiceFrom(facts: ResolveVoiceFacts): VoiceResolution {
	const pair = facts.pairModelId
	const skipped: VoiceSkip[] = []
	const narrator = facts.cueVoice === "narrator"
	// The card's settings — its pinned seed above all — belong to the
	// character's OWN voice. On a narration cue they never apply: the
	// narrator entry's seed is what makes it the narrator, and layering the
	// card's seed over it made the narrator a variant of the character
	// (owner report, 2026-10-29: "narrator voice doesn't seem to apply").
	const timbreSettings: VoicebankSettings = narrator ? {} : { ...(facts.timbre?.settings ?? {}) }

	const inLine = narrator && facts.hasSpeaker === true
	// Dialogue words: the card's own description only; narration takes the entry's.
	const cardWords = (): string | null => (narrator ? null : facts.timbre?.description?.trim() || null)

	const chosen = (
		from: VoiceFrom,
		voiceId: string | null,
		entry: VoiceEntryFacts | null
	): ResolvedVoice => {
		// An entry speaks on its own loadout's model; the fallback arms on the fallback pair.
		const modelId = entry ? entry.connectionModelId : pair
		const lang = resolveLanguage({
			cue: facts.cueLanguage,
			text: facts.text,
			timbre: facts.timbre?.language,
			session: facts.sessionLanguage,
			pub: facts.pubLanguage
		})
		return {
			ok: true,
			connectionModelId: modelId as number,
			loadoutId: entry ? entry.loadoutId : null,
			voiceId,
			settings: entry ? { ...entry.settings, ...timbreSettings } : timbreSettings,
			language: lang.language,
			from,
			languageFrom: lang.from,
			voicebankSlug: entry ? entry.slug : null,
			// The card's words first; else the voicebank entry's own description,
			// so a try-out on the entry form and a real line through that entry
			// design the same person (lane hand-back ★2, lead 2026-10-29).
			description: cardWords() || entry?.description?.trim() || null,
			skipped
		}
	}

	const tryEntry = (from: VoiceFrom, asked: AskedEntry | null): ResolvedVoice | null => {
		if (!asked) return null
		const e = asked.entry
		if (!e) {
			skipped.push({
				from,
				slug: asked.slug,
				reason: `No voicebank voice is named "${asked.slug}".`
			})
			return null
		}
		if (!e.enabled) {
			skipped.push({ from, slug: asked.slug, reason: `The voice "${asked.slug}" is turned off.` })
			return null
		}
		const refusal = facts.refusalOf(e)
		if (refusal) {
			skipped.push({ from, slug: asked.slug, reason: refusal })
			return null
		}
		return chosen(from, e.voiceId, e)
	}

	const chain: Array<[VoiceFrom, AskedEntry | null | undefined]> = [
		["session", facts.sessionEntry],
		["loadout-voice", facts.loadoutVoiceEntry],
		["loadout-first", facts.loadoutFirstEntry]
	]
	const arms: Array<[VoiceFrom, AskedEntry | null | undefined]> = !narrator
		? facts.hasSpeaker === false
			? // No speaker: only an explicit timbre (a try-out's draft) can name a voice before the chain.
				[["timbre", facts.timbreEntry], ...chain]
			: [
					["timbre", facts.timbreEntry],
					["envoy", facts.envoyEntry],
					["other-speakers", facts.otherSpeakersEntry],
					["auto", facts.autoEntry],
					...chain
				]
		: inLine
			? [
					["narration-timbre", facts.timbreNarrationEntry],
					["envoy-narration", facts.envoyNarrationEntry],
					...chain
				]
			: chain
	let hit: ResolvedVoice | null = null
	for (const [from, asked] of arms) {
		hit = tryEntry(from, asked ?? null)
		if (hit) break
	}
	if (hit) return hit
	// The fallback arms need a fallback pair; an entry on its own loadout never did.
	if (pair == null) return { ok: false, reason: NO_PAIR_REASON }
	if (facts.loadoutVoice) return chosen("loadout", facts.loadoutVoice, null)
	return chosen("service", facts.serviceVoice?.trim() || null, null)
}
