/**
 * Configuration resolution (12 §2). Five layers, first hit wins, evaluated
 * independently per path — which is what makes an admin's connection change reach a
 * user who has customized their prompts (F20).
 *
 * Resolved run-wide *before* execution, which is why referencing another node's
 * config is not a data edge (F35).
 */
export type ScopeKind = 'chat' | 'user' | 'preset' | 'instance' | 'author';
export declare const SCOPE_ORDER: ScopeKind[];
export interface OverrideRow {
    nodeKey: string;
    slot: string;
    path: string;
    value: unknown;
    scopeKind: ScopeKind;
    scopeId?: string | number;
}
export interface SamplingConfig {
    id: string;
    name: string;
    shape: string;
    values: Record<string, unknown>;
}
export interface ConnectionRecord {
    id: string;
    name: string;
    kind: string;
    /** Readable — not a credential (01 §10). */
    metadata: {
        contextLength?: number;
        tokenizer?: string;
        model?: string;
        supportedSamplers?: string[];
    };
    /** Never readable by any node. Injected per call by the executor. */
    material: Record<string, string>;
    enabled?: boolean;
}
export interface ConfigWorld {
    overrides: OverrideRow[];
    samplingConfigs: SamplingConfig[];
    connections: ConnectionRecord[];
    /** Singleton kinds, e.g. embeddings (01 §10). */
    activeConnection: Record<string, string | null>;
    authorDefaults?: Record<string, Record<string, Record<string, unknown>>>;
}
export type ResolvedConfig = Record<string, Record<string, Record<string, unknown>>>;
/**
 * A resolved value **and the layer it won at**.
 *
 * The layer is not decoration. *"I changed this and nothing happened"* is the
 * most common support question this system can produce, and it is unanswerable
 * from the value alone — the answer is always "something above you set it too",
 * and only this says which something.
 */
export interface ResolvedSource {
    value: unknown;
    /** Which layer won. `author` means the declared default was never overridden. */
    scopeKind: ScopeKind | 'author';
    /** The user or chat the winning row belonged to, where one applies. */
    scopeId?: string | number;
}
export type ResolvedConfigSources = Record<string, Record<string, Record<string, ResolvedSource>>>;
/**
 * Effective config **with provenance** = base ⊕ overrides, per (nodeKey, slot, path).
 *
 * This is the primitive; `resolveConfig` is derived from it rather than written
 * beside it. Two implementations of a five-layer walk are two implementations
 * that eventually disagree about which layer wins — and the one that disagrees
 * silently is whichever one the UI is not using.
 */
export declare function resolveConfigSources(world: ConfigWorld, nodeKeys: string[]): ResolvedConfigSources;
/** Effective config = base ⊕ overrides, per (nodeKey, slot, path). */
export declare function resolveConfig(world: ConfigWorld, nodeKeys: string[]): ResolvedConfig;
/**
 * Which scopes may write which slot (12 §4). The admin cascade needs no mechanism:
 * connection has no writable scope at chat/user, so an admin's choice reaches
 * everyone automatically.
 */
export declare const WRITE_MATRIX: Record<string, ScopeKind[]>;
export declare function mayWrite(slot: string, scope: ScopeKind): boolean;
/** Reject a write the matrix forbids, with the reason (15 §1.3). */
export declare function assertWritable(slot: string, scope: ScopeKind): void;
//# sourceMappingURL=config.d.ts.map