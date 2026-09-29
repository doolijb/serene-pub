/**
 * Every constant in the retrieval path, as a parameter.
 *
 * These are the literals scattered through the 0.5 keyword path and
 * its base, lifted into one declaration so they can be config
 * on a node instead of numbers in a file. **Every default here reproduces
 * current behaviour**, with the line it came from named — so the parity corpus
 * passes unchanged and any deviation is somebody's deliberate choice rather
 * than a refactor's accident.
 *
 * They divide into three mechanically different kinds, and keeping them apart
 * is what makes a tuning interface predictable (see docs-dev/DECOMPOSITION.md
 * §4a):
 *
 *   (i)   **signal weights** — how one candidate's score is built. Comparable
 *         within a source, meaningless across sources.
 *   (ii)  **retrieval parameters** — how far to look, how much to guarantee.
 *   (iii) **group importance** — share of the token budget per source. NOT a
 *         score multiplier; see `GroupWeights` for why that distinction is the
 *         whole design.
 */

import {
	isBandPriority,
	type BandIntent,
	type BandPriority
} from "@serene-pub/sdk"

/**
 * A **band**: what kind of content a candidate is, and whose budget share pays
 * for it. The five things the context is built from; a slider exists per entry
 * here.
 *
 * ⚠ **Not the vector index's `source`.** That vocabulary is the index's own —
 * `message`, `historyEntry`, `narrativeNode` — and is reconciled to these five
 * at the ranker's in-port (`BUDGET_GROUP_ALIASES`), never merged with them.
 * Merging the two is what silently dropped six of eight sources at ranking.
 *
 * ⚠ **Nor the SDK's `Band`**, which is a connection's capability grade. The
 * name is qualified here for that reason; see NOMENCLATURE §7 and §10.
 */
export type RetrievalBand =
	| "messages"
	| "worldLore"
	| "characterLore"
	| "history"
	| "relationships"

/**
 * A band's key at runtime: one of the five, or whatever a plugin source
 * declares (R-7 P5). The five stay a closed type where the code needs one
 * complete row per core band — the signal matrix — and a plugin band is a
 * string beside them, read through `bandsFromIntents` and scored with
 * `signalsForBand`.
 */
export type BandKey = RetrievalBand | (string & {})

/**
 * The index's spelling for a source, as the budget group that pays for it.
 *
 * `select` allocates against the five bands; the vector mechanism's
 * candidates carry the vector index's own vocabulary, and only `worldLore` and
 * `characterLore` happen to be spelled the same in both. Without this, a
 * semantic-mechanism spec — `vector-search → rank-semantic → rank-hybrid`, the shape
 * the RAG parity harness and the SDK use-cases document — reached the ranker
 * with every message, history entry and relationship in a spelling no group
 * owned, and `select` dropped the lot as `excluded_unknown_source`. Assemble
 * keys its `worldLore` / `history` / `characterLore` sections off the same five
 * names, so a survivor would have rendered nowhere either.
 *
 * ⚠ Applied at the entry to `rank-hybrid` and nowhere earlier — to the
 * candidates by `toBudgetGroups` in `bindings.ts`, to the band intents ahead
 * of them by `bandsFromIntents` below. `rank-semantic` matches
 * `sourceBudget` keys against the *index* vocabulary literally
 * (`DEFAULT_SEMANTIC`), a `S.json` in-port makes it legal to wire after
 * `core:task/merge-candidates@1`, and the documented semantic chain has no
 * merge node at all — so the merge is neither early enough nor reliably
 * present. Ranking is the last node before the budget, and the first that has
 * to know about it.
 *
 * ⚠ Deliberately three entries, not six. `narrativeNode`, `character` and
 * `persona` have no band to map onto — inventing one is a budget-share
 * decision, not a spelling fix — so they keep being excluded, now visibly, with
 * a reason on the receipt. The original spelling survives on the candidate's
 * `payload`, which is the vector hit as it arrived.
 *
 * Separate from `VECTOR_SOURCE_ALIASES` (`bindings.ts`) although they agree
 * on `historyEntry` today. That one answers "which lore row is this hit", and
 * is read against a `lorebook_entries` result and `LORE_SOURCES`; this one
 * answers "which budget pays for it". Folding them together would mean the three sources above join
 * the lore-row lookup the moment somebody settles their budget group, which is
 * an unrelated question with a different right answer.
 */
export const BUDGET_GROUP_ALIASES: Record<string, string> = {
	message: "messages",
	historyEntry: "history",
	narrativeRelationship: "relationships"
}

// ── (i) Signal weights ──────────────────────────────────────────────────────

/**
 * How a single candidate's score is assembled, per source.
 *
 * A missing signal is `0` rather than absent, so every source has the same
 * shape and a UI can render one control set. Today's engine hardcodes which
 * signals apply to which source; expressing "does not apply" as a zero weight
 * means a user can turn on `nameMatch` for messages if they want it, and the
 * scorer needs no new branch.
 */
