/**
 * Assemble: allocated context in, rendered prompt out.
 *
 * The Task that turns *what was selected* into *what will be sent*. Two halves,
 * split because 16 §7 says they are different jobs:
 *
 *   **allocation** — which blocks are in, in what order, at what cost, and why
 *   **rendering**  — the template, run once, over that allocation
 *
 * Keeping them apart is what makes the debug preview honest. The preview is not
 * a second renderer that approximates the send; it is this function, stopped
 * before the Provider call. If allocation and rendering were one step, "what
 * would be sent" and "what was sent" would be two code paths that agree until
 * they don't.
 *
 * **Rendering is host-supplied, and the engine is data.** The SDK's Handlebars
 * engine deliberately refuses to render (see `engines.ts`), because core has a
 * registered helper set and a second implementation would differ in ways that
 * present as template bugs.
 *
 * Which renderer runs is decided by the template's own `engine` id, resolved
 * through `renderers.ts`. Core ships Handlebars; an extension may register
 * another and supply its own assembler. **Core's language is a default, not an
 * assumption** — this module never names Handlebars, and would keep working if
 * core's default changed.
 */

import { parseSplitChatPrompt } from "$lib/shared/utils/parseSplitChatPrompt"
import { formatHistoryDateKey, formatDate } from "./dateKeys"
import { renderTemplate } from "./renderers"
import { renderVariable, type ResolvedLayouts } from "./variableLayouts"
import type { Decision } from "./ranking/select"

export interface ContextBlock {
	/** `worldLore`, `message`, `history`… — what a receipt groups by. */
	source: string
	id: number | string
	content: string
	tokens: number
	/**
	 * The entry's title. Not decoration: the default templates receive world
	 * lore as `{"<name>": "<content>"}`, so a block without its name cannot be
	 * rendered into the shape a user's story string already expects.
	 */
	name?: string
	/**
	 * The few extra fields rendering needs and nothing more — history's date
	 * parts, today. Deliberately not the whole payload: a block travels in the
	 * receipt and along every downstream edge, and "carry it all just in case"
	 * is how a lore row's private fields end up in a debug panel.
	 */
	meta?: Record<string, unknown>
	/**
	 * Why this block is here, or is not.
	 *
	 * Carried on the block rather than derived at render time, because the
	 * numbers that produced the decision exist upstream and nowhere else once
	 * the selection loop has moved on (16 §7c).
	 */
	why: string[]
	included: boolean
}

export interface AllocatedContext {
	blocks: ContextBlock[]
	totalTokens: number
	budget: { total: number; used: number; remaining: number }
	/** Per source: allocated, used, entries — the arithmetic a panel shows. */
	groups: Record<string, { allocated: number; used: number; entries: number }>
}

/**
 * Turn selection decisions into an allocation.
 *
 * Excluded candidates are **kept in the block list with `included: false`**
 * rather than dropped. A user asking "why isn't my lore showing up" is asking
 * about something that is absent, so an allocation that only lists what made it
 * cannot answer them.
 */
export function allocate(
	decisions: readonly Decision[],
	opts: { budgetTotal: number; groups?: AllocatedContext["groups"] }
): AllocatedContext {
	const blocks: ContextBlock[] = decisions.map((d) => {
		const payload = (d.candidate.payload ?? {}) as Record<string, unknown>
		return {
			source: d.candidate.source,
			id: d.candidate.id,
			content: contentOf(d.candidate.payload),
			tokens: d.candidate.tokens,
			name: typeof payload.name === "string" ? payload.name : undefined,
			meta: dateMeta(payload),
			included: d.included,
			why: [d.why, `score ${d.score.toFixed(3)}`, d.reason]
		}
	})

	const used = blocks
		.filter((b) => b.included)
		.reduce((sum, b) => sum + b.tokens, 0)

	return {
		blocks,
		totalTokens: used,
		budget: {
			total: opts.budgetTotal,
			used,
			remaining: Math.max(0, opts.budgetTotal - used)
		},
		groups: opts.groups ?? {}
	}
}

/**
 * `{"<name>": "<content>"}`, or nothing at all.
 *
 * `undefined` rather than `{}` when empty, matching the legacy engines: a
 * template writing `{{#if worldLore}}` has to see the same falsiness, and an
 * empty object is truthy.
 *
 * The object, not the JSON — stringification happens at the call site, so a
 * variable template can eventually be handed the shape and decide how to
 * present it. The emptiness rule stays here, per variable, because it is not
 * uniform: `characters` renders `[]` for an empty cast (`JSON.stringify([])`
 * is a truthy string), while world lore vanishes. Unifying the two would
 * change one of them.
 */
