/**
 * The builder (04 §4). Kind-named methods, so reading a spec top to bottom shows
 * the effect taxonomy — and so the type system can enforce laws that a generic
 * .step() could only find at validation time (04 §4a).
 *
 * The chain is a *value*. It compiles to a document; SP imports the document and
 * never this code (F6).
 *
 * Every node method takes either a pinned constructor or a **callback that receives the
 * scope** — `$ => C.assemble({ candidates: $.history.messages })`. The callback form is
 * preferred: it types the node key and the port, and it makes a forward reference
 * impossible to write rather than a finding to read (src/scope.ts). Both forms compile
 * to the same rows.
 */

import { type NodeSpec, type Kind, type PortDecl, type OutPortsOf, type Descriptor } from './descriptors.js'
import { makeScope, ITEM, type Scope } from './scope.js'
import type { DataRef } from './refs.js'
import type { TemplateValue } from './engines.js'
import { assertSpecId, parseSpecId } from './identity.js'

export interface SpecMeta {
	/**
	 * Semver. **The upgrade key, not part of the identity** — an import replaces the
	 * installed copy when newer and is ignored when it is not (src/identity.ts).
	 */
	version: string
	/**
	 * Who ships this spec: a plugin slug, `core`, or absent for a hand-imported document.
	 * Defaults to the owner segment of the id, so it only needs stating when they differ.
	 *
	 * Ownership is what stops an update from silently taking over a spec an admin
	 * imported by hand, or one another plugin ships — "newer" is not a licence to
	 * overwrite somebody else's row.
	 */
	owner?: string
	mode?: { name: unknown; family: string }
	i18n?: { name?: unknown }
}

export interface BuiltNode {
	key: string
	kind: Kind
	typeId: string
	typeVersion: number
	config: Record<string, unknown>
	/** Set when the node sits inside an async block or a map. */
	blockId?: string
	blockKind?: 'async' | 'map' | 'loop'
	blockChain?: string
	position: number
}

export interface BuiltBlock {
	id: string
	kind: 'async' | 'map' | 'loop'
	mode: 'sequential' | 'parallel'
	/** map only — the list to iterate. */
	over?: unknown
	/**
	 * **Mandatory for map and loop.** An unbounded repeat is the most likely source of a
	 * surprise bill in the system, and for a loop it is also the only thing standing
	 * between a bad predicate and a run that never ends.
	 */
	max?: number
	/**
	 * loop only. A **port reference**, not an expression: the loop repeats while this
	 * value is truthy, re-evaluated at the end of each iteration (do-while — a tool
	 * loop always wants one generate before it can know whether to stop).
	 *
	 * A reference rather than an expression is what keeps the construct renderable
	 * ("repeats while generate.hasToolCalls, max 8") and keeps a second expression
	 * language out of the design.
	 */
	repeatWhile?: unknown
	chains: string[]
	/** Blocks nest: which block and chain this one sits inside. Undefined = the spine. */
	blockId?: string
	blockChain?: string
	/** Ordering against sibling nodes at the same level. */
	position: number
}

/**
 * A preset the **spec author** ships — "Balanced", "Lore-heavy", "Fast" (12 §3).
 *
 * The scope chain's layer 5 is a single author default per slot, which is enough for one
 * opinion and no help at all for "here are three coherent ways to run this." Named author
 * presets fill that, and they need no schema: they seed `config_presets` and
 * `node_overrides` rows at `scope_kind='preset'` on install, which both already exist.
 *
 * Two rulings ride on this — see 12 §3a.
 */
export interface BuiltPreset {
	/**
	 * **The identity.** Stable, PK-agnostic, and the reference an update or a defaults
	 * sync matches on — same convention as the events registry (13 §7g), now applied to
	 * every seeded row rather than to events alone.
	 *
	 * The consequence worth knowing: the slug is the identity and the label is the
	 * display, so renaming "Lore-heavy" to "World-focused" is free and keeps every
	 * user's selection intact. Changing the *slug* is a delete plus a create.
	 */
	slug: string
	label: string
	description?: string
	/** At most one author preset may be the shipped default. */
	default?: boolean
	/**
	 * Who owns this preset, for update and sync. Defaults to the spec's owner, and is
	 * stated explicitly only in the case that justifies the field existing: a **preset
	 * pack** — a plugin shipping presets for a pipeline someone else ships. Uninstalling
	 * the pack must remove its presets and leave the pipeline alone, which is only
	 * decidable if the preset says who it belongs to (12 §3b).
	 */
	owner?: string
	/** Flat override rows, exactly the shape `node_overrides` stores. */
	values: Array<{ nodeKey: string; slot: string; value: unknown }>
}

