/**
 * Receipts (01 §1, 02 §2). The first-class record of a run, and the thing the
 * whole design's explicability claim rests on.
 *
 * Deliberately absent: progress messages (F34, ephemeral) and raw embedding
 * vectors (16 §1a, recorded by reference).
 */
import { renderPreview } from './preview.js';
/** Render a receipt the way the run inspector would (17 §4). Used in tests as documentation. */
export function renderReceipt(r) {
    const out = [];
    out.push(`run ${r.runId}  spec ${r.specId} v${r.specVersion}   seed ${r.seed}`);
    out.push(`trigger ${r.triggerSource}${r.actorUserId ? ` · user ${r.actorUserId}` : ''}   ` +
        `${r.endedAt - r.startedAt} ms` +
        (r.queuedMs ? ` (+${r.queuedMs} ms queued, uncharged)` : '') +
        `   outcome ${r.outcome}` +
        (r.cancelledBy ? ` by ${r.cancelledBy}` : ''));
    if (r.compact) {
        out.push(` ▸ compact: halted at ${r.haltNodeKey ?? '?'} before any effectful node — ` +
            `${r.compactedNodeCount ?? 0} node row(s) dropped (13 §2)`);
        if (r.haltReason)
            out.push(`     reason: ${r.haltReason}`);
    }
    if (r.preview)
        out.push(renderPreview(r.preview));
    for (const n of r.nodes) {
        out.push(` ▸ ${n.nodeKey.padEnd(24)} ${n.kind.padEnd(9)} ${n.result.padEnd(9)} ${String(n.elapsedMs).padStart(5)} ms` +
            (n.blockMode ? `  [${n.blockMode}]` : ''));
        if (n.reason)
            out.push(`     reason: ${n.reason}`);
        for (const note of n.notes ?? [])
            out.push(`     ${note}`);
        if (n.samplingIgnored?.length)
            out.push(`     ignored samplers: ${n.samplingIgnored.join(', ')}`);
    }
    for (const rev of r.reviews ?? []) {
        if (rev.position === 'off')
            continue;
        out.push(` ▸ review ${rev.nodeKey}: ${rev.position} → ${rev.action}` +
            (rev.editedHash ? ` (edited ${rev.originalHash} → ${rev.editedHash})` : '') +
            (rev.by ? ` by ${rev.by}` : ''));
    }
    for (const note of r.notes ?? [])
        out.push(` ▸ ${note}`);
    for (const e of r.emitted) {
        out.push(` ▸ core emitted ${e.event} (cause: ${e.cause}) → ${e.subscribers} subscriber(s)`);
    }
    out.push(` consumption: ${r.consumption.tokens} tokens, ${r.consumption.nodeExecutions} node executions`);
    return out.join('\n');
}
//# sourceMappingURL=receipt.js.map