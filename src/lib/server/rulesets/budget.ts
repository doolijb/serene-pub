/**
 * 🚧 Fitting the ruleset's blocks into a budget (PLAN-rulesets §32).
 *
 * Every block carries its `priority`, the depth it is at and its renders at
 * each depth. Under pressure a block **degrades before it drops**: the
 * lowest-priority block steps down a depth (full → summary → index), then
 * the next, and only when every block that can step down has done so does
 * the lowest-priority block leave. So a sheet becomes one line rather than
 * vanishing. Nothing is truncated, so a block carries no `min`/`max`.
 *
 * One fit, over the budget port's own records (`ContextBudgetBlock[]`,
 * audit C5) — the handler's keyed record is turned into them first — and
 * counted in the run's tokens when the caller hands its tokenizer
 * (`TaskCtx.countTokens`); the four-characters estimate only stands in
 * where none is handed.
 */

import type { RenderDepth } from "@serene-pub/sdk"
import { byString, DEPTHS } from "./common"
import { estimateTokens } from "./engine"
import type { RulesetBlock, RulesetBlocks } from "./types"

/** Count a text's tokens. */
export type CountTokens = (text: string) => number

/**
 * 🚧 One block as `core:task/context-budget@1`'s `blocks` port carries it
 * (W3-S contract text): its key, its text and tokens at the depth it is at,
 * its priority, and its text and tokens at every depth it has.
 */
export interface ContextBudgetBlock {
	key: string
	text: string
	tokens: number
	priority: number
	depth: RenderDepth
	depths: Partial<Record<RenderDepth, { text: string; tokens: number }>>
}

/**
 * The handler's labelled blocks (or the port's own records) as the port's
 * records, in prefix order, each depth counted with `count`. Per-holder
 * blocks go to different prompts, so they are fitted where they land, not
 * here.
 */
export function toContextBudgetBlocks(raw: unknown, count: CountTokens = estimateTokens): ContextBudgetBlock[] {
	const entries: [string, Partial<RulesetBlock> & { depths?: Partial<Record<RenderDepth, unknown>> }][] = Array.isArray(raw)
		? (raw as Partial<ContextBudgetBlock>[]).filter((r) => r && typeof r.key === "string").map((r) => [r.key!, r as never])
		: raw && typeof raw === "object"
			? (Object.entries(raw as Record<string, unknown>).filter(([k]) => k !== "holders") as never)
			: []
	const out: ContextBudgetBlock[] = []
	for (const [key, b] of entries) {
		if (!b || typeof b.text !== "string") continue
		const depths: ContextBudgetBlock["depths"] = {}
		for (const d of DEPTHS) {
			const at = b.depths?.[d]
			const t = typeof at === "string" ? at : at && typeof (at as { text?: unknown }).text === "string" ? (at as { text: string }).text : undefined
			if (t) depths[d] = { text: t, tokens: count(t) }
		}
		const depth = DEPTHS.includes(b.depth as RenderDepth) ? (b.depth as RenderDepth) : "full"
		if (!depths[depth]) depths[depth] = { text: b.text, tokens: count(b.text) }
		out.push({ key, text: b.text, tokens: count(b.text), priority: typeof b.priority === "number" ? b.priority : 0, depth, depths })
	}
	return out
}

/** The record one depth shallower, or null when it is at its shallowest render. */
function shallower(b: ContextBudgetBlock): ContextBudgetBlock | null {
	for (let i = DEPTHS.indexOf(b.depth) - 1; i >= 0; i--) {
		const depth = DEPTHS[i]!
		const at = b.depths[depth]
		if (at && at.text !== b.text) return { ...b, depth, text: at.text, tokens: at.tokens }
	}
	return null
}

export interface FittedBlocks {
	blocks: ContextBudgetBlock[]
	used: number
	/** What the fit did, in order — `sheet: full → summary`, `ties: dropped`. */
	steps: string[]
}

/**
 * Fit `blocks` into `budget` tokens: degrade by ascending priority, then drop
 * by ascending priority. Ties in priority break by key, so the fit is
 * deterministic; the records keep the order they came in.
 */
export function fitBlocks(blocks: readonly ContextBudgetBlock[], budget: number): FittedBlocks {
	const live = [...blocks]
	const steps: string[] = []
	const used = () => live.reduce((a, b) => a + b.tokens, 0)
	const byPriority = () =>
		live.map((b, i) => ({ b, i })).sort((x, y) => x.b.priority - y.b.priority || byString(x.b.key, y.b.key))
	while (used() > budget) {
		const step = byPriority().find(({ b }) => shallower(b))
		if (!step) break
		const next = shallower(step.b)!
		live[step.i] = next
		steps.push(`${step.b.key}: ${step.b.depth} → ${next.depth}`)
	}
	while (used() > budget && live.length) {
		const { b, i } = byPriority()[0]!
		live.splice(i, 1)
		steps.push(`${b.key}: dropped`)
	}
	return { blocks: live, used: used(), steps }
}

/**
 * 🚧 What `core:task/context-budget@1` publishes on `fittedBlocks` for a
 * `blocks` input: the records at the depth each landed on, dropped ones
 * left out (degrade before drop). Takes the handler's record or the port's
 * records; `count` is the run's tokenizer. Called by the budget binding
 * (`pipelines/runtime/bindings.ts`) on the `blocks` in-port.
 */
export function fitContextBlocks(raw: unknown, available: number, count?: CountTokens): ContextBudgetBlock[] {
	return fitBlocks(toContextBudgetBlocks(raw, count), Math.max(0, available)).blocks
}

/**
 * The handler's keyed record fitted, keyed again — what a direct caller
 * holding `RulesetBlocks` reads. Per-holder blocks pass through untouched.
 */
export function fitRulesetBlocks(blocks: RulesetBlocks, budget: number, count?: CountTokens): FittedBlocks & { record: RulesetBlocks } {
	const fit = fitBlocks(toContextBudgetBlocks(blocks, count), budget)
	const record: RulesetBlocks = {}
	for (const b of fit.blocks) {
		const depths: Partial<Record<RenderDepth, string>> = {}
		for (const d of DEPTHS) if (b.depths[d]) depths[d] = b.depths[d]!.text
		;(record as Record<string, RulesetBlock>)[b.key] = { text: b.text, tokens: b.tokens, priority: b.priority, depth: b.depth, depths }
	}
	if (blocks.holders) record.holders = blocks.holders
	return { ...fit, record }
}
