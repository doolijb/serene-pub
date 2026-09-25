/**
 * The one sentence a create form says when some of the session's seeded
 * swaps were refused (A8): the session started, on those steps' defaults.
 * Null when nothing was refused.
 */
export function refusedSwapsSentence(
	res: Pick<Sockets.Sessions.Create.Response, "refusedSwaps">
): string | null {
	const refused = res.refusedSwaps ?? []
	if (!refused.length) return null
	// The step's own name, not its key path (`decide.rules.strategy` → Strategy).
	const step = (node: string) => {
		const last = node.split(".").pop() ?? node
		return last.charAt(0).toUpperCase() + last.slice(1).replace(/[-_]/g, " ")
	}
	const lines = refused.map((r) => `${step(r.node)}: ${r.reason}`)
	return `${refused.length === 1 ? "One setting" : `${refused.length} settings`} could not be applied, so ${
		refused.length === 1 ? "that step uses" : "those steps use"
	} the pipeline's default. ${lines.join(" · ")}`
}
