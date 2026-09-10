/**
 * The discriminating ranking corpus.
 *
 * **Read `corpus.ts`'s header first** — it holds the argument. In one line: the
 * parity gate is measurably blind to everything about lore *ranking*, so this
 * corpus asserts that each control has an effect, and every fixture proves it
 * by perturbing the control it exists to observe and asserting the output
 * moved.
 *
 * ## What this is *not* a duplicate of
 *
 * `runtime/loreLexicalQuality.int.test.ts` gates the **seam**: that a value
 * stored on a config row reaches the scan at all, which is where three
 * generations of dead controls in this subsystem have lived. It asserts on
 * signal *values* — `tfidf` swapped, some score changed — because that is what
 * proves the wire is connected.
 *
 * This file gates the **effect**: that moving a control changes *what reaches
 * the model*. Those are different claims and the second does not follow from
 * the first — a signal can change value and change nothing, which is precisely
 * what every one of the eleven parity fixtures demonstrates about every lore
 * weight there is. Assertions here are therefore on **prompt order and
 * membership** and almost never on a float.
 *
 * The two exceptions are marked where they occur, and both are structural facts
 * about a fixture rather than calibration: `proximity` being non-zero at all,
 * and two entries' `tfidf` being unequal at all. A later reader needs to know
 * the world still has the property it was built for, because the day it stops
 * having it every assertion standing on it becomes decorative.
 *
 * ## How to read a fixture here
 *
 * Every `it` has the same parts, in this order:
 *
 *   1. **the baseline** — the world at the shipped defaults, asserted exactly;
 *   2. **the perturbation** — one control moved, and the output asserted to
 *      have changed, naming what changed and in which direction;
 *   3. sometimes **the control case** — a second world, or a second value,
 *      where the same perturbation must *not* move anything because the
 *      mechanism has nothing to see there. Those are as load-bearing as the
 *      positive ones: they are what stops the corpus asserting a coincidence.
 *
 * ## Findings recorded here rather than fixed
 *
 * ⚠ **`RetrievalParams.matchMode` is a dead knob.** `retrievalParamsFrom`
 * (`runtime/bindings.ts:104`) maps a node's `matchMode` param onto
 * `retrieval.matchMode`, and `keywordQuery` never reads it — `modeOf`
 * (`ranking/signals.ts:81`) reads **`entry.matchMode`**, the column. So the
 * entry's own control is live and the node-level one changes nothing. This
 * corpus asserts the live half (`the match mode an entry declares`) and leaves
 * the dead half alone rather than pinning it with a passing test: a defect held
 * in place by an assertion is harder to remove than one that is merely written
 * down.
 *
 * ## A finding that was recorded here and has since been ruled on
 *
 * ⚠ **Kept because the fixtures below are written against the ruling and read
 * as arbitrary without it.** For a while, under `balanced`, one stopword in a
 * title outweighed eight content keys. BM25's idf counts the entry pool
 * (`buildBm25Idf`), and a lexical document is `keys + title` — short enough
 * that `the` sits in half the pool rather than in all of it, where over a
 * conversation it is in every message and worth almost nothing. The query half
 * then applied no saturation of its own, so 21 occurrences of `the` in a
 * ten-message window arrived as a multiplier of 2.1 and `the` in a title was
 * worth about three quarters of those entries' whole lexical score.
 *
 * **The ruling was to saturate the query half on the document half's own
 * curve** — Okapi's `k3` term at `BM25_K1` — so 21 occurrences are worth 2.08
 * of one rather than 21. Universal arithmetic rather than a stopword list: no
 * language asset, no gating on a language setting, and the same behaviour in a
 * language whose stopwords we do not have. The collection was deliberately
 * *not* touched, because counting `df` over a wider entry text than the scorer
 * reads is the disagreement between rarity and length that moving the
 * collection had just closed.
 *
 * `LITANY` is the world built to observe it and `CONTENDED` records what it
 * cost that world's fixture; both say what they asserted before.
 */

import { describe, it, expect } from "vitest"
import {
	missed,
	noSignals,
	runWorld,
	type CorpusWorld
} from "$lib/server/pipelines/measure/corpus"

// ─── The worlds ─────────────────────────────────────────────────────────────

/**
 * A night on the road, said by four people who are not narrating for us.
 *
 * One conversation shared by several of the fixtures below, because a corpus of
 * eight unrelated conversations is eight chances for a fixture to work by
 * accident. The word frequencies here *are* several fixtures' arithmetic:
 * `lantern` is said in four of the ten messages and `sluice`, `hedge` and
 * `mule` in one each, which is what gives tf-idf a spread to be measured on.
 */
const NIGHT_ON_THE_ROAD = [
	{ id: 1, content: "We came down out of the pass before dark, all four of us." },
	{ id: 2, content: "The road was bad and the mule threw a shoe twice on the way." },
	{ id: 3, content: "There was a lantern burning where the wall meets the water." },
	{ id: 4, content: "A second lantern hung further along the wall, over the sluice." },
	{ id: 5, content: "So we made camp and waited for the morning to come round." },
	{ id: 6, content: "The lantern kept going out and somebody kept relighting it." },
	{ id: 7, content: "Vell fed the fire and it took, and it burned the night through." },
	{ id: 8, content: "By the third watch the wind had turned and the smoke went flat." },
	{ id: 9, content: "Then the water rose over the flat stones the way it always does." },
	{ id: 10, content: "We slept under the hedge with the lantern out and the tide in." }
]

/** Padding, so every entry in a contended world costs about the same. */
const BODY = (text: string) => `${text} ${"detail ".repeat(6)}`.trim()

/**
 * Eight entries competing for a budget that fits five.
 *
 * ⚠ **Contention is the whole point.** The parity corpus cannot see any ranking
 * change because each of its fixtures' lore fits inside its band — ordering
 * decides nothing there, so a reorder never reaches the rendered prompt. Here
 * the budget admits five of eight, so an ordering change at the boundary is a
 * *membership* change, which is the kind a user experiences.
 *
 * The eight are built to spread the signals rather than to be tidy, because a
 * pool whose members agree is a pool `normaliseTfidf` will flatten and every
 * weight on it will be invisible:
 *
 *   · **`keyword` has a range** — most entries match all their keys, two match
 *     half, one matches a third. Had every entry matched everything, scaling
 *     the keyword mechanism would scale the pool uniformly and change nothing.
 *   · **four entries carry two or more keys**, so `proximity` is a spread
 *     rather than the structural zero it is across the entire parity corpus.
 *   · **one entry's own name is in the conversation**, so `nameMatch` fires for
 *     exactly one of the eight.
 *   · **one entry is keyword-stuffed** — eight keys, several matching — which
 *     is what gives `tfidf` a top end far from the others.
 *   · **the cast is drawn from this world's own lore vocabulary**, which is
 *     design §10.1's fourth trap closed: pick a cast independently and the
 *     entity signals score 0 everywhere and no weight on them is observable.
 */
const CONTENDED: CorpusWorld = {
	about: "eight entries competing for a budget that fits five",
	cast: [{ name: "Vell", ref: { kind: "character", id: 7 } }],
	messages: NIGHT_ON_THE_ROAD,
	entries: [
		{
			id: 1,
			name: "The Sluice Gate",
			keys: "sluice, wall",
			content: BODY("Iron doors under the wall that let the tide in and out.")
		},
		{
			id: 2,
			name: "Lanternwrights",
			// Two of three keys are things this session never says, which is
			// what puts this entry at the bottom on `keyword` alone.
			keys: "lantern, brine, tallow",
			content: BODY("A guild that keeps the harbour lights burning at night.")
		},
		{
			id: 3,
			name: "The Hedge Road",
			keys: "hedge, road",
			content: BODY("The old south track, walled with thorn on both sides.")
		},
		{
			id: 4,
			name: "Commander Vell",
			keys: "vell",
			content: BODY("She has not spoken her given name in twenty years.")
		},
		{
			id: 5,
			name: "The Ember Tide",
			keys: "tide, water",
			content: BODY("A slow flood of hot ash that comes with the season.")
		},
		{
			id: 6,
			name: "Mule Traders",
			keys: "mule, cordage",
			content: BODY("They move goods over the pass when the season allows.")
		},
		{
			id: 7,
			name: "The Third Watch",
			keys: "watch, wind",
			content: BODY("The coldest shift, kept by whoever drew the short straw.")
		},
		{
			id: 8,
			name: "Stonefast",
			// The keyword-stuffed entry — an author indexing by hand, which is
			// exactly the behaviour the admission gate exists to stop requiring.
			keys: "stones, flat, water, low, mark, ruin, past, tide",
			content: BODY("A ruin of flat stones out past the low water mark.")
		}
	]
}

/**
 * The budget that makes `CONTENDED` contend.
 *
 * Five entries at roughly twenty-four tokens each. Chosen from the middle of
 * the window where five fit (121–139 tokens, measured) rather than from its
 * edge, so an edited sentence shifts the fixture's meaning rather than silently
 * changing how many entries it is about.
 *
 * Deliberately a literal and not derived from the entries at runtime: a budget
 * computed from the world would move whenever somebody edited it, and the whole
 * value of this number is that editing the world is supposed to be visible.
 */
const FITS_FIVE = 130

/**
 * Two entries, two keys each, distinguished only by how far apart their keys
 * landed.
 *
 * The world that could not have existed before: every lore entry in every
 * parity fixture carries exactly one key, and `keywordMatch` returns
 * `proximity: 0` for fewer than two exact hits, so the signal is structurally
 * zero across the entire existing corpus.
 *
 * Both entries match both of their keys, so `keyword` is 1 for each. Neither
 * name appears in the conversation, so `nameMatch` is 0 for each. Their key
 * vocabularies are chosen so `tfidf` comes out equal. What is left is the gap:
 * *gate* and *warden* land four characters apart in message 4, *ember* and
 * *tide* land four messages apart.
 */
