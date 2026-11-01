/**
 * 🚧 The **tag crosswalk**: an inflection label's tag word, spelled the way a
 * speaking model's vocabulary spells it.
 *
 * The inflection-tag layout (`core:var/inflection-tag@1`) turns a label into
 * core's own word (`sadness` → `[sad]`). A model that takes tags may hold a
 * closed vocabulary that spells the same feeling differently (KittenTTS 2 has
 * `joyful`, not `happy`; `contemplative`, not `thoughtful`). This table lists,
 * for each word core's layout can write, the near-synonyms to try — in order —
 * when the vocabulary lacks the word itself. Pure tables, deterministic: the
 * same word and vocabulary always give the same answer. A vocabulary that holds
 * none of them gets no tag; a label is never spoken as a word.
 *
 * Pure: no imports from the server.
 */

/** Core's tag word → the other spellings to try, best first. @internal */
export const TAG_SYNONYMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	admiring: ["impressed", "approving", "warm", "tender"],
	amused: ["playful", "laughing", "joyful", "happy", "cheerful"],
	angry: ["furious", "stern", "irritated", "annoyed", "mad"],
	annoyed: ["irritated", "stern", "frustrated", "angry"],
	approving: ["pleased", "warm", "positive", "joyful", "happy"],
	gentle: ["tender", "soft", "caring", "warm", "kind", "calm"],
	confused: ["puzzled", "uncertain", "hesitant", "nervous", "contemplative"],
	curious: ["interested", "inquisitive", "intrigued", "excited", "contemplative"],
	longing: ["wistful", "yearning", "tender", "intimate", "sad"],
	disappointed: ["dejected", "downcast", "sad", "sorrowful", "mundane"],
	disapproving: ["stern", "disdainful", "cold", "annoyed", "angry"],
	disgusted: ["revolted", "repulsed", "contemptuous", "stern", "angry"],
	embarrassed: ["awkward", "shy", "sheepish", "nervous"],
	excited: ["enthusiastic", "energetic", "eager", "thrilled", "joyful", "happy"],
	scared: ["fearful", "afraid", "frightened", "terrified", "anxious", "nervous"],
	grateful: ["thankful", "appreciative", "warm", "tender", "joyful"],
	sorrowful: ["mournful", "grieving", "sad", "melancholy", "somber"],
	happy: ["joyful", "cheerful", "delighted", "glad", "upbeat", "excited"],
	tender: ["gentle", "loving", "affectionate", "warm", "soft", "caring"],
	nervous: ["anxious", "worried", "uneasy", "tense", "scared"],
	hopeful: ["optimistic", "upbeat", "positive", "joyful", "happy"],
	proud: ["confident", "assured", "stern", "joyful"],
	thoughtful: ["contemplative", "pensive", "reflective", "curious", "mundane"],
	relieved: ["calm", "relaxed", "comforted", "mundane", "joyful"],
	remorseful: ["regretful", "sorry", "apologetic", "sad", "sorrowful"],
	sad: ["sorrowful", "melancholy", "unhappy", "downcast", "somber"],
	surprised: ["shocked", "astonished", "startled", "amazed", "excited"]
})

const norm = (s: string): string => s.trim().toLowerCase()

/**
 * The word a vocabulary spells `word` (the layout's tag word for `label`) as,
 * or null when it holds nothing close.
 *
 * `vocabulary: 'open'` takes any tag, so the layout's own word stands. Tries,
 * in order: the word itself, its synonyms, the label itself. Returns the
 * vocabulary's own spelling (its case), not the input's.
 */
export function crosswalkTag(
	word: string,
	label: string | null | undefined,
	vocabulary: readonly string[] | "open" | undefined
): string | null {
	const w = norm(word)
	if (!w) return null
	if (vocabulary === "open") return word.trim()
	if (!vocabulary?.length) return null
	const held = new Map(vocabulary.map((v) => [norm(v), v]))
	const candidates = [w, ...(TAG_SYNONYMS[w] ?? []), ...(label ? [norm(label)] : [])]
	for (const c of candidates) {
		const hit = held.get(c)
		if (hit !== undefined) return hit
	}
	return null
}
