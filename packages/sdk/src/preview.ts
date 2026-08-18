/**
 * Preview runs — "show me what would be sent, and why" (debug mode in chat).
 *
 * A preview is **not a second estimator**. It is the ordinary run, stopping at the
 * pre-call substrate: input resolved, context assembled, payload formed, token count
 * taken — and then `halt` instead of `call`. That is the whole design constraint. Any
 * implementation that computes "what we would send" on a separate path drifts from what
 * actually gets sent, silently, and is most wrong exactly when someone is debugging
 * because something is off.
 *
 * Almost everything the panel shows is already in the receipt: Assemble records the
 * allocation it computed and the inputs it computed it from (16 §5a), and the Provider's
 * resolved input is recorded like any node's. The preview hoists those into one place so
 * a UI does not have to reassemble them from three node receipts, and adds the one thing
 * that only exists at the call site — the formed payload and its token count.
 */

import type { Receipt } from './receipt.js'

export interface PreviewBlock {
	id?: string
	sourceKey?: string
	tokens: number
	included: boolean
	weight?: number
	priority?: string
	/**
	 * Why this block is here, or isn't. The panel is only worth opening if this is
	 * populated, and it can only be populated if each stage leaves its trace on the
	 * item — the trigger Query records which key matched, the rank Task records the
	 * probability roll and the group it won or lost, Assemble records budget exhaustion.
	 */
	reason?: string
	/** The full trail, each stage's line in order (src/wire.ts `why`). */
	why?: string[]
	role?: string
}

export interface PreviewReport {
	/** Where the run stopped, and why that node. */
	atNode: string
	typeId: string
	targetedBy: 'first-provider-on-spine' | 'explicit'

	/** Metadata only — material never leaves core (F18). */
	connection?: { id?: string; kind?: string; contextLength?: number; tokenizer?: string }
	budget?: { maxContext?: number; reserved?: number; available?: number }

	/** The payload as it would have gone out, and the count that would have applied. */
	context: { rendered: unknown; tokens: number }
	/**
	 * How blocks became that payload (16 §7). Present once a Provider declares a `wire`
	 * slot — and it is what makes the scaffolding cost visible rather than a mystery
	 * gap between "my blocks add up to 3,000" and "it said 3,180".
	 */
	wire?: { format: string; blockTokens: number; overheadTokens: number }

	blocks: PreviewBlock[]
	totals: {
		blocks: number
		included: number
		dropped: number
		tokensIncluded: number
		tokensDropped: number
		/** Positive means the formed payload does not fit — the estimator was wrong. */
		overBudgetBy?: number
	}
	/** Whatever the node feeding the context port produced — Assemble's allocation record. */
	allocation?: unknown
}

/**
 * A stand-in tokenizer. The real one comes from connection metadata (`tokenizer`), is
 * loaded once per connection and reused — counting sixty blocks should be sixty cheap
 * calls against something already resident, not sixty model loads.
 */
export const roughTokens = (v: unknown): number => {
	const s = typeof v === 'string' ? v : JSON.stringify(v ?? '')
	return Math.ceil(s.length / 4)
}

/** Choose where a preview stops. */
export function previewTarget(
	nodes: Array<{ key: string; kind: string; blockId?: string; position: number }>,
	explicit?: string,
): { key: string; targetedBy: PreviewReport['targetedBy'] } | undefined {
	if (explicit) return { key: explicit, targetedBy: 'explicit' }
	// "The first Provider" needs one qualifier: in any retrieval pipeline the literally
	// first Provider is `embed`, which lives inside the gather block — stopping there
	// would preview a context that had not been retrieved yet. Spine-only is the rule
	// that means what people intend, and it is the same rule
	// `slot.downstreamProvider()` already resolves with (16 §5b-i).
	const spine = nodes
		.filter((n) => !n.blockId && n.kind === 'provider')
		.sort((a, b) => a.position - b.position)
	return spine[0] ? { key: spine[0].key, targetedBy: 'first-provider-on-spine' } : undefined
}

export function renderPreview(p: PreviewReport): string {
	const out: string[] = []
	out.push(`preview · stopped before ${p.atNode} (${p.typeId}) · ${p.targetedBy}`)
	if (p.connection) {
		out.push(
			`  connection ${p.connection.kind ?? '?'}` +
				(p.connection.contextLength ? ` · context ${p.connection.contextLength}` : '') +
				(p.connection.tokenizer ? ` · tokenizer ${p.connection.tokenizer}` : ''),
		)
	}
	if (p.budget) {
		out.push(`  budget: ${p.budget.available ?? '?'} available of ${p.budget.maxContext ?? '?'}`)
	}
	if (p.wire) {
		out.push(
			`  wire ${p.wire.format}: ${p.wire.blockTokens} block + ${p.wire.overheadTokens} scaffold`,
		)
	}
	out.push(
		`  would send ${p.context.tokens} tokens · ${p.totals.included}/${p.totals.blocks} blocks included` +
			(p.totals.overBudgetBy ? `  ⚠ OVER by ${p.totals.overBudgetBy}` : ''),
	)
	for (const b of p.blocks) {
		out.push(
			`   ${b.included ? '✓' : '✗'} ${(b.sourceKey ?? b.id ?? '?').padEnd(20)} ${String(b.tokens).padStart(6)} tok` +
				(b.reason ? `   ${b.reason}` : ''),
		)
		// The trail is the difference between a panel worth opening and a token counter.
		for (const w of b.why ?? []) out.push(`        · ${w}`)
	}
	return out.join('\n')
}

/** Convenience for a UI: the preview, if this receipt is one. */
export const previewOf = (r: Receipt): PreviewReport | undefined => r.preview
