/**
 * The expression language attribute logic is written in (R11).
 *
 * A derived slot computes itself (`derive`), and a rule fires when something
 * holds (`rules`). Both are **LiquidJS expressions as text**, stored on the
 * declaration, and this module is the one place either is evaluated. The SDK
 * deliberately has no evaluator: it declares the shape, the host runs it, and
 * a rule that wrote a value itself would be a second door into rows the write
 * gate exists to be the only door to.
 *
 * ## Why Liquid, and why the same options as `contextLiquid.ts`
 *
 * It is already in the process, already the engine an admin writes a context
 * template in, and already sandboxed to a shape with no recursion, no user
 * functions and no filesystem. A second grammar for "when hp is under five"
 * would be a second parser, a second set of limits, and a second thing to
 * explain. The options here mirror `createContextLiquid` exactly — the same
 * truthiness, the same strict filters, the same parse/render/memory ceilings —
 * because a person who has learned one has learned both.
 *
 * What is **not** mirrored: the three block tags. `{% systemBlock %}` and its
 * siblings shape a prompt, and an attribute expression produces one value.
 *
 * ⚠ **Liquid has no parentheses and binds right to left.** `a and b or c` is
 * `a and (b or c)`, which is not what most people read. The editor says so and
 * the docs say so; it cannot be fixed here without forking the grammar.
 *
 * ## The budget is per change set, not per expression
 *
 * One rule is cheap and forty are not, and the cost that matters is the one a
 * turn pays. So the gate creates an `ExpressionBudget` per change set, every
 * evaluation charges it, and exceeding it puts a **warning on the receipt**
 * rather than refusing the turn (R11: "per-turn rule budget with receipt
 * warning, no hard cap"). A player whose genre is slow should be told, not
 * stopped mid-sentence.
 */

import { Liquid, Tag } from "liquidjs"
import type { TagToken, TopLevelToken } from "liquidjs"
import type { SlotValue } from "@serene-pub/sdk"
import { qualifiedSlotKey, slotKey } from "$lib/server/state/keys"

// ── Limits ──────────────────────────────────────────────────────────────────
//
// The same three ceilings `contextLiquid.ts` sets, and set here rather than
// imported because that module exports a *configured instance* and this one
// needs a differently configured instance from the same numbers.

/** Hard ceiling on one evaluation, in milliseconds. */
const LIQUID_RENDER_LIMIT_MS = 3_000
/** Characters one `parse()` may consume — an expression is a line, not a corpus. */
const LIQUID_PARSE_LIMIT = 1_000_000
/** Objects one evaluation may allocate. */
const LIQUID_MEMORY_LIMIT = 100_000_000

/**
 * What one change set may spend on expressions before the receipt says so.
 *
 * 250 ms is roughly a hundred rules at the speed LiquidJS evaluates one, which
 * is far more logic than a sheet should carry and far less than a turn would
 * notice. It is a reporting threshold, never a refusal.
 */
export const EXPRESSION_BUDGET_MS = 250

/** Liquid's filesystem: none. Belt and braces behind the refused tags. */
const NO_FILESYSTEM = {
	exists: async () => false,
	existsSync: () => false,
	readFile: async (): Promise<string> => {
		throw new Error("expressions are declarations, not files")
	},
	readFileSync: (): string => {
		throw new Error("expressions are declarations, not files")
	},
	resolve: (): string => {
		throw new Error("expressions are declarations, not files")
	},
	contains: async () => false,
	containsSync: () => false
}

/** `{% include %}` and friends: a parse-time refusal that names the tag. */
function refusedTag(name: string) {
	return class extends Tag {
		constructor(
			token: TagToken,
			remainTokens: TopLevelToken[],
			liquid: Liquid
		) {
			super(token, remainTokens, liquid)
			throw new Error(
				`'${name}' is not available in an attribute expression: an expression ` +
					`computes one value from the state in front of it, and there is no ` +
					`file for it to pull in.`
			)
		}
		*render() {}
	}
}

// ── The scope an expression sees ────────────────────────────────────────────

/** One line of an owner's inventory, as the possession filters read it. */
export interface PossessionLine {
	entryId: number
	name: string
	quantity: number
}

