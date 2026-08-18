/**
 * Migration harness — converting an existing workflow into a pipeline without users
 * losing what they customised (08 §5, U25).
 *
 * The failure this exists to prevent is specific and it is not "the migration crashed."
 * A migration that runs cleanly and quietly changes what the model receives is far worse
 * than one that fails, because nobody finds out for weeks and the symptom — "the bot
 * feels different since the update" — is unfalsifiable.
 *
 * So the acceptance criterion is not "it ran." It is:
 *
 *   **for every fixture in the corpus, the legacy engine's prompt and the migrated
 *   pipeline's preview payload are byte-identical.**
 *
 * That is checkable because a preview run already produces the exact payload that would
 * be sent, from the same formatter and the same tokenizer as a real run (src/preview.ts).
 * The parity test is the preview, not a second renderer written for the occasion.
 */
import type { Receipt } from './receipt.js';
import type { SpecDocument } from './document.js';
/**
 * A migrated row's slug is derived from where it came from, not generated.
 *
 * This is what makes a migration **idempotent**: re-running after a bug fix matches the
 * existing row by slug and replaces it, instead of creating a second copy beside it
 * (12 §3b). A migration that cannot be safely re-run is a migration nobody dares fix.
 */
export declare function migratedSlug(sourceTable: string, sourceId: string | number): string;
export type MigrationOutcome = 'migrated' | 'unmapped' | 'skipped';
export interface MigrationEntry {
    source: {
        table: string;
        id: string | number;
        label?: string;
    };
    outcome: MigrationOutcome;
    /** Where the value landed: the scope it was written at, and what it became. */
    target?: {
        slug: string;
        scopeKind: 'instance' | 'preset' | 'user' | 'chat';
        nodeKey?: string;
        slot?: string;
    };
    /** Required whenever the outcome is not `migrated` — never a silent drop. */
    reason?: string;
}
export interface MigrationReport {
    unit: string;
    entries: MigrationEntry[];
    /** Fixture-level parity results; empty means nobody checked, which is not the same as passing. */
    parity: ParityResult[];
}
export declare function summarize(r: MigrationReport): {
    migrated: number;
    unmapped: number;
    skipped: number;
    parityChecked: number;
    parityFailed: number;
};
/**
 * Everything that did not migrate cleanly must say why, and must remain visible —
 * `spec_diagnostics` in core, the same place an orphaned slot lands after a node swap
 * (12 §5). Same principle as export (12 §7a): nothing is dropped silently.
 */
export declare function unmappedEntries(r: MigrationReport): MigrationEntry[];
export declare class MigrationError extends Error {
}
/** A report with an entry that gives no reason is a bug in the migration, not in the data. */
export declare function assertReportComplete(r: MigrationReport): void;
export interface ParityResult {
    fixture: string;
    identical: boolean;
    /** First divergence, with context — a diff of two multi-kilobyte prompts is unreadable. */
    firstDifferenceAt?: number;
    legacyExcerpt?: string;
    pipelineExcerpt?: string;
    tokensLegacy?: number;
    tokensPipeline?: number;
}
/**
 * Compare what the legacy engine produced against what the migrated pipeline *would*
 * send. The second argument is a **preview receipt** — the run stopped at the pre-call
 * substrate, so this compares the real payload rather than a reimplementation of it.
 */
export declare function checkParity(fixture: string, legacyPrompt: string, preview: Receipt, count?: (v: unknown) => number): ParityResult;
/**
 * The gate on dropping an old code path (08 §5). Deliberately strict: an empty corpus
 * passes nothing, because "no failures" and "nothing was checked" look identical in a
 * summary and only one of them is safe.
 */
export declare function parityGate(results: ParityResult[], minimumCorpus?: number): {
    pass: boolean;
    reason?: string;
};
export declare function renderParity(r: ParityResult): string;
/**
 * Rewrite a legacy `commit-message@1` node into `create-message@1` or
 * `update-message@1`.
 *
 * The old type decided new-vs-update at runtime from whether an id happened to be
 * present. Migrating it means recovering that decision from the document — and the
 * honest answer is that **it is recoverable in most specs and genuinely ambiguous in a
 * few**. A migration that guesses in the ambiguous case converts a spec that used to
 * update into one that creates, and the user finds out when their chat fills with
 * duplicates.
 *
 * So the rule is: an id wired in (by edge or by config) means update; nothing wired
 * means create; **anything else is reported unmapped rather than decided**. `unmapped`
 * is already the shape 08 §5b uses for "a human has to look at this."
 */
export declare const LEGACY_COMMIT_MESSAGE = "core:consumer/commit-message";
export interface SplitResult {
    document: SpecDocument;
    report: MigrationReport;
}
export declare function splitCommitMessage(doc: SpecDocument): SplitResult;
//# sourceMappingURL=migration.d.ts.map