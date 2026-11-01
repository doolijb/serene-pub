/** Pure words and options for the loadout sheet's **Voice** card (text->audio loadouts). */
/** The shape `inputs/Select` takes (a `.svelte` module export is not importable from `.ts`). */
export interface SelectOption {
	value: string
	label: string
	disabled?: boolean
}

export interface SheetVoice {
	id: number
	name: string
	enabled: boolean
}

export const VOICE_SENTENCE =
	"The narrator: reads narration and every line nobody else voices."
export const OTHER_SPEAKERS_SENTENCE =
	"Auto gives each speaker without their own voice a different voice from this loadout — never the narrator's — and keeps it for the session. Pick one to have it speak for all of them."
export const NO_VOICES_SENTENCE = "No voices on this loadout yet."
export const AUTO_VALUE = "auto"

/** Entries of this loadout, by id (the order they were made). */
export function voicesOfLoadout<V extends { id: number; loadoutId: number | null; name: string; enabled: boolean }>(
	all: readonly V[],
	loadoutId: number
): SheetVoice[] {
	return all
		.filter((v) => v.loadoutId === loadoutId)
		.sort((a, b) => a.id - b.id)
		.map((v) => ({ id: v.id, name: v.name, enabled: v.enabled }))
}

/** A turned-off entry is listed, not pickable, and says so. */
function option(v: SheetVoice): SelectOption {
	return v.enabled
		? { value: String(v.id), label: v.name }
		: { value: String(v.id), label: `${v.name} (off)`, disabled: true }
}

/** Voice: no "none" while the loadout has entries (the narrator always has a voice). */
export const voiceOptions = (voices: readonly SheetVoice[]): SelectOption[] => voices.map(option)

/** Other speakers: Auto, then the entries. */
export const otherSpeakersOptions = (voices: readonly SheetVoice[]): SelectOption[] => [
	{ value: AUTO_VALUE, label: "Auto" },
	...voices.map(option)
]