/**
 * What an expression is evaluated against.
 *
 * `owner` is the bag of the thing being computed — `owner.hp` is *this*
 * character's health — and `state` is everything, so a rule may reach the world
 * or another character without the author having to thread it through. `who`
 * rides beside `state` rather than inside it for the reason R16 gives: a cast
 * member is not a role, and folding the roles into the cast index would make
 * `state.cast.speaker` a name somebody's character could collide with.
 *
 * `change` is the incoming change a rule is reacting to, absent when a rule is
 * evaluated with nothing proposed for its own slot.
 */
export interface ExpressionScope {
	state: Record<string, unknown>
	owner: Record<string, SlotValue>
	who: Record<string, unknown>
	possessions?: PossessionLine[]
	change?: {
		slotId: string
		value?: SlotValue
		delta?: number
	}
}

/** A value, or the sentence saying why there is not one. */
export type ExpressionResult = { value: unknown } | { refusal: string }

export const isRefusal = (
	r: ExpressionResult
): r is { refusal: string } => "refusal" in r

/**
 * What one change set has spent on expressions.
 *
 * Mutable and passed around rather than returned, because the budget is a fact
 * about the *set* and every evaluation in it has to charge the same counter.
 * `exceeded` latches: once a turn has gone over, the receipt says so even if
 * the last rule was cheap.
 */
export interface ExpressionBudget {
	limitMs: number
	spentMs: number
	evaluations: number
	exceeded: boolean
}

export const createExpressionBudget = (
	limitMs: number = EXPRESSION_BUDGET_MS
): ExpressionBudget => ({
	limitMs,
	spentMs: 0,
	evaluations: 0,
	exceeded: false
})

// ── The seeded roll ─────────────────────────────────────────────────────────

/**
 * xmur3 + mulberry32, character for character the RNG the scripts host builds
 * (`pipelines/scripts/host.ts`).
 *
 * The same algorithm rather than a shared import because that one is written as
 * a **string** injected into a sandbox and has no exported form. Two copies of
 * eight lines is the lesser evil against a roll that differs by where it ran:
 * a die is a pure function of its seed label, and the whole point is that
 * replaying a run rolls the same numbers.
 */
