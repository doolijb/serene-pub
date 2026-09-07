/**
 * Entity extraction, and the evidence that admits an entry no key matched.
 *
 * ## What this is the front half of
 *
 * A standalone extractor with no dependency on the ranker, deliberately: the
 * follow-on lane persists what it returns into per-source annotation tables
 * (`entry_annotations`, `message_annotations` — real foreign keys per plan
 * Part 5, **not** one table with `(sourceKind, sourceId)`) and adds an entity
 * query node over them. Nothing here writes anything or knows a table exists.
 * `extractEntities` takes text plus the world's own vocabulary and returns
 * structured entities with spans, which is the shape an annotation row wants.
 *
 * ## Two tiers, and the first one is the point
 *
 * This is not open-domain NER, because Serene Pub already knows most of its own
 * entity vocabulary. So:
 *
 *   1. **Gazetteer.** Names the session knows — characters and their nicknames,
 *      personas, lorebook entry titles — matched on a word boundary. A hit
 *      **resolves to a row**, which makes it high precision and free, and makes
 *      two surface forms of one character (`Alice`, her nickname `Al`) the same
 *      entity rather than two.
 *   2. **Open.** Capitalised runs the gazetteer did not claim, filtered by a
 *      stoplist and a sentence-start rule. These stay **unresolved strings**.
 *
 * The split maps onto plan Part 2's *"references that don't resolve yet"*:
 * resolution is enrichment, not a precondition. An unresolved entity is a
 * candidate the story invented, and promoting one to a row is the existing
 * propose-and-review gate's job, not this module's.
 *
 * ## Why the admission gate lives here too
 *
 * `keywordQuery` admits a candidate on `pinned || keyword > 0 || nameMatch > 0`.
 * Every other signal is computed *before* that line, so tf-idf and entity
 * co-occurrence could only ever reorder what the author's keys had already let
 * in — an entry with no matching key could not reach the prompt however
 * relevant it was. That one condition, not the ranking, is what forces a
 * lorebook to be hand-indexed, and it is why an entry keyed `ashguard` does not
 * fire on *"the Riders"*, *"them"* or *"the order"*.
 *
 * `evidence()` is the other way in, and it needs no model and no network: what
 * the conversation is naming, and how much rare vocabulary it shares with an
 * entry.
 *
 * ## What is deliberately not here
 *
 * **Semantic similarity.** The design lists it as a third evidence term "when
 * an embedding model is loaded", and it is absent on purpose: this is the
 * *keyword* mechanism, which reads rows and matches strings and does not reach the
 * network (16 §1). Cosine belongs to `core:query/vector-search@1`, whose wiring
 * into `respond` is a separate decision. Declaring a weight for a number
 * nothing computes is how this subsystem's dead controls got made, so there is
 * no such weight.
 *
 * **A third definition of the co-occurrence *signal*.** `signals.ts` keeps two
 * — world lore asks whether the entry names somebody in the cast, character
 * lore asks whether the entry's own character spoke in the guaranteed window —
 * and this file touches neither. Those score; this admits. The split is
 * honoured *here* as well: `evidence` takes the entity term as an argument, and
 * `keywordQuery` supplies overlap for world lore and history and the speaker
 * answer for character lore, exactly as `scoreSignals` does.
 */

import { tokenize } from "$lib/server/pipelines/ranking/signals"

/**
 * The extractor's identity, carried on everything it returns.
 *
 * ⚠ **Bump this whenever the extraction changes** — the stoplist, the particle
 * list, either rule, the tokeniser. Annotations persisted by the follow-on lane
 * are only valid for the extractor that produced them, and the same discipline
 * the named-vector design uses for `(model, modelVersion, normalization, dims)`
 * applies for the same reason: a stored result whose producer moved underneath
 * it is worse than no stored result, because nothing about it looks wrong.
 * Cheap now, expensive to retrofit.
 */
export const EXTRACTOR_VERSION = "core:extract/entities-heuristic@1"

/** What a gazetteer hit resolved to. Absent on an open-tier entity. */
export interface EntityRef {
	kind: "character" | "persona" | "entry"
	/**
	 * The row id. Entry ids are unique because `lorebook_entries` is one table
	 * now — the three legacy tables had independent sequences, which is why
	 * candidate identity elsewhere in the ranker is still keyed `source:id`.
	 */
	id: number
}

export type EntityTier = "gazetteer" | "open"

/** One thing a passage names. */
export interface Entity {
	/**
	 * The identity within one extraction.
	 *
	 * `character:12` for a resolved hit, so a name and a nickname are one
	 * entity; `open:the ashguard riders` otherwise.
	 */
	key: string
	/** The fullest surface form the passage used, for receipts. */
	text: string
	tier: EntityTier
	ref?: EntityRef
	/** How many times it was named. */
	count: number
	/** Character offsets of each mention, for an annotation row to record. */
	spans: Array<{ start: number; end: number }>
}

