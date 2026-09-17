/**
 * Scoring and selection — the pure half of what the infill engines do between
 * retrieval and rendering.
 *
 * Two functions, and the split matters: `score` turns signals into a number,
 * `select` turns numbers into a list that fits. Today they are interleaved
 * inside one 900-line pass, which is why "why was this dropped" is currently
 * answerable only by reading the code.
 *
 * Three deliberate differences from the engine, each with a consequence:
 *
 * **1. Candidates are counted once, up front.** The engine re-renders the whole
 * context after every push (`:746`), so a candidate's cost includes the
 * template's separator overhead in situ. Counting standalone is O(n) instead of
 * O(n²) async calls, and differs by a few tokens per entry — which is why
 * parity is measured on the rendered prompt and never on token counts
 * (docs-dev/DECOMPOSITION.md §5).
 *
 * **2. Each group fills from its own budget.** The engine fills messages
 * against `messageTarget`, then lore against `threshold`, so lore competes for
 * whatever messages left behind. With per-group allocation no group can be
 * starved by another finishing first, and the arithmetic is statable in the
 * receipt.
 *
 * **3. No early break, preserved.** A candidate that does not fit does not stop
 * the loop — a later, cheaper one still can. That is current behaviour and it
 * is right: stopping at the first miss would silently drop small high-value
 * entries because one large one happened to sort above them.
 *
 * ── Two allocation precedences ──────────────────────────────────────────────
 *
 * Note 2 above describes **share-first** allocation, which is what ships: the
 * shares split the budget into fixed bands, and candidates fill within their
 * own band. `SelectOptions.scoreLedAllocation` inverts that precedence to the
 * one design §7 argues for — *score allocates, minimums guarantee, shares cap* —
 * and it is **off by default** so the parity corpus measures the shipped path
 * unchanged.
 *
 * The pins and the minimums are identical either way; only the scored fill and
 * what the sweep is offered differ. See `select`.
 */

import type {
	BandKey,
	MechanismWeights,
	RankingParams,
	ShareNormalisation,
	SignalWeights
} from "$lib/server/pipelines/ranking/weights"
import {
	allocateBudgets,
	DEFAULT_MECHANISMS,
	signalsForBand
} from "$lib/server/pipelines/ranking/weights"
import type { BandPriority } from "@serene-pub/sdk"

/** The signal values for one candidate. Missing signals are zero, not absent. */
export interface Signals {
	keyword?: number
	nameMatch?: number
	entityCooccurrence?: number
	tfidf?: number
	lastRefRecency?: number
	/**
	 * ⚠ **`recency` and `sceneAffinity` were here and are gone.** Nothing has
	 * ever written either, on any path — see `SignalWeights` in `weights.ts`
	 * for why they were removed rather than given producers, and
	 * `runtime/signalWiring.test.ts` for the guard that stops the pair coming
	 * back undetected.
	 */
	/** How long the entry is against the pool average. See `SignalWeights`. */
	density?: number
	/** How tightly the entry's matched keys clustered. See `SignalWeights`. */
	proximity?: number
	/**
	 * Cosine similarity to what the scene is saying, from the semantic mechanism.
	 *
	 * ⚠ **A signal and not a `presetScore`, and that is the whole shape of the
	 * mechanism.** `core:query/vector-search@1` used to stamp its raw cosine on
	 * `presetScore`, which `scoreOf` below prefers over the weighted sum — so an
	 * mechanism wired straight into the ranker replaced every signal weight with a
	 * number from one mechanism. Delivered here instead, a semantic hit *adds*
	 * to whatever else found the entry, which is what lets two mechanisms
	 * agreeing count for more than either alone without a fusion step.
	 */
	semantic?: number
	/**
	 * How well a **description** the scene used matches one of this entry's
	 * **names**, from the entity-vector mechanism.
	 *
	 * *"The captain"* against *"Captain Vell"*. A different question from
	 * `semantic`, which asks whether the entry is *about* what is being said,
	 * and from `nameMatch`, which asks whether the entry's own title occurs
	 * literally — this one is the reference that shares no characters with its
	 * target, which is the class the whole lexical stack is structurally unable
	 * to see.
	 *
	 * ⚠ **A signal, and the mechanism may only ever attach it to a candidate some
	 * other mechanism already produced.** A vector comparison over invented
	 * proper nouns can be confidently wrong — phonetically similar invented
	 * names cluster in subword space — and a confident wrong link that could
	 * *admit* would inject wrong lore at high confidence into a fixed budget.
	 * Constrained to reordering, the same wrong link costs a position and a
	 * visible line in the receipt. That constraint lives in the wiring, where it
	 * cannot be lost to a refactor of this file.
	 */
	entityVector?: number
}

