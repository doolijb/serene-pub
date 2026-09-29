/**
 * The keyword mechanism, as a Query.
 *
 * This is what `core:query/lorebook-triggers@1` binds to. It does the part of
 * the 0.5 keyword path that decides **which entries are candidates** — and
 * stops there. Scoring weights, budgets and what actually fits are the ranker's
 * and Assemble's business, downstream, where a user can swap them.
 *
 * Splitting at this line is the whole reason the decomposition is worth doing.
 * Today "the lore that got in" is the output of one 900-line pass, so the only
 * available answer to "why did this entry not appear" is "read the code". Here
 * the Query says *what matched*, the ranker says *what won*, and Assemble says
 * *what fit* — three answers, each attributable.
 *
 * The Query does not reach the network (16 §1). Vector similarity is the other
 * mechanism's job; this one reads rows and matches strings.
 */

import {
	buildScanWindow,
	messageAt,
	buildBm25Idf,
	buildIdf,
	buildLastRefMap,
	keywordMatch,
	nameMatchSignal,
	speakerCooccurrenceSignal,
	speakersIn,
	selectiveLogicHolds,
	splitKeys,
	keysText,
	type KeyList,
	tfidfSignal,
	lexicalDocument,
	lexicalSignal,
	isDefaultLexical,
	trigramsOf,
	BM25_B,
	BM25_K1,
	buildTermFreq,
	lastRefRecencySignal,
	densitySignal,
	type LexicalDocument,
	type LexicalOptions,
	type ScanWindow,
	type TrigramFolding
} from "$lib/server/pipelines/ranking/signals"
import {
	buildEvidenceProfile,
	buildGazetteer,
	entityEvidence,
	evidence,
	type Evidence,
	type EvidenceProfile,
	type GazetteerName
} from "$lib/server/pipelines/ranking/entities"
import type { Candidate } from "$lib/server/pipelines/ranking/select"
import type {
	RetrievalParams,
	RetrievalBand
} from "$lib/server/pipelines/ranking/weights"

export interface LoreRow {
	id: number
	source: RetrievalBand
	name: string | null
	content: string
	/**
	 * One element per key — the stored `text[]` — or, from a legacy caller, a
	 * comma string (`KeyList`). Never joined and re-split on the way here: a
	 * regex `{1,3}` must arrive as one key (finding #146).
	 */
	keys: KeyList
	caseSensitive?: boolean | null
	useRegex?: boolean | null
	matchMode?: string | null
	/**
	 * The condition keys, and how to read them — see `selectiveLogicHolds`.
	 *
	 * On the row rather than on the node, like the rest of the matcher set and
	 * for the reason pre-squash 0195 gave about `caseSensitive` and `useRegex`: they
	 * describe how *this entry* matches, and the entry is what somebody is
	 * looking at when they want to change that.
	 */
	secondaryKeys?: KeyList
	selectiveLogic?: string | null
	/**
	 * The deepest recursion level at which this entry may still be reached.
	 *
	 * `0` means the conversation only — never dragged in by another entry.
	 * NULL means "no opinion", which the node's ceiling then decides. Note it
	 * is about being *found*, not about finding: an entry's content always
	 * feeds the next pass if there is one, because content that may be in the
	 * prompt but may not be read is a distinction nobody asked for.
	 */
	recursionDepth?: number | null
	priority?: number | null
	/**
	 * The character this entry's lorebook binding names, for character lore's
	 * co-occurrence signal.
	 *
	 * Resolved at the read rather than here: the binding rows carry ids and the
	 * host already loads and hydrates them for `{{char:1}}` substitution, so
	 * asking the ranker to re-read them would be a second query per turn for a
	 * fact one already in hand. Null for world lore and history, for a binding
	 * that names a persona or nobody, and for an entry bound to nothing.
	 */
	bindingCharacterId?: number | null
	constant?: boolean | null
	enabled?: boolean | null
	/** An archived entry is out of retrieval, like a disabled one (L1). */
	archived?: boolean | null
	position?: number | null
	hasEmbedding?: boolean
}

export interface MessageRow {
	id: number
	content: string
	/**
	 * Who said it, when a character did.
	 *
	 * Null on a user turn, on the narrator, and on the uncommitted draft. Read
	 * only by character lore's co-occurrence signal, which asks whether an
	 * entry's own character is in the scene.
	 */
	characterId?: number | null
}