export interface Extraction {
	extractorVersion: string
	entities: Entity[]
}

/** A name the world already knows, and what it names. */
export interface GazetteerName {
	name: string
	ref: EntityRef
}

export interface Gazetteer {
	/** Normalised surface form → what it resolves to. */
	byName: ReadonlyMap<string, EntityRef>
	/** Compiled once. Null when there is nothing to match. */
	matcher: CompiledMatcher | null
}

/**
 * Words that are capitalised because a sentence started, not because they name
 * anything.
 *
 * ⚠ **English, and knowingly so.** It is the only language-specific thing in
 * this file, and it is confined to the *sentence-initial* rule — a capitalised
 * word anywhere else is kept whatever this list says, and the gazetteer tier
 * does not consult it at all. A non-English session therefore loses some
 * sentence-opening open-tier entities and keeps everything it actually named,
 * rather than being judged by a list that does not describe it.
 *
 * Only high-frequency openers belong here. A rare word wrongly kept costs one
 * spurious entity in one session; a real name wrongly listed costs that name in
 * every session there is.
 *
 * It has a second reader, and the name understates what it is: `distinctiveTokens`
 * uses it as a **stoplist**, to decide which words of a multi-word title are
 * worth indexing on their own, and `ranking/mentions.ts` uses it the same way —
 * to decide where a definite description stops. Both are asking *"is this word
 * function rather than content"*, which is the same question the
 * sentence-initial rule asks, so the one list serves all three rather than
 * three lists drifting apart. Exported for that reason and no other.
 */
export const SENTENCE_OPENERS = new Set(
	`a an the this that these those there here it its
	 i me my mine we us our ours you your yours he him his she her hers they them their theirs
	 and but or nor so yet if then than when while where why how what who whom whose which
	 as at by from in into of off on onto out over to up with within without about after before
	 again all also always am any anyone anything are aren be because been being both
	 can cannot come could couldn did didn do does doesn doing don done
	 each either else enough even ever every everyone everything
	 far few first get gets getting give given go goes going good got
	 had hadn has hasn have haven having hey hi hmm however
	 is isn just keep kept know known
	 last least less let like listen little long look looking
	 make many may maybe might more most much must
	 near never new next no nobody none not nothing now
	 oh ok okay once one only other others ought
	 perhaps please put
	 quite rather really right
	 said same say says see seen shall should shouldn since some someone something soon still such sure
	 take tell thanks thank thus too took
	 under until upon use used
	 very
	 wait was wasn well were weren whatever whether while will with won would wouldn
	 yeah yes you`
		.split(/\s+/)
		.filter(Boolean)
)

/**
 * Lowercase words allowed *inside* a multi-word name.
 *
 * "Order of the Ashguard" is one entity; "Order" alone is a different and much
 * weaker one. Kept deliberately short — every word here is a chance to glue two
 * unrelated names into one that matches nothing.
 */
const NAME_PARTICLES = new Set([
	"of",
	"the",
	"de",
	"del",
	"della",
	"der",
	"den",
	"di",
	"du",
	"da",
	"das",
	"dos",
	"la",
	"le",
	"van",
	"von",
	"bin",
	"ibn",
	"al"
])

/**
 * The most entities one extraction carries.
 *
 * A ceiling rather than a tuning knob: the matcher compiles one alternation
 * over these and runs it against every entry's text, so an unbounded set is an
 * unbounded regex. What falls off the end is what the passage named least.
 */
const MAX_ENTITIES = 32

/**
 * The shortest gazetteer alias that is matched at all.
 *
 * ⚠ Not the "Al fires on Alchemy" fix — that is the word boundary below, and it
 * is what lets a two-letter name stay. This is only about a *single character*,
 * which is an initial or a list marker rather than a name, and which would
 * otherwise match every standalone letter in every entry. `castEntityNames`
 * argues against a minimum length and is right about the case it argues: a
 * character called "Ed" or "Jo" is not hypothetical, and both survive this.
 */
const MIN_ALIAS_LENGTH = 2

/**
 * The shortest *token* of a multi-word name that becomes a key of its own.
 *
 * Longer than `MIN_ALIAS_LENGTH` on purpose, and the two are not the same
 * question. That one is about a whole authored name, which somebody chose and
 * meant; this one is about a fragment nobody chose — a three-letter word pulled
 * out of a title is far likelier to be an ordinary word than a reference, and
 * every key here is matched against every entry in the book. A short name still
 * works: "Ed" and "Bob" are one token, so their key is the whole name and this
 * never applies to them.
 */