export interface Candidate {
	id: number | string
	/** The band this competes in — one of the five, or a plugin source's own key. */
	source: BandKey
	/** Counted once, before selection. See note 1 above. */
	tokens: number
	signals: Signals
	/** `priority` on a lore entry; 1 means no bonus. */
	priority?: number
	/** Authored order, the tie-break when scores are equal. `:603`. */
	position?: number
	/**
	 * Constant / guaranteed. Taken ahead of everything scored, and **never
	 * counted against a group's entry cap** — a lorebook of pinned entries
	 * should not exhaust the cap and then exclude everything scored.
	 *
	 * ⚠ Ahead of, not regardless of. Two things still take one, each with a
	 * receipt of its own: a window that cannot hold it, and a source whose
	 * share is zero — the share control promises in so many words that a band
	 * set to zero is left out. See the reserved loop in `select`.
	 */
	pinned?: boolean
	/** Carried through untouched, so the caller keeps its own payload. */
	payload?: unknown
	/**
	 * This candidate is **not eligible**, whatever it scored.
	 *
	 * Eligibility and scoring are separate on purpose, and the separation is
	 * the point rather than the mechanism: a hard rule must not compete
	 * numerically with a soft one and lose. Scoring an excluded candidate zero
	 * leaves it a candidate — a minimum, a pin or a sweep can still take it — and
	 * leaves the receipt saying "it scored badly", which is not what happened.
	 *
	 * ⚠ **Nothing downstream of the mechanisms produces this yet, and that is
	 * deliberate.** The one rule that exists today — an entry's own selective
	 * logic — is answered by the mechanism that reads the entry, so it never becomes
	 * a candidate at all and is reported through `keywordQuery.skipped`. What
	 * needs a place *here* is the class of exclusion the mechanisms cannot answer:
	 * design phase 7's clairvoyance filter excludes a candidate because the
	 * speaker does not know it, which is a fact about the run and not about the
	 * row. Its ruling requires "a **real exclusion carrying a receipt**, not a
	 * score of zero", so the shape is built before the producer rather than
	 * after — the alternative is re-plumbing every mechanism to carry a verdict once
	 * one exists.
	 */
	ineligible?: {
		/** The rule that excluded it, as a sentence for the receipt. */
		reason: string
	}
	/**
	 * A score decided upstream, which overrides the weighted sum.
	 *
	 * Set by the merge step when two retrieval mechanisms have already been fused into
	 * one ordering. Re-scoring there would undo the fusion: the whole point of
	 * rank fusion is that the mechanisms' raw numbers are not comparable, so applying
	 * signal weights to a fused result would reintroduce exactly the scale
	 * problem it was chosen to avoid (DECOMPOSITION §4).
	 */
	presetScore?: number
}

/** Matches the engine's `includedReason` vocabulary, plus five new values. */
export type SelectionReason =
	| "reserved"
	/**
	 * Kept because its source's minimum had not been met yet, ahead of the
	 * proportional split.
	 *
	 * Distinct from `reserved`, which is the user pinning one entry. A minimum is
	 * a promise about a *source* — "always keep six messages" — and reading
	 * `reserved` on six messages nobody pinned would send somebody looking for
	 * a pin that does not exist.
	 */
	| "reserved_minimum"
	/**
	 * Kept because its band's `priority` is `always` — every entry the window
	 * can hold, ahead of the scored fill (R-7 P5, the source's own intent).
	 *
	 * Distinct from `reserved` (one entry somebody pinned) and from
	 * `reserved_minimum` (a minimum, which is a count): this is a promise about
	 * a whole source, and a reader who never ticked a pin and set no minimum is
	 * owed the name of the control that did it.
	 */
	| "reserved_priority"
	| "filled_scored"
	| "filled_zero_score"
	| "excluded_budget"
	| "excluded_token_limit"
	/**
	 * Score-led allocation only: its source had already spent its whole share,
	 * and the share is a ceiling there rather than a pot.
	 *
	 * A reason of its own rather than `excluded_token_limit`, because under
	 * score-led allocation the two answer different questions and point at
	 * different controls. `excluded_token_limit` means the *window* ran out —
	 * better-scoring candidates from anywhere took the tokens, and the fix is a
	 * bigger context. This one means the window had room and the candidate's
	 * own source was not allowed to take any more of it, so the fix is that
	 * source's band. Folding them together would tell somebody to enlarge a
	 * context that was never the constraint.
	 *
	 * ⚠ Not final on its own. Like `excluded_token_limit` it is re-offered by
	 * the sweep, so a candidate carrying this reason in the *excluded* list was
	 * capped **and** there was nothing spare; one that fitted the sweep leaves
	 * with `filled_scored` and a `why` that names both halves.
	 */
	| "excluded_share_cap"
	| "excluded_group_disabled"
	/**
	 * Its source has no budget group at all, so there was nothing to weigh it
	 * against. See the note in `select`.
	 */
	| "excluded_unknown_source"
	/**
	 * A rule excluded it, so it never competed for budget.
	 *
	 * **A different class from every other value here**, and that is the whole
	 * reason it is one: the rest are answers to "there was no room", whose fix
	 * is a bigger window or a different share. This one means the candidate was
	 * not allowed in the prompt at all — "the speaker does not know this" —
	 * and no budget setting will change it. Folding the two together would send
	 * somebody to enlarge a context that was never the constraint, which is the
	 * argument `excluded_share_cap` already makes about its own neighbour.
	 *
	 * Carries the rule's own sentence in `why`; see `Candidate.ineligible`.
	 */
	| "excluded_ineligible"
	/**
	 * Pinned, and still dropped: it did not fit the window.
	 *
	 * Its own reason rather than `excluded_token_limit`, which is about a
	 * group's share. This one is about the window itself, and the difference is
	 * the whole question a reader arrives with — an entry marked always-include
	 * is missing, and the receipt has to say that the pin was honoured as far
	 * as it could be rather than leaving them hunting for the setting that
	 * overrode it.
	 */
	| "excluded_pinned_token_limit"
	/**
	 * Pinned, and still dropped: its source's share is zero.
	 *
	 * Its own reason rather than `excluded_group_disabled` for the reason
	 * `excluded_pinned_token_limit` is not `excluded_token_limit` — the pinned
	 * and the scored path answer different questions. A reader who never
	 * ticked anything wants "that source has no share"; a reader who ticked
	 * this one wants to be told both halves, because neither alone explains
	 * the absence and only the pair says which control to move.
	 *
	 * ⚠ Also the only handle `renderSelection` has on it: a zero-share group
	 * is skipped by the `allocated === 0 && used === 0` guard, so folded into
	 * `excluded_group_disabled` this drop would render nowhere at all.
	 */
	| "excluded_pinned_group_disabled"