export interface KeywordQueryInput {
	entries: readonly LoreRow[]
	messages: readonly MessageRow[]
	/**
	 * The session's cast, with what each name resolves to — the gazetteer's
	 * first tier (`ranking/entities.ts`).
	 *
	 * ⚠ **This replaced a second, cruder cast input.** There used to be an
	 * `entityNames: string[]` beside it feeding `entityCooccurrenceSignal`: bare
	 * strings, matched by substring, resolving to nothing. Both the scoring
	 * signal and the admission gate read the gazetteer now, so the two halves of
	 * the cast cannot drift apart and a character's name, her nickname and her
	 * absorbed aliases are one entity rather than four strangers.
	 *
	 * Optional: the mechanism works without it, on the open tier alone, and every
	 * caller that has a cast in hand supplies it.
	 */
	entityRefs?: readonly GazetteerName[]
	retrieval: RetrievalParams
	/*
	 * ⚠ There were two more inputs here and both are gone, for one reason.
	 *
	 * `defaultStrategy` was the query node's `retrievalMode` — what an entry
	 * that had declared nothing was treated as — culled with its declaration by
	 * pre-squash migration 0203 (now in `0094_baseline_0_6`). `availability`
	 * was `{ vectorSearchAvailable }`, and this
	 * mechanism consulted it only to ask whether an entry's own
	 * `retrieval_strategy` sent it elsewhere; pre-squash 0204 dropped that
	 * column, so the question has no asker and the answer no reader.
	 *
	 * Neither comes back. A mode a node can set, or a column an entry can set,
	 * is a mechanism that can be switched off for candidates whose authors never
	 * asked for that — the exclusion the plan's second governing rule forbids.
	 * If per-entry mechanism preference is wanted again it returns as per-entry
	 * *weights* over the existing mechanism-weight axis, which subtracts a
	 * contribution instead of removing a candidate. See `ranking/strategy.ts`.
	 *
	 * ⚠ And note what this mechanism no longer knows: whether an embedding model is
	 * loaded. That is the point. The keyword scan must return the same entries
	 * on an install with a model and one without, and the surest way to keep
	 * that true is to leave it nothing to branch on. Whether the vector mechanism ran
	 * is still reported — by the node that runs it, on the receipt.
	 */
	/** Counts a candidate once, up front — see select.ts note 1. */
	countTokens: (text: string) => number
}

/**
 * Why an entry left this mechanism without becoming a candidate.
 *
 * Two classes, and keeping them apart is the forward-compatibility obligation
 * the retrieval plan states for phases 1–6: *the receipt shape must
 * accommodate exclusion reasons that are not budget-related.* "No key matched"
 * is a **miss** — the entry was looked at and nothing about the conversation
 * reached it, and the fix is another key or a lower threshold. "Its secondary
 * keys say not here" is an **exclusion** — a rule the author wrote said no, and
 * no retrieval setting will change it.
 *
 * The distinction has a producer today (selective logic) and is the shape
 * phase 7's clairvoyance filter lands in — "excluded: the speaker does not know
 * this" is the same class, decided elsewhere.
 */
export type SkipKind = "missed" | "excluded"

export interface KeywordQueryResult {
	candidates: Candidate[]
	/**
	 * Entries this mechanism did not consider, and why. Never silently absent.
	 *
	 * `kind` is optional on the wire rather than required, because a receipt
	 * stored by an earlier build has rows without it and a reader that assumed
	 * the field would report every one of them as an exclusion. Absent reads as
	 * `missed`, which is what every row this list held before the field existed
	 * actually was.
	 */
	skipped: Array<{
		id: number
		source: RetrievalBand
		reason: string
		kind?: SkipKind
	}>
	diagnostics: {
		scanDepth: number
		/** The other window — how much conversation counts as *now*. */
		guaranteedMessages: number
		windowChars: number
		considered: number
		matched: number
		/** Levels actually walked, not the ceiling that was allowed. */
		recursionDepth: number
		/** The threshold that was in force. 0 means keys were the only way in. */
		admitThreshold: number
		/**
		 * How many of `matched` no key or name would have admitted.
		 *
		 * Reported because it is the one number that says whether turning the
		 * gate on did anything, and because "why is there suddenly more lore in
		 * my prompt" needs an answer that is not "read the code" (16 §7c).
		 */
		admittedByEvidence: number
		/** What the conversation was found to be naming, for the receipt. */
		entities: string[]
		/**
		 * Which extractor produced them.
		 *
		 * Absent when the gate is off and nothing ran. Reported rather than
		 * assumed because the entities on a receipt are only meaningful
		 * alongside the thing that found them — the same identity discipline
		 * the named-vector design applies to `(model, modelVersion, …)`.
		 */
		extractorVersion?: string
	}
}

/**
 * What the admission gate reads an entry as.
 *
 * Name, keys and content together — and the content is the half that matters,
 * because a book with no keys has nothing else. It is deliberately **not** the
 * text `tfidfSignal` scores, which is `keys + name`: that one is the author's
 * index and parity pins it, and widening it would change the ordering of every
 * keyed book to fix the admission of keyless ones.
 */
const entryText = (entry: LoreRow) =>
	`${entry.name ?? ""} ${keysText(entry.keys)} ${entry.content ?? ""}`

/** What each mode promised, in the author's own words rather than a code. */
const SELECTIVE_NOTE: Record<string, string> = {
	andAny: "none of its secondary keywords were in the conversation",
	andAll: "not all of its secondary keywords were in the conversation",
	notAny: "one of its secondary keywords was in the conversation",
	notAll: "all of its secondary keywords were in the conversation"
}

