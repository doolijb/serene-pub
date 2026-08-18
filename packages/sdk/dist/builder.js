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
import { makeScope, ITEM } from './scope.js';
import { assertSpecId, parseSpecId } from './identity.js';
/** Lowercase kebab. A slug is a database reference, not display text. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const parseId = (typeId) => {
    const m = /^(.*)@(\d+)$/.exec(typeId);
    return m ? { base: m[1], version: Number(m[2]) } : { base: typeId, version: 1 };
};
// ── Chain builders ──────────────────────────────────────────────────────────
class ChainBuilder {
    spec;
    blockCtx;
    constructor(spec, blockCtx) {
        this.spec = spec;
        this.blockCtx = blockCtx;
    }
    /** Resolve the callback form against the nodes declared so far. */
    resolve(arg) {
        if (typeof arg !== 'function')
            return arg;
        const known = new Set(this.spec.nodes.map((n) => n.key));
        // Blocks publish under their own id, so they are addressable exactly like nodes —
        // and for a map or a loop that is the *only* well-defined thing to address.
        for (const b of this.spec.blocks)
            known.add(b.id);
        // Inside a map, the current item is addressable without naming the block.
        if (this.blockCtx)
            known.add(`${this.blockCtx.blockId}.${ITEM}`);
        const localPrefix = this.blockCtx ? `${this.blockCtx.blockId}.${this.blockCtx.chain}` : undefined;
        const scope = makeScope(known, localPrefix, this.blockCtx?.blockId);
        return arg(scope);
    }
    add(kind, key, arg) {
        const node = this.resolve(arg);
        if (node?.descriptor?.kind !== kind) {
            throw new Error(`.${kind}('${key}', …) was given a ${node?.descriptor?.kind ?? 'non-node'} ` +
                `('${node?.descriptor?.id ?? '?'}'). The method names the kind; use .${node?.descriptor?.kind}() instead.`);
        }
        if (this.spec.nodes.some((n) => n.key === this.qualify(key))) {
            throw new Error(`duplicate node key '${this.qualify(key)}' — keys are explicit and unique (F21)`);
        }
        const { base, version } = parseId(node.descriptor.id);
        this.spec.nodes.push({
            key: this.qualify(key),
            kind,
            typeId: base,
            typeVersion: version,
            config: node.config,
            blockId: this.blockCtx?.blockId,
            blockKind: this.blockCtx
                ? (this.spec.blocks.find((b) => b.id === this.blockCtx.blockId)?.kind ?? 'async')
                : undefined,
            blockChain: this.blockCtx?.chain,
            position: this.spec.nodes.length,
        });
        return this;
    }
    qualify(key) {
        return this.blockCtx ? `${this.blockCtx.blockId}.${this.blockCtx.chain}.${key}` : key;
    }
    /** Where a block declared here sits, so blocks nest exactly as nodes do. */
    declareBlock(b) {
        const block = {
            ...b,
            blockId: this.blockCtx?.blockId,
            blockChain: this.blockCtx?.chain,
            position: this.spec.nodes.length,
        };
        this.spec.blocks.push(block);
        return block;
    }
    /** Chains run concurrently and are awaited together (01 §4). */
    async(id, opts, fn) {
        const qualified = this.qualify(id);
        this.declareBlock({ id: qualified, kind: 'async', mode: opts.mode ?? 'parallel', chains: [] });
        fn(new BlockBuilder(this.spec, qualified));
        return this;
    }
    /** One contained chain, once per item of a list (01 §4). */
    map(id, opts, fn) {
        const qualified = this.qualify(id);
        this.declareBlock({
            id: qualified,
            kind: 'map',
            mode: opts.mode ?? 'parallel',
            over: typeof opts.over === 'function' ? this.resolve(opts.over) : opts.over,
            max: opts.max,
            chains: ['item'],
        });
        fn(new ChainBuilder(this.spec, { blockId: qualified, chain: 'item' }));
        return this;
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
    loop(id, opts, fn) {
        const qualified = this.qualify(id);
        const block = this.declareBlock({
            id: qualified,
            kind: 'loop',
            mode: 'sequential',
            max: opts.max,
            chains: ['item'],
        });
        fn(new ChainBuilder(this.spec, { blockId: qualified, chain: 'item' }));
        // Resolved *after* the body, so the predicate may name a node inside it — which
        // is the only place a predicate that ever changes can come from.
        block.repeatWhile =
            typeof opts.repeatWhile === 'function'
                ? new ChainBuilder(this.spec, { blockId: qualified, chain: 'item' }).resolvePublic(opts.repeatWhile)
                : opts.repeatWhile;
        return this;
    }
    /** Internal: the callback resolver, reachable from `loop` after the body is built. */
    resolvePublic(arg) {
        return this.resolve(arg);
    }
    query(key, node) {
        return this.add('query', key, node);
    }
    task(key, node) {
        return this.add('task', key, node);
    }
    provider(key, node) {
        return this.add('provider', key, node);
    }
    consume(key, node) {
        return this.add('consumer', key, node);
    }
}
class BlockBuilder {
    spec;
    blockId;
    constructor(spec, blockId) {
        this.spec = spec;
        this.blockId = blockId;
    }
    /**
     * Each chain's nodes accumulate into the block's type, so by the time `.async()`
     * returns, the spine's scope contains every node the block declared — under the
     * qualified key it actually has.
     */
    chain(name, fn) {
        const block = this.spec.blocks.find((b) => b.id === this.blockId);
        block.chains.push(name);
        fn(new ChainBuilder(this.spec, { blockId: this.blockId, chain: name }));
        return this;
    }
}
/**
 * Slot-named methods, for the same reason the chain has kind-named ones (04 §4a): the
 * method names the slot, so setting a slot a node never declared is caught by name rather
 * than becoming an override row that silently matches nothing.
 */
