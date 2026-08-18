/**
 * The typed chain scope — `$.history.messages` instead of `$ref('history', 'messages')`.
 *
 * Why this is worth machinery. `$ref` takes two strings, and strings are where the
 * remaining classes of authoring mistake live in this SDK: a mistyped node key, a
 * mistyped port, a reference to a node that does not exist *yet*. All three were
 * publish-time findings. With a scope object accumulated as the chain is built, all
 * three become **compile errors**, which is the same move the kind-named methods made
 * for the five laws they enforce (04 §4a).
 *
 * The one that matters most is the third. `$` contains only the nodes declared *above*
 * the call, so a reference to a later node does not type-check — **"no back-edges" (F9)
 * stops being a rule the validator checks and becomes a thing you cannot write.**
 *
 * Nothing about the compiled document changes. A scope access produces exactly the
 * `DataRef` that `$ref` produces, so the rows, the edges and the canonical hash are
 * byte-identical (F3, F6). This is authoring sugar over an unchanged value.
 */
import { type DataRef } from './refs.js';
import type { PortDecl } from './descriptors.js';
/**
 * A node accessor. It **is** a ref to `main`, and property access refines the port —
 * so `$.generate` and `$.generate.text` are both legal and mean what they look like.
 */
export type NodeAccessor<Out extends PortDecl> = DataRef & {
    readonly [K in keyof Out]: DataRef;
};
/**
 * Node keys accumulate **flat and dotted** — `'gather.semantic.embed'` — because that is
 * exactly what the row's `node_key` is (F21). The scope then expands them back into a
 * nested shape, so `$.gather.semantic.embed.vector` reads like the key it compiles to.
 *
 * Blocks are not nodes, so a block name alone is not a ref: `$.gather` is a path, and
 * only the leaf carries the accessor. That falls out of the split below rather than
 * needing a rule.
 */
type Head<K extends string> = K extends `${infer H}.${string}` ? H : K;
type ChildrenOf<N, H extends string> = {
    [K in keyof N & string as K extends `${H}.${infer R}` ? R : never]: N[K];
};
type Nested<N> = {
    readonly [H in Head<keyof N & string>]: (H extends keyof N ? NodeAccessor<N[H] extends PortDecl ? N[H] : PortDecl> : unknown) & Nested<ChildrenOf<N, H>>;
};
/**
 * What the callback receives. `Nodes` is accumulated by the builder, one entry per
 * declared node, so autocomplete lists exactly the nodes that exist at this point in
 * the chain — and nothing later.
 */
export type Scope<Nodes extends Record<string, PortDecl>> = Nested<Nodes>;
/**
 * Build the scope for a call site.
 *
 * @param knownKeys every node key declared so far, fully qualified
 * @param localPrefix inside a block chain, the qualifier its members share — so a
 *   sibling can be named by its short key (`$.embed`) while an outside node is still
 *   reachable by its full path (`$.gather.semantic.embed`).
 */
export declare function makeScope(knownKeys: Set<string>, localPrefix?: string, blockId?: string): any;
/** The current item inside a map, addressed without knowing the block's key. */
export declare const ITEM = "$item";
export {};
//# sourceMappingURL=scope.d.ts.map