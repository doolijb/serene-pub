/**
 * What a core binding's `input` and `ctx` are, as types.
 *
 * ⚠ **Both were `any`, and that is what let two phantom reads survive.**
 * `bindings.ts` declared every handler `(input: any, ctx: any)`, so
 * `input?.topK` — a *parameter* of `core:query/vector-search@1` and never an
 * in-port — type-checked for weeks while the host ran on a literal 40, and
 * `input?.continuationPrefill` was read for a whole release before the port it
 * names existed. Neither is a subtle mistake; both are a property access on an
 * `any`, which is `undefined` at runtime and silent at build.
 *
 * The fix is the same one `host.ts` applied one layer down when its `db: any`
 * went: name the shape, and let the reads that do not fit stop compiling.
 *
 * ## Where each half comes from
 *
 *  - **`ctx`** is the SDK's own per-kind injection surface — `TaskCtx`,
 *    `QueryCtx`, `OracleCtx`, `OutletCtx`, exactly as `executor.ts` builds
 *    them. Nothing here re-declares one; `CoreQueryCtx` below narrows a single
 *    member of `QueryCtx` and inherits the rest, and the reason is written at
 *    it.
 *  - **`input`** is **derived from the contract** — `InputOf` in the SDK
 *    (`sdk/src/nodeInput.ts`), off the node's own `ports.in`, its declared slot
 *    names, and its `params` slot's schema. This file adds nothing to that
 *    derivation any more; it aliases it under the two words this file's call
 *    sites already read by, and keeps the two categories countable.
 *
 * ## ⚠ What changed, and what it retired (ruling 2026-09-10)
 *
 * This file used to *build* the input type: a `PortsIn<P>` helper deriving port
 * names, plus a hand-written `CoreSlot` union standing in for slots, and every
 * value `any`. Two things were lost to that, and both are back:
 *
 *  1. **Parameters were never checked at all.** A `params` slot's schema keys
 *     had nowhere to come from, because `describeQueryDefinition` erased its slots
 *     into `Record<string, SlotDecl>` — so `input.params.anything` was an `any`
 *     lookup, which is exactly how `topK` and `limit` came to be read at a
 *     spelling nothing supplies. The SDK's `describe*` now captures its slots
 *     argument, so the schema survives into the type.
 *  2. **Slots were a fixed vocabulary, not the node's own.** `CoreSlot` listed
 *     eight words every node accepted; `input.template` on a node with no
 *     template slot compiled and yielded `undefined`. Slot names are now
 *     per-node.
 *
 * Parameter *values* are typed too — `params.limit` is a `number` because the
 * declaration says `'integer'` — which is new. Port values stay `any`, and
 * that is not laziness: `ports.in` maps a port to a `ShapeId`, a string id in a
 * runtime registry with no TS payload behind it, so there is nothing to derive
 * a value type from (see `shapes.ts`).
 */

import type {
	OutletCtx,
	InputOf,
	OracleCtx,
	QueryCtx,
	SharedInput as ContractIntersection,
	TaskCtx
} from "@serene-pub/sdk"

// ── Keys the contract does not declare ──────────────────────────────────────
//
// `resolveInput` hands a binding the node's whole `config` with data refs and
// slot refs resolved in place — so an input key is any of three things: a
// declared in-port a spec wired, a declared slot, or a **literal a spec author
// wrote into the node's config**. Only the first two are on the descriptor, and
// a closed type over ports and slots alone would therefore refuse reads that are
// entirely correct.
//
// ⚠ An authored literal and a wired edge arrive on the same key, indistinguishably
// — which is what lets a port be declared for one and satisfied by the other, and
// is how `loreType` on the three summarize Providers is now declared rather than
// exempted (D-I). The category below is for a key the contract names NOWHERE.
//
// The two aliases below are identities. They exist so that every such key is
// stated at the call site under a word that says *why* it is allowed, and so
// the two populations are countable:
//
//     grep -c 'Unsupplied<' bindings.ts
//
// That count is the file's phantom-read budget. It was invisible before.

/**
 * A key something really supplies — a shipped spec's wiring or authored config,
 * or this file's own side-character wrapper — that the contract declares no
 * port for.
 *
 * ⚠ Each of these is a **finding, not an exemption**: the port arguably should
 * be declared, and declaring it is a public-contract change with a content-hash
 * and re-projection cost, so it is reported rather than made here.
 *
 * ## ⚠ The population is TWO, and both are supplied by code rather than a spec
 *
 * There were seven, across five handlers, and D-I declared all seven: `decisions`
 * and `messages` on `core:task/assemble@2`, the two relationship reads and the
 * two side-character speaker fields on `core:task/build-template-context@1`, and
 * `loreType` on the three summarize Providers. Each one is now a real in-port,
 * so each read is typed by the contract and no longer needs naming here.
 *
 * Two remain, and both name a supplier this file can see and no spec can: the
 * `tools` port `generateBinding` reads, declared on `generate-with-tools@1` and
 * not on `generate-text@1` (the handler is typed against the intersection); and
 * `fields` on `core:task/build-template-context@1`, which the four adventure
 * wrappers hand to the shared builder off their OWN declared `fields` ports.
 * Each pin's `reads<…>()` declaration names the port only where its definition
 * declares it, so the guard in `boot/declaredReads.ts` sees both as read where
 * they are declared and neither as a phantom.
 *
 * The alias is kept as the word the next such finding is written under; `grep
 * -c 'Supplied<'` is the count, and a third is a finding.
 *
 * @typeParam Why A sentence naming what supplies the key. Required for the same
 * reason `Unsupplied`'s is — see there.
 */