export interface SignalWeights {
	keyword: number
	nameMatch: number
	/**
	 * Two questions under one name, split by source (bug 16), and the split is
	 * deliberate rather than a leftover — see `scoreSignals`.
	 *
	 * ⚠ **The world-lore half changed measure and this weight moved with it.**
	 * It used to be `entityCooccurrenceSignal` — a binary substring test asking
	 * whether the entry's own title or keys contain a cast name, so `Al` fired
	 * on `Alchemy` and one shared entity scored the same as twelve. It is now
	 * the rarity-weighted, word-boundary, two-sided overlap `evidence()`
	 * computes for admission: what the conversation named, intersected with
	 * what this entry names, discounted by how many entries name the same thing.
	 *
	 * That measure saturates — ~0.63 for one rare shared entity, ~0.86 for two
	 * (design §13.10) — so inherited at the old 0.2 its live range would have
	 * been about [0.13, 0.17], **narrower** than the crude `{0, 0.2}` it
	 * replaces. Grading without re-weighting makes a signal more correct and
	 * less influential at once, so world lore's weight is sized for the measure
	 * that runs: 0.35, the anchor `entity-search`'s own strength uses.
	 *
	 * Character lore stays at 0.2 because its measurement did not change: it
	 * still asks whether the entry's bound character spoke in the guaranteed
	 * window, which is a fact about the scene rather than about the entry.
	 */
	entityCooccurrence: number
	tfidf: number
	lastRefRecency: number
	/**
	 * ⚠ **`recency` and `sceneAffinity` were here and are gone.**
	 *
	 * Neither had a producer — no mechanism has ever written `signals.recency`
	 * or `signals.sceneAffinity` — so both weights multiplied a permanent zero
	 * while `score()` read them, `DEFAULT_SIGNAL_WEIGHTS` gave them non-zero
	 * numbers on two bands, and `core:task/rank-hybrid@1` declared, validated
	 * and stored them. The contracts file carries the argument for removing
	 * rather than building producers; the short version is that each needs a
	 * design decision (which date orders a dated entry; what scene a session is
	 * *in*) that a wiring change is not entitled to make.
	 *
	 * Removing the two terms from `score()` is bit-for-bit inert: `w * 0` is an
	 * exact positive zero and `x + 0` is exact in IEEE-754, so every score the
	 * app has produced is unchanged to the last bit.
	 */
	/**
	 * How long this entry is against the pool's average, capped at 1.
	 *
	 * ⚠ **It had no producer either, and now it has one.** `densitySignal` sat
	 * in `signals.ts` with no caller for exactly as long as this weight sat
	 * here with nothing to weigh. The scan writes it on every candidate now,
	 * for `proximity`'s reason: the number costs nothing (the lengths are
	 * already measured) and a signal nobody can see the value of is a signal
	 * nobody can decide to weight.
	 *
	 * **0 in every lore band**, so wiring the producer changes no score. Length
	 * is a proxy for how much an entry has to say, and it is a *good* proxy in
	 * a book that mixes one-line stubs with real articles and a poor one in a
	 * book of even entries — which is why it is a slider and not a policy.
	 */
	density: number
	/**
	 * How much an embedding thinks this entry is *about* what is being said.
	 *
	 * The fourth mechanism, and the only one that needs a model. Produced by
	 * `core:query/vector-search@1` as a **score component** rather than as an
	 * ordering: the mechanism attaches a cosine and stamps no `presetScore`, so an
	 * entry two mechanisms found keeps the keyword mechanism's signals and gains this one
	 * and the two compound by addition. Fusing them would be the mistake
	 * `core:task/concat-candidates@1` exists to avoid.
	 *
	 * Non-zero in the shipped lore bands, unlike `proximity` — because the
	 * *mechanism* ships off (`vector-search.maxEntries` is 0) and nothing carries the
	 * signal until somebody turns it on. Zeroing both would make raising the cap
	 * do nothing, which is the trap every two-switch feature sets.
	 */
	semantic: number
	/**
	 * How well a description the scene used matches one of this entry's names.
	 *
	 * The fifth mechanism's weight, produced by `core:query/entity-link@1`:
	 * *"the captain"* → *Captain Vell*, *"the order"* → *The Ashguard Riders*.
	 * Neither reference shares a character with its target, so keys, trigrams
	 * and the gazetteer all miss them — and they are the references people
	 * actually write.
	 *
	 * ⚠ **Sized to sit strictly below `nameMatch`, and that is a rule rather
	 * than a preference.** Invented proper nouns are where embeddings are least
	 * reliable — "Vell" has no learned meaning, so its vector is assembled from
	 * subword fragments and Vell, Vall and Vela cluster — so *exact and trigram
	 * matching own invented names; entity vectors own descriptive references*,
	 * and a vector link must never outrank an entry whose title literally
	 * occurred. `nameMatch` is 0.25 and a link's similarity cannot exceed 1, so
	 * 0.2 keeps that true at every value the mechanism can produce.
	 *
	 * Non-zero in the shipped lore bands for `semantic`'s reason: the *mechanism*
	 * ships off (`entity-link.maxLinks` is 0), and a feature whose cap and whose
	 * weight both ship at zero is one where raising the cap appears to do
	 * nothing. One switch, not two.
	 */
	entityVector: number
	/**
	 * How tightly an entry's matched keys clustered in the window.
	 *
	 * Two keys matching adjacent is stronger evidence than the same two
	 * matching twenty words apart — "the Ashguard rode" is about the Ashguard
	 * riding, and the same two words either side of a paragraph break are two
	 * unrelated sentences. `keywordSignal` cannot tell them apart: it counts
	 * *how many* keys matched and never *where*.
	 *
	 * **0 in every shipped set**, which is what makes the signal inert until
	 * somebody weights it — the `admitThreshold` convention, applied to a
	 * signal rather than to a threshold. The number itself is computed
	 * unconditionally, because it comes out of the key walk that was happening
	 * anyway and a signal nothing can see the value of is a signal nobody can
	 * decide to weight.
	 */
	proximity: number
	/** Added per step of the entry's `priority` field, lore only today. */
	priorityBonus: number
}

