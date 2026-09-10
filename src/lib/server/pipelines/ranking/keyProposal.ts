/**
 * Keys proposed for a piece of text, without a model.
 *
 * ## The defect this answers
 *
 * When the summarizer writes a history entry it writes **`keys: []`** —
 * `entryInsert` calls `keysToArray(data.keys)` and the caller passes none.
 * Keyword matching is the only retrieval mechanism on by shipped default
 * (`admitThreshold` is 0, and the semantic and entity arms ship at zero
 * entries), and a history row has `title: null` — `entryInsert` writes a title
 * only for a type whose declaration has the `title` role, and history's heading
 * is its date — so `nameMatchSignal` cannot reach it either. Read
 * `keywordQuery`'s admission line and the consequence is exact:
 *
 *     const byKey = pinned || signals.keyword > 0 || signals.nameMatch > 0
 *
 * With no keys and no title both terms are 0, so a summary a user made *so the
 * model would remember* is invisible to the only mechanism that could find it.
 *
 * ## ⚠ The failure mode this is designed against, stated before the algorithm
 *
 * **Character names are the worst possible keys for a history entry.** They are
 * also the first thing any extractor finds, because they are the most frequent
 * capitalised runs in the text. If every scene's entry takes "Cade" as a key
 * then every history entry fires whenever Cade is mentioned — and he is in
 * everything. What distinguishes a scene is not who was in it but what it was
 * *about*.
 *
 * Getting that wrong would replace *"history entries never fire"* with **"all
 * history entries fire together"**, which is strictly worse: one entry crowding
 * out the rest, multiplied across the whole history lane, inside a fixed budget
 * where a wrong entry does not merely waste space but displaces a right one.
 *
 * So nothing here ranks by presence or by raw frequency. Every gate below is
 * about **distinctiveness within the lorebook** — a term that appears in every
 * entry is a bad key however often this passage says it, and one that appears
 * here and rarely elsewhere is a good one.
 *
 * ## The five gates, and why each one is separate
 *
 * 1. **A name the cast answers to is never a key** (`castRefusal`). The
 *    gazetteer already resolves a character's name, her nicknames and her
 *    absorbed aliases to one identity, and the distinctive tokens of a
 *    multi-word name with her — so "Captain" is refused along with "Vell" when
 *    the cast holds Captain Vell. Structural, needs no corpus, and holds on the
 *    first history entry a lorebook ever gets.
 * 2. **A key may not already fire on most of the lorebook** (`footprint`).
 *    Counted with the matcher's own rule, so it measures the key's real firing
 *    behaviour rather than a proxy for it. Catches everything guard 1 has no
 *    row for: the narrator's stock vocabulary, a place every scene passes
 *    through, a word merely common in this book.
 * 3. **A bare word must be distinctive as a term** (`MIN_DISTINCTIVENESS`,
 *    BM25 idf over the entry pool). Gate 2's statement about a different count
 *    — tokens over tokenised documents rather than the key as the matcher
 *    matches it — at half the strictness, so wherever there *is* a corpus this
 *    one can only ever agree with gate 2 after the fact. It exists for the
 *    corpus of **none**: the first entry a lorebook gets, where a share has
 *    nothing to be a share of and this is all that stands between the proposal
 *    and five ordinary words.
 * 4. **A key may not be a fragment of a longer word** (`ridesInsideWords`).
 *    The sharp form of the substring hazard: `mark` is a rare token and sits in
 *    a quarter of one book, so gates 2 and 3 both pass it, and it fires on
 *    "Lowmarket". Measured, on the corpus world, before this gate existed.
 * 5. **~~A bare word must be a word the world uses~~ — measured, and reversed.**
 *    ⚠ Gate 5 was `corroboration`: a bare word had to occur in at least one
 *    other entry, on the reasoning that a word this passage uses and the book
 *    never does is prose rather than subject — "sealed", "handed", "named".
 *
 *    **It selects for exactly the wrong thing and the measurement is not
 *    close.** A word is corroborated *because it is common*, so the gate
 *    admitted `watch`, `gave`, `found`, `came` and `left` — ordinary English
 *    verbs the lorebook naturally repeats — and refused `undercroft`, `silt` and
 *    `storm`, invented nouns written in lower case, which are the best bare-word
 *    keys a summary has. Against ten messages of ordinary narrative English
 *    naming nothing from any scene, it made **8 of 12 history entries fire
 *    together**. With it off: **1 of 12**, at unchanged recall.
 *
 *    It stays reachable as `requireCorroboration`, defaulting **off**, so
 *    `measure/keyProposalCorpus.test.ts` can keep proving it wrong — a rejected
 *    design with a live counter-measurement beside it is worth more than a
 *    comment saying it was tried.
 *
 *    What replaced it is nothing: idf already ranks rarest-first, which is the
 *    same preference pointed the right way round. Gate 5 was fighting it.
 *
 * Each is mutation-tested in `keyProposal.test.ts` — the fixture where the rule
 * holds, beside the same fixture with the rule withheld and the bad key
 * arriving. ⚠ One subsumption is real and is stated rather than hidden: gate 3
 * is unreachable whenever gate 2 has a corpus to count, which is why it is
 * ordered second and why its own note calls it inert everywhere but the cold
 * start.
 *
 * ## ⚠ Why rarity alone is the wrong ranker for a key, and idf is still the one used
 *
 * A key is not a search term. For *scoring* a match, rarer is better without
 * limit — that is what `buildBm25Idf` is for and it is the scorer used here,
 * unchanged, because a second scorer is a second thing to drift.
 *
 * For *choosing* a key, unbounded rarity looks wrong: it picks the hapax, the
 * word this passage used once that no future message will ever say. Gate 5 was
 * built on that intuition and the intuition is **measurably backwards**. A rare
 * word makes a *wasted* key — it fires on almost nothing — and a common one
 * makes a *dangerous* key, because it fires on everything and every other
 * summary in the lane wants it too. Waste costs a slot; danger costs the
 * failure mode this file exists to prevent.
 *
 * So idf ranks rarest-first and there is deliberately **no bound from below**.
 * Gates 2 and 3 bound it from above, `MAX_TERM_KEYS` bounds how many slots the
 * waste may occupy, and everything outside `buildBm25Idf` is a count or a
 * comparison.
 *
 * ## ⚠ What "a key" actually means, and why that decides the shape
 *
 * `matchIndexOf` in `signals.ts` matches a key by **substring on the lowercased
 * scan window** unless the entry says otherwise, and the shipped `matchMode`
 * for a machine-written row is NULL — substring. Three consequences run through
 * everything below:
 *
 *   · A key shorter than a few characters rides inside ordinary words. "art"
 *     fires on "hearth", which is `signals.ts`'s own example of the behaviour
 *     being preserved rather than fixed. `MIN_KEY_LENGTH` and `footprint` both
 *     exist for this.
 *   · A key is matched against the window **as written**, so a two-word key
 *     whose words are separated by a newline in a future message will not
 *     match. `normalise` collapses whitespace and a scan window does not, so a
 *     phrase lifted across a line break is a key the matcher can never find
 *     again. `roundTrip` refuses those.
 *   · If key A is a substring of key B then B can only ever fire where A
 *     already did. Emitting both spends two of a small budget on one firing
 *     opportunity — see `subsumedBy`.
 *
 * **A generated key the matcher cannot match is worse than no key**, so every
 * proposal is re-matched against its own source with `matchesKey` before it is
 * returned. That round trip is a property of the output, asserted per key, and
 * not a test that happens to pass.
 *
 * ## Never invented
 *
 * Every key is a substring of the source text. That is the whole reason this is
 * worth doing without a model: a mechanism that *cannot* hallucinate needs no
 * review for hallucination. It still wants review for judgement, which is why
 * this proposes and never writes — see `KeyProposal.rejected`, the receipt
 * half, which names every candidate it turned away and the rule that did it.
 */

