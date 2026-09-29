/**
 * 🚧 `decide-proposal` (core only): accept or reject one state proposal
 * through the page's state store. A missing `accept` rejects.
 */

/** What this answer needs of the page's state store. */
export interface DecideProposalDeps {
	decide(proposalId: number, accept: boolean): void
}

/** Answer one `decide-proposal`. */
export function answerDecideProposal(params: unknown, deps: DecideProposalDeps): void {
	const p = params as Record<string, unknown>
	deps.decide(Number(p.proposalId), !!p.accept)
}