/**
 * How much one step of an entry's `priority` field is worth.
 *
 * Canonical **here**, in the surviving half, rather than in
 * the 0.5 keyword path where it started. It was defined there and *also*
 * hardcoded as a literal `0.15` in `LORE_SIGNALS` below — one number with two
 * definitions, so the keyword mechanism and the semantic mechanism could drift apart while
 * both looked deliberate. The legacy engines now import it from here, which is
 * the direction that leaves nothing to move when they are deleted.
 *
 * Applied per tier rather than as a discrete override, so priority shifts a
 * score without overruling the rest of the model.
 */
export const PRIORITY_SCORE_BONUS = 0.15

const NO_SIGNALS: SignalWeights = {
	keyword: 0,
	nameMatch: 0,
	entityCooccurrence: 0,
	tfidf: 0,
	lastRefRecency: 0,
	density: 0,
	proximity: 0,
	semantic: 0,
	entityVector: 0,
	priorityBonus: 0
}

/**
 * From the 0.5 keyword path (world lore and character lore).
 *
 * ⚠ **No longer one set for both**, and the reason is `entityCooccurrence`:
 * that weight is now sized for the measure its source runs, and the two sources
 * run different measures (bug 16). Everything else is still shared.
 */
const LORE_SIGNALS: SignalWeights = {
	...NO_SIGNALS,
	keyword: 0.35,
	nameMatch: 0.25,
	entityCooccurrence: 0.2,
	tfidf: 0.1,
	lastRefRecency: 0.1,
	semantic: 0.3,
	entityVector: 0.2,
	priorityBonus: PRIORITY_SCORE_BONUS
}

export const DEFAULT_SIGNAL_WEIGHTS: Record<RetrievalBand, SignalWeights> = {
	/**
	 * 0.35 on `entityCooccurrence`, not 0.2 — the graded overlap's live range
	 * would otherwise be narrower than the binary signal it replaces. The
	 * argument is on `SignalWeights.entityCooccurrence`; the measurement is in
	 * `scoreSignals`.
	 */
	worldLore: { ...LORE_SIGNALS, entityCooccurrence: 0.35 },
	/** 0.2, unchanged: character lore's question is presence, and it did not move. */
	characterLore: LORE_SIGNALS,
	/**
	 * `:1239`. Note history carries no `priorityBonus` today.
	 *
	 * ⚠ It carried `recency: 0.2` and `sceneAffinity: 0.1` as well, and those
	 * are the two numbers that made the dead weights look alive: unlike the
	 * `messages` band they sat on a source the shipped pipeline really does
	 * populate. Nothing ever produced either signal, so they weighed a zero on
	 * every turn of every install. See `SignalWeights`.
	 */
	history: {
		...NO_SIGNALS,
		keyword: 0.35,
		tfidf: 0.1,
		lastRefRecency: 0.1,
		semantic: 0.3,
		entityVector: 0.2
	},
	/**
	 * `:1277`.
	 *
	 * ⚠ **Not populated on any shipped path**, which is what let three weights
	 * hide here: the entity mechanism's `messages` out-port is deliberately
	 * unwired (see `respond`), so nothing ranked a message and nothing noticed
	 * that two of these three had no producer at all. `density` is produced now
	 * and is left at 0.1 here rather than tidied — no mechanism writes it on a
	 * *message* candidate either way, so the number cannot change an outcome
	 * and moving it would be a re-tune with no reason attached.
	 */
	messages: {
		...NO_SIGNALS,
		tfidf: 0.1,
		density: 0.1
	},
	/**
	 * Relationship data has no keyword scorer today — it arrives already
	 * selected from the narrative graph, and is currently disabled by a feature
	 * flag. Zeroed rather than omitted so the source exists in every control
	 * that iterates sources.
	 */
	relationships: NO_SIGNALS
}

// ── (ii) Retrieval parameters ───────────────────────────────────────────────

export type MatchMode = "substring" | "word" | "regex"

/** How the entry side of the vocabulary overlap is read. See `lexicalScoring`. */
export type LexicalScoring = "overlap" | "balanced"

export const LEXICAL_SCORING: readonly LexicalScoring[] = [
	"overlap",
	"balanced"
]

export const isLexicalScoring = (v: unknown): v is LexicalScoring =>
	typeof v === "string" && (LEXICAL_SCORING as readonly string[]).includes(v)