function seededRandom(label: string): () => number {
	let h = 1779033703 ^ label.length
	for (let i = 0; i < label.length; i++) {
		h = Math.imul(h ^ label.charCodeAt(i), 3432918353)
		h = (h << 13) | (h >>> 19)
	}
	h = Math.imul(h ^ (h >>> 16), 2246822507)
	h = Math.imul(h ^ (h >>> 13), 3266489909)
	let a = (h ^= h >>> 16) >>> 0
	return () => {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** `d20` · `2d6` · `2d6+1` · `d8-2`. Anything else is not a die. */
const DICE = /^\s*(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i

// ── Filters ─────────────────────────────────────────────────────────────────

/**
 * The value under a slot id, in the scope the expression is being evaluated in.
 *
 * Takes the **id** rather than the key because an id is what survives two
 * genres declaring `tension`: the bare key goes to the first claimant and the
 * qualified one is always there, so a rule written against `acme.rp:slot/
 * tension@1` keeps meaning that slot after somebody else declares theirs.
 * Looks at the owner first and the world second — a character's own value is
 * what `hp` means inside that character's rule.
 */
function slotFilter(scope: ExpressionScope, id: unknown): unknown {
	const slotId = String(id ?? "")
	const qualified = qualifiedSlotKey(slotId)
	const bare = slotKey(slotId)
	const owner = scope.owner ?? {}
	if (qualified in owner) return owner[qualified]
	if (bare in owner) return owner[bare]
	const world = (scope.state?.world ?? {}) as Record<string, unknown>
	if (qualified in world) return world[qualified]
	if (bare in world) return world[bare]
	return undefined
}

/** How many of a thing this owner is carrying, by entry id or by name. */
function heldCount(scope: ExpressionScope, subject: unknown): number {
	const lines = scope.possessions ?? []
	if (typeof subject === "number")
		return lines
			.filter((l) => l.entryId === subject)
			.reduce((n, l) => n + l.quantity, 0)
	const name = String(subject ?? "")
		.trim()
		.toLowerCase()
	if (!name) return 0
	return lines
		.filter((l) => (l.name ?? "").trim().toLowerCase() === name)
		.reduce((n, l) => n + l.quantity, 0)
}

// ── The instance ────────────────────────────────────────────────────────────

/**
 * One configured Liquid, for one evaluation.
 *
 * Per evaluation and not shared, for the reason `createContextLiquid` is: the
 * filters close over the scope and the seed. A shared instance would answer
 * `owner.hp` for whichever owner evaluated first and roll whichever run's dice
 * got there first — a bug that only appears under two concurrent turns, which
 * is the worst kind to go looking for.
 */
function expressionLiquid(
	scope: ExpressionScope,
	seedLabel: string
): Liquid {
	const liquid = new Liquid({
		// The same five parity settings `contextLiquid.ts` explains.
		jsTruthy: true,
		greedy: false,
		strictFilters: true,
		strictVariables: false,
		outputEscape: undefined,
		ownPropertyOnly: true,
		cache: false,
		root: [],
		partials: [],
		layouts: [],
		relativeReference: false,
		fs: NO_FILESYSTEM,
		parseLimit: LIQUID_PARSE_LIMIT,
		renderLimit: LIQUID_RENDER_LIMIT_MS,
		memoryLimit: LIQUID_MEMORY_LIMIT
	})

	for (const name of ["include", "render", "layout"])
		liquid.registerTag(name, refusedTag(name) as any)

	liquid.registerFilter("slot", (id: unknown) => slotFilter(scope, id))
	liquid.registerFilter(
		"has",
		(subject: unknown) => heldCount(scope, subject) > 0
	)
	liquid.registerFilter("count", (subject: unknown) =>
		// A list counts itself; anything else is an inventory question. One
		// filter rather than two because "how many" is one question to a
		// person, and the two arms can never be confused for each other —
		// an array is never an entry name.
		Array.isArray(subject) ? subject.length : heldCount(scope, subject)
	)
	liquid.registerFilter(
		"clamp",
		(value: unknown, min: unknown, max: unknown) => {
			const n = Number(value)
			if (!Number.isFinite(n)) return value
			const lo = Number(min)
			const hi = Number(max)
			let out = n
			if (Number.isFinite(lo)) out = Math.max(lo, out)
			if (Number.isFinite(hi)) out = Math.min(hi, out)
			return out
		}
	)

	// `roll` is the one impure-looking filter and it is not impure: the RNG is
	// a pure function of the seed label, so the same run rolls the same dice
	// however many times it is replayed. A counter makes two rolls in one
	// expression two different numbers, which is what `2d6` plainly means.
	let rolls = 0
	liquid.registerFilter("roll", (spec: unknown) => {
		const m = DICE.exec(String(spec ?? ""))
		if (!m)
			throw new Error(
				`'${String(spec)}' is not a die. Write 'd20', '2d6' or '2d6+1'.`
			)
		const count = m[1] ? Number(m[1]) : 1
		const faces = Number(m[2])
		const modifier = m[3] === "-" ? -Number(m[4]) : Number(m[4] || 0)
		if (faces < 1 || count < 1 || count > 100)
			throw new Error(
				`'${String(spec)}' is not a die anyone could throw: 1 to 100 dice of ` +
					`at least one face.`
			)
		const random = seededRandom(`${seedLabel}:${rolls++}`)
		let total = modifier
		for (let i = 0; i < count; i++) total += Math.floor(random() * faces) + 1
		return total
	})

	return liquid
}

// ── Evaluating ──────────────────────────────────────────────────────────────

export interface EvaluateOptions {
	/**
	 * What the dice are a function of. Inside a run this is
	 * `${seed}:rules:${ownerKey}:${slotId}:${i}`, which is the run's own seed
	 * so a replay rolls identically; outside one it is a fresh uuid that the
	 * caller **records on the row** — an unrecorded seed is a number nobody can
	 * ever explain.
	 */
	seedLabel: string
	/** The change set's counter. Charged whether the evaluation succeeded or not. */
	budget?: ExpressionBudget
}

/**
 * Evaluate one expression, or say why it could not be.
 *
 * A refusal rather than a throw, because every caller — the derive pass, the
 * rules phase, the sheet editor's live preview — has to show a person what was
 * wrong with the line they wrote, and three callers catching and re-wording one
 * exception is how an error message stops being one.
 */
export function evaluate(
	expr: string,
	scope: ExpressionScope,
	opts: EvaluateOptions
): ExpressionResult {
	if (!expr?.trim())
		return { refusal: "an empty expression computes nothing." }
	const started = performance.now()
	try {
		const liquid = expressionLiquid(scope, opts.seedLabel)
		const value = liquid.evalValueSync(expr, {
			...scope.state,
			state: scope.state,
			owner: scope.owner,
			who: scope.who,
			...(scope.change ? { change: scope.change } : {})
		} as any)
		return { value }
	} catch (e) {
		return { refusal: (e as Error).message }
	} finally {
		charge(opts.budget, performance.now() - started)
	}
}

function charge(budget: ExpressionBudget | undefined, ms: number): void {
	if (!budget) return
	budget.spentMs += ms
	budget.evaluations += 1
	if (budget.spentMs > budget.limitMs) budget.exceeded = true
}

/**
 * Why this expression cannot be saved, or `null` when it can.
 *
 * Parse-time only, which is exactly the set of mistakes that can be caught
 * without knowing any state: a misspelled filter (strict filters), an
 * unbalanced quote, a stray operator. What it deliberately does **not** catch
 * is a slot id nobody declares, because an expression naming a slot a plugin
 * will declare tomorrow is a legitimate thing to have written down.
 */
export function checkExpression(expr: string): string | null {
	if (!expr?.trim()) return "an empty expression computes nothing."
	try {
		// Parsed through the real instance so the refused tags and the strict
		// filters are the ones the evaluation will use. The scope is empty:
		// nothing is read at parse time.
		expressionLiquid(
			{ state: {}, owner: {}, who: {} },
			"check"
		).parse(`{{ ${expr} }}`)
		return null
	} catch (e) {
		return (e as Error).message
	}
}

// ── What an expression reads ────────────────────────────────────────────────

/** The slots one expression depends on, as far as it can be told statically. */
export interface ExpressionReads {
	/** Bare or qualified keys read off `owner.` — `owner.hp` gives `hp`. */
	ownerKeys: string[]
	/** Slot ids named as literals anywhere in the text — `| slot` and friends. */
	slotIds: string[]
}

/** `owner:slot/name@N` wherever it appears in quoted text. */
const SLOT_ID_LITERAL =
	/["']([a-z0-9]+(?:[.-][a-z0-9]+)*:slot\/[a-z0-9]+(?:-[a-z0-9]+)*@\d+)["']/g

/**
 * Which slots an expression reads — the input to the derivation graph.
 *
 * Two readers, because a slot is named two ways. `analyzeSync` gives the
 * variable paths honestly (`owner.hp` → `hp`), and a regex over quoted slot ids
 * catches `{{ "core:slot/hp@1" | slot }}`, which is a filter *argument* and
 * therefore not a variable at all.
 *
 * ⚠ **Deliberately conservative in the safe direction.** An expression that
 * builds a slot id at runtime reads as depending on nothing, so its slot is
 * ordered early and may compute against a stale value — one wrong number.
 * Over-reporting instead would invent a cycle and refuse a declaration that is
 * fine, which costs the author their sheet.
 */
export function expressionReads(expr: string): ExpressionReads {
	const ownerKeys: string[] = []
	const slotIds: string[] = []
	try {
		const liquid = expressionLiquid({ state: {}, owner: {}, who: {} }, "read")
		const analysis = liquid.analyzeSync(liquid.parse(`{{ ${expr} }}`))
		for (const [root, uses] of Object.entries(analysis.variables ?? {})) {
			if (root !== "owner") continue
			for (const use of uses as { segments: (string | number)[] }[]) {
				const key = use.segments[1]
				if (typeof key === "string" && !ownerKeys.includes(key))
					ownerKeys.push(key)
			}
		}
	} catch {
		// An expression that will not parse reads as depending on nothing.
		// `checkExpression` is what tells the author about it; ordering a
		// broken expression first costs nothing, since it never evaluates.
	}
	for (const m of expr.matchAll(SLOT_ID_LITERAL))
		if (!slotIds.includes(m[1])) slotIds.push(m[1])
	return { ownerKeys, slotIds }
}
