/**
 * The scoring signals, as pure functions over explicit arguments.
 *
 * Lifted from the 0.5 keyword path unchanged in behaviour and changed in
 * shape: each one took `ScoringContext` and `this`, and now takes what it
 * actually reads. That is the entire refactor — these were always pure, they
 * were never parameterised, and a Task is handed no services (F11) so they
 * cannot stay coupled to a class that owns a database import.
 *
 * Every function here is verified against the engine's behaviour by
 * `signals.test.ts`, including the parts that look like bugs and are therefore
 * load-bearing until parity passes:
 *
 *   · keys match by **substring**, so `art` fires on "hearth"
 *   · an invalid regex silently falls back to substring
 *   · a key list is comma-split and trimmed, and empty keys are dropped
 */

import type { MatchMode } from "$lib/server/pipelines/ranking/weights"
import {
	PATTERN_INVALID,
	patternBudget,
	patternIndex,
	primePatterns,
	type PatternBudget,
	type PatternRequest
} from "$lib/server/pipelines/ranking/boundedPattern"

/**
 * A key list as a matcher is handed one.
 *
 * `string[]` is the stored shape (a `text[]` column) and what the host's
 * lore read hands on: one element, one key, so a regex quantifier `{1,3}` or a
 * literal "Smith, John" arrives whole (finding #146). The comma string is the
 * legacy wire shape — the editor's text field, an amendment saved from it, a
 * test fixture — and is split at this boundary alone (`splitKeys`).
 */
export type KeyList = string | readonly string[] | null | undefined

export interface KeyedEntry {
	keys?: KeyList
	caseSensitive?: boolean | null
	/** Legacy boolean. `matchMode` wins when both are present. */
	useRegex?: boolean | null
	/**
	 * Typed as a plain string because this arrives straight off a database
	 * column. An unrecognised value falls back to today's behaviour rather than
	 * throwing — a bad row should not take a session down, and substring is the
	 * mode every existing entry is already using.
	 */
	matchMode?: string | null
	/**
	 * The condition keys — what has to *also* be true, or has to be false.
	 *
	 * A list like `keys`, and read by the same `splitKeys`, because a second
	 * rule for what counts as a key is a second thing to drift.
	 */
	secondaryKeys?: KeyList
	/**
	 * How the condition keys are read. NULL is the only default there can be:
	 * an entry that has never been given one has no condition at all, which is
	 * a different state from every mode below.
	 */
	selectiveLogic?: string | null
}

/** The window a key is matched against, in both cases so neither is recomputed. */
export interface ScanWindow {
	raw: string
	lower: string
	/**
	 * Where each message starts in `raw`, and its id — so a key's hit can say
	 * which message it was in (L1: match facts at the source). Absent when
	 * the window was built from text with no message ids.
	 */
	starts?: number[]
	ids?: Array<number | null>
}

/** The message a window offset falls in, or null. */
export function messageAt(window: ScanWindow, index: number): number | null {
	if (!window.starts || !window.ids || index < 0) return null
	let at = -1
	for (let i = 0; i < window.starts.length && window.starts[i]! <= index; i++) at = i
	return at >= 0 ? (window.ids[at] ?? null) : null
}

/**
 * Build the scan window from the last `scanDepth` messages.
 *
 * Separate from the guaranteed-message count on purpose — see
 * `RetrievalParams.scanDepth`. Joined with a single space, which is what the
 * engine does (`:141`) and which matters: a key spanning a message boundary
 * can match, and changing the separator would silently change results.
 */
export function buildScanWindow(
	messages: ReadonlyArray<{ content?: string | null; id?: number | null }>,
	scanDepth: number
): ScanWindow {
	const slice =
		scanDepth >= messages.length ? messages : messages.slice(-scanDepth)
	const raw = slice.map((m) => m.content ?? "").join(" ")
	const starts: number[] = []
	let at = 0
	for (const m of slice) {
		starts.push(at)
		at += (m.content ?? "").length + 1
	}
	return {
		raw,
		lower: raw.toLowerCase(),
		starts,
		ids: slice.map((m) => (typeof m.id === "number" ? m.id : null))
	}
}

/**
 * A key list as keys: trimmed, empties dropped. `:1569`.
 *
 * ⚠ Only a comma STRING is split. An array is already one element per key and
 * is never re-split — splitting it again is what tore `(a|b){1,2}` into
 * `(a|b){1` and `2}` (finding #146).
 */
export const splitKeys = (keys?: KeyList): string[] =>
	(Array.isArray(keys) ? (keys as readonly unknown[]) : String(keys ?? "").split(","))
		.map((k) => (typeof k === "string" ? k.trim() : ""))
		.filter((k) => k.length > 0)

/** A key list as the one line of text a person (or a tf-idf document) reads. */
export const keysText = (keys?: KeyList): string =>
	typeof keys === "string" || keys == null ? (keys ?? "") : splitKeys(keys).join(", ")

const MODES: readonly MatchMode[] = ["substring", "word", "regex"]

const modeOf = (entry: KeyedEntry): MatchMode => {
	if (entry.matchMode && MODES.includes(entry.matchMode as MatchMode))
		return entry.matchMode as MatchMode
	return entry.useRegex ? "regex" : "substring"
}

/**
 * **Where** one key matches the window, or `-1`.
 *
 * The index half of `matchesKey`, and the reason the boolean is written in
 * terms of this rather than the other way round: proximity wants to know how
 * far apart two keys landed, and design phase 1 is explicit that it must come
 * out of *the scan already being performed* rather than a second pass. An
 * offset is what that scan already computes — `String.includes` is
 * `indexOf(…) !== -1` and `RegExp.test` is `exec(…) !== null` — so taking the
 * number instead of the boolean costs nothing and adds no traversal.
 *
 * ⚠ The offset is into whichever of `raw`/`lower` this entry matches against,
 * which is a distance in the *lowercased* text for the ordinary case. A few
 * characters change length when lowercased (`İ`), so the two texts can drift
 * apart by a character or two on such a window — irrelevant here, because
 * every key of one entry is measured against the same string and the number is
 * only ever used as a gap.
 */