export interface RetrievalParams {
	/**
	 * How many recent messages the keyword scan reads.
	 *
	 * Hardcoded at 10 today and **sharing one constant with
	 * `guaranteedMessages`** (the 0.5 retrieval base), which is two different
	 * questions answered by one number: how far back do we look for triggers,
	 * versus how much recent conversation survives budgeting. A session of long
	 * posts wants a deep scan and a short guarantee; a terse one wants the
	 * reverse. Splitting them is behaviour-preserving while both default to 10.
	 */
	scanDepth: number
	/** Messages never dropped by budgeting. From the 0.5 retrieval base. */
	guaranteedMessages: number
	/** Fraction of `tokenLimit` the whole context may occupy. */
	contextThresholdPercent: number
	/**
	 * How a lorebook key is matched.
	 *
	 * `substring` is today's behaviour and the default — `art` fires on
	 * "hearth", `elf` on "self". `word` is the fix most users want once they
	 * have been bitten; `regex` is today's `useRegex` boolean, folded in so
	 * there is one field rather than a boolean plus an implicit third mode.
	 */
	matchMode: MatchMode
	/**
	 * How many further passes an entry's own content may trigger.
	 *
	 * Zero is the shipped default and is what every release before this one
	 * did: keys are matched against the conversation, once. A lorebook that
	 * describes a place, and separately the person who runs it, has no way at
	 * one pass to bring the second in when only the first was named — which is
	 * the whole reason recursion exists.
	 *
	 * A ceiling, not an instruction. Entries carry their own `recursionDepth`
	 * saying how deep *they* may still be reached, and this caps all of them,
	 * because the cost of a pass belongs to whoever is paying for the turn and
	 * not to whoever wrote the lorebook.
	 */
	maxRecursionDepth: number
	/**
	 * How much non-key evidence admits an entry no keyword matched.
	 *
	 * The scan's admission rule was `pinned || keyword > 0 || nameMatch > 0`,
	 * and every other signal is computed *before* it — so tf-idf and entity
	 * co-occurrence could only reorder what the author's keys had already let
	 * in. That one condition is what forces a lorebook to be hand-indexed:
	 * "the Riders", "them" and "the order" are all the Ashguard, and only the
	 * author writing each of them down makes the entry fire. The rule is now
	 *
	 *     pinned ∨ keyword > 0 ∨ nameMatch > 0 ∨ evidence ≥ admitThreshold
	 *
	 * with `evidence` from `ranking/entities.ts` — proper nouns and rarity-
	 * weighted vocabulary, no embedding model involved.
	 *
	 * **0 is off**, the same convention `maxRecursionDepth` uses, and it is the
	 * shipped default: this changes what reaches the model, so it is turned on
	 * rather than arrived at. Reading 0 as "every score clears zero, so admit
	 * everything" is the one meaning it cannot have.
	 */
	admitThreshold: number
	/**
	 * How strongly each kind of evidence counts — 1 is full, 0 switches that
	 * kind off.
	 *
	 * Strengths rather than shares, because `evidence()` combines them as a
	 * noisy-or rather than a sum: with a sum, whichever term got the smaller
	 * share could never admit anything by itself, and the design lists tf-idf
	 * as an admitting source rather than a tie-breaker. See the note there.
	 *
	 * A parameter rather than a literal for the reason everything else in this
	 * file is one — but deliberately **not** declared on the node. The panel
	 * gets one control, `admitThreshold`, because the question somebody has is
	 * "how readily should this bring things in", and a weight per evidence term
	 * asks them to calibrate a scale before they can answer it.
	 */
	admitWeights: { entity: number; vocabulary: number }
	/**
	 * How the vocabulary overlap is read, on both sides.
	 *
	 * `overlap` is today: a term's weight is added once per occurrence in the
	 * entry, so a repeated word counts linearly and a long entry accumulates
	 * more of them. Lorebook entries vary wildly in length, which is the case
	 * that reading handles worst — twelve near-identical entries end up ordered
	 * by how many times each happened to repeat itself.
	 *
	 * `balanced` is BM25 over the same inputs: term saturation and length
	 * normalisation on the document side, so a long entry stops winning for
	 * being long and a repeated term stops counting linearly — and the **same
	 * saturation on the conversation side**, so a word the session cannot stop
	 * saying stops multiplying whatever it lands on. That last half is Okapi's
	 * `k3` term and it is not optional here: `balanced` also takes its rarity
	 * over the entry pool rather than over the messages, which leaves a
	 * stopword genuinely rare in a pool of short `keys + title` documents. See
	 * `lexicalSignal`.
	 *
	 * `overlap` is the shipped default, on the `admitThreshold` convention:
	 * this changes the *order* lore reaches the model in, so it is turned on
	 * rather than arrived at on upgrade.
	 */
	lexicalScoring: LexicalScoring
	/**
	 * How much a fuzzy, character-trigram hit on a key is worth, 0 being off.
	 *
	 * Word-boundary matching is not merely imprecise for unsegmented scripts —
	 * Japanese, Chinese and Thai have no spaces for "whole word" to mean
	 * anything against — so trigrams are not a nicety there, they are the only
	 * thing that works. Everywhere else they absorb inflection and typos:
	 * `riders` fires a key written `rider`, `Ashgaurd` fires `Ashguard`.
	 *
	 * A strength rather than a boolean, because a fuzzy hit is genuinely weaker
	 * evidence than an exact one and the useful question is *how much weaker*.
	 * An exact match always counts 1 whatever this is, so raising it can only
	 * add matches — the plan's second governing rule, in one line of
	 * arithmetic.
	 *
	 * **0 is off and is the shipped default.** Trigrams are the universal path
	 * by design, but switching them on changes which entries reach the model,
	 * and that is a thing somebody turns on rather than a thing that happens to
	 * them.
	 */
	trigramFolding: number
	/**
	 * How much a term in an entry's title counts against the same term among
	 * its keys.
	 *
	 * **1 is neutral, not off**, and the difference matters: the two fields are
	 * concatenated into one bag today, so 1 is arithmetically what already
	 * happens rather than a feature switched off. Above 1 a match in the title
	 * outranks the same word buried in the keys, which is the ordinary case for
	 * an entry *about* the thing being discussed against one that merely lists
	 * it.
	 *
	 * ⚠ The other field is the **keys**, not the content. The scored text is
	 * the author's index (`keys + name`) and widening it to the body would
	 * change the ordering of every keyed book in the app — deliberately out of
	 * scope, and noted where the admission gate reads a wider text for its own
	 * reasons (`keywordQuery.entryText`).
	 */
	titleWeight: number
}

