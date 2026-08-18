/**
 * A minimal executor — enough to run a compiled document and produce a receipt.
 *
 * Not the real thing, but it enforces the laws the design says the executor owns:
 * discriminated results including halt, per-run seed, timeouts that bound execution
 * but never waiting, consumption budgets, per-kind injection, and core-emitted events.
 */
import type { SpecDocument } from './document.js';
import type { Receipt } from './receipt.js';
import { type ConfigWorld } from './config.js';
import { type Reviewer } from './review.js';
export type Result<T = unknown> = {
    kind: 'ok';
    value: T;
} | {
    kind: 'err';
    reason: string;
} | {
    kind: 'cancelled';
    reason?: string;
} | {
    kind: 'halt';
    reason: string;
};
export declare const ok: <T>(value: T) => Result<T>;
export declare const err: (reason: string) => Result<never>;
export declare const halt: (reason: string) => Result<never>;
export declare const cancelled: (reason: string) => Result<never>;
/**
 * One entry per branch, in **declaration order** — never completion order, which is
 * the same rule 11 §3 already applies to event dispatch, so the system has one
 * ordering rule rather than two.
 */
export interface BranchResult {
    branchKey: string;
    index: number;
    result: Result;
}
/** What a block publishes. `main` aliases `branches` so `$ref(blockId)` works bare. */
export interface BranchResults {
    branches: BranchResult[];
    main: BranchResult[];
    /** The `ok` values in order — what a downstream fold actually wants. */
    values: unknown[];
    ok: boolean;
}
export type WriteResult = {
    status: 'committed';
    ids: Record<string, unknown>;
} | {
    status: 'pending';
    proposalId: string;
};
export declare const isCommitted: (w: WriteResult) => w is Extract<WriteResult, {
    status: "committed";
}>;
export interface TaskCtx {
    /** Only present when the descriptor declares randomness — keeps Tasks pure (F11). */
    random?: () => number;
    signal: AbortSignal;
    progress(message: string): void;
    log(level: 'info' | 'warn', message: string): void;
}
export interface QueryCtx extends TaskCtx {
    read(table: string, q?: unknown): unknown;
}
export interface ProviderCtx extends TaskCtx {
    /** Material is injected here per call and never readable from config. */
    call(payload: unknown): Promise<unknown>;
    connectionMetadata: Record<string, unknown>;
    sampling: Record<string, unknown>;
    reportUsage(tokens: number): void;
    reportSampling(applied: Record<string, unknown>, ignored: string[]): void;
}
export interface ConsumerCtx extends TaskCtx {
    commit(payload: unknown): Promise<Record<string, unknown>>;
    emit(handle: string, payload: unknown): void;
}
export type Hook = (input: any, ctx: any) => Result | Promise<Result>;
export interface Bindings {
    [typeIdAtVersion: string]: Hook;
}
export declare function seededRandom(seed: string): () => number;
export interface RunOptions {
    input: unknown;
    bindings: Bindings;
    world?: ConfigWorld;
    seed?: string;
    runId?: string;
    triggerSource?: Receipt['triggerSource'];
    triggerRef?: string;
    actorUserId?: string;
    /** Instance ceiling — config may not exceed it (F36). */
    timeoutCeilingMs?: number;
    /** Force every block sequential, as an admin may (01 §4). */
    forceSequential?: boolean;
    budget?: {
        tokens?: number;
        nodeExecutions?: number;
    };
    /** Which subscribers core would dispatch to, for the emitted record. */
    subscribers?: Record<string, number>;
    /** Simulated wait — never counted against a timeout (01 §5). */
    now?: () => number;
    /** Host-supplied review resolver. `sync` parks on it; waiting is free (F13). */
    reviewer?: Reviewer;
    /**
     * Time this run sat in the admin-visible queue before being dequeued (13 §3).
     * Recorded, and deliberately **not** added to any elapsed figure: queue wait
     * consumes no budget (F13) and trips no timeout (F36) — a run's clock starts
     * when it is dequeued.
     */
    queuedMs?: number;
    /**
     * Checked between nodes. Returning a value stops the run as `cancelled`, with the
     * actor recorded — so "an admin stopped it" stays distinguishable from "it broke",
     * which is why there are four result kinds rather than three (13 §3).
     */
    cancelSignal?: () => {
        by: string;
        reason: string;
    } | undefined;
    /**
     * Compact a receipt that halts before any effectful node: trigger, spec version,
     * halt node/reason and elapsed, with no payloads and no node rows (13 §2).
     *
     * Defaults to on **for event-triggered runs only**. That is where the multiplier
     * lives — a hot event × every subscribed pipeline × every message, where most
     * subscribers halt immediately and that is success (01 §5). A run someone started
     * by clicking happens once per click and keeps its full detail.
     */
    compactHaltReceipts?: boolean;
    /**
     * Debug mode in chat: run normally, then **halt at the pre-call substrate** instead of
     * invoking the Provider — after the input resolves and the payload is formed, so the
     * numbers shown are the numbers that would have been sent (src/preview.ts).
     *
     * `true` stops at the first Provider **on the spine**; pass `atNode` to override. The
     * preview costs whatever ran before it, including the embedding call inside the gather
     * block — a preview that skipped retrieval would show a context nobody would get.
     */
    preview?: boolean | {
        atNode?: string;
    };
    /** From connection metadata in core; injectable so the count is the real one. */
    countTokens?: (v: unknown) => number;
}
export declare function run(doc: SpecDocument, opts: RunOptions): Promise<Receipt>;
/** replay(receipt) — deterministic, never re-infers (F16). */
export declare function replay(doc: SpecDocument, receipt: Receipt, bindings: Bindings): Promise<Receipt>;
//# sourceMappingURL=executor.d.ts.map