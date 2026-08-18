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
import { $ref } from './refs.js';
const REF_KEYS = new Set(['__ref', 'node', 'port']);
/**
 * A ref that can be refined. The proxy target is a real `DataRef`, so `JSON.stringify`,
 * `Object.entries` and `collectDataRefs` all see a plain object — the proxy is invisible
 * to everything downstream of authoring.
 */
function refAccessor(node, port = 'main') {
    const target = $ref(node, port);
    return new Proxy(target, {
        get(t, prop, recv) {
            if (typeof prop !== 'string')
                return Reflect.get(t, prop, recv);
            if (REF_KEYS.has(prop) || prop === 'toJSON' || prop === 'then')
                return Reflect.get(t, prop, recv);
            // Object internals must pass through untouched, or deep-equality, logging and
            // anything else that probes an object turns into a port reference.
            if (prop in Object.prototype)
                return Reflect.get(t, prop, recv);
            // Refining an already-refined ref is a mistake worth catching early:
            // `$.a.b.c` has no meaning — ports are flat.
            if (port !== 'main') {
                throw new Error(`'${node}.${port}.${prop}' — ports are flat, so a ref cannot be refined twice. ` +
                    `Reference the port you want directly, or reach inside the payload in the node's own hook.`);
            }
            return refAccessor(node, prop);
        },
    });
}
/**
 * Build the scope for a call site.
 *
 * @param knownKeys every node key declared so far, fully qualified
 * @param localPrefix inside a block chain, the qualifier its members share — so a
 *   sibling can be named by its short key (`$.embed`) while an outside node is still
 *   reachable by its full path (`$.gather.semantic.embed`).
 */
export function makeScope(knownKeys, localPrefix, blockId) {
    /** A sibling inside the same chain wins over a same-named outside key. */
    const resolveKey = (joined) => {
        if (localPrefix && knownKeys.has(`${localPrefix}.${joined}`))
            return `${localPrefix}.${joined}`;
        return knownKeys.has(joined) ? joined : undefined;
    };
    const isPrefix = (joined) => [...knownKeys].some((k) => k.startsWith(`${joined}.`) || (!!localPrefix && k.startsWith(`${localPrefix}.${joined}.`)));
    /**
     * A path segment can be three things at once, and the order matters:
     *
     *  1. a **step toward** a longer key — `gather` on the way to `gather.semantic.embed`
     *  2. a **key in its own right** — a block publishes under its own id, so `$.gather`
     *     is also a real reference
     *  3. a **port** on the key we already have — `$.history.messages`
     *
     * Walking wins over porting, because a block id being addressable must not shadow the
     * nodes underneath it. Only when nothing deeper can match is the segment a port.
     */
    const walk = (path) => {
        const joined = path.join('.');
        const selfKey = joined ? resolveKey(joined) : undefined;
        const target = selfKey ? $ref(selfKey, 'main') : Object.create(null);
        return new Proxy(target, {
            get(t, prop, recv) {
                if (typeof prop !== 'string')
                    return Reflect.get(t, prop, recv);
                if (REF_KEYS.has(prop) || prop === 'toJSON' || prop === 'then')
                    return Reflect.get(t, prop, recv);
                if (prop in Object.prototype)
                    return Reflect.get(t, prop, recv);
                // Inside a map or loop, the current item is addressable without naming the
                // block — its key is bookkeeping the author should not have to repeat.
                if (prop === ITEM && blockId && path.length === 0)
                    return refAccessor(`${blockId}.${ITEM}`);
                const next = [...path, prop];
                const nextJoined = next.join('.');
                if (resolveKey(nextJoined) || isPrefix(nextJoined))
                    return walk(next);
                if (selfKey)
                    return refAccessor(selfKey, prop);
                throw new Error(`'${nextJoined}' is not a node declared before this point.` +
                    (knownKeys.size
                        ? ` Available: ${[...knownKeys].join(', ')}.`
                        : ' No nodes are declared yet — the Input comes first (01 §2).') +
                    ` Pipelines have no back-edges (F9), so a node cannot reference one declared later.`);
            },
        });
    };
    return walk([]);
}
/** The current item inside a map, addressed without knowing the block's key. */
export const ITEM = '$item';
//# sourceMappingURL=scope.js.map