export const DEFAULT_RETRIEVAL: RetrievalParams = {
	scanDepth: 10,
	guaranteedMessages: 10,
	contextThresholdPercent: 0.8,
	matchMode: "substring",
	maxRecursionDepth: 0,
	admitThreshold: 0,
	lexicalScoring: "overlap",
	trigramFolding: 0,
	titleWeight: 1,
	// Both at full strength. Neither is picked as more trustworthy than the
	// other by default — they answer different questions and the noisy-or lets
	// each one answer on its own. Turning one down is how an install says
	// "names only" or "words only", which is a real thing to want and not a
	// calibration nobody can perform.
	admitWeights: { entity: 1, vocabulary: 1 }
}

// ── (ii-b) Semantic retrieval ───────────────────────────────────────────────

/**
 * The nine numbers the RAG mechanism runs on, every one of them a constant today.
 *
 * The 0.5 RAG path carried these as module-level `const`s, and one of them
 * already has a `TODO: make configurable in a future pass` next to it. They are
 * exposed here for the same reason every other constant was: a user whose session
 * has long posts and a user whose session is terse want different windows, and
 * neither can express that today.
 *
 * Provenance is on each field. The defaults are the current values exactly, so
 * turning them into parameters changes nothing until somebody moves one.
 */
export interface SemanticParams {
	/** Most recent messages used as the primary query. From the 0.5 RAG path. */
	currentWindow: number
	/**
	 * Next-most-recent messages used as a second query, filling what the first
	 * left. From the 0.5 RAG path.
	 */
	recentWindow: number
	/**
	 * Rank-fusion constant. 60 is the value from the original RRF paper and the
	 * value both mechanisms already use — named here rather than repeated, because two
	 * fusions with different k silently rank differently.
	 */
	rrfK: number
	/** How much a recent message's score is lifted. From the 0.5 RAG path. */
	recencyBoost: number
	/** How fast that lift decays with age. From the 0.5 RAG path. */
	recencyDecay: number
	/**
	 * Threshold for the adaptive score cutoff, and the fraction of the top score
	 * it must also clear. From the 0.5 RAG path.
	 *
	 * Two numbers rather than one because they answer different questions: the
	 * threshold rejects a session where *nothing* is relevant, the relative one
	 * rejects the long tail of a session where something is.
	 */
	thresholdMin: number
	relativeThreshold: number
	/**
	 * Relevance-versus-diversity trade-off for MMR. 1 is pure relevance.
	 * From the 0.5 RAG path.
	 */
	mmrLambda: number
	/** How many of each source survive fusion. From the 0.5 RAG path. */
	sourceBudget: Record<string, number>
	/** Anything not named above. From the 0.5 RAG path. */
	defaultSourceBudget: number
}

export const DEFAULT_SEMANTIC: SemanticParams = {
	currentWindow: 2,
	recentWindow: 3,
	rrfK: 60,
	recencyBoost: 0.15,
	recencyDecay: 0.01,
	thresholdMin: 0.3,
	relativeThreshold: 0.7,
	mmrLambda: 0.7,
	sourceBudget: {
		message: 12,
		worldLore: 8,
		characterLore: 6,
		historyEntry: 6,
		narrativeRelationship: 5
	},
	defaultSourceBudget: 20
}

// ── (ii-c) Mechanism weights ────────────────────────────────────────────────

