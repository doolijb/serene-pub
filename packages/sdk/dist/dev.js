/**
 * Dev mode: point at an entry file, load it in memory, hot reload (13 §11).
 *
 * ## The collision, stated before it is resolved
 *
 * F6 says **core imports documents, never authoring JS**, and 04 §5a says nothing is
 * discovered by executing. A dev loader that evaluates `src/index.ts` and pulls pipelines,
 * hooks and components out of memory looks exactly like the thing both rules forbid.
 *
 * It is not, and the distinction is worth being precise about rather than waving at.
 *
 * **What F6 protects is the *importer*.** The claim it makes is that no code path reachable
 * from installing or running a plugin evaluates authoring JavaScript — so a malicious
 * document cannot become a malicious program, and a plugin cannot announce capabilities at
 * runtime that its manifest did not declare. That claim survives here, because the dev
 * loader does not hand core an `Extension`. It **compiles** — same packager, same manifest,
 * same documents — and hands core the same plain data an installed plugin does. The
 * evaluation happens in the dev harness, on the developer's own machine, on their own code,
 * exactly as it does inside `serene-pub build`.
 *
 * So the rule that actually holds is narrower and truer than "core never evaluates JS":
 *
 * > **Every path into core carries a manifest and documents. Dev mode changes where they
 * > were produced, not what core receives.**
 *
 * Three constraints follow, and they are not negotiable if the loader is to stay honest:
 *
 * 1. **Memory only.** A dev overlay never writes `type_registry`, spec or preset rows. A dev
 *    plugin whose rows outlived the session would leave a user's chats pinning types that no
 *    longer exist — a broken install with no install to uninstall.
 * 2. **Permissions are compiled and enforced identically.** Dev mode changes the source of
 *    the code, never the trust in it. The runtime double-check (F28) does not know or care
 *    that a plugin came from a file path.
 * 3. **Provenance is recorded.** Every run from a dev-loaded plugin marks its receipt
 *    `source: 'dev'`, because "it worked on my machine" needs to be distinguishable in the
 *    record from "it worked."
 *
 * ## Hot reload has one hard rule
 *
 * **An in-flight run never changes underneath itself.** A receipt claims to describe a run
 * of a specific spec version; swapping a node's implementation halfway through makes that
 * claim false, and a receipt that lies is worse than no receipt. So a reload that touches
 * anything a running pipeline is using is *deferred*, not applied — and `reloadPlan` says
 * which runs are holding it up, so the developer sees "waiting on 1 run" rather than
 * silence.
 */
import { compile } from './document.js';
import { bindingsOf, pipelineHooksOf } from './extension.js';
import { snapshotRegistry } from './registry.js';
/**
 * Build the in-memory overlay for a loaded extension.
 *
 * Deliberately takes an already-evaluated `Extension` rather than a path: *loading* is the
 * host's job — it owns the module cache, the watcher and the sandbox — and keeping that out
 * of here means this function is pure and testable, and that the SDK is not quietly a
 * module loader.
 */
export function devOverlay(extension, entry, now) {
    return {
        slug: extension.slug,
        version: extension.version,
        entry,
        types: snapshotRegistry(pipelineHooksOf(extension).map((h) => h.type), { owner: extension.slug, release: 'dev' }),
        documents: (extension.pipelines ?? []).map(compile),
        bindings: bindingsOf(extension),
        components: extension.components ?? [],
        source: 'dev',
        loadedAt: now,
    };
}
/**
 * Diff two overlays and decide what may be applied now.
 *
 * The interesting judgement is which changes are hot. A **binding** may be swapped freely
 * between runs — that is the whole point of the loop a developer is in. A **type's ports**
 * may not be swapped while a run is using it, because the run's edges were validated against
 * the old shape and the executor would be moving a value into a port that no longer accepts
 * it. A **pipeline document** may not change mid-run for the same reason its version exists.
 *
 * Components are always hot: they render, they do not participate in a run, and a developer
 * iterating on a message renderer should never be told to wait.
 */
