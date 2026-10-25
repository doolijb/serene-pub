/**
 * 🚧 The ruleset handler's **check method** resolvers (PLAN-rulesets-authoring
 * D2, 2026-10-22) — one per kind core resolves (`CORE_CHECK_METHOD_KINDS`):
 *
 *  · `die-target` — one die plus the modifier against a target; the margin
 *    reads through the degrees, a natural face through `natural` /
 *    `naturalShift` (the handler's only resolver until 2026-10-22).
 *  · `dice-pool` — as many dice as the modifier says; each face at or above
 *    `successOn` is a success; the count reads as a degree (`countToDegree`;
 *    absent: none fails, any succeeds).
 *  · `card-draw` — cards from the session's deck for the scene (`DeckState`,
 *    seeded per session, method, scene and shuffle); their ranks plus the
 *    modifier against a target, read as a die-target's margin is.
 *  · `compare` — the modifier against the other side's value or a target;
 *    no chance at all.
 *  · `bid` — a spend from a stat buys the degree its cost table says
 *    (`bidDegree`); the engine takes the spend and refuses one larger than
 *    what is held.
 *  · `none` — nothing resolves it: the degree (or the words) the game master
 *    or the model judged (`judgedDegree`).
 *
 * Pure, as the engine is: each resolver reads the check the engine prepared
 * (its terms, edge, degree steps, target) and returns the numbers and the
 * degree; the engine writes the explain line, the outcome and its block.
 * A package's own kind (`owner:name`) has no resolver here — the engine
 * refuses its checks politely (`noResolverWhy`).
 */

import {
	checkMethodKind,
	FIVE_BANDS,
	i18nText,
	normaliseRuleset,
	rulesetDecides as sdkRulesetDecides,
	type CardDrawMethod,
	type CheckMethodDecl,
	type DegreeCrosswalk,
	type DicePoolMethod,
	type DieTargetMethod,
	type FiveBand,
	type OutcomeCard
} from "@serene-pub/sdk"
import { seededRandom } from "$lib/server/state/expressions"
import { degreeNamed, degreeOf, degreeOfFive, rollDice, type Degree } from "./dice"
import type { DeckState, ExplainTerm } from "./types"

/** What every resolver is handed: the check as the engine prepared it. */
export interface MethodCheck {
	degrees: DegreeCrosswalk
	/** The check's own terms before anything is rolled or drawn: the selector it reads and the bonuses kept. */
	terms: ExplainTerm[]
	/** Net edge, −1 · 0 · +1 (a die-target rolls twice; a pool rolls a die more or fewer). */
	edge: number
	/** Degree steps (`adjustDegree`) to take after the method reads. */
	adjust: number
	against?: number
	random?: () => number
}

/** What a resolver returns. `total` is the number it came to (`OutcomeBlock.rolled`). */
export interface MethodResult {
	terms: ExplainTerm[]
	total?: number
	natural?: number
	faces?: number[]
	pool?: { size: number; successes: number; successOn: number }
	cards?: OutcomeCard[]
	degree: Degree | null
	/** How the number was reached, when it is no sum of terms (a pool's count). */
	explain?: string
}

const sum = (terms: readonly ExplainTerm[]): number => terms.reduce((a, t) => a + t.value, 0)

/** The most dice a pool rolls, however large its stat — a typo of 9000 is never 9000 dice. */
export const POOL_MAX = 40

/** The core kind of a method, or null for a package's own (or nothing at all). */
export const coreKindOf = (method: CheckMethodDecl | undefined): string | null => checkMethodKind(method?.kind)?.methodKind ?? null

/**
 * 🚧 Whether a ruleset **decides anything by its rules** (2026-10-22): it
 * declares a check method other than `none` (the ⏳ `conventions.dice` read
 * as one, `normaliseRuleset`). What How strict reads (`rigoursPlayed`): one
 * that decides nothing (Story's Freeform) plays Words only; a diceless one
 * that decides by a spend or a comparison plays every rigour, as a dice one
 * does — chance is a check method, never the test (R1).
 */
export function rulesetDecides(decl: Parameters<typeof normaliseRuleset>[0] | null | undefined): boolean {
	if (!decl) return false
	// 🚧 D3 (2026-10-23): any deciding function the ruleset uses that decides — a
	// core resolver, or a module with a body or chance (the SDK's reading) —
	// or, ⏳ as before, a check method other than `none` (a package's kind too).
	return sdkRulesetDecides(decl) || Object.values(normaliseRuleset(decl).conventions.methods).some((m) => !!m && m.kind !== "none")
}

/** 🚧 The polite refusal for a check under a kind this pub cannot resolve (`owner:name`). */
export const noResolverWhy = (kind: string): string =>
	`this pub has no resolver for '${kind}', the check method this check is decided by — tell it in words instead`

