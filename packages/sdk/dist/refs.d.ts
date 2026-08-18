/**
 * References — edges as data (04 §4), and config references (F35).
 *
 * $ref creates a *data* edge and compiles 1:1 to a pipeline_edges row.
 * slot.* creates a *config* reference, which is resolved before execution and is
 * therefore not an edge and creates no dependency in the graph.
 */
export interface DataRef {
    readonly __ref: 'data';
    node: string;
    port: string;
}
export interface SlotRef {
    readonly __ref: 'slot';
    slot: 'connection' | 'sampling' | 'prompts' | 'template' | 'params';
    /** Whose config. Undefined = this node's own. */
    ofNode?: string;
    /** Unresolved marker: resolve to the first Provider reachable forward (16 §5b-i). */
    resolveDownstreamProvider?: boolean;
}
export declare function $ref(node: string, port?: string): DataRef;
/**
 * Config references accept a node accessor as well as a key, so a spec never has to
 * name a node twice in two different ways: `slot.connectionOf($.generate)` reads the
 * same as `$.generate.text` two lines below it.
 */
export type NodeAddress = string | {
    node: string;
};
export declare const slot: {
    connection: (ofNode?: NodeAddress) => SlotRef;
    sampling: (ofNode?: NodeAddress) => SlotRef;
    prompts: () => SlotRef;
    template: () => SlotRef;
    params: () => SlotRef;
    /** Explicit provider reference — always unambiguous. */
    providerRef: (node: NodeAddress) => SlotRef;
    connectionOf: (node: NodeAddress) => SlotRef;
    samplingOf: (node: NodeAddress) => SlotRef;
    /**
     * Resolves at publish to the first Provider reachable forward. Compiles to the
     * explicit form, so nothing implicit survives into rows (16 §5b-i).
     */
    downstreamProvider: () => SlotRef;
};
export declare const isDataRef: (v: unknown) => v is DataRef;
export declare const isSlotRef: (v: unknown) => v is SlotRef;
/** Walk a config object and collect every data ref, with the key path it sat at. */
export declare function collectDataRefs(config: unknown, path?: string[]): Array<{
    path: string[];
    ref: DataRef;
}>;
export declare function collectSlotRefs(config: unknown): SlotRef[];
//# sourceMappingURL=refs.d.ts.map