export class PresetBuilder {
    preset;
    constructor(preset) {
        this.preset = preset;
    }
    set(nodeKey, slot, value) {
        this.preset.values.push({ nodeKey, slot, value });
        return this;
    }
    /** Node behaviour knobs — retrieval `weight`, `minInclude`, `topK` (12 §2). */
    params(nodeKey, value) {
        return this.set(nodeKey, 'params', value);
    }
    /** Authored text fields the node declares. */
    prompts(nodeKey, value) {
        return this.set(nodeKey, 'prompts', value);
    }
    /** A template **and its engine** — the engine travels on the value (src/engines.ts). */
    template(nodeKey, value) {
        return this.set(nodeKey, 'template', value);
    }
    /** Generation parameters: a reference to a named config, or field overrides on top. */
    sampling(nodeKey, value) {
        return this.set(nodeKey, 'sampling', value);
    }
    /** Node toggles and the review position. */
    settings(nodeKey, value) {
        return this.set(nodeKey, 'settings', value);
    }
}
export class SpecBuilder extends ChainBuilder {
    inputDone = false;
    constructor(id, meta) {
        assertSpecId(id);
        const parsed = parseSpecId(id);
        super({
            id,
            meta: { ...meta, owner: meta.owner ?? parsed.owner },
            subscribes: [],
            nodes: [],
            blocks: [],
            includes: [],
            presets: [],
        });
    }
    // The four node methods are re-declared here purely so the spine keeps offering
    // .async(), .map(), .include() and .build(). Same implementation, narrower return.
    query(key, node) {
        return this.add('query', key, node);
    }
    task(key, node) {
        return this.add('task', key, node);
    }
    provider(key, node) {
        return this.add('provider', key, node);
    }
    consume(key, node) {
        return this.add('consumer', key, node);
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
    preset(slug, meta, fn) {
        if (!SLUG.test(slug)) {
            throw new Error(`'${slug}' is not a valid preset slug. Use lowercase letters, digits and hyphens ` +
                `(e.g. 'lore-heavy'). The slug is a stable database reference an update matches on, ` +
                `not display text — put the pretty name in \`label\` (12 §3a).`);
        }
        if (this.spec.presets.some((p) => p.slug === slug)) {
            throw new Error(`duplicate preset slug '${slug}' — slugs are unique per spec, because they are the sync key (12 §3a)`);
        }
        if (meta.default && this.spec.presets.some((p) => p.default)) {
            throw new Error(`'${slug}' is a second default preset. A spec ships at most one default; ` +
                `an admin chooses among the rest (12 §3a)`);
        }
        const built = { slug, ...meta, owner: meta.owner ?? this.spec.meta.owner, values: [] };
        fn(new PresetBuilder(built));
        this.spec.presets.push(built);
        return this;
    }
    /** Seeds a default subscription. Admins manage the real ones (04 §4b). */
    on(eventId) {
        this.spec.subscribes.push(eventId);
        return this;
    }
    /**
     * Exactly one Input, positionally first (01 §2). Enforced here rather than by
     * the validator, so it is a throw at authoring time.
     */
    input(key, node) {
        if (this.inputDone)
            throw new Error('a spec has exactly one Input (01 §2) — .input() may be called once');
        if (this.spec.nodes.length > 0)
            throw new Error('the Input must be the first node (01 §2)');
        this.inputDone = true;
        return this.add('input', key, node);
    }
    // Blocks are inherited from ChainBuilder so they nest; re-declared here only so the
    // spine keeps offering .include() and .build() afterwards.
    async(id, opts, fn) {
        return super.async(id, opts, fn);
    }
    map(id, opts, fn) {
        return super.map(id, opts, fn);
    }
    loop(id, opts, fn) {
        return super.loop(id, opts, fn);
    }
    /** Compile-time include — expanded here, so rows hold the flat chain (16 §3a). */
    include(key, fragment) {
        this.spec.includes.push({ key, fragmentId: fragment.id });
        for (const n of fragment.nodes) {
            this.spec.nodes.push({
                ...n,
                key: `${key}.${n.key}`,
                blockId: n.blockId ? `${key}.${n.blockId}` : undefined,
                position: this.spec.nodes.length,
            });
        }
        for (const b of fragment.blocks) {
            this.spec.blocks.push({
                ...b,
                id: `${key}.${b.id}`,
                blockId: b.blockId ? `${key}.${b.blockId}` : undefined,
                position: this.spec.nodes.length,
            });
        }
        return this;
    }
    build() {
        return this.spec;
    }
}
export function spec(id, meta) {
    return new SpecBuilder(id, meta);
}
export function fragment(id, fn) {
    const inner = {
        id,
        meta: { version: '0.0.0' },
        subscribes: [],
        nodes: [],
        blocks: [],
        includes: [],
        presets: [],
    };
    fn(new ChainBuilder(inner));
    return { id, nodes: inner.nodes, blocks: inner.blocks };
}
export { ChainBuilder };
//# sourceMappingURL=builder.js.map