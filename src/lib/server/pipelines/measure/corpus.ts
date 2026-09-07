/**
 * The discriminating ranking corpus — shared scaffolding.
 *
 * Not a test file (no `*.test.ts` suffix), so vitest's `include` never picks it
 * up as a suite of its own. `rankingCorpus.test.ts` is what runs.
 *
 * ## What this corpus is, and what it is emphatically not
 *
 * It is **not parity**. Nothing here compares against legacy 0.5, nothing here
 * has a golden, and nothing here may ever grow one — a fixture in
 * `pipelines/parity/` asserts that 0.6 emits the bytes 0.5 emitted, and a
 * fixture here asserts that **a control has an effect, and that the effect has
 * the right shape**. Confusing the two would be expensive in both directions:
 * a parity golden that moves when a weight moves stops being a record of 0.5,
 * and a discrimination fixture that is frozen stops being able to observe
 * anything. They are sited in different directories for that reason.
 *
 * ## Why it exists (design §10, §10.1)
 *
 * Measured, by the lane that ran the check: **with every lore signal weight set
 * to 0, all eleven parity gate fixtures stay byte-identical.** So does zeroing
 * the three mechanism strengths. The entire ranking layer is therefore
 * unguarded — a green parity gate is evidence about the *template*, the block
 * order and the JSON shape, and evidence about nothing whatsoever concerning
 * how a lore entry is ranked.
 *
 * The rule that produced that finding is this corpus's acceptance criterion:
 * **a green suite is evidence only if the thing under test can move it.** Every
 * fixture below therefore ships with its own perturbation, in the same `it`,
 * asserting that the output moved.
 *
 * ## The four structural traps a fixture here has to be designed around
 *
 * Each was measured on the existing corpus and each is why "just add a fixture"
 * would have produced another blind one:
 *
 * 1. **`normaliseTfidf` divides the pool by its own maximum**, so any change
 *    that scales every candidate equally is *mathematically* invisible. A
 *    fixture needs entries whose tf-idf differs from each other, not entries
 *    that are uniformly high. `the vocabulary is what moves it` holds both
 *    halves of that: a world that discriminates, and a control world that
 *    cannot, asserted to be blind on purpose.
 * 2. **Every lore entry in every parity fixture has exactly one key**, so
 *    `proximity` — the distance between two matched keys — is structurally
 *    zero everywhere. `keywordMatch` returns 0 for fewer than two exact hits.
 *    Multi-key entries are a precondition, not a nicety.
 * 3. **Nothing contends.** Each parity fixture's lore fits inside its band, so
 *    ordering never decides membership and every ordering change is invisible
 *    in the rendered prompt. `THE CONTENDED WORLD` is deliberately sized so the
 *    budget admits three of eight.
 * 4. **Cast names were chosen independently of lore vocabulary**, so the entity
 *    signals scored 0 on every fixture. The worlds here draw their cast from
 *    their own lore vocabulary.
 *
 * ## The level it runs at
 *
 * `keywordQuery` → `normaliseTfidf` → `select`, which is exactly what
 * `core:task/rank-hybrid@1` does with the lore gather branches' output
 * (`bindings.ts`: `rank-hybrid` calls `normaliseTfidf(toBudgetGroups(...))`
 * then `select`). Running the three directly rather than through a spec keeps a
 * fixture readable and keeps a failure attributable to the ranker rather than
 * to a template, a config layer or a database. The semantic mechanism cannot be
 * measured this way — it needs the shipped spec and an embedding model — so it
 * has its own integration file, `semanticCorpus.int.test.ts`.
 */

import {
	keywordQuery,
	normaliseTfidf,
	type LoreRow,
	type MessageRow
} from "$lib/server/pipelines/ranking/keywordQuery"
import {
	select,
	type Candidate,
	type Selection
} from "$lib/server/pipelines/ranking/select"
import {
	DEFAULT_RETRIEVAL,
	DEFAULT_SIGNAL_WEIGHTS,
	withDefaults,
	type RankingParams,
	type RetrievalParams,
	type SignalWeights,
	type RetrievalBand
} from "$lib/server/pipelines/ranking/weights"
import type { GazetteerName } from "$lib/server/pipelines/ranking/entities"

/**
 * The same rough counter every other suite here uses, and the same one the
 * parity harness passes to `checkParity`. Four characters to a token is wrong
 * in the way every estimate is wrong and right in the way a fixture needs: it
 * is a pure function of the string, so an entry's cost is a property of the
 * fixture rather than of whichever tokenizer happened to be loaded.
 */
export const countTokens = (text: string): number => Math.ceil(text.length / 4)

/** One entry as a fixture states it — the mechanism's row shape, minus its defaults. */
export interface CorpusEntry {
	id: number
	name: string
	content: string
	keys?: string
	source?: RetrievalBand
	position?: number
	priority?: number
	matchMode?: string | null
	constant?: boolean | null
	bindingCharacterId?: number | null
}

/** A whole small world: a lorebook, a conversation, and who is in the room. */
export interface CorpusWorld {
	/** What this world exists to let a fixture observe. */
	about: string
	entries: CorpusEntry[]
	messages: MessageRow[]
	/** The session cast, as the gazetteer's first tier. */
	cast?: GazetteerName[]
}

/**
 * Everything a fixture may vary, in one object.
 *
 * Deliberately the *whole* shape rather than the three or four controls the
 * corpus happens to move today: a fixture added later must be able to reach
 * any parameter without this file changing, or the corpus acquires an implicit
 * ceiling on what it can observe — which is the shape of the blind spot it
 * exists to close.
 */