import {
	buildGazetteer,
	distinctiveTokens,
	extractEntities,
	EMPTY_GAZETTEER,
	SENTENCE_OPENERS,
	type Entity,
	type EntityRef,
	type Gazetteer,
	type GazetteerName
} from "$lib/server/pipelines/ranking/entities"
import {
	buildBm25Idf,
	buildScanWindow,
	matchesKey,
	tokenize
} from "$lib/server/pipelines/ranking/signals"

/**
 * The producer's identity, in `EXTRACTOR_VERSION`'s shape.
 *
 * Recorded on the proposal so a reviewer looking at a stored key later can tell
 * which rules produced it. Unlike `EXTRACTOR_VERSION` nothing re-extracts on a
 * bump, because nothing is persisted from here: a proposal is reviewed and then
 * it is a user's key, and a user's key is not this mechanism's to revise.
 */
export const KEY_PROPOSER_VERSION = "core:propose/entry-keys-heuristic@1"

/**
 * How many keys one entry may be given.
 *
 * ⚠ **Each key is an independent firing opportunity**, because admission is
 * `signals.keyword > 0` and any single key matching makes that positive. So
 * cardinality is not a display preference — it is how wide the entry's door is,
 * and it multiplies across every entry the lane writes.
 *
 * Five, and the number comes from both directions meeting:
 *
 *   · From above — a scene summary is about a place, a thing, and one or two
 *     events. Past that an extractor is padding with the best of a bad lot,
 *     which is exactly how the all-fire-together failure gets in. Measured with
 *     the gates disabled, eight keys per entry put **9 of 12** history entries on
 *     ordinary prose and made the shared-name probe fire two entries where five
 *     keys fired none.
 *   · From below — `keywordMatch` returns `matched / keys.length`, so an entry
 *     with ten keys scores a tenth for the same single hit that an entry with
 *     three scores a third. A generous key list makes an entry easier to
 *     *admit* and harder to *rank*, which is the wrong trade in a fixed budget.
 *
 * ⚠ **With the gates at their shipped values this cap is not what binds** — the
 * corpus world gives the same result at 4, 5 and 6, because the gates run out of
 * eligible candidates first. It is the backstop for the book where they do not:
 * a long, name-dense summary against a large lorebook, where every proper noun
 * clears every ceiling and the only thing left to say is *enough*.
 *
 * The bound is a ceiling and never a target: the gates routinely return fewer,
 * and returning **none** is a correct answer for a passage with nothing
 * distinctive in it. Padding to five would be the defect this file exists to
 * avoid.
 */
export const MAX_KEYS = 5