export interface Decision {
	candidate: Candidate
	score: number
	reason: SelectionReason
	included: boolean
	/**
	 * Human-readable, and the reason this exists rather than being derived at
	 * render time: the numbers that produced the decision are here and nowhere
	 * else once the loop has moved on (16 §7c).
	 */
	why: string
}

export interface GroupUsage {
	allocated: number
	used: number
	entries: number
	/** The band's entry ceiling. Absent means none — `relationship-search` by default. */
	cap?: number
	/** The band's declared priority, so the receipt can say why an entry was kept ahead. */
	priority: BandPriority
}

export interface Selection {
	included: Decision[]
	excluded: Decision[]
	groups: Record<BandKey, GroupUsage>
	totalTokens: number
}

/**
 * Weighted sum of signals, plus the priority bonus.
 *
 * Priority is added rather than multiplied, matching the engine: a priority-3
 * entry gets a flat `+0.30` regardless of how it scored otherwise, so priority
 * lifts a weak-but-important entry instead of amplifying a strong one.
 *
 * ## The mechanism weights, and why they multiply rather than replace
 *
 * `mechanisms` scales each signal by the *mechanism* that produced it — keyword,
 * semantic or name — leaving the five structural signals alone (see
 * `MechanismWeights`). It is one multiplication per term rather than a second
 * summation, so the arithmetic a receipt states is unchanged in shape: every
 * criterion is still `weight × value`, with the mechanism folded into the
 * weight. **Defaults are 1, so this is arithmetically the old function** until
 * somebody moves a bar.
 *
 * Optional for the same reason `priority` is: this is a pure function with a
 * hundred call sites in tests and one in the ranker, and requiring a fourth
 * argument everywhere to say "all mechanisms at full strength" would be four
 * hundred edits saying nothing.
 */
export function score(
	signals: Signals,
	weights: SignalWeights,
	priority = 1,
	mechanisms: MechanismWeights = DEFAULT_MECHANISMS
): number {
	const k = mechanisms.keyword
	const n = mechanisms.name
	const s = mechanisms.semantic
	/**
	 * ⚠ **The term order is 0.5's and must stay 0.5's.** IEEE addition is not
	 * associative, so grouping these by mechanism — which reads better and was
	 * the first version of this — changes the last bits and can flip a near-tie.
	 * The same hazard is why `lexicalScoring: 'overlap'` still calls
	 * `tfidfSignal` literally rather than the generalised function: the two
	 * agree term for term and not float for float.
	 *
	 * The parity corpus cannot catch a regression here — it is blind to lore
	 * scoring entirely (measured; see `harness.int.test.ts`) — so the order is a
	 * property this comment holds rather than one a suite would notice moving.
	 *
	 * Multiplying by a mechanism strength is safe at the default: `1 * x` is
	 * exact in IEEE, and `semantic` is a new term appended where nothing was, so
	 * with the mechanism off it adds a literal zero.
	 */
	return (
		k * weights.keyword * (signals.keyword ?? 0) +
		n * weights.nameMatch * (signals.nameMatch ?? 0) +
		n * weights.entityCooccurrence * (signals.entityCooccurrence ?? 0) +
		k * weights.tfidf * (signals.tfidf ?? 0) +
		// Structural, and unscaled on purpose: "does this matter now" is not a
		// way of finding something, so a reader turning keyword matching down
		// must not make an entry shorter or less recently mentioned.
		//
		// ⚠ Two terms were removed from between these two — `recency` and
		// `sceneAffinity`, both weighing a signal nothing produced. Removing a
		// term is normally the float hazard this docblock is about; these two
		// are the exception and provably so: `w * (undefined ?? 0)` is an exact
		// positive zero for every finite `w`, and `x + 0` is exact in IEEE-754,
		// so the surviving sum is bit-for-bit what it was.
		weights.lastRefRecency * (signals.lastRefRecency ?? 0) +
		weights.density * (signals.density ?? 0) +
		k * weights.proximity * (signals.proximity ?? 0) +
		s * weights.semantic * (signals.semantic ?? 0) +
		// Appended where nothing was, exactly like `semantic` above and for the
		// same float reason: with the mechanism off it adds a literal zero and the
		// preceding sum is bit-for-bit what it was. Scaled by `name` because
		// "this is called that" is what a mention→name link measures — the same
		// mechanism `nameMatch` and `entityCooccurrence` belong to.
		n * weights.entityVector * (signals.entityVector ?? 0) +
		Math.max(0, priority - 1) * weights.priorityBonus
	)
}

