/**
 * Every constant in the retrieval path, as a parameter.
 *
 * These are the literals scattered through `KeywordInfillEngine` and
 * `BaseInfillEngine` today, lifted into one declaration so they can be config
 * on a node instead of numbers in a file. **Every default here reproduces
 * current behaviour**, with the line it came from named — so the parity corpus
 * passes unchanged and any deviation is somebody's deliberate choice rather
 * than a refactor's accident.
 *
 * They divide into three mechanically different kinds, and keeping them apart
 * is what makes a tuning interface predictable (see packages/DECOMPOSITION.md
 * §4a):
 *
 *   (i)   **signal weights** — how one candidate's score is built. Comparable
 *         within a source, meaningless across sources.
 *   (ii)  **retrieval parameters** — how far to look, how much to guarantee.
 *   (iii) **group importance** — share of the token budget per source. NOT a
 *         score multiplier; see `GroupWeights` for why that distinction is the
 *         whole design.
 */

/** The five things the context is built from. A slider exists per entry here. */
export type SourceKind =
	| "messages"
	| "worldLore"
	| "characterLore"
	| "history"
	| "relationships"

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
	entityCooccurrence: number
	tfidf: number
	lastRefRecency: number
	recency: number
	sceneAffinity: number
	density: number
	/** Added per step of the entry's `priority` field, lore only today. */
	priorityBonus: number
}

const NO_SIGNALS: SignalWeights = {
	keyword: 0,
	nameMatch: 0,
	entityCooccurrence: 0,
	tfidf: 0,
	lastRefRecency: 0,
	recency: 0,
	sceneAffinity: 0,
	density: 0,
	priorityBonus: 0
}

/** `KeywordInfillEngine:1120` (world lore) and `:1184` (character lore). */
const LORE_SIGNALS: SignalWeights = {
	...NO_SIGNALS,
	keyword: 0.35,
	nameMatch: 0.25,
	entityCooccurrence: 0.2,
	tfidf: 0.1,
	lastRefRecency: 0.1,
	priorityBonus: 0.15
}

