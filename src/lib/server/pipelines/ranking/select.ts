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
 * (packages/DECOMPOSITION.md §5).
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
 */

import type { RankingParams, SignalWeights, SourceKind } from "./weights"
import { allocateBudgets } from "./weights"

/** The signal values for one candidate. Missing signals are zero, not absent. */
export interface Signals {
	keyword?: number
	nameMatch?: number
	entityCooccurrence?: number
	tfidf?: number
	lastRefRecency?: number
	recency?: number
	sceneAffinity?: number
	density?: number
}

export interface Candidate {
	id: number | string
	source: SourceKind
	/** Counted once, before selection. See note 1 above. */
	tokens: number
	signals: Signals
	/** `priority` on a lore entry; 1 means no bonus. */
	priority?: number
	/** Authored order, the tie-break when scores are equal. `:603`. */
	position?: number
	/**
	 * Constant / guaranteed. Never dropped, and **never counted against a
	 * group's entry cap** — a lorebook of pinned entries should not exhaust the
	 * cap and then exclude everything scored.
	 */
	pinned?: boolean
	/** Carried through untouched, so the caller keeps its own payload. */
	payload?: unknown
	/**
	 * A score decided upstream, which overrides the weighted sum.
	 *
	 * Set by the merge step when two retrieval arms have already been fused into
	 * one ordering. Re-scoring there would undo the fusion: the whole point of
	 * rank fusion is that the arms' raw numbers are not comparable, so applying
	 * signal weights to a fused result would reintroduce exactly the scale
	 * problem it was chosen to avoid (DECOMPOSITION §4).
	 */
	presetScore?: number
}

/** Matches the engine's `includedReason` vocabulary, plus one new value. */
export type SelectionReason =
	| "reserved"
	| "filled_scored"
	| "filled_zero_score"
	| "excluded_budget"
	| "excluded_token_limit"
	| "excluded_group_disabled"

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
	cap: number
}

export interface Selection {
	included: Decision[]
	excluded: Decision[]
	groups: Record<SourceKind, GroupUsage>
	totalTokens: number
}

/**
 * Weighted sum of signals, plus the priority bonus.
 *
 * Priority is added rather than multiplied, matching the engine: a priority-3
 * entry gets a flat `+0.30` regardless of how it scored otherwise, so priority
 * lifts a weak-but-important entry instead of amplifying a strong one.
 */
export function score(
	signals: Signals,
	weights: SignalWeights,
	priority = 1
): number {
	return (
		weights.keyword * (signals.keyword ?? 0) +
		weights.nameMatch * (signals.nameMatch ?? 0) +
		weights.entityCooccurrence * (signals.entityCooccurrence ?? 0) +
		weights.tfidf * (signals.tfidf ?? 0) +
		weights.lastRefRecency * (signals.lastRefRecency ?? 0) +
		weights.recency * (signals.recency ?? 0) +
		weights.sceneAffinity * (signals.sceneAffinity ?? 0) +
		weights.density * (signals.density ?? 0) +
		Math.max(0, priority - 1) * weights.priorityBonus
	)
}

export interface SelectOptions {
	/** Everything the context may occupy, before pinned content is subtracted. */
	availableTokens: number
	params: RankingParams
}

/**
 * Choose what fits.
 *
 * Pinned candidates are taken first and unconditionally — they are the user's
 * explicit "always include this", and a budget that can override it is a
 * setting that does not mean what it says. They consume budget, so a lorebook
 * of pinned entries starves the scored pool rather than overflowing the limit.
 */
export function select(
	candidates: readonly Candidate[],
	opts: SelectOptions
): Selection {
	const { params, availableTokens } = opts
	const included: Decision[] = []
	const excluded: Decision[] = []

	const scoreOf = (c: Candidate) =>
		c.presetScore ??
		score(c.signals, params.signals[c.source], c.priority ?? 1)

	const pinned = candidates.filter((c) => c.pinned)
	const scored = candidates
		.filter((c) => !c.pinned)
		.map((c) => ({ candidate: c, value: scoreOf(c) }))
		.sort((a, b) => {
			if (b.value !== a.value) return b.value - a.value
			// Stable within a tie, then by authored position — matching `:603`.
			return (a.candidate.position ?? 0) - (b.candidate.position ?? 0)
		})

	const groups = emptyUsage(params)
	let reservedTokens = 0

	for (const c of pinned) {
		reservedTokens += c.tokens
		groups[c.source].used += c.tokens
		included.push({
			candidate: c,
			score: scoreOf(c),
			reason: "reserved",
			included: true,
			why: `pinned: always included, ${c.tokens} tokens`
		})
	}

	// Pinned content is spent before the split, so the shares divide what is
	// actually left rather than what there was in principle.
	const budgets = allocateBudgets(
		params.groups,
		Math.max(0, availableTokens - reservedTokens)
	)
	for (const source of Object.keys(budgets) as SourceKind[])
		groups[source].allocated = budgets[source]

	for (const { candidate, value } of scored) {
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

		if (usage.entries >= usage.cap) {
			excluded.push({
				candidate,
				score: value,
				reason: "excluded_budget",
				included: false,
				why: `${candidate.source} already has its maximum of ${usage.cap} entries`
			})
			continue
		}

		// The pinned tokens already spent in this group count against its share,
		// so `used` starts non-zero and the comparison stays honest.
		const spent = usage.used - pinnedTokens(pinned, candidate.source)
		if (spent + candidate.tokens > budget) {
			// No break: a cheaper candidate further down may still fit.
			excluded.push({
				candidate,
				score: value,
				reason: "excluded_token_limit",
				included: false,
				why: `needs ${candidate.tokens} tokens, ${Math.max(0, budget - spent)} left of ${budget} for ${candidate.source}`
			})
			continue
		}

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
	// to 20% on a chat with no character lore would throw the other group's
	// budget away — and on a small context every group's share can be smaller
	// than any single candidate, so nothing is selected at all while the old
	// single-pool engine would have included the best one.
	//
	// So whatever no group could use is pooled and offered to the remaining
	// candidates in score order, across groups. The first claim still belongs to
	// whoever was weighted up; only the leftovers move.
	const leftover = (Object.keys(budgets) as SourceKind[]).reduce((sum, s) => {
		const spentHere = groups[s].used - pinnedTokens(pinned, s)
		return sum + Math.max(0, budgets[s] - spentHere)
	}, 0)

	let spillRemaining = leftover
	if (spillRemaining > 0) {
		for (const decision of [...excluded]) {
			if (decision.reason !== "excluded_token_limit") continue
			const c = decision.candidate
			const usage = groups[c.source]
			if (usage.entries >= usage.cap) continue
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

const pinnedTokens = (pinned: readonly Candidate[], source: SourceKind) =>
	pinned
		.filter((c) => c.source === source)
		.reduce((sum, c) => sum + c.tokens, 0)

function emptyUsage(params: RankingParams): Record<SourceKind, GroupUsage> {
	const sources = Object.keys(params.groups.share) as SourceKind[]
	return Object.fromEntries(
		sources.map((s) => [
			s,
			{
				allocated: 0,
				used: 0,
				entries: 0,
				cap: params.groups.maxEntries[s] ?? 0
			}
		])
	) as Record<SourceKind, GroupUsage>
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
				`${usage.entries} of ${usage.cap} entries` +
				(dropped ? `, ${dropped} dropped` : "")
		)
	}
	return lines.join("\n")
}