export interface SelectOptions {
	/** Everything the context may occupy, before pinned content is subtracted. */
	availableTokens: number
	params: RankingParams
	/**
	 * Invert the allocation precedence: **score allocates, minimums guarantee,
	 * shares cap** (design §7).
	 *
	 * Off by default, and deliberately a call option rather than a field on
	 * `RankingParams`: a declared parameter is a versioned contract that has to
	 * be projected onto every node that carries a `params` slot, and this is a
	 * switch between two implementations of one function that wants to be
	 * removed once one of them wins. It also keeps the parity corpus measuring
	 * the shipped path — with this off, every branch below runs exactly the
	 * code it ran before the flag existed.
	 *
	 * What changes when it is on, and nothing else does:
	 *
	 *   · the shares stop being pots the scored pass fills one at a time and
	 *     become a ceiling on what one source may take out of a single pool;
	 *   · the pool is spent strictly best-first across all sources;
	 *   · a candidate the ceiling turns away is **held for the sweep** rather
	 *     than dropped, and while the best of those is waiting its tokens are
	 *     not handed to a lower-scoring candidate that happens to be inside its
	 *     own band. That hold is the whole inversion: without it the ceiling is
	 *     arithmetically the old band, and score never actually leads.
	 *
	 * Unchanged either way, because each is a promise made somewhere a user can
	 * read it: pins are taken first and do not consume the entry cap, a zero
	 * share leaves a source out (pinned or not), minimums are met before any
	 * share is worked out, and the tie-break is score then authored position.
	 *
	 * ⚠ **It is reachable now, and it was not.** For as long as this option
	 * existed, `core:task/rank-hybrid@1` (`runtime/bindings.ts`) — the only
	 * runtime `select()` call there is — passed `availableTokens` and `params`
	 * alone, so every shipped run took the share-first branch and the 15
	 * `score-led allocation` cases in `select.test.ts` were the only thing
	 * exercising the other one. That was the intended state rather than an
	 * oversight: turning it on needed somewhere for a user to say so, and the
	 * paragraph above is the argument for why that place is **not**
	 * `RankingParams`. That place is now `scoreLedAllocation` on
	 * `core:task/rank-hybrid@1`'s `params` slot (migration 0196), read by
	 * `scoreLedFrom` in `bindings.ts` and handed straight in here.
	 *
	 * It still **ships false**, so an untouched install takes exactly the code
	 * it took before the declaration existed and the parity corpus keeps
	 * measuring the shipped path. What changed is that a person can now move
	 * it; what has not changed is which branch runs when nobody has.
	 */
	scoreLedAllocation?: boolean
	/**
	 * How the sources' shares are read when the window is divided — the
	 * ranker's `shareNormalisation` (R-7 P5: the one thing about shares that is
	 * cross-source). `relative` is the shipped default and the arithmetic this
	 * has always run.
	 */
	shareNormalisation?: ShareNormalisation
}

/**
 * The order two bands' candidates take when something other than score is
 * asked — the sweep. `normal` everywhere returns 0 everywhere, so the shipped
 * default sorts by score alone, as it always has.
 */
const PRIORITY_RANK: Record<BandPriority, number> = {
	low: 0,
	normal: 1,
	high: 2,
	always: 3
}

/**
 * Choose what fits.
 *
 * Pinned candidates are taken first — they are the user's explicit "always
 * include this", and a budget that can outbid it is a setting that does not
 * mean what it says. They consume budget, so a lorebook of pinned entries
 * starves the scored pool rather than overflowing the limit.
 *
 * Two things still take a pin, and neither is a budget outbidding it: the
 * window it has to fit inside, and a share set to zero — which is not the
 * split arriving at a small number for its source but the user having
 * switched that source off entirely.
 *
 * The pins and the minimums below run the same way whichever allocation
 * precedence is in force; `opts.scoreLedAllocation` reaches only the scored
 * fill and the sweep.
 */
