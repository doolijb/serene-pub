/**
 * The relationship lens's figures for one run — what was sent to the prompt,
 * how many ties were considered, the cap, and the tie type that filled it —
 * read from the run's relationship query diagnostics.
 *
 * Shared by the ranking store's writer (L1), which keeps them on each
 * ranking's `detail` at record time, so the authoring readouts never open a
 * receipt (R58).
 */

export interface RelationshipFigures {
	sent: number
	considered: number
	cap?: number
	cappedType?: string
}

/**
 * The tie type that filled the ceiling, where one plainly did.
 *
 * ⚠ **Only on a list of one type, and only when the cap bit.** The receipt
 * keeps the ties that were SENT and not the ones that were cut, so on a mixed
 * list naming a type would be a guess at which of them lost the room. When the
 * cap bit and everything through it carries one type, there is nothing to
 * guess: that type is what filled the ceiling.
 */
export function cappedTypeOf(
	node: any,
	figures: { sent: number; considered: number; cap?: number }
): string | undefined {
	const { sent, considered, cap } = figures
	if (cap === undefined || cap <= 0) return undefined
	if (sent !== cap || considered <= sent) return undefined
	const kept: any[] = Array.isArray(node?.output?.main)
		? node.output.main
		: []
	const types = new Set<string>()
	for (const candidate of kept) {
		const type = candidate?.payload?.entry?.type
		if (typeof type === "string" && type) types.add(type)
	}
	return types.size === 1 ? [...types][0] : undefined
}

/**
 * What the run did with the narrative graph, for the graph lens's ceiling line.
 *
 * ⚠ **Read off the relationship mechanism's own diagnostics, never counted from
 * the prompt.** `core:query/relationship-search@1` is the only node that walks
 * the graph AND records what it walked: its two siblings publish keyed sections
 * with no figures at all, and a count taken from the rendered sections would
 * have a numerator and no denominator. A run without it reports nothing here,
 * which is what keeps the line absent rather than wrong.
 *
 * `relationships` is that mechanism's own sentence and nothing else writes one,
 * so it is what identifies the node in a receipt's trail.
 */
export function relationshipsFromReceipt(
	receipt: any
): RelationshipFigures | undefined {
	const nodes: any[] = Array.isArray(receipt?.nodes) ? receipt.nodes : []
	for (const node of nodes) {
		const d = node?.output?.diagnostics
		if (!d || typeof d.relationships !== "string") continue
		if (typeof d.matched !== "number" || typeof d.considered !== "number")
			continue
		const figures = {
			sent: d.matched as number,
			considered: d.considered as number,
			cap: typeof d.maxEntries === "number" ? d.maxEntries : undefined
		}
		const cappedType = cappedTypeOf(node, figures)
		return {
			sent: figures.sent,
			considered: figures.considered,
			...(figures.cap !== undefined ? { cap: figures.cap } : {}),
			...(cappedType ? { cappedType } : {})
		}
	}
	return undefined
}