const SCATTERED_KEYS: CorpusWorld = {
	about: "two keys close together against the same two keys far apart",
	messages: [
		{ id: 1, content: "We came down out of the pass before dark." },
		{ id: 2, content: "The road was bad and the mule threw a shoe twice." },
		{ id: 3, content: "There was a lantern burning where the wall meets the water." },
		{ id: 4, content: "A gate warden turned us back at dusk without a word." },
		{ id: 5, content: "So we made camp under the hedge and waited for morning." },
		{ id: 6, content: "Somebody had left an ember in the ring, still warm." },
		{ id: 7, content: "We fed it and it took, and it burned the whole night through." },
		{ id: 8, content: "By the third watch the wind had turned and the smoke went flat." },
		{ id: 9, content: "Then the water rose over the flat stones the way it does." },
		{ id: 10, content: "That tide put the fire out and soaked every blanket we had." }
	],
	entries: [
		{
			id: 1,
			name: "Nightfall Concord",
			keys: "gate, warden",
			content: "A treaty signed at dusk between two houses who could not agree by daylight."
		},
		{
			id: 2,
			name: "Vellum Compact",
			keys: "ember, tide",
			content: "An older agreement, written on skin, that nobody now alive has read entire."
		}
	]
}

/**
 * Two entries whose keys differ only in how much of the conversation they are.
 *
 * *lantern* is said in four of the ten messages; *hedge* in one. Both entries
 * are last referenced in the final message, so `lastRefRecency` ties exactly;
 * both match all their keys, so `keyword` ties; neither name is in the
 * conversation, so `nameMatch` and the entity overlap tie. **`tfidf` is the
 * only thing that separates them**, which is what makes turning its weight off
 * an observation rather than an inference.
 *
 * ⚠ Authored order is the *reverse* of the tf-idf order, deliberately. With the
 * signal at zero the two tie exactly and `select` falls through to position, so
 * the fixture's baseline and its perturbation are two different orders rather
 * than one order with different numbers behind it.
 */
const VOCABULARY: CorpusWorld = {
	about: "one entry's subject is what the conversation keeps saying",
	messages: NIGHT_ON_THE_ROAD,
	entries: [
		{
			id: 1,
			name: "Vellum Compact",
			keys: "hedge",
			content: "An older agreement, written on skin, that nobody now alive has read entire."
		},
		{
			id: 2,
			name: "Nightfall Concord",
			keys: "lantern",
			content: "A treaty signed at dusk between two houses who could not agree by day."
		}
	]
}

/**
 * The control for `VOCABULARY`: the same two entries, keyed the same word.
 *
 * This world is **supposed to be blind** to the tf-idf weight, and the fixture
 * asserts that it is. It is the executable form of design §10.1's first
 * structural trap — `normaliseTfidf` divides the pool by its own maximum, so a
 * pool whose members do not differ from each other cannot show a tf-idf change
 * at any weight. Without this case, `moves the prompt at the weight that
 * actually ships` would read as a fact about tf-idf when it is partly a fact
 * about *that world*.
 */
const ONE_VOCABULARY: CorpusWorld = {
	about: "the same two entries, keyed identically — the blind control",
	messages: NIGHT_ON_THE_ROAD,
	entries: [
		{
			id: 1,
			name: "Vellum Compact",
			keys: "lantern",
			content: "An older agreement, written on skin, that nobody now alive has read entire."
		},
		{
			id: 2,
			name: "Nightfall Concord",
			keys: "lantern",
			content: "A treaty signed at dusk between two houses who could not agree by day."
		}
	]
}

/**
 * Two entries holding the same words in the opposite two fields.
 *
 * Entry 1 is *called* Sluice and *keyed* lantern; entry 2 is the reverse. The
 * two therefore carry an identical bag of terms, which is what `titleWeight: 1`
 * means — the scored text is `keys + name` concatenated, and splitting a string
 * at a space cannot merge or split a token, so at 1 the two entries are scored
 * on the same vocabulary by construction.
 *
 * Above 1 the title's terms count more, and the two part company in the
 * direction the conversation decides: *lantern* is said four times and *sluice*
 * once, so the entry **titled** Lantern overtakes the entry that merely lists
 * it as a key. `Assizes` is in no message, which is what keeps the shared third
 * token of both names out of the arithmetic.
 */
const WHICH_FIELD: CorpusWorld = {
	about: "the same words, in the title of one entry and the keys of the other",
	messages: NIGHT_ON_THE_ROAD,
	entries: [
		{
			id: 1,
			name: "Sluice Assizes",
			keys: "lantern",
			content: "A court that sits twice a year and rules on the water rights."
		},
		{
			id: 2,
			name: "Lantern Assizes",
			keys: "sluice",
			content: "A court that sits twice a year and rules on the water rights."
		}
	]
}

/**
 * The same key on two entries, one of which is much longer as a *document*.
 *
 * The minimal statement of what `lexicalScoring` decides. Both entries are
 * keyed `lantern` and nothing else, so under `overlap` — where a term's weight
 * is added once per occurrence and nothing is divided by anything — they score
 * **identically**, and the tie falls through to authored order.
 *
 * Entry 1's title is seven tokens long and not one of them is said in the
 * conversation, so it contributes no score and considerable length. Under
 * `balanced` that length is normalised away against the pool's mean and the
 * long entry drops below the short one. *A long entry stops winning for being
 * long* is the sentence the parameter's declaration makes; this is that
 * sentence with the prompt order attached.
 */
const LENGTH: CorpusWorld = {
	about: "one key, two entries, one of them long for no reason that scores",
	messages: [
		{ id: 1, content: "We came down out of the pass before dark, all four of us." },
		{ id: 2, content: "There was a lantern burning where the wall meets the water." },
		{ id: 3, content: "A second lantern hung further along the wall, over the sluice." },
		{ id: 4, content: "The lantern kept going out and somebody kept relighting it." },
		{ id: 5, content: "Then the water rose over the flat stones the way it always does." },
		{ id: 6, content: "We slept under the hedge with the lantern out and the tide in." }
	],
	entries: [
		{
			id: 1,
			name: "Harbour Company Incorporate Ratified Perpetual Chartered Endowed Sealed",
			keys: "lantern",
			content: "They hold the lease on everything between the two bridges."
		},
		{
			id: 2,
			name: "Nightfall Concord",
			keys: "lantern",
			content: "A treaty signed at dusk between two houses who could not agree by day."
		}
	]
}

/**
 * Two entries whose only shared vocabulary is a word the conversation never
 * stops saying.
 *
 * **The world that can see BM25's idf, as distinct from BM25's scorer** — and
 * not the *collection* that idf is taken over, which is `POOL_VOCABULARY`
 * below. `LENGTH` above can see neither, and the arithmetic says why in one
 * line: both of its entries are keyed `lantern`, so any change to what
 * `lantern` is worth multiplies both scores by the same constant and
 * `normaliseTfidf` divides it straight back out. Every fixture before this one
 * had that shape. A world that observes the idf needs the two entries to key on
 * terms whose *weights differ from each other*, and to differ at the one place
 * the two idf forms disagree.
 *
 * That place is `df = N`. `buildIdf` is `log(N / (1 + df))` floored at zero, so
 * a term in **every document of its collection** is worth exactly nothing;
 * BM25's `log((N − df + 0.5) / (df + 0.5) + 1)` never crosses zero and makes it
 * worth a little. The shipped `overlap` reading counts *messages*, and `gate`
 * and `wall` are each in all six of them, so both entries score a flat 0 and
 * tie to fifteen decimal places — a tie that falls through to authored order.
 *
 * Under `balanced` they separate, and only the idf separates them:
 *
 *   · `balanced` counts the **entry pool** (see `buildBm25Idf`), where each key
 *     is in exactly one of the two entries — so both get the *same* weight,
 *     `log((2 − 1 + 0.5) / 1.5 + 1)` = 0.6931, where the plain form over
 *     messages gives both a floored 0;
 *   · `wall` is said 8 times in the window and `gate` 6, over 6 guaranteed
 *     messages — and the query half saturates on the document half's curve, so
 *     what reaches the score is `(8·2.2/9.2)/6` and `(6·2.2/7.2)/6` rather than
 *     8/6 and 6/6;
 *   · both documents are three tokens long (one key, a two-token title none of
 *     whose words the conversation says) and each matches its key once, so
 *     BM25's saturation and length normalisation contribute the *identical*
 *     factor of 1 to both and cancel out of the comparison entirely.
 *
 * 0.2210 against 0.2118 — the **24/23** of the two saturated word counts, and
 * nothing else. It was 0.9242 against 0.6931, the raw 4:3, while the query half
 * multiplied by the count; two terms both said many times are supposed to be
 * nearly worth the same, and this world is the smallest place that shows it.
 * Hand the saturated reading `buildIdf`'s map instead and both go to 0, the tie
 * comes back and the order below reverts to `[1, 2]`. Measured by doing it.
 *
 * ⚠ **What this world was built for, and what it demonstrates now.** Its six
 * messages were written so that `df = N` *over messages*, which was where the
 * two forms disagreed while both of them read the conversation. `balanced`
 * reads the pool now, so that construction carries the `overlap` half above and
 * nothing else: the `balanced` half separates because a key in one entry of two
 * is rare *in the lorebook*. Every ordering assertion below is unchanged and
 * still holds — what moved is the reason, and the numbers above are re-derived
 * rather than re-fitted. What the world cannot see is the **collection**: its
 * two keys have the same document frequency as each other whether you count
 * messages or entries, so the ratio is reachable from both. Nor can it see
 * whether the query half saturates, in the sense that matters — the curve
 * moved 4:3 to 24/23 and both are the same ordering, so only the control
 * fixture's ratio records it. `LITANY` is the world where that half decides
 * something.
 */