/** 🚧 **die-target**: one die (twice under an edge, the better or worse kept) plus the terms, against the target. */
export function resolveDieTarget(method: DieTargetMethod, c: MethodCheck): MethodResult {
	if (!c.random) throw new Error("a check needs the run's randomness, and this resolution was handed none")
	const sides = method.sides
	const first = rollDice(`d${sides}`, c.random).total
	const second = c.edge !== 0 ? rollDice(`d${sides}`, c.random).total : undefined
	const natural = second === undefined ? first : c.edge > 0 ? Math.max(first, second) : Math.min(first, second)
	const terms: ExplainTerm[] = [
		{
			value: natural,
			label: second === undefined ? `d${sides}` : `d${sides} (${first}, ${second}, ${c.edge > 0 ? "edge" : "against the edge"})`,
			origin: { kind: "roll", ref: `d${sides}` }
		},
		...c.terms
	]
	const total = sum(terms)
	return { terms, total, natural, faces: [natural], degree: degreeOf(c.degrees, { total, natural, against: c.against, adjust: c.adjust }) }
}

/**
 * 🚧 **dice-pool**: as many dice as the terms add up to (plus `extra` a
 * pre-roll added, plus one a side for an edge; never fewer than none, never
 * more than `POOL_MAX`), each face at or above `successOn` a success, the
 * count read through `countToDegree` — the last step whose `from` it
 * reaches; under the first step, or with no map at none, the degrees'
 * failure; with no map at one or more, their success.
 */
export function resolveDicePool(method: DicePoolMethod, c: MethodCheck, extra = 0): MethodResult {
	if (!c.random) throw new Error("a check needs the run's randomness, and this resolution was handed none")
	const size = Math.max(0, Math.min(POOL_MAX, Math.floor(sum(c.terms)) + Math.trunc(extra) + Math.sign(c.edge)))
	const faces: number[] = []
	for (let i = 0; i < size; i++) faces.push(rollDice(`d${method.sides}`, c.random).total)
	const successOn = method.successOn
	const successes = faces.filter((f) => f >= successOn).length
	const steps = Array.isArray(method.countToDegree) ? method.countToDegree : []
	let degree: Degree | null
	if (steps.length) {
		const step = steps.filter((s) => successes >= s.from).pop()
		degree = (step ? degreeNamed(c.degrees, step.band, c.adjust) : null) ?? degreeOfFive(c.degrees, "fail", c.adjust)
	} else degree = degreeOfFive(c.degrees, successes > 0 ? "success" : "fail", c.adjust)
	const sizeWords = c.terms.length > 1 || extra || c.edge ? ` (${[...c.terms.map((t) => `${t.value} ${t.label}`), ...(extra ? [`${extra} more`] : []), ...(c.edge ? [c.edge > 0 ? "1 for the edge" : "−1 against the edge"] : [])].join(", ")})` : ""
	const explain = `pool ${size}${sizeWords} — ${size}d${method.sides} (${faces.join(", ") || "no dice"}): ${successes} ${successes === 1 ? "success" : "successes"} at ${successOn}+`
	return { terms: c.terms, total: successes, faces, pool: { size, successes, successOn }, degree, explain }
}

// ── Decks ───────────────────────────────────────────────────────────────────

/** A common deck's words, when a method's deck is one (13 ranks, 4 suits). */
const RANK_WORDS = ["Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King"]
const SUIT_WORDS = ["hearts", "diamonds", "clubs", "spades"]

/** A card in words: _Queen of hearts_ in a common deck, else its rank and suit by number. */
export function cardWords(rank: number, suit: number, ranks: number, suits: number): string {
	const r = ranks === RANK_WORDS.length ? RANK_WORDS[rank - 1]! : String(rank)
	if (suits <= 1) return r
	return suits === SUIT_WORDS.length ? `${r} of ${SUIT_WORDS[suit]}` : `${r} of suit ${suit + 1}`
}

/** A deck's order for one shuffle: Fisher–Yates over `size` cards, drawn from the label's seeded stream. */
export function deckOrder(label: string, size: number): number[] {
	const random = seededRandom(label)
	const cards = Array.from({ length: size }, (_, i) => i)
	for (let i = size - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1))
		;[cards[i], cards[j]] = [cards[j]!, cards[i]!]
	}
	return cards
}

/**
 * 🚧 Draw `count` cards from a method's deck as `state` left it: a deck
 * absent — or, shuffled each scene (the default), shuffled for another
 * scene — starts afresh for `scene`; one that runs out mid-draw is shuffled
 * again (either way). The order of each shuffle is the seed's
 * (`<seed>:<key>:<scene>:<shuffle>`), so a deck is the same deck whoever
 * draws from it. Returns the cards (indices) and the state to store.
 */
