/**
 * Assemble: allocated context in, rendered prompt out.
 *
 * The Task that turns *what was selected* into *what will be sent*. Two halves,
 * split because 16 §7 says they are different jobs:
 *
 *   **allocation** — which allocations are in, in what order, at what cost,
 *                    and why
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
import { entryDeclarations } from "$lib/server/entries/declarations"
import type { EntryOrderKey, EntryRoles } from "@serene-pub/sdk"
import {
	renderTemplate,
	type RenderRun
} from "$lib/server/pipelines/prompt/renderers"
import {
	renderVariable,
	type ResolvedLayouts
} from "$lib/server/pipelines/entities/variableLayouts"
import type { Decision } from "$lib/server/pipelines/ranking/select"

/**
 * **One retrieved item, with its verdict** — what selection hands to rendering.
 *
 * ⚠ **Not a block.** A *block* is one message — `system`, `user`, `assistant`
 * (NOMENCLATURE §15) — and a dozen allocations render into the variables inside
 * one of them. This was `ContextBlock`, which named an item at a container's
 * granularity and asserted a message shape only chat-shaped services have.
 */
export interface Allocation {
	/** `worldLore`, `message`, `history`… — what a receipt groups by. */
	source: string
	id: number | string
	content: string
	tokens: number
	/**
	 * The entry's title. Not decoration: the default templates receive world
	 * lore as `{"<name>": "<content>"}`, so an allocation without its name
	 * cannot be rendered into the shape a user's story string already expects.
	 */
	name?: string
	/**
	 * The few extra fields rendering needs and nothing more — history's date
	 * parts, today. Deliberately not the whole payload: an allocation travels in
	 * the receipt and along every downstream edge, and "carry it all just in
	 * case" is how a lore row's private fields end up in a debug panel.
	 */
	meta?: Record<string, unknown>
	/**
	 * Why this allocation is here, or is not.
	 *
	 * Carried on the allocation rather than derived at render time, because the
	 * numbers that produced the decision exist upstream and nowhere else once
	 * the selection loop has moved on (16 §7c).
	 */
	why: string[]
	included: boolean
}

export interface AllocatedContext {
	/**
	 * ⚠ **The field keeps the SDK's word while the type carries ours** (R5:
	 * reconcile at the boundary, never merge). This object is handed to the SDK
	 * executor on the `context` port, and `isAllocatedContext` — an *exported*
	 * SDK predicate, so third-party nodes may call it — recognises an allocated
	 * context by `Array.isArray(v.blocks)` and nothing else. Renaming this to
	 * `allocations` would leave `receipt.preview.blocks` silently empty on every
	 * run and break that predicate for every plugin. The rename is real and
	 * belongs with the SDK's own `wire.ts`, whose `ContextBlock` is a different
	 * shape under the same name; NOMENCLATURE §24 carries it.
	 */
	blocks: Allocation[]
	totalTokens: number
	budget: { total: number; used: number; remaining: number }
	/** Per source: allocated, used, entries — the arithmetic a panel shows. */
	groups: Record<string, { allocated: number; used: number; entries: number }>
}

/**
 * Turn selection decisions into an allocation.
 *
 * Excluded candidates are **kept, with `included: false`** rather than
 * dropped. A user asking "why isn't my lore showing up" is asking
 * about something that is absent, so an allocation that only lists what made it
 * cannot answer them.
 */