const UBIQUITOUS: CorpusWorld = {
	about: "two entries keyed on words that are in every single message",
	messages: [
		{ id: 1, content: "We came up to the wall at the north gate and found the wall unwatched." },
		{ id: 2, content: "The gate was open and the wall above it was empty of anyone at all." },
		{ id: 3, content: "Someone had painted a mark on the wall beside the gate in white." },
		{ id: 4, content: "The wall runs from the gate down to the water and the wall is old." },
		{ id: 5, content: "We slept under the wall and watched the gate until the morning." },
		{ id: 6, content: "By first light the gate was shut and the wall had a man on it." }
	],
	entries: [
		{
			id: 1,
			name: "Northgate Company",
			keys: "gate",
			content:
				"A chartered company that holds the lease on everything between the bridges."
		},
		{
			id: 2,
			name: "Wallward Company",
			keys: "wall",
			content:
				"A chartered company that holds the lease on everything between the bridges."
		}
	]
}

/**
 * A word the conversation says rarely and the lorebook says constantly.
 *
 * **The world that can see which collection the idf is taken over**, which is
 * the one thing `UBIQUITOUS` above cannot: moving the collection changes which
 * entries win, and a fixture that would pass either way is not evidence about
 * it.
 *
 * The construction is a deliberate inversion, and both halves are needed
 * because the two readings only disagree where the two orderings do:
 *
 *   · **in the conversation** `lantern` is the rarer word — twice in one
 *     message, where `hedge` is once each in two — so every reading that
 *     counts *messages* puts the lantern entry first: 1.0986 against 0.6931
 *     under the shipped plain form, 1.5404 against 1.0296 under BM25's, which
 *     is what this branch scored with before the collection moved;
 *   · **in the lorebook** it is the commonest — four of the five entries have
 *     it in their document and only one has `hedge` — so counting *entries*
 *     makes it worth 0.2877 against 1.3863 and the hedge entry wins;
 *   · the query halves are **equal**: both words occur twice in the window, so
 *     the flip is the idf and not the term frequency;
 *   · the two competing entries are the same document length (one key, a
 *     one-token title) and each matches its key once, so BM25's saturation and
 *     length normalisation contribute an identical factor to both and cancel —
 *     the scorer that arrived with the idf cannot move this world either.
 *
 * ⚠ **Three of the five entries never reach the prompt, and they are what makes
 * the difference.** Their keys are words this conversation never says, so they
 * are skipped as missed — but they are in the pool, and the pool is what
 * `buildBm25Idf` counts. That is the textbook reading stated as a fixture: the
 * collection is the corpus being searched, not the subset that matched.
 *
 * Both entries name a lantern somewhere in their own text, which looks like
 * scenery and is not: `lantern` is a gazetteer entity here (it is a token of
 * three entry titles), so an entry that did not mention it would score lower on
 * `entityCooccurrence` and the fixture would be measuring two signals at once.
 * With both sharing it the entity term is identical, `keyword` is 1 for both,
 * `nameMatch` 0 for both, and both were last referenced in the final message —
 * so `tfidf` is the only signal that differs, by construction.
 */
const POOL_VOCABULARY: CorpusWorld = {
	about: "a word that is rare in the conversation and ordinary in the lorebook",
	messages: [
		{ id: 1, content: "We came down out of the pass before dark, all four of us." },
		{ id: 2, content: "The hedge along the road was thorn and it kept the wind off." },
		{ id: 3, content: "We made camp and waited for the morning to come round." },
		{ id: 4, content: "Nobody slept much and the fire went out twice before dawn." },
		{ id: 5, content: "By first light we were on the road again and moving slow." },
		{
			id: 6,
			content:
				"Somebody had hung a lantern by the door and a second lantern over the hedge."
		}
	],
	entries: [
		{
			id: 1,
			name: "Lanternwrights",
			keys: "lantern",
			content: "A guild that keeps the harbour lights burning."
		},
		{
			id: 2,
			name: "Hedgeward",
			keys: "hedge",
			content:
				"The office that cuts the thorn boundary and hangs a lantern at every gate."
		},
		// The three the conversation cannot reach. They are here to be counted,
		// not to be found: each puts `lantern` in the pool a second, third and
		// fourth time, which is the whole difference between the two readings.
		{
			id: 3,
			name: "Lantern Oil",
			keys: "brine",
			content: "Rendered from fish, and it smells like it."
		},
		{
			id: 4,
			name: "Lantern Rope",
			keys: "tallow",
			content: "Waxed cord that does not rot in the damp."
		},
		{
			id: 5,
			name: "Lantern Glass",
			keys: "cordage",
			content: "Blown thin and blued against the salt."
		}
	]
}

/**
 * A conversation that will not stop saying one ordinary word.
 *
 * **The world that can see the *query* half saturate**, which is the half
 * `LENGTH`, `UBIQUITOUS` and `POOL_VOCABULARY` are all blind to: each of those
 * pairs its two entries on terms the window says the same number of times, so
 * any curve applied to the conversation's term frequency scales both scores
 * alike and cancels. Seeing it needs two entries whose terms the conversation
 * says *very different numbers of times*, and it needs the stopword to be
 * common in the conversation while staying rare in the pool — which is the
 * exact shape of the defect the header records.
 *
 * The construction, and every part of it is load-bearing:
 *
 *   · `the` is said **18 times** across the six messages but appears in only
 *     **four** of them. The count is what the query half multiplies by; the
 *     four is what keeps `buildIdf`'s message reading from flooring it to zero,
 *     which is what lets the shipped `overlap` reading see the term at all.
 *     Without that second half the world would be blind to `lexicalScoring`.
 *   · **`the` is in four of the eight pool documents**, so `buildBm25Idf` gives
 *     it `log(4.5/4.5 + 1)` = 0.6931 — a real weight, because a document of
 *     `keys + title` is too short for a stopword to be everywhere in it. Four
 *     of eight is not contrived: it is the ratio `CONTENDED` has.
 *   · **`Longhall` matches one key the window says once and carries `the` in
 *     its title. `Ashfell` matches three keys the window says once each** and
 *     carries no stopword. So the stopword is the whole of the difference
 *     between the two, and the pair is a straight question about how much a
 *     much-repeated function word is allowed to be worth.
 *   · **every document in the pool is four tokens long and every matched term
 *     occurs in it once**, so BM25's length normalisation and its *document*
 *     saturation contribute an identical factor of exactly 1 to both entries
 *     and cancel out of the comparison entirely. The scorer's other half cannot
 *     move this world; only the query half and the idf can.
 *   · **all four content keys are in the same message**, so both entries were
 *     last referenced at the same index and `lastRefRecency` ties to the bit.
 *     Neither name is in the conversation, so `nameMatch` is 0 for both; the
 *     window names no gazetteer entity at all, so `entityCooccurrence` is 0 for
 *     both. `tfidf` is the only signal that differs, by construction.
 *   · **six of the eight entries are unreachable** — their keys are words this
 *     conversation never says. They are in the pool to be counted, exactly as
 *     `POOL_VOCABULARY`'s three are: they are what fixes `the`'s document
 *     frequency at four of eight and the mean document length at four.
 *
 * ⚠ **What it measures, in three readings rather than two.** The fixture
 * asserts the first and third; the second is the perturbation, and it is a
 * perturbation of the *scorer* because no config knob reaches the query half
 * on its own:
 *
 *   · `overlap`, the shipped reading — `Longhall` first. `the` is worth
 *     `log(6/5)` = 0.1823 over messages, times 18/6, which is 0.5470 against
 *     `Ashfell`'s three content keys at 0.1831 each.
 *   · `balanced` **with the query half unsaturated**, which is what the pool
 *     idf alone produced — `Longhall` first and by more: 2.378 against 0.896,
 *     the stopword now worth 2.0794 of it. *Moving the collection did not fix
 *     this; it is what caused it.*
 *   · `balanced` as it stands — **`Ashfell` first**, 0.896 against 0.537, with
 *     the stopword down to 0.2383. Measured by reverting `saturate`'s query
 *     call and running it: with the raw count restored the order below flips
 *     back to `[1, 2]` and the fixture fails.
 */
const LITANY: CorpusWorld = {
	about: "one word said eighteen times, against three words said once each",
	messages: [
		{
			id: 1,
			content:
				"The fog came off the water and the whole of the lower town went quiet under the wall."
		},
		{
			id: 2,
			content:
				"By the second bell the streets were empty and the lamps by the arch were still lit."
		},
		{
			id: 3,
			content:
				"Nobody would say what that noise was, only that it came twice."
		},
		{
			id: 4,
			content:
				"We waited by the arch until the fog thinned and the cold got into the marrow of the four of us."
		},
		{
			id: 5,
			content:
				"The warden on the sluice would not open the gate, and the mole stayed shut."
		},
		{
			id: 6,
			content: "By morning fog had gone and nobody spoke of it again."
		}
	],
	entries: [
		{
			id: 1,
			name: "The Long Hall",
			keys: "warden",
			content: "Where the watch is set and the night's orders are read out."
		},
		{
			id: 2,
			name: "Ashfell",
			keys: "sluice, gate, mole",
			content: "The harbour works, and the three men who between them run it."
		},
		// The six the conversation cannot reach. Each is four tokens as a
		// document and three of them carry `the`, which is what fixes the mean
		// length at four and `the`'s document frequency at four of eight.
		{
			id: 3,
			name: "The Tallow Yard",
			keys: "brine",
			content: "Rendered from fish, and it smells like it."
		},
		{
			id: 4,
			name: "The Rope Quay",
			keys: "cordage",
			content: "Waxed cord that does not rot in damp."
		},
		{
			id: 5,
			name: "The Millstone Guild",
			keys: "quern",
			content: "They cut and dress stone, and nothing else."
		},
		{
			id: 6,
			name: "Fenwick Potters",
			keys: "kiln, marl",
			content: "Red ware, fired badly, sold cheaply."
		},
		{
			id: 7,
			name: "Basket Makers",
			keys: "withy, osier",
			content: "Cut in winter and soaked before working."
		},
		{
			id: 8,
			name: "Caulkers Wharf",
			keys: "pitch, oakum",
			content: "Hot work, and it stains everything it touches."
		}
	]
}