export const DEFAULT_SIGNAL_WEIGHTS: Record<SourceKind, SignalWeights> = {
	worldLore: LORE_SIGNALS,
	characterLore: LORE_SIGNALS,
	/** `:1239`. Note history carries no `priorityBonus` today. */
	history: {
		...NO_SIGNALS,
		keyword: 0.35,
		recency: 0.2,
		tfidf: 0.1,
		sceneAffinity: 0.1,
		lastRefRecency: 0.1
	},
	/** `:1277`. */
	messages: {
		...NO_SIGNALS,
		recency: 0.3,
		sceneAffinity: 0.15,
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

export interface RetrievalParams {
	/**
	 * How many recent messages the keyword scan reads.
	 *
	 * Hardcoded at 10 today and **sharing one constant with
	 * `guaranteedMessages`** (`BaseInfillEngine.ts:10`), which is two different
	 * questions answered by one number: how far back do we look for triggers,
	 * versus how much recent conversation survives budgeting. A chat of long
	 * posts wants a deep scan and a short guarantee; a terse one wants the
	 * reverse. Splitting them is behaviour-preserving while both default to 10.
	 */
	scanDepth: number
	/** Messages never dropped by budgeting. `BaseInfillEngine.ts:10`. */
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
}

export const DEFAULT_RETRIEVAL: RetrievalParams = {
	scanDepth: 10,
	guaranteedMessages: 10,
	contextThresholdPercent: 0.8,
	matchMode: "substring"
}

// ── (ii-b) Semantic retrieval ───────────────────────────────────────────────

/**
 * The nine numbers the RAG arm runs on, every one of them a constant today.
 *
 * `RagInfillEngine` carries these as module-level `const`s, and one of them
 * already has a `TODO: make configurable in a future pass` next to it. They are
 * exposed here for the same reason every other constant was: a user whose chat
 * has long posts and a user whose chat is terse want different windows, and
 * neither can express that today.
 *
 * Provenance is on each field. The defaults are the current values exactly, so
 * turning them into parameters changes nothing until somebody moves one.
 */
export interface SemanticParams {
	/** Most recent messages used as the primary query. `RagInfillEngine:93`. */
	currentWindow: number
	/**
	 * Next-most-recent messages used as a second query, filling what the first
	 * left. `RagInfillEngine:100`.
	 */
	recentWindow: number
	/**
	 * Rank-fusion constant. 60 is the value from the original RRF paper and the
	 * value both arms already use — named here rather than repeated, because two
	 * fusions with different k silently rank differently.
	 */
	rrfK: number
	/** How much a recent message's score is lifted. `RagInfillEngine:112`. */
	recencyBoost: number
	/** How fast that lift decays with age. `RagInfillEngine:114`. */
	recencyDecay: number
	/**
	 * Floor for the adaptive score threshold, and the fraction of the top score
	 * it must also clear. `RagInfillEngine:117-119`.
	 *
	 * Two numbers rather than one because they answer different questions: the
	 * floor rejects a chat where *nothing* is relevant, the relative one rejects
	 * the long tail of a chat where something is.
	 */
	thresholdMin: number
	relativeThreshold: number
	/**
	 * Relevance-versus-diversity trade-off for MMR. 1 is pure relevance.
	 * `RagInfillEngine:122`.
	 */
	mmrLambda: number
	/** How many of each source survive fusion. `RagInfillEngine:103-109`. */
	sourceBudget: Record<string, number>
	/** Anything not named above. `RagInfillEngine:507`. */
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
export interface GroupWeights {
	/** Relative importance. Normalised, so only the ratios matter. */
	share: Record<SourceKind, number>
	/** Most entries a source may contribute. `KeywordInfillEngine:56`. */
	maxEntries: Record<SourceKind, number>
	/** Tokens guaranteed to messages regardless of share. `BaseInfillEngine.ts:14`. */
	minMessageTokens: number
}

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
		relationships: 0
	},
	minMessageTokens: 512
}

// ── The whole surface ───────────────────────────────────────────────────────

export interface RankingParams {
	signals: Record<SourceKind, SignalWeights>
	retrieval: RetrievalParams
	semantic: SemanticParams
	groups: GroupWeights
}

export const DEFAULT_RANKING: RankingParams = {
	signals: DEFAULT_SIGNAL_WEIGHTS,
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
			...((partial.signals ?? {}) as Record<SourceKind, SignalWeights>)
		},
		retrieval: { ...DEFAULT_RETRIEVAL, ...(partial.retrieval ?? {}) },
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
			}
		}
	}
}

type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K]
}

/**
 * Turn shares into token budgets.
 *
 * Zero-weight sources are excluded before normalising, so a disabled group does
 * not quietly consume budget it cannot use. The message floor is applied after
 * proportional split and taken from the remainder, matching
 * `max(512, floor(available * 0.5))` today.
 */
export function allocateBudgets(
	groups: GroupWeights,
	availableTokens: number
): Record<SourceKind, number> {
	const active = (Object.keys(groups.share) as SourceKind[]).filter(
		(k) => groups.share[k] > 0
	)
	const total = active.reduce((sum, k) => sum + groups.share[k], 0)

	const out = Object.fromEntries(
		(Object.keys(groups.share) as SourceKind[]).map((k) => [k, 0])
	) as Record<SourceKind, number>
	if (total <= 0 || availableTokens <= 0) return out

	for (const k of active)
		out[k] = Math.floor(availableTokens * (groups.share[k] / total))

	// The floor is a guarantee, not a share: a chat whose lore weights dwarf
	// messages still keeps a readable amount of conversation, which is the
	// failure mode the constant was protecting against.
	if (out.messages > 0 || groups.share.messages > 0)
		out.messages = Math.max(
			Math.min(groups.minMessageTokens, availableTokens),
			out.messages
		)

	return out
}