/**
 * How many of those five may be bare words rather than names.
 *
 * ⚠ **A separate bound because the two kinds fail differently.** Two summaries
 * of two different scenes rarely name the same place; they very often reach for
 * the same ordinary noun, because summaries of one story share a vocabulary. So
 * the common-word key is the one that collides across the history lane, and a
 * cap on it is a cap on the failure mode this file is built against.
 *
 * Measured on the corpus world, against ten messages of ordinary narrative
 * English that name nothing from any scene — how many of twelve history entries
 * fire on prose alone:
 *
 *   · **0 terms** — 0 of 12 fire, but two entries get *no keys at all* and
 *     recall falls from 6/7 to 5/7
 *   · **1 term** — 1 of 12
 *   · **2 terms** — 1 of 12, one more cross-entry fire, recall back to 6/7
 *   · **3 terms** — 1 of 12, and rising cross-entry fires
 *
 * Two, then. Not zero, because a scene about *"the sealed writ"* names nothing
 * proper and an extractor that can only propose proper nouns has nothing to say
 * about it — in this world two of twelve summaries are exactly that, and at
 * zero they are unreachable. Not five, because past a couple what is left is the
 * passage's ordinary vocabulary, which is the lane's shared vocabulary.
 *
 * ⚠ One measured marginally better than two on cross-entry firing (4 against 5)
 * at identical recall, and two is still the choice: the extra fire is between
 * two entries about the same object, while the second slot doubles the reach of
 * the only two entries in the book that have no proper noun to be found by.
 */
export const MAX_TERM_KEYS = 2

/**
 * The shortest string allowed to be a key.
 *
 * Substring matching is what sets this: at three characters a key is inside
 * ordinary words in every language that writes them — "ash" in "cash", "art" in
 * "hearth", "one" in "money". `footprint` catches most of those on a book with
 * entries to count over, and this catches them on a book without.
 *
 * The same number as `MIN_TOKEN_KEY_LENGTH` in `entities.ts`, reached from a
 * different argument — that one bounds a *word-boundary* match and this one
 * bounds a substring, which is the looser rule and therefore the one that needs
 * the floor more. Deliberately not imported from there: sharing the constant
 * would tie two thresholds that answer different questions and would move for
 * different reasons.
 *
 * ⚠ **It is characters, so it is a Latin-script assumption showing.** Four
 * characters is a word in English and a whole phrase in Japanese. See the script
 * note on `proposeKeys` — this is not the binding limit there.
 */
export const MIN_KEY_LENGTH = 4

/**
 * The largest share of the *rest* of the lorebook a key may already fire on.
 *
 * ⚠ **A quarter, and it is the gate that does the most measurable work.** Past
 * that a key is not a key for this entry, it is a lane-wide trigger wearing one
 * entry's name — `watch`, in the corpus world, was a key of three separate
 * scenes and fired all three on any conversation that used the word.
 *
 * Measured on `measure/keyProposalWorld.ts` (30 entries, 12 of them history),
 * holding everything else at its shipped value:
 *
 *   · at **1.0** (the gate off) — 7 cross-entry fires across the probe set
 *   · at **0.5** — 7
 *   · at **0.25** — **5**, with recall unchanged
 *   · at **0.15** — 5, with recall unchanged
 *
 * So a quarter is where the curve flattens, and tightening past it buys nothing
 * while risking the recurring subjects that are the best keys a book has.
 *
 * ⚠ **A quarter was also tried on a thirteen-entry world and was measurably
 * wrong there** — it refused `writ`, `cistern`, `ashguard` and `pewterers`,
 * every recurring subject that world had, because two hits out of seven is 29%.
 * Both facts are true and they are the same fact: this gate is a *share*, so it
 * needs a book big enough for a share to mean something, and on a very small one
 * it is the entries that recur — the good keys — that a tight share refuses
 * first. Nothing here compensates for that, and the report says so.
 */
export const MAX_CORPUS_FRACTION = 0.25

/**
 * The least distinctive a **bare word** may be, as BM25 idf over the entry pool.
 *
 * ⚠ **`Math.LN2` is not a tuned number — it is exactly "in at most half the
 * corpus".** BM25's idf is `log((N − df + 0.5) / (df + 0.5) + 1)`, and at
 * `df = N/2` the fraction is exactly 1, so the logarithm is exactly `ln 2`. A
 * term in fewer than half the entries scores above it and a term in more scores
 * below, at every corpus size, with nothing calibrated.
 *
 * ⚠ **Measured inert wherever there is a corpus at all, and kept for the book
 * with none.** On the 30-entry corpus world, moving this from 0 to 1.8 changes
 * nothing — and it cannot, because `MAX_CORPUS_FRACTION` is the same statement
 * about a substring count at *half* the threshold, so anything this would refuse
 * that one already has. It is ordered after gate 2 for that reason: the stricter
 * gate should be the one that gets to say why. Recording the inertness rather
 * than leaving it looking live is the point of `measure/`: a guard nothing can
 * move is not a guard.
 *
 * What it *does* decide is the **cold start**. With an empty corpus every token
 * has `df = N = 1`, so `MAX_CORPUS_FRACTION` has no share to measure and idf is
 * 0.29 for every word in the passage — under `ln 2`, so every bare word is
 * refused and the first entry a lorebook ever gets is keyed on **what it names
 * and nothing else**. That is the right answer there, and it is the only place
 * this number is reachable, which is why it is a floor on terms alone: applied
 * to names as well it would refuse those too and the proposal would be empty.
 */
