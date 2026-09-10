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
 *    `QueryCtx`, `ProviderCtx`, `ConsumerCtx`, exactly as `executor.ts` builds
 *    them. Nothing here re-declares one; `CoreQueryCtx` below narrows a single
 *    member of `QueryCtx` and inherits the rest, and the reason is written at
 *    it.
 *  - **`input`** is derived from `@serene-pub/contracts` — the node's own
 *    declared `ports.in`, read off the pinned descriptor's type, widened by the
 *    fixed slot vocabulary `CoreSlot` (see the note there for why the slots
 *    cannot be derived per node). There is no `InputOf` in the SDK or in
 *    contracts to import — a shape id is an opaque string, so no port *value*
 *    type can be derived — so `PortsIn` below is the one generic helper this
 *    app adds. It derives port **names**, which is the half that matters: a
 *    read of a name the contract does not declare is a type error, and every
 *    value stays `any`, so nothing about what a binding does with a port it
 *    legitimately has changes.
 */

import type {
	ConsumerCtx,
	ProviderCtx,
	QueryCtx,
	TaskCtx
} from "@serene-pub/sdk"

// ── The descriptor's declared surface ───────────────────────────────────────

/** The descriptor behind a pinned contract — `typeof C.worldLore` → its type. */
type DescriptorOf<P> = P extends { descriptor: infer D } ? D : never

/**
 * A map's literal keys, or `never` when it widened to an index signature.
 *
 * The guard is load-bearing rather than defensive. `describeQueryType` infers
 * its port maps, and a type that declares no `in` at all infers the open
 * `PortDecl` — `{[port: string]: ShapeId}` — whose `keyof` is `string`. Without
 * this, such a node's input would accept *every* name and the whole exercise
 * would silently opt out on exactly the types that declare least.
 */
type ClosedKeys<T> =
	string extends Extract<keyof T, string> ? never : Extract<keyof T, string>

/**
 * The in-port names a contract declares, as a union of literals.
 *
 * Names only. `ports.in` maps a port to a `ShapeId`, which is a string id in a
 * runtime registry with no TS payload attached, so there is nothing to derive a
 * value type *from* — see `shapes.ts`. Ports therefore carry `any`, and this
 * helper's entire job is that `input.topK` on a node whose ports are
 * `{vectors, scope}` does not compile.
 */
export type PortsIn<P> =
	DescriptorOf<P> extends { ports: { in?: infer I } }
		? ClosedKeys<NonNullable<I>>
		: never

/**
 * The slot names a binding may read off its input.
 *
 * ⚠ A fixed vocabulary rather than a per-node derivation, and the attempt is
 * worth recording so nobody spends the afternoon again. `describeProvider` does
 * keep its slot literals — the `const S` that makes `ctx.can()` narrow — but it
 * returns them as an *intersection* with the base `Descriptor`, whose own
 * `slots` is the open `Record<string, SlotDecl>`; inferring or indexing through
 * that intersection yields `string` for `keyof` either way, so the literals are
 * unreachable from here. Every other `describe*` widens outright.
 *
 * A closed list still catches the whole population that matters: a slot name is
 * a fixed word in the executor's `resolveSlot`, so `input.promptConfig` and
 * `input.narratorName` — two dead reads this file was carrying — fail against
 * it. What is lost is only per-node precision: reading `input.template` on a
 * node that declares no template slot compiles, and yields `undefined`.
 */
type CoreSlot =
	| "params"
	| "connection"
	| "sampling"
	| "prompts"
	| "variables"
	| "template"
	| "scripts"
	| "castScripts"

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
 * ## ⚠ The population is currently EMPTY, and that is the point
 *
 * There were seven, across five handlers, and D-I declared all seven: `decisions`
 * and `messages` on `core:task/assemble@2`, the two relationship reads and the
 * two side-character speaker fields on `core:task/build-template-context@1`, and
 * `loreType` on the three summarize Providers. Each one is now a real in-port,
 * so each read is typed by `PortsIn` and no longer needs naming here.
 *
 * The alias is kept rather than deleted. It is the word the next such finding is
 * written under, and an empty population is a *result* — it says every key a
 * handler is really given is now something the contract declares — where a
 * missing alias would only say nobody had looked. `grep -c 'Supplied<'` reading
 * zero is the fact; the day it reads one, that one is a finding.
 */
export type Supplied<K extends string> = K

/**
 * A key **nothing supplies today** — a fallback branch that cannot fire.
 *
 * Kept rather than deleted, and the reason is the one that governs every dead
 * control in this subsystem: node config is stored JSON off a `pipeline_configs`
 * row, so a spec version or a hand-edited config from an earlier release can
 * still carry the key. Removing the read would change what that install
 * retrieves, silently, in a lane whose whole contract is that behaviour does not
 * move. Reported instead, with the site named.
 */
export type Unsupplied<K extends string> = K

/**
 * A binding's `input`: the node's declared in-ports and slots, plus whatever
 * undeclared keys the handler has been shown to legitimately receive.
 *
 * Every value is `any` on purpose — see `PortsIn`. This type constrains the set
 * of **names**, which is where both known defects lived.
 */
export type NodeInput<P, Extra extends string = never> = Partial<
	Record<PortsIn<P> | CoreSlot | Extra, any>
>

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
	| "graph_context"
	| "embedding_status"
	| "vector_search"
	| "entity_annotations"
	| "mention_spans"
	| "entity_link"

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

export type { ConsumerCtx, ProviderCtx, TaskCtx }