/**
 * A conversation that says the singular of a key written plural.
 *
 * The everyday failure trigram folding exists for, and one no exact matcher of
 * any mode can reach: `riders` is not a substring of `rider`, and no word
 * boundary helps. Their trigrams overlap 0.75, comfortably over
 * `TRIGRAM_MIN_COVERAGE`.
 */
const INFLECTION: CorpusWorld = {
	about: "a key written plural, a conversation that says the singular",
	messages: [
		{ id: 1, content: "We came down out of the pass before dark." },
		{ id: 2, content: "One rider came back alone, and would not say from where." },
		{ id: 3, content: "The ford was up and we did not care to try it after that." },
		{ id: 4, content: "We made camp and waited for the morning to come round." }
	],
	entries: [
		{
			id: 1,
			name: "The Ashguard",
			keys: "riders",
			content: "An order of oathbound horse who patrol the wastes beyond the wall."
		},
		{
			id: 2,
			name: "The Ford",
			keys: "ford",
			content: "A shallow crossing, passable except after rain."
		}
	]
}

/**
 * An entry the conversation reaches, and one only *that entry* reaches.
 *
 * Nothing in the conversation says *Tollwright*; the ford's own body does. One
 * pass over the window can never find the second entry, which is the whole
 * reason recursion exists and the reason its ceiling is a retrieval parameter
 * rather than a property of a lorebook.
 */
const CHAINED: CorpusWorld = {
	about: "an entry only another entry's content names",
	messages: [
		{ id: 1, content: "We came down out of the pass before dark." },
		{ id: 2, content: "They asked after the ford and we told them where it was." },
		{ id: 3, content: "We made camp and waited for the morning to come round." }
	],
	entries: [
		{
			id: 1,
			name: "The Ford",
			keys: "ford",
			content: "A shallow crossing kept by the Tollwright family since the war."
		},
		{
			id: 2,
			name: "Tollwright",
			keys: "tollwright",
			content: "They have held the crossing rights for six generations."
		}
	]
}

/**
 * A key that lives inside an ordinary word.
 *
 * `art` is in `hearth`, which is the example the parameter's own declaration
 * uses — *"`art` fires on hearth, `elf` on self"*. The entry declares its own
 * match mode, which is the control that reaches the scan; see the finding in
 * this file's header about the node-level one, which does not.
 */
const SUBSTRING_TRAP: CorpusWorld = {
	about: "a three-letter key that is inside a word nobody meant",
	messages: [
		{ id: 1, content: "We came down out of the pass before dark." },
		{ id: 2, content: "The hearth was cold and the kettle had been off it for hours." },
		{ id: 3, content: "We made camp and waited for the morning to come round." }
	],
	entries: [
		{
			id: 1,
			name: "The Guild of Arts",
			keys: "art",
			content: "Painters, mostly, and a few who only claim to be."
		},
		{
			id: 2,
			name: "The Kettle",
			keys: "kettle",
			content: "Iron, dented, and older than anyone still carrying it."
		}
	]
}

/**
 * A keyless entry the conversation is entirely about.
 *
 * `ranking/keylessCorpus.test.ts` asserts what the admission gate *admits*;
 * this world exists for the question that one does not ask — what an
 * evidence-admitted entry does once it has to **compete for a budget** against
 * entries an author keyed. Design §4's third property is that determinism
 * remains available, and the shape of that promise under contention is what
 * this holds.
 */
const KEYLESS_COMPETITOR: CorpusWorld = {
	about: "an entry with no keys at all, competing against ones with keys",
	cast: [{ name: "Vell", ref: { kind: "character", id: 7 } }],
	messages: [
		{ id: 1, content: "The riders came down from the wastes before dark." },
		{ id: 2, content: "Vell would not say how many of them there were." },
		{ id: 3, content: "They asked after the ford and we told them where it was." },
		{ id: 4, content: "The wastes are no place to winter, whatever they say." },
		{ id: 5, content: "Vell says the riders answer to nobody in the city." }
	],
	entries: [
		{
			id: 1,
			name: "The Ford",
			keys: "ford",
			content: BODY("A shallow crossing, passable except after rain.")
		},
		{
			id: 2,
			name: "The Ashguard",
			keys: "",
			content: BODY(
				"An order of oathbound riders who patrol the wastes and answer to Vell."
			)
		},
		{
			id: 3,
			name: "Saltmarsh Road",
			keys: "road",
			content: BODY("The old trade route south, abandoned since the bridge fell.")
		}
	]
}

/**
 * A conversation written the way roleplay is actually written.
 *
 * ⚠ **The corpus was blind to the extractor.** Every world above states its
 * conversation in flat third-person narration — no dialogue, no contractions —
 * so `extractEntities` had nothing to get wrong in any of them, and a change to
 * *what gets extracted* moved 0 of 227 prose passages in this directory.
 * Measured, on the two defects this world exists for: quote-then-tag merged the
 * quote with the speaker into one unmatchable key (`Emberfall," Cade`), and
 * `I'm` was an entity. Both are invisible here without a world that speaks.
 *
 * Held equal by construction, so what moves is the extractor and not something
 * else:
 *
 *   · **the entry that has to be admitted has no keys at all** and a title the
 *     conversation never says, so `keyword` and `nameMatch` are both 0 and only
 *     evidence can let it in — the same construction `KEYLESS_COMPETITOR` uses;
 *   · **`Emberfall` is in that entry's body and in no other**, so the entity
 *     term is what discriminates rather than shared vocabulary;
 *   · **`Cade` is in no entry at all**, so the speaker the fix recovers cannot
 *     flatter the result — it is there to be observed in the diagnostics, not
 *     to score.
 */
const SPOKEN_ALOUD: CorpusWorld = {
	about: "a conversation in dialogue, whose names live in the tags",
	cast: [{ name: "Vell", ref: { kind: "character", id: 7 } }],
	messages: [
		{ id: 1, content: '"They have taken Emberfall," Cade said.' },
		{ id: 2, content: '"They told me I\'m not welcome," Vell answered.' },
		{ id: 3, content: '"Emberfall!" Cade shouted. "Nobody is going back."' },
		{ id: 4, content: '"I\'ll go by the ford, then," Cade said.' },
		{ id: 5, content: '"I\'m sorry," Vell said. "Emberfall is gone."' }
	],
	entries: [
		{
			id: 1,
			name: "The Ford",
			keys: "ford",
			content: BODY("A shallow crossing, passable except after rain.")
		},
		{
			id: 2,
			name: "The Siege",
			keys: "",
			content: BODY(
				"The wall at Emberfall fell in a night and nobody has held it since."
			)
		},
		{
			id: 3,
			name: "Saltmarsh Road",
			keys: "road",
			content: BODY("The old trade route south, abandoned since the bridge fell.")
		}
	]
}

// ─── The fixtures ───────────────────────────────────────────────────────────

/**
 * A stub and an article, alike in every scored signal but length.
 *
 * **The world that can see `density`**, which nothing could until the scan
 * started producing it. `densitySignal` had lived in `ranking/signals.ts` with
 * no caller for as long as `SignalWeights.density` had lived in `weights.ts`
 * with nothing to weigh and `signalDensity` had been declared, stored and
 * resolved on `core:task/rank-hybrid@1` — a helper, a weight and a control, all
 * three real, none of them joined to the other two.
 *
 * Everything else is held equal *by construction*, which is what makes the
 * fixture a measurement rather than a demonstration:
 *
 *   · **the same single key**, matched, so `keyword` is 1 for both and
 *     `proximity` is 0 for both (`keywordMatch` needs two exact hits);
 *   · **one-word titles the conversation never says**, so `nameMatch` is 0 and
 *     neither title contributes to `tfidf` — the shared key is then the whole
 *     scored document, identical twice over;
 *   · **lower case throughout and no cast**, so the entity profile is empty and
 *     `entityCooccurrence` is 0 for both — the same precaution
 *     `semanticCorpus.int.test.ts` takes and for the same reason;
 *   · **the same key**, so both were last referenced in the same message and
 *     `lastRefRecency` is equal too.
 *
 * They therefore tie *exactly* under the shipped weights and fall through to
 * authored position. The only thing that can separate them is that one of them
 * is ten times longer than the other.
 *
 * ⚠ **Density and cost are the same underlying quantity**, and the second
 * assertion is where that bites: a longer entry is a better-scoring entry
 * *and* a more expensive one, so weighting density is a decision to spend more
 * of a fixed window on fewer entries. That is a real property of the control
 * rather than a flaw in the fixture, and it is why the weight ships at 0.
 */
const STUB_AND_ARTICLE: CorpusWorld = {
	about: "two entries on one key, one a one-line stub and one a real article",
	messages: [
		{ id: 1, content: "we came down out of the pass before dark, all four of us" },
		{ id: 2, content: "there was a lantern burning where the wall meets the water" },
		{ id: 3, content: "the lantern kept going out and somebody kept relighting it" }
	],
	entries: [
		{
			id: 1,
			name: "stub",
			keys: "lantern",
			content: "a lamp on a post."
		},
		{
			id: 2,
			name: "article",
			keys: "lantern",
			content:
				"a lamp on a post, lit at dusk by whoever draws the short straw, " +
				"kept in oil out of the harbour fund, and put out again at the " +
				"turn of the tide unless the boats are still out, in which case " +
				"it burns until the last of them is tied up and counted."
		}
	]
}