const MIN_TOKEN_KEY_LENGTH = 4

/**
 * How many tokens of one name become keys.
 *
 * A ceiling, for `MAX_ENTITIES`' reason: the matcher compiles one alternation
 * over every key and runs it against every entry, so an unbounded number of
 * keys per name is an unbounded regex. Titles are short; a name needing more
 * than four distinctive words is a sentence, and the words after the fourth are
 * where the false positives live.
 */
const MAX_TOKEN_KEYS = 4

/** Word tokens with their case intact, unlike `tokenize`. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu
/** Sentence ends. Newlines count: dialogue and action lines rarely punctuate. */
const SENTENCE_END = /[.!?…\n\r;:]/
const CAPITALISED = /^\p{Lu}/u

const normalise = (text: string) =>
	text.toLowerCase().replace(/\s+/g, " ").trim()

/** `Kaelen's` names Kaelen. Trailing apostrophes and hyphens are punctuation. */
const stripPossessive = (word: string) =>
	word.replace(/['’]s$/iu, "").replace(/['’-]+$/u, "")

const escapeRegex = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

// ── The matcher ─────────────────────────────────────────────────────────────

interface CompiledMatcher {
	re: RegExp
	/** Group index (1-based) → which alternative it was. */
	keys: string[]
}

/**
 * One alternation over a set of names, matched on a word boundary.
 *
 * The boundary assertions are the pair `matchesKey`'s `word` mode uses, not
 * `\b`: JavaScript's `\b` is ASCII-only and would put a boundary in the middle
 * of "Zoë". They are what fixes the plan's second caveat — the old signal was
 * substring-matched, so "Al" fired on "Alchemy" and a short name made the
 * signal fire on nearly everything.
 *
 * Longest alternative first, so "Ashguard Riders" is itself rather than a hit
 * on "Ashguard" with a word left over. Each alternative gets a capture group,
 * and the group is how the hit is identified — reading the identity back off
 * the matched *text* looked simpler and is wrong, because the pattern joins a
 * multi-word name across whitespace and dashes, so "Ash-Guard" matches the name
 * `ash guard` and normalising the match would not produce that key back.
 */
function compileMatcher(
	names: ReadonlyArray<{ name: string; key: string }>
): CompiledMatcher | null {
	const usable = names.filter((n) => n.name.length >= MIN_ALIAS_LENGTH)
	if (usable.length === 0) return null
	const ordered = [...usable].sort((a, b) => b.name.length - a.name.length)
	const re = new RegExp(
		`(?<![\\p{L}\\p{N}_])(?:${ordered
			.map(
				(n) =>
					`(${n.name.split(" ").map(escapeRegex).join("[\\s\\-]+")})`
			)
			.join("|")})(?![\\p{L}\\p{N}_])`,
		"giu"
	)
	return { re, keys: ordered.map((n) => n.key) }
}

/**
 * Which of the compiled names a passage contains, and where.
 *
 * Case-insensitive on purpose, and it is the reason the admission gate matches
 * the *conversation's* entities against an entry's text rather than
 * intersecting two extractions. Extraction is capitalisation-sensitive by
 * necessity — that is what tells a name from a noun — so requiring both sides
 * to capitalise would drop every entry that writes "the ashguard" in prose,
 * which is most of them. Extract on the side that has to be discovered; match
 * on the side that only has to be checked.
 */
function runMatcher(
	matcher: CompiledMatcher,
	text: string
): Map<string, Array<{ start: number; end: number; text: string }>> {
	const out = new Map<
		string,
		Array<{ start: number; end: number; text: string }>
	>()
	if (!text) return out
	matcher.re.lastIndex = 0
	for (const m of text.matchAll(matcher.re))
		for (let g = 1; g < m.length; g++)
			if (m[g] !== undefined) {
				const key = matcher.keys[g - 1]!
				const hit = {
					start: m.index,
					end: m.index + m[0]!.length,
					text: m[0]!
				}
				const seen = out.get(key)
				if (seen) seen.push(hit)
				else out.set(key, [hit])
				break
			}
	return out
}

// ── The gazetteer ───────────────────────────────────────────────────────────

export const entityKey = (ref: EntityRef): string => `${ref.kind}:${ref.id}`