export interface BuiltSpec {
	id: string
	meta: SpecMeta
	subscribes: string[]
	nodes: BuiltNode[]
	blocks: BuiltBlock[]
	/** Fragments included, recorded for provenance after expansion (16 §3a). */
	includes: Array<{ key: string; fragmentId: string }>
	/** Author-shipped named configurations (12 §3a). Round-trips with the document (F4). */
	presets: BuiltPreset[]
}

/** What a node method accepts: the value, or a function of the scope that returns it. */
export type NodeArg<N, Nodes extends Record<string, PortDecl>> = N | (($: Scope<Nodes>) => N)

/**
 * A pinned constructor of a given kind. Constraining each method to its own kind makes
 * `.query('x', C.generateText())` a **compile** error rather than a throw — 04 §4a said
 * the method names the kind, and this is that claim actually enforced by the type system
 * instead of by a message at authoring time.
 */
export type NodeOf<K extends Kind> = NodeSpec<Descriptor<any, any> & { kind: K }>

/**
 * What a map iterates. Kept as a closed union rather than `unknown | fn`, because a
 * union with `unknown` collapses to `unknown` and the callback's parameter loses its
 * type — the exact thing this whole change exists to prevent.
 */
export type MapOver<Nodes extends Record<string, PortDecl>> =
	| (($: Scope<Nodes>) => DataRef)
	| DataRef
	| readonly unknown[]

/**
 * Node keys accumulate **fully qualified**, exactly as they land in the rows (F21) — so
 * a node declared inside a block enters the scope as `gather.semantic.embed`, and the
 * scope type expands the dots back into a path (src/scope.ts).
 */
type Qualify<Prefix extends string, K extends string> = Prefix extends '' ? K : `${Prefix}.${K}`
type Add<Nodes extends Record<string, PortDecl>, K extends string, N> = Nodes & { [P in K]: OutPortsOf<N> }
/** Like `Add`, but for a construct whose ports are known directly rather than via a descriptor. */
type AddPorts<Nodes extends Record<string, PortDecl>, K extends string, P extends PortDecl> = Nodes & {
	[X in K]: P
}

/** Pull the accumulated node map back out of a builder the author handed us. */
export type NodesOf<B> =
	B extends ChainBuilder<infer M, any> ? M : B extends BlockBuilder<infer M, any> ? M : never

/**
 * What a block publishes. Addressable like a node, because it is the only well-defined
 * handle on a construct that ran more than once — "whichever iteration happened to run
 * last" is not a value anyone means.
 */
export type BranchPorts = { main: string; values: string; branches: string; ok: string }

/** Namespace a fragment's nodes under the include key, at publish and in the type (16 §3a). */
type Prefixed<K extends string, M> = { [P in keyof M & string as `${K}.${P}`]: M[P] }

