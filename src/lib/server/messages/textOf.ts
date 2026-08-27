/**
 * The one projection (20 §3). Prompt-building, embeddings, the summarizer,
 * export, and search read message text through this and nothing else — twenty
 * call sites must not each invent which parts count.
 *
 * Defaults reproduce the legacy `content` byte-for-byte: `core:markdown` only,
 * active revision of each step, ordered by (step, ordinal). A single-step,
 * single-markdown message projects to exactly its markdown content — which is
 * what makes the migration's parity gate provable.
 */

export interface PartLike {
	step: number
	revision: number
	ordinal: number
	type: string
	content: string | null
}

export interface MessageLike {
	activeRevisions: Record<string, number>
	parts: PartLike[]
}

export interface TextOfOptions {
	/** Part types included, in the parts' own order. Default: markdown only. */
	types?: string[]
	/** Joiner between included parts and steps. */
	join?: string
}

export function textOf(message: MessageLike, opts: TextOfOptions = {}): string {
	const types = new Set(opts.types ?? ["core:markdown"])
	const join = opts.join ?? "\n\n"

	const steps = [...new Set(message.parts.map((p) => p.step))].sort(
		(a, b) => a - b
	)
	const pieces: string[] = []
	for (const step of steps) {
		const active = message.activeRevisions[String(step)] ?? 0
		const included = message.parts
			.filter(
				(p) =>
					p.step === step &&
					p.revision === active &&
					types.has(p.type)
			)
			.sort((a, b) => a.ordinal - b.ordinal)
		for (const p of included) pieces.push(p.content ?? "")
	}
	return pieces.join(join)
}