/**
 * The words of a multi-word name that are worth matching on their own.
 *
 * Design §13.9, and it is the correction that makes tier one work at all rather
 * than a refinement of it. *"The Ashguard Riders"* is what an author types into
 * a title field; *"the ashguard"* is what anybody writes in a scene. Requiring
 * the whole string means the gazetteer misses the reference that actually
 * occurs — measured on the parity corpus, where the window *"Well met. And you.
 * Have you seen the ashguard?"* extracted **nothing at all** against a
 * gazetteer of `alice`, `bob`, `the ashguard riders`, `alice keeps vigil`.
 *
 * A one-word name returns nothing here, because its whole string is already its
 * key. Everything else drops the words that are not distinctive — the particles
 * a name is glued together with, the sentence openers, anything shorter than
 * `MIN_TOKEN_KEY_LENGTH` — and keeps at most `MAX_TOKEN_KEYS` of the rest.
 *
 * ⚠ **Looser keys, not looser matching.** The word boundary and the alias
 * minimum in `compileMatcher` are untouched: "Al" still does not fire on
 * "Alchemy", and buying recall by relaxing that instead would undo §4's second
 * named caveat. What widens is *what counts as a name*, which is an authoring
 * question; how a name is recognised in text is unchanged.
 *
 * The trailing-`s` test is a stemmer of exactly one rule, and only against the
 * stoplist: "keeps" in *"Alice Keeps Vigil"* is the verb "keep", which the list
 * already holds. Names are not stemmed — "Riders" stays "riders" — because a
 * stemmed key would stop matching the word the author wrote.
 */
function distinctiveTokens(normalisedName: string): string[] {
	const parts = normalisedName.split(" ").filter(Boolean)
	if (parts.length < 2) return []
	const out: string[] = []
	for (const part of parts) {
		const token = stripPossessive(part)
		if (token.length < MIN_TOKEN_KEY_LENGTH) continue
		if (NAME_PARTICLES.has(token)) continue
		if (
			SENTENCE_OPENERS.has(token) ||
			SENTENCE_OPENERS.has(token.replace(/s$/u, ""))
		)
			continue
		out.push(token)
		if (out.length >= MAX_TOKEN_KEYS) break
	}
	return out
}

/**
 * The names this world already knows.
 *
 * Fed by the caller rather than read here, so that what goes in is a decision
 * somebody made at a place that can see the whole world. The annotation lane
 * (`server/annotations/gazetteer.ts`) supplies the lorebook's cast — bindings,
 * with `aliases` **and** `absorbedAliases` — and its own entry titles.
 *
 * Two passes, and the order is the point. Every full name is claimed first, then
 * the distinctive tokens of each; so a token pulled out of an entry title can
 * never take a key that some other row's whole name wanted. Within a pass it is
 * first writer wins, which is why the cast is supplied before the entries — a
 * character called "Vell" resolves to the character rather than to an entry
 * titled after her.
 *
 * ⚠ A consequence worth stating: *"Alice"* being claimed by the character does
 * **not** cut the entry *"Alice Keeps Vigil"* off from a conversation that says
 * it. Matching runs the other way — the window yields the entity `character:N`,
 * and that entity is then matched into the entry's own text under every surface
 * form it answers to, which includes the "Alice" in its title. One name, one
 * identity, and both rows reached through it.
 */
export function buildGazetteer(names: readonly GazetteerName[]): Gazetteer {
	const byName = new Map<string, EntityRef>()
	const claim = (key: string, ref: EntityRef) => {
		if (!key || key.length < MIN_ALIAS_LENGTH) return
		if (!byName.has(key)) byName.set(key, ref)
	}

	const normalised = names.map(({ name, ref }) => ({
		key: normalise(typeof name === "string" ? name : ""),
		ref
	}))
	for (const { key, ref } of normalised) claim(key, ref)
	for (const { key, ref } of normalised)
		for (const token of distinctiveTokens(key)) claim(token, ref)

	return {
		byName,
		matcher: compileMatcher(
			[...byName].map(([name, ref]) => ({ name, key: entityKey(ref) }))
		)
	}
}

export const EMPTY_GAZETTEER: Gazetteer = {
	byName: new Map(),
	matcher: null
}

/**
 * Where the gazetteer's names occur in a passage — tier one's spans, uncapped.
 *
 * `extractEntities` computes the same hits and then keeps only `MAX_ENTITIES`
 * of them, which is right for *what the scene is about* and wrong for *which
 * stretches of text a name already owns*. `ranking/mentions.ts` needs the
 * second question: a descriptive mention is only its own thing when no
 * authored name is sitting on those characters, and a claim that fell off the
 * end of the cap would hand a resolved name to the linker as if nothing had
 * matched it.
 *
 * Exported rather than re-derived there, because two matchers over one
 * gazetteer is two answers to *"does this passage say Vell"* — the divergence
 * this module's whole two-tier split exists to avoid.
 */
