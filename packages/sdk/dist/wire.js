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
export const isAllocatedContext = (v) => !!v && typeof v === 'object' && Array.isArray(v.blocks);
export const included = (c) => c.blocks.filter((b) => b.included);
const formats = new Map();
export function defineWireFormat(w) {
    if (formats.has(w.id))
        throw new Error(`duplicate wire format id: ${w.id}`);
    formats.set(w.id, w);
    return w;
}
export const getWireFormat = (id) => formats.get(id);
export const allWireFormats = () => [...formats.values()];
export function _clearWireFormats() {
    formats.clear();
}
export function formatWith(id, ctx, opts) {
    const w = formats.get(id);
    if (!w) {
        throw new Error(`no wire format registered for '${id}'. Available: ${allWireFormats().map((x) => x.id).join(', ') || 'none'}. ` +
            `A wire format ships with the adapter that declares it — this usually means the connection's plugin is disabled.`);
    }
    return w.format(ctx, opts);
}
// ── Core formats ────────────────────────────────────────────────────────────
const roleFor = (b) => (b.role === 'note' ? 'system' : b.role);
/** Chat completion: the role-tagged array. */
export const messages = defineWireFormat({
    id: 'core:wire/messages@1',
    label: 'Chat completion (messages array)',
    format: (ctx) => included(ctx).map((b) => ({ role: roleFor(b), content: b.rendered })),
    // Per message: the role key, the content key and JSON punctuation. Declared, not guessed.
    overhead: (ctx) => included(ctx).length * 4 + 2,
});
/** Text completion, ChatML sequences. */
export const chatml = defineWireFormat({
    id: 'core:wire/chatml@1',
    label: 'Text completion (ChatML)',
    format: (ctx) => included(ctx)
        .map((b) => `<|im_start|>${roleFor(b)}\n${b.rendered}<|im_end|>`)
        .join('\n') + '\n<|im_start|>assistant\n',
    overhead: (ctx, count) => included(ctx).length * count('<|im_start|>assistant\n<|im_end|>\n') + count('<|im_start|>assistant\n'),
});
/** Text completion, Alpaca-style. */
export const alpaca = defineWireFormat({
    id: 'core:wire/alpaca@1',
    label: 'Text completion (Alpaca)',
    format: (ctx) => {
        const b = included(ctx);
        const sys = b.filter((x) => roleFor(x) === 'system').map((x) => x.rendered);
        const rest = b.filter((x) => roleFor(x) !== 'system').map((x) => x.rendered);
        return [...sys, '### Instruction:', ...rest, '### Response:'].join('\n\n');
    },
    overhead: (_ctx, count) => count('### Instruction:\n\n### Response:\n\n'),
});
/** Everything joined, no scaffolding. The reference implementation of zero overhead. */
export const plainWire = defineWireFormat({
    id: 'core:wire/plain@1',
    label: 'Plain concatenation',
    format: (ctx) => included(ctx).map((b) => b.rendered).join('\n'),
    overhead: (ctx, count) => Math.max(0, included(ctx).length - 1) * count('\n'),
});
/**
 * Prompt **fields**, for a Provider that plugs values into a workflow rather than sending
 * prose — image generation being the case that exposed the whole problem.
 */
export const fields = defineWireFormat({
    id: 'core:wire/fields@1',
    label: 'Prompt fields (positive / negative)',
    format: (ctx) => {
        const b = included(ctx);
        return {
            positive: b.filter((x) => x.role !== 'note').map((x) => x.rendered).join(', '),
            negative: b.filter((x) => x.role === 'note').map((x) => x.rendered).join(', '),
        };
    },
    overhead: (ctx, count) => Math.max(0, included(ctx).length - 1) * count(', '),
});
/**
 * Format once and measure once, at the pre-call substrate.
 *
 * The allocation loop must never re-render or re-count: count each block at render time,
 * allocate over integers, format exactly once. Anything else has a performance cliff at
 * precisely the moment a user's context is biggest.
 */
export function measureWire(formatId, ctx, count, available, opts) {
    const w = formats.get(formatId);
    if (!w)
        throw new Error(`no wire format registered for '${formatId}'`);
    const payload = w.format(ctx, opts);
    const blockTokens = included(ctx).reduce((n, b) => n + b.tokens, 0);
    const overheadTokens = w.overhead(ctx, count);
    const tokens = blockTokens + overheadTokens;
    return {
        format: formatId,
        payload,
        tokens,
        blockTokens,
        overheadTokens,
        overBudgetBy: typeof available === 'number' && tokens > available ? tokens - available : undefined,
    };
}
//# sourceMappingURL=wire.js.map