export const MIN_DISTINCTIVENESS = Math.LN2

/** What a candidate came from — see the `names first` note on `rank`. */
export type KeyKind = "name" | "term"

/** One proposed key, with everything a reviewer needs to judge it in place. */
export interface ProposedKey {
	/** The key, exactly as it would be stored and exactly as it will be matched. */
	key: string
	kind: KeyKind
	/** How many times the source says it. */
	occurrences: number
	/** Where it first occurs, as offsets into the source text. */
	span: { start: number; end: number }
	/**
	 * The source's own words around that first occurrence.
	 *
	 * The evidence half of the receipt: a reviewer judging *"is `writ` a good
	 * key for this scene"* needs the sentence it came out of, and hunting for it
	 * in a paragraph is the friction that makes a review gate get skipped.
	 */
	quote: string
	/** BM25 idf over the entry pool — how distinctive, and what ranked it. */
	distinctiveness: number
	/** How many *other* entries this key already matches. */
	corpusHits: number
	/** `corpusHits` as a share of the rest of the book; 0 when there is no rest. */
	corpusFraction: number
}

/** Why a candidate did not become a key. Never silently absent. */
export interface RejectedKey {
	candidate: string
	kind: KeyKind
	reason: string
}

export interface KeyProposal {
	proposerVersion: string
	keys: ProposedKey[]
	/**
	 * Everything considered and turned away, with the rule that turned it away.
	 *
	 * `keywordQuery.skipped`'s convention, for its reason: the first question
	 * anybody asks of a proposal is *"why is the obvious word not here"*, and a
	 * mechanism that cannot answer sends them to read the code.
	 */
	rejected: RejectedKey[]
	/** How many other entries the gates were measured against. */
	corpusSize: number
}

export interface KeyProposalInput {
	/**
	 * The text keys are proposed for.
	 *
	 * The **only** source. A title is not read even when the entry type has one,
	 * because "every key appears in the source text" is a property worth more
	 * than the handful of keys a title would add, and two sources would be two
	 * round trips to keep true.
	 */
	text: string
	/**
	 * The other entries of the lorebook, as documents — the collection
	 * distinctiveness is measured *in*.
	 *
	 * ⚠ **The collection is the argument**, exactly as `buildDocFreq`'s note
	 * says. Rarity over *messages* would make almost every word of a short
	 * session look rare; rarity over the entries being keyed is the textbook
	 * construction and the one that answers the question actually being asked —
	 * *would another entry want this key too*.
	 *
	 * Pass the whole lorebook rather than one lane. A key that collides with
	 * world lore is as much a collision as one that collides with another
	 * summary, and the pool `keywordQuery` scans is the whole book.
	 *
	 * Empty is a supported state and not a degraded one: gate 1 still refuses
	 * the cast, gate 4 refuses every bare word for want of corroboration, and
	 * what is left is the passage's proper nouns — which is the right answer for
	 * the first entry a lorebook ever gets.
	 */
	corpus?: readonly string[]
	/**
	 * The cast, as the gazetteer's first tier — gate 1's whole input.
	 *
	 * Build it with `bindingNames` at the call site so a character's aliases
	 * *and* her `absorbedAliases` are one identity; feeding half of that union is
	 * worse than feeding neither, and `entities.ts` says why.
	 *
	 * Optional, and the mechanism degrades honestly without it: gate 2 still
	 * refuses a name the book says everywhere, but a cast name in a book too
	 * small for gate 2 to count over would get through. That is measured, not
	 * assumed — `keyProposal.test.ts` runs the mutation.
	 */
	cast?: readonly GazetteerName[]
	/**
	 * Names the world has a row for — entry titles.
	 *
	 * Supplied *after* the cast, matching `keywordQuery`: `buildGazetteer` lets
	 * the first writer of a name keep it, so a character called "Vell" resolves
	 * to the character rather than to an entry titled after her, and is refused
	 * rather than proposed.
	 *
	 * Unlike the cast these are **eligible**. A thing the lorebook already has a
	 * row for is a subject, not a participant, and a subject is exactly what a
	 * scene is about.
	 */
	entryNames?: readonly GazetteerName[]
	/** Overrides for the bounds. Shipped values by default; see `KeyProposalOptions`. */
	options?: Partial<KeyProposalOptions>
}

/**
 * The bounds, as an argument rather than as constants only.
 *
 * ⚠ **Not a settings surface and not declared on the node.** They are here so
 * `measure/keyProposalCorpus.test.ts` can run the same world at several
 * settings and record what each one does to recall and to over-firing — which
 * is the evidence this mechanism was asked for, and which cannot be produced by
 * a function whose thresholds are unreachable. A control a user can move is a
 * calibration a user is being asked to perform, and nobody can perform this one
 * from a settings panel.
 */
export interface KeyProposalOptions {
	maxKeys: number
	maxTermKeys: number
	minKeyLength: number
	maxCorpusFraction: number
	minDistinctiveness: number
	/**
	 * The rejected gate 5, kept switchable. **On is the measurement**, and what
	 * it measures is a design that was wrong — see the header's §5.
	 */
	requireCorroboration: boolean
}