export function gazetteerSpans(
	text: string,
	gazetteer: Gazetteer = EMPTY_GAZETTEER
): Array<{ start: number; end: number }> {
	if (!gazetteer.matcher || !text) return []
	const out: Array<{ start: number; end: number }> = []
	for (const hits of runMatcher(gazetteer.matcher, text).values())
		for (const hit of hits) out.push({ start: hit.start, end: hit.end })
	return out
}

// ── Extraction ──────────────────────────────────────────────────────────────

/**
 * The entities a passage names.
 *
 * Tier one runs first and claims its spans; tier two is capitalised runs that
 * do not overlap a claim, with two rules doing the real work:
 *
 *   1. A run that begins a sentence is only kept if something corroborates it —
 *      a capitalised word *inside* the run (which cannot be there by accident),
 *      or the same word capitalised elsewhere in the passage. Without this rule
 *      every "The", "And" and "Well" opening a line is an entity, and a signal
 *      that fires on everything is worse than one that fires on nothing: it
 *      spends its weight flattening the ordering instead of leaving it alone.
 *   2. Leading openers are dropped before that judgement, so "The Ashguard" is
 *      judged on "Ashguard" — which is not sentence-initial and needs no
 *      corroboration.
 *
 * ## The caveat this cannot fix
 *
 * A proper noun written in lower case is invisible to tier two unless the
 * gazetteer knows it. "the ashguard" is an entity to a reader and a common noun
 * to this. That is the gap tier one exists to cover for everything the world
 * has a row for, `evidence`'s vocabulary term covers statistically, and a real
 * NER model — plan phase 9 — would close.
 */
export function extractEntities(
	text: string,
	gazetteer: Gazetteer = EMPTY_GAZETTEER
): Extraction {
	const found = new Map<string, Entity>()
	const claimed: Array<{ start: number; end: number }> = []

	// ── tier one: names the world knows ──────────────────────────────────
	if (gazetteer.matcher) {
		const refByKey = new Map<string, EntityRef>()
		for (const ref of gazetteer.byName.values())
			refByKey.set(entityKey(ref), ref)

		for (const [key, hits] of runMatcher(gazetteer.matcher, text)) {
			found.set(key, {
				key,
				/**
				 * The **fullest** surface form, not the first.
				 *
				 * A name answers to several keys now (§13.9), so a passage
				 * saying *"your commander? Vell, is it?"* before it says
				 * *"Commander Vell"* would otherwise be reported as
				 * "commander" — one identity described by its least specific
				 * mention. Length is the whole rule: the surfaces of one key
				 * are the same identity by construction, so the longest is the
				 * most informative, and ties keep the first for determinism.
				 */
				text: hits.reduce((a, b) =>
					b.text.length > a.text.length ? b : a
				).text,
				tier: "gazetteer",
				ref: refByKey.get(key),
				count: hits.length,
				spans: hits.map((h) => ({ start: h.start, end: h.end }))
			})
			for (const h of hits) claimed.push({ start: h.start, end: h.end })
		}
	}

	const overlapsClaim = (start: number, end: number) =>
		claimed.some((c) => start < c.end && c.start < end)

	// ── tier two, pass 1: every capitalised word and where it sat ────────
	type Word = { text: string; start: number; opensSentence: boolean }
	const words: Word[] = []
	let opensSentence = true
	let cursor = 0
	for (const m of text.matchAll(WORD)) {
		// Everything skipped since the last word: a terminator in there means
		// the next word opens a sentence. Quotes and brackets between the two
		// change nothing, which is what makes `?" Alice` behave like `? Alice`.
		if (SENTENCE_END.test(text.slice(cursor, m.index))) opensSentence = true
		words.push({ text: m[0]!, start: m.index, opensSentence })
		opensSentence = false
		cursor = m.index + m[0]!.length
	}

	/**
	 * Words seen capitalised somewhere that was *not* the start of a sentence.
	 *
	 * The corroboration set for rule 1, built over the whole passage before any
	 * run is judged — so a name opening one line and appearing mid-sentence in
	 * another is kept in both.
	 */
	const corroborated = new Set<string>()
	for (const w of words)
		if (!w.opensSentence && CAPITALISED.test(w.text))
			corroborated.add(normalise(stripPossessive(w.text)))

	// ── tier two, pass 2: runs ───────────────────────────────────────────
	for (let i = 0; i < words.length; ) {
		const word = words[i]!
		if (!CAPITALISED.test(word.text)) {
			i++
			continue
		}

		const run: Word[] = [word]
		let j = i + 1
		while (j < words.length) {
			const next = words[j]!
			// ⚠ A run never crosses a sentence end. Without this the two
			// capitals either side of a full stop merge, and "Shut. The
			// draught…" produced the entity *"Shut. The"* — which then matched
			// nothing, cost a slot in the cap, and made the receipt read like
			// the extractor was broken, because it was.
			if (next.opensSentence) break
			if (CAPITALISED.test(next.text)) {
				run.push(next)
				j++
				continue
			}
			// A particle only stays if a capitalised word follows it, so
			// "Ashguard of" ends at "Ashguard" while "Order of the Ashguard"
			// does not.
			if (!NAME_PARTICLES.has(next.text.toLowerCase())) break
			let k = j
			while (
				k < words.length &&
				!words[k]!.opensSentence &&
				NAME_PARTICLES.has(words[k]!.text.toLowerCase())
			)
				k++
			if (
				k >= words.length ||
				words[k]!.opensSentence ||
				!CAPITALISED.test(words[k]!.text)
			)
				break
			for (let p = j; p <= k; p++) run.push(words[p]!)
			j = k + 1
		}
		i = j

		let from = 0
		while (
			from < run.length &&
			SENTENCE_OPENERS.has(normalise(stripPossessive(run[from]!.text)))
		)
			from++
		const kept = run.slice(from)
		if (kept.length === 0) continue

		const last = kept[kept.length - 1]!
		const start = kept[0]!.start
		const end = last.start + last.text.length
		if (overlapsClaim(start, end)) continue

		const surface = stripPossessive(text.slice(start, end).trim())
		const name = normalise(surface)
		if (name.length < MIN_ALIAS_LENGTH) continue
		// A bare number is a quantity, not a name. Multi-word runs survive,
		// because "Highway 7" is one.
		if (kept.length === 1 && /^[\p{N}]+$/u.test(name)) continue
		// Already resolved under some other surface form.
		if (gazetteer.byName.has(name)) continue

		const head = kept[0]!
		if (head.opensSentence && kept.length === 1 && !corroborated.has(name))
			continue

		const key = `open:${name}`
		const existing = found.get(key)
		if (existing) {
			existing.count++
			existing.spans.push({ start, end })
		} else {
			found.set(key, {
				key,
				text: surface,
				tier: "open",
				count: 1,
				spans: [{ start, end }]
			})
		}
	}

	// Most-mentioned first, first-seen breaking the tie: the cap has to be
	// deterministic, or two runs over the same session disagree about what the
	// scene is about.
	const order = new Map([...found.keys()].map((k, index) => [k, index]))
	return {
		extractorVersion: EXTRACTOR_VERSION,
		entities: [...found.values()]
			.sort(
				(a, b) =>
					b.count - a.count ||
					(order.get(a.key) ?? 0) - (order.get(b.key) ?? 0)
			)
			.slice(0, MAX_ENTITIES)
	}
}

