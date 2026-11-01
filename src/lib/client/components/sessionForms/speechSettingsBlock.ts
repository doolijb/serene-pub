/**
 * 🚧 The session's **Read aloud** settings (seam S7): which of the derived
 * form's fields belong to the block, so the form draws each key once.
 */
import { SPEECH_FIELD_KEYS, SPEECH_TEMPLATE_IDS } from "$lib/shared/sessions/speechSettings"

type Group = Sockets.Sessions.SettingsForm.Group
type Field = Sockets.Sessions.SettingsForm.Field

/** The genre field keys the block draws — lane D's S7 table, never retyped. */
export const SPEECH_SETTING_KEYS = SPEECH_FIELD_KEYS

export type SpeechSettingName = keyof typeof SPEECH_SETTING_KEYS
const NAME_OF_KEY = new Map<string, SpeechSettingName>(
	(Object.entries(SPEECH_SETTING_KEYS) as [SpeechSettingName, string][]).map(([n, k]) => [k, n])
)

export type SpeechFields = Partial<Record<SpeechSettingName, Field>>

/** What each Read aloud choice does, said once (keys are the setting's values). */
export const READ_ALOUD_LINES: Record<string, { label: string; line: string }> = {
	off: { label: "Off", line: "Lines are not spoken." },
	make: { label: "Make audio", line: "Each reply gets audio you can play." },
	play: { label: "Make and play", line: "Each reply gets audio, and the newest line plays as it arrives." }
}

/** Fallback consequence lines for the line template (by template id), when the declaration gives none. */
export const TEMPLATE_LINES: Record<string, string> = {
	[SPEECH_TEMPLATE_IDS.whole]: "The whole reply is spoken, narration and dialogue.",
	[SPEECH_TEMPLATE_IDS.dialogue]: "Only what the characters say is spoken.",
	[SPEECH_TEMPLATE_IDS.narration]: "Only the narration is spoken."
}

/**
 * Pull the block's fields out of the form's groups; the rest is what the form
 * draws as before. Every S7 key is pulled — so a declared field the block
 * does not draw (*Read my lines too*, not implemented) is drawn nowhere.
 */
export function splitSpeechFields(groups: readonly Group[]): { rest: Group[]; speech: SpeechFields } {
	const speech: SpeechFields = {}
	const rest: Group[] = []
	for (const g of groups) {
		if (g.kind !== "genre") {
			rest.push(g)
			continue
		}
		const keep: Field[] = []
		for (const f of g.fields) {
			const name = f.address.kind === "genre" ? NAME_OF_KEY.get(f.address.key) : undefined
			if (name) speech[name] = f
			else keep.push(f)
		}
		if (keep.length || !g.fields.length) rest.push(keep.length === g.fields.length ? g : { ...g, fields: keep })
	}
	return { rest, speech }
}

/** An ISO 639-1 code: two lowercase letters. */
export const isLanguageCode = (s: string): boolean => /^[a-z]{2}$/.test(s)

export interface ReadAloudChoice {
	key: string
	label: string
	line: string | null
}

/** Order of the segmented control: Off, Make audio, Make and play; undeclared members are left out, unknown ones follow. */
const READ_ALOUD_ORDER = ["off", "make", "play"]
export function readAloudChoices(field: Field): ReadAloudChoice[] {
	const members = field.members?.length
		? field.members.map((m) => ({
				key: m.key,
				label: m.label || READ_ALOUD_LINES[m.key]?.label || m.key,
				line: m.description ?? READ_ALOUD_LINES[m.key]?.line ?? null
			}))
		: Object.entries(READ_ALOUD_LINES).map(([key, v]) => ({ key, label: v.label, line: v.line }))
	const rank = (k: string) => (READ_ALOUD_ORDER.includes(k) ? READ_ALOUD_ORDER.indexOf(k) : READ_ALOUD_ORDER.length)
	return members.sort((a, b) => rank(a.key) - rank(b.key))
}

/** The ONE consequence line under the segmented control. */
export const readAloudLine = (choices: readonly ReadAloudChoice[], value: unknown): string | null =>
	choices.find((c) => c.key === value)?.line ?? null