export const DEFAULT_KEY_PROPOSAL_OPTIONS: KeyProposalOptions = {
	maxKeys: MAX_KEYS,
	maxTermKeys: MAX_TERM_KEYS,
	minKeyLength: MIN_KEY_LENGTH,
	maxCorpusFraction: MAX_CORPUS_FRACTION,
	minDistinctiveness: MIN_DISTINCTIVENESS,
	requireCorroboration: false
}

/** Whitespace-collapsed and lowercased — the shape `entities.ts` normalises to. */
const normaliseKey = (text: string) =>
	text.toLowerCase().replace(/\s+/g, " ").trim()

/** A bare number is a quantity, not a subject — `extractEntities`' own rule. */
const NUMERIC = /^[\p{N}]+$/u

/**
 * Roughly a sentence around an offset, for the evidence quote.
 *
 * Characters and not a sentence splitter: the quote is read by a person deciding
 * whether a key belongs, a slightly ragged edge costs them nothing, and a second
 * definition of "where a sentence ends" would be one more thing to drift from
 * `SENTENCE_END`.
 */
const QUOTE_RADIUS = 60

function quoteAround(text: string, start: number, end: number): string {
	const from = Math.max(0, start - QUOTE_RADIUS)
	const to = Math.min(text.length, end + QUOTE_RADIUS)
	const slice = text.slice(from, to).replace(/\s+/g, " ").trim()
	return `${from > 0 ? "…" : ""}${slice}${to < text.length ? "…" : ""}`
}

/**
 * How many corpus documents this key would already match.
 *
 * ⚠ **Counted with the matcher's rule and not with a proxy for it.**
 * `matchIndexOf`'s default is `text.indexOf(key)` on lowercased text, so this is
 * `includes` on lowercased text — the same question the scan will ask, of the
 * same strings, at the moment somebody could still choose a different key.
 *
 * That is what makes it catch what a token statistic cannot see. "art" is a rare
 * *token* in a lorebook and a ubiquitous *substring* of one, so idf over
 * tokenised documents reports it as distinctive right up until it fires on every
 * entry containing "hearth", "part" or "started". A tokenised df cannot express
 * that; this can, because it is not a model of the matcher — it is the matcher.
 *
 * The subject's own text is deliberately **not** among the documents. The
 * question is *who else*, and counting the passage the key was drawn from would
 * put a guaranteed hit in every answer.
 */
export function footprint(key: string, corpus: readonly string[]): number {
	let hits = 0
	for (const document of corpus)
		if (document.toLowerCase().includes(key)) hits++
	return hits
}

/**
 * ⚠ **Does this key ride inside longer words?**
 *
 * The sharp form of the substring hazard, and the one `MIN_KEY_LENGTH` is only
 * a blunt guess at. Measured on the corpus world: `mark`, lifted from *"the
 * Pewterers' mark"*, fired a forge scene on a conversation that said
 * **Low**mark**et** — and every ceiling above it passed, because `mark` really
 * is in only a quarter of that book and really is a rare token in it. Neither
 * count can see the defect, because the defect is not *how many* documents the
 * key hits but *what it hits inside them*.
 *
 * So this asks the question directly, of the book itself: **is there anywhere
 * in this lorebook where the key occurs with a word character in front of it?**
 * If there is, the key is a fragment of some longer word this world uses, and it
 * will go on being one in the conversation.
 *
 * ⚠ **The left boundary only, and that asymmetry is the whole design.**
 * Requiring a boundary on *both* sides would throw away the one thing substring
 * matching is good at: `rider` firing on `riders`, `cistern` on `cisterns`.
 * Inflection appends; a fragment is embedded. Anchoring the left keeps the
 * first and refuses the second, which is precisely the line
 * `TRIGRAM_MIN_COVERAGE` draws for fuzzy matching, drawn here for exact.
 *
 * The character class is `matchesKey`'s own word-boundary class, not a new
 * opinion about what a word character is.
 */
const WORD_CHAR = /[\p{L}\p{N}_]/u

export function ridesInsideWords(
	key: string,
	documents: readonly string[]
): boolean {
	for (const document of documents) {
		const lower = document.toLowerCase()
		for (let at = lower.indexOf(key); at >= 0; at = lower.indexOf(key, at + 1))
			if (at > 0 && WORD_CHAR.test(lower[at - 1]!)) return true
	}
	return false
}

/**
 * Is this string a key the matcher could find again in its own source?
 *
 * ⚠ The one property the whole file rests on, checked against the real function
 * rather than restated. `normalise` collapses whitespace and a scan window does
 * not, so a two-word name the source wrote across a line break normalises to a
 * key `indexOf` will never find — in the source, and therefore in any window
 * either. Better refused here than stored as a key that silently never fires.
 *
 * The entry passed is `{}`: no `caseSensitive`, no `matchMode`, no `useRegex`,
 * which is exactly the row a machine writes — `entryInsert` stores `matchMode:
 * null` and `caseSensitive: false`. Check this against a different shape and the
 * round trip stops being about the row that will exist.
 */
export function roundTrip(key: string, text: string): boolean {
	return matchesKey(key, {}, buildScanWindow([{ content: text }], 1))
}