// ── The evidence ────────────────────────────────────────────────────────────
//
// The pool walk this section used to open with — count how many *entries* a
// term appears in, not how many messages — lives in `signals.ts` now, as
// `buildDocFreq`, beside the two idf builders that read it. It moved when
// `buildBm25Idf` became its second caller: the collection argument below is
// the same argument BM25's idf makes, and one statistic wants one function.

/**
 * `log((N + 1) / (df + 0.5))` — the smoothed form, strictly positive for every
 * `df ≤ N`.
 *
 * The half-count is BM25's, and it is borrowed for BM25's reason: an unsmoothed
 * idf crosses zero and then goes negative on common terms, which turns "this
 * word proves little" into "this word proves the opposite" the moment you sum
 * it.
 */
export const rarity = (df: number, documentCount: number): number =>
	Math.log((documentCount + 1) / (df + 0.5))

/**
 * What one scan needs to answer the admission question, built once.
 *
 * Every part is a fact about the conversation and the pool, and none of it
 * reads the recursion window — which is what lets the gate be decided at level
 * 0 and never revisited.
 */
export interface EvidenceProfile {
	extractorVersion: string
	/** What the recent conversation is naming, both tiers. */
	entities: readonly Entity[]
	/**
	 * Which of those entities an entry's text contains. Memoised, because the
	 * pool is walked twice — once to count entity document frequency, once to
	 * score — and it is the same answer both times.
	 */
	sharedWith: (text: string) => readonly string[]
	/**
	 * Per entity, `log((E + 1) / (df + 0.5))` over the candidate pool.
	 *
	 * The plan's first caveat is that the old signal was **binary** — one shared
	 * entity or twelve scored identically. This is the fix, and it does more
	 * than count: an entity every entry mentions has a rarity near zero and
	 * contributes almost nothing, because an entity that is everywhere says
	 * nothing about which entry to pick. The narrator's own name is the case
	 * that makes it obvious.
	 */
	entityRarity: ReadonlyMap<string, number>
	/**
	 * The rarity of a thing mentioned by exactly one entry — the unit the entity
	 * term counts in.
	 *
	 * Absolute rather than a mean over what happens to be present. A mean makes
	 * the scale move with the pool: a scene naming one thing that every entry
	 * also names would divide by its own near-zero rarity and score full marks
	 * for the entity carrying the least information in the room.
	 */
	referenceEntityRarity: number
	/** Per term, the same rarity over the same pool. */
	termRarity: ReadonlyMap<string, number>
	/** Distinct terms of the recent conversation window. */
	windowTerms: ReadonlySet<string>
	/** Memoised, for the same reason `sharedWith` is. */
	termsOf: (text: string) => ReadonlySet<string>
}

