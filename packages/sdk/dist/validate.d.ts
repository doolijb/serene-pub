/**
 * Validation — the Fixed Ledger laws that can be checked statically.
 *
 * Every finding names what to do instead (15 §1.3). A prohibition without a stated
 * alternative is a bug, and there is a test asserting exactly that.
 */
import type { SpecDocument } from './document.js';
export interface Finding {
    law: string;
    severity: 'error' | 'warning';
    nodeKey?: string;
    message: string;
    /** What to do instead — required for every error. */
    fix: string;
}
export declare function validate(doc: SpecDocument): Finding[];
export declare function assertValid(doc: SpecDocument): void;
//# sourceMappingURL=validate.d.ts.map