export function objectByName(
	blocks: readonly ContextBlock[]
): Record<string, string> | undefined {
	const obj: Record<string, string> = {}
	for (const b of blocks) if (b.name && b.content) obj[b.name] = b.content
	return Object.keys(obj).length ? obj : undefined
}

/** History, newest first, keyed by its formatted date. Blank content is skipped. */
export function objectByDate(
	blocks: readonly ContextBlock[]
): Record<string, string> | undefined {
	const obj: Record<string, string> = {}
	for (const b of [...blocks].sort((a, z) => dateValue(z) - dateValue(a))) {
		if (!b.content?.trim()) continue
		obj[formatHistoryDateKey(b.meta as any)] = b.content
	}
	return Object.keys(obj).length ? obj : undefined
}

/** The most recent history entry's date, which templates render as `{{currentDate}}`. */
function currentDateOf(blocks: readonly ContextBlock[]): string | undefined {
	const newest = [...blocks].sort((a, z) => dateValue(z) - dateValue(a))[0]
	if (!newest?.meta) return undefined
	const m = newest.meta as { year?: number; month?: number; day?: number }
	if (m.year === undefined) return undefined
	return formatDate(m.year, m.month ?? null, m.day ?? null)
}

const dateValue = (b: ContextBlock): number => {
	const m = (b.meta ?? {}) as { year?: number; month?: number; day?: number }
	return (m.year ?? 0) * 10000 + (m.month ?? 0) * 100 + (m.day ?? 0)
}

/** Only the date parts, and only when the row has them. */
function dateMeta(
	payload: Record<string, unknown>
): Record<string, unknown> | undefined {
	if (payload.year === undefined || payload.year === null) return undefined
	return { year: payload.year, month: payload.month, day: payload.day }
}

export interface RenderInput {
	allocation: AllocatedContext
	/**
	 * Where the reminder block goes, and whether it goes anywhere.
	 *
	 * Resolved upstream and **not** the placeholder the context builder ships.
	 * The default template renders the reminder *inside* the message loop, gated
	 * on `msgIndex === postHistory.targetIndex`, so an unresolved index of 0
	 * puts it at the top of the conversation instead of next to the generation
	 * point — which is the one place it was moved to in order to be followed.
	 *
	 * Found by comparing against a real chat: eight corpus fixtures missed it,
	 * because their template rendered `postHistory.*` outside the loop and so
	 * never expressed a position at all.
	 */
	postHistory?: Record<string, unknown>
	/** The context config's story string. */
	template: string
	/** The prompts slot: system prompt, post-history instructions, and so on. */
	prompts?: Record<string, unknown>
	/** Everything else the template references — characters, personas, scenario. */
	templateContext?: Record<string, unknown>
	messages: ReadonlyArray<{
		id: number
		role: string
		content: string
		name?: string
	}>
	/** Decides whether the result is one string or role-tagged messages. */
	promptFormat?: string
	/**
	 * Which template language `template` is written in. NULL means core's
	 * default — the column is nullable for exactly that reason (12 §2a).
	 */
	engine?: string | null
	/**
	 * The `variables` slot: how the values *this* node produces are laid out,
	 * already dereferenced from row ids into template sources by `world.ts`.
	 *
	 * Declared here rather than upstream because these come out the other side
	 * of the budget — a layout receives what actually fit, which no earlier
	 * node knows. Absent means every render site uses its in-code expression,
	 * which is byte-identical to what it produced before layouts existed.
	 */
	variables?: ResolvedLayouts
}

export interface RenderedContext {
	rendered?: string
	messages?: Array<{ role: string; content: string }>
	/** What the template actually referenced, for the variable-awareness panel. */
	usedVariables: string[]
}

/**
 * Render an allocation with whatever engine the template declares.
 *
 * For core's own engine that is the same construction the legacy path uses, so
 * helper behaviour is identical by construction rather than by review — a
 * template that rendered differently here than in `KeywordInfillEngine` would
 * be a parity failure nobody could localise, because both sides would look
 * correct in isolation.
 *
 * For anyone else's engine it is their renderer, and an unregistered engine
 * throws rather than being rendered as Handlebars.
 */
