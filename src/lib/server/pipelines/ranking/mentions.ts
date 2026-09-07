/**
 * Descriptive mentions — *"the captain"*, *"the order"*, *"that bridge"*.
 *
 * The query side of the entity-vector space (retrieval plan phase 4). Nothing
 * here embeds anything or reads a table: it takes the scan window and returns
 * the stretches of it that **refer to something by describing it** rather than
 * by naming it.
 *
 * ## Why this is a separate detector and not another tier of `extractEntities`
 *
 * `entities.ts` answers *"what does this passage name"*, and both its tiers
 * key on a name being present — the gazetteer's, or a capitalised run's. A
 * definite description contains no name at all. It is the one class of
 * reference the whole lexical stack is structurally unable to see: no key
 * matches it, no trigram folds it onto a title, and the gazetteer has nothing
 * to look up. It is also, as the plan puts it, *"the references people
 * actually write"*.
 *
 * ## The rule that keeps this safe, stated as a rule
 *
 * > **Exact and trigram matching own invented names; entity vectors own
 * > descriptive references.**
 *
 * Invented proper nouns are where embeddings are least reliable: *"Vell"* has
 * no learned meaning, so its vector comes from subword fragments, and
 * phonetically similar invented names cluster. In a world holding Vell, Vall
 * and Vela a vector comparison can confidently link the wrong one, and **a
 * confident wrong link is worse than a miss** — it injects wrong lore with
 * high confidence, in a fixed budget, displacing right lore.
 *
 * So this detector is built to be *incapable* of emitting an invented name.
 * Two mechanisms, and between them they cover both tiers of the extractor:
 *
 *   1. **Every word of a mention is lower case**, except a determiner opening a
 *      sentence, where the capital is orthography rather than a name. A
 *      capitalised run is what `extractEntities`' open tier claims, so anything
 *      that tier could produce is unreachable from here by construction — no
 *      overlap test needed, and no dependence on its cap or its corroboration
 *      rule.
 *   2. **A span the gazetteer already claims is dropped** (`gazetteerSpans`).
 *      *"the ashguard"* is lower case and is still an authored name; the exact
 *      matcher owns it, and offering it to a linker as well would be the
 *      second half of *"do not let entity vectors override an exact match"*.
 *
 * What survives is a definite noun phrase made of ordinary words, which is the
 * one thing embeddings compare **well** — short string against short string,
 * both in distribution.
 *
 * ## What this does not do, measured rather than guessed
 *
 * **Bare pronouns.** *"her"*, *"them"*, *"it"*. That needs coreference, which is
 * a different and harder problem, and the plan states plainly it is not caught
 * at any level. Named here so nobody reads the determiner list as an oversight.
 *
 * **It has no part-of-speech tagger, so a description can carry a word or two of
 * its own predicate.** *"I hear the order rides at dawn"* yields *"the order
 * rides"*, because `rides` is a content word and nothing here can tell a verb
 * from a noun. Stopping at function words removed the gross form of this — the
 * first version returned *"the order has ridden north"*, a whole clause — and
 * what remains is the residue.
 *
 * It is left rather than chased, and the reason is the shape of the harm. A
 * trailing verb **dilutes** the comparison; it does not corrupt it. *"The order
 * rides"* still has *order* as its dominant term and still reaches The Ashguard
 * Riders, just with a lower similarity than *"the order"* would — and a lower
 * similarity ranks lower under a cap that keeps the best links, which is the
 * mechanism already in place for exactly this. The alternatives all cost more
 * than they buy: a verb suffix rule (`-ed`, `-ing`) cuts *"the old burned
 * bridge"* at *"the old"*, and an irregular-verb list is a second English-only
 * vocabulary to maintain beside `SENTENCE_OPENERS` for a quality nuance in an
 * mechanism that can only reorder.
 *
 * A NER model (plan phase 9) is what closes it properly, by finding mention
 * spans directly instead of inferring them from a determiner. Its output lands
 * in this shape, which is why `MENTION_EXTRACTOR_VERSION` rides on every stored
 * vector — swapping the two must invalidate what the heuristic produced rather
 * than silently mixing two vocabularies of mention.
 */

import { SENTENCE_OPENERS, gazetteerSpans, type Gazetteer } from "./entities"

/**
 * The identity of *this* way of finding mentions.
 *
 * Carried on every entity vector, beside the content hash and the gazetteer
 * hash, so that replacing the heuristic with a model invalidates what the
 * heuristic produced rather than silently mixing two vocabularies of mention.
 * Versioned in the name for the reason a vector space is — a recipe change
 * re-embeds only what that recipe produced.
 */
export const MENTION_EXTRACTOR_VERSION = "core:extract/mentions-definite@1"