/**
 * ⚠ **Gate 1.** Does this key name somebody in the room?
 *
 * Two readings of the gazetteer because they cover different holes and each one
 * alone leaves the other open:
 *
 *   · `ref` is what the *matcher* resolved when the passage was extracted. It
 *     survives a surface form that is not itself a gazetteer key — "Ash-Guard"
 *     matches the name `ash guard` through `compileMatcher`'s `[\s\-]+` join,
 *     and normalising the match back would not produce that key.
 *   · The `byName` lookup catches a candidate that never went through
 *     extraction at all — every bare word of the passage is a candidate here,
 *     and "vell" arriving as a *term* rather than as a name would otherwise be
 *     judged by the corpus gates alone. Measured: on a small book it got
 *     through.
 *
 * `entry` is not refused. A thing the lorebook has a row for is a subject.
 */
function castRefusal(
	key: string,
	gazetteer: Gazetteer,
	ref: EntityRef | undefined
): boolean {
	const kind = ref?.kind ?? gazetteer.byName.get(key)?.kind
	return kind === "character" || kind === "persona"
}

interface Candidate {
	key: string
	kind: KeyKind
	occurrences: number
	span: { start: number; end: number }
	ref?: EntityRef
}

/**
 * Every proper noun the passage names, plus the distinctive word of each
 * multi-word one.
 *
 * `extractEntities` does the finding — the gazetteer tier for names the world
 * has a row for, the open tier for capitalised runs it does not — and this only
 * decides what may be proposed from it. Rebuilding any part of that extraction
 * would be a second answer to *"does this passage say Vell"*, which
 * `entities.ts`'s header rules against by name.
 *
 * ⚠ **The distinctive tokens matter more here than they do in the gazetteer.**
 * §13.9's finding is that *"The Ashguard Riders"* is what an author types and
 * *"the ashguard"* is what anybody writes in a scene — and a key is matched
 * against scenes, so a key of the whole phrase is a key the conversation will
 * mostly not produce.
 *
 * ⚠ **But only one token, and only when the corpus says which.** Offering every
 * distinctive token of a name was tried and was measurably wrong: *"Pewterers'
 * Guild"* and *"The Ashguard Riders"* yielded `guild` and `riders` beside
 * `pewterers` and `ashguard`, and the generic half of each name — the half every
 * other guild and every other company of riders also answers to — took a slot.
 *
 * So the name is narrowed to one word **only when that word is strictly more
 * distinctive than every other word of the name**, which is the corpus
 * answering *"which half of this name is the specific half"* rather than this
 * file guessing from word order. On a tie the whole name stands: unambiguous,
 * precise, and less likely to fire — which is the correct side to fail on when
 * the evidence is absent.
 */
function nameCandidates(
	entities: readonly Entity[],
	text: string,
	distinctivenessOf: (key: string) => number
): Candidate[] {
	const lower = text.toLowerCase()
	const out: Candidate[] = []
	for (const entity of entities) {
		const key = normaliseKey(entity.text)
		out.push({
			key,
			kind: "name",
			occurrences: entity.count,
			span: entity.spans[0] ?? { start: 0, end: key.length },
			ref: entity.ref
		})

		/**
		 * The one word of the name the rest of the book uses least — and only
		 * if it is alone at that. `distinctiveTokens` decides which words are
		 * even eligible (particles, function words and short words are already
		 * out); the corpus decides between the survivors.
		 */
		const tokens = distinctiveTokens(key)
		if (tokens.length < 2) continue
		let best = tokens[0]!
		let bestScore = distinctivenessOf(best)
		let tied = false
		for (const token of tokens.slice(1)) {
			const score = distinctivenessOf(token)
			if (score > bestScore) {
				best = token
				bestScore = score
				tied = false
			} else if (score === bestScore) tied = true
		}
		if (tied) continue
		const start = lower.indexOf(best)
		if (start < 0) continue
		out.push({
			key: best,
			kind: "name",
			occurrences: entity.count,
			span: { start, end: start + best.length },
			ref: entity.ref
		})
	}
	return out
}

/**
 * Every content word of the passage, as a fallback candidate.
 *
 * `tokenize` and not a second splitter — lowercase, split on non-word, drop
 * single characters — so a term candidate is spelled the way the idf that ranks
 * it counts, and the two cannot part company over what a word is.
 *
 * ⚠ These exist because a passage's subject is not always capitalised. A scene
 * about *"the sealed writ"* names nothing proper and would otherwise get no keys
 * at all. They are bounded by `maxTermKeys` and gated by corroboration for the
 * reasons those two carry.
 */
function termCandidates(text: string): Candidate[] {
	const lower = text.toLowerCase()
	const counts = new Map<string, number>()
	for (const token of tokenize(text))
		counts.set(token, (counts.get(token) ?? 0) + 1)

	const out: Candidate[] = []
	for (const [key, occurrences] of counts) {
		const start = Math.max(0, lower.indexOf(key))
		out.push({
			key,
			kind: "term",
			occurrences,
			span: { start, end: start + key.length }
		})
	}
	return out
}

type Scored = Candidate & { distinctiveness: number; hits: number }

/**
 * The candidate order: names before terms, then by distinctiveness, then by the
 * key the conversation is likelier to write.
 *
 * ⚠ **Lexicographic and not a weighted blend**, because a blend would need a
 * bonus and a bonus is a calibration presented as a fact. The claim being made
 * is categorical and is falsifiable as stated: *a proper noun is a referent a
 * later scene will name again, and a rare common word is usually a stylistic
 * choice that will not recur.*
 *
 * The length tiebreak is §13.9 again, and after `nameCandidates` narrowed its
 * rule it fires almost only where it was written to: between a name and the one
 * word of itself the corpus picked out, which necessarily tie — a phrase's
 * distinctiveness *is* its best word's. The shorter has by then cleared every
 * ceiling the longer did and is the one a scene will actually write. Position
 * breaks what is left, so two runs over one passage cannot disagree about its
 * keys; a review gate over a non-deterministic proposal would be impossible to
 * trust.
 */