/** Lowercase kebab. A slug is a database reference, not display text. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

const parseId = (typeId: string) => {
	const m = /^(.*)@(\d+)$/.exec(typeId)
	return m ? { base: m[1], version: Number(m[2]) } : { base: typeId, version: 1 }
}

// ── Chain builders ──────────────────────────────────────────────────────────

class ChainBuilder<Nodes extends Record<string, PortDecl> = {}, Prefix extends string = ''> {
	constructor(
		protected spec: BuiltSpec,
		protected blockCtx?: { blockId: string; chain: string },
	) {}

	/** Resolve the callback form against the nodes declared so far. */
	protected resolve<N>(arg: NodeArg<N, Nodes>): N {
		if (typeof arg !== 'function') return arg
		const known = new Set(this.spec.nodes.map((n) => n.key))
		// Blocks publish under their own id, so they are addressable exactly like nodes —
		// and for a map or a loop that is the *only* well-defined thing to address.
		for (const b of this.spec.blocks) known.add(b.id)
		// Inside a map, the current item is addressable without naming the block.
		if (this.blockCtx) known.add(`${this.blockCtx.blockId}.${ITEM}`)
		const localPrefix = this.blockCtx ? `${this.blockCtx.blockId}.${this.blockCtx.chain}` : undefined
		const scope = makeScope(known, localPrefix, this.blockCtx?.blockId)
		return (arg as ($: Scope<Nodes>) => N)(scope)
	}

	protected add(kind: Kind, key: string, arg: NodeArg<NodeSpec<any>, Nodes>) {
		const node = this.resolve(arg)
		if (node?.descriptor?.kind !== kind) {
			throw new Error(
				`.${kind}('${key}', …) was given a ${node?.descriptor?.kind ?? 'non-node'} ` +
					`('${node?.descriptor?.id ?? '?'}'). The method names the kind; use .${node?.descriptor?.kind}() instead.`,
			)
		}
		if (this.spec.nodes.some((n) => n.key === this.qualify(key))) {
			throw new Error(`duplicate node key '${this.qualify(key)}' — keys are explicit and unique (F21)`)
		}
		const { base, version } = parseId(node.descriptor.id)
		this.spec.nodes.push({
			key: this.qualify(key),
			kind,
			typeId: base,
			typeVersion: version,
			config: node.config,
			blockId: this.blockCtx?.blockId,
			blockKind: this.blockCtx
				? (this.spec.blocks.find((b) => b.id === this.blockCtx!.blockId)?.kind ?? 'async')
				: undefined,
			blockChain: this.blockCtx?.chain,
			position: this.spec.nodes.length,
		})
		return this as any
	}

	protected qualify(key: string) {
		return this.blockCtx ? `${this.blockCtx.blockId}.${this.blockCtx.chain}.${key}` : key
	}

	/** Where a block declared here sits, so blocks nest exactly as nodes do. */
	protected declareBlock(b: Omit<BuiltBlock, 'blockId' | 'blockChain' | 'position'>): BuiltBlock {
		const block: BuiltBlock = {
			...b,
			blockId: this.blockCtx?.blockId,
			blockChain: this.blockCtx?.chain,
			position: this.spec.nodes.length,
		}
		this.spec.blocks.push(block)
		return block
	}

	/** Chains run concurrently and are awaited together (01 §4). */
	async<Id extends string, R extends BlockBuilder<any, any>>(
		id: Id,
		opts: { mode?: 'sequential' | 'parallel' },
		fn: (b: BlockBuilder<Nodes, Qualify<Prefix, Id>>) => R,
	): ChainBuilder<AddPorts<NodesOf<R>, Qualify<Prefix, Id>, BranchPorts>, Prefix> {
		const qualified = this.qualify(id)
		this.declareBlock({ id: qualified, kind: 'async', mode: opts.mode ?? 'parallel', chains: [] })
		fn(new BlockBuilder<Nodes, Qualify<Prefix, Id>>(this.spec, qualified))
		return this as any
	}

	/** One contained chain, once per item of a list (01 §4). */
	map<Id extends string, R extends ChainBuilder<any, any>>(
		id: Id,
		opts: { over: MapOver<Nodes>; max: number; mode?: 'sequential' | 'parallel' },
		fn: (c: ChainBuilder<Nodes & { [ITEM]: PortDecl }, `${Qualify<Prefix, Id>}.item`>) => R,
	): ChainBuilder<AddPorts<NodesOf<R>, Qualify<Prefix, Id>, BranchPorts>, Prefix> {
		const qualified = this.qualify(id)
		this.declareBlock({
			id: qualified,
			kind: 'map',
			mode: opts.mode ?? 'parallel',
			over: typeof opts.over === 'function' ? this.resolve(opts.over as any) : opts.over,
			max: opts.max,
			chains: ['item'],
		})
		fn(new ChainBuilder<any, any>(this.spec, { blockId: qualified, chain: 'item' }))
		return this as any
	}

	/**
	 * One contained chain, repeated while a declared port stays truthy — bounded by a
	 * mandatory `max` (01 §4a).
	 *
	 * This is the construct that makes tool-calling expressible on the spine. It is **not
	 * a back-edge**: like `map`, the repetition lives in the block's declaration rather
	 * than in an edge that points backwards, and the executor already knew how to run a
	 * chain more than once. A loop is a map whose iteration count comes from a predicate
	 * instead of a list length.
	 *
	 * Always sequential — each iteration depends on the last, so `mode` would be a lie.
	 */
	loop<Id extends string, R extends ChainBuilder<any, any>>(
		id: Id,
		opts: { repeatWhile: (($: Scope<any>) => DataRef) | DataRef; max: number },
		fn: (c: ChainBuilder<Nodes, `${Qualify<Prefix, Id>}.item`>) => R,
	): ChainBuilder<AddPorts<NodesOf<R>, Qualify<Prefix, Id>, BranchPorts>, Prefix> {
		const qualified = this.qualify(id)
		const block = this.declareBlock({
			id: qualified,
			kind: 'loop',
			mode: 'sequential',
			max: opts.max,
			chains: ['item'],
		})
		fn(new ChainBuilder<any, any>(this.spec, { blockId: qualified, chain: 'item' }))
		// Resolved *after* the body, so the predicate may name a node inside it — which
		// is the only place a predicate that ever changes can come from.
		block.repeatWhile =
			typeof opts.repeatWhile === 'function'
				? new ChainBuilder<any, any>(this.spec, { blockId: qualified, chain: 'item' }).resolvePublic(opts.repeatWhile as any)
				: opts.repeatWhile
		return this as any
	}

	/** Internal: the callback resolver, reachable from `loop` after the body is built. */
	resolvePublic<N>(arg: NodeArg<N, any>): N {
		return this.resolve(arg as any)
	}

	query<K extends string, N extends NodeOf<'query'>>(
		key: K,
		node: NodeArg<N, Nodes>,
	): ChainBuilder<Add<Nodes, Qualify<Prefix, K>, N>, Prefix> {
		return this.add('query', key, node)
	}
	task<K extends string, N extends NodeOf<'task'>>(
		key: K,
		node: NodeArg<N, Nodes>,
	): ChainBuilder<Add<Nodes, Qualify<Prefix, K>, N>, Prefix> {
		return this.add('task', key, node)
	}
	provider<K extends string, N extends NodeOf<'provider'>>(
		key: K,
		node: NodeArg<N, Nodes>,
	): ChainBuilder<Add<Nodes, Qualify<Prefix, K>, N>, Prefix> {
		return this.add('provider', key, node)
	}
	consume<K extends string, N extends NodeOf<'consumer'>>(
		key: K,
		node: NodeArg<N, Nodes>,
	): ChainBuilder<Add<Nodes, Qualify<Prefix, K>, N>, Prefix> {
		return this.add('consumer', key, node)
	}
}