export function select(
	candidates: readonly Candidate[],
	opts: SelectOptions
): Selection {
	const {
		params,
		availableTokens,
		scoreLedAllocation = false,
		shareNormalisation = "relative"
	} = opts
	const included: Decision[] = []
	const excluded: Decision[] = []
	const groups = emptyUsage(params)
	const priorityOf = (band: BandKey): BandPriority =>
		params.groups.priority?.[band] ?? "normal"

	/**
	 * ⚠ Two source vocabularies legitimately coexist — the budget groups are
	 * the five bands, while candidates off the vector mechanism carry
	 * the index's own spelling (`message`, `historyEntry`, …), and neither side
	 * can be renamed (see `VECTOR_SOURCE_ALIASES` in `bindings.ts`). The three
	 * that are the same concept under two names are reconciled by
	 * `BUDGET_GROUP_ALIASES` (`weights.ts`) at the entry to `rank-hybrid`; what still arrives
	 * here is a source with no group at *all* — a graph node, a character, a
	 * persona — and it is dropped with a receipt rather than faulting on
	 * `groups[source].used` three loops further down.
	 */
	const budgeted = candidates.filter((c) => {
		/**
		 * ⚠ Ahead of the group check, and ahead of every score below.
		 *
		 * Eligibility is not a low score — see `Candidate.ineligible`. Taking
		 * it out here means an excluded candidate is never ranked, never
		 * counted toward a minimum, never offered to the sweep, and never
		 * consumes a share; it leaves with the rule's own sentence instead of
		 * a budget one.
		 */
		if (c.ineligible) {
			excluded.push({
				candidate: c,
				score: 0,
				reason: "excluded_ineligible",
				included: false,
				why: c.ineligible.reason
			})
			return false
		}
		if (Object.hasOwn(groups, c.source)) return true
		excluded.push({
			candidate: c,
			score: c.presetScore ?? 0,
			reason: "excluded_unknown_source",
			included: false,
			why: `${c.source} has no budget group, so it could not be selected`
		})
		return false
	})

	const scoreOf = (c: Candidate) =>
		c.presetScore ??
		score(
			c.signals,
			signalsForBand(params.signals, c.source),
			c.priority ?? 1,
			params.mechanisms
		)

	/**
	 * Score, then authored position — matching `:603`, and stable within a tie.
	 *
	 * Shared with the pins rather than left to the scored pass alone: now that a
	 * pin can be dropped, the order it is walked in decides which one survives,
	 * and the only defensible answer to "which pin" is the same one the ranker
	 * would give about anything else. Constant entries that matched nothing all
	 * score alike and fall through to authored order, which is the order their
	 * author wrote them in.
	 */
	type Ranked = { candidate: Candidate; value: number }
	const byRank = (a: Ranked, b: Ranked) =>
		b.value !== a.value
			? b.value - a.value
			: (a.candidate.position ?? 0) - (b.candidate.position ?? 0)

	const rank = (cs: Candidate[]): Ranked[] =>
		cs.map((c) => ({ candidate: c, value: scoreOf(c) })).sort(byRank)

	/**
	 * A band whose `priority` is `always` is taken the way a pin is — every
	 * entry, ahead of the scored fill, window permitting — and its receipt
	 * says so with its own reason. The pins proper still come first: an entry
	 * somebody ticked outranks a source somebody raised.
	 *
	 * ⚠ Against the band's entry cap, unlike a pin (U3b review S1). A pin is
	 * a promise about one entry; `always` is a promise about a band, and the
	 * band's `maxEntries` says on its own label that it applies "whatever its
	 * share" — a priority that stepped over it would make that sentence a
	 * lie on the one path where a person raised both. So the band reserves
	 * up to its cap, in score order, and the rest leave with the cap's own
	 * reason rather than being offered to the scored pass, which would only
	 * turn them away at the same line.
	 */
	const always = (c: Candidate) => !c.pinned && priorityOf(c.source) === "always"
	const pinned = [
		...rank(budgeted.filter((c) => c.pinned)),
		...rank(budgeted.filter(always))
	]
	const scored = rank(budgeted.filter((c) => !c.pinned && !always(c)))

	let reservedTokens = 0

	/**
	 * The minimums, filled before the shares are worked out.
	 *
	 * Score order within a source, so "keep six messages" keeps the six the
	 * ranker liked and not six arbitrary ones. Across sources the walk is also
	 * score order, which is what decides who loses when the minimums cannot all
	 * be met: the weakest candidate of the weakest source, rather than whoever
	 * happens to be last in the object.
	 *
	 * ⚠ The `availableTokens` check is not defensive coding. Minimums are set per
	 * source by somebody who cannot see the window they will be applied
	 * against, and six messages plus twenty lore entries is a prompt no small
	 * model will accept. A minimum that cannot be afforded is dropped and said
	 * so on the receipt; a minimum that overflowed the window would be an
	 * unsendable prompt, which is worse than a short one.
	 */
	const minimums = params.groups.minEntries ?? {}
	const guaranteed = new Set<Candidate>()
	/**
	 * Tokens taken off the top per source — pinned plus minimum.
	 *
	 * The shares divide what is left over, so both kinds have to be subtracted
	 * again when a group's spend is checked against its budget. Tracked rather
	 * than recomputed because `pinnedTokens(pinned, s)` no longer describes
	 * everything that was spent before the split, and a helper that answers a
	 * question one caller ago is how the two drift apart.
	 */
	const reservedBySource = Object.fromEntries(
		(Object.keys(groups) as BandKey[]).map((s) => [s, 0])
	) as Record<BandKey, number>
	/** Pins actually kept, per source — what the minimum below is owed. */
	const pinnedKept = Object.fromEntries(
		(Object.keys(groups) as BandKey[]).map((s) => [s, 0])
	) as Record<BandKey, number>

	/**
	 * ⚠ The `availableTokens` check here is the minimums' argument above, applied
	 * to pins. A pin is set on an entry by somebody who cannot see
	 * the window it will be applied against, and a constant entry longer than
	 * the whole window is not an always-include that the budget rudely
	 * overrode — it is a prompt that cannot be sent, which is worse than a
	 * prompt missing an entry that says on the receipt why it is missing. The
	 * pin is honoured as far as the window allows and no further.
	 *
	 * ⚠ No early break, unlike the minimums: a minimum is a promise about a source
	 * in an order, so skipping to a cheaper member reinterprets it. A pin is a
	 * promise about one entry, made one ticked box at a time, and entry B is
	 * owed nothing by entry A being oversized. Stopping here would drop small
	 * pinned entries because one large one sorted above them — note 3, verbatim
	 * — and leave them with no reason of their own on the receipt.
	 */
	for (const { candidate: c, value } of pinned) {
		/**
		 * ⚠ Read off `params.groups.share`, not `budgets`, which does not
		 * exist yet — and moving the split up here would make the shares
		 * divide a window the pins have not been taken out of, which is the
		 * one thing the ordering below exists to prevent. The share is also
		 * the better question: `budgets[s]` reaches zero for a small window or
		 * a rounded-down share too, while `share[s] === 0` is only ever
		 * somebody having set the band to zero, which is what its own
		 * description says leaves the source out.
		 *
		 * ⚠ Ahead of the window check because this one is unconditional. A pin
		 * whose source is switched off is absent at every window size, and
		 * reporting it as too large would send the reader off enlarging a
		 * context that was never the cause.
		 */
		if (params.groups.share[c.source] <= 0) {
			excluded.push({
				candidate: c,
				score: value,
				// A band on `always` with a zero share is a source switched
				// off, and says so in the source's own words rather than a
				// pin's: nobody ticked this entry.
				reason: c.pinned
					? "excluded_pinned_group_disabled"
					: "excluded_group_disabled",
				included: false,
				why: c.pinned
					? `pinned, but ${c.source} has a zero share, which leaves the whole source out`
					: `${c.source} is set to always be included, but its share is zero, which leaves the whole source out`
			})
			continue
		}
		// The band's ceiling, for `always` alone — see the docblock above.
		// Ahead of the window check for the reason the share check is: over
		// the cap is over the cap at every window size, and a window reason
		// would send the reader off enlarging a context that was never the
		// cause.
		if (
			!c.pinned &&
			groups[c.source].cap !== undefined &&
			groups[c.source].entries >= groups[c.source].cap!
		) {
			excluded.push({
				candidate: c,
				score: value,
				reason: "excluded_budget",
				included: false,
				why: `${c.source} is set to always be included, but already has its maximum of ${groups[c.source].cap} entries`
			})
			continue
		}
		if (reservedTokens + c.tokens > availableTokens) {
			excluded.push({
				candidate: c,
				score: value,
				reason: c.pinned
					? "excluded_pinned_token_limit"
					: "excluded_token_limit",
				included: false,
				why: `${c.pinned ? "pinned" : `${c.source} is set to always be included`}, but needs ${c.tokens} tokens and only ${Math.max(0, availableTokens - reservedTokens)} of the ${availableTokens}-token window were left`
			})
			continue
		}
		pinnedKept[c.source]++
		reservedTokens += c.tokens
		reservedBySource[c.source] += c.tokens
		groups[c.source].used += c.tokens
		if (c.pinned)
			included.push({
				candidate: c,
				score: value,
				reason: "reserved",
				included: true,
				why: `pinned: always included, ${c.tokens} tokens`
			})
		else {
			// Counted as an entry, unlike a pin: a pin bypasses the band's cap
			// by promise, while a band on `always` is the band itself — its
			// usage line says how many it took, and the count is what the cap
			// check above reads.
			groups[c.source].entries++
			included.push({
				candidate: c,
				score: value,
				reason: "reserved_priority",
				included: true,
				why: `${c.source} is set to always be included, ${c.tokens} tokens`
			})
		}
	}

	/**
	 * ⚠ `pinnedKept`, not `pinned.length`. The subtraction exists because a pin
	 * already satisfies the minimum its source is owed; a pin that was dropped
	 * satisfies nothing, and counting it would let one oversized entry silently
	 * cancel a minimum slot the window had ample room for.
	 */
	const wanted = Object.fromEntries(
		(Object.keys(groups) as BandKey[]).map((s) => [
			s,
			// Clamped to the cap: a minimum above the ceiling is a contradiction
			// somebody typed, and honouring it would make `maxEntries` a lie
			// on the one path where it matters. No cap, no clamp.
			Math.min(
				Math.max(0, minimums[s] ?? 0),
				groups[s].cap ?? Number.POSITIVE_INFINITY
			) - pinnedKept[s]
		])
	) as Record<BandKey, number>

	for (const { candidate, value } of scored) {
		if (wanted[candidate.source] <= 0) continue
		if (reservedTokens + candidate.tokens > availableTokens) {
			// Not `continue`-with-a-cheaper-one: a minimum is about *these*
			// entries in this order, and skipping to a worse one that happens
			// to fit would quietly reinterpret "keep the best six" as "keep any
			// six". The rest of this source's minimum goes unmet, and the scored
			// pass may still pick these up if a share can afford them.
			wanted[candidate.source] = 0
			continue
		}
		wanted[candidate.source]--
		guaranteed.add(candidate)
		reservedTokens += candidate.tokens
		reservedBySource[candidate.source] += candidate.tokens
		groups[candidate.source].used += candidate.tokens
		groups[candidate.source].entries++
		included.push({
			candidate,
			score: value,
			reason: "reserved_minimum",
			included: true,
			why: `kept to meet the minimum of ${minimums[candidate.source]} for ${candidate.source}, ${candidate.tokens} tokens`
		})
	}

	// Pinned content is spent before the split, so the shares divide what is
	// actually left rather than what there was in principle.
	const pool = Math.max(0, availableTokens - reservedTokens)
	const budgets = allocateBudgets(params.groups, pool, shareNormalisation)
	for (const source of Object.keys(budgets) as BandKey[])
		groups[source].allocated = budgets[source]

	/**
	 * Score-led allocation only. What the scored pass has taken out of the one
	 * pool, and what is being kept back out of it.
	 *
	 * Share-first has no use for either: its bands sum to no more than `pool`
	 * by construction (`allocateBudgets` floors every one of them), so a
	 * candidate inside its band is inside the window too and a second check
	 * would never fire.
	 *
	 * ⚠ `held` is the inversion, not an optimisation, and it is worth being
	 * explicit about why. Score-led without it reads: the ceiling is
	 * `budgets[s]`, a candidate over it is dropped, and the sweep hands out
	 * whatever is left — which is *arithmetically the shipped behaviour*, band
	 * for band, drop for drop. The share still decides first and the score only
	 * re-sorts inside it. Holding the tokens the best turned-away candidate
	 * needs is what stops a lower-scoring candidate spending them on its way
	 * past, and it is the only line in this function that makes the score
	 * outrank the band.
	 *
	 * One place, not one per source, and the first taker keeps it: the walk is
	 * in score order, so the first candidate the ceiling turns away is the best
	 * one it will turn away, and that is the one worth waiting for. Holding for
	 * every deferral would strand most of the window on candidates the ceiling
	 * has already said no to.
	 */
	let poolSpent = 0
	let held = 0

	for (const { candidate, value } of scored) {
		if (guaranteed.has(candidate)) continue
		const usage = groups[candidate.source]
		const budget = budgets[candidate.source]

		if (budget <= 0) {
			excluded.push({
				candidate,
				score: value,
				reason: "excluded_group_disabled",
				included: false,
				why: `${candidate.source} has no budget share, so nothing from it was considered`
			})
			continue
		}

		if (usage.cap !== undefined && usage.entries >= usage.cap) {
			excluded.push({
				candidate,
				score: value,
				reason: "excluded_budget",
				included: false,
				why: `${candidate.source} already has its maximum of ${usage.cap} entries`
			})
			continue
		}

		// Pinned and minimum tokens came off the top, so they do not also come
		// out of this group's share — `used` starts non-zero and subtracting
		// them again is what keeps the comparison honest.
		const spent = usage.used - reservedBySource[candidate.source]
		if (spent + candidate.tokens > budget) {
			// No break: a cheaper candidate further down may still fit.
			if (!scoreLedAllocation) {
				excluded.push({
					candidate,
					score: value,
					reason: "excluded_token_limit",
					included: false,
					why: `needs ${candidate.tokens} tokens, ${Math.max(0, budget - spent)} left of ${budget} for ${candidate.source}`
				})
				continue
			}
			// The ceiling, and its receipt says ceiling rather than window.
			// Held rather than abandoned, so long as the window could still
			// take it: a hold on something that never fits would spend the
			// rest of the pass turning better candidates away for nothing.
			if (held === 0 && poolSpent + candidate.tokens <= pool)
				held = candidate.tokens
			excluded.push({
				candidate,
				score: value,
				reason: "excluded_share_cap",
				included: false,
				why: `needs ${candidate.tokens} tokens and ${candidate.source} has ${Math.max(0, budget - spent)} left of its ${budget}-token share`
			})
			continue
		}

		if (scoreLedAllocation && poolSpent + candidate.tokens > pool - held) {
			// The window, not the band — under score-led allocation every
			// source draws on one pool, so this is the whole of what is left
			// and the number a reader can act on is the window's.
			excluded.push({
				candidate,
				score: value,
				reason: "excluded_token_limit",
				included: false,
				why: `needs ${candidate.tokens} tokens, ${Math.max(0, pool - held - poolSpent)} left of ${pool} across every source`
			})
			continue
		}

		poolSpent += candidate.tokens
		usage.used += candidate.tokens
		usage.entries++
		included.push({
			candidate,
			score: value,
			reason: value > 0 ? "filled_scored" : "filled_zero_score",
			included: true,
			why:
				value > 0
					? `scored ${value.toFixed(3)}, ${candidate.tokens} tokens`
					: `no signal matched, but ${candidate.source} had room`
		})
	}

	// ── Spillover ────────────────────────────────────────────────────────
	//
	// A share is a *priority*, not a cap. Without this pass, setting world lore
	// to 20% on a session with no character lore would throw the other group's
	// budget away — and on a small context every group's share can be smaller
	// than any single candidate, so nothing is selected at all while the old
	// single-pool engine would have included the best one.
	//
	// So whatever no group could use is pooled and offered to the remaining
	// candidates in score order, across groups. The first claim still belongs to
	// whoever was weighted up; only the leftovers move.
	// Measured against the window, not summed from the per-group remainders.
	//
	// ⚠ **Score-led allocation does not make this redundant — it is what keeps
	// the ceiling from stranding the window**, and it is the reason "shares
	// cap" is a sentence anyone can live with. Half of it does go dead there:
	// an `excluded_token_limit` was weighed against the whole remaining window,
	// which only ever shrinks, so one of those fitting a leftover measured
	// afterwards is a branch that cannot be taken. It is `excluded_share_cap`
	// that needs this pass, and needs it badly. A ceiling with nothing after it
	// makes "world lore is the only relevant thing this turn" unsayable at any
	// window size — a sixth of the budget would be all world lore could ever
	// have, which is a worse engine than the one being replaced and the
	// opposite of what design §7 asks for. With the sweep the cap does what a
	// cap should: it binds while another source can still use the tokens, and
	// yields to whatever no source could.
	//
	// ⚠ The summed version could exceed `availableTokens`, and did: the message
	// minimum used to raise `budgets.messages` after the proportional split
	// without taking the difference from anywhere, so on a 100-token window the
	// budgets summed to 148 and the spill pass would happily fit a 148-token
	// prompt into it. Two tests passed *because* of that overflow.
	//
	// Subtracting what was actually included from what actually exists cannot
	// overshoot however the shares are set, and it recovers the tokens `floor()`
	// drops when a share does not divide evenly — which is why a candidate the
	// exact size of the window used to be unfittable.
	const spentTotal = included.reduce((sum, d) => sum + d.candidate.tokens, 0)
	const leftover = Math.max(0, availableTokens - spentTotal)

	/**
	 * The one place a band's `priority` short of `always` acts (R-7 P5). The
	 * sweep walks the excluded list in the order it was built — score order,
	 * since the scored pass is — and with every band `normal` that is the
	 * whole order: `PRIORITY_RANK` ties everywhere and the stable sort leaves
	 * it untouched, so the shipped default IS the score-ordered sweep. A band
	 * on `high` is offered the leftovers before the others whatever its
	 * candidates scored; `low` after them.
	 */
	const swept = [...excluded].sort(
		(a, b) =>
			PRIORITY_RANK[priorityOf(b.candidate.source)] -
			PRIORITY_RANK[priorityOf(a.candidate.source)]
	)
	let spillRemaining = leftover
	if (spillRemaining > 0) {
		for (const decision of swept) {
			// ⚠ `excluded_pinned_token_limit` is absent here by arithmetic, not
			// by policy: `reservedTokens` only grows and is never more than
			// `spentTotal`, so a pin that did not fit when it was weighed
			// cannot fit a leftover measured later. Listing it would be a
			// branch that can never be taken.
			//
			// `excluded_share_cap` is listed for both modes rather than
			// guarded on the flag: share-first never produces one, so the
			// filter is one condition in both cases instead of a second
			// spelling of the mode the reader has to hold in their head.
			if (
				decision.reason !== "excluded_token_limit" &&
				decision.reason !== "excluded_share_cap"
			)
				continue
			const c = decision.candidate
			const usage = groups[c.source]
			if (usage.cap !== undefined && usage.entries >= usage.cap) continue
			if (c.tokens > spillRemaining) continue

			spillRemaining -= c.tokens
			usage.used += c.tokens
			usage.entries++
			excluded.splice(excluded.indexOf(decision), 1)
			included.push({
				...decision,
				reason:
					decision.score > 0 ? "filled_scored" : "filled_zero_score",
				included: true,
				why: `${decision.why}; fitted from ${leftover} tokens no group could use`
			})
		}
	}

	return {
		included,
		excluded,
		groups,
		totalTokens: included.reduce((sum, d) => sum + d.candidate.tokens, 0)
	}
}