function rank(a: Scored, b: Scored): number {
	if (a.kind !== b.kind) return a.kind === "name" ? -1 : 1
	return (
		b.distinctiveness - a.distinctiveness ||
		b.occurrences - a.occurrences ||
		a.key.length - b.key.length ||
		a.span.start - b.span.start
	)
}

/**
 * ⚠ **No accepted key may contain another, in either direction.**
 *
 * Under substring matching a longer key can only fire where its substring
 * already fired, so `ashguard riders` beside `ashguard` is two of five slots
 * spent on one firing opportunity. The other direction is refused too: adding
 * the broader `ashguard` after the narrower phrase widens the entry's door
 * without a reviewer having asked for it, and the narrower key is the one that
 * ranked.
 *
 * First accepted wins, so which of the two survives is decided by `rank` — where
 * the length tiebreak has already preferred the form a scene will write.
 */
const subsumedBy = (key: string, accepted: readonly string[]): string | null => {
	for (const other of accepted)
		if (key.includes(other) || other.includes(key)) return other
	return null
}

/**
 * Keys for one passage, ranked, bounded, and each one matchable in its source.
 *
 * ## Script coverage, stated plainly rather than discovered later
 *
 * ⚠ **This produces little or nothing for an unsegmented script.** `tokenize`
 * splits on `\W+`, which is ASCII, so a Japanese or Chinese passage yields no
 * term candidates at all; and the open tier of `extractEntities` keys on
 * `\p{Lu}`, which those scripts do not have, so it yields no proper nouns
 * either. What is left is the gazetteer tier — names the world already has a row
 * for — and gate 1 refuses the cast among those. A CJK summary will therefore
 * usually come back with **no keys**, which is the honest outcome and not a
 * silent one: `keys` is empty and `rejected` says what little was considered, so
 * a reviewer sees a proposal that found nothing rather than one that invented
 * something.
 *
 * ⚠ **And the gazetteer tier does not rescue it either** — measured, in
 * `keyProposal.test.ts`. `compileMatcher` wraps every name in
 * `(?<![\p{L}\p{N}_])…(?![\p{L}\p{N}_])`, and in a script with no spaces the
 * character after a name is another letter: 灰の衛兵 followed by は fails the
 * lookahead, so even a name the world has a row for is not found. The boundary
 * assertions are right for the scripts that write boundaries and there is no
 * boundary to assert here. So the answer for an unsegmented script is **nothing
 * at all**, and this note is the whole of what this file can honestly claim
 * about it.
 *
 * The mechanism that does work in every script is trigram folding
 * (`trigramsOf`), and it belongs to *matching*, not to proposing. Closing this
 * properly is the same gap `entities.ts` names at the end of its extraction
 * note: a real NER model.
 */