class BlockBuilder<Nodes extends Record<string, PortDecl> = {}, Id extends string = string> {
	constructor(
		private spec: BuiltSpec,
		private blockId: string,
	) {}

	/**
	 * Each chain's nodes accumulate into the block's type, so by the time `.async()`
	 * returns, the spine's scope contains every node the block declared — under the
	 * qualified key it actually has.
	 */
	chain<Name extends string, R extends ChainBuilder<any, any>>(
		name: Name,
		fn: (c: ChainBuilder<Nodes, Qualify<Id, Name>>) => R,
	): BlockBuilder<NodesOf<R>, Id> {
		const block = this.spec.blocks.find((b) => b.id === this.blockId)!
		block.chains.push(name)
		fn(new ChainBuilder<Nodes, Qualify<Id, Name>>(this.spec, { blockId: this.blockId, chain: name }))
		return this as any
	}
}

/**
 * Slot-named methods, for the same reason the chain has kind-named ones (04 §4a): the
 * method names the slot, so setting a slot a node never declared is caught by name rather
 * than becoming an override row that silently matches nothing.
 */
export class PresetBuilder<Nodes extends Record<string, PortDecl> = {}> {
	constructor(private preset: BuiltPreset) {}

	private set(nodeKey: string, slot: string, value: unknown) {
		this.preset.values.push({ nodeKey, slot, value })
		return this
	}