export function reloadPlan(prev, next, inFlight = []) {
    const changes = [];
    const prevTypes = new Map(prev.types.map((t) => [`${t.id}@${t.version}`, t]));
    const nextTypes = new Map(next.types.map((t) => [`${t.id}@${t.version}`, t]));
    for (const [id, t] of nextTypes)
        if (!prevTypes.has(id))
            changes.push({ kind: 'type-added', id, hot: true, note: 'nothing can be using it yet' });
        else if (JSON.stringify(prevTypes.get(id).ports) !== JSON.stringify(t.ports))
            changes.push({
                kind: 'type-changed',
                id,
                hot: false,
                note: 'ports moved; a run validated against the old shape would be moving a value into a port that no longer accepts it',
            });
    for (const id of prevTypes.keys())
        if (!nextTypes.has(id))
            changes.push({ kind: 'type-removed', id, hot: false, note: 'a run may be mid-node' });
    const prevDocs = new Map(prev.documents.map((d) => [d.id, d]));
    const nextDocs = new Map(next.documents.map((d) => [d.id, d]));
    for (const [id, d] of nextDocs)
        if (!prevDocs.has(id))
            changes.push({ kind: 'pipeline-added', id, hot: true });
        else if (JSON.stringify(prevDocs.get(id)) !== JSON.stringify(d))
            changes.push({ kind: 'pipeline-changed', id, hot: false, note: 'a receipt names the spec version it ran' });
    for (const id of prevDocs.keys())
        if (!nextDocs.has(id))
            changes.push({ kind: 'pipeline-removed', id, hot: false });
    for (const key of Object.keys(next.bindings))
        if (key in prev.bindings && next.bindings[key] !== prev.bindings[key])
            changes.push({ kind: 'binding-changed', id: key, hot: true, note: 'swapped between runs — this is the loop' });
    const prevC = new Map((prev.components ?? []).map((c) => [c.slug, JSON.stringify(c)]));
    for (const c of next.components ?? [])
        if (prevC.get(c.slug) !== JSON.stringify(c))
            changes.push({ kind: 'component-changed', id: c.slug, hot: true, note: 'components render; they do not participate in a run' });
    // A cold change is only actually blocked if something is using the thing it touches.
    const touching = (c) => inFlight.filter((r) => r.specId === c.id || r.typeIds.some((t) => c.id.startsWith(t))).map((r) => r.runId);
    const deferred = changes.filter((c) => !c.hot && touching(c).length > 0);
    const blockedBy = [...new Set(deferred.flatMap(touching))];
    const hot = changes.filter((c) => c.hot || !deferred.includes(c));
    return {
        changes,
        hot,
        deferred,
        blockedBy,
        summary: deferred.length
            ? `${hot.length} applied, ${deferred.length} waiting on ${blockedBy.length} run(s): ${blockedBy.join(', ')}`
            : `${hot.length} applied`,
    };
}
/**
 * What a dev overlay must never do. Exported as data so the host can assert it rather than
 * remember it — the persistence rule is the one that silently stops being true.
 */
export const DEV_INVARIANTS = [
    {
        id: 'D1',
        rule: 'a dev overlay writes no rows',
        breaks: 'a dev plugin whose rows outlive the session leaves chats pinning types with no install to uninstall',
    },
    {
        id: 'D2',
        rule: 'permissions are compiled and double-checked identically',
        breaks: 'dev mode would become a way to hold permissions the manifest never declared (F28)',
    },
    {
        id: 'D3',
        rule: "every receipt records source: 'dev'",
        breaks: '"it worked on my machine" stops being distinguishable from "it worked"',
    },
    {
        id: 'D4',
        rule: 'no in-flight run changes underneath itself',
        breaks: 'a receipt claims to describe a run of a specific spec version, and that claim becomes false',
    },
];
//# sourceMappingURL=dev.js.map