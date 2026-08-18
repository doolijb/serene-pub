/**
 * The conformance kit (03 §9).
 *
 * This is the artifact SP Core upgrades *against*. The rest of this package is a
 * reference implementation whose runtime half is placeholder — a real executor will have
 * durable gate parking, a persistent run queue, transactions and four transports, none of
 * which are here. What survives the port is **the contracts**, and a contract nobody can
 * execute is a document.
 *
 * So: core implements `HostUnderTest`, runs `conform(host)`, and gets a pass/fail per
 * requirement with the law it comes from. The SDK's own executor runs the same kit, which
 * is what keeps the kit honest — a requirement the reference implementation cannot pass is
 * a requirement stated wrong.
 *
 * Every check states **what would be broken if it failed**, because a red line saying
 * "F13" tells an implementer nothing about what to go and look at.
 */
import type { SpecDocument } from '@serene-pub/sdk';
import type { Finding } from '@serene-pub/sdk';
import type { Receipt } from '@serene-pub/sdk';
import type { Bindings, RunOptions } from '@serene-pub/sdk';
export interface HostUnderTest {
    name: string;
    validate(doc: SpecDocument): Finding[];
    run(doc: SpecDocument, opts: RunOptions): Promise<Receipt>;
    replay(doc: SpecDocument, receipt: Receipt, bindings: Bindings): Promise<Receipt>;
    /** Canonical form, for the round-trip law. */
    canonicalHash(doc: SpecDocument): string;
    importDocument(doc: SpecDocument): SpecDocument;
}
export interface Requirement {
    id: string;
    law: string;
    title: string;
    /** What breaks in the product if this is not true. Written for whoever sees it go red. */
    consequence: string;
    check(host: HostUnderTest, fx: Fixtures): Promise<void> | void;
}
/**
 * The kit does not build specs itself — core's builder and the SDK's are the same code,
 * but a host may want to feed documents it produced another way. Fixtures are injected.
 */
export interface Fixtures {
    /** A minimal chat turn: input → query → task → provider → write. */
    chatTurn(): SpecDocument;
    /** The same, with a Task that halts before anything effectful. */
    haltsEarly(): SpecDocument;
    /** An async block with three chains, for the equivalence law. */
    gather(): SpecDocument;
    /** A map with a declared max. */
    mapped(): SpecDocument;
    /** A loop with a predicate inside its body. */
    looped(max: number): SpecDocument;
    /** Documents that must be rejected, each paired with the law it violates. */
    invalid(): Array<{
        law: string;
        doc: SpecDocument;
        because: string;
    }>;
    bindings(over?: Bindings): Bindings;
    world: RunOptions['world'];
}
export declare class ConformanceError extends Error {
}
export declare const REQUIREMENTS: Requirement[];
export interface ConformanceResult {
    id: string;
    law: string;
    title: string;
    pass: boolean;
    error?: string;
    consequence?: string;
}
export declare function conform(host: HostUnderTest, fx: Fixtures): Promise<ConformanceResult[]>;
export declare function renderConformance(results: ConformanceResult[]): string;
//# sourceMappingURL=index.d.ts.map