/**
 * `core:task/card-strokes@1`'s work, as a pure function over the cast and the
 * transcript (DESIGN-card-strokes A.4).
 *
 * Each card painted in strokes gets every stroke stamped `fired` — `always`
 * true, `off` false, a keyword stroke whatever the lore keyword matcher says
 * about the last `scanDepth` messages. `compileCharacter` then compiles only
 * the `always` + fired ones and hands the pieces to a template.
 *
 * ⚠ **The lore matcher, not a copy of it** (R5: one matcher at the seam, two
 * vocabularies). A stroke's `when` is read as a `KeyedEntry` — `matchMode`
 * and `caseSensitive` mean what they mean on a lorebook entry — and goes
 * through `buildScanWindow`, `matchesKey` and the bounded regex runner
 * (`boundedPattern.ts`) exactly as a lore key does: a runaway or tripped
 * pattern does not match, an invalid one falls back to substring.
 *
 * Never ranks, never budgets, never selects: strokes are not retrieval
 * candidates and never compete with lore for room.
 */

import { resolveStrokes, type Stroke, type StrokeKeywordsWhen } from "@serene-pub/sdk"
import {
	buildScanWindow,
	matchesKey,
	patternRequestsOf,
	splitKeys,
	type KeyedEntry,
	type ScanWindow
} from "$lib/server/pipelines/ranking/signals"
import {
	patternBudget,
	primePatterns
} from "$lib/server/pipelines/ranking/boundedPattern"

/** The node's declared default (`params.scanDepth`). */
export const CARD_STROKES_SCAN_DEPTH = 10

/** A stroke's keyword condition, as the lore matcher reads an entry. */
export const keyedEntryOf = (when: StrokeKeywordsWhen): KeyedEntry => ({
	keys: Array.isArray(when.keys) ? when.keys : [],
	matchMode: when.matchMode ?? "substring",
	caseSensitive: when.caseSensitive === true
})

/** Does any of a keyword stroke's keys appear in the window? */
export const strokeMatcher =
	(window: ScanWindow) =>
	(when: StrokeKeywordsWhen): boolean => {
		const entry = keyedEntryOf(when)
		return splitKeys(entry.keys).some((key) => matchesKey(key, entry, window))
	}

const strokesOf = (character: unknown): Stroke[] | null => {
	const strokes = (character as { strokes?: unknown } | null)?.strokes
	return Array.isArray(strokes) && strokes.length ? (strokes as Stroke[]) : null
}

type Seat = { character?: unknown } & Record<string, unknown>

/**
 * The cast with every stroked card's `strokes` resolved.
 *
 * A cast with no stroked card comes back as the same object — no window is
 * built and nothing is copied. Otherwise a shallow copy: the seats and the
 * characters that carry strokes are new objects, everything else is shared.
 */
export function resolveCastStrokes<T>(
	cast: T,
	messages: ReadonlyArray<{ content?: string | null; id?: number | null }> | null | undefined,
	scanDepth: number = CARD_STROKES_SCAN_DEPTH
): T {
	const seats = (cast as { sessionCharacters?: unknown } | null)?.sessionCharacters
	if (!Array.isArray(seats)) return cast
	if (!seats.some((seat: Seat) => strokesOf(seat?.character))) return cast

	const depth =
		Number.isInteger(scanDepth) && scanDepth >= 1 ? scanDepth : CARD_STROKES_SCAN_DEPTH
	const window = buildScanWindow(Array.isArray(messages) ? messages : [], depth)

	// Every regex key of every stroked card in ONE bounded batch, as a lore
	// scan primes its pass: a watchdog per key would cost more than matching.
	const keyed: KeyedEntry[] = []
	for (const seat of seats as Seat[])
		for (const s of strokesOf(seat?.character) ?? [])
			if (s?.when?.mode === "keywords") keyed.push(keyedEntryOf(s.when))
	primePatterns([window], patternRequestsOf(keyed, "keys"), patternBudget())

	const matcher = strokeMatcher(window)
	return {
		...(cast as object),
		sessionCharacters: (seats as Seat[]).map((seat) => {
			const strokes = strokesOf(seat?.character)
			if (!strokes) return seat
			return {
				...seat,
				character: {
					...(seat.character as object),
					strokes: resolveStrokes(strokes, matcher)
				}
			}
		})
	} as T
}