/** One descriptive reference, as it appeared. */
export interface Mention {
	/** The surface form, whitespace-collapsed — what gets embedded. */
	text: string
	/** Character offsets in the window, for a receipt to point at. */
	start: number
	end: number
	/**
	 * How far through the window it sat, `0` at the start and `1` at the end.
	 *
	 * Ruling R4 asks for links ranked on *"proximity and match quality"*, and
	 * this is the proximity half: what is being said now is a better guide to
	 * what the reply needs than what was said ten messages ago. It orders
	 * links; it deliberately does **not** scale the score, because a decay
	 * constant is exactly the per-corpus calibration R4 removes.
	 */
	position: number
	/** How many times the window said it. */
	count: number
}

/**
 * Determiners that make a noun phrase *refer to a particular thing*.
 *
 * Definite and demonstrative only. *"a captain"* introduces one; *"the
 * captain"* points at one the reader is expected to already know, which is
 * precisely the case where a lorebook entry exists and no key matches. Adding
 * the indefinite article would roughly double the mention count and every
 * addition would be a phrase that refers to nothing.
 */
const DETERMINERS = new Set(["the", "this", "that", "these", "those"])

/**
 * Heads that describe nothing.
 *
 * A mention is only worth an embedding if its head noun carries meaning to
 * compare against a name. *"the same"*, *"the other one"* and *"the thing"*
 * carry none, and they are frequent enough in dialogue to dominate the cap.
 *
 * Short on purpose. A wrongly-kept head costs one embedding and a link the cap
 * will rank below better ones; a wrongly-listed head costs that reference in
 * every session there is.
 */
const WEAK_HEADS = new Set([
	"one",
	"ones",
	"other",
	"others",
	"same",
	"thing",
	"things",
	"way",
	"ways",
	"time",
	"times",
	"rest",
	"lot",
	"bit",
	"kind",
	"sort",
	"part",
	"whole",
	"matter",
	"idea",
	"point",
	"reason",
	"moment",
	"end",
	"sound"
])

/**
 * How many words may sit between the determiner and the head.
 *
 * Not a part-of-speech tagger — a bounded run of ordinary lower-case *content*
 * words, which is what an adjective stack looks like without one. The bound is
 * the second of two limits and the weaker one: past three modifiers a definite
 * description has turned into a sentence, and a sentence embedded as a name
 * compares against nothing.
 *
 * ⚠ The limit that does the real work is `SENTENCE_OPENERS`, and the first
 * version of this file did not have it. Taking the longest lower-case run
 * instead read *"I hear the order has ridden north"* as one mention of **"the
 * order has ridden north"** — the noun phrase plus its whole predicate — which
 * embeds as a sentence and matches no name at all. Stopping at the first
 * function word ends it at *"the order"*, which is the reference. Measured on
 * the examples, not reasoned: every one of the four probe strings was wrong
 * before this.
 */
const MAX_MODIFIERS = 3

/** The shortest head worth comparing. Two letters is a particle, not a noun. */
const MIN_HEAD_LENGTH = 3

/**
 * The most mentions one window contributes.
 *
 * A ceiling rather than a knob, for `MAX_ENTITIES`' reason one construct over:
 * every mention is an embedding call on the turn that runs the mechanism, so an
 * unbounded set is an unbounded cost on the reply path. What falls off the end
 * is what the window said least and earliest.
 */
export const MAX_MENTIONS = 12

