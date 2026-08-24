/**
 * The scoring signals, as pure functions over explicit arguments.
 *
 * Lifted from `KeywordInfillEngine` unchanged in behaviour and changed in
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

export interface KeyedEntry {
	keys?: string | null
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
}

/** The window a key is matched against, in both cases so neither is recomputed. */
export interface ScanWindow {
	raw: string
	lower: string
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
	messages: ReadonlyArray<{ content?: string | null }>,
	scanDepth: number
): ScanWindow {
	const slice =
		scanDepth >= messages.length ? messages : messages.slice(-scanDepth)
	const raw = slice.map((m) => m.content ?? "").join(" ")
	return { raw, lower: raw.toLowerCase() }
}

/** Comma-split, trimmed, empties dropped. `:1569`. */
export const splitKeys = (keys?: string | null): string[] =>
	(keys ?? "")
		.split(",")
		.map((k) => k.trim())
		.filter((k) => k.length > 0)

const MODES: readonly MatchMode[] = ["substring", "word", "regex"]

const modeOf = (entry: KeyedEntry): MatchMode => {
	if (entry.matchMode && MODES.includes(entry.matchMode as MatchMode))
		return entry.matchMode as MatchMode
	return entry.useRegex ? "regex" : "substring"
}

/**
 * Does one key match the window?
 *
 * `word` is the new mode and the only one that is not current behaviour. It
 * uses a boundary assertion around an escaped key rather than a token set, so
 * it works for multi-word keys ("the Ashguard") which a token comparison would
 * miss.
 */
export function matchesKey(
	key: string,
	entry: KeyedEntry,
	window: ScanWindow
): boolean {
	const sensitive = !!entry.caseSensitive
	const text = sensitive ? window.raw : window.lower
	const k = sensitive ? key : key.toLowerCase()

	switch (modeOf(entry)) {
		case "regex":
			try {
				return new RegExp(k).test(text)
			} catch {
				// Silent fallback, preserved from `:1583`. A user with a broken
				// regex gets substring behaviour rather than an entry that never
				// fires — changing this to an error is a diagnostics improvement
				// for after parity, not a scoring change.
				return text.includes(k)
			}
		case "word": {
			const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
			return new RegExp(
				`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
				"u"
			).test(text)
		}
		default:
			return text.includes(k)
	}
}

/** Fraction of an entry's keys present in the window. `:1559`. */
export function keywordSignal(entry: KeyedEntry, window: ScanWindow): number {
	const keys = splitKeys(entry.keys)
	if (keys.length === 0) return 0
	let matched = 0
	for (const key of keys) if (matchesKey(key, entry, window)) matched++
	return matched / keys.length
}

/** 1 when the entry's name appears in the window, lowercased. */
export const nameMatchSignal = (
	name: string | null | undefined,
	window: ScanWindow
): number => (name && window.lower.includes(name.toLowerCase()) ? 1 : 0)

/**
 * 1 when any known entity name appears in the entry's own name-plus-keys.
 *
 * Note the direction: this asks whether the *entry* mentions a character, not
 * whether the conversation does. An entry about "Kaelen's sword" co-occurs with
 * Kaelen even in a scene where nobody says his name.
 */
export function entityCooccurrenceSignal(
	entryName: string | null | undefined,
	entryKeys: string | null | undefined,
	entityNames: ReadonlyArray<string | null | undefined>
): number {
	const haystack = `${entryName ?? ""} ${entryKeys ?? ""}`.toLowerCase()
	for (const n of entityNames)
		if (n && haystack.includes(n.toLowerCase())) return 1
	return 0
}

// ── TF-IDF ──────────────────────────────────────────────────────────────────

/** Lowercase, split on non-word, drop single characters. `:1437`. */
export const tokenize = (text: string): string[] =>
	text
		.toLowerCase()
		.split(/\W+/)
		.filter((t) => t.length > 1)

/** Per-term IDF over messages as documents: `log(N / (1 + df))`. `:1456`. */
export function buildIdf(
	messages: ReadonlyArray<{ content?: string | null }>
): Map<string, number> {
	const df = new Map<string, number>()
	for (const m of messages)
		for (const t of new Set(tokenize(m.content ?? "")))
			df.set(t, (df.get(t) ?? 0) + 1)

	const idf = new Map<string, number>()
	const n = messages.length
	for (const [term, count] of df) idf.set(term, Math.log(n / (1 + count)))
	return idf
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

/** Position in the ordered list, 0 for oldest and 1 for newest. */
export const positionRecencySignal = (index: number, length: number): number =>
	length <= 1 ? 1 : index / (length - 1)

/** Length relative to the average, capped at 1. */
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
	entries: ReadonlyArray<KeyedEntry & { id: number }>
): Map<number, number> {
	const out = new Map<number, number>()
	const withKeys = entries.filter((e) => splitKeys(e.keys).length > 0)

	for (let i = 0; i < messages.length; i++) {
		const window: ScanWindow = {
			raw: messages[i]!.content ?? "",
			lower: (messages[i]!.content ?? "").toLowerCase()
		}
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