/**
 * Two entries whose keys are said the same number of times overall, and a
 * different number of times *recently*.
 *
 * **The world that can see `guaranteedMessages`**, which was engine-read and
 * declared nowhere: `keywordQuery` has always taken it off `RetrievalParams`,
 * where the only value it could hold was a hardcoded 10. It is the window
 * `tfidf` counts term frequencies over and the window
 * `speakerCooccurrenceSignal` asks "did this character speak" over — two live
 * signals tuned by a constant no panel could reach.
 *
 * Held equal by construction so that the window is the only thing that can
 * separate the two entries:
 *
 *   · **one key each, both matched**, so `keyword` is 1 for both and
 *     `proximity` 0 for both;
 *   · **both keys said once in the final message**, so both were last
 *     referenced in the same place and `lastRefRecency` is identical — without
 *     that line the recent entry wins the baseline and the fixture measures
 *     nothing;
 *   · **each key in exactly one earlier message**, so `buildIdf` — which reads
 *     every message and not the guaranteed window — gives them the same weight;
 *   · **identical content lengths**, so `density` is 1 for both;
 *   · **one-word titles the conversation never says, lower case throughout, no
 *     cast**, so `nameMatch` and `entityCooccurrence` are 0 for both.
 *
 * *ember* is said three times early and once at the end; *warden* three times
 * late and once at the end. Over the whole conversation that is four apiece —
 * a tie, which falls through to authored order — and over the last two messages
 * it is one against four.
 */
const RECENT_VOCABULARY: CorpusWorld = {
	about: "two keys said equally often overall and unequally often just now",
	messages: [
		{ id: 1, content: "the ember and the ember and the ember over the sluice" },
		{ id: 2, content: "we came down out of the pass before dark, all four of us" },
		{ id: 3, content: "the road was bad and the mule threw a shoe on the way" },
		{ id: 4, content: "so we made camp and waited for the morning to come round" },
		{ id: 5, content: "the warden and the warden and the warden at the gate" },
		{ id: 6, content: "there was an ember by the warden when we left" }
	],
	entries: [
		{ id: 1, name: "one", keys: "ember", content: "aaaa bbbb cccc dddd eeee." },
		{ id: 2, name: "two", keys: "warden", content: "aaaa bbbb cccc dddd eeee." }
	]
}

describe("the corpus can see lore ranking at all", () => {
	/**
	 * The measurement that made this corpus necessary, run the other way round.
	 *
	 * The parity lane set every lore signal weight to 0 and all eleven gate
	 * fixtures stayed byte-identical. That is the exact perturbation here, and
	 * if this fixture also failed to move there would be no point in any of the
	 * others: the corpus would be blind in precisely the documented way.
	 */
	it("changes what reaches the prompt when every lore weight goes to zero", () => {
		const shipped = runWorld(CONTENDED, { budget: FITS_FIVE })
		// Five of eight, which is what makes an ordering change at the boundary
		// a membership change. If this ever admits all eight the world has
		// stopped contending and every assertion standing on it is worthless.
		expect(shipped.order).toEqual([7, 1, 3, 4, 5])
		expect(shipped.selection.excluded.length).toBe(3)

		const blind = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			signals: noSignals()
		})
		// Everything ties, so `select` falls through to authored order — which
		// is the shape "nothing is ranked" takes, and is visibly a different
		// five entries: the entry the conversation names by title is out, and
		// the one that matches a third of its keys is in.
		expect(blind.order).toEqual([1, 2, 3, 4, 5])
		expect(blind.admitted).not.toEqual(shipped.admitted)
	})

	/**
	 * The second half of the same measurement: the three mechanism strengths
	 * are invisible to all eleven gate fixtures at every value.
	 */
	it("changes what reaches the prompt when a mechanism strength moves", () => {
		const shipped = runWorld(CONTENDED, { budget: FITS_FIVE })

		// "Keys only" — the readable way to say it, and the first thing a
		// reader who distrusts fuzzy retrieval would reach for. Same five
		// entries, in a different order, which the rendered `World lore` object
		// carries as its key order.
		const noName = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			mechanisms: { name: 0 }
		})
		expect(noName.order).toEqual([3, 7, 5, 1, 4])
		expect(noName.order).not.toEqual(shipped.order)

		// The other direction, and this one changes the *set*: with literal
		// matching switched off the entry that matched half its keys overtakes
		// the one that matched both of its.
		const noKeyword = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			mechanisms: { keyword: 0 }
		})
		expect(noKeyword.order).toEqual([7, 1, 3, 4, 6])
		expect(noKeyword.admitted).not.toEqual(shipped.admitted)
	})

	/**
	 * ⚠ A control case, and the reason the two above are about mechanism
	 * strengths rather than about arithmetic in general.
	 *
	 * 1 has to be *arithmetically* what already happens or every install's
	 * prompts would change the day the control shipped — and `semantic` has to
	 * subtract nothing when no candidate carries the signal, which is the
	 * plan's second governing rule at its smallest scale. Nothing in this file
	 * ever loads an embedding model, so the semantic strength is switched
	 * between 1 and 0 over a pool where it multiplies zero either way.
	 */
	it("is unmoved by a mechanism no candidate here carries", () => {
		const shipped = runWorld(CONTENDED, { budget: FITS_FIVE })
		const neutral = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			mechanisms: { keyword: 1, name: 1, semantic: 1 }
		})
		const noSemantic = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			mechanisms: { semantic: 0 }
		})

		expect(neutral.order).toEqual(shipped.order)
		expect(noSemantic.order).toEqual(shipped.order)
	})

	/**
	 * The entity overlap, whose weight was re-sized (0.2 → 0.35) in the same
	 * change that graded the measure — design §13.10's whole point being that
	 * grading without re-weighting makes a signal more correct and less
	 * influential at once. Nothing in the gate corpus can see either half.
	 */
	it("changes what reaches the prompt when the entity overlap is switched off", () => {
		const shipped = runWorld(CONTENDED, { budget: FITS_FIVE })
		const off = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			signals: { worldLore: { entityCooccurrence: 0 } }
		})
		expect(off.order).toEqual([7, 3, 5, 1, 4])
		expect(off.order).not.toEqual(shipped.order)

		// ⚠ A float, and one of the two this file allows: the fixture's whole
		// standing rests on the signal having a *spread* here, and the day the
		// cast or the lore vocabulary drifts apart it will quietly go back to
		// scoring 0 everywhere — which is bug 17, and which no amount of
		// ordering assertion above would notice.
		const scores = CONTENDED.entries.map(
			(e) => shipped.signalsOf(e.id).entityCooccurrence ?? 0
		)
		expect(scores.some((v) => v > 0)).toBe(true)
		expect(new Set(scores).size).toBeGreaterThan(1)
	})

	/**
	 * ⚠ **This world is blind to both lexical controls at the prompt, was
	 * briefly sighted about one of them, and the reason it stopped is the
	 * point of the fixture.**
	 *
	 * Three states, in order, because the middle one is a defect and a fixture
	 * that only shows the ends looks like it was refitted:
	 *
	 *   1. **Originally blind.** Neither `lexicalScoring` nor `titleWeight`
	 *      changed what reached the model here: both moved `tfidf`, and the
	 *      entry each favoured was going to be in the prompt anyway. This
	 *      fixture asserted that, and said so.
	 *   2. **Sighted, by a defect.** When BM25's idf moved from messages to the
	 *      entry pool, `the` — in four of these eight documents but in all ten
	 *      messages — went from an idf of 0.0465 to 0.6931, and the query half
	 *      still multiplied by the raw 21 occurrences for a weight of 2.1. One
	 *      stopword in a title became worth 1.4556, about three quarters of
	 *      those entries' whole lexical score. `Stonefast` (8), keyword-stuffed
	 *      with eight content keys and no article, led the world on `tfidf`
	 *      under `overlap` and fell to **sixth of eight** under `balanced`; 5
	 *      (`The Ember Tide`) rose past 4 (`Commander Vell`) and the prompt
	 *      order became `[7, 1, 3, 5, 4]`. That is what this fixture asserted,
	 *      as a record of the defect rather than as a target.
	 *   3. **Blind again, correctly.** With the query half saturated, `the`
	 *      arrives as 2.0811 rather than 21 and is worth 0.1443 — 29% of entry
	 *      5's score where it was 77%. `Stonefast` is third of eight rather
	 *      than sixth, 5 falls back below 4, and `balanced` returns the same
	 *      prompt as `overlap`.
	 *
	 * So the world goes back to what it was: a world whose contention is
	 * decided by the other five signals, where a lexical reading moves numbers
	 * and moves nobody across the band boundary. Said rather than banked, and
	 * `LITANY` is the world built so the query half *can* move a prompt.
	 *
	 * ⚠ **The signals still part company, and the assertions below say where**,
	 * so this is a fixture about a control that is observable-but-inert rather
	 * than one that has quietly stopped being wired.
	 */
	it("reads the eight differently under `balanced` and still ships the same prompt", () => {
		const shipped = runWorld(CONTENDED, { budget: FITS_FIVE })
		const balanced = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			retrieval: { lexicalScoring: "balanced" }
		})
		const titled = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			retrieval: { titleWeight: 3 }
		})

		// The same five entries in the same order. `[7, 1, 3, 5, 4]` is what
		// this asserted while the stopword was carrying 5 past 4.
		expect(balanced.admitted).toEqual(shipped.admitted)
		expect(balanced.order).toEqual(shipped.order)
		expect(balanced.order).toEqual([7, 1, 3, 4, 5])

		// The two readings agree about the pair the stopword had inverted:
		// eight content keys out-score a two-word title beginning `The` under
		// both. The second of these is the assertion that used to run the
		// other way round.
		expect(shipped.signalsOf(8).tfidf).toBeGreaterThan(
			shipped.signalsOf(5).tfidf ?? 0
		)
		expect(balanced.signalsOf(8).tfidf).toBeGreaterThan(
			balanced.signalsOf(5).tfidf ?? 0
		)

		// And they are still two different readings, which is what stops the
		// two assertions above being a fact about one of them. `Stonefast` (8)
		// is the pool's lexical maximum under `overlap` — nothing is divided by
		// its length there — and 7 (`The Third Watch`, three of whose four
		// distinct terms message 8 says outright) is the maximum under
		// `balanced`.
		expect(shipped.signalsOf(8).tfidf).toBeGreaterThan(
			shipped.signalsOf(7).tfidf ?? 0
		)
		expect(balanced.signalsOf(7).tfidf).toBeGreaterThan(
			balanced.signalsOf(8).tfidf ?? 0
		)

		// ⚠ Still blind to the title weight too, and still said rather than
		// banked: the entry a raised weight favours was in the prompt either
		// way. `field weighting` below is the world built so it can move.
		expect(titled.order).toEqual(shipped.order)
	})
})

