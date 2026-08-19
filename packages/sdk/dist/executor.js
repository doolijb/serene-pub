/**
 * A minimal executor — enough to run a compiled document and produce a receipt.
 *
 * Not the real thing, but it enforces the laws the design says the executor owns:
 * discriminated results including halt, per-run seed, timeouts that bound execution
 * but never waiting, consumption budgets, per-kind injection, and core-emitted events.
 */
import { getType } from "./descriptors.js";
import { collectDataRefs, isSlotRef } from "./refs.js";
import { resolveConfig } from "./config.js";
import { hashPayload, isGated, resolvePosition } from "./review.js";
import { isSecret } from "./settings.js";
import { previewTarget, roughTokens } from "./preview.js";
import { ITEM as ITEM_KEY } from "./scope.js";
import { isAllocatedContext, measureWire } from "./wire.js";
export const ok = (value) => ({ kind: "ok", value });
export const err = (reason) => ({ kind: "err", reason });
export const halt = (reason) => ({
    kind: "halt",
    reason
});
export const cancelled = (reason) => ({
    kind: "cancelled",
    reason
});
/**
 * Values are scoped, not global.
 *
 * A single shared map cannot hold two iterations of a map at once, which is why the
 * earlier draft forced every map sequential. A scope chain fixes that and is also what
 * makes nested blocks correct: an iteration writes into its own scope and reads through
 * to its parent, so two iterations never see each other's intermediate values.
 */
