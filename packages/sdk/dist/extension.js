/**
 * `defineExtension` — the one entry point a plugin author starts from (03, 09).
 *
 * Before this existed, the SDK could express a pipeline and nothing else. An author could
 * build a spec but had nowhere to say *"this is my plugin, here are its lifecycle hooks,
 * its settings, its node types, its components, and the pipelines it ships."* That is the
 * difference between authoring a pipeline and writing a plugin, and it is most of what
 * "download the SDK" has to mean.
 *
 * Everything here is a **literal declaration**, because the compiler extracts it from the
 * source without executing it (F6, 03 §3, 13/§30). A registration assembled at runtime is
 * a lint error rather than a silent omission — the manifest has to be a complete statement
 * of what a plugin can do, or the permission model is a guess.
 */
export function pipelineHook(type, handler, opts = {}) {
    const descriptor = ('descriptor' in type ? type.descriptor : type);
    return {
        __decl: 'pipeline-hook',
        type: descriptor,
        visibility: opts.visibility ?? (descriptor.public ? 'public' : 'private'),
        handler,
        // Not configurable. See the note on the field.
        runtime: 'process',
    };
}
export const lifecycleHook = (moment, handler, opts = {}) => ({ __decl: 'lifecycle-hook', moment, handler, ...opts });
export const eventHook = (event, handler, opts = {}) => ({
    __decl: 'event-hook',
    event,
    handler,
    ...opts,
});
export const component = (d) => ({ __decl: 'component', ...d });
export class ExtensionError extends Error {
}
const SLUG = /^[a-z0-9]+([.-][a-z0-9]+)*$/;
/**
 * Declare a plugin. Validated here rather than at install, because an error an author
 * sees while writing costs a minute and the same error at install costs a support thread.
 */
export function defineExtension(d) {
    const problems = [];
    if (!SLUG.test(d.slug)) {
        problems.push(`'${d.slug}' is not a valid plugin slug — lowercase letters, digits, dots and hyphens ` +
            `(e.g. 'chariot.dice-tray'). It is the namespace every id you register must sit under.`);
    }
    if (!/^\d+\.\d+\.\d+/.test(d.version)) {
        problems.push(`'${d.version}' is not semver. A plugin upgrades by version comparison (12 §3b).`);
    }
    // Every id a plugin registers must sit under its own namespace. `core:` is reserved
    // and the registry rejects it, but a plugin claiming *another plugin's* namespace
    // would be accepted and would break ownership-based updates (12 §3b).
    for (const h of d.hooks ?? []) {
        if (h.__decl !== 'pipeline-hook')
            continue;
        const ns = h.type.id.split(':')[0];
        if (ns !== d.slug) {
            problems.push(`type '${h.type.id}' is registered by plugin '${d.slug}' but sits under namespace '${ns}'. ` +
                `Rename it to '${d.slug}:…' — ownership is what lets an update replace your rows and ` +
                `leave everyone else's alone.`);
        }
    }
    for (const p of d.pipelines ?? []) {
        const ns = p.id.split(':')[0];
        if (p.id.includes(':') && ns !== d.slug) {
            problems.push(`pipeline '${p.id}' sits under namespace '${ns}', not '${d.slug}'.`);
        }
    }
    const seen = new Set();
    for (const c of d.components ?? []) {
        if (seen.has(c.slug))
            problems.push(`duplicate component slug '${c.slug}' — slugs are the sync key (12 §3b).`);
        seen.add(c.slug);
    }
    if (problems.length) {
        throw new ExtensionError(`invalid extension '${d.slug}':\n` + problems.map((p) => `  • ${p}`).join('\n'));
    }
    return { __extension: true, ...d };
}
// ── Derived views ───────────────────────────────────────────────────────────
export const pipelineHooksOf = (e) => (e.hooks ?? []).filter((h) => h.__decl === 'pipeline-hook');
export const lifecycleHooksOf = (e) => (e.hooks ?? []).filter((h) => h.__decl === 'lifecycle-hook');
export const eventHooksOf = (e) => (e.hooks ?? []).filter((h) => h.__decl === 'event-hook');
/**
 * The bindings map the executor wants, built from the declaration. So an author's tests
 * run their real hooks rather than a hand-maintained parallel map that drifts.
 */
export function bindingsOf(e) {
    const out = {};
    for (const h of pipelineHooksOf(e))
        out[h.type.id] = h.handler;
    return out;
}
//# sourceMappingURL=extension.js.map