describe("the guaranteed window — how much conversation counts as now", () => {
	/**
	 * ⚠ **The control this corpus was blind to for the opposite reason.** Every
	 * other dead control found in this area was declared and unread;
	 * `guaranteedMessages` was **read and undeclared**, permanently 10, so there
	 * was nothing to move and no fixture could have noticed. It is declared on
	 * the three lore lanes and on `lorebook-triggers` now, defaulting to the 10
	 * it has always silently run at, and `runtime/loreScanDepth.int.test.ts`
	 * carries the row-to-scan half.
	 */
	it("is inert at the shipped 10, which is what makes declaring it safe", () => {
		// Six messages, so a window of 10 and a window of 6 are the same window.
		// Both entries then tie to the last bit and fall through to authored
		// order — the baseline the assertions below move away from.
		const shipped = runWorld(RECENT_VOCABULARY)
		const whole = runWorld(RECENT_VOCABULARY, {
			retrieval: { guaranteedMessages: 6 }
		})
		expect(shipped.order).toEqual([1, 2])
		expect(shipped.scoreOf(1)).toBe(shipped.scoreOf(2))
		expect(whole.order).toEqual(shipped.order)
		expect(whole.scoreOf(1)).toBe(shipped.scoreOf(1))
	})

	it("reorders the prompt when the window narrows to what is being said now", () => {
		const narrow = runWorld(RECENT_VOCABULARY, {
			retrieval: { guaranteedMessages: 2 }
		})
		// One `ember` against four `warden`s in the last two messages: the
		// entry the scene is *currently* about overtakes the one it was about
		// four messages ago, on the same keyword evidence.
		expect(narrow.order).toEqual([2, 1])
		expect(narrow.signalsOf(2).tfidf).toBeGreaterThan(
			narrow.signalsOf(1).tfidf!
		)
	})

	it("moves nothing else — the scan window is a separate control", () => {
		// The pair exists because a session of long posts wants a deep scan and
		// a short guarantee. Narrowing one must not narrow the other, or the
		// split is the old shared constant under two names.
		const narrow = runWorld(RECENT_VOCABULARY, {
			retrieval: { guaranteedMessages: 2 }
		})
		expect(narrow.diagnostics.scanDepth).toBe(10)
		expect(narrow.admitted).toEqual([1, 2])
	})
})

describe("density — how long an entry is against its pool", () => {
	/**
	 * ⚠ The finding, and it is the same shape as `proximity`'s: the fixture's
	 * *existence* is half the point. Until the scan wrote this number, the
	 * signal was not merely inert — it was unobservable, because no candidate
	 * anywhere carried the field at all.
	 */
	it("is a real spread here, which it was nowhere before", () => {
		const run = runWorld(STUB_AND_ARTICLE)
		const stub = run.signalsOf(1).density ?? 0
		const article = run.signalsOf(2).density ?? 0

		// Length against the pool's mean, capped at 1: the article is above
		// average and saturates, the stub is well under it.
		expect(article).toBe(1)
		expect(stub).toBeLessThan(0.2)
		expect(stub).toBeGreaterThan(0)
	})

	it("is inert at the shipped weight, which is why wiring it was safe", () => {
		// The two tie to the last bit and fall through to authored order. This
		// is what "producing the signal changes no score" means, asserted rather
		// than assumed.
		const shipped = runWorld(STUB_AND_ARTICLE)
		expect(shipped.order).toEqual([1, 2])
		expect(shipped.scoreOf(1)).toBe(shipped.scoreOf(2))
	})

	it("reorders the prompt once it is weighted", () => {
		const weighted = runWorld(STUB_AND_ARTICLE, {
			signals: { worldLore: { density: 0.3 } }
		})
		expect(weighted.order).toEqual([2, 1])
	})

	/**
	 * ⚠ The control half, and the honest limit of the signal — `tf-idf`'s
	 * `cannot be seen at all in a pool whose entries do not differ`, one signal
	 * over.
	 *
	 * `THE CONTENDED WORLD`'s eight entries are built through `BODY`, which pads
	 * every one of them to about the same length. Measured: their densities are
	 * 0.97, 0.98 and 1.00 — the cap swallows six of the eight outright — so the
	 * weight has almost nothing to multiply and moving it from 0.1 to 1 changes
	 * neither the order nor which five fit.
	 *
	 * That is the control's real shape rather than a defect in the fixture:
	 * `densitySignal` discriminates *below* the pool mean and saturates above
	 * it, so it is a slider for a book that mixes stubs with articles and a
	 * no-op for a book of even entries. Stated here so that a reader who turns
	 * it up and sees nothing has somewhere to find out why.
	 */
	it("cannot be seen at all in a pool whose entries are evenly sized", () => {
		const even = runWorld(CONTENDED)
		const densities = even.candidates.map((c) => c.signals.density ?? 0)
		expect(Math.min(...densities)).toBeGreaterThan(0.95)

		const shipped = runWorld(CONTENDED, { budget: FITS_FIVE })
		const weighted = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			signals: { worldLore: { density: 1 } }
		})
		expect(weighted.order).toEqual(shipped.order)
		expect(weighted.admitted).toEqual(shipped.admitted)
	})
})

describe("proximity — how tightly an entry's keys landed", () => {
	/**
	 * ⚠ The one fixture whose *existence* is the finding. Proximity is computed
	 * on every scan and weighted 0 in every shipped band, so it is inert by
	 * design — but it is also structurally unobservable across the whole
	 * existing corpus, because every lore entry in it has exactly one key and
	 * `keywordMatch` returns 0 for fewer than two exact hits.
	 *
	 * ⚠ The second of this file's two float assertions, and the same argument:
	 * if this world's entries ever become single-keyed the number goes to zero
	 * for both and the ordering assertion below still passes for the wrong
	 * reason.
	 */
	it("is a real spread here, which it is nowhere else", () => {
		const run = runWorld(SCATTERED_KEYS)
		const adjacent = run.signalsOf(1).proximity ?? 0
		const scattered = run.signalsOf(2).proximity ?? 0

		expect(adjacent).toBeGreaterThan(0.9)
		expect(scattered).toBeLessThan(0.3)
	})

	it("reorders the prompt once it is weighted", () => {
		// At the shipped weight of 0 the scattered entry wins, on nothing more
		// than having been referenced one message later. That is the status quo
		// the signal exists to improve on, asserted rather than assumed so the
		// improvement has something to be measured against.
		const shipped = runWorld(SCATTERED_KEYS)
		expect(shipped.order).toEqual([2, 1])

		const weighted = runWorld(SCATTERED_KEYS, {
			signals: { worldLore: { proximity: 0.3 } }
		})
		expect(weighted.order).toEqual([1, 2])
	})

	it("changes which entries fit when the pool contends", () => {
		const shipped = runWorld(CONTENDED, { budget: FITS_FIVE })
		const weighted = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			signals: { worldLore: { proximity: 0.3 } }
		})
		// The keyword-stuffed entry has its matched keys clustered in one
		// sentence, so weighting the clustering is what puts it in the prompt
		// at the cost of an entry whose two keys are four messages apart.
		expect(weighted.order).toEqual([7, 1, 3, 8, 4])
		expect(weighted.admitted).not.toEqual(shipped.admitted)
	})
})

