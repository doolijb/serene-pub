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