/**
 * How much each *way of finding* an entry counts, over the nine signals.
 *
 * A fourth kind of number, and it earns its own section because it is neither a
 * signal weight nor a share. The nine signal weights are the right data at the
 * wrong altitude — nobody thinks in "tf-idf", and a reader who wants less
 * guessing and more literal matching would have to know which four of the nine
 * to move and which way. These three group them by the mechanism that produced
 * the evidence:
 *
 *   · **keyword** — `keyword`, `tfidf`, `proximity`  → "these words appeared"
 *   · **semantic** — `semantic`                      → "this is about that"
 *   · **name** — `nameMatch`, `entityCooccurrence`,
 *     `entityVector`                                 → "this is called that"
 *
 * The other three are **structural**, and deliberately unscaled:
 * `lastRefRecency`, `density` and the priority bonus answer *"does this matter
 * now"* rather than *"did we find it"*. An entry does not stop being long, or
 * stop having come up a moment ago, because somebody turned keyword matching
 * down.
 *
 * ⚠ **Not the same axis as `GroupWeights.share`, and they sit on one screen.**
 * A share divides the token budget between sources, so raising one lowers the
 * others. These decide how much a mechanism contributes to one entry's score:
 * they are independent, all three may be 1 at once, and turning one up takes
 * nothing from anything. That is why the declaration uses a different control
 * type rather than a share with normalisation switched off.
 *
 * **1 is neutral, not maximum.** Multiplying by one is arithmetically what
 * already happened, so the defaults reproduce today's scoring exactly; 0
 * switches a mechanism off entirely, which is the readable way to say "keys
 * only".
 */
export interface MechanismWeights {
	keyword: number
	semantic: number
	name: number
}

export const DEFAULT_MECHANISMS: MechanismWeights = {
	keyword: 1,
	semantic: 1,
	name: 1
}

/** Which mechanism each signal belongs to. Absent means structural — unscaled. */
export const SIGNAL_MECHANISM: Partial<
	Record<keyof SignalWeights, keyof MechanismWeights>
> = {
	keyword: "keyword",
	tfidf: "keyword",
	proximity: "keyword",
	semantic: "semantic",
	nameMatch: "name",
	entityCooccurrence: "name",
	entityVector: "name"
}

// ── (iii) Group importance ──────────────────────────────────────────────────

/**
 * How much of the context each source may occupy.
 *
 * **A share of the budget, not a score multiplier**, and the difference is the
 * whole design. Scores are comparable within a source and not across sources —
 * a message score and a lore score are built from different signals with
 * different distributions. Multiplying by a group weight and ranking one pool
 * would mean turning "world lore" up surfaces whichever entries happened to
 * score numerically high, and starves whichever source is naturally more
 * conservative. The user moves a slider and gets a result they cannot explain.
 *
 * Allocating share instead gives three properties a user can predict:
 *
 *   · turning a group up takes tokens from the others, and nowhere else
 *   · turning a group to zero excludes it — a toggle for free
 *   · the receipt can state the arithmetic, so "why was this dropped" has an
 *     answer with numbers in it (16 §7c)
 *
 * Today's fixed behaviour is this model with the sliders welded: messages get
 * `MESSAGE_FILL_FRACTION = 0.5` and everything else shares the rest.
 */
/**
 * ⚠ **Resolved from the sources (R-7 P5), never declared on the ranker.**
 * Each retrieval definition declares its own `share`, `maxEntries`,
 * `minEntries` and `priority` and publishes them as a `BandIntent` at the
 * head of its candidates; `bandsFromIntents` below turns the intents the
 * ranker was handed into this table, over `DEFAULT_GROUPS` for the five core
 * bands. The ranker's own params carry none of it. The shape exists because
 * `select` and `allocateBudgets` are written against it, and because it is
 * the honest view of what one run resolved — the receipt records it whole.
 */
export interface GroupWeights {
	/** Relative importance. Normalised, so only the ratios matter. */
	share: Record<BandKey, number>
	/**
	 * Most entries a source may contribute. From the 0.5 keyword path. Absent
	 * means **no ceiling** — `relationship-search` declares none by default,
	 * and its own cap is the band's.
	 */
	maxEntries: Record<BandKey, number | undefined>
	/**
	 * How strongly a band resists being trimmed once its minimum is met
	 * (`BandPriority` in the SDK). `normal` everywhere is no ordering at all —
	 * the sweep stays in score order — which is what every source ships.
	 */
	priority: Record<BandKey, BandPriority>
	/**
	 * Fewest entries a source keeps when space is tight, whatever its share.
	 *
	 * ⚠ This replaced `minMessageTokens: 512`, and the change is a change of
	 * unit as much as of scope. A token minimum answered "how much conversation"
	 * in a currency nobody thinks in — 512 tokens is some number of messages
	 * that depends on how long the last few were, so the same setting produced
	 * a different amount of readable session on every turn. Entries is what the
	 * user means: *keep the last six messages*.
	 *
	 * These are minimums, not reservations — `select` fills them in score order
	 * and stops at `availableTokens`. Minimums that sum past the window are the
	 * one way this could produce a prompt too big to send, so they lose.
	 *
	 * ## ⚠ Only `messages` is reachable now — ruling R6
	 *
	 * *"Per-source minimums are removed everywhere except recent conversation,
	 * which keeps its guaranteed share. Lore competes on score alone."* The
	 * declaration on `core:task/rank-hybrid@1` names one band, `rankingParamsFrom`
	 * reads one key out of whatever a stored value holds, and migration 0201
	 * rewrites the values already stored. So no lore minimum can be set.
	 *
	 * **The map keeps its five keys and `select` keeps honouring all of them**,
	 * and that is not an oversight. A minimum is the one mechanism that could
	 * quietly re-admit a candidate the ranker excluded, which is exactly what
	 * R1's clairvoyance filter must not allow — so `select` proves a minimum
	 * cannot resurrect an `ineligible` candidate, and that proof needs a lore
	 * minimum to exist for the test to construct. Removing the shape would
	 * remove the guard along with the feature.
	 */
	minEntries: Record<BandKey, number>
}

