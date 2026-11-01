/**
 * Language of a spoken line (design §5; assumption A2): cue → script →
 * timbre → session → pub. Script detection is script-based ONLY — Latin
 * (and Cyrillic, Arabic, mixed) are ambiguous and never guessed.
 * Pure: no db, no `$lib` runtime imports.
 */
import type { VoiceLanguageFrom } from "../../shared/speech/voicebank"

const SCRIPTS: ReadonlyArray<readonly [string, RegExp]> = [
	["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
	["hangul", /\p{Script=Hangul}/gu],
	["han", /\p{Script=Han}/gu],
	["el", /\p{Script=Greek}/gu],
	["he", /\p{Script=Hebrew}/gu],
	["th", /\p{Script=Thai}/gu],
	["ka", /\p{Script=Georgian}/gu],
	["hy", /\p{Script=Armenian}/gu],
	["hi", /\p{Script=Devanagari}/gu]
]
const ALL_LETTERS = /\p{L}/gu
const MAJORITY = 0.6

const count = (text: string, re: RegExp): number => text.match(re)?.length ?? 0

/** ISO 639-1 from the dominant non-ambiguous script, or null. Never Latin. */
export function detectScriptLanguage(text: string): string | null {
	if (!text) return null
	const letters = count(text, ALL_LETTERS)
	if (letters === 0) return null
	const n: Record<string, number> = {}
	for (const [k, re] of SCRIPTS) n[k] = count(text, re)
	// Japanese mixes kana with Han: kana + Han together are one script group.
	if (n.kana > 0 && (n.kana + n.han) / letters >= MAJORITY) return "ja"
	if (n.hangul / letters >= MAJORITY) return "ko"
	if (n.han / letters >= MAJORITY) return "zh"
	for (const k of ["el", "he", "th", "ka", "hy", "hi"])
		if (n[k] / letters >= MAJORITY) return k
	return null
}

/** Lower-case ISO 639-1, or null when the value is not one. */
export function normaliseLanguage(v: unknown): string | null {
	if (typeof v !== "string") return null
	const s = v.trim().toLowerCase()
	return /^[a-z]{2}$/.test(s) ? s : null
}

export interface LanguageInputs {
	cue?: string | null
	text?: string | null
	timbre?: string | null
	session?: string | null
	pub?: string | null
}

export function resolveLanguage(input: LanguageInputs): {
	language: string | null
	from: VoiceLanguageFrom | null
} {
	const steps: Array<[VoiceLanguageFrom, string | null]> = [
		["cue", normaliseLanguage(input.cue)],
		["script", input.text ? detectScriptLanguage(input.text) : null],
		["timbre", normaliseLanguage(input.timbre)],
		["session", normaliseLanguage(input.session)],
		["pub", normaliseLanguage(input.pub)]
	]
	for (const [from, language] of steps) if (language) return { language, from }
	return { language: null, from: null }
}