export function buildEvidenceProfile(input: {
	/** The recent conversation window — the query side. */
	window: string
	/** The candidate pool — the collection being searched. */
	entryTexts: readonly string[]
	gazetteer: Gazetteer
}): EvidenceProfile {
	const { entities, extractorVersion } = extractEntities(
		input.window,
		input.gazetteer
	)

	/**
	 * One matcher over what the conversation named, reused for every entry.
	 *
	 * A resolved entity is matched under **every** surface form the gazetteer
	 * knows for it, which is the value of tier one in one line: the conversation
	 * says "Alice" and the entry says "Al", and they are the same person rather
	 * than two strangers.
	 */
	const matcher = compileMatcher(
		entities.flatMap((e) =>
			e.tier === "gazetteer"
				? [...input.gazetteer.byName]
						.filter(([, ref]) => entityKey(ref) === e.key)
						.map(([name]) => ({ name, key: e.key }))
				: [{ name: e.key.slice("open:".length), key: e.key }]
		)
	)

	const sharedCache = new Map<string, readonly string[]>()
	const sharedWith = (text: string): readonly string[] => {
		const hit = sharedCache.get(text)
		if (hit) return hit
		const found = matcher ? [...runMatcher(matcher, text).keys()] : []
		sharedCache.set(text, found)
		return found
	}

	const termsCache = new Map<string, ReadonlySet<string>>()
	const termsOf = (text: string): ReadonlySet<string> => {
		const hit = termsCache.get(text)
		if (hit) return hit
		const terms = new Set(tokenize(text))
		termsCache.set(text, terms)
		return terms
	}

	const entryCount = input.entryTexts.length
	const entityDf = new Map<string, number>()
	const termDf = new Map<string, number>()
	for (const text of input.entryTexts) {
		for (const key of sharedWith(text))
			entityDf.set(key, (entityDf.get(key) ?? 0) + 1)
		for (const t of termsOf(text)) termDf.set(t, (termDf.get(t) ?? 0) + 1)
	}

	const entityRarity = new Map<string, number>()
	for (const e of entities)
		entityRarity.set(e.key, rarity(entityDf.get(e.key) ?? 0, entryCount))

	const termRarity = new Map<string, number>()
	for (const [t, df] of termDf) termRarity.set(t, rarity(df, entryCount))

	return {
		extractorVersion,
		entities,
		sharedWith,
		entityRarity,
		// A pool of nothing has no scale, and no candidates either.
		referenceEntityRarity: entryCount > 0 ? rarity(1, entryCount) : 0,
		termRarity,
		windowTerms: new Set(tokenize(input.window)),
		termsOf
	}
}

/** The parts, kept apart so a receipt can say which one carried it. */
export interface Evidence {
	entity: number
	vocabulary: number
	/** 0 or 1 today: whether this source's own precondition is met. */
	presence: number
	total: number
	/** Which entities this entry shares with the conversation. */
	shared: readonly string[]
}