/** Word tokens with case intact. The same pattern `entities.ts` tokenises on. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu
/** Sentence ends. Newlines count: dialogue and action lines rarely punctuate. */
const SENTENCE_END = /[.!?…\n\r;:]/
const LOWERCASE_WORD = /^[\p{Ll}\p{N}][\p{L}\p{N}'’_-]*$/u

const collapse = (text: string) => text.replace(/\s+/g, " ").trim()

/**
 * The descriptive references a passage makes.
 *
 * Greedy from each determiner: take the longest run of lower-case words that
 * still ends on a plausible head, so *"the old stone bridge"* is one mention
 * rather than three. A run never crosses a sentence end, for the reason the
 * entity extractor's runs do not — *"Shut. The draught…"* merging across a full
 * stop is how that one first went wrong.
 *
 * `gazetteer` is optional so the detector is testable on its own, and the
 * caller that has one **must** pass it: without it an authored lower-case name
 * reaches the linker as a description, which is the one thing the rule above
 * forbids.
 */
export function extractMentions(
	text: string,
	gazetteer?: Gazetteer
): { extractorVersion: string; mentions: Mention[]; claimed: number } {
	const empty = {
		extractorVersion: MENTION_EXTRACTOR_VERSION,
		mentions: [] as Mention[],
		claimed: 0
	}
	if (!text) return empty

	const claimed = gazetteer ? gazetteerSpans(text, gazetteer) : []
	const overlapsClaim = (start: number, end: number) =>
		claimed.some((c) => start < c.end && c.start < end)

	type Word = { text: string; lower: string; start: number; end: number }
	/** Words, in sentences. A run may not span two of these. */
	const sentences: Word[][] = []
	let current: Word[] = []
	let cursor = 0
	for (const m of text.matchAll(WORD)) {
		if (SENTENCE_END.test(text.slice(cursor, m.index)) && current.length) {
			sentences.push(current)
			current = []
		}
		const raw = m[0]!
		current.push({
			text: raw,
			lower: raw.toLowerCase(),
			start: m.index,
			end: m.index + raw.length
		})
		cursor = m.index + raw.length
	}
	if (current.length) sentences.push(current)

	/** A word that continues a description rather than ending it. */
	const isModifier = (word: Word) =>
		LOWERCASE_WORD.test(word.text) && !SENTENCE_OPENERS.has(word.lower)

	/** Normalised surface → the mention, so repeats count rather than repeat. */
	const found = new Map<string, Mention>()
	const order: string[] = []
	/**
	 * Descriptions an authored name was already sitting on.
	 *
	 * Counted here rather than by running the whole scan a second time without
	 * the vocabulary, which is what the first version of the caller did. It is
	 * reported because a window where every reference resolved exactly and a
	 * window that described nothing look identical from the outside, and only
	 * one of them means the mechanism has nothing to add.
	 */
	let claimedCount = 0

	for (const words of sentences)
		for (let i = 0; i < words.length; i++) {
			const det = words[i]!
			if (!DETERMINERS.has(det.lower)) continue
			/**
			 * ⚠ **A capitalised determiner is allowed only at a sentence
			 * start**, where the capital is orthography rather than a name.
			 *
			 * Mid-sentence, *"The Ashguard"* is a capitalised run and belongs to
			 * `extractEntities`' open tier; reading it as a description would be
			 * this mechanism claiming exactly the invented-name territory the rule
			 * above gives to exact matching. But rejecting **every** capitalised
			 * determiner would throw away every description that happens to open
			 * a sentence, which in dialogue is most of them — *"The captain said
			 * so."* is not a proper noun, and the head being lower case is what
			 * says so.
			 *
			 * Every word *after* the determiner must still be lower case, which
			 * is what keeps a proper-noun run unreachable from here either way.
			 */
			if (i > 0 && !LOWERCASE_WORD.test(det.text)) continue

			// The run this determiner leads: content words only, bounded.
			let last = i
			for (
				let j = i + 1;
				j < words.length && j - i <= MAX_MODIFIERS + 1;
				j++
			) {
				if (!isModifier(words[j]!)) break
				last = j
			}
			if (last === i) continue

			/**
			 * A run ending on a weak head is dropped whole, not trimmed back.
			 *
			 * ⚠ Trimming was the first version and it manufactured junk: *"the
			 * old ways"* gave up `ways` and kept **"the old"**, a modifier
			 * standing in for a head. An English noun phrase's head is its last
			 * word, so a run ending on a word that describes nothing is a phrase
			 * that describes nothing — everything before it was modifying the
			 * word just rejected. Dropping costs the rare run whose real head is
			 * followed by a weak word, and a miss is much cheaper here than a
			 * mention: a junk mention spends an embedding and a slot in the cap
			 * that a real reference wanted.
			 */
			const head = words[last]!
			if (
				WEAK_HEADS.has(head.lower) ||
				head.lower.length < MIN_HEAD_LENGTH
			) {
				i = last
				continue
			}

			const start = det.start
			const end = words[last]!.end
			if (overlapsClaim(start, end)) {
				claimedCount++
				i = last
				continue
			}

			const surface = collapse(text.slice(start, end))
			const key = surface.toLowerCase()
			const position = text.length > 1 ? start / (text.length - 1) : 0
			const seen = found.get(key)
			if (seen) {
				seen.count++
				// The **last** occurrence wins the position, because the
				// proximity question is "how recently was this said", not
				// "when was it first said".
				if (position >= seen.position) {
					seen.position = position
					seen.start = start
					seen.end = end
				}
			} else {
				found.set(key, {
					text: surface,
					start,
					end,
					position,
					count: 1
				})
				order.push(key)
			}
			// Continue scanning after the run, so "the bridge the riders held"
			// yields two mentions rather than one overlapping pair.
			i = last
		}

	/**
	 * Most recent first, then most repeated, then first seen.
	 *
	 * The cap has to be deterministic or two runs over one session disagree
	 * about what the scene referred to — the same requirement `extractEntities`
	 * states for its own cap. Recency leads because the reply is being written
	 * for the end of the window.
	 */
	return {
		extractorVersion: MENTION_EXTRACTOR_VERSION,
		claimed: claimedCount,
		mentions: [...found.values()]
			.sort(
				(a, b) =>
					b.position - a.position ||
					b.count - a.count ||
					order.indexOf(a.text.toLowerCase()) -
						order.indexOf(b.text.toLowerCase())
			)
			.slice(0, MAX_MENTIONS)
	}
}