describe("tf-idf — how much of the conversation an entry is about", () => {
	it("is what separates two otherwise identical entries", () => {
		const run = runWorld(VOCABULARY)
		const rare = run.signalsOf(1).tfidf ?? 0
		const spoken = run.signalsOf(2).tfidf ?? 0

		// Unequal, which is the property `normaliseTfidf` cannot manufacture:
		// dividing the pool by its own maximum preserves ratios and destroys
		// nothing but scale, so a pool whose members agree stays agreed.
		expect(spoken).toBeGreaterThan(rare)
		// And everything else ties, so the order below has exactly one cause.
		expect(run.signalsOf(1).keyword).toBe(run.signalsOf(2).keyword)
		expect(run.signalsOf(1).lastRefRecency).toBe(
			run.signalsOf(2).lastRefRecency
		)
		expect(run.signalsOf(1).nameMatch).toBe(run.signalsOf(2).nameMatch)
	})

	it("moves the prompt at the weight that actually ships", () => {
		// 0.1 — not a hypothetical setting somebody might choose one day. The
		// gate corpus is blind to this number as it stands today.
		const shipped = runWorld(VOCABULARY)
		expect(shipped.order).toEqual([2, 1])

		const off = runWorld(VOCABULARY, {
			signals: { worldLore: { tfidf: 0 } }
		})
		// A dead-exact tie, falling through to authored order.
		expect(off.order).toEqual([1, 2])
		expect(off.scoreOf(1)).toBe(off.scoreOf(2))
	})

	/**
	 * ⚠ **This ordering moved when `buildIdf` was floored at zero**, and it is
	 * the one fixture in the app that could see that change. Recorded rather
	 * than re-baselined, because the arithmetic is short enough to write down.
	 *
	 * `buildIdf` was `log(N / (1 + df))` unfloored, so a term in *every* message
	 * scored `log(N / (N + 1))` — negative. This world has exactly one such term:
	 * "the", in all ten messages, 21 occurrences, worth
	 * `(21 / 10) × log(10 / 11) = −0.2002` per occurrence in an entry's scored
	 * text. Four of the eight entries carry it, in their own **titles**: 1 *The
	 * Sluice Gate*, 3 *The Hedge Road*, 5 *The Ember Tide*, 7 *The Third Watch*.
	 * So each of the four was docked 0.2002 of raw tf-idf — and 8 *Stonefast*
	 * and 4 *Commander Vell* outranked them partly on the strength of not having
	 * a definite article in their name. The pool maximum is 0.8035 either way
	 * (entry 8, which has no "the" and did not move), and `normaliseTfidf`
	 * divides by `Math.max(1, max)`, so the shift reaches the score unscaled.
	 *
	 * At this weight that is 0.8 × 0.2002 = 0.1601 added to four scores:
	 *
	 * |   | before | after |
	 * |---|---|---|
	 * | 7 | 1.2732 | 1.4333 |
	 * | 3 | 1.0251 | 1.1853 |
	 * | 1 | 1.0073 | 1.1674 |
	 * | 8 | 1.0602 | 1.0602 |
	 * | 5 | 0.8824 | 1.0425 |
	 * | 4 | 0.9248 | 0.9248 |
	 *
	 * `[7, 8, 3, 1, 4]` → `[7, 3, 1, 8, 5]`: the three penalised entries rise
	 * past 8, and 5 rises past 4 into the last place the budget has. The new
	 * order is the correct one — a shared "the" is not evidence *against* an
	 * entry — and the old one was measuring which titles began with an article.
	 *
	 * ⚠ Only visible at 0.8. The `shipped` run's 0.1 moves the same four scores
	 * by 0.0200 each, which is too little to cross anything here, so the fix is
	 * invisible on the shipped path in this world — which is why the assertion
	 * below is on `loud` and the fixture had to dial the weight up at all.
	 */
	it("changes which entries fit when the pool contends", () => {
		const shipped = runWorld(CONTENDED, { budget: FITS_FIVE })
		const loud = runWorld(CONTENDED, {
			budget: FITS_FIVE,
			signals: { worldLore: { tfidf: 0.8 } }
		})
		expect(loud.order).toEqual([7, 3, 1, 8, 5])
		expect(loud.admitted).not.toEqual(shipped.admitted)
	})

	/**
	 * The control, and the reason the fixtures above are about tf-idf rather
	 * than about one lucky world. Design §10.1's first structural trap, made
	 * executable: a pool whose members do not differ cannot show a change in
	 * the weight applied to what they do not differ on, at any value.
	 */
	it("cannot be seen at all in a pool whose entries do not differ", () => {
		const shipped = runWorld(ONE_VOCABULARY)
		const off = runWorld(ONE_VOCABULARY, {
			signals: { worldLore: { tfidf: 0 } }
		})
		const loud = runWorld(ONE_VOCABULARY, {
			signals: { worldLore: { tfidf: 1 } }
		})

		expect(shipped.signalsOf(1).tfidf).toBe(shipped.signalsOf(2).tfidf)
		expect(off.order).toEqual(shipped.order)
		expect(loud.order).toEqual(shipped.order)
	})
})

describe("field weighting — a hit in the title against a hit in the keys", () => {
	it("is neutral at 1, and 1 is what ships", () => {
		const run = runWorld(WHICH_FIELD)
		// The two fields are one bag at 1, so the two entries are scored on
		// identical vocabulary. Anything else here would mean the neutral value
		// was not neutral — the way this control could quietly change every
		// install's prompts on upgrade.
		expect(run.signalsOf(1).tfidf).toBe(run.signalsOf(2).tfidf)
		expect(run.order).toEqual([1, 2])
	})

	it("reorders the prompt once the title is worth more", () => {
		const weighted = runWorld(WHICH_FIELD, { retrieval: { titleWeight: 3 } })
		expect(weighted.order).toEqual([2, 1])
		// The entry *titled* after what the conversation keeps saying now
		// outscores the one that merely lists it — the sentence the parameter's
		// declaration makes, measured.
		expect(weighted.signalsOf(2).tfidf).toBeGreaterThan(
			weighted.signalsOf(1).tfidf ?? 0
		)
	})
})

describe("lexical scoring — whether length and repetition win", () => {
	it("ignores length entirely on the shipped overlap reading", () => {
		const shipped = runWorld(LENGTH)
		// Identical keys, so identical scores: `overlap` adds a term's weight
		// once per occurrence and divides by nothing, and a title whose words
		// are in no message contributes nothing but length.
		expect(shipped.signalsOf(1).tfidf).toBe(shipped.signalsOf(2).tfidf)
		expect(shipped.scoreOf(1)).toBe(shipped.scoreOf(2))
		expect(shipped.order).toEqual([1, 2])
	})

	it("reorders the prompt once length is normalised away", () => {
		const balanced = runWorld(LENGTH, {
			retrieval: { lexicalScoring: "balanced" }
		})
		expect(balanced.order).toEqual([2, 1])
		expect(balanced.signalsOf(2).tfidf).toBeGreaterThan(
			balanced.signalsOf(1).tfidf ?? 0
		)
	})

	/**
	 * ⚠ **`LENGTH` above is blind to which idf `balanced` scores with**, and
	 * saying so is the point of the fixture below. Both of its entries key on
	 * the same word, so any change to that word's weight scales both of them
	 * and `normaliseTfidf` divides the scale back out — the corpus's first
	 * structural trap, met again in a new place. Swapping the idf under it
	 * leaves every assertion in this file green, which is exactly the shape of
	 * green that means nothing.
	 */
	it("scores with BM25's idf and not tf-idf's, which is a separate claim", () => {
		// Flat zero and a dead-exact tie: every term either entry could score
		// on is in every message, and the plain idf calls that worth nothing.
		const shipped = runWorld(UBIQUITOUS)
		expect(shipped.signalsOf(1).tfidf).toBe(0)
		expect(shipped.signalsOf(2).tfidf).toBe(0)
		expect(shipped.scoreOf(1)).toBe(shipped.scoreOf(2))
		expect(shipped.order).toEqual([1, 2])

		const balanced = runWorld(UBIQUITOUS, {
			retrieval: { lexicalScoring: "balanced" }
		})
		// A common word is worth *little*, which is not the same claim as worth
		// *nothing* — and the difference is the whole ordering here.
		expect(balanced.signalsOf(1).tfidf).toBeGreaterThan(0)
		expect(balanced.signalsOf(2).tfidf).toBeGreaterThan(
			balanced.signalsOf(1).tfidf ?? 0
		)
		expect(balanced.order).toEqual([2, 1])
	})

	/**
	 * The control, and the reason the fixture above is about the idf rather
	 * than about the scorer that arrived with it. Saturation and length
	 * normalisation contribute an identical factor to both of `UBIQUITOUS`'s
	 * entries — same document length, same single matched term — so with the
	 * idf held at the plain form the `balanced` run reproduces the `overlap`
	 * run's tie exactly. Only the idf can move this world.
	 *
	 * ⚠ **The ratio moved when the query half began to saturate, and it moved
	 * for a reason this world can state exactly.** It was the raw 8:6 of how
	 * often the conversation says each word. It is now the *saturated* 8:6,
	 * `(8·2.2/9.2) / (6·2.2/7.2)` = **24/23**, which is what saturation means:
	 * two terms both said many times are nearly worth the same, and the
	 * remaining 4% is what is left of a 33% gap. Re-derived rather than
	 * refitted — every other assertion in this describe block is unchanged,
	 * because a factor common to both entries still cancels.
	 */
	it("has nothing but the idf to move it, so the scorer alone cannot", () => {
		const balanced = runWorld(UBIQUITOUS, {
			retrieval: { lexicalScoring: "balanced" }
		})
		// The two documents are the same length and each matches its key once,
		// so the BM25 factor on the document side divides out and what is left
		// is the two query halves, each through the same saturation curve.
		expect(
			balanced.signalsOf(2).tfidf! / balanced.signalsOf(1).tfidf!
		).toBeCloseTo(24 / 23, 12)
	})

	/**
	 * ⚠ **The collection, which neither world above can see.**
	 *
	 * `LENGTH`'s two entries share a key, so its idf cancels out of the
	 * comparison entirely; `UBIQUITOUS`'s two keys have the same document
	 * frequency as each other under *either* reading, so its 4:3 is reachable
	 * from messages and from entries alike. Both would stay green if the
	 * collection were quietly moved back, which is the shape of green that
	 * means nothing. This is the assertion that would not.
	 */
	it("takes the idf over the pool being searched, not the conversation", () => {
		// `lantern` is the rarer word in the *conversation* — twice in one
		// message where `hedge` is once each in two — so the shipped reading,
		// whose idf counts messages, puts the lantern entry first.
		const shipped = runWorld(POOL_VOCABULARY)
		expect(shipped.order).toEqual([1, 2])
		expect(shipped.signalsOf(1).tfidf).toBeGreaterThan(
			shipped.signalsOf(2).tfidf ?? 0
		)

		// And it is the ordinary word in the *lorebook*: four of the five
		// entries carry it and one carries `hedge`. Counting the collection
		// being searched inverts which of the two words is evidence, and the
		// prompt with it.
		const balanced = runWorld(POOL_VOCABULARY, {
			retrieval: { lexicalScoring: "balanced" }
		})
		expect(balanced.order).toEqual([2, 1])
		expect(balanced.signalsOf(2).tfidf).toBeGreaterThan(
			balanced.signalsOf(1).tfidf ?? 0
		)

		// ⚠ The control, and the reason this fixture is about the collection
		// rather than the scorer that reads it. The two entries are the same
		// length and each matches its key once, so BM25's saturation and
		// length normalisation contribute an identical factor to both. Hand
		// the saturated reading the idf over *messages* instead and it scores
		// 0.567 against 0.379 — the shipped order, unmoved. Measured by doing
		// it.
		//
		// And the three entries no key of this conversation can reach are in
		// the collection all the same: the pool is the lorebook, not the hits.
		expect(missed(balanced)).toEqual([3, 4, 5])
	})

	/**
	 * ⚠ **The query half, which none of the three worlds above can see.**
	 *
	 * Each of them pairs its two entries on terms the conversation says the
	 * same number of times, so any curve applied to that count scales both
	 * scores alike and divides straight back out — the corpus's first
	 * structural trap, met a third time in a third place. `LITANY`'s two
	 * entries are separated by a word said eighteen times against words said
	 * once, which is the only shape that can observe it.
	 */
	it("saturates the conversation's own repetition, not just the entry's", () => {
		// The shipped reading multiplies by the raw 18. `the` is in four of
		// this world's six messages, so tf-idf's floor never reaches it and it
		// arrives worth 18/6 × 0.1823 = 0.5470, against three content keys at
		// 0.1831 each — and the entry that says almost nothing wins.
		const shipped = runWorld(LITANY)
		expect(shipped.order).toEqual([1, 2])
		expect(shipped.signalsOf(1).tfidf).toBeGreaterThan(
			shipped.signalsOf(2).tfidf ?? 0
		)

		// Saturated, those 18 occurrences are worth 2.0625 of one rather than
		// 18, and three words the conversation actually said beat one word it
		// could not stop saying.
		const balanced = runWorld(LITANY, {
			retrieval: { lexicalScoring: "balanced" }
		})
		expect(balanced.order).toEqual([2, 1])
		expect(balanced.signalsOf(2).tfidf).toBeGreaterThan(
			balanced.signalsOf(1).tfidf ?? 0
		)

		// ⚠ **Damped, and deliberately not suppressed** — the distinction
		// between this and a stopword list, stated as arithmetic. Entry 2 is
		// three content keys and entry 1 is one of the same worth plus `the`,
		// so a reading that made a stopword worth *nothing* would put the
		// ratio at exactly 1/3, and one that let it win would put it above 1.
		// It sits between: 0.599, which is `the` still carrying real weight
		// and no longer carrying the entry.
		const ratio =
			balanced.signalsOf(1).tfidf! / balanced.signalsOf(2).tfidf!
		expect(ratio).toBeGreaterThan(1 / 3)
		expect(ratio).toBeLessThan(1)

		// The world's own property, asserted because every claim above stands
		// on it. `proximity` is excluded and is the one signal that does
		// differ — entry 2 has three keys and entry 1 one — which decides
		// nothing at a shipped weight of 0.
		for (const signal of [
			"keyword",
			"nameMatch",
			"lastRefRecency",
			"entityCooccurrence"
		] as const)
			expect(balanced.signalsOf(1)[signal], signal).toBe(
				balanced.signalsOf(2)[signal]
			)

		// And the six the conversation cannot reach are counted all the same:
		// they are what makes `the` four documents of eight rather than one of
		// two, and the mean document length exactly four.
		expect(missed(balanced)).toEqual([3, 4, 5, 6, 7, 8])
	})
})