export function matchIndexOf(
	key: string,
	entry: KeyedEntry,
	window: ScanWindow
): number {
	const sensitive = !!entry.caseSensitive
	const text = sensitive ? window.raw : window.lower
	const k = sensitive ? key : key.toLowerCase()

	switch (modeOf(entry)) {
		case "regex": {
			/**
			 * ⚠ `key`, not `k`. Case-insensitivity is the `i` flag's job
			 * and never the pattern text's.
			 *
			 * Lowercasing a *pattern* corrupts it: the inverse character
			 * classes are spelled with capitals, so `\Bing` became
			 * `\bing`, `\Wking` became `\wking`, `\Sfoo` became
			 * `\sfoo` and `\Dx` became `\dx` — each one the exact
			 * opposite assertion, silently, with the entry still firing on
			 * something. It reached real books: SillyTavern exports
			 * `case_sensitive: null`, which lands here as `false`, and key
			 * shape is now what decides that a key is a regex at all, so
			 * this is the path genuinely-regex keys arrive on.
			 *
			 * ⚠ **Never `new RegExp(key).exec(text)` here** (plan S3). A
			 * pattern like `(a+)+$` backtracks exponentially and this runs on
			 * the main thread every turn; `patternIndex` runs it under a time
			 * bound, and a key it does not run — a runaway pattern, a key that
			 * tripped the bound — does not match, and the scan's receipt says
			 * why (`patternsNotRun`).
			 */
			const at = patternIndex(window, key, sensitive)
			// Silent fallback, preserved from `:1583`. A user with a broken
			// regex gets substring behaviour rather than an entry that never
			// fires. The lowercased `k` is right here: in substring,
			// lowercasing *both* sides is the whole mechanism.
			if (at === PATTERN_INVALID) return text.indexOf(k)
			return typeof at === "number" ? at : -1
		}
		case "word": {
			const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			return (
				new RegExp(
					`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
					"u"
				).exec(text)?.index ?? -1
			)
		}
		default:
			return text.indexOf(k)
	}
}

/**
 * The regex keys of some entries, as `primePatterns` takes them.
 *
 * One list — `keys` or `secondaryKeys` — because a scan reads the two against
 * different windows (a condition key against the conversation plus the pass,
 * see `keywordQuery`). Only entries that read as regex contribute; the other
 * modes never compile the key as written.
 */
export function patternRequestsOf(
	entries: Iterable<KeyedEntry>,
	list: "keys" | "secondaryKeys"
): PatternRequest[] {
	const out: PatternRequest[] = []
	for (const entry of entries) {
		if (modeOf(entry) !== "regex") continue
		const sensitive = !!entry.caseSensitive
		for (const pattern of splitKeys(entry[list])) out.push({ pattern, sensitive })
	}
	return out
}

/**
 * Does one key match the window?
 *
 * `word` is the new mode and the only one that is not current behaviour. It
 * uses a boundary assertion around an escaped key rather than a token set, so
 * it works for multi-word keys ("the Ashguard") which a token comparison would
 * miss.
 */
export const matchesKey = (
	key: string,
	entry: KeyedEntry,
	window: ScanWindow
): boolean => matchIndexOf(key, entry, window) >= 0

// ── Trigram folding ─────────────────────────────────────────────────────────

/**
 * Character trigrams of a string, lowercased, whitespace-normalised, unpadded.
 *
 * **Characters and not tokens, deliberately.** `tokenize` splits on `\W+`,
 * which is ASCII-only — a Japanese, Chinese or Thai sentence has no spaces for
 * a word boundary to mean anything against and comes out of it as *no terms at
 * all*. Trigrams are the one folding that works in every script, which is why
 * design phase 1 makes them the universal path and stemming the English
 * enhancement rather than the other way round.
 *
 * ⚠ **Unpadded, and that is the whole reason unsegmented scripts work.** The
 * usual trick is to wrap a term in spaces so its boundaries are part of its
 * profile — which is right for a language that writes boundaries, and exactly
 * wrong for one that does not. `灰の衛兵` inside `私は灰の衛兵を見た` has no
 * spaces around it, so two of a padded profile's four trigrams could never be
 * matched by anything and the key would sit permanently at 50%. Whitespace is
 * still *normalised*, so a key written `the Ashguard` matches a window that
 * broke the line between the two words.
 */
export function trigramsOf(text: string): Set<string> {
	const out = new Set<string>()
	const s = text.toLowerCase().replace(/\s+/g, " ").trim()
	for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3))
	return out
}

/**
 * How much of a key's trigram profile the window carries, in [0, 1].
 *
 * One-sided on purpose: the question is whether the *key* is present, not
 * whether the two texts resemble each other, and a scan window is thousands of
 * characters against a key of ten. A Jaccard ratio over that union is ~0 for
 * every key that ever matched.
 */
export function trigramCoverage(
	key: string,
	windowTrigrams: ReadonlySet<string>
): number {
	const grams = trigramsOf(key)
	if (grams.size < TRIGRAM_MIN_GRAMS) return 0
	let hit = 0
	for (const g of grams) if (windowTrigrams.has(g)) hit++
	return hit / grams.size
}

/**
 * How much of a key has to be covered before a fuzzy hit counts at all.
 *
 * A constant rather than a knob. Below about this, coverage stops distinguishing
 * a near-miss from an unrelated word that rhymes — `dragon` against `wagon`
 * shares half its trigrams — and the control a user actually wants is *how much
 * a fuzzy hit is worth*, which is the declared `trigramFolding` strength. Two
 * numbers here would ask them to calibrate a scale before they could answer
 * that.
 *
 * ⚠ **What 0.6 deliberately does not catch.** One wrong character destroys up
 * to three trigrams, so a substitution or transposition in the *middle* of a
 * short word — `ashgaurd` for `ashguard` — lands near 0.3 and is refused.
 * Catching it needs a threshold around 0.5, which is where `wagon` starts
 * firing `dragon`. Precision matters more than recall in a fixed budget: a
 * wrong entry does not merely waste space, it displaces a right one. So this is
 * calibrated for inflection (`rider`/`riders`), for an error near a word's edge,
 * and for scripts with no word boundaries at all — and against everything else.
 */
export const TRIGRAM_MIN_COVERAGE = 0.6

/**
 * How many trigrams a key needs before a fuzzy reading of it means anything.
 *
 * A three-character key has exactly one trigram, so its coverage is 0 or 1 with
 * nothing in between — `elf` would fuzzy-match `self` at full strength, which
 * is not a near-miss being forgiven but a threshold with no resolution. Two is
 * the fewest that can express a partial answer, and it is four characters.
 */
export const TRIGRAM_MIN_GRAMS = 2

/** How much one key contributes, exact first and trigrams as the fallback. */
function keyScore(
	key: string,
	entry: KeyedEntry,
	window: ScanWindow,
	folding: TrigramFolding | null
): { score: number; index: number } {
	const index = matchIndexOf(key, entry, window)
	if (index >= 0) return { score: 1, index }
	if (!folding || folding.strength <= 0) return { score: 0, index: -1 }
	// Regex keys are patterns, not text. Folding `\b(ash|em)ber\b` into
	// trigrams would match on the punctuation of the pattern rather than on
	// anything it describes, so a regex key keeps exactly its own semantics.
	if (modeOf(entry) === "regex") return { score: 0, index: -1 }
	const coverage = trigramCoverage(key, folding.windowTrigrams)
	return coverage >= TRIGRAM_MIN_COVERAGE
		? { score: folding.strength * coverage, index: -1 }
		: { score: 0, index: -1 }
}

/**
 * The window's trigrams plus how much a fuzzy hit is worth, or `null` for off.
 *
 * Built once per window by the caller — see `keywordQuery` — because the
 * window is shared by every entry in the pool and re-folding it per entry
 * would be the pool size times the same work.
 */
export interface TrigramFolding {
	windowTrigrams: ReadonlySet<string>
	/** `retrieval.trigramFolding`; 0 is off and never reaches here. */
	strength: number
}

export interface KeywordMatch {
	/** Fraction of an entry's keys present in the window. `:1559`. */
	signal: number
	/**
	 * How tightly the *exactly* matched keys clustered, in [0, 1].
	 *
	 * 0 when fewer than two keys matched exactly — one key says nothing about
	 * distance, and a fuzzy hit has no single offset to measure from.
	 */
	proximity: number
	/** The keys that matched and the window offset of each (-1 for a fuzzy hit). */
	hits: Array<{ key: string; index: number }>
}

/**
 * Roughly twenty words, which is the distance design phase 1 names as the
 * point where two key hits stop being evidence about each other.
 *
 * Characters rather than words because the scan window is a string and
 * re-tokenising it to count words would be the second pass this signal is
 * specified not to make. `exp(-gap / SPAN)` is 1 for adjacent keys, ~0.37 at
 * twenty words and ~0.14 at forty.
 */
const PROXIMITY_SPAN = 120

/**
 * Both things one walk of an entry's keys can answer.
 *
 * `keywordSignal` used to be this walk and is now a projection of it, because
 * proximity is *the same comparisons* — the offset each key matched at — and
 * computing it beside the fraction is what keeps it out of a second pass.
 */
export function keywordMatch(
	entry: KeyedEntry,
	window: ScanWindow,
	folding: TrigramFolding | null = null
): KeywordMatch {
	const keys = splitKeys(entry.keys)
	if (keys.length === 0) return { signal: 0, proximity: 0, hits: [] }

	let matched = 0
	const offsets: number[] = []
	const hits: Array<{ key: string; index: number }> = []
	for (const key of keys) {
		const { score, index } = keyScore(key, entry, window, folding)
		matched += score
		if (index >= 0) offsets.push(index)
		// Which keys matched, and where (L1): kept rather than folded into
		// the fraction, so a readout never names a key that did not match.
		if (score > 0) hits.push({ key, index })
	}

	let proximity = 0
	if (offsets.length > 1) {
		offsets.sort((a, b) => a - b)
		let gap = Infinity
		for (let i = 1; i < offsets.length; i++)
			gap = Math.min(gap, offsets[i]! - offsets[i - 1]!)
		proximity = Math.exp(-gap / PROXIMITY_SPAN)
	}

	return { signal: matched / keys.length, proximity, hits }
}

/** Fraction of an entry's keys present in the window. `:1559`. */
export const keywordSignal = (
	entry: KeyedEntry,
	window: ScanWindow,
	folding: TrigramFolding | null = null
): number => keywordMatch(entry, window, folding).signal

// ── Selective logic ─────────────────────────────────────────────────────────

/**
 * The four readings of an entry's condition keys.
 *
 * Stored as these strings and not as SillyTavern's integers. The wire format
 * has to keep carrying `selectiveLogic: 0`, because that is what a foreign file
 * says; a *column* holding 0 is a number whose meaning lives in a lookup table
 * somebody has to find, and this is a value a person reads in a receipt.
 * `SELECTIVE_LOGIC_BY_ST_CODE` below is the one translation between them.
 */
export const SELECTIVE_LOGIC = ["andAny", "andAll", "notAny", "notAll"] as const
export type SelectiveLogic = (typeof SELECTIVE_LOGIC)[number]

export const isSelectiveLogic = (v: unknown): v is SelectiveLogic =>
	typeof v === "string" && (SELECTIVE_LOGIC as readonly string[]).includes(v)

/**
 * SillyTavern's `extensions.selectiveLogic` integers.
 *
 * ⚠ **Not in numeric order, and that is the whole reason this table exists.**
 * ST's enum is `AND_ANY = 0, NOT_ALL = 1, NOT_ANY = 2, AND_ALL = 3` — 1 and 3
 * are *not* the pair a reader would guess — so an importer indexing into a
 * four-element array in the obvious order silently inverts every book that
 * used either of them. Exported for the import lane, which owns the mapper
 * this belongs in.
 */
export const SELECTIVE_LOGIC_BY_ST_CODE: Readonly<
	Record<number, SelectiveLogic>
> = { 0: "andAny", 1: "notAll", 2: "notAny", 3: "andAll" }

/**
 * Does the entry's condition survive this window?
 *
 * **An eligibility rule, never a score.** "Fire on *dragon*, but not when
 * *statue* is present" is an author stating a fact about when the entry is
 * wrong, and a wrong entry does not merely rank low — in a fixed budget it
 * displaces a right one and misleads the model. So a failure here excludes the
 * entry with a receipt rather than subtracting from its score, which is also
 * the seam phase 7's clairvoyance filter needs to exist before it can use it.
 *
 * True whenever there is no condition to fail: no mode, or no condition keys.
 * That is what makes this inert for every book that has never heard of it.
 *
 * The four modes, all of them conditions on the *secondary* keys alone — the
 * primary keys decide whether the entry was found at all, and this decides
 * whether being found counts:
 *
 *   · `andAny` — at least one condition key is present
 *   · `andAll` — every condition key is present
 *   · `notAny` — no condition key is present
 *   · `notAll` — at least one condition key is absent
 *
 * ⚠ **Exact matches only, even when trigram folding is on.** Folding exists to
 * widen what is *found*; widening what is *excluded* would let a near-miss
 * silently veto an entry, and the governing rule of the whole retrieval plan is
 * that adding a mechanism may only add matches. A `notAny` that fired on a
 * typo would be that rule broken in the one direction it must never break.
 */
export function selectiveLogicHolds(
	entry: KeyedEntry,
	window: ScanWindow
): boolean {
	const mode = entry.selectiveLogic
	if (!isSelectiveLogic(mode)) return true
	const keys = splitKeys(entry.secondaryKeys)
	if (keys.length === 0) return true

	let present = 0
	for (const key of keys) if (matchesKey(key, entry, window)) present++

	switch (mode) {
		case "andAny":
			return present > 0
		case "andAll":
			return present === keys.length
		case "notAny":
			return present === 0
		case "notAll":
			return present < keys.length
	}
}

/**
 * 1 when the entry's name appears in the window as a whole word, ignoring case.
 *
 * ⚠ **Whole-word, and independent of the entry's own key settings** (finding
 * #147). A title match ADMITS an entry (`keywordQuery`), so a raw substring let
 * "Ash" in on "the crash" and "Al" on "Alchemy" — past the author's own
 * word-mode and case choices, which govern KEYS, not the title. The boundary
 * is the `word` key mode's, so "the Ashguard" still matches as two words.
 */
export const nameMatchSignal = (
	name: string | null | undefined,
	window: ScanWindow
): number => {
	const wanted = (name ?? "").trim().toLowerCase()
	if (!wanted) return 0
	// Cheap reject first: no substring, no word.
	if (!window.lower.includes(wanted)) return 0
	const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
	return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "u").test(
		window.lower
	)
		? 1
		: 0
}

/**
 * ⚠ **`entityCooccurrenceSignal` was here and is gone** — plan phase 3.
 *
 * It answered world lore's half of bug 16 by asking whether the entry's own
 * name-plus-keys *contained* a cast name, as a substring, as a 0 or a 1. Design
 * §13.6 names its three defects and every one of them was structural: binary,
 * so one shared entity and twelve scored alike; substring, so `Al` fired on
 * `Alchemy`; and one-sided, so an entry mentioning Alice scored whether or not
 * the conversation had said a word about her.
 *
 * The replacement is `entityEvidence` in `ranking/entities.ts` — graded,
 * rarity-weighted, matched on word boundaries through the gazetteer, and
 * two-sided. `scoreSignals` calls it for world lore and history; character
 * lore's half of bug 16 is `speakerCooccurrenceSignal` below and is unchanged.
 *
 * Deleted rather than left exported. It had one caller, and an unused scoring
 * function beside a live one is the shape a third definition of the same
 * question grows from — which `entities.ts`'s own header rules against.
 */

/**
 * 1 when the character this entry belongs to **spoke in the guaranteed
 * window**. `:1161-1175`.
 *
 * Character lore's co-occurrence, and a different question from world lore's.
 * A character-lore entry is one character's private self-knowledge, so "does
 * this entry mention a cast member" is answered by construction — the entry is
 * *about* one — and asking it scores every entry of every present character
 * alike. What earns the weight is whether that character is in the scene right
 * now, which is nearer to `nameMatch`'s direction than to the world-lore
 * signal's: the conversation is the haystack, not the entry.
 *
 * A binding with no character (a persona binding, or a background/NPC row)
 * scores 0 — legacy tests `binding?.characterId` before consulting the set, so
 * a persona speaking has never lifted the lore bound to it.
 */
export const speakerCooccurrenceSignal = (
	boundCharacterId: number | null | undefined,
	speakingCharacterIds: ReadonlySet<number>
): number =>
	boundCharacterId != null && speakingCharacterIds.has(boundCharacterId)
		? 1
		: 0

/**
 * Which characters spoke in the last `guaranteedMessages` messages. `:183-188`.
 *
 * Sliced exactly as `buildScanWindow` slices, and against the *guaranteed*
 * count rather than the scan depth, because that is the window legacy built the
 * set from — the two are separate parameters now and both still default to 10,
 * so pointing this at the wrong one is a difference nothing would report until
 * somebody moved one of them.
 *
 * A message with no `characterId` — a user turn, the narrator, the uncommitted
 * draft — contributes nothing, which is what makes this a set of *characters*
 * and not of participants.
 */
export function speakersIn(
	messages: ReadonlyArray<{ characterId?: number | null }>,
	guaranteedMessages: number
): Set<number> {
	const slice =
		guaranteedMessages >= messages.length
			? messages
			: messages.slice(-guaranteedMessages)
	const out = new Set<number>()
	for (const m of slice) if (m.characterId != null) out.add(m.characterId)
	return out
}

// ── TF-IDF ──────────────────────────────────────────────────────────────────

/** Lowercase, split on non-word, drop single characters. `:1437`. */
export const tokenize = (text: string): string[] =>
	text
		.toLowerCase()
		.split(/\W+/)
		.filter((t) => t.length > 1)

/**
 * Per-term IDF over messages as documents: `log(N / (1 + df))`, **floored at
 * zero**. `:1456`.
 *
 * ⚠ **The floor is the one change from legacy, and it only touches `df = N`.**
 * The unsmoothed ratio is `N / (N + 1)` when a term appears in *every* message —
 * just under 1, so the log is *negative*. On a short session that is routine:
 * "the" is in every message. `tfidfSignal` then sums that negative weight, so an
 * entry sharing only common words scores **below** an entry sharing nothing at
 * all, and a candidate is reported as `filled_zero_score · scored -0.028` — a
 * receipt that tells the user something false about why the entry was chosen.
 *
 * Sharing "the" is not evidence *against* relevance; it is no evidence. A term
 * that occurs in every document carries no information, so zero is the correct
 * value rather than a clamp papering over one — the same reading `rarity` in
 * `ranking/entities.ts` gets from BM25's smoothing, arrived at by flooring
 * instead of by re-deriving, because this form is parity-pinned and every term
 * with `df < N` must keep the exact number it had.
 *
 * ⚠ Not applied by `normaliseTfidf`, which divides by `Math.max(1, max)` and so
 * passes a negative pool maximum through unscaled. The fix belongs here, where
 * the sign is created.
 */
export function buildIdf(
	messages: ReadonlyArray<{ content?: string | null }>
): Map<string, number> {
	const df = new Map<string, number>()
	for (const m of messages)
		for (const t of new Set(tokenize(m.content ?? "")))
			df.set(t, (df.get(t) ?? 0) + 1)

	const idf = new Map<string, number>()
	const n = messages.length
	for (const [term, count] of df)
		idf.set(term, Math.max(0, Math.log(n / (1 + count))))
	return idf
}

/**
 * Document frequency over a document collection.
 *
 * ⚠ **The collection is whatever the caller hands it, and that choice is the
 * whole argument.** `buildIdf` above walks *messages* — the collection
 * `tfidfSignal` scores against and the one parity pins. Everything that asks
 * how rare a term is *in the thing being searched* walks the **candidate
 * pool** instead, through here: the admission gate's `rarity`
 * (`ranking/entities.ts`) and BM25's idf below.
 *
 * The pool reading is not a preference, it is a measurement. Over messages, on
 * an eight-message session almost every word appears in one message and
 * therefore looks rare: with rarity taken that way, an entry about a
 * pewterers' guild scored as much shared vocabulary as the entry the
 * conversation was actually about, on the strength of "of", "with" and "long".
 * Over the entries — the textbook construction, idf over the collection being
 * searched and presence from the query — "the" appears in every entry, so it
 * weighs nothing, and no stopword list has to exist for it to be true in any
 * language.
 *
 * ⚠ **That last sentence is a property of the *documents*, not of the pool.**
 * It holds for the admission gate, whose document is an entry's name, keys and
 * content — long enough that "the" really is in nearly all of them. It does
 * **not** hold for `buildBm25Idf`'s documents, which are `keys + title`: short
 * enough that a stopword sits in half the pool and keeps a real weight rather
 * than none. So the pool reading does not make a stopword free here, and the
 * fix for that was **not** to widen the text `df` is counted over — that would
 * put rarity and length back into disagreement about what a document is, which
 * is the defect this function came out of. It was to stop the *query* half
 * multiplying by a raw count: `lexicalSignal` saturates both halves now, so a
 * word the conversation says 21 times is worth about twice a word it says once
 * rather than twenty-one times. Measured, and recorded on `CONTENDED` in
 * `measure/rankingCorpus.test.ts`.
 *
 * One walk with two readings on top of it rather than one walk per reading:
 * two implementations of a statistic agree right up until the day one of them
 * is edited.
 */
export function buildDocFreq(
	documents: ReadonlyArray<string | null | undefined>
): Map<string, number> {
	const df = new Map<string, number>()
	for (const d of documents)
		for (const t of new Set(tokenize(d ?? "")))
			df.set(t, (df.get(t) ?? 0) + 1)
	return df
}

/** Term frequencies in the recent window, which is what tf-idf scores against. */
export function buildTermFreq(text: string): Map<string, number> {
	const freq = new Map<string, number>()
	for (const t of tokenize(text)) freq.set(t, (freq.get(t) ?? 0) + 1)
	return freq
}

/**
 * How much this entry's vocabulary overlaps the **recent conversation**,
 * weighted by term rarity.
 *
 * The `tf` is the term's frequency in the guaranteed window, not in the entry.
 * That distinction is the whole signal: this asks "is the session talking about
 * this entry's subject right now", and an entry-internal frequency asks "is this
 * entry's own wording distinctive", which is a property of the entry alone and
 * says nothing about whether it belongs in this turn's prompt.
 *
 * The first version got that backwards and the parity corpus found it: twelve
 * near-identical lore entries scored *apart* because a token appearing only in
 * the entry ("10" in "Ashguard fact 10") moved its score, where the legacy
 * scorer gives it `tf = 0` — it is not in the conversation — and contributes
 * nothing. Ordering is user-visible, so the entries reached the model in the
 * wrong order.
 *
 * Iterates the entry's terms **with duplicates**, matching `:1622`: since `tf`
 * is fixed per term, a term written twice in an entry's keys counts twice.
 */
export function tfidfSignal(
	text: string,
	idf: Map<string, number>,
	windowFreq: Map<string, number>,
	windowSize: number
): number {
	if (!text) return 0
	const terms = tokenize(text)
	if (terms.length === 0) return 0

	const denominator = Math.max(windowSize, 1)
	let score = 0
	for (const t of terms)
		score += ((windowFreq.get(t) ?? 0) / denominator) * (idf.get(t) ?? 0)
	return score
}

// ── BM25, and field weighting ───────────────────────────────────────────────

/**
 * BM25's two constants, at the values the literature settles on.
 *
 * Constants and not knobs, for `TRIGRAM_MIN_COVERAGE`'s reason: the question a
 * user has is *should a long entry be able to win by being long*, which
 * `lexicalScoring` answers, and a term-saturation curve is a calibration
 * nobody can perform from a settings panel. They live here so a later
 * measurement pass has one place to move them.
 *
 * `k1` is how fast a repeated term stops adding — at 1.2 the fifth occurrence
 * is worth about a tenth of the first. `b` is how much length is normalised
 * away: 1 is fully, 0 is not at all, 0.75 is the usual compromise.
 *
 * ⚠ **`k1` saturates both halves of the score**, the conversation's term
 * frequency as well as the entry's — see `saturate` and `lexicalSignal`. Okapi
 * calls the query half's constant `k3` and the literature is content to let the
 * two differ, but nothing here has measured a reason to: they are the same
 * question asked of two texts, one constant is one thing to move when a
 * measurement pass finally does move it, and two constants would be a
 * calibration nobody has performed presented as one somebody did.
 */
export const BM25_K1 = 1.2
export const BM25_B = 0.75

/**
 * BM25's saturation curve: `f · (k1 + 1) / (f + k1 · norm)`.
 *
 * One function because there is one curve, and both halves of `lexicalSignal`
 * run through it — the entry's term frequency with the document-length `norm`,
 * the window's with `norm = 1`, since the query half's length is already
 * divided out by the window size. Two copies of a saturation agree right up
 * until the day one of them is edited, which is `buildDocFreq`'s argument about
 * document frequency arriving at the same answer from the other direction.
 *
 * ⚠ **`f = 1` is a fixed point at every `k1` when `norm` is 1**: `1 · (k1 + 1)
 * / (1 + k1)` is exactly 1. So saturating the query half leaves every term the
 * conversation says *once* worth precisely what it was worth before, and only
 * compresses repetition. That is the property that makes this a damping of
 * `the` rather than a re-scaling of everything.
 */
const saturate = (f: number, k1: number, norm: number): number =>
	(f * (k1 + 1)) / (f + k1 * norm)

/**
 * BM25's own idf — `log((N − df + 0.5) / (df + 0.5) + 1)`.
 *
 * ⚠ **Not interchangeable with `buildIdf`, and that is the point of it
 * existing.** The saturated reading used to be handed the plain tf-idf weight
 * `log(N / (1 + df))`, which works and is directionally right, and which
 * guarantees that the next person to compare this file against the literature
 * loses an afternoon to why a function called BM25 does not behave the way BM25
 * is documented to. The idf is not a detachable weighting choice sitting beside
 * the saturation curve — it is half of the algorithm, and the properties it has
 * are the reason BM25 was adopted here at all.
 *
 * ⚠ **Non-negative by construction, so it needs no floor and must not be
 * given one.** `df ≤ N` makes `(N − df + 0.5) / (df + 0.5)` non-negative, so the
 * `+ 1` puts the logarithm's argument at or above 1 and the result at or above
 * zero. It is in fact *strictly* positive: the argument reaches 1 only at
 * `df = N + 0.5`, which no term can have. A `Math.max(0, …)` here would be dead
 * code that reads like a live clamp, and the day somebody changes a constant it
 * would silently flatten the curve's bottom end instead of failing loudly.
 * `buildIdf`'s floor is a different situation entirely — the unsmoothed ratio
 * there really does go negative at `df = N`, and the floor is the fix.
 *
 * The half-counts are the same smoothing `rarity` in `ranking/entities.ts`
 * borrows, for the same reason, arrived at from the other direction.
 *
 * ## The collection is the entry pool
 *
 * **`N` is how many entries are being searched and `df` is how many of them
 * contain the term** — not messages, which is what this read when it was first
 * wired and what `buildIdf` still reads. Three things say pool and nothing says
 * messages:
 *
 *   · it is the construction — BM25's idf is taken over *the collection being
 *     searched*, and the collection being searched here is the lorebook;
 *   · the other half of the same formula already does it. `lexicalSignal`
 *     reads an entry as the document and normalises its length against the
 *     **pool's** mean (`LexicalOptions.averageLength`), so with rarity over
 *     messages the two halves of one score disagreed about what a document is;
 *   · it is measured. The admission gate took the pool reading for the reason
 *     `buildDocFreq` records: over messages, on a short session almost every
 *     word looks rare, and a pewterers'-guild entry scored as much shared
 *     vocabulary as the faction the scene was actually about.
 *
 * ⚠ **This is a change to which entries win, not to the shape of a curve**, and
 * a green suite is not evidence about it. `measure/rankingCorpus.test.ts` is —
 * `POOL_VOCABULARY` is the world built to observe the collection, and the note
 * on `UBIQUITOUS` says what that older world can and cannot see now. That file
 * also carries what the move cost and what settled it: a document of
 * `keys + title` is too short for a stopword to be ubiquitous in the pool the
 * way it is in a conversation, so for a while `the` in a title was worth more
 * than eight content keys. The ruling was to damp the **query** half — see
 * `lexicalSignal` — and not to widen this function's collection or its
 * documents, which is the one repair that would have undone the move above.
 *
 * ⚠ **The documents have to be the documents the reading scores**, and the
 * caller is what pairs them: `keywordQuery` builds each entry's
 * `LexicalDocument` from `keys + title` and hands the same text here. Handing
 * this a wider text than the scorer reads would weight terms by a rarity
 * measured over a collection that is not the one being scored, which is the
 * defect this function just came out of, in a subtler form.
 *
 * `buildIdf` keeps its own inline walk rather than sharing `buildDocFreq`: it
 * is parity-pinned over the *other* collection and takes message rows rather
 * than texts, so unifying it would be a change to the shipped path in a comment
 * about BM25.
 */
export function buildBm25Idf(
	/** The pool being searched, one string per entry — see the pairing warning. */
	documents: ReadonlyArray<string | null | undefined>
): Map<string, number> {
	const df = buildDocFreq(documents)
	const idf = new Map<string, number>()
	const n = documents.length
	for (const [term, count] of df)
		idf.set(term, Math.log((n - count + 0.5) / (count + 0.5) + 1))
	return idf
}

/**
 * What an entry contributes as a *document*, split by field.
 *
 * Two fields and not one string, because a match in an entry's title is
 * stronger evidence than the same word among its keys and today they are
 * concatenated into one bag where neither can outrank the other.
 */
export interface LexicalFields {
	/** The entry's name. Weighted by `titleWeight`. */
	title: string
	/** The entry's keys — the author's own index. Always weight 1. */
	keys: string
}

export interface LexicalOptions {
	/**
	 * How much a term in the title counts against the same term in the keys.
	 *
	 * 1 is neutral **and is arithmetically identical to today**: the score is a
	 * sum over the entry's terms, and splitting `keys + " " + title` at a
	 * space cannot merge or split a token, so summing the two halves is the
	 * same number as summing the whole.
	 */
	titleWeight: number
	/**
	 * BM25's saturation, or `null` for the unsaturated sum.
	 *
	 * `null` is today: every occurrence of a term counts its full weight again,
	 * on **both** sides — an entry wins by repeating a word and by being long
	 * enough to have room to, and a word the conversation cannot stop saying
	 * multiplies whatever it lands on. Passing `BM25_K1` turns all three of
	 * those off — which is the change, and why it is a switch rather than an
	 * edit.
	 */
	saturation: number | null
	/** BM25's length normalisation. Ignored when `saturation` is null. */
	lengthNorm: number
	/**
	 * Mean weighted document length over the **entry pool**, for the length
	 * normalisation to be relative to.
	 *
	 * The pool and not the corpus of messages: BM25 asks whether this document
	 * is long *for a document*, and the documents here are lorebook entries,
	 * whose lengths are the thing design phase 1 says vary wildly.
	 */
	averageLength: number
}

/** The unsaturated, unweighted reading — exactly what `tfidfSignal` does. */
export const LEXICAL_OVERLAP: LexicalOptions = {
	titleWeight: 1,
	saturation: null,
	lengthNorm: 0,
	averageLength: 1
}

/**
 * Is this the shipped reading, where `tfidfSignal` itself is still the answer?
 *
 * `lexicalSignal` reproduces `tfidfSignal` *term for term* under these options,
 * but not *float for float*: one sums a term's weight once per occurrence in
 * token order and the other multiplies by the count in first-occurrence order,
 * and IEEE addition is not associative. The difference is in the last bits and
 * could still flip two candidates that tie to fifteen decimal places, so the
 * caller keeps calling the original function while nobody has moved anything —
 * the same promise `scoreLedAllocation` makes, that with the switch off every
 * branch runs exactly the code it ran before the switch existed.
 */
export const isDefaultLexical = (opts: LexicalOptions): boolean =>
	opts.saturation == null && opts.titleWeight === 1

/**
 * The weighted term frequencies of one entry, and its weighted length.
 *
 * Separated from the scoring below because the pool's average length has to be
 * known before any entry can be scored, and the only way to know it is to have
 * measured every entry — so the caller builds these once and scores from them.
 */
export interface LexicalDocument {
	freq: Map<string, number>
	length: number
}

export function lexicalDocument(
	fields: LexicalFields,
	titleWeight: number
): LexicalDocument {
	const freq = new Map<string, number>()
	let length = 0
	const add = (text: string, weight: number) => {
		for (const t of tokenize(text)) {
			freq.set(t, (freq.get(t) ?? 0) + weight)
			length += weight
		}
	}
	add(fields.keys, 1)
	add(fields.title, titleWeight)
	return { freq, length }
}

/**
 * How much this entry's vocabulary overlaps the recent conversation — the same
 * question `tfidfSignal` asks, with the entry read as a document rather than as
 * a list.
 *
 * **Both halves saturate, and they saturate on the same curve.** A term is
 * worth `qtf' / window size × its idf × f'`, where `qtf'` and `f'` are its
 * frequency in the guaranteed window and in the entry, each run through
 * `saturate`:
 *
 *     f · (k1 + 1) / (f + k1 · (1 − b + b · |D| / avgdl))     the document half
 *     qtf · (k1 + 1) / (qtf + k1)                             the query half
 *
 * The document half is what `tfidfSignal` gets wrong first: it multiplies by
 * the raw count of the term in the entry, so twelve near-identical entries are
 * ordered by how many times each happened to repeat itself and a long entry
 * outscores a precise one for having more words. **With `saturation: null` the
 * document half is `f` exactly and the query half is `qtf` exactly**, so
 * `LEXICAL_OVERLAP` reproduces `tfidfSignal` term for term — which is what lets
 * the switch ship off and the parity corpus keep measuring the shipped path.
 *
 * ⚠ **The query half's saturation is Okapi's `k3` term, and it is here for a
 * measured reason rather than for completeness.** Multiplying by the raw
 * conversational count is the non-standard extension, and it is what let a
 * stopword run away with the score once BM25's idf moved to the entry pool:
 * `the` said 21 times over a ten-message window arrived with a query weight of
 * 2.1, where a content word said once arrives with 0.1, and a lexical document
 * of `keys + title` is short enough that the pool cannot make `the` cheap the
 * way a conversation does. Saturated, those 21 occurrences are worth 2.08 of a
 * single one instead of 21. Measured on `CONTENDED` in
 * `measure/rankingCorpus.test.ts`, which is where the before and after are
 * written down.
 *
 * ⚠ **Not a stopword list, and deliberately not.** This is arithmetic over
 * whatever the tokenizer produced, so it needs no language asset, is not gated
 * on a language setting, and behaves the same in a language whose stopwords we
 * do not have — and where `tokenize`'s whitespace split does not even apply. A
 * stopword list stays available as a later, language-gated refinement if
 * measurement still shows a problem; it is not the first move.
 *
 * ⚠ **The `idf` map has to match the reading**, and the caller is what pairs
 * them: `buildIdf` when `saturation` is null, because that branch *is*
 * `tfidfSignal` and must stay float-for-float comparable with it, and
 * `buildBm25Idf` when it is not, because the other branch is BM25 and BM25's
 * idf is part of BM25. Taking one map rather than two keeps the pairing in one
 * place instead of making every call site able to get it half right.
 */
export function lexicalSignal(
	doc: LexicalDocument,
	/** Per-term rarity — see the pairing warning above. */
	idf: Map<string, number>,
	windowFreq: Map<string, number>,
	windowSize: number,
	opts: LexicalOptions
): number {
	if (doc.freq.size === 0) return 0

	const denominator = Math.max(windowSize, 1)
	const avg = Math.max(opts.averageLength, 1)
	let score = 0
	for (const [term, f] of doc.freq) {
		const wf = windowFreq.get(term) ?? 0
		if (wf === 0) continue
		const rarity = idf.get(term) ?? 0
		if (opts.saturation == null) {
			// Written as one expression rather than through the saturated
			// branch below: this branch *is* `tfidfSignal` and has to stay
			// comparable with it — see `isDefaultLexical`.
			score += (wf / denominator) * rarity * f
			continue
		}
		const k1 = opts.saturation
		const norm = 1 - opts.lengthNorm + (opts.lengthNorm * doc.length) / avg
		score +=
			(saturate(wf, k1, 1) / denominator) * rarity * saturate(f, k1, norm)
	}
	return score
}

// ── Recency and shape ───────────────────────────────────────────────────────

/**
 * How recently this entry was last referenced anywhere in the session.
 *
 * `exp(-0.01 · (total - lastIndex))` — a slow decay, so an entry mentioned 50
 * messages ago still scores ~0.6. That is deliberate in the original and worth
 * preserving: a lorebook entry does not stop being relevant because the topic
 * moved on for a page.
 */
export function lastRefRecencySignal(
	lastIndex: number | undefined,
	totalMessages: number
): number {
	if (lastIndex == null) return 0
	return Math.exp(-0.01 * (totalMessages - lastIndex))
}

/**
 * ⚠ **`positionRecencySignal` was here and is gone with the weight it fed.**
 *
 * `index / (length - 1)` over an ordered list — a *message* measure, for the
 * `messages` band the shipped pipeline never populates. It had no caller, the
 * `recency` weight it would have produced had no producer, and
 * `core:task/rank-hybrid@1` declared `signalRecency` over both. Three halves of
 * one feature, none of them joined up. See `SignalWeights` in `weights.ts` for
 * why the answer was removal rather than wiring, and
 * `runtime/signalWiring.test.ts` for the guard that keeps the three ends tied.
 */

/**
 * Length relative to the average, capped at 1.
 *
 * The cap is the design and not a guard: this discriminates *below* the mean
 * and saturates above it, so a pool of evenly sized entries scores a flat 1 and
 * orders nothing, while a pool that mixes stubs with articles pushes the stubs
 * down. Called by `keywordQuery`'s `scoreSignals` on every candidate — which it
 * was not, for as long as `SignalWeights.density` had nothing to weigh.
 */
export const densitySignal = (length: number, averageLength: number): number =>
	Math.min(1, length / Math.max(averageLength, 1))

/**
 * Where each entry was last referenced, scanning **all** messages.
 *
 * Deliberately not limited by `scanDepth`: the scan window decides what
 * *triggers* an entry, and this decides how recently it *mattered*. Limiting
 * both to the same window would make the signal constant for everything the
 * window contains, which is the same as removing it.
 */
export function buildLastRefMap(
	messages: ReadonlyArray<{ content?: string | null }>,
	entries: ReadonlyArray<KeyedEntry & { id: number }>,
	/** The scan's time for regex keys, when this is part of one. */
	patterns: PatternBudget = patternBudget()
): Map<number, number> {
	const out = new Map<number, number>()
	const withKeys = entries.filter((e) => splitKeys(e.keys).length > 0)

	const windows: ScanWindow[] = messages.map((m) => ({
		raw: m.content ?? "",
		lower: (m.content ?? "").toLowerCase()
	}))
	// Every regex key against every message in ONE bounded batch: a window
	// per message would start a watchdog per message (see boundedPattern.ts).
	primePatterns(windows, patternRequestsOf(withKeys, "keys"), patterns)

	for (let i = 0; i < messages.length; i++) {
		const window = windows[i]!
		for (const entry of withKeys)
			for (const key of splitKeys(entry.keys))
				if (matchesKey(key, entry, window)) {
					// Later index wins — the map records the *last* reference.
					out.set(entry.id, i)
					break
				}
	}
	return out
}