/**
 * Why selective logic turned an entry away, naming the keys it turned on.
 *
 * The keys are in the sentence because the entry's *primary* keys matched —
 * so a receipt saying only "its condition failed" sends somebody to look at
 * the wrong half of their own entry.
 */
const selectiveNote = (entry: LoreRow): string => {
	const keys = splitKeys(entry.secondaryKeys).join(", ")
	const why =
		SELECTIVE_NOTE[entry.selectiveLogic ?? ""] ?? "its condition failed"
	return `its keywords matched, but ${why} (${keys})`
}

/**
 * Find candidates by keyword.
 *
 * Every entry the mechanism declines is reported rather than dropped. A retrieval
 * stage that returns only its hits cannot distinguish "nothing matched" from
 * "your entry is disabled" from "its condition said not here" — different user
 * problems with different fixes, which is exactly the confusion `skipped`
 * exists to prevent.
 */
export function keywordQuery(input: KeywordQueryInput): KeywordQueryResult {
	const { entries, messages, entityRefs, retrieval, countTokens } = input

	// Clamped at 0: a negative ceiling is not "unlimited", and reading it as
	// one would make a typo in a config the most expensive setting in the app.
	const maxDepth = Math.max(0, retrieval.maxRecursionDepth ?? 0)

	const sessionWindow = buildScanWindow(messages, retrieval.scanDepth)
	// tf-idf scores against the **guaranteed** window, not the scan window.
	// They are two different depths and legacy uses the narrower one for this
	// signal (`:157`): the scan window decides what *can* match a key at all,
	// while tf-idf asks how close the entry's subject is to what is being said
	// right now.
	const guaranteed = buildScanWindow(messages, retrieval.guaranteedMessages)
	const guaranteedFreq = buildTermFreq(guaranteed.lower)
	const guaranteedCount = Math.min(
		messages.length,
		retrieval.guaranteedMessages
	)
	// Character lore's co-occurrence is about the *conversation*, not the
	// entry — see `speakerCooccurrenceSignal`. Built from the guaranteed
	// window, which is the window legacy built it from.
	const guaranteedSpeakers = speakersIn(
		messages,
		retrieval.guaranteedMessages
	)
	const idf = buildIdf(messages)
	const lastRef = buildLastRefMap(messages, entries)

	/**
	 * The mean entry length, for `density`.
	 *
	 * Over the **pool** and not over the hits, for BM25's reason one block
	 * down: an entry's length is a property of the entry and of the book it is
	 * in, so it must not change according to what else happened to match this
	 * turn. Characters rather than tokens because it is free — the strings are
	 * already here — and because `countTokens` is a host call this mechanism
	 * makes once per *candidate*, not once per row.
	 *
	 * Unconditional, unlike the BM25 document pool: this is one pass summing
	 * string lengths, which is the same reason `proximity` is computed whether
	 * or not anybody weighs it.
	 */
	const averageContentLength = entries.length
		? entries.reduce((sum, e) => sum + (e.content ?? "").length, 0) /
			entries.length
		: 0

	/**
	 * The entry pool as documents, and the pool's mean length.
	 *
	 * Two reasons this is built here rather than per entry inside the scan.
	 * BM25 normalises a document's length against the **pool's** average, so no
	 * entry can be scored until every entry has been measured — the pool is the
	 * lorebook, which is what design phase 1 means by lorebook entries varying
	 * wildly in length. And the documents are the same at every recursion level:
	 * an entry's own text does not change because the window did, so building
	 * them once is the difference between one pass over the pool and one per
	 * level.
	 *
	 * ⚠ Skipped entirely under the shipped defaults — see `isDefaultLexical`.
	 * With nothing moved, the scan calls `tfidfSignal` on exactly the string it
	 * always did, and this map is never built.
	 */
	const lexical: LexicalOptions = {
		titleWeight: Math.max(0, retrieval.titleWeight ?? 1),
		saturation: retrieval.lexicalScoring === "balanced" ? BM25_K1 : null,
		lengthNorm: BM25_B,
		averageLength: 1
	}
	const documents = new Map<string, LexicalDocument>()
	/**
	 * The same documents as plain text, for BM25's idf to count.
	 *
	 * Built in the loop below rather than beside the call, so the text whose
	 * rarity is measured and the text that is scored come off **one**
	 * `LexicalFields` value. They are two readings of one document and a
	 * fixture cannot see them part company — the weighting would just be a
	 * little wrong, everywhere, quietly.
	 */
	const poolTexts: string[] = []
	if (!isDefaultLexical(lexical)) {
		let total = 0
		for (const entry of entries) {
			const fields = {
				title: entry.name ?? "",
				keys: keysText(entry.keys)
			}
			const doc = lexicalDocument(fields, lexical.titleWeight)
			documents.set(`${entry.source}:${entry.id}`, doc)
			poolTexts.push(`${fields.keys} ${fields.title}`)
			total += doc.length
		}
		lexical.averageLength = entries.length ? total / entries.length : 1
	}
	/**
	 * The idf the lexical reading is scored with, paired to the reading.
	 *
	 * `buildIdf` for the unsaturated branch — that branch reproduces
	 * `tfidfSignal` and has to stay comparable with it — and `buildBm25Idf` for
	 * the saturated one, because BM25's idf is part of BM25 rather than a
	 * weighting choice bolted to the side of it.
	 *
	 * ⚠ **The two read different collections, and both are the right one for
	 * their branch.** `buildIdf` counts *messages*, because that branch is
	 * `tfidfSignal` and parity pins it there; `buildBm25Idf` counts the *entry
	 * pool*, because that is the collection being searched and because the
	 * length half of the same formula already normalises against the pool. See
	 * `buildBm25Idf`.
	 *
	 * The ternary is also what keeps the second pass off the shipped path: with
	 * `lexicalScoring` at `overlap` nothing calls `buildBm25Idf` at all, and
	 * `poolTexts` is empty because the loop above never ran.
	 */
	const lexicalIdf =
		lexical.saturation == null ? idf : buildBm25Idf(poolTexts)

	/**
	 * The scan window's trigrams, or `null` when folding is off.
	 *
	 * Once per window rather than once per entry: the window is shared by the
	 * whole pool, and folding it per entry would be the pool size times the
	 * same string walk. Rebuilt for each recursion level below, because at that
	 * point the window really is a different string.
	 *
	 * Clamped at 0 for the reason `maxDepth` and `admitThreshold` are: a
	 * negative strength would subtract from a key that nearly matched, and
	 * "adding a mechanism may only add matches" is the plan's second governing
	 * rule.
	 */
	const foldingStrength = Math.max(0, retrieval.trigramFolding ?? 0)
	const foldingFor = (window: ScanWindow): TrigramFolding | null =>
		foldingStrength > 0
			? {
					windowTrigrams: trigramsOf(window.lower),
					strength: foldingStrength
				}
			: null
	const sessionFolding = foldingFor(sessionWindow)

	/**
	 * The other way in — see `ranking/entities.ts`.
	 *
	 * Clamped at 0 for the reason `maxDepth` is: a negative threshold would
	 * admit every entry in the lorebook, which is not what a typo means.
	 */
	const admitThreshold = Math.max(0, retrieval.admitThreshold ?? 0)
	/**
	 * ⚠ **Built on every scan now, not only when the admission gate is on.**
	 *
	 * It used to be skipped whenever `admitThreshold` was 0 — the shipped
	 * default — because nothing else read it and an install that had not turned
	 * the gate on should pay nothing for it. That reasoning ended when the
	 * *scoring* signal started reading it: `entityCooccurrence` is this profile's
	 * entity overlap for world lore and history now, so a null profile would
	 * silently zero a weighted signal on every install that never touched the
	 * gate, which is bug 17 reintroduced by an optimisation.
	 *
	 * The cost is one regex pass and one tokenize per entry, on a pool the scan
	 * is already walking key by key — the same order of work the keyword match
	 * itself does. It is skipped only when there is nothing to profile.
	 *
	 * Built against the **guaranteed** window rather than the scan window, for
	 * the same reason tf-idf is: the scan window decides what *can* match a
	 * key, and this asks what the conversation is about right now. Both default
	 * to 10, so the two only part company once somebody moves one.
	 */
	const profile = entries.length
		? buildEvidenceProfile({
				window: guaranteed.raw,
				entryTexts: entries.map(entryText),
				/**
				 * Cast first, entries second: `buildGazetteer` lets the
				 * first writer of a name keep it, and a character called
				 * "Vell" should resolve to the character rather than to an
				 * entry titled after her.
				 */
				gazetteer: buildGazetteer([
					...(entityRefs ?? []),
					...entries.flatMap((e) =>
						e.name
							? [
									{
										name: e.name,
										ref: {
											kind: "entry" as const,
											id: e.id
										}
									}
								]
							: []
					)
				])
			})
		: null

	const candidates: Candidate[] = []
	const skipped: KeywordQueryResult["skipped"] = []
	let matched = 0
	let admittedByEvidence = 0
	/** Per entry, so the receipt can say how close a near miss was. */
	const evidenceOf = new Map<string, Evidence>()

	/**
	 * Entries this mechanism has finished with — matched, disabled or ineligible.
	 *
	 * One set rather than three, because what every case has in common is the
	 * only thing the loop needs to know: do not look at this again. Without it
	 * a recursion pass re-reports the same disabled entry once per level.
	 *
	 * ⚠ Keyed by `source:id`, not `id`. The three lore tables have independent
	 * identity sequences, so a world-lore entry and a history entry both being
	 * row 1 is the *normal* case on a young lorebook — and keying on the number
	 * alone made the first one settle the second, which then vanished without
	 * appearing in `skipped` either. The vector mechanism already keys hits this way;
	 * this did not, for one commit.
	 */
	const settled = new Set<string>()
	const keyOf = (e: LoreRow) => `${e.source}:${e.id}`

	for (const entry of entries) {
		if (entry.archived === true) {
			settled.add(keyOf(entry))
			skipped.push({
				id: entry.id,
				source: entry.source,
				kind: "excluded",
				reason: "entry is archived"
			})
			continue
		}
		if (entry.enabled === false) {
			settled.add(keyOf(entry))
			skipped.push({
				id: entry.id,
				source: entry.source,
				// An exclusion rather than a miss: nothing about the
				// conversation could have brought a disabled entry in, and
				// no retrieval setting will.
				kind: "excluded",
				reason: "entry is disabled"
			})
			continue
		}

		// `constant` means bypass retrieval, so it belongs to the entry rather
		// than to a mechanism. Left unsettled here so the level-0 pass pins it below.
		//
		// ⚠ **A deliberate no-op, kept as a guard rail.** The `continue` used to
		// jump over the strategy gate that followed, and the ordering was
		// load-bearing: a gate placed first settled every unconfigured constant
		// entry the moment an embedding model was loaded. Pre-squash 0204 removed
		// the gate, so there is nothing left below to jump over — and the line
		// stays so that whatever this loop next learns to decline is written
		// *after* it. `constant` outranks every reason a mechanism can have.
		if (entry.constant) continue
	}

	/**
	 * One pass over everything still unsettled.
	 *
	 * `level` is 0 for the conversation and counts up through recursion. It is
	 * passed rather than closed over so the eligibility rule reads as the
	 * sentence it is: an entry may be reached at this level if it did not ask
	 * for shallower.
	 */
	const scan = (
		window: ScanWindow,
		level: number,
		folding: TrigramFolding | null,
		/**
		 * What an entry's CONDITION keys are read against (finding #152).
		 *
		 * The conversation plus this level's window, never the window alone:
		 * on a recursion pass the window is only the triggering entries' text,
		 * so "fire on dragon, but not when statue is present" would admit the
		 * entry while *statue* stood in the conversation — the author's "not
		 * here" ignored because the text that says "here" was not scanned.
		 * SillyTavern reads selective logic against its whole scan buffer
		 * (chat plus what recursion added) for the same reason. 0.5.x had
		 * neither recursion nor selective logic, so there is no parity to
		 * keep; at level 0 this is the conversation window itself.
		 */
		conditionWindow: ScanWindow = window
	): LoreRow[] => {
		const hits: LoreRow[] = []
		for (const entry of entries) {
			if (settled.has(keyOf(entry))) continue
			// An entry's own limit, under the node's. NULL is no opinion, so
			// the ceiling decides — which is what makes turning recursion on
			// for a whole lorebook one setting rather than several hundred.
			if (level > (entry.recursionDepth ?? maxDepth)) continue

			// A constant entry is a candidate regardless of whether anything
			// matched — that is what constant means. It still goes through this
			// mechanism so the receipt shows it was considered here, rather than
			// appearing downstream from nowhere. Only at level 0: a constant
			// entry is unconditional, so there is nothing for a later pass to
			// discover about it.
			const pinned = level === 0 && !!entry.constant
			const keyHits: Array<{ key: string; index: number }> = []
			const signals = scoreSignals(
				entry,
				window,
				idf,
				lastRef,
				messages.length,
				guaranteedFreq,
				guaranteedCount,
				guaranteedSpeakers,
				folding,
				lexical,
				lexicalIdf,
				documents.get(keyOf(entry)),
				profile,
				averageContentLength,
				keyHits
			)

			/**
			 * Evidence admits; keys guarantee.
			 *
			 * Only at level 0, and not as an optimisation: every part of
			 * `evidence` is a fact about the conversation and the entry, and
			 * none of it reads `window` — so an entry that does not clear the
			 * threshold on the first pass will not clear it on the fourth
			 * either, and testing again would be the same arithmetic with the
			 * same answer. An entry admitted here *does* feed the next
			 * recursion window, exactly as a keyword hit does: it got in, and
			 * what got in is what the next level reads.
			 *
			 * Note the order of the disjunction. `keyword` and `nameMatch` are
			 * tried first and cost nothing, so an authored key never pays for
			 * the evidence path — and an entry an author keyed is admitted by
			 * that key, with the receipt saying so.
			 */
			const byKey = pinned || signals.keyword > 0 || signals.nameMatch > 0
			let byEvidence = false
			/**
			 * ⚠ `admitThreshold > 0`, **not** "a profile exists".
			 *
			 * The two were the same condition while the profile was built only
			 * when the gate was on; the scoring signal reads the profile now, so
			 * it is built on every scan and the two have parted. Leaving the
			 * test as `profile &&` reads 0 as *"every score clears zero"* and
			 * admits the entire lorebook — which is the one meaning
			 * `admitThreshold: 0` cannot have, and is exactly what its
			 * declaration says out loud.
			 */
			if (!byKey && profile && admitThreshold > 0 && level === 0) {
				const e = evidence(
					entryText(entry),
					profile,
					retrieval.admitWeights,
					/**
					 * Bug 16's split, carried into admission rather than
					 * re-derived: character lore is admitted only while its own
					 * character is in the scene, which is what `scoreSignals`
					 * just computed for that source. Reading it off the signal
					 * is what stops a second definition of the same question
					 * growing next to the first and drifting from it.
					 *
					 * World lore and history have no such precondition, so
					 * their `presence` is 1 and the evidence stands alone.
					 */
					entry.source === "characterLore"
						? signals.entityCooccurrence
						: 1
				)
				evidenceOf.set(keyOf(entry), e)
				byEvidence = e.total >= admitThreshold
			}
			if (!byKey && !byEvidence) continue

			/**
			 * Found, and then **excluded** — a different verdict from missed.
			 *
			 * Selective logic is the author saying *not here*: "fire on
			 * dragon, but not when statue is present". It is checked after
			 * admission and never before it, so the receipt can say the entry
			 * was found and judged rather than sending somebody to write
			 * another key for an entry whose keys worked.
			 *
			 * It is an exclusion and not a penalty. A wrong entry in a fixed
			 * budget does not merely rank low, it displaces a right one and
			 * misleads the model, so there is no score for it to lose — see
			 * `Candidate.ineligible`, which is the same distinction one stage
			 * further down.
			 *
			 * ⚠ `pinned` is exempt. `constant` means bypass retrieval
			 * entirely (design §11), and a condition evaluated against a
			 * window is retrieval.
			 */
			if (!pinned && !selectiveLogicHolds(entry, conditionWindow)) {
				settled.add(keyOf(entry))
				skipped.push({
					id: entry.id,
					source: entry.source,
					kind: "excluded",
					reason: selectiveNote(entry)
				})
				continue
			}

			settled.add(keyOf(entry))
			matched++
			if (byEvidence) admittedByEvidence++
			hits.push(entry)
			candidates.push({
				id: entry.id,
				source: entry.source,
				tokens: countTokens(entry.content),
				signals,
				priority: entry.priority ?? 1,
				position: entry.position ?? 0,
				pinned,
				payload: entry,
				...(keyHits.length
					? {
							// Exact hits first; a trigram (fuzzy) hit has no
							// offset and never "matched" its key, so it says so.
							matched: [...keyHits]
								.sort((a, b) => Number(a.index < 0) - Number(b.index < 0))
								.map((h) =>
									h.index < 0
										? { key: h.key, messageId: null, fuzzy: true }
										: { key: h.key, messageId: messageAt(window, h.index) }
								)
						}
					: {})
			})
		}
		return hits
	}

	let found = scan(sessionWindow, 0, sessionFolding)
	let level = 0
	/**
	 * The deepest level that actually produced something.
	 *
	 * Not the same as `level`, which is always one further along — the pass
	 * that stops the loop is the pass that found nothing. Reporting that one
	 * would say "recursion reached level 2" about a run where level 2 was
	 * empty, and the number exists precisely so somebody can tell how far the
	 * lore actually chained.
	 */
	let depth = 0
	while (level < maxDepth && found.length > 0) {
		level++
		// The previous level's content *is* the next window. Joined the same
		// way `buildScanWindow` joins messages — a single space — so a key
		// spanning two entries behaves exactly as one spanning two messages,
		// rather than being a second rule nobody wrote down.
		const raw = found.map((e) => e.content ?? "").join(" ")
		const next: ScanWindow = { raw, lower: raw.toLowerCase() }
		// Joined by the same single space, so a condition key spanning the
		// conversation's end and an entry's start reads as it would in one
		// window. No offsets: nothing reports a position from this one.
		const conditions: ScanWindow = {
			raw: `${sessionWindow.raw} ${raw}`,
			lower: `${sessionWindow.lower} ${next.lower}`
		}
		found = scan(next, level, foldingFor(next), conditions)
		if (found.length > 0) depth = level
	}

	// Reported last, and only for what nothing reached. Saying "no key matched"
	// after the first pass would name entries that the second pass then pulled
	// in, so the receipt would contradict the prompt.
	for (const entry of entries) {
		if (settled.has(keyOf(entry))) continue
		const base =
			maxDepth > 0
				? `no key matched in the last ${retrieval.scanDepth} messages, or in ${depth} level(s) of triggered entries`
				: `no key matched in the last ${retrieval.scanDepth} messages`
		// How close it came, when the other way in was open. "No key matched"
		// alone sends somebody to write another key; a near miss says the
		// entry was found and judged, and which control moves it.
		const near = evidenceOf.get(keyOf(entry))
		skipped.push({
			id: entry.id,
			source: entry.source,
			kind: "missed",
			reason: near
				? `${base}, and its relevance scored ${near.total.toFixed(2)} against a threshold of ${admitThreshold.toFixed(2)}`
				: base
		})
	}

	return {
		candidates,
		skipped,
		diagnostics: {
			scanDepth: retrieval.scanDepth,
			/**
			 * Reported beside `scanDepth` because it is the other half of one
			 * pair and was invisible for as long as it was undeclared: this is
			 * the window `entityCooccurrence` asks "did this character speak"
			 * over and the window `tfidf` scores against, and until
			 * `guaranteedMessages` was declared on the lore types the only value
			 * it could hold was a constant nothing could reach.
			 *
			 * Two numbers on one line is also the only way a reader can tell the
			 * two windows apart when they disagree, which is the entire point of
			 * having split them.
			 */
			guaranteedMessages: retrieval.guaranteedMessages,
			windowChars: sessionWindow.raw.length,
			considered: entries.length,
			matched,
			// How deep it actually went, not how deep it was allowed to — a
			// ceiling of 3 that stopped at 1 because nothing else triggered is
			// the normal case, and the difference is the only way to tell
			// "recursion found nothing" from "recursion never ran".
			recursionDepth: depth,
			admitThreshold,
			admittedByEvidence,
			// The surface forms, not the keys: a receipt saying the scene is
			// about "the Ashguard" is readable, and one saying `entry:41` is
			// an id nobody asked about.
			entities: (profile?.entities ?? []).map((e) => e.text),
			extractorVersion: profile?.extractorVersion
		}
	}
}

