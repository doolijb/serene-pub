/**
 * Document compilation (04 §5a, F3, F6).
 *
 * The builder chain is an *authoring format only*. SP imports the document and
 * never the JS — there is no importer path that evaluates a builder chain.
 *
 * Edges are derived here, 1:1 with pipeline_edges rows: the linear chain carries a
 * default edge, and every $ref becomes an explicit one.
 */
import type { BuiltSpec } from './builder.js';
import { type ConnectionRequirement } from './connections.js';
export interface DocEdge {
    from: string;
    fromPort: string;
    to: string;
    toPort: string;
    shape?: string;
    streaming?: boolean;
    /** true when derived from chain order rather than an explicit $ref */
    implicit?: boolean;
}
export interface DocNode {
    key: string;
    kind: string;
    typeId: string;
    typeVersion: number;
    config: Record<string, unknown>;
    blockId?: string;
    blockKind?: string;
    blockChain?: string;
    position: number;
    /** Config references resolved at publish and stored explicitly (16 §5b-i). */
    resolvedRefs?: Record<string, string>;
}
export interface SpecDocument {
    schemaVersion: 1;
    id: string;
    version: string;
    mode?: unknown;
    subscribes: string[];
    includes: Array<{
        key: string;
        fragmentId: string;
    }>;
    /** Author-shipped presets. Execution-affecting, so they round-trip (F4). */
    presets: BuiltSpec['presets'];
    nodes: DocNode[];
    edges: DocEdge[];
    blocks: BuiltSpec['blocks'];
}
export declare function compile(built: BuiltSpec): SpecDocument;
/**
 * Follow the spine forward from `fromKey` to the first Provider. Linearity is what
 * makes this well-defined (F25). Ambiguity or absence is a publish error that names
 * the candidates — the teaching-error pattern (15 §1.3).
 */
export declare function resolveDownstreamProvider(built: BuiltSpec, fromKey: string): string;
/** Canonical form — stable key order, for hashing and round-trip identity (F3). */
export declare function canonical(doc: SpecDocument): string;
/** Cheap deterministic content hash — stands in for the real canonical_hash (02 §3). */
export declare function canonicalHash(doc: SpecDocument): string;
/** Import: document → the same in-memory form. `import(export(x))` is identity (F3). */
export declare function importDocument(doc: SpecDocument): SpecDocument;
export interface ExportOptions {
    /**
     * Which presets travel. The app lets a user choose; SDK compile has no instance to
     * choose from, so it ships everything the author wrote.
     */
    presets?: 'all' | 'none' | string[];
    /**
     * How preset bindings travel — the same explicit fork pipeline export already offers
     * (02 §6), never decided silently.
     *
     * - `base` keeps `$ref` references by slug. Portable only where the target is itself a
     *   seeded, slugged row; a reference to something a user made locally resolves to
     *   nothing on the far side.
     * - `flattened` inlines the values. Always portable, and it forks the config — the
     *   importing instance can no longer swap the named thing in one place.
     */
    bindings?: 'base' | 'flattened';
    /** Resolve a `$ref` when flattening. Absent values are dropped and reported. */
    resolve?: (slot: string, ref: string) => unknown;
}
export interface ExportResult {
    doc: SpecDocument;
    /** What did not travel, and why — so an export is never quietly lossy. */
    omitted: Array<{
        what: string;
        reason: string;
    }>;
    /**
     * Every connection the importing instance must wire, derived from the types rather
     * than from what this instance happened to have configured (13 §10a). Complete even
     * when the exporter never set one up.
     */
    requires: ConnectionRequirement[];
}
/**
 * Export a document, with the presets a user selected (12 §7).
 *
 * **A filtered export is a different document, not a lossy copy of the same one**, so its
 * canonical hash legitimately differs from the source's. F3's identity law is about a
 * given export round-tripping — `import(export(x)) === export(x)` — and that still holds
 * exactly.
 */
export declare function exportDocument(doc: SpecDocument, opts?: ExportOptions): ExportResult;
//# sourceMappingURL=document.d.ts.map