	/** Node behaviour knobs — retrieval `weight`, `minInclude`, `topK` (12 §2). */
	params(nodeKey: keyof Nodes & string, value: Record<string, unknown>) {
		return this.set(nodeKey, 'params', value)
	}
	/** Authored text fields the node declares. */
	prompts(nodeKey: keyof Nodes & string, value: Record<string, unknown>) {
		return this.set(nodeKey, 'prompts', value)
	}
	/** A template **and its engine** — the engine travels on the value (src/engines.ts). */
	template(nodeKey: keyof Nodes & string, value: TemplateValue) {
		return this.set(nodeKey, 'template', value)
	}
	/** Generation parameters: a reference to a named config, or field overrides on top. */
	sampling(nodeKey: keyof Nodes & string, value: Record<string, unknown>) {
		return this.set(nodeKey, 'sampling', value)
	}
	/** Node toggles and the review position. */
	settings(nodeKey: keyof Nodes & string, value: Record<string, unknown>) {
		return this.set(nodeKey, 'settings', value)
	}

	/**
	 * Deliberately absent: `connection`.
	 *
	 * An admin preset may set one (12 §4); an author preset may not. The author does not
	 * know what hardware or credentials the user has, and 12 §4's admin cascade works
	 * *because* connection has no writable scope below instance — an author preset
	 * pinning compute would put a layer underneath the admin and break the one guarantee
	 * the write matrix exists to make.
	 */
}

export class SpecBuilder<Nodes extends Record<string, PortDecl> = {}> extends ChainBuilder<Nodes> {
	private inputDone = false

	constructor(id: string, meta: SpecMeta) {
		assertSpecId(id)
		const parsed = parseSpecId(id)
		super({
			id,
			meta: { ...meta, owner: meta.owner ?? parsed.owner },
			subscribes: [],
			nodes: [],
			blocks: [],
			includes: [],
			presets: [],
		})
	}

	// The four node methods are re-declared here purely so the spine keeps offering
	// .async(), .map(), .include() and .build(). Same implementation, narrower return.
	override query<K extends string, N extends NodeOf<'query'>>(
		key: K,
		node: NodeArg<N, Nodes>,
	): SpecBuilder<Add<Nodes, K, N>> {
		return this.add('query', key, node)
	}
	override task<K extends string, N extends NodeOf<'task'>>(
		key: K,
		node: NodeArg<N, Nodes>,
	): SpecBuilder<Add<Nodes, K, N>> {
		return this.add('task', key, node)
	}
	override provider<K extends string, N extends NodeOf<'provider'>>(
		key: K,
		node: NodeArg<N, Nodes>,
	): SpecBuilder<Add<Nodes, K, N>> {
		return this.add('provider', key, node)
	}
	override consume<K extends string, N extends NodeOf<'consumer'>>(
		key: K,
		node: NodeArg<N, Nodes>,
	): SpecBuilder<Add<Nodes, K, N>> {
		return this.add('consumer', key, node)
	}

	/**
	 * A named configuration the spec ships with (12 §3a). Declared **after** the nodes,
	 * so the node keys it addresses are the ones that exist — same accumulation the
	 * scope uses, so a typo is a compile error rather than a dead override row.
	 *
	 * ```ts
	 * .preset('lore-heavy', { label: 'Lore-heavy' }, p => p
	 *   .params  ('lore',     { weight: 0.5, minInclude: 3 })
	 *   .prompts ('generate', { system: LORE_SYSTEM })
	 *   .template('prompt',   jinja(LORE_ASSEMBLY)))
	 * ```
	 */
	preset(
		slug: string,
		meta: { label: string; description?: string; default?: boolean; owner?: string },
		fn: (p: PresetBuilder<Nodes>) => unknown,
	): this {
		if (!SLUG.test(slug)) {
			throw new Error(
				`'${slug}' is not a valid preset slug. Use lowercase letters, digits and hyphens ` +
					`(e.g. 'lore-heavy'). The slug is a stable database reference an update matches on, ` +
					`not display text — put the pretty name in \`label\` (12 §3a).`,
			)
		}
		if (this.spec.presets.some((p) => p.slug === slug)) {
			throw new Error(`duplicate preset slug '${slug}' — slugs are unique per spec, because they are the sync key (12 §3a)`)
		}
		if (meta.default && this.spec.presets.some((p) => p.default)) {
			throw new Error(
				`'${slug}' is a second default preset. A spec ships at most one default; ` +
					`an admin chooses among the rest (12 §3a)`,
			)
		}
		const built: BuiltPreset = { slug, ...meta, owner: meta.owner ?? this.spec.meta.owner, values: [] }
		fn(new PresetBuilder<Nodes>(built))
		this.spec.presets.push(built)
		return this
	}