export function proposeKeys(input: KeyProposalInput): KeyProposal {
	const options = { ...DEFAULT_KEY_PROPOSAL_OPTIONS, ...(input.options ?? {}) }
	const text = input.text ?? ""
	const rejected: RejectedKey[] = []
	const reject = (candidate: string, kind: KeyKind, reason: string) =>
		rejected.push({ candidate, kind, reason })

	/** The rest of the book — what gates 2, 4 and the rejected 5 count over. */
	const others = input.corpus ?? []

	if (!text.trim())
		return {
			proposerVersion: KEY_PROPOSER_VERSION,
			keys: [],
			rejected,
			corpusSize: others.length
		}

	const gazetteer =
		(input.cast?.length ?? 0) + (input.entryNames?.length ?? 0) > 0
			? buildGazetteer([...(input.cast ?? []), ...(input.entryNames ?? [])])
			: EMPTY_GAZETTEER

	/**
	 * The idf collection: the rest of the book **plus the subject**.
	 *
	 * The subject is a member of the collection it is being measured in — the
	 * standard construction — and including it removes a special case rather than
	 * adding one. Every candidate is drawn from the subject, so with it counted
	 * every candidate has `df ≥ 1` and no term ever needs an invented idf for a
	 * document frequency of zero, which would be a number this file made up
	 * sitting in the middle of a statistic it borrowed.
	 *
	 * ⚠ Not the same collection `footprint` counts over, and the difference is
	 * the question each one asks: this one asks *how rare is this term here*,
	 * where the subject is one of the documents; that one asks *who else would
	 * this key fire on*, where the subject is not part of the answer.
	 */
	const idf = buildBm25Idf([...others, text])

	/**
	 * A key's distinctiveness — its own idf for a word, the largest of its
	 * words' for a phrase.
	 *
	 * ⚠ **`max` is a lower bound and is the conservative side.** A phrase occurs
	 * in no more documents than its rarest word does, so its true idf is at least
	 * the largest of theirs; taking that understates a phrase's distinctiveness
	 * and can only ever drop a key that deserved to stay. The other reading,
	 * `min`, would overstate it and let `silver hand` in on the strength of
	 * `hand` — the direction that costs a user a spurious trigger.
	 */
	const distinctivenessOf = (key: string): number => {
		let best = 0
		for (const token of tokenize(key))
			best = Math.max(best, idf.get(token) ?? 0)
		return best
	}

	const entities = extractEntities(text, gazetteer).entities
	const candidates = [
		...nameCandidates(entities, text, distinctivenessOf),
		...termCandidates(text)
	]

	/**
	 * Deduplicate before any gate runs.
	 *
	 * ⚠ Names first in the array and therefore first here, which is what makes a
	 * word the passage capitalises get judged as a name: it carries the real
	 * occurrence count, the real span and the gazetteer's resolution, and the
	 * bare-word copy of it carries none of those. Reversing the order would send
	 * every proper noun through the *term* gates — including gate 3, which
	 * proper nouns are exempt from — and on a book with no corpus to measure
	 * against the extractor would propose nothing at all.
	 */
	const seen = new Set<string>()
	const unique: Candidate[] = []
	for (const candidate of candidates) {
		if (seen.has(candidate.key)) continue
		seen.add(candidate.key)
		unique.push(candidate)
	}

	const eligible: Scored[] = []
	for (const candidate of unique) {
		const { key, kind, ref } = candidate
		if (key.length < options.minKeyLength) {
			reject(key, kind, `shorter than ${options.minKeyLength} characters`)
			continue
		}
		if (NUMERIC.test(key)) {
			reject(key, kind, "a bare number is a quantity, not a subject")
			continue
		}
		/**
		 * The stoplist, reused rather than restated — `SENTENCE_OPENERS` is
		 * already the answer to *"is this word function rather than content"* for
		 * three other readers in this directory, and a fourth list would be a
		 * fourth thing to drift. Only single-word candidates are asked: "order of
		 * the ashguard" is content, whatever `of` and `the` are on their own.
		 */
		if (!key.includes(" ") && SENTENCE_OPENERS.has(key)) {
			reject(key, kind, "a function word, not a subject")
			continue
		}
		// Gate 1.
		if (castRefusal(key, gazetteer, ref)) {
			reject(key, kind, "names a character in the cast")
			continue
		}
		if (!roundTrip(key, text)) {
			reject(
				key,
				kind,
				"the matcher could not find it in the source text as written"
			)
			continue
		}
		if (ridesInsideWords(key, [text, ...others])) {
			reject(
				key,
				kind,
				"it sits inside longer words this lorebook already uses"
			)
			continue
		}
		/**
		 * Gate 2, and it runs **before** gate 3 deliberately.
		 *
		 * Wherever there is a corpus at all, this is the stricter of the two —
		 * a quarter against a half — so it would reject everything gate 3 would
		 * anyway, and running it first is what makes the *reason* the accurate
		 * one. "Already matches 3 of 4 other entries" sends a reviewer somewhere;
		 * "in too much of the lorebook (0.29)" is the same verdict expressed as
		 * a number nobody can act on.
		 *
		 * `others.length` of 0 has no share to exceed — and nothing to collide
		 * with either, which is the same fact said twice. That is the case gate 3
		 * exists for.
		 */
		const hits = footprint(key, others)
		if (others.length > 0 && hits / others.length > options.maxCorpusFraction) {
			reject(key, kind, `already matches ${hits} of ${others.length} other entries`)
			continue
		}
		// Gate 3 — bare words only. A proper noun is a referent whether or not a
		// statistic can see it, and on an empty corpus no statistic can.
		const distinctiveness = distinctivenessOf(key)
		if (kind === "term" && distinctiveness < options.minDistinctiveness) {
			reject(
				key,
				kind,
				`in too much of the lorebook to distinguish this entry (${distinctiveness.toFixed(2)})`
			)
			continue
		}
		// The rejected gate 5. Off by default; see the header.
		if (options.requireCorroboration && kind === "term" && hits === 0) {
			reject(
				key,
				kind,
				"an ordinary word this passage uses and the rest of the lorebook never does"
			)
			continue
		}
		eligible.push({ ...candidate, distinctiveness, hits })
	}

	eligible.sort(rank)

	const keys: ProposedKey[] = []
	const accepted: string[] = []
	let terms = 0
	for (const candidate of eligible) {
		if (keys.length >= options.maxKeys) {
			reject(candidate.key, candidate.kind, `beyond the ${options.maxKeys}-key limit`)
			continue
		}
		if (candidate.kind === "term" && terms >= options.maxTermKeys) {
			reject(
				candidate.key,
				candidate.kind,
				`beyond the ${options.maxTermKeys} ordinary words one entry may be keyed on`
			)
			continue
		}
		const subsumed = subsumedBy(candidate.key, accepted)
		if (subsumed) {
			reject(
				candidate.key,
				candidate.kind,
				`can only fire where "${subsumed}" already does`
			)
			continue
		}
		accepted.push(candidate.key)
		if (candidate.kind === "term") terms++
		keys.push({
			key: candidate.key,
			kind: candidate.kind,
			occurrences: candidate.occurrences,
			span: candidate.span,
			quote: quoteAround(text, candidate.span.start, candidate.span.end),
			distinctiveness: candidate.distinctiveness,
			corpusHits: candidate.hits,
			corpusFraction: others.length ? candidate.hits / others.length : 0
		})
	}

	return {
		proposerVersion: KEY_PROPOSER_VERSION,
		keys,
		rejected,
		corpusSize: others.length
	}
}