export type Supplied<K extends string, Why extends string> = K

/**
 * A key **nothing supplies today** — a fallback branch that cannot fire.
 *
 * ## ⚠ The population is ZERO (R-12, 2026-09-16)
 *
 * Sixteen reads carried this word and every one was swept — see the note at
 * the top of `bindings.ts` for the list. The archaeology the earlier text
 * asked for was done: no spec, no migration and no host write ever formed any
 * of those keys, so each `??` was a branch that could not fire, and deleting
 * it changes what no install retrieves. The alias stays as the word the next
 * such read is written under, should one be needed; `grep -c 'Unsupplied<'`
 * reading zero is the fact.
 *
 * @typeParam Why Why this exemption exists, written at the site.
 *
 * ⚠ **Required, and that is the point of the second parameter.** An exemption
 * with no stated reason is indistinguishable from one nobody re-examined, and
 * this list is meant to shrink: the sentence is what a later reader needs to
 * decide whether the key can now go. The parameter is phantom — the type is
 * still just `K` — so it costs a run nothing and cannot be forgotten.
 */
export type Unsupplied<K extends string, Why extends string> = K

/**
 * A **parameter** name the contract's `params` schema does not declare.
 *
 * The same category as `Unsupplied` one level down, and it needs its own word
 * because the derivation now reaches that far: `input.params` is typed from the
 * declared schema, so a read of a name the schema does not carry is a type
 * error rather than an `any` lookup. That is the half the two shipped defects
 * lived in, so the exemption for it is deliberately narrow and deliberately
 * countable:
 *
 *     grep -c 'UnsuppliedParam<' bindings.ts
 *
 * @typeParam Why Required, for `Unsupplied`'s reason — see there.
 */
export type UnsuppliedParam<K extends string, Why extends string> = K

/**
 * A binding's `input`: whatever its contract declares, plus whatever undeclared
 * keys the handler has been shown to legitimately receive.
 *
 * `InputOf` does the work — see the file header. `Extra` and `ExtraParams` are
 * the escape hatches, and every use of either is spelled `Unsupplied<…>`,
 * `UnsuppliedParam<…>` or `Supplied<…>` so the populations stay countable by
 * `grep`.
 */
export type NodeInput<
	P,
	Extra extends string = never,
	ExtraParams extends string = never
> = InputOf<P> &
	Partial<Record<Extra, any>> &
	([ExtraParams] extends [never]
		? unknown
		: { params?: Partial<Record<ExtraParams, any>> })

/**
 * One handler, several node definitions.
 *
 * Its input is the **intersection** of what those contracts supply: it may read
 * only what *every* one of them declares. That is what makes binding one
 * function to three type ids sound — whichever the run resolved, every name the
 * handler touches is declared by it — and it is the compile-time half of the
 * rule `structuralCompat` enforces at run time for a plugin binding to somebody
 * else's type.
 *
 * ```ts
 * // the three lore lanes are one scan filtered three ways
 * function loreFor(
 *   source: string,
 *   input: SharedInput<[typeof C.worldLore, typeof C.characterLore, typeof C.historyEntries]>,
 *   ctx: CoreQueryCtx
 * ) { … }
 * ```
 *
 * ⚠ Not `NodeInput<typeof C.worldLore>` with the other two assumed to match.
 * That is what the three lore lanes and the three summarize Providers were
 * doing, and it is only ever right by coincidence: the day one lane declares a
 * port the others do not, the handler reads `undefined` on two of them with
 * nothing failing anywhere.
 */
export type SharedInput<
	Ps extends readonly unknown[],
	Extra extends string = never
> = ContractIntersection<Ps> & Partial<Record<Extra, any>>

// ── The per-kind contexts ───────────────────────────────────────────────────

/**
 * The tables `createHost` answers a `ctx.read` for.
 *
 * The SDK types `read`'s first argument as a bare `string`, which makes a
 * misspelt table the same class of silent nothing a misspelt port is: `host.ts`
 * falls through its switch and the binding gets an empty result that reads
 * exactly like an empty table. Narrowed here so the two hazards close together.
 */
export type HostTable =
	| "session_messages"
	| "sessions"
	| "session_greetings"
	| "summarize_source"
	| "lorebook_entries"
	| "session_cast"
	| "graph_scenes"
	| "session_state"
	| "graph_context"
	| "graph_relationships"
	| "graph_entry_links"
	| "embedding_status"
	| "vector_search"
	| "entity_annotations"
	| "mention_spans"
	| "entity_link"
	| "available_tools"

/**
 * A Query's context: the SDK's `QueryCtx` with one member narrowed.
 *
 * `read` is the only divergence, and it goes in two directions at once. The
 * table name **tightens** to `HostTable` above. The result **loosens** from the
 * SDK's `unknown` to `any`, which is deliberate and is the seam left open: row
 * shapes belong to `host.ts`'s thirteen read cases, and typing them is its own
 * change with its own findings. Spelling it here — rather than casting at each
 * of the twenty-nine call sites — keeps that seam in one place where the next
 * lane can find it, instead of scattering twenty-nine `as any`.
 *
 * Everything else is inherited: `countTokens`, `log`, `progress`, `signal`,
 * `scripts`, `random`. A ctx method that does not exist does not compile.
 */
export interface CoreQueryCtx extends Omit<QueryCtx, "read"> {
	read(table: HostTable, query?: unknown): Promise<any>
}

export type { OutletCtx, OracleCtx, TaskCtx }