/**
 * How much non-key evidence there is that this entry belongs in this turn.
 *
 * Both halves are in `[0, 1]`:
 *
 *   · **entity** — rarity-weighted, over the distinct entities the conversation
 *     named that this entry also names. Sharing one entity that few entries
 *     mention is ~0.63, two is ~0.86, one that every entry mentions is ~0.
 *     Saturating, because naming two of the things under discussion is already
 *     as much as this can tell you and a third proves nothing further.
 *   · **vocabulary** — what *fraction* of this entry's own distinctiveness the
 *     conversation is currently using. Coverage rather than a saturating sum,
 *     and the difference is not stylistic: a sum admits any entry long enough
 *     to accumulate a few ordinary words, which is how a guild of pewterers
 *     scored as high as the faction the scene was actually about. A fraction
 *     asks the question that separates them — *is this entry's subject what is
 *     being discussed* — and answers it the same way for a long entry and a
 *     short one.
 *
 * ## Why they combine as a noisy-or and not as a weighted sum
 *
 * A weighted sum has to divide one budget between two sources, so whichever
 * gets the smaller share **cannot admit anything on its own**. Measured on the
 * acceptance corpus: at 0.6/0.4 the vocabulary half needed three-quarters
 * coverage before it reached a threshold of 0.3, which made an entry the
 * conversation was plainly discussing — 60% of it under discussion, no proper
 * noun anywhere on either side — unreachable. The design lists tf-idf as an
 * admitting source, not as a tie-breaker, so that is a wrong answer rather than
 * a strict one.
 *
 *     total = 1 − (1 − wₑ·entity)(1 − wᵥ·vocabulary)
 *
 * Either kind of evidence admits on its own, both together reinforce, and the
 * result stays inside `[0, 1]` so the threshold keeps one meaning. The weights
 * are each term's **strength**: 1 is full, 0 switches that kind of evidence off
 * entirely — which is what an install wanting "only admit on names" would set.
 *
 * ## `presence` — bug 16's split, and why it multiplies
 *
 * 0.5 asked world lore whether the entry names somebody in the cast, and
 * character lore whether the entry's own character **spoke in the guaranteed
 * window**. The second is not evidence *about this entry*; it is a condition on
 * the whole source — the lore of somebody who is not in the scene does not
 * belong in the turn however well its words match. So it multiplies rather than
 * joining the noisy-or, and the caller supplies it: 1 for world lore and
 * history, the speaker answer for character lore.
 *
 * Measured, not assumed: folded in as another evidence term it is worth 1 by
 * itself, so a noisy-or saturates and **every** keyless entry of a present
 * character is admitted at any threshold — a character with forty of them
 * empties the band on relevance nobody assessed. Multiplying keeps 0.5's
 * question and still lets the words decide between one speaker's own entries.
 *
 * Bug 16's *other* complaint — that the world-lore question "scores every
 * present character's private lore alike and distinguishes nothing" — is
 * answered here by the rarity weight rather than by dropping the question: a
 * character-lore entry naming its own character shares an entity that every
 * sibling entry also names, whose rarity is therefore near zero.
 *
 * ⚠ A consequence worth stating: a character who has said nothing in the
 * guaranteed window has `presence = 0`, so none of their keyless lore is
 * admitted by evidence — including, in a group session, the character whose
 * turn is about to be written. Their authored keys still fire. Widening this to
 * the *upcoming* speaker is design §6, which is a separate change: the
 * `speaker` node already runs before retrieval, so the fact is free, but using
 * it is a behaviour change of its own.
 *
 * At full strength a threshold of 0.3 reads as *"one thing the conversation is
 * naming, or a third of what this entry is about being discussed"*.
 */
/**
 * The entity half on its own — *"how much of what the scene is naming does this
 * entry name too"*, rarity-weighted and saturating.
 *
 * Split out of `evidence` rather than duplicated because it has a second caller
 * with a different question. `evidence` answers **admission**: is there enough
 * non-key evidence to let an entry in at all, which is entity *and* vocabulary
 * combined by noisy-or against a threshold. `scoreSignals` answers **ordering**:
 * how much does the entity overlap alone contribute to this entry's score, next
 * to the vocabulary term it already scores separately as `tfidf`. Folding both
 * into one number there would count the vocabulary twice.
 *
 * One definition, two readers, which is the rule this file's own header sets
 * about not growing a third measurement of the same question.
 *
 * `profile.sharedWith` is memoised per text, so the two callers walking the same
 * entry pay for one match.
 */
export function entityEvidence(
	entryText: string,
	profile: EvidenceProfile
): { entity: number; shared: readonly string[] } {
	const shared = profile.sharedWith(entryText)
	if (profile.referenceEntityRarity <= 0) return { entity: 0, shared }
	let mass = 0
	for (const key of shared) mass += profile.entityRarity.get(key) ?? 0
	return {
		entity:
			mass > 0 ? 1 - Math.exp(-mass / profile.referenceEntityRarity) : 0,
		shared
	}
}

export function evidence(
	entryText: string,
	profile: EvidenceProfile,
	weights: { entity: number; vocabulary: number },
	presence = 1
): Evidence {
	const { entity, shared } = entityEvidence(entryText, profile)

	let matched = 0
	let mass = 0
	for (const t of profile.termsOf(entryText)) {
		const r = profile.termRarity.get(t) ?? 0
		mass += r
		if (profile.windowTerms.has(t)) matched += r
	}
	const vocabulary = mass > 0 ? matched / mass : 0

	return {
		entity,
		vocabulary,
		presence,
		total:
			presence *
			(1 -
				(1 - weights.entity * entity) *
					(1 - weights.vocabulary * vocabulary)),
		shared
	}
}