export interface Dial {
	/** `RetrievalParams` — how far to look, how to match, what admits. */
	retrieval?: Partial<RetrievalParams>
	/**
	 * Signal weights for one source, completed from the shipped set.
	 *
	 * ⚠ Completed, and it has to be: `withDefaults` does **not** deep-merge
	 * `signals`, because a partial set would silently inherit weights the caller
	 * thought they had replaced. Passing `{proximity: 0.3}` straight through
	 * yields `NaN` for every other signal and a corpus that reports every
	 * candidate as tied. Found by doing it.
	 */
	signals?: Partial<Record<RetrievalBand, Partial<SignalWeights>>>
	/** The three mechanism strengths. 1 is neutral, 0 switches one off. */
	mechanisms?: { keyword?: number; semantic?: number; name?: number }
	/** Token budget for the whole context, before the share bands split it. */
	budget?: number
	/** Design §7's inversion: score allocates, floors guarantee, shares cap. */
	scoreLedAllocation?: boolean
}

/** The shipped defaults, which every fixture's baseline runs at. */
export const SHIPPED: Dial = {}

const rankingFrom = (dial: Dial): RankingParams =>
	withDefaults({
		mechanisms: dial.mechanisms,
		...(dial.signals
			? {
					signals: Object.fromEntries(
						(
							Object.keys(DEFAULT_SIGNAL_WEIGHTS) as RetrievalBand[]
						).map((source) => [
							source,
							{
								...DEFAULT_SIGNAL_WEIGHTS[source],
								...(dial.signals?.[source] ?? {})
							}
						])
					) as Record<RetrievalBand, SignalWeights>
				}
			: {})
	})

/**
 * A default large enough that nothing contends unless a fixture says so.
 *
 * Sized rather than infinite so a fixture that *means* to contend has to say a
 * number, and one that does not is never accidentally measuring the budget.
 */
const UNCONTENDED = 100_000

export interface CorpusRun {
	/** What the mechanism found, admitted and measured. */
	candidates: Candidate[]
	/** What it declined, and why — the receipt half. */
	skipped: ReturnType<typeof keywordQuery>["skipped"]
	diagnostics: ReturnType<typeof keywordQuery>["diagnostics"]
	/** What fit, in the order it reached the prompt. */
	selection: Selection
	/** Included entry ids, in prompt order. The corpus's usual assertion. */
	order: number[]
	/** Included entry ids, sorted — membership without ordering. */
	admitted: number[]
	/** One candidate's signals, by entry id. */
	signalsOf(id: number): Candidate["signals"]
	/** One candidate's final score, by entry id. Null when it never competed. */
	scoreOf(id: number): number | null
}

/**
 * Run one world through the ranker at one dial setting.
 *
 * The three stages in the order `core:task/rank-hybrid@1` runs them, and no
 * others: a fixture that ran a fourth would be measuring something the shipped
 * path does not do.
 */
export function runWorld(world: CorpusWorld, dial: Dial = {}): CorpusRun {
	const entries: LoreRow[] = world.entries.map((entry, index) => ({
		source: "worldLore",
		keys: "",
		position: index,
		...entry
	}))

	// No embedding model in this file, ever. The lexical stack is the half that
	// must work on a potato (design §11), and a corpus that quietly needed a
	// model would stop measuring the path most installs are on. Since migration
	// 0204 the mechanism cannot know either way — there is no availability input and
	// no per-entry strategy to route on.
	const result = keywordQuery({
		entries,
		messages: world.messages,
		entityRefs: world.cast ?? [],
		retrieval: { ...DEFAULT_RETRIEVAL, ...(dial.retrieval ?? {}) },
		countTokens
	})

	const params = rankingFrom(dial)
	const selection = select(normaliseTfidf(result.candidates), {
		availableTokens: dial.budget ?? UNCONTENDED,
		params,
		scoreLedAllocation: dial.scoreLedAllocation
	})

	const decisionOf = (id: number) =>
		[...selection.included, ...selection.excluded].find(
			(d) => d.candidate.id === id
		) ?? null

	return {
		candidates: result.candidates,
		skipped: result.skipped,
		diagnostics: result.diagnostics,
		selection,
		order: selection.included.map((d) => d.candidate.id as number),
		admitted: selection.included
			.map((d) => d.candidate.id as number)
			.sort((a, b) => a - b),
		signalsOf: (id) => decisionOf(id)?.candidate.signals ?? {},
		scoreOf: (id) => decisionOf(id)?.score ?? null
	}
}

/** Entry ids the mechanism turned away, with the class of refusal it recorded. */
export const missed = (run: CorpusRun): number[] =>
	run.skipped.filter((s) => (s.kind ?? "missed") === "missed").map((s) => s.id)

/**
 * Every signal weight in one source set to zero.
 *
 * The blunt measurement, in the shape the parity lane ran it: this is the exact
 * perturbation under which all eleven gate fixtures stay byte-identical. A
 * fixture here that also fails to move under it is blind in precisely the way
 * this corpus exists to stop.
 */
export const noSignals = (
	source: RetrievalBand = "worldLore"
): Dial["signals"] => ({
	[source]: Object.fromEntries(
		Object.keys(DEFAULT_SIGNAL_WEIGHTS[source]).map((k) => [k, 0])
	) as Partial<SignalWeights>
})
