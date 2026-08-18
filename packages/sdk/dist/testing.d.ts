/**
 * `@serene-pub/sdk/testing` — the harness a **plugin author** runs (03 §9, U11).
 *
 * Distinct from `src/conformance.ts`, which is what **SP Core** runs against its own
 * executor. Two different audiences and two different questions:
 *
 *   conformance.ts — "does this host obey the laws?"
 *   testing.ts     — "does my hook behave, and did my change alter what gets sent?"
 *
 * The second question is the one that keeps a plugin working across SP releases, and it
 * is answered by goldens: record a receipt now, compare later, and see the diff rather
 * than a pass/fail. **"It still runs" is not the assertion anyone needs** — a plugin that
 * runs and quietly changes the prompt is the failure mode that reaches users.
 */
import type { Receipt } from './receipt.js';
import type { SpecDocument } from './document.js';
import type { Bindings, RunOptions } from './executor.js';
import type { Descriptor } from './descriptors.js';
export interface Golden {
    name: string;
    specId: string;
    specVersion: string;
    seed: string;
    outcome: Receipt['outcome'];
    haltReason?: string;
    /** Per node: what went in and what came out. Timings are excluded on purpose. */
    nodes: Array<{
        nodeKey: string;
        kind: string;
        result: string;
        input?: unknown;
        output?: unknown;
    }>;
    emitted: Array<{
        event: string;
        cause: string;
    }>;
    /** The payload a preview run would have sent, when there is one. */
    wire?: unknown;
}
/**
 * Reduce a receipt to what a golden should hold.
 *
 * Timings, run ids and wall-clock are all excluded — a golden that fails because a run
 * took 3ms instead of 2ms is a golden nobody keeps. What is kept is every decision and
 * every payload, which is what actually changes when a plugin's behaviour changes.
 */
export declare function toGolden(name: string, r: Receipt): Golden;
export interface GoldenDiff {
    path: string;
    before: unknown;
    after: unknown;
}
/** A structural diff, deepest-path-first, so the first line names the actual change. */
export declare function diffGolden(before: Golden, after: Golden): GoldenDiff[];
export declare function renderDiff(d: GoldenDiff[]): string;
export declare class GoldenMismatch extends Error {
    readonly name: string;
    readonly diff: GoldenDiff[];
    constructor(name: string, diff: GoldenDiff[]);
}
/** Record if absent, compare if present. The whole workflow in one call. */
export declare function checkGolden(name: string, r: Receipt, stored?: Golden): {
    golden: Golden;
    recorded: boolean;
};
export interface BindingProbe {
    id: string;
    title: string;
    consequence: string;
    check(hook: (input: any, ctx: any) => any, d: Descriptor, ctx: ProbeCtx): Promise<void> | void;
}
export interface ProbeCtx {
    sampleInput: unknown;
    /** A context object shaped like the one the executor injects for this kind. */
    makeCtx(over?: Record<string, unknown>): any;
}
/**
 * What a hook has to do to be a hook. Run these in your own tests — the executor assumes
 * all of it, and a hook that breaks one of them fails in a way that is hard to attribute.
 */
export declare const BINDING_PROBES: BindingProbe[];
export interface ProbeResult {
    id: string;
    title: string;
    pass: boolean;
    error?: string;
    consequence?: string;
}
export declare function probeBinding(hook: (input: any, ctx: any) => any, descriptor: Descriptor, ctx: ProbeCtx): Promise<ProbeResult[]>;
/** A context shaped like the executor's, per kind — so a probe tests the real surface. */
export declare const probeCtxFor: (kind: Descriptor["kind"], sampleInput?: unknown) => ProbeCtx;
/**
 * F26 as a one-liner an author can run: parallel and forced-sequential must produce the
 * same result. If your hook has a hidden ordering dependency, this is where it shows up
 * — not in a user's chat at 2am under load.
 */
export declare function assertEquivalent(doc: SpecDocument, opts: RunOptions): Promise<void>;
/** Run the same spec twice on one seed and assert nothing moved (F11). */
export declare function assertDeterministic(doc: SpecDocument, opts: RunOptions & {
    seed: string;
}): Promise<void>;
export declare function renderProbes(results: ProbeResult[]): string;
export type { Bindings };
//# sourceMappingURL=testing.d.ts.map