export function allocate(
	decisions: readonly Decision[],
	opts: { budgetTotal: number; groups?: AllocatedContext["groups"] }
): AllocatedContext {
	const allocations: Allocation[] = decisions.map((d) => {
		const payload = (d.candidate.payload ?? {}) as Record<string, unknown>
		return {
			source: d.candidate.source,
			id: d.candidate.id,
			content: contentOf(d.candidate.payload),
			tokens: d.candidate.tokens,
			name: typeof payload.name === "string" ? payload.name : undefined,
			meta: orderMeta(d.candidate.source, payload),
			included: d.included,
			why: [d.why, `score ${d.score.toFixed(3)}`, d.reason]
		}
	})

	const used = allocations
		.filter((a) => a.included)
		.reduce((sum, a) => sum + a.tokens, 0)

	return {
		blocks: allocations,
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
 * The roles of the type whose rows compete in a budget band.
 *
 * The renderer asks the *type* which field plays which part rather than knowing
 * the shape — which is what a fourth entry type needs to be true, and what
 * stops `objectBy…` accumulating one function per shape. Keyed by `sourceKind`
 * because that is the vocabulary an `Allocation` carries: it came out of the
 * ranker, and the ranker groups by band.
 *
 * `undefined` for a band no entry type declares (`messages`, `relationships`, or
 * an index-vocabulary source) — those are not entries and never reach the two
 * projections below.
 */
const ROLES_BY_SOURCE = new Map<string, EntryRoles>(
	entryDeclarations().map((d) => [d.sourceKind, d.roles])
)

const rolesOfSource = (source: string): EntryRoles | undefined =>
	ROLES_BY_SOURCE.get(source)

/**
 * An allocation set as `{"<heading>": "<content>"}`, with the type choosing the
 * heading and the order.
 *
 * Two projections, and the type picks between them by what it declares:
 *
 *  · **a `title` role** — headed by the title, in the order they arrived.
 *    World lore and character lore.
 *  · **an `order` role and no title** — sorted by the declared order keys and
 *    headed by the order key itself. History is not *named*; it is **dated**,
 *    and its heading is that date.
 *
 * A source with neither (or one no type declares) falls back to the title form,
 * which is what every non-entry allocation already got.
 *
 * `undefined` rather than `{}` when empty, matching the legacy engines: a
 * template writing `{{#if worldLore}}` has to see the same falsiness, and an
 * empty object is truthy. The object, not the JSON — stringification happens at
 * the call site, so a variable layout is handed the shape and decides how to
 * present it. The emptiness rule stays here, per variable, because it is not
 * uniform: `characters` renders `[]` for an empty cast (`JSON.stringify([])` is
 * a truthy string) while world lore vanishes, and unifying the two would change
 * one of them.
 *
 * ⚠ **The two bodies below are the two that were here, unchanged.** What moved
 * is *which one runs*, from a hardcoded call site to the declaration. The
 * emptiness rules differ between them — the titled form wants a non-empty
 * heading and truthy content, the ordered form skips blank-after-trim content —
 * and that difference is preserved rather than tidied, because tidying it is a
 * change to what a prompt contains.
 */
export function objectByRole(
	allocations: readonly Allocation[],
	roles: EntryRoles | undefined
): Record<string, string> | undefined {
	const obj: Record<string, string> = {}

	if (!roles?.title && roles?.order) {
		for (const a of sortByOrder(allocations, roles.order)) {
			if (!a.content?.trim()) continue
			obj[orderKeyOf(a, roles.order)] = a.content
		}
	} else {
		for (const a of allocations)
			if (a.name && a.content) obj[a.name] = a.content
	}

	return Object.keys(obj).length ? obj : undefined
}

/**
 * The declared order, applied.
 *
 * Reproduces the arithmetic this replaces (`year * 10000 + month * 100 + day`,
 * descending) exactly, and for the same reason it worked: an absent part reads
 * as `0`, which in a descending sort puts it last — which is what
 * `nulls: 'last'` says. `Array.prototype.sort` is stable in every engine this
 * runs on, so allocations that tie keep the order they arrived in, as before.
 */
const sortByOrder = (
	allocations: readonly Allocation[],
	order: readonly EntryOrderKey[]
): Allocation[] =>
	[...allocations].sort((a, z) => {
		for (const key of order) {
			const av = partOf(a, key.field)
			const zv = partOf(z, key.field)
			if (av === zv) continue
			const ascending = av - zv
			return key.dir === "desc" ? -ascending : ascending
		}
		return 0
	})

const partOf = (a: Allocation, field: string): number =>
	Number((a.meta as Record<string, unknown> | undefined)?.[field] ?? 0)

/**
 * The heading for an allocation of an ordered type — its order key, rendered.
 *
 * ⚠ **Core formats this, not the type**, and that is the honest limit of what
 * the roles vocabulary buys here. The `order` role says which fields order the
 * allocation, which is what chooses this projection; *how those fields read as a
 * heading* is calendar knowledge, and history is the only ordered type there
 * is. A second one wants a **named policy** — the way `anchor` names
 * `core:policy/binding-visibility@1` — rather than a branch in this function.
 *
 * Byte for byte what `formatHistoryDateKey` produced over the same parts: the
 * first key bare with an absent one reading `0`, every later present key
 * appended zero-padded to two, and an absent middle key skipped rather than
 * terminating the string.
 */
const orderKeyOf = (
	a: Allocation,
	order: readonly EntryOrderKey[]
): string => {
	const meta = a.meta as Record<string, unknown> | undefined
	const parts = order.map((k) => meta?.[k.field])
	let key = String(parts[0] ?? 0)
	for (const part of parts.slice(1))
		if (part != null) key += `-${String(part).padStart(2, "0")}`
	return key
}

/**
 * The most recent history entry's date, as parts.
 *
 * ⚠ Returned `formatDate(...)` — a finished `"412-03"` — until the layout took
 * over the formatting. A pre-formatted value is one a layout cannot lay out:
 * the separator, the order, whether the month is padded and whether it is even
 * a number were all decided here, several layers above anyone who might want
 * them different.
 *
 * `month` and `day` are omitted rather than set to null when the entry lacks
 * that precision, so a layout can ask `{{#if (isSet currentDate.month)}}`
 * without having to know the difference.
 */
function currentDateOf(
	allocations: readonly Allocation[],
	roles: EntryRoles | undefined
): { year: number; month?: number; day?: number } | undefined {
	const order = roles?.order
	const newest = order
		? sortByOrder(allocations, order)[0]
		: allocations[0]
	if (!newest?.meta) return undefined
	const m = newest.meta as { year?: number; month?: number; day?: number }
	if (m.year === undefined) return undefined
	return {
		year: m.year,
		...(m.month != null ? { month: m.month } : {}),
		...(m.day != null ? { day: m.day } : {})
	}
}

/**
 * The parts an allocation needs to be *ordered and headed*, and nothing more.
 *
 * Which parts those are is the type's `order` role — history's year, month and
 * day today. An allocation travels in the receipt and along every downstream edge,
 * and "carry it all just in case" is how a lore row's private fields end up in
 * a debug panel, so this stays the declared order keys and only them.
 *
 * `undefined` when the leading key is absent, which is what the shape this
 * replaces tested (`payload.year`): a row of an ordered type with no order
 * value has nothing to sort or head by, and a row of an unordered type has no
 * order role at all.
 */
function orderMeta(
	source: string,
	payload: Record<string, unknown>
): Record<string, unknown> | undefined {
	const order = rolesOfSource(source)?.order
	if (!order?.length) return undefined
	const lead = payload[order[0].field]
	if (lead === undefined || lead === null) return undefined
	return Object.fromEntries(order.map((k) => [k.field, payload[k.field]]))
}

/**
 * Depth → render index, for script injections (18 §4a).
 *
 * `postHistory`'s arithmetic exactly: depth 0 lands in the seed placeholder's
 * iteration (right after the newest real message), depth N lands N real
 * messages earlier, clamped to the top so an over-deep entry still renders
 * rather than vanishing. Entries keep their declared order within one index.
 */
export function resolveInjections(
	injections: unknown,
	messageCount: number
): Record<number, Array<{ role: string; content: string }>> {
	const out: Record<number, Array<{ role: string; content: string }>> = {}
	if (!Array.isArray(injections) || !messageCount) return out
	for (const e of injections as Array<{
		role?: string
		content?: unknown
		depth?: unknown
	}>) {
		if (!e || typeof e.content !== "string" || !e.content) continue
		const depth =
			typeof e.depth === "number" && Number.isInteger(e.depth)
				? Math.max(0, e.depth)
				: 0
		const idx = Math.max(0, messageCount - 1 - depth)
		;(out[idx] ??= []).push({
			role:
				e.role === "user" || e.role === "assistant" ? e.role : "system",
			content: e.content
		})
	}
	return out
}

/**
 * Rendering a template, plus the run doing the rendering.
 *
 * `RenderRun` rides on the input rather than on a second argument because both
 * the story string and every variable layout can name a plugin's engine: one
 * assemble step is potentially several sandboxed hook calls, and they all have
 * to carry the same run id or cancelling the run reaches only some of them.
 */
export interface RenderInput extends RenderRun {
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
	 * Found by comparing against a real session: eight corpus fixtures missed it,
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
	/**
	 * Decides whether the result is one string or role-tagged messages, and
	 * which wrapper the blocks get.
	 *
	 * From the assemble node's `connection` slot, which every shipped spec
	 * shares with the Provider that sends (`runtime/bindings.ts`). It was
	 * `undefined` on every pipeline run until that slot existed — no port, no
	 * slot and no spec supplied it — so `renderers.ts` fell back to Vicuna
	 * whatever the connection said. Absent is still legitimate for a caller
	 * with no connection in scope (the debug preview, the parity harness, the
	 * admin template editors) and still means Vicuna.
	 */
	promptFormat?: string
	/**
	 * Which template language `template` is written in.
	 *
	 * **Required, and no longer nullable.** It was `string | null`, on the
	 * reading that NULL meant core's default — and for the whole of 0.6 to date
	 * it was null on every run, because `world.ts` dereferenced the template row
	 * for its `source` and dropped the `engine` beside it. Every context
	 * template on every install rendered as Handlebars whatever it declared,
	 * with nothing anywhere to show it. Both template tables store `engine` NOT
	 * NULL now, so an absence here can only mean a caller lost it in transit.
	 */
	engine: string
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
export async function render(input: RenderInput): Promise<RenderedContext> {
	const included = input.allocation.blocks.filter((a) => a.included)
	const bySource = (source: string) =>
		included.filter((a) => a.source === source).map((a) => a.content)

	const allocationsFrom = (source: string) =>
		included.filter((a) => a.source === source)

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
		renderVariable(input.variables, key, value, input)

	// Laid out ahead of the object literal because layouts may render through
	// a plugin's engine now — an await inside the literal would read fine and
	// interleave the three renders with whatever else the executor is doing.
	// Sequential on purpose: three renders per turn is not a fan-out worth the
	// nondeterministic completion order in a trace.
	const worldLoreRoles = rolesOfSource("worldLore")
	const historyRoles = rolesOfSource("history")
	const historyAllocations = allocationsFrom("history")
	const worldLoreLaidOut = await layout(
		"worldLore",
		objectByRole(allocationsFrom("worldLore"), worldLoreRoles)
	)
	const historyLaidOut = await layout(
		"history",
		objectByRole(historyAllocations, historyRoles)
	)
	const currentDateLaidOut = await layout(
		"currentDate",
		currentDateOf(historyAllocations, historyRoles)
	)

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
		worldLore: worldLoreLaidOut,
		// Not laid out, and not an oversight: nothing renders this. Lore bound
		// to a character is folded into that character inside `characters`,
		// under an `"extra lore"` key (docs/context-templates.md is explicit).
		// A layout for it would be a setting that changes nothing.
		characterLore: bySource("characterLore"),
		history: historyLaidOut,
		currentDate: currentDateLaidOut,
		sessionMessages: input.messages,
		// Script injections, resolved from depth to a render index — the same
		// arithmetic and the same moment as `postHistory.targetIndex` (§20):
		// depth 0 is the seed placeholder's own iteration, depth N is N real
		// messages earlier, clamped so an over-deep entry renders at the top
		// instead of vanishing. Data for the template's own loop, never a
		// splice (18 §4a, ruling 2026-08-23) — the template renders them where
		// its author put the block, and an empty map renders nothing at all.
		injectionsByIndex: resolveInjections(
			(input.templateContext as { injections?: unknown } | undefined)
				?.injections,
			input.messages.length
		),
		budget: input.allocation.budget,
		// Last, so the resolved block wins over the placeholder the template
		// context carries.
		...(input.postHistory ? { postHistory: input.postHistory } : {})
	}

	const rendered = await renderTemplate(input.engine, {
		template: input.template,
		variables: context,
		promptFormat: input.promptFormat,
		// The run, so a plugin's engine rendering a large context is a call
		// cancelling that run can still find. Absent when the caller has no run —
		// the debug preview and the parity harness both render through here.
		runId: input.runId,
		user: input.user
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