function scoreSignals(
	entry: LoreRow,
	window: ScanWindow,
	idf: Map<string, number>,
	lastRef: Map<number, number>,
	totalMessages: number,
	/** The guaranteed window's term frequencies, and how many messages it spans. */
	guaranteedFreq: Map<string, number>,
	guaranteedCount: number,
	/** Characters who spoke in the guaranteed window. */
	guaranteedSpeakers: ReadonlySet<number>,
	/** The window's trigrams, or null when folding is off. */
	folding: TrigramFolding | null,
	/** How the vocabulary overlap is read — see `RetrievalParams`. */
	lexical: LexicalOptions,
	/**
	 * The idf paired to that reading — BM25's when it saturates, the plain one
	 * when it does not. Separate from `idf` above rather than replacing it,
	 * because the fallback below is `tfidfSignal`, which is parity-pinned to
	 * `buildIdf` and must keep reading that map whatever the lexical reading is.
	 */
	lexicalIdf: Map<string, number>,
	/** This entry as a weighted document, absent under the shipped defaults. */
	document: LexicalDocument | undefined,
	/**
	 * What the conversation is naming and how rare each of those things is in
	 * this pool. Null only when the pool is empty, in which case nothing is
	 * being scored either.
	 */
	profile: EvidenceProfile | null,
	/**
	 * The pool's mean entry-CONTENT length in characters, for `density`.
	 *
	 * ⚠ Not `LexicalOptions.averageLength`, which is a mean over BM25's
	 * *documents* — term counts over `keys + title`. Two different measures of
	 * two different texts; the names are close enough that spelling out which
	 * is which is cheaper than the bug.
	 */
	averageContentLength: number,
	/** Filled with the keys that matched (L1), when given. */
	hitsOut?: Array<{ key: string; index: number }>
) {
	// One walk of the entry's keys answers both of these. Proximity is the
	// *offsets* that walk already computed, which is the whole reason design
	// phase 1 calls it free: a second pass to measure distance would be the
	// same comparisons twice.
	const keys = keywordMatch(entry, window, folding)
	if (hitsOut) hitsOut.push(...keys.hits)
	return {
		keyword: keys.signal,
		proximity: keys.proximity,
		nameMatch: nameMatchSignal(entry.name, window),
		/**
		 * Two definitions, one per source, and they are not the same question.
		 *
		 * World lore and history ask **how much of what the conversation is
		 * naming does this entry name too**. Character lore asks whether the
		 * character the entry belongs to **spoke in the guaranteed window** —
		 * nearer to `nameMatch`'s direction, and the only one of the two that
		 * says anything there: a character-lore entry names its own character by
		 * construction, so the overlap question scores every present character's
		 * private lore alike and distinguishes nothing.
		 *
		 * They were one function for a while, and the corpus could not see it —
		 * no fixture had character lore, and none had a cast name in its lore
		 * vocabulary either.
		 *
		 * ## The world-lore half is the graded overlap now (plan phase 3)
		 *
		 * It used to be `entityCooccurrenceSignal`: does the entry's own title or
		 * keys *contain* a cast name, as a substring, as a 0 or a 1. Three
		 * defects, all named in design §13.6, and all fixed by the measure the
		 * admission gate has been using since the gate shipped:
		 *
		 *   · **binary** — one shared entity and twelve scored alike. Now graded
		 *     and rarity-weighted, so a thing every entry mentions counts for
		 *     nothing and a thing only this entry mentions counts for a lot.
		 *   · **substring** — `Al` fired on `Alchemy`. Now matched on word
		 *     boundaries through the gazetteer, which also resolves a name and a
		 *     nickname to one entity rather than two.
		 *   · **one-sided** — it asked only what the *entry* names, so an entry
		 *     mentioning Alice scored whether or not the scene had said a word
		 *     about her. Now both sides are extracted and intersected.
		 *
		 * ⚠ **The weight moved with the measure and had to.** The graded term
		 * saturates around 0.63 for one rare shared entity and 0.86 for two, so
		 * at the old 0.2 its live range would have been ~[0.13, 0.17] where the
		 * binary version spanned {0, 0.2} — more correct and less influential at
		 * the same time. World lore's `signalEntityCooccurrence` is 0.35;
		 * character lore's stays 0.2, because character lore's measurement did
		 * not change.
		 *
		 * ⚠ **`session/entity-cooccurrence` in the parity corpus diverges on
		 * this, permanently and correctly** — design §13.11 predicted it before
		 * it was written. Both of that fixture's entries are keyed `ashguard` and
		 * the window names nothing else, so any two-sided measure scores them
		 * identically; 0.5's signal separates them *only* by firing on Alice,
		 * whom the conversation never says. The predecessor wins there by being
		 * wrong, so no correct measure can match it, and the golden is a record
		 * of 0.5's arithmetic rather than a target. See `harness.int.test.ts`.
		 *
		 * `entityEvidence` rather than `evidence().entity`: the entry's rare
		 * vocabulary is already scored, separately, as `tfidf`, and the noisy-or
		 * `evidence` computes for **admission** folds the two together. Counting
		 * the vocabulary twice here would double one mechanism's weight without
		 * saying so anywhere.
		 */
		entityCooccurrence:
			entry.source === "characterLore"
				? speakerCooccurrenceSignal(
						entry.bindingCharacterId,
						guaranteedSpeakers
					)
				: profile
					? entityEvidence(entryText(entry), profile).entity
					: 0,
		/**
		 * Raw, not normalised: normalisation needs the maximum across the whole
		 * pool, which only the ranker sees. Doing it here would normalise
		 * against this mechanism alone and make the two mechanisms incomparable.
		 *
		 * ⚠ **The scored text is the author's index — `keys + name` — and it
		 * stays that.** Widening it to the entry's content would change the
		 * ordering of every keyed book in the app; `entryText` above reads a
		 * wider text on purpose and for a different question (admission), and
		 * the two must not converge.
		 *
		 * The original call survives verbatim for the shipped reading rather
		 * than being expressed through the general one, because the two agree
		 * term for term and not float for float — see `isDefaultLexical`.
		 */
		tfidf:
			document && !isDefaultLexical(lexical)
				? lexicalSignal(
						document,
						lexicalIdf,
						guaranteedFreq,
						guaranteedCount,
						lexical
					)
				: tfidfSignal(
						// `keysText` for a list; a string (or nothing) exactly as
						// it always read, so parity's pinned text is unchanged.
						`${Array.isArray(entry.keys) ? keysText(entry.keys) : entry.keys} ${entry.name ?? ""}`,
						idf,
						guaranteedFreq,
						guaranteedCount
					),
		lastRefRecency: lastRefRecencySignal(
			lastRef.get(entry.id),
			totalMessages
		),
		/**
		 * How long this entry is against the pool's average, capped at 1.
		 *
		 * ⚠ **`densitySignal` had no caller at all until this line**, while
		 * `SignalWeights.density` was declared, stored and read by `score()` —
		 * a helper and a weight that had been waiting for each other since the
		 * ranker was written.
		 *
		 * Written on every candidate for `proximity`'s reason, which is the
		 * same reason stated one field at a time: the number costs one pass
		 * over lengths that were already in memory, and a signal whose value
		 * nobody can see is a signal nobody can decide to weight. Every lore
		 * band weighs it 0, so producing it changes no score anywhere until a
		 * reader moves the slider.
		 *
		 * The cap is what makes it useful rather than a second `tokens`: it
		 * discriminates *below* the average and saturates above, so a book of
		 * even entries gets a flat 1 and no ordering, and a book that mixes
		 * one-line stubs with real articles pushes the stubs down. Length is a
		 * proxy for how much an entry has to say and it is only a good proxy in
		 * the second kind of book — which is why this ships as a slider and not
		 * as a policy.
		 */
		density: densitySignal(
			(entry.content ?? "").length,
			averageContentLength
		)
	}
}

/**
 * Normalise tf-idf across a candidate pool.
 *
 * The engine scores everything twice for this reason (`:529-552`): tf-idf is
 * unbounded, so it is divided by the pool maximum to bring it into [0, 1] with
 * the other signals. Kept as a separate step rather than folded into scoring,
 * because with two retrieval mechanisms the pool is not known until they have both
 * reported.
 */
export function normaliseTfidf(candidates: Candidate[]): Candidate[] {
	const max = Math.max(1, ...candidates.map((c) => c.signals.tfidf ?? 0))
	return candidates.map((c) => ({
		...c,
		signals: { ...c.signals, tfidf: (c.signals.tfidf ?? 0) / max }
	}))
}