export function render(input: RenderInput): RenderedContext {
	const included = input.allocation.blocks.filter((b) => b.included)
	const bySource = (source: string) =>
		included.filter((b) => b.source === source).map((b) => b.content)

	const bySourceBlocks = (source: string) =>
		included.filter((b) => b.source === source)

	/**
	 * Each of Assemble's own variables through its selected layout.
	 *
	 * The object goes in, a string comes out, and the shipped layouts produce
	 * exactly the `JSON.stringify` these three used to be — `{{{json worldLore 0}}}`
	 * is the minified form byte for byte.
	 *
	 * The emptiness rule stays in the *builders* rather than moving in here,
	 * because it is not uniform: `objectByName` returns `undefined` for an empty
	 * set so `{{#if worldLore}}` skips the section, while `characters` renders
	 * `[]` for an empty cast because `JSON.stringify([])` is a truthy string.
	 * Unifying the two would change one of them.
	 */
	const layout = (key: string, value: unknown) =>
		renderVariable(input.variables, key, value)

	// Named *and shaped* the way the existing templates already expect. The
	// names alone were not enough: the first parity run rendered
	// `WORLDLORE:` empty against a legacy
	// `WORLDLORE:{"The Ashguard":"Riders who patrol the ash wastes."}`, because
	// this built arrays where every default story string consumes a keyed JSON
	// object. A variable with the right name and the wrong shape is worse than a
	// missing one — the template renders, and the prompt is quietly wrong.
	const context = {
		// Prompts first, context second — **the order is the fix.** The slot
		// carries the config's authored text exactly as written; the context
		// carries the same fields *resolved*: interpolated, and chosen between
		// the config's and the speaking character's. Spreading the slot last
		// overwrote the resolved value with the raw one, so a prompt rendered
		// the config's text with `{{char}}` still in it where the character's
		// own reinforcement should have been. Both sides looked correct in
		// isolation; only a byte comparison showed it.
		...(input.prompts ?? {}),
		...(input.templateContext ?? {}),
		worldLore: layout(
			"worldLore",
			objectByName(bySourceBlocks("worldLore"))
		),
		// Not laid out, and not an oversight: nothing renders this. Lore bound
		// to a character is folded into that character inside `characters`,
		// under an `"extra lore"` key (docs/context-templates.md is explicit).
		// A layout for it would be a setting that changes nothing.
		characterLore: bySource("characterLore"),
		history: layout("history", objectByDate(bySourceBlocks("history"))),
		currentDate: layout(
			"currentDate",
			currentDateOf(bySourceBlocks("history"))
		),
		chatMessages: input.messages,
		budget: input.allocation.budget,
		// Last, so the resolved block wins over the placeholder the template
		// context carries.
		...(input.postHistory ? { postHistory: input.postHistory } : {})
	}

	const rendered = renderTemplate(input.engine, {
		template: input.template,
		variables: context,
		promptFormat: input.promptFormat
	})

	// SPLIT_CHAT is the role-tagged format; anything else is one flat string.
	// Decided here rather than by the caller so the preview and the send cannot
	// disagree about which shape they are comparing.
	const isSplit = /split/i.test(input.promptFormat ?? "")
	return {
		rendered: isSplit ? undefined : rendered,
		messages: isSplit
			? (parseSplitChatPrompt(rendered) as Array<{
					role: string
					content: string
				}>)
			: undefined,
		usedVariables: referencedVariables(input.template)
	}
}

/**
 * `{{a.b}}`, `{{#each xs}}` — what the template asked for, for diagnostics.
 *
 * Two patterns rather than one, because a single pattern with an optional
 * keyword backtracks on `{{/each}}` and reports the keyword itself as a
 * variable. A diagnostics list that includes `each` teaches a user to distrust
 * the whole panel.
 */
export function referencedVariables(template: string): string[] {
	// One pass, so the list comes out in source order. The lookahead skips
	// closing tags outright — without it, `{{/each}}` backtracks into reporting
	// `each` as a variable, and a diagnostics list with helper names in it
	// teaches a user to distrust the whole panel.
	const found = new Set<string>()
	for (const m of template.matchAll(
		/\{\{(?!\/)#?\s*(?:each|if|unless|with)?\s*([\w.]+)/g
	))
		if (m[1] && m[1] !== "this") found.add(m[1])
	return [...found]
}

const contentOf = (payload: unknown): string => {
	if (typeof payload === "string") return payload
	const p = (payload ?? {}) as Record<string, unknown>
	return String(p.content ?? p.text ?? "")
}