/**
 * The five core bands' defaults — **the fallback for a band no source
 * declared this run**, and pinned equal to what the source definitions
 * declare by `runtime/signalWiring.int.test.ts`.
 *
 * Still here after R-7 P5, and on purpose: a spec that ranks
 * `lorebook-triggers@1` (one node, three bands, no per-band declaration), the
 * vector-only parity harness, or a candidate a plugin stamps `worldLore` with
 * no intent of its own all reach the ranker with bands nothing spoke for, and
 * the parity corpus holds that they select exactly what they always did. A
 * band outside these five with no intent is not defaulted — it is excluded
 * with `excluded_unknown_source`, which is the loud answer.
 */
export const DEFAULT_GROUPS: GroupWeights = {
	// 0.5 to messages and 0.5 across the lore sources reproduces
	// MESSAGE_FILL_FRACTION exactly; the split within lore is unweighted today,
	// which is why the three lore sources share equally.
	share: {
		messages: 0.5,
		worldLore: 0.1667,
		characterLore: 0.1667,
		history: 0.1666,
		relationships: 0
	},
	maxEntries: {
		messages: 50,
		worldLore: 20,
		characterLore: 15,
		history: 10,
		// Uncapped, as `relationship-search@1`'s own `maxEntries` declares
		// (no default = no ceiling). ⚠ Not 0: a cap of nothing behind a share
		// of nothing means raising the share alone excludes every relationship
		// as over its ceiling, which is a trap and not a default.
		relationships: undefined
	},
	priority: {
		messages: "normal",
		worldLore: "normal",
		characterLore: "normal",
		history: "normal",
		relationships: "normal"
	},
	// Six messages is what `core:query/session-history@1` used to guarantee under
	// its own `minInclude`. The others are zero and — since R6 — unreachable:
	// a minimum is a promise to spend budget on something whether or not it
	// scored, which is the opposite of what a ranker is for, and it is the one
	// route by which an excluded entry could come back in.
	minEntries: {
		messages: 6,
		worldLore: 0,
		characterLore: 0,
		history: 0,
		relationships: 0
	}
}

// ── The whole surface ───────────────────────────────────────────────────────

export interface RankingParams {
	signals: Record<RetrievalBand, SignalWeights>
	/** How much each retrieval mechanism's signals count. See `MechanismWeights`. */
	mechanisms: MechanismWeights
	retrieval: RetrievalParams
	semantic: SemanticParams
	groups: GroupWeights
}

export const DEFAULT_RANKING: RankingParams = {
	signals: DEFAULT_SIGNAL_WEIGHTS,
	mechanisms: DEFAULT_MECHANISMS,
	retrieval: DEFAULT_RETRIEVAL,
	semantic: DEFAULT_SEMANTIC,
	groups: DEFAULT_GROUPS
}

/**
 * Merge user config over the defaults, one level deep per section.
 *
 * Deliberately not a deep merge of `signals`: a partial signal set would
 * silently inherit weights the user thought they had replaced, and "I set the
 * weights and it still behaves the old way" is the least debuggable outcome in
 * a tuning UI. Naming a source means giving it a complete set.
 */
export function withDefaults(
	partial: DeepPartial<RankingParams> = {}
): RankingParams {
	return {
		signals: {
			...DEFAULT_SIGNAL_WEIGHTS,
			...((partial.signals ?? {}) as Record<RetrievalBand, SignalWeights>)
		},
		// Merged per key, unlike `signals` above, and the difference is that
		// there is nothing here to be silently inherited *wrongly*: three
		// independent multipliers, each meaning the same thing on its own, so a
		// caller naming one means "change this one" rather than "switch the
		// other two off". `sourceBudget` and `minEntries` take the same reading.
		mechanisms: {
			...DEFAULT_MECHANISMS,
			...(partial.mechanisms ?? {})
		},
		retrieval: {
			...DEFAULT_RETRIEVAL,
			...(partial.retrieval ?? {}),
			// Nested like `sourceBudget` below: naming one half of the
			// admission split means "change this one", not "drop the other to
			// undefined" — which the evidence sum would read as `NaN`.
			admitWeights: {
				...DEFAULT_RETRIEVAL.admitWeights,
				...(partial.retrieval?.admitWeights ?? {})
			}
		},
		semantic: {
			...DEFAULT_SEMANTIC,
			...(partial.semantic ?? {}),
			// The one nested field: a caller naming two source budgets means
			// "change these two", not "drop the other three to undefined".
			sourceBudget: {
				...DEFAULT_SEMANTIC.sourceBudget,
				...((partial.semantic?.sourceBudget ?? {}) as Record<
					string,
					number
				>)
			}
		},
		groups: {
			...DEFAULT_GROUPS,
			...(partial.groups ?? {}),
			share: {
				...DEFAULT_GROUPS.share,
				...(partial.groups?.share ?? {})
			},
			maxEntries: {
				...DEFAULT_GROUPS.maxEntries,
				...(partial.groups?.maxEntries ?? {})
			},
			// Nested like its two neighbours, so naming one source's minimum
			// does not silently set every other source's to undefined —
			// which `select` would read as zero and quietly stop honouring.
			minEntries: {
				...DEFAULT_GROUPS.minEntries,
				...(partial.groups?.minEntries ?? {})
			},
			priority: {
				...DEFAULT_GROUPS.priority,
				...(partial.groups?.priority ?? {})
			}
		}
	}
}