	/** Seeds a default subscription. Admins manage the real ones (04 §4b). */
	on(eventId: string): this {
		this.spec.subscribes.push(eventId)
		return this
	}

	/**
	 * Exactly one Input, positionally first (01 §2). Enforced here rather than by
	 * the validator, so it is a throw at authoring time.
	 */
	input<K extends string, N extends NodeOf<'input'>>(key: K, node: N): SpecBuilder<Add<Nodes, K, N>> {
		if (this.inputDone) throw new Error('a spec has exactly one Input (01 §2) — .input() may be called once')
		if (this.spec.nodes.length > 0) throw new Error('the Input must be the first node (01 §2)')
		this.inputDone = true
		return this.add('input', key, node)
	}

	// Blocks are inherited from ChainBuilder so they nest; re-declared here only so the
	// spine keeps offering .include() and .build() afterwards.
	override async<Id extends string, R extends BlockBuilder<any, any>>(
		id: Id,
		opts: { mode?: 'sequential' | 'parallel' },
		fn: (b: BlockBuilder<Nodes, Id>) => R,
	): SpecBuilder<AddPorts<NodesOf<R>, Id, BranchPorts>> {
		return super.async(id as any, opts, fn as any) as any
	}
	override map<Id extends string, R extends ChainBuilder<any, any>>(
		id: Id,
		opts: { over: MapOver<Nodes>; max: number; mode?: 'sequential' | 'parallel' },
		fn: (c: ChainBuilder<Nodes & { [ITEM]: PortDecl }, `${Id}.item`>) => R,
	): SpecBuilder<AddPorts<NodesOf<R>, Id, BranchPorts>> {
		return super.map(id as any, opts, fn as any) as any
	}
	override loop<Id extends string, R extends ChainBuilder<any, any>>(
		id: Id,
		opts: { repeatWhile: (($: Scope<any>) => DataRef) | DataRef; max: number },
		fn: (c: ChainBuilder<Nodes, `${Id}.item`>) => R,
	): SpecBuilder<AddPorts<NodesOf<R>, Id, BranchPorts>> {
		return super.loop(id as any, opts, fn as any) as any
	}

	/** Compile-time include — expanded here, so rows hold the flat chain (16 §3a). */
	include<K extends string, F extends Fragment<any>>(
		key: K,
		fragment: F,
	): SpecBuilder<Nodes & Prefixed<K, F extends Fragment<infer M> ? M : {}>> {
		this.spec.includes.push({ key, fragmentId: fragment.id })
		for (const n of fragment.nodes) {
			this.spec.nodes.push({
				...n,
				key: `${key}.${n.key}`,
				blockId: n.blockId ? `${key}.${n.blockId}` : undefined,
				position: this.spec.nodes.length,
			})
		}
		for (const b of fragment.blocks) {
			this.spec.blocks.push({
				...b,
				id: `${key}.${b.id}`,
				blockId: b.blockId ? `${key}.${b.blockId}` : undefined,
				position: this.spec.nodes.length,
			})
		}
		return this as any
	}

	build(): BuiltSpec {
		return this.spec
	}
}

export function spec(id: string, meta: SpecMeta): SpecBuilder<{}> {
	return new SpecBuilder(id, meta)
}

// ── Fragments ───────────────────────────────────────────────────────────────

/**
 * A fragment carries its node map in its type, so `.include('ctx', contextInfill)` puts
 * `ctx.embed`, `ctx.search`, `ctx.merge` into the including spec's scope — namespaced by
 * the include key in the type exactly as they are namespaced in the rows (16 §3a).
 */
export interface Fragment<Nodes extends Record<string, PortDecl> = {}> {
	id: string
	nodes: BuiltNode[]
	blocks: BuiltBlock[]
	/** Phantom — carries the node map. Never populated at runtime. */
	readonly __nodes?: Nodes
}

export function fragment<R extends ChainBuilder<any, any>>(
	id: string,
	fn: (c: ChainBuilder<{}, ''>) => R,
): Fragment<NodesOf<R>> {
	const inner: BuiltSpec = {
		id,
		meta: { version: '0.0.0' },
		subscribes: [],
		nodes: [],
		blocks: [],
		includes: [],
		presets: [],
	}
	fn(new ChainBuilder<{}, ''>(inner))
	return { id, nodes: inner.nodes, blocks: inner.blocks }
}

export { ChainBuilder }
