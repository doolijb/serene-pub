/**
 * Descriptors — the shared-scope declaration of a type (01 §1, 04 §3).
 *
 * A descriptor is data: it can be listed, rendered and validated without loading
 * the hook that implements it. That is what lets the plugin manager and the editor
 * work from rows (10 §10.2).
 */
const types = new Map();
function register(d) {
    if (types.has(d.id))
        throw new Error(`duplicate type id: ${d.id}`);
    checkWritePublishes(d);
    types.set(d.id, d);
    return d;
}
/**
 * A gate-eligible write publishes `write-result@1`, never raw ids (13 §7j-b).
 *
 * Checked at registration rather than reviewed by hand, because the hand-written version
 * was already wrong: three core Consumers declared `row-ids@1` out ports while declaring
 * `effects: 'write'`. Each one was a spec that could wire a downstream foreign key to a
 * row a reviewer had not approved yet — and under `async` review that row may never exist.
 * The failure lands long after the run that caused it, which is the worst kind to find by
 * reading.
 */
function checkWritePublishes(d) {
    if (d.effects !== 'write')
        return;
    const bad = Object.entries(d.ports?.out ?? {}).filter(([, s]) => shapeIdOf(s) === 'core:shape/row-ids@1');
    if (!bad.length)
        return;
    throw new Error(`${d.id} declares effects: 'write' but publishes core:shape/row-ids@1 on ` +
        `${bad.map(([k]) => `'${k}'`).join(', ')}. A gate-eligible write publishes ` +
        `core:shape/write-result@1 — pending under async review, committed otherwise — so a ` +
        `downstream port wanting raw ids fails at publish instead of writing a foreign key ` +
        `that dangles when the reviewer rejects (13 §7j-b).`);
}
const shapeIdOf = (s) => typeof s === 'string' ? s : (s?.id ?? undefined);
export function getType(id) {
    return types.get(id);
}
export function allTypes() {
    return [...types.values()];
}
export function _clearTypes() {
    types.clear();
}
// ── describe* — one per kind, same shape, no modality anywhere ───────────────
export const describeInput = (d) => register({ ...d, kind: 'input' });
export const describeQueryType = (d) => register({ ...d, kind: 'query' });
export const describeTaskType = (d) => register({ ...d, kind: 'task' });
export const describeProvider = (d) => register({ ...d, kind: 'provider' });
export const describeConsumerTarget = (d) => register({ ...d, kind: 'consumer' });
export function pin(descriptor) {
    const version = /@(\d+)$/.exec(descriptor.id)?.[1] ?? '1';
    const ctor = (config = {}) => ({
        __node: true,
        descriptor,
        config,
    });
    return { [`v${version}`]: ctor, id: descriptor.id, descriptor };
}
//# sourceMappingURL=descriptors.js.map