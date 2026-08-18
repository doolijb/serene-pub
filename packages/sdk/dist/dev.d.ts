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
import { type SpecDocument } from './document.js';
import type { Extension } from './extension.js';
import { type RegistryEntry } from './registry.js';
import type { Bindings } from './executor.js';
export interface DevOverlay {
    slug: string;
    version: string;
    /** Absolute path to the entry module, so a reload knows what to re-evaluate. */
    entry: string;
    /** Registry rows that shadow the persisted table for this session only. */
    types: RegistryEntry[];
    documents: SpecDocument[];
    bindings: Bindings;
    components: Extension['components'];
    /** Stamped into every receipt this overlay produces. */
    source: 'dev';
    loadedAt: number;
}
/**
 * Build the in-memory overlay for a loaded extension.
 *
 * Deliberately takes an already-evaluated `Extension` rather than a path: *loading* is the
 * host's job — it owns the module cache, the watcher and the sandbox — and keeping that out
 * of here means this function is pure and testable, and that the SDK is not quietly a
 * module loader.
 */
export declare function devOverlay(extension: Extension, entry: string, now: number): DevOverlay;
export type ChangeKind = 'type-added' | 'type-removed' | 'type-changed' | 'pipeline-added' | 'pipeline-removed' | 'pipeline-changed' | 'component-changed' | 'binding-changed';
export interface Change {
    kind: ChangeKind;
    id: string;
    /** Whether this change may be applied while runs are in flight. */
    hot: boolean;
    note?: string;
}
export interface ReloadPlan {
    changes: Change[];
    /** Applied immediately. */
    hot: Change[];
    /** Held until the runs below finish. */
    deferred: Change[];
    blockedBy: string[];
    summary: string;
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
export declare function reloadPlan(prev: DevOverlay, next: DevOverlay, inFlight?: ReadonlyArray<{
    runId: string;
    specId: string;
    typeIds: string[];
}>): ReloadPlan;
/**
 * What a dev overlay must never do. Exported as data so the host can assert it rather than
 * remember it — the persistence rule is the one that silently stops being true.
 */
export declare const DEV_INVARIANTS: readonly [{
    readonly id: "D1";
    readonly rule: "a dev overlay writes no rows";
    readonly breaks: "a dev plugin whose rows outlive the session leaves chats pinning types with no install to uninstall";
}, {
    readonly id: "D2";
    readonly rule: "permissions are compiled and double-checked identically";
    readonly breaks: "dev mode would become a way to hold permissions the manifest never declared (F28)";
}, {
    readonly id: "D3";
    readonly rule: "every receipt records source: 'dev'";
    readonly breaks: "\"it worked on my machine\" stops being distinguishable from \"it worked\"";
}, {
    readonly id: "D4";
    readonly rule: "no in-flight run changes underneath itself";
    readonly breaks: "a receipt claims to describe a run of a specific spec version, and that claim becomes false";
}];
//# sourceMappingURL=dev.d.ts.map