function emptyUsage(params: RankingParams): Record<BandKey, GroupUsage> {
	const sources = Object.keys(params.groups.share) as BandKey[]
	return Object.fromEntries(
		sources.map((s) => {
			const cap = params.groups.maxEntries[s]
			return [
				s,
				{
					allocated: 0,
					used: 0,
					entries: 0,
					// Absent stays absent: no ceiling is a real state
					// (`relationship-search` by default), not a cap of zero.
					...(cap === undefined ? {} : { cap }),
					priority: params.groups.priority?.[s] ?? "normal"
				}
			]
		})
	) as Record<BandKey, GroupUsage>
}

/**
 * The allocation summary, in the words a run inspector would use.
 *
 * Generated from the decisions rather than tracked alongside them, so it cannot
 * disagree with what was actually selected.
 */
export function renderSelection(sel: Selection): string {
	const lines: string[] = []
	for (const [source, usage] of Object.entries(sel.groups)) {
		if (usage.allocated === 0 && usage.used === 0) continue
		const dropped = sel.excluded.filter(
			(d) => d.candidate.source === source
		).length
		lines.push(
			`${source}: ${usage.used} of ${usage.allocated} tokens, ` +
				(usage.cap === undefined
					? `${usage.entries} entries`
					: `${usage.entries} of ${usage.cap} entries`) +
				(dropped ? `, ${dropped} dropped` : "")
		)
	}
	// Its own line because the group aggregate above cannot say it: `N dropped`
	// reads as the ranker doing its job, and a dropped pin is the one drop
	// somebody comes to this summary already looking for.
	const oversizedPins = sel.excluded.filter(
		(d) => d.reason === "excluded_pinned_token_limit"
	)
	if (oversizedPins.length) {
		const sources = [
			...new Set(oversizedPins.map((d) => d.candidate.source))
		]
		lines.push(
			`pinned: ${oversizedPins.length} too large for the window (${sources.join(", ")})`
		)
	}
	// Its own line for the reason above, and a second one that makes it
	// mandatory rather than nicer: a zero-share group never reaches the loop
	// above at all — `allocated` and `used` are both zero, so the guard skips
	// it — and without this the drop would render nowhere.
	const disabledPins = sel.excluded.filter(
		(d) => d.reason === "excluded_pinned_group_disabled"
	)
	if (disabledPins.length) {
		const sources = [
			...new Set(disabledPins.map((d) => d.candidate.source))
		]
		lines.push(
			`pinned: ${disabledPins.length} in a source set to zero share (${sources.join(", ")})`
		)
	}
	const unknown = sel.excluded.filter(
		(d) => d.reason === "excluded_unknown_source"
	)
	if (unknown.length) {
		const sources = [...new Set(unknown.map((d) => d.candidate.source))]
		lines.push(
			`unknown source: ${unknown.length} excluded (${sources.join(", ")})`
		)
	}
	return lines.join("\n")
}
