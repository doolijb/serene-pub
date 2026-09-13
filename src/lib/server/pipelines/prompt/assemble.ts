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

import {
	completionTemplateOf,
	type CompletionTemplate
} from "$lib/shared/constants/completionTemplates"
import { parseSplitChatPrompt } from "$lib/shared/utils/parseSplitChatPrompt"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import type { WireMode } from "$lib/shared/connectionAdapters/wireMode"
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
import { applyPromptBlocks } from "$lib/server/pipelines/prompt/promptBlocks"
import { isShippedPromptBlocks } from "@serene-pub/sdk"

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
	/**
	 * The `blocks` param: which sections the prompt is built from, in what order.
	 *
	 * `unknown` rather than the entry type, because it arrives off a config
	 * value and the honest shape of a config value is "whatever was stored".
	 * `resolvePromptBlocks` is total over it.
	 *
	 * Absent, and the shipped pack, both mean **leave the template alone** — see
	 * `promptBlocks.ts`. Absent is legitimate: the debug preview, the parity
	 * harness and the template editors all render with no configuration in scope.
	 */
	blocks?: unknown
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
	 * The `completion_templates` ROW the format above names, already loaded.
	 *
	 * ⚠ Supplying only the key renders the BUILT-INS and nothing else, because
	 * that is all `completionTemplateOf` can resolve a bare string against. An
	 * admin-authored template therefore rendered as Vicuna — the whole point of
	 * authoring delimiters, absent from every prompt. `world.ts` dereferences
	 * the row and `runtime/bindings.ts` carries it here.
	 *
	 * Optional, and legitimately absent: the debug preview, the parity harness
	 * and the template editors all render with no connection in scope, and a
	 * caller naming a BUILT-IN by key needs nothing else. `completionTemplateOf`
	 * answers absence the same way it always has.
	 */
	completionTemplate?: CompletionTemplate
	/**
	 * Which METHOD the connection this prompt is FOR wants to be called by.
	 *
	 * `chat` means the model is handed role-tagged messages, so the render
	 * produces those and the two fields above have nothing to do — in chat mode
	 * there is no prompt format, not even a default one (NOMENCLATURE §10).
	 * `completion` means one flat string in the connection's own template, which
	 * is what this node has always produced.
	 *
	 * From the same `connection` slot as `promptFormat`, so the shape built here
	 * and the shape the Provider sends are one value. Absent for a caller with no
	 * connection in scope — the debug preview, the parity harness, the template
	 * editors — and absent means "nobody said", which leaves the template's own
	 * `renderMode` deciding exactly as it did before this field existed.
	 */
	wireMode?: WireMode
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
	/**
	 * The format the render ACTUALLY used, for the receipt.
	 *
	 * Published from here rather than re-derived by the caller, because the
	 * caller cannot know it: in chat wire mode this node renders `split_session`
	 * and the connection's own format has no effect on a single byte, so a
	 * receipt stamped from the connection would name a format the prompt was not
	 * written in. Exactly the lie `dispatch.ts` already removed one layer down —
	 * "reporting the value that was USED removes the disagreement instead of
	 * documenting it".
	 */
	promptFormat?: string
	/** What the template actually referenced, for the variable-awareness panel. */
	usedVariables: string[]
	/**
	 * What this render had to do to something, said out loud — for the receipt.
	 *
	 * ⚠ Only ever present when there is something to say. On the ordinary path
	 * this key is ABSENT rather than `[]`, so the payload a normal turn produces
	 * is byte-identical to what it was before this field existed and no parity
	 * golden moves.
	 *
	 * The `NodeReceipt.notes` vocabulary deliberately, because that is where a
	 * fact like this belongs and where a reader debugging a turn looks. It rides
	 * the payload to get there, exactly as `promptFormat` and `usedVariables`
	 * above do: `runtime/bindings.ts` spreads this whole object into the
	 * assemble node's `main`/`context`, and the executor records a node's output
	 * on its receipt row. Publishing it from HERE rather than having the caller
	 * re-derive it is the same rule `promptFormat` states — the caller cannot
	 * know it, because only this function knows what it did.
	 */
	notes?: string[]
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
	/**
	 * The block pack, applied to the story string before anything renders.
	 *
	 * Two answers mean **leave the template alone** and both take this branch:
	 * nobody configured a pack, and the pack is the one Serene Pub ships. So the
	 * ordinary turn renders the template's own bytes rather than the template's
	 * bytes rebuilt from a reordering that happened to be the identity — which
	 * is what keeps the parity corpus comparing prompts, and what stops the
	 * shipped order being imposed on a story string somebody wrote themselves.
	 */
	const packed =
		input.blocks === undefined || isShippedPromptBlocks(input.blocks)
			? { template: input.template, notes: [] as string[] }
			: applyPromptBlocks(input.template, input.engine, input.blocks)

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

	/**
	 * WHICH TEMPLATE the blocks are wrapped in — and therefore which shape comes
	 * out, because the two are one decision.
	 *
	 * ## Chat wire mode
	 *
	 * `split_session` is not a format. It emits `<@role:…>` markers into one
	 * string and parses them straight back out into a messages array, so it is a
	 * transport for getting structure through a string-shaped seam — which is
	 * exactly what a chat-shaped API needs and what the connection's own
	 * delimiters cannot provide. In chat mode there is therefore no prompt format
	 * at all, not even a default one (NOMENCLATURE §10), and any the connection
	 * happens to carry is deliberately ignored here.
	 *
	 * ⚠ **This is the guarded path, and a second way to produce messages must
	 * not be written.** `PromptBlockFormatter` neutralises any literal marker
	 * appearing in user content, because a lore entry containing
	 * `<@role:system>` would otherwise parse as a real system message and — for
	 * Anthropic — be promoted into the top-level system prompt. The emitter, the
	 * neutralised pattern and the parser are a three-way correspondence with four
	 * injection tests over it. Building messages structurally is the design's
	 * eventual replacement for all of it; a third spelling now would be one more
	 * thing to retire.
	 *
	 * ## Completion wire mode, and callers with no connection
	 *
	 * The connection's own resolved row, exactly as before. A caller with no
	 * connection in scope — the debug preview, the parity harness, the template
	 * editors — supplies no wire mode, and this falls through to the same
	 * expression it has always been.
	 *
	 * ⚠ The template's own `renderMode` below, never a substring test on its
	 * name. This read `/split/i.test(input.promptFormat ?? "")`, which was
	 * survivable only while the eight format keys were a hardcoded list nobody
	 * could add to. With templates as rows a name is user-supplied: "Splitwise",
	 * "my split format" or a Vicuna variant someone called "split-role test"
	 * would each switch the WHOLE pipeline to role-array output — returning
	 * `rendered: undefined` to a text-completion adapter and running the
	 * role-marker parser over a string containing no markers, which yields an
	 * empty messages array. Both failures surface as an empty generation.
	 *
	 * The resolved ROW first, then the key: `renderMode` is a column, so a
	 * template that is not a built-in can only answer this question from the row
	 * somebody loaded. Reading the key alone would send every admin-authored
	 * template down the flat branch regardless of what its row says.
	 */
	const chatWire = input.wireMode === "chat"
	const emit = chatWire
		? completionTemplateOf(PromptFormats.SPLIT_CHAT)
		: completionTemplateOf(input.completionTemplate ?? input.promptFormat)
	// What the receipt should report, which is what was USED rather than what
	// the row says — the same rule `dispatch.ts` states about `meta.promptFormat`.
	// In chat mode the connection's format had no effect on a single byte, so
	// naming it would put a reader debugging an empty reply on the wrong trail.
	const promptFormat = chatWire
		? PromptFormats.SPLIT_CHAT
		: input.promptFormat

	const rendered = await renderTemplate(input.engine, {
		template: packed.template,
		variables: context,
		promptFormat,
		// The resolved row, where the caller had one to resolve. The key stays
		// beside it: it is what the receipt reports and what a plugin's engine
		// has always been handed.
		completionTemplate: emit,
		// The run, so a plugin's engine rendering a large context is a call
		// cancelling that run can still find. Absent when the caller has no run —
		// the debug preview and the parity harness both render through here.
		runId: input.runId,
		user: input.user
	})

	const isSplit = emit.renderMode === "role_array"
	const messages = isSplit
		? (parseSplitChatPrompt(rendered) as Array<{
				role: string
				content: string
			}>)
		: undefined

	/**
	 * A context template that emits no role blocks: degrade LOUDLY, never refuse.
	 *
	 * ⚠ The one way chat wire mode can still lose a whole prompt, and it is worth
	 * a paragraph rather than a shrug. `parseSplitChatPrompt` finds messages by
	 * looking for the markers `{{#systemBlock}}` / `{{#userBlock}}` /
	 * `{{#assistantBlock}}` emit; a template written without them renders
	 * perfectly good text containing none, and the parse comes back EMPTY. Sent
	 * as-is, that is a request with an empty conversation in it — the same silent
	 * loss the wire-mode work removed, arriving by a different door.
	 *
	 * It could not happen before, because every render was flat whatever the
	 * connection wanted, so a block-less template worked everywhere. It is
	 * therefore a real configuration somebody is UPGRADING with — their template
	 * worked yesterday.
	 *
	 * ## Why this stopped being a throw
	 *
	 * It threw. That is the project's governing rule broken in one line: **an
	 * unavailable mechanism SUBTRACTS A SIGNAL; it never disables a path.** Role
	 * structure is a mechanism, the template does not supply it, and the honest
	 * consequence is a prompt with less structure than it might have had — not a
	 * turn that fails. The user's alternative was to lose the reply outright and
	 * be told to go and rewrite a template mid-conversation.
	 *
	 * So the whole rendered text goes out as ONE `user` message, and the receipt
	 * says so in the sentence the throw used to carry. The two halves matter
	 * together: keeping the bytes without reporting it would be the quiet
	 * structure-loss the old comment rightly refused, and reporting it without
	 * keeping the bytes is the throw again.
	 *
	 * ⚠ **`user`, and not `system`.** This is the inverse of
	 * `buildTextPromptFromMessages` (`BaseConnectionAdapter`), which flattens a
	 * role array into one string and appends an open assistant block for the
	 * model to write into. Run backwards over a string carrying no markers there
	 * is exactly one honest answer: the whole body is the turn the model is being
	 * asked to continue, which is what `user` means. `system` would be actively
	 * wrong — Anthropic hoists a system message to a top-level field and several
	 * backends weight it differently, so the text would be moved somewhere the
	 * author never put it; `assistant` would read as a prefill of the reply.
	 *
	 * An EMPTY render still falls through untouched — nothing was lost, and "this
	 * session has nothing in it" is a different problem with different owners.
	 */
	// The pack's own account of what it did comes first: a reader debugging a
	// prompt with a section missing should meet "prompt blocks, in order: …"
	// before anything about role structure.
	const notes: string[] = [...packed.notes]
	if (isSplit && messages!.length === 0 && rendered.trim() !== "") {
		messages!.push({ role: "user", content: rendered })
		notes.push(
			// The same sentence the throw carried, and the same branch, because
			// the fix still differs: a chat CONNECTION is changed on the
			// connection, while a role-array TEMPLATE is changed by picking a
			// different one. Only the first clause is new — it says what was
			// done, so a reader is not left inferring it from a prompt that
			// merely looks flat.
			"the whole rendered prompt was sent as one user message: " +
				(chatWire
					? "this connection is chat wire mode, "
					: "this connection's completion template renders role messages, ") +
				"but the context template produced no role blocks, so there are no " +
				"messages to send. Role messages are marked out by {{#systemBlock}}, " +
				"{{#userBlock}} and {{#assistantBlock}} — those are what say where one " +
				"message ends and the next begins. Wrap the context template's sections " +
				"in them, or " +
				(chatWire
					? "set this connection to completion wire mode, where one flat prompt is the expected shape."
					: "pick a flat completion template, where one prompt string is the expected shape.")
		)
	}

	return {
		rendered: isSplit ? undefined : rendered,
		messages,
		promptFormat,
		// The template that ACTUALLY rendered, which is not `input.template`
		// once a pack has dropped a block: the variable-awareness panel lists
		// what the prompt contains, never what the story string offered.
		usedVariables: referencedVariables(packed.template),
		// Absent, not empty, on the ordinary path — see `RenderedContext.notes`.
		...(notes.length ? { notes } : {})
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
