/**
 * 🚧 The **marker table** (PLAN-speech-connections-and-timbre §11.2): the
 * expression words a model writes inline — `[angry]`, `<sigh>`, `*laughs*`,
 * `(((gasp)))` — mapped to the inflection label they mean. Pure data and one
 * lookup; no model in the loop.
 *
 * A marker the table knows sets that speech cue's inflection; one it does not
 * is still lifted off the text (never spoken as a word) and simply carries no
 * label, so the line's recorded label speaks the cue instead.
 *
 * Labels are `INFLECTION_LABELS` (the sprite standard set). The table is a
 * starter vocabulary, deliberately small and unambiguous: a word that names a
 * delivery rather than an emotion (`whispers`, `shouts`) is not here.
 */
import { INFLECTION_LABELS, type InflectionLabel } from "@serene-pub/sdk"

/** label -> the marker words (lower case, singular/base form) that mean it. */
const WORDS_BY_LABEL: Partial<Record<InflectionLabel, readonly string[]>> = {
	amusement: ["laugh", "laughter", "chuckle", "giggle", "snicker", "cackle", "haha", "hehe", "lol", "smirk", "grin", "amused"],
	sadness: ["sigh", "sad", "sob", "cry", "weep", "sniffle", "sniff", "teary", "melancholy"],
	anger: ["angry", "anger", "angrily", "mad", "furious", "fury", "growl", "snarl", "seethe", "rage"],
	annoyance: ["annoyed", "annoyance", "scoff", "groan", "huff", "grumble", "tsk", "irritated", "exasperated", "eyeroll"],
	fear: ["scared", "afraid", "fear", "frightened", "terrified", "tremble", "trembling", "shudder", "scream", "shriek", "whimper"],
	surprise: ["surprised", "surprise", "gasp", "shocked", "shock", "startled", "wow", "whoa"],
	joy: ["happy", "joy", "joyful", "cheer", "cheerful", "squeal", "delighted", "beaming"],
	excitement: ["excited", "excitedly", "excitement", "eager", "eagerly", "thrilled"],
	nervousness: ["nervous", "nervously", "stammer", "stutter", "gulp", "anxious", "anxiously", "fidget", "hesitant"],
	love: ["love", "loving", "lovingly", "adoring", "adoringly", "affectionate"],
	caring: ["gentle", "gently", "soft", "softly", "tender", "tenderly", "soothing", "comforting", "caring"],
	confusion: ["confused", "puzzled", "huh", "bewildered"],
	curiosity: ["curious", "curiously", "intrigued", "hmm", "hm", "wondering"],
	disgust: ["disgusted", "disgust", "gross", "ew", "ugh", "retch", "gag"],
	embarrassment: ["embarrassed", "blush", "sheepish", "flustered"],
	disappointment: ["disappointed", "disappointment", "deflated"],
	disapproval: ["disapproving", "disapprove", "tut"],
	approval: ["approving", "approve", "approvingly"],
	grief: ["grief", "grieving", "mourning", "anguished", "wail"],
	relief: ["relieved", "relief", "exhale"],
	pride: ["proud", "proudly", "smug", "smugly"],
	admiration: ["admiring", "admiringly", "awe", "awed"],
	optimism: ["hopeful", "hopefully", "optimistic"],
	desire: ["longing", "yearning", "seductive", "sultry", "breathless"],
	remorse: ["sorry", "apologetic", "regretful", "remorseful", "guilty"],
	gratitude: ["grateful", "thankful", "gratefully"],
	realization: ["realizing", "realising", "aha", "eureka"],
	neutral: ["neutral", "calm", "calmly", "flat", "monotone", "deadpan"]
}

/** marker word -> inflection label. Built once from the table above. */
export const MARKER_LABELS: Readonly<Record<string, InflectionLabel>> = (() => {
	const known = new Set<string>(INFLECTION_LABELS)
	const out: Record<string, InflectionLabel> = {}
	for (const [label, words] of Object.entries(WORDS_BY_LABEL)) {
		if (!known.has(label)) continue
		for (const w of words ?? []) out[w] = label as InflectionLabel
	}
	// The label names themselves are markers too (`[sadness]`, `<joy>`).
	for (const label of INFLECTION_LABELS) out[label] ??= label
	return Object.freeze(out)
})()

/** `Sighs` / ` sighing. ` -> `sighs`: lower-cased, letters and inner spaces only. */
function normal(marker: string): string {
	return marker
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.replace(/[\s_-]+/g, " ")
		.trim()
}

/**
 * The candidate base forms of a marker word, most literal first: itself, then
 * with a verb ending taken off (`sighs`, `laughed`, `laughing`, `blushes`).
 */
function stems(word: string): string[] {
	const out = [word]
	if (word.endsWith("ies")) out.push(word.slice(0, -3) + "y")
	if (word.endsWith("es")) out.push(word.slice(0, -2))
	if (word.endsWith("s")) out.push(word.slice(0, -1))
	if (word.endsWith("ing")) {
		const base = word.slice(0, -3)
		out.push(base, base + "e")
		if (base.length > 2 && base.at(-1) === base.at(-2)) out.push(base.slice(0, -1))
	}
	if (word.endsWith("ed")) {
		const base = word.slice(0, -2)
		out.push(base, base + "e")
		if (base.length > 2 && base.at(-1) === base.at(-2)) out.push(base.slice(0, -1))
	}
	if (word.endsWith("ly")) out.push(word.slice(0, -2))
	return out
}

/**
 * The inflection label a marker means, or null when the table does not know it.
 * Only a single word is looked up: `[sighs]` is a marker; `[sighs heavily]` is
 * not in the table (it is still lifted, just unlabelled).
 */
export function markerInflection(marker: string): InflectionLabel | null {
	const word = normal(marker)
	if (!word || word.includes(" ")) return null
	for (const s of stems(word)) {
		const label = MARKER_LABELS[s]
		if (label) return label
	}
	return null
}

/** Whether the table knows a marker word (the test `*sighs*` is a marker, not an action, rests on). */
export const isKnownMarker = (marker: string): boolean => markerInflection(marker) !== null
