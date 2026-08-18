/**
 * Shapes — versioned edge/payload contracts (01 §1, §3).
 *
 * A shape is the unit of compatibility. Two nodes connect if the upstream port's
 * shape is assignable to the downstream port's. Shapes are also connection kinds
 * and sampling-config kinds (F17), which is what makes the system modality-agnostic:
 * nothing anywhere switches on "is this an LLM".
 */
const registry = new Map();
export function defineShape(def) {
    registry.set(def.id, def);
    return def.id;
}
export function getShape(id) {
    return registry.get(id);
}
export function isStreaming(id) {
    return registry.get(id)?.streaming === true;
}
/** The permissive sink: anything serializable may flow into a json port. */
export const JSON_SHAPE = 'core:shape/json@1';
/** Assignability: identical, into json, or declared assignable (transitively). */
export function assignable(from, to, seen = new Set()) {
    if (from === to)
        return true;
    if (to === JSON_SHAPE)
        return true;
    if (seen.has(from))
        return false;
    seen.add(from);
    const def = registry.get(from);
    if (!def?.assignableTo)
        return false;
    return def.assignableTo.some((next) => assignable(next, to, seen));
}
/** Reset — test isolation only. */
export function _clearShapes() {
    registry.clear();
}
// ── Core shapes ─────────────────────────────────────────────────────────────
export const S = {
    text: defineShape({ id: 'core:shape/text@1' }),
    textStream: defineShape({
        id: 'core:shape/text-stream@1',
        assignableTo: ['core:shape/text@1'],
        streaming: true,
    }),
    chatScope: defineShape({ id: 'core:shape/chat-scope@1' }),
    messages: defineShape({ id: 'core:shape/messages@1' }),
    candidates: defineShape({ id: 'core:shape/context-candidates@1' }),
    renderedBlocks: defineShape({ id: 'core:shape/rendered-blocks@1' }),
    assembled: defineShape({ id: 'core:shape/assembled-context@1' }),
    /**
     * What Assemble publishes after the allocation/formatting split (16 §7): ordered
     * **blocks** with role, source, token count and a `why` trail — not prose. The
     * Provider's `wire` slot turns it into whatever its connection actually wants.
     *
     * Assignable to `assembled-context@1` so existing specs keep connecting while core
     * migrates; the reverse is not assignable, because a rendered string has already
     * thrown away everything the panel and the budget need.
     */
    allocated: defineShape({
        id: 'core:shape/allocated-context@1',
        assignableTo: ['core:shape/assembled-context@1'],
    }),
    vector: defineShape({ id: 'core:shape/vector@1' }),
    budget: defineShape({ id: 'core:shape/context-budget@1' }),
    rowIds: defineShape({ id: 'core:shape/row-ids@1' }),
    /**
     * The output of an async block or a map (01 §1, 13 §1). An ordered list in
     * **declaration order**, one entry per branch — never a merged object, because
     * merging needs a field-collision policy and every such policy is wrong for
     * somebody. `async` and `map` produce the same shape, so one equivalence
     * harness covers both (F26).
     */
    branchResults: defineShape({ id: 'core:shape/branch-results@1' }),
    /**
     * What a **gate-eligible** Consumer publishes (13 §7j-b). Discriminated, because
     * under `async` review the write is a proposal a reviewer may still reject — and
     * a proposal id in a shared id space is indistinguishable from a real row id
     * right up until the foreign key dangles.
     *
     * Deliberately **not** assignable to `row-ids@1`. That is the whole enforcement:
     * a downstream node that wants ids must declare this port shape and handle both
     * cases in its hook, or the existing port-mismatch error fires at publish. There
     * is no branch node to check `status` with (F25), so the obligation belongs to
     * the type, not to the spec.
     */
    writeResult: defineShape({ id: 'core:shape/write-result@1' }),
    audio: defineShape({ id: 'core:shape/audio@1' }),
    image: defineShape({ id: 'core:shape/image@1' }),
    json: defineShape({ id: 'core:shape/json@1' }),
    // connection / sampling kinds — the same ids, which is the point (F17)
    textGen: defineShape({ id: 'core:shape/text-gen@1' }),
    embeddings: defineShape({ id: 'core:shape/embeddings@1' }),
    tts: defineShape({ id: 'core:shape/tts@1' }),
    imageGen: defineShape({ id: 'core:shape/image-gen@1' }),
};
//# sourceMappingURL=shapes.js.map