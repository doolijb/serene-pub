/**
 * Allocation and wire formatting are two jobs, and only one of them is modality-agnostic
 * (16 §7).
 *
 * The earlier draft fused them: Assemble owned a Jinja template and published
 * `assembled-context@1`, which forced that shape to mean *"a rendered string."* That is
 * correct for exactly one family of connections. A chat-completion endpoint wants a
 * role-tagged array; a raw completion endpoint wants one string with instruct sequences;
 * ComfyUI wants prompt fields plugged into a workflow. The tell was `renderImage`
 * declaring both `context: assembled-context@1` **and** `prompts: {positive, negative}` —
 * it already half-admitted it did not want a rendered blob.
 *
 * So:
 *
 * - **Assemble allocates.** What fits, in what order, honouring weights and minimums, and
 *   recording why each block is in or out. Pure, universal, and where "why was this
 *   dropped" is answered. It publishes `allocated-context@1`: blocks, not prose.
 * - **The Provider formats**, through a declared `wire` slot whose default comes from the
 *   connection's adapter metadata. Swapping Ollama for OpenAI does not re-author a spec.
 *
 * A slot rather than adapter-internal logic, for the reason 16 §2 already gives about the
 * retrieval-strategy switch: **a declared field is visible in config, rendered in a lens
 * and resolved in the receipt; logic inside a leaf is none of those.**
 */
export type BlockRole = 'system' | 'user' | 'assistant' | 'tool' | 'note';
export interface ContextBlock {
    id?: string;
    /** Which retrieval source produced it — the axis the weights lens groups by. */
    sourceKey: string;
    role: BlockRole;
    /** Already text by the time it reaches Assemble (16 §3b, enforced by port shapes). */
    rendered: string;
    /** Counted once, at render time. Allocation is then arithmetic over integers. */
    tokens: number;
    weight?: number;
    priority?: 'low' | 'normal' | 'high' | 'always';
    order?: number;
    /** Position inside the history, for depth insertion (16 §5e). */
    depth?: number;
    included: boolean;
    /**
     * **The trail.** Each stage appends one line — the trigger Query says which key
     * matched, the rank Task says which group it won or lost and how the probability
     * rolled, Assemble says whether the budget reached it.
     *
     * The debug panel is worth opening exactly to the extent that this is populated. A
     * panel that can only say "dropped — budget" is a token counter.
     */
    why: string[];
}
export interface AllocatedContext {
    blocks: ContextBlock[];
    allocation: {
        budget: number;
        used: number;
        droppedTokens: number;
        policy: 'oldest-first' | 'lowest-weight' | string;
        /** True when a template engine could not analyse itself, so the margin widened. */
        estimateExact?: boolean;
    };
}
export declare const isAllocatedContext: (v: unknown) => v is AllocatedContext;
export declare const included: (c: AllocatedContext) => ContextBlock[];
export interface WireFormat {
    id: string;
    label: string;
    /** What actually goes on the wire. */
    format(ctx: AllocatedContext, opts?: Record<string, unknown>): unknown;
    /**
     * Tokens the scaffolding adds — role markers, instruct sequences, JSON overhead.
     * Declared rather than measured after the fact, so Assemble can allocate against a
     * **ceiling** and the answer to "will this overspend" is provable (16 §7).
     */
    overhead(ctx: AllocatedContext, count: (s: string) => number): number;
}
export declare function defineWireFormat(w: WireFormat): WireFormat;
export declare const getWireFormat: (id: string) => WireFormat | undefined;
export declare const allWireFormats: () => WireFormat[];
export declare function _clearWireFormats(): void;
export declare function formatWith(id: string, ctx: AllocatedContext, opts?: Record<string, unknown>): unknown;
/** Chat completion: the role-tagged array. */
export declare const messages: WireFormat;
/** Text completion, ChatML sequences. */
export declare const chatml: WireFormat;
/** Text completion, Alpaca-style. */
export declare const alpaca: WireFormat;
/** Everything joined, no scaffolding. The reference implementation of zero overhead. */
export declare const plainWire: WireFormat;
/**
 * Prompt **fields**, for a Provider that plugs values into a workflow rather than sending
 * prose — image generation being the case that exposed the whole problem.
 */
export declare const fields: WireFormat;
export interface WireMeasure {
    format: string;
    payload: unknown;
    /** Blocks + declared scaffolding. The figure Assemble allocated against. */
    tokens: number;
    blockTokens: number;
    overheadTokens: number;
    /** Set when the formed payload exceeds what the budget allowed. */
    overBudgetBy?: number;
}
/**
 * Format once and measure once, at the pre-call substrate.
 *
 * The allocation loop must never re-render or re-count: count each block at render time,
 * allocate over integers, format exactly once. Anything else has a performance cliff at
 * precisely the moment a user's context is biggest.
 */
export declare function measureWire(formatId: string, ctx: AllocatedContext, count: (s: string) => number, available?: number, opts?: Record<string, unknown>): WireMeasure;
//# sourceMappingURL=wire.d.ts.map