export function drawFromDeck(
	method: CardDrawMethod,
	key: string,
	state: DeckState | undefined,
	scene: number | null,
	seed: string,
	count: number
): { cards: number[]; state: DeckState } {
	const size = Math.max(1, method.ranks * (method.suits ?? 4))
	const eachScene = (method.reshuffle ?? "each-scene") === "each-scene"
	let now: DeckState = !state || (eachScene && state.scene !== scene) ? { scene, shuffle: 0, drawn: 0 } : { ...state }
	let order = deckOrder(`${seed}:${key}:${now.scene ?? "session"}:${now.shuffle}`, size)
	const cards: number[] = []
	for (let i = 0; i < count; i++) {
		if (now.drawn >= size) {
			now = { ...now, shuffle: now.shuffle + 1, drawn: 0 }
			order = deckOrder(`${seed}:${key}:${now.scene ?? "session"}:${now.shuffle}`, size)
		}
		cards.push(order[now.drawn]!)
		now = { ...now, drawn: now.drawn + 1 }
	}
	return { cards, state: now }
}

/**
 * 🚧 **card-draw**: the cards drawn (their ranks added) plus the terms,
 * against the target — read as a die-target's margin is, with no natural
 * face. `drawn` are the deck's card indices (`drawFromDeck`).
 */
export function resolveCardDraw(method: CardDrawMethod, c: MethodCheck, drawn: readonly number[]): MethodResult {
	const suits = method.suits ?? 4
	const cards: OutcomeCard[] = drawn.map((card) => {
		const rank = (card % method.ranks) + 1
		const suit = Math.floor(card / method.ranks)
		return { label: cardWords(rank, suit, method.ranks, suits), rank }
	})
	const ranks = cards.reduce((a, card) => a + (card.rank ?? 0), 0)
	const terms: ExplainTerm[] = [
		{ value: ranks, label: `drew ${cards.map((card) => card.label).join(", ")}`, origin: { kind: "roll", ref: "cards" } },
		...c.terms
	]
	const total = sum(terms)
	return { terms, total, cards, degree: degreeOf(c.degrees, { total, natural: Number.NaN, against: c.against, adjust: c.adjust }) }
}

/** 🚧 **compare**: the terms against the other side's value or a target — no chance; the margin reads through the degrees. */
export function resolveCompare(c: MethodCheck): MethodResult {
	const total = sum(c.terms)
	return { terms: c.terms, total, degree: degreeOf(c.degrees, { total, natural: Number.NaN, against: c.against, adjust: c.adjust }) }
}

// ── Bids and judgements ─────────────────────────────────────────────────────

const FIVE_RANK = Object.fromEntries(FIVE_BANDS.map((f, i) => [f, i])) as Record<FiveBand, number>

/**
 * 🚧 What a bid with no amount spends: the least spend whose row buys a
 * success or better — the price of success — else the dearest row.
 */
export function priceOfSuccess(costs: readonly { spend: number; band: string }[], degrees: DegreeCrosswalk): number {
	const five = (band: string) => degrees.bands.find((b) => b.id === band)?.five
	const rows = [...costs].sort((a, b) => a.spend - b.spend)
	const row = rows.find((r) => {
		const f = five(r.band)
		return f !== undefined && FIVE_RANK[f] >= FIVE_RANK.success
	})
	return (row ?? rows[rows.length - 1])?.spend ?? 0
}

/**
 * 🚧 The degree a spend buys: the last cost row (least first) whose `spend`
 * it reaches; under the first row, the degrees' failure.
 */
export function bidDegree(costs: readonly { spend: number; band: string }[], spend: number, degrees: DegreeCrosswalk, adjust = 0): Degree | null {
	const row = [...costs].sort((a, b) => a.spend - b.spend).filter((r) => spend >= r.spend).pop()
	return (row ? degreeNamed(degrees, row.band, adjust) : null) ?? degreeOfFive(degrees, "fail", adjust)
}

/**
 * 🚧 How a check under `none` went, as it was judged: one of the degrees,
 * by id or by its words (_Success_, any case); else the judgement's own
 * words, with no degree; else nothing said (the story tells it).
 */
export function judgedDegree(degrees: DegreeCrosswalk, judged: unknown, adjust = 0): { degree: Degree | null; words?: string } {
	const said = typeof judged === "string" ? judged.trim() : ""
	if (!said) return { degree: null }
	const want = said.toLowerCase()
	const band = degrees.bands.find((b) => b.id.toLowerCase() === want || (i18nText(b.label) ?? "").toLowerCase() === want)
	if (band) return { degree: degreeNamed(degrees, band.id, adjust) }
	return { degree: null, words: said }
}