class ValueScope {
    parent;
    own = new Map();
    constructor(parent) {
        this.parent = parent;
    }
    get(k) {
        return this.own.has(k) ? this.own.get(k) : this.parent?.get(k);
    }
    has(k) {
        return this.own.has(k) || !!this.parent?.has(k);
    }
    set(k, v) {
        this.own.set(k, v);
    }
    child() {
        return new ValueScope(this);
    }
}
export const isCommitted = (w) => w.status === "committed";
// ── Deterministic RNG from the run seed (F11) ───────────────────────────────
export function seededRandom(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++)
        h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
    return () => {
        h = Math.imul(h ^ (h >>> 15), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
}
const EMPTY_WORLD = {
    overrides: [],
    samplingConfigs: [],
    connections: [],
    activeConnection: {}
};
class BudgetExceeded extends Error {
}
export async function run(doc, opts) {
    const world = opts.world ?? EMPTY_WORLD;
    const seed = opts.seed ?? "seed:0";
    const rng = seededRandom(seed);
    const now = opts.now ?? (() => Date.now());
    const config = resolveConfig(world, doc.nodes.map((n) => n.key));
    const receipt = {
        runId: opts.runId ?? "run:test",
        specId: doc.id,
        specVersion: doc.version,
        schemaVersion: 1,
        seed,
        triggerSource: opts.triggerSource ?? "input",
        triggerRef: opts.triggerRef,
        actorUserId: opts.actorUserId,
        depth: 0,
        queuedMs: opts.queuedMs,
        startedAt: now(),
        endedAt: 0,
        outcome: "ok",
        nodes: [],
        emitted: [],
        consumption: { tokens: 0, nodeExecutions: 0 }
    };
    /** Set the moment any node with declared effects is invoked — gates compaction. */
    let effectfulNodeRan = false;
    const previewAt = opts.preview
        ? previewTarget(doc.nodes, typeof opts.preview === "object"
            ? opts.preview.atNode
            : undefined)
        : undefined;
    const countTokens = opts.countTokens ?? roughTokens;
    /**
     * Hoist what the panel needs into one place. Almost all of it is already recorded —
     * Assemble's allocation record and the Provider's resolved input. The only figure
     * that exists nowhere else is the count of the formed payload.
     */
    const buildPreview = (node, input, typeId, targetedBy, wire, wireCtx) => {
        const ctxValue = input.context ?? input.main ?? input;
        const conn = input.connection;
        const budgetNode = doc.nodes.find((n) => n.typeId === "core:task/context-budget");
        const budgetValue = budgetNode ? values.get(budgetNode.key) : undefined;
        // Prefer the allocated blocks, which carry the trail. Fall back to sniffing an
        // allocation array only for specs core has not migrated yet.
        const allocatedSource = wireCtx ??
            Object.values(input).find(isAllocatedContext);
        const legacyAlloc = ctxValue?.alloc ?? ctxValue?.allocation;
        const allocation = allocatedSource?.allocation ?? legacyAlloc;
        const blocks = allocatedSource
            ? allocatedSource.blocks.map((b) => ({
                id: b.id,
                sourceKey: b.sourceKey,
                role: b.role,
                weight: b.weight,
                priority: b.priority,
                included: b.included,
                tokens: b.tokens,
                why: b.why,
                reason: b.why?.[b.why.length - 1]
            }))
            : (Array.isArray(legacyAlloc) ? legacyAlloc : []).map((a) => ({
                sourceKey: a.sourceKey,
                weight: a.weight,
                priority: a.priority,
                included: (a.included ?? 0) > 0,
                tokens: countTokens(a.rendered ?? a.text ?? ""),
                reason: a.reason ??
                    (a.available !== undefined &&
                        a.included !== undefined &&
                        a.available > a.included
                        ? `${a.available - a.included} of ${a.available} dropped — budget`
                        : undefined)
            }));
        const tokens = wire?.tokens ?? countTokens(ctxValue);
        const available = budgetValue?.available ??
            ctxValue?.budget ??
            allocatedSource?.allocation.budget;
        return {
            atNode: node.key,
            typeId,
            targetedBy,
            connection: conn
                ? {
                    id: conn.id,
                    kind: conn.kind,
                    contextLength: conn.metadata?.contextLength,
                    tokenizer: conn.metadata?.tokenizer
                }
                : undefined,
            budget: {
                maxContext: budgetValue?.maxContext ??
                    conn?.metadata?.contextLength,
                reserved: budgetValue?.reserved,
                available
            },
            context: {
                rendered: redact(wire ? wire.payload : ctxValue),
                tokens
            },
            wire: wire
                ? {
                    format: wire.format,
                    blockTokens: wire.blockTokens,
                    overheadTokens: wire.overheadTokens
                }
                : undefined,
            blocks,
            totals: {
                blocks: blocks.length,
                included: blocks.filter((b) => b.included).length,
                dropped: blocks.filter((b) => !b.included).length,
                tokensIncluded: blocks
                    .filter((b) => b.included)
                    .reduce((n, b) => n + b.tokens, 0),
                tokensDropped: blocks
                    .filter((b) => !b.included)
                    .reduce((n, b) => n + b.tokens, 0),
                overBudgetBy: wire?.overBudgetBy ??
                    (typeof available === "number" && tokens > available
                        ? tokens - available
                        : undefined)
            },
            allocation
        };
    };
    const values = new ValueScope();
    values.set(doc.nodes[0]?.key ?? "input", opts.input);
    const reviews = [];
    let seq = 0;
    const budget = {
        tokens: opts.budget?.tokens ?? Infinity,
        nodes: opts.budget?.nodeExecutions ?? Infinity
    };
    const spendTokens = (n) => {
        receipt.consumption.tokens += n;
        if (receipt.consumption.tokens > budget.tokens)
            throw new BudgetExceeded("token budget exceeded");
    };
    // Blocks are executed as units when their first member is reached.
    const emittedBlocks = new Set();
    const ordered = doc.nodes.slice().sort((a, b) => a.position - b.position);
    const resolveInput = (node, scope) => {
        const cfg = { ...node.config };
        for (const { path, ref } of collectDataRefs(node.config)) {
            setPath(cfg, path, readPort(scope.get(ref.node), ref.port));
        }
        for (const [k, v] of Object.entries(cfg)) {
            if (isSlotRef(v))
                cfg[k] = resolveSlot(node, v);
        }
        return cfg;
    };
    const resolveSlot = (node, ref) => {
        const targetKey = node.resolvedRefs?.[Object.keys(node.config).find((k) => node.config[k] === ref) ??
            ""] ??
            ref.ofNode ??
            node.key;
        const slotName = ref.slot;
        if (slotName === "connection") {
            const d = getType(`${node.typeId}@${node.typeVersion}`);
            const targetNode = doc.nodes.find((n) => n.key === targetKey) ?? node;
            const td = getType(`${targetNode.typeId}@${targetNode.typeVersion}`);
            const kind = td?.shape ?? d?.shape;
            const chosenId = config[targetKey]?.["connection"]?.["$ref"] ??
                (kind ? world.activeConnection[kind] : undefined);
            const conn = world.connections.find((c) => c.id === chosenId);
            // metadata only — material is injected by the executor at call time (01 §10)
            return conn
                ? { id: conn.id, kind: conn.kind, metadata: conn.metadata }
                : null;
        }
        if (slotName === "sampling") {
            const refId = config[targetKey]?.["sampling"]?.["$ref"];
            const base = world.samplingConfigs.find((s) => s.id === refId);
            const overrides = { ...(config[node.key]?.["sampling"] ?? {}) };
            delete overrides["$ref"];
            return { ...(base?.values ?? {}), ...overrides };
        }
        if (slotName === "params") {
            // A declared default is a promise the type makes; without this it was
            // decoration. Nothing applied `default:` from a parameters schema, so
            // a spec that did not override `budget` got `undefined` — which reads
            // downstream as a budget of zero, excludes every block, and renders a
            // context with its lore silently missing.
            const d = getType(`${node.typeId}@${node.typeVersion}`);
            const schema = d?.slots?.[slotName]?.schema;
            const defaults = {};
            for (const [k, v] of Object.entries(schema ?? {}))
                if (v?.default !== undefined)
                    defaults[k] = v.default;
            return { ...defaults, ...(config[node.key]?.[slotName] ?? {}) };
        }
        return config[node.key]?.[slotName] ?? {};
    };
    const invoke = async (node, scope, blockMode, iteration) => {
        const d = getType(`${node.typeId}@${node.typeVersion}`);
        if (!d)
            return err(`unknown type ${node.typeId}@${node.typeVersion}`);
        const hook = opts.bindings[`${node.typeId}@${node.typeVersion}`];
        const started = now();
        const nr = {
            nodeKey: node.key,
            seq: seq++,
            kind: node.kind,
            typeId: `${node.typeId}@${node.typeVersion}`,
            result: "ok",
            startedAt: started,
            endedAt: started,
            elapsedMs: 0,
            blockMode,
            iteration,
            resolvedRefs: node.resolvedRefs,
            notes: []
        };
        receipt.consumption.nodeExecutions++;
        if (receipt.consumption.nodeExecutions > budget.nodes)
            throw new BudgetExceeded("node execution budget exceeded");
        if (node.kind === "input") {
            scope.set(node.key, opts.input);
            nr.output = opts.input;
            nr.endedAt = now();
            receipt.nodes.push(nr);
            return ok(opts.input);
        }
        if (!hook)
            return err(`no binding registered for ${node.typeId}@${node.typeVersion}`);
        let input = resolveInput(node, scope);
        // ── The review gate (01 §7) ───────────────────────────────────────────
        // Substrate placement: after the input resolves, before the binding is invoked.
        // Keys on declared effects, not on kind, so an effectful Provider gates too.
        if (isGated(d.effects)) {
            const position = resolvePosition(d.reviewDefault, config[node.key]?.["settings"]?.["review"]);
            if (position !== "off") {
                const originalHash = hashPayload(input);
                if (!opts.reviewer) {
                    nr.endedAt = now();
                    nr.result = "err";
                    nr.reason = `review is '${position}' but no reviewer is available`;
                    receipt.nodes.push(nr);
                    return err(nr.reason);
                }
                const decision = await opts.reviewer({
                    nodeKey: node.key,
                    typeId: nr.typeId,
                    payload: input,
                    position
                });
                const rec = {
                    nodeKey: node.key,
                    position,
                    action: position === "async" ? "proposed" : decision.action,
                    originalHash,
                    by: decision.by,
                    at: decision.at
                };
                if (decision.action === "reject") {
                    reviews.push(rec);
                    nr.endedAt = now();
                    nr.result = "halt";
                    nr.reason = "rejected at review";
                    receipt.nodes.push(nr);
                    return halt("rejected at review");
                }
                if (decision.action === "edit") {
                    // The binding receives the edited payload and cannot tell (F14).
                    input = decision.payload;
                    rec.editedHash = hashPayload(input);
                }
                reviews.push(rec);
                // `async` proposes and does not block: the write lands pending.
                // Published as the discriminated form (13 §7j-b) — a proposal id must not
                // be mistakable for a committed row id, because a reviewer may still
                // reject it and the foreign key would dangle only later.
                if (position === "async") {
                    const pending = {
                        status: "pending",
                        proposalId: `proposal:${node.key}`
                    };
                    const published = publishWriteResult(pending, d.ports.out);
                    scope.set(node.key, published);
                    nr.endedAt = now();
                    nr.elapsedMs = nr.endedAt - nr.startedAt;
                    nr.result = "ok";
                    nr.output = pending;
                    nr.notes.push("review: async — proposed, binding not invoked");
                    receipt.nodes.push(nr);
                    return ok(published);
                }
            }
            else {
                reviews.push({
                    nodeKey: node.key,
                    position,
                    action: "approve",
                    originalHash: hashPayload(input)
                });
            }
        }
        // ── Wire formatting, at the pre-call substrate (16 §7) ────────────────
        // Allocation happened upstream in Assemble; this is where blocks become the
        // payload the connection actually wants. Once, here — never inside the
        // allocation loop, and never a second time for the preview.
        let wire;
        // Kept because formatting replaces the port value — the panel still needs the blocks.
        let wireCtx;
        if (d.slots) {
            const wireSlot = Object.entries(d.slots).find(([, sd]) => sd.kind === "wire");
            if (wireSlot) {
                const [slotName, decl] = wireSlot;
                const chosen = config[node.key]?.["wire"] ??
                    input[slotName] ??
                    decl.format;
                const port = Object.entries(input).find(([, v]) => isAllocatedContext(v));
                if (chosen && port) {
                    const portName = port[0];
                    const ctx = port[1];
                    wireCtx = ctx;
                    const available = input.budget?.available ??
                        ctx.allocation.budget;
                    try {
                        wire = measureWire(chosen, ctx, (t) => countTokens(t), available);
                        input = { ...input, [portName]: wire.payload };
                        nr.notes.push(`wire ${wire.format}: ${wire.blockTokens} block + ${wire.overheadTokens} scaffold = ${wire.tokens} tokens` +
                            (wire.overBudgetBy
                                ? `  ⚠ OVER by ${wire.overBudgetBy}`
                                : ""));
                    }
                    catch (e) {
                        nr.endedAt = now();
                        nr.result = "err";
                        nr.reason = e.message;
                        receipt.nodes.push(nr);
                        return err(nr.reason);
                    }
                    // An over-budget payload is `err`, not a silent trim and not a retry:
                    // a retry would re-invoke Assemble, which is a back-edge the graph
                    // cannot show (F9, F25). It means declared overhead is wrong, and
                    // that should be loud (16 §7).
                    if (wire.overBudgetBy) {
                        nr.endedAt = now();
                        nr.result = "err";
                        nr.reason =
                            `formatted payload is ${wire.tokens} tokens against ${available} available — ` +
                                `over by ${wire.overBudgetBy}. The estimate came from wire format '${wire.format}'`;
                        receipt.nodes.push(nr);
                        return err(nr.reason);
                    }
                }
            }
        }
        // ── The preview halt (debug mode) ─────────────────────────────────────
        // Same substrate point as the review gate, and deliberately *before* it: there
        // is nothing to review when nothing will be sent. The payload is formed and
        // counted here, so the panel shows the real figure rather than a parallel
        // estimate that drifts from what actually goes out.
        if (previewAt && node.key === previewAt.key) {
            receipt.preview = buildPreview(node, input, nr.typeId, previewAt.targetedBy, wire, wireCtx);
            nr.input = redact(input);
            nr.endedAt = now();
            nr.elapsedMs = nr.endedAt - nr.startedAt;
            nr.result = "halt";
            nr.reason = `preview: stopped before ${node.key}, nothing sent`;
            receipt.nodes.push(nr);
            return halt(nr.reason);
        }
        nr.input = redact(input);
        // Gates receipt compaction (13 §2): once anything effectful has been invoked,
        // the run is worth recording in full whatever happens next.
        if (d.effects && d.effects !== "none")
            effectfulNodeRan = true;
        const timeoutMs = Math.min(d.timeoutMs ?? Infinity, opts.timeoutCeilingMs ?? Infinity);
        nr.timeoutMsApplied = Number.isFinite(timeoutMs) ? timeoutMs : undefined;
        const controller = new AbortController();
        const base = {
            signal: controller.signal,
            progress: () => { }, // ephemeral, never recorded (F34)
            log: (lvl, m) => nr.notes.push(`${lvl}: ${m}`)
        };
        if (d.declaresRandomness)
            base.random = rng;
        const nodeRef = {
            key: node.key,
            typeId: node.typeId,
            typeVersion: node.typeVersion,
            kind: node.kind
        };
        const host = opts.host;
        let ctx = base;
        if (node.kind === "query")
            ctx = {
                ...base,
                read: (table, q) => host?.read ? host.read(table, q, nodeRef) : []
            };
        if (node.kind === "provider") {
            const conn = host?.connection?.(nodeRef);
            ctx = {
                ...base,
                connectionMetadata: conn?.metadata ?? input.connection?.metadata ?? {},
                sampling: conn?.sampling ?? input.sampling ?? {},
                call: async (p) => {
                    // Recorded before dispatch, so a Provider that throws still leaves the
                    // request in the receipt — the failing call is the one worth reading.
                    nr.request = p;
                    return host?.call ? await host.call(p, nodeRef) : p;
                },
                reportUsage: (t) => {
                    nr.tokens = (nr.tokens ?? 0) + t;
                    spendTokens(t);
                },
                reportSampling: (applied, ignored) => {
                    nr.samplingApplied = applied;
                    nr.samplingIgnored = ignored;
                }
            };
        }
        if (node.kind === "consumer") {
            ctx = {
                ...base,
                commit: async (p) => host?.commit
                    ? await host.commit(p, nodeRef)
                    : { id: `row:${node.key}`, ...p },
                emit: (handle, payload) => {
                    nr.notes.push(`emit → ${handle}`);
                    host?.emit?.(handle, payload, nodeRef);
                }
            };
        }
        let res;
        try {
            res = await withTimeout(Promise.resolve(hook(input, ctx)), timeoutMs, controller, now);
        }
        catch (e) {
            if (e instanceof BudgetExceeded)
                throw e;
            if (e.message === "__timeout__") {
                nr.timedOut = true;
                res = err(`timeout after ${timeoutMs}ms`);
            }
            else {
                res = err(e.message);
            }
        }
        nr.endedAt = now();
        nr.elapsedMs = nr.endedAt - nr.startedAt;
        nr.result = res.kind;
        if (res.kind === "ok") {
            // A gate-eligible Consumer publishes the discriminated write result, so the
            // committed and pending cases are the same shape and a downstream type has
            // to handle both (13 §7j-b). There is no branch node to check `status` with
            // (F25), so the obligation belongs to the port shape, not to the spec.
            let published = res.value;
            if (node.kind === "consumer" &&
                isGated(d.effects) &&
                !isWriteResult(published)) {
                const committed = {
                    status: "committed",
                    ids: (published ?? {})
                };
                published = publishWriteResult(committed, d.ports.out);
            }
            scope.set(node.key, published);
            res = ok(published);
            nr.output = redact(published);
        }
        else if (res.kind === "halt" ||
            res.kind === "err" ||
            res.kind === "cancelled") {
            nr.reason = res.reason;
        }
        // Core emits, not the node (01 §8 / F8).
        if (res.kind === "ok" &&
            node.kind === "consumer" &&
            d.effects === "write" &&
            d.causesEvent) {
            receipt.emitted.push({
                event: d.causesEvent,
                cause: node.key,
                subscribers: opts.subscribers?.[d.causesEvent] ?? 0
            });
        }
        receipt.nodes.push(nr);
        return res;
    };
    /** Admin kill (13 §3) — `cancelled`, not `err`, with the actor recorded. */
    const checkCancel = () => {
        const c = opts.cancelSignal?.();
        if (!c)
            return false;
        receipt.outcome = "cancelled";
        receipt.cancelledBy = c.by;
        receipt.haltReason = c.reason;
        return true;
    };
    const itemsAt = (level) => {
        const nodes = ordered
            .filter((n) => n.blockId === level.blockId && n.blockChain === level.chain)
            .map((node) => ({
            sort: node.position,
            run: node,
            isBlock: false
        }));
        const blocks = doc.blocks
            .filter((b) => b.blockId === level.blockId && b.blockChain === level.chain)
            .map((block) => ({
            sort: block.position,
            run: block,
            isBlock: true
        }));
        return [...nodes, ...blocks].sort((a, b) => a.sort - b.sort);
    };
    const runLevel = async (level, scope, blockMode, iteration) => {
        let last = ok(null);
        for (const item of itemsAt(level)) {
            if (checkCancel())
                return cancelled("cancelled");
            last = item.isBlock
                ? await runBlock(item.run, scope)
                : await invoke(item.run, scope, blockMode, iteration);
            if (last.kind !== "ok")
                return last;
        }
        return last;
    };
    const truthy = (v) => !!v && !(Array.isArray(v) && v.length === 0);
    const runBlock = async (block, scope) => {
        const mode = opts.forceSequential ? "sequential" : block.mode;
        const collected = [];
        const publish = () => {
            const union = {
                branches: collected,
                get main() {
                    return this.branches;
                },
                get values() {
                    return this.branches
                        .filter((b) => b.result.kind === "ok")
                        .map((b) => b.result
                        .value);
                },
                ok: collected.every((b) => b.result.kind === "ok")
            };
            scope.set(block.id, union);
        };
        if (block.kind === "async") {
            // Chains share the scope: a sibling is addressable by its qualified key, and
            // keys are unique, so there is nothing to collide.
            const run = (chain) => runLevel({ blockId: block.id, chain }, scope, mode);
            const results = mode === "parallel"
                ? await Promise.all(block.chains.map(run))
                : await sequential(block.chains, run);
            block.chains.forEach((chain, i) => collected.push({
                branchKey: chain,
                index: i,
                result: results[i]
            }));
            publish();
            return (collected.find((b) => b.result.kind !== "ok")?.result ??
                ok(null));
        }
        if (block.kind === "map") {
            const items = resolveMapItems(block.over, scope);
            if (block.max !== undefined && items.length > block.max) {
                return err(`map '${block.id}' received ${items.length} items but declares max ${block.max}`);
            }
            // Each iteration gets its own scope, so genuinely parallel maps are correct
            // rather than merely equivalent-if-you-squint.
            const run = async (item, i) => {
                const child = scope.child();
                child.set(`${block.id}.${ITEM_KEY}`, item);
                return runLevel({ blockId: block.id, chain: "item" }, child, mode, i);
            };
            const results = mode === "parallel"
                ? await Promise.all(items.map(run))
                : await sequential(items.map((item, i) => ({ item, i })), ({ item, i }) => run(item, i));
            items.forEach((_, i) => collected.push({
                branchKey: `${block.id}[${i}]`,
                index: i,
                result: results[i]
            }));
            publish();
            return (collected.find((b) => b.result.kind !== "ok")?.result ??
                ok(null));
        }
        // ── loop (01 §4a) ────────────────────────────────────────────────────
        // Do-while: run the body, then re-read the declared predicate. A tool loop
        // always wants one generate before it can know whether to stop.
        const max = block.max ?? 0;
        for (let i = 0; i < max; i++) {
            if (checkCancel())
                return cancelled("cancelled");
            const child = scope.child();
            const r = await runLevel({ blockId: block.id, chain: "item" }, child, "sequential", i);
            collected.push({
                branchKey: `${block.id}[${i}]`,
                index: i,
                result: r
            });
            if (r.kind !== "ok") {
                publish();
                return r;
            }
            const again = block.repeatWhile
                ? resolvePredicate(block.repeatWhile, child)
                : false;
            if (!truthy(again)) {
                publish();
                return ok(null);
            }
        }
        publish();
        // Reaching `max` is not an error — it is the bound doing its job, and the
        // receipt says so rather than leaving a truncated loop looking successful.
        receipt.notes = [
            ...(receipt.notes ?? []),
            `loop '${block.id}' reached its declared max of ${max}`
        ];
        return ok(null);
    };
    try {
        const outcome = await runLevel({ blockId: undefined, chain: undefined }, values);
        if (outcome.kind === "halt") {
            receipt.outcome = "halt";
            receipt.haltReason = outcome.reason;
            receipt.haltNodeKey ??= receipt.nodes.find((n) => n.result === "halt")?.nodeKey;
        }
        else if (outcome.kind !== "ok") {
            receipt.outcome = outcome.kind;
            if (outcome.kind === "err") {
                receipt.haltReason ??= outcome.reason;
                receipt.haltNodeKey ??= receipt.nodes.find((n) => n.result === "err")?.nodeKey;
            }
        }
    }
    catch (e) {
        if (e instanceof BudgetExceeded) {
            receipt.outcome = "err";
            receipt.haltReason = e.message;
        }
        else
            throw e;
    }
    receipt.endedAt = now();
    receipt.reviews = reviews;
    // Receipts sort by execution order for rendering.
    receipt.nodes.sort((a, b) => a.seq - b.seq);
    // ── Compact receipt (13 §2) ───────────────────────────────────────────────
    // The per-message multiplier is a hot event × every subscribed pipeline, where
    // most subscribers halt on the first node and that is success (01 §5). Those
    // runs keep their attribution and lose their payloads.
    // A preview is never compacted — the preview *is* the payload. Worth noting that the
    // trigger-source rule already gets this right on its own (a preview is `ui`), but
    // relying on that would be an accident rather than a decision.
    const compactDefault = receipt.triggerSource === "event" && !receipt.preview;
    if ((opts.compactHaltReceipts ?? compactDefault) &&
        receipt.outcome === "halt" &&
        !effectfulNodeRan) {
        receipt.compact = true;
        receipt.compactedNodeCount = receipt.nodes.length;
        receipt.nodes = [];
        receipt.reviews = [];
    }
    return receipt;
}
/**
 * Every out port a gate-eligible Consumer declares as `write-result@1` resolves to the
 * *same* discriminated value. A port named `messageId` therefore hands downstream the
 * result, not an id — which is the point: there may not be an id yet (13 §7j-b).
 */
function publishWriteResult(w, out) {
    const published = { ...w, main: w };
    for (const [port, shape] of Object.entries(out ?? {})) {
        if (shape === "core:shape/write-result@1")
            published[port] = w;
    }
    return published;
}
const isWriteResult = (v) => !!v &&
    typeof v === "object" &&
    "status" in v &&
    (v.status === "committed" ||
        v.status === "pending");
/**
 * A loop's `repeatWhile` is a **port reference**, resolved in the iteration's own scope.
 * Not an expression: a reference keeps the construct renderable ("repeats while
 * generate.hasToolCalls, max 8") and keeps a second expression language out of the design.
 */
function resolvePredicate(ref, scope) {
    if (!ref || typeof ref !== "object" || ref.__ref !== "data")
        return ref;
    const r = ref;
    return readPort(scope.get(r.node), r.port);
}
/**
 * Read a port off an upstream value.
 *
 * `main` means **the whole value** when the producer declared no distinct `main` — which
 * is exactly the case for a map or loop item, where the "producer" is a raw list element
 * that never had ports at all. Without this, `$.$item` on a plain object silently
 * resolves to undefined, which is the least debuggable failure available.
 */
function readPort(upstream, port) {
    if (!upstream || typeof upstream !== "object")
        return upstream;
    if (port === "main" && !(port in upstream))
        return upstream;
    return upstream[port];
}
/** `over` is either a literal list or a data ref into an upstream value. */
function resolveMapItems(over, values) {
    if (Array.isArray(over))
        return over;
    if (over && typeof over === "object" && over.__ref === "data") {
        const r = over;
        const v = readPort(values.get(r.node), r.port);
        return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
    }
    return [];
}
async function sequential(items, fn) {
    const out = [];
    for (const i of items)
        out.push(await fn(i));
    return out;
}
function withTimeout(p, ms, controller, now) {
    if (!Number.isFinite(ms))
        return p;
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
            controller.abort();
            reject(new Error("__timeout__"));
        }, ms);
        p.then((v) => {
            clearTimeout(t);
            resolve(v);
        }, (e) => {
            clearTimeout(t);
            reject(e);
        });
    });
}
function setPath(obj, path, value) {
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        cur[k] = Array.isArray(cur[k]) ? [...cur[k]] : { ...(cur[k] ?? {}) };
        cur = cur[k];
    }
    cur[path[path.length - 1]] = value;
}
/** Vectors, material and secrets never enter a receipt (16 §1a, 01 §10, 13 §6). */
function redact(v) {
    if (Array.isArray(v) &&
        v.length > 8 &&
        v.every((x) => typeof x === "number")) {
        return { $vector: true, dims: v.length };
    }
    if (Array.isArray(v))
        return v.map(redact);
    // A secret-typed setting is redacted **by its type**, which is the entire reason
    // the field is typed rather than free-form: core can identify it without knowing
    // what the plugin called it (13 §6).
    if (isSecret(v))
        return "[secret]";
    if (v && typeof v === "object") {
        const out = {};
        for (const [k, val] of Object.entries(v)) {
            if (k === "material" || k === "credentials") {
                out[k] = "[redacted]";
                continue;
            }
            out[k] = redact(val);
        }
        return out;
    }
    return v;
}
/** replay(receipt) — deterministic, never re-infers (F16). */
export async function replay(doc, receipt, bindings) {
    const recorded = new Map(receipt.nodes.map((n) => [n.nodeKey, n.output]));
    const replayBindings = { ...bindings };
    for (const n of receipt.nodes) {
        if (n.kind !== "provider")
            continue;
        replayBindings[n.typeId] = async () => ok(recorded.get(n.nodeKey));
    }
    return run(doc, {
        input: receipt.nodes[0]?.output,
        bindings: replayBindings,
        seed: receipt.seed,
        runId: receipt.runId + ":replay"
    });
}
//# sourceMappingURL=executor.js.map