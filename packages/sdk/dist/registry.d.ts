/**
 * The pipeline type registry — the ruling on 13 §10c.
 *
 * ## Where a type's shape comes from, at three different moments
 *
 * The question underneath "schema sources" is which artefact is authoritative, and the
 * honest answer is that a different one is authoritative at each moment. Writing that
 * down is the ruling; pretending there is a single source is what would go wrong.
 *
 * | moment | source of truth | why |
 * |---|---|---|
 * | authoring | the `Descriptor` in code | the author is *defining* the type; nothing else knows it yet |
 * | compiling a spec | generated `/contracts` | frozen per release, so a pin resolves the same way forever (04 §2) |
 * | installing | **the registry row** | the only one core can read without executing the plugin |
 *
 * The third row is the whole point. Core must decide whether a plugin is installable
 * before it ever runs the plugin's code — F6 means core imports documents, never
 * authoring JS — so install-time validation reads two things that are both plain data:
 * the plugin's **manifest** (types summarized, permissions compiled from usage) and its
 * **documents** (nodes pinned by `typeId@version`, edges carrying the shapes they were
 * compiled against).
 *
 * ## What that makes checkable
 *
 * The interesting failure is not a plugin that pins a type nobody has — that one is
 * obvious and fails loudly. It is a plugin **built against a different release**, where
 * every id still resolves but a port now produces a different shape. The document
 * records the shape each edge was compiled against, so comparing it to the registry
 * catches exactly that, and catches it at install rather than mid-run.
 */
import type { Descriptor, SlotDecl } from './descriptors.js';
import type { SpecDocument } from './document.js';
/** A `type_registry` row (02 §3), as data. */
export interface RegistryEntry {
    id: string;
    version: number;
    kind: string;
    ports: {
        in: Record<string, string | undefined>;
        out: Record<string, string | undefined>;
    };
    /**
     * The **declarations**, not their names.
     *
     * This carried `string[]` until 0.6.0, and that quietly broke the promise the
     * column exists to keep. 12 §2 says slot declarations live in the type descriptor
     * *"so a plugin Provider's prompt fields render next to core's automatically, with
     * no UI work"*, and the table above says the registry row is what core reads
     * **without executing the plugin**. A name list satisfies neither: a form
     * generator given `['prompts', 'params']` knows a form exists and nothing about
     * what is in it, so it has to fall back to the in-process descriptor map — which
     * exists for core types, does not exist for a `transport: 'process'` plugin type,
     * and is the exact thing F6 forbids reaching for.
     *
     * Storing the declaration makes the pipeline view (05 §0a) and the lens view
     * (05 §3) generated from rows, which is what lets a plugin's sliders appear beside
     * core's with nothing authored twice.
     */
    slots: Record<string, SlotDecl>;
    effects?: string;
    causesEvent?: string;
    public?: boolean;
    /** Null for core types; the plugin slug for plugin types (12 §3b). */
    owner?: string;
    /** Which SP release seeded this row. */
    release?: string;
}
/** Project descriptors into registry rows — how core seeds and refreshes the table. */
export declare function snapshotRegistry(types: Descriptor[], meta?: {
    owner?: string;
    release?: string;
}): RegistryEntry[];
export type InstallCode = 'E_UNKNOWN_TYPE' | 'E_SHAPE_DRIFT' | 'E_REDECLARES_CORE' | 'E_PRIVATE_TYPE' | 'E_MISSING_BINDING' | 'E_IN_PROCESS_HOOK' | 'W_NEWER_VERSION';
export interface InstallFinding {
    severity: 'error' | 'warning';
    code: InstallCode;
    message: string;
    /** What the admin or author does about it. Never omitted (15 §1.3). */
    fix: string;
    where?: string;
}
export interface InstallInput {
    /** The plugin's own declared types, as summarized in its manifest. */
    declares: Array<{
        id: string;
        binding?: string;
        ports?: RegistryEntry['ports'];
        runtime?: string;
    }>;
    /** The pipeline documents shipped beside the manifest. */
    documents: SpecDocument[];
    /** The installing instance's registry. */
    registry: RegistryEntry[];
    /** Type ids the plugin enumerates hooks for — a declared type with no binding cannot run. */
    bound?: string[];
    owner?: string;
}
/**
 * Decide whether a plugin is installable, from data alone.
 *
 * Never loads the plugin. Every finding names what to do, because the reader is an admin
 * who did not write the plugin and cannot be expected to infer the fix from the symptom.
 */
export declare function checkInstall(input: InstallInput): InstallFinding[];
export declare const installable: (f: InstallFinding[]) => boolean;
export declare function renderInstall(findings: InstallFinding[]): string;
//# sourceMappingURL=registry.d.ts.map