/**
 * The band table one run resolves, from what the sources said (R-7 P5).
 *
 * Every intent the ranker was handed overlays the core defaults, field by
 * field: a source that declared a share and no ceiling gets its share and the
 * default ceiling for its band; a plugin band nothing defaults gets exactly
 * what it declared and `0` / `normal` / no ceiling where it said nothing. A
 * core band no source spoke for this run keeps `DEFAULT_GROUPS`' row — see
 * that constant for why.
 *
 * Also the receipt's answer to "where did this share come from": `declared`
 * lists the bands an intent reached the ranker for, so a source whose params
 * a spec forgot to wire is visible as a band running on defaults.
 */
export function bandsFromIntents(
	intents: readonly BandIntent[],
	fallback: GroupWeights = DEFAULT_GROUPS
): { groups: GroupWeights; declared: string[] } {
	const groups: GroupWeights = {
		share: { ...fallback.share },
		maxEntries: { ...fallback.maxEntries },
		minEntries: { ...fallback.minEntries },
		priority: { ...fallback.priority }
	}
	const declared: string[] = []
	for (const { band: spelled, intent } of intents) {
		// The index's spelling lands on the budget group that pays for it,
		// exactly as the candidates' does (`toBudgetGroups`): an intent for
		// `message` is the `messages` band's, not a sixth band beside it.
		const band = BUDGET_GROUP_ALIASES[spelled] ?? spelled
		if (declared.includes(band)) continue // first per band wins
		declared.push(band)
		if (!(band in groups.share)) {
			groups.share[band] = 0
			groups.maxEntries[band] = undefined
			groups.minEntries[band] = 0
			groups.priority[band] = "normal"
		}
		if (typeof intent.share === "number" && Number.isFinite(intent.share))
			groups.share[band] = Math.max(0, intent.share)
		if (
			typeof intent.maxEntries === "number" &&
			Number.isFinite(intent.maxEntries)
		)
			groups.maxEntries[band] = Math.max(0, Math.floor(intent.maxEntries))
		if (
			typeof intent.minEntries === "number" &&
			Number.isFinite(intent.minEntries)
		)
			groups.minEntries[band] = Math.max(0, Math.floor(intent.minEntries))
		if (isBandPriority(intent.priority))
			groups.priority[band] = intent.priority
	}
	return { groups, declared }
}

/**
 * The signal set a band's candidates are scored with. One complete row per
 * core band; a plugin band takes the lore row, which is what a source that
 * publishes lorebook-shaped signals means, and a source that ranks itself
 * hands over a `presetScore` that this never reaches.
 */
export function signalsForBand(
	signals: Record<RetrievalBand, SignalWeights>,
	band: BandKey
): SignalWeights {
	return signals[band as RetrievalBand] ?? signals.worldLore
}

/** How the sources' shares are read when the window is divided. See `SHARE_NORMALISATION`. */
export type ShareNormalisation = "relative" | "fixed"
export const isShareNormalisation = (v: unknown): v is ShareNormalisation =>
	v === "relative" || v === "fixed"

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K]
}

/**
 * Turn shares into token budgets.
 *
 * Zero-weight sources are excluded before normalising, so a disabled group does
 * not quietly consume budget it cannot use.
 *
 * Purely proportional now. The message minimum used to be applied here, raising
 * `out.messages` *after* the split without taking the difference from anywhere
 * — so the returned budgets could sum past `availableTokens`, and on a small
 * window routinely did. Minimums are `minEntries` and belong to `select`, which
 * is the only place that knows what a candidate costs.
 */
export function allocateBudgets(
	groups: GroupWeights,
	availableTokens: number,
	normalisation: ShareNormalisation = "relative"
): Record<BandKey, number> {
	const active = (Object.keys(groups.share) as BandKey[]).filter(
		(k) => groups.share[k] > 0
	)
	const total = active.reduce((sum, k) => sum + groups.share[k], 0)

	const out = Object.fromEntries(
		(Object.keys(groups.share) as BandKey[]).map((k) => [k, 0])
	) as Record<BandKey, number>
	if (total <= 0 || availableTokens <= 0) return out

	/**
	 * `relative`: `share / Σ shares` — the arithmetic this has always run,
	 * bit for bit. `fixed`: each share is the fraction of the window it
	 * states, and the set is scaled down together only when it exceeds the
	 * window — so `Math.max(1, total)` is the whole of the difference.
	 */
	const divisor = normalisation === "fixed" ? Math.max(1, total) : total
	for (const k of active)
		out[k] = Math.floor(availableTokens * (groups.share[k] / divisor))

	return out
}