describe("trigram folding — inflection and typos", () => {
	it("brings in an entry no exact key could reach", () => {
		const shipped = runWorld(INFLECTION)
		expect(shipped.order).toEqual([2])
		expect(missed(shipped)).toContain(1)

		const folded = runWorld(INFLECTION, {
			retrieval: { trigramFolding: 0.6 }
		})
		expect(folded.admitted).toEqual([1, 2])
	})

	it("scores a fuzzy hit below an exact one, so it may only add", () => {
		const folded = runWorld(INFLECTION, {
			retrieval: { trigramFolding: 0.6 }
		})
		// The plan's second governing rule in one line of arithmetic: raising
		// the strength can add a match and can never take one away, because an
		// exact hit is worth 1 whatever this is set to.
		expect(folded.signalsOf(1).keyword).toBeLessThan(1)
		expect(folded.signalsOf(2).keyword).toBe(1)
	})
})

describe("recursion — an entry only another entry names", () => {
	it("finds nothing at the shipped ceiling of zero", () => {
		const shipped = runWorld(CHAINED)
		expect(shipped.order).toEqual([1])
		expect(shipped.diagnostics.recursionDepth).toBe(0)
	})

	it("brings the chained entry in when the ceiling is raised", () => {
		const deeper = runWorld(CHAINED, {
			retrieval: { maxRecursionDepth: 1 }
		})
		expect(deeper.admitted).toEqual([1, 2])
		// How deep it actually went, not how deep it was allowed to — the
		// difference between "recursion found nothing" and "recursion never
		// ran", which is the only thing the number is for.
		expect(deeper.diagnostics.recursionDepth).toBe(1)
	})
})

describe("the match mode an entry declares", () => {
	it("fires a three-letter key inside an ordinary word by default", () => {
		const shipped = runWorld(SUBSTRING_TRAP)
		// `art` inside `hearth`. Nobody wrote that key meaning this.
		expect(shipped.admitted).toEqual([1, 2])
	})

	it("stops firing it once the entry asks for whole words", () => {
		const strict: CorpusWorld = {
			...SUBSTRING_TRAP,
			entries: SUBSTRING_TRAP.entries.map((e) =>
				e.id === 1 ? { ...e, matchMode: "word" } : e
			)
		}
		const run = runWorld(strict)
		expect(run.order).toEqual([2])
		expect(missed(run)).toContain(1)
	})
})

describe("what the extractor pulls out of dialogue", () => {
	/**
	 * ⚠ **This fixture fails on the extractor that shipped before
	 * `core:extract/entities-heuristic@2`**, which is the only reason it is
	 * here: everything else in this directory passes on both, so nothing in
	 * `measure/` could observe a change to what gets extracted.
	 *
	 * The baseline half is the ordinary corpus shape — at the shipped threshold
	 * the keyless entry cannot get in — and the perturbation is the admission
	 * gate, exactly as `the admission gate, under a budget` moves it. What is
	 * new is *why* the gate can now see anything: the window has to yield
	 * `Emberfall` as an entity of its own, and under the old run builder it
	 * yielded `Emberfall," Cade`, a key with a quote and a comma in it that
	 * matches no entry text ever written.
	 */
	it("names the speaker and the place separately, so evidence can match", () => {
		const shipped = runWorld(SPOKEN_ALOUD)
		expect(shipped.order).toEqual([1])
		expect(missed(shipped)).toContain(2)

		const open = runWorld(SPOKEN_ALOUD, {
			retrieval: { admitThreshold: 0.3 }
		})
		expect(open.admitted).toEqual([1, 2])
		expect(open.diagnostics.admittedByEvidence).toBe(1)
		// The two halves of the dialogue tag, as two entities.
		expect(open.diagnostics.entities).toContain("Emberfall")
		expect(open.diagnostics.entities).toContain("Cade")
		expect(open.diagnostics.entities).not.toContain('Emberfall," Cade')
	})

	it("does not spend the window's entity budget on contractions", () => {
		/**
		 * The other defect, measured where it costs something rather than in a
		 * unit assertion.
		 *
		 * ⚠ The `I'm` that matters is the one in **message 2**, mid-sentence
		 * after "told me" — a sentence-*opening* contraction was already
		 * dropped by rule 1, which is what made this defect look rarer than it
		 * is. One mid-sentence occurrence puts the token in `corroborated`, and
		 * from then on every sentence-opening `I'm` in the window comes in with
		 * it: two entities here, resolving to nothing, diluting every entity
		 * rarity in `buildEvidenceProfile` and taking slots in `MAX_ENTITIES`
		 * from names that mean something.
		 */
		const run = runWorld(SPOKEN_ALOUD, { retrieval: { admitThreshold: 0.3 } })
		for (const junk of ["I'm", "I'll", "I'd", "I've"])
			expect(run.diagnostics.entities).not.toContain(junk)
	})
})

describe("the admission gate, under a budget", () => {
	it("puts a keyless entry in the prompt that nothing else could", () => {
		const shipped = runWorld(KEYLESS_COMPETITOR)
		expect(shipped.order).toEqual([1])
		expect(missed(shipped)).toContain(2)

		const open = runWorld(KEYLESS_COMPETITOR, {
			retrieval: { admitThreshold: 0.3 }
		})
		expect(open.admitted).toEqual([1, 2])
		expect(open.diagnostics.admittedByEvidence).toBe(1)
	})

	/**
	 * Design §4's third property — *determinism remains available* — under
	 * contention, which is where it would be lost if it were going to be. An
	 * author's key still wins; the evidence-admitted entry fills the room left
	 * over, and when there is none it leaves with a receipt rather than
	 * displacing the keyed one.
	 */
	it("does not let evidence displace an authored key when room is tight", () => {
		const tight = runWorld(KEYLESS_COMPETITOR, {
			retrieval: { admitThreshold: 0.3 },
			budget: 40
		})
		expect(tight.order).toEqual([1])

		const dropped = tight.selection.excluded.find(
			(d) => d.candidate.id === 2
		)
		expect(dropped, "the keyless entry left no receipt").toBeTruthy()
		expect(dropped!.included).toBe(false)
		// A budget refusal, not a rule one — the two are different classes and
		// point at different controls (`select`'s own argument for keeping
		// `excluded_ineligible` apart from the rest).
		expect(dropped!.reason).not.toBe("excluded_ineligible")
	})
})
