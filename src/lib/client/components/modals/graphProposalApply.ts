/**
 * What GraphBuildModal sends when a reviewed graph proposal is applied.
 *
 * Pure, and the modal's ONLY way to build `narrativeGraph:applyProposal`'s
 * params, so the server's integration tests drive the handler with exactly
 * what the client sends (plan A21 — the old tests hand-built params carrying
 * `resolvedSceneCast`, which the modal never sent).
 */

/** A proposed new cast member, as the review holds it. */
export type EditableNode = Sockets.NarrativeGraph.NodeProposal & {
	_deleted?: boolean
}
/** A proposed relationship, as the review holds it. */
export type EditableRel = Sockets.NarrativeGraph.RelationshipProposal & {
	_deleted?: boolean
}
/** A proposed change to an existing member, as the review holds it. */
export type EditableNodeUpdate = Sockets.NarrativeGraph.NodeUpdateProposal & {
	_deleted?: boolean
}

/** The review's three lists, with what the person removed marked. */
export interface ReviewedProposal {
	nodes: EditableNode[]
	relationships: EditableRel[]
	updatedNodes: EditableNodeUpdate[]
}

/** The new characters the person removed, by tempId. */
export const removedNodeTempIds = (nodes: EditableNode[]): Set<string> =>
	new Set(nodes.filter((n) => n._deleted).map((n) => n.tempId))

/**
 * The removed new character a relationship names, if any — it goes with them.
 * A relationship to a character who will not exist cannot be applied, so
 * removing a character removes its relationships too, and restoring the
 * character brings back the ones the person had not removed themselves.
 */
export function removedWith(
	rel: Sockets.NarrativeGraph.RelationshipProposal,
	nodes: EditableNode[]
): EditableNode | undefined {
	return nodes.find(
		(n) =>
			n._deleted &&
			(n.tempId === rel.fromTempId || n.tempId === rel.toTempId)
	)
}

/** The relationships Apply will send: not removed, and not removed with a character. */
export function keptRelationships(review: ReviewedProposal): EditableRel[] {
	const removed = removedNodeTempIds(review.nodes)
	return review.relationships.filter(
		(r) =>
			!r._deleted && !removed.has(r.fromTempId) && !removed.has(r.toTempId)
	)
}

/**
 * The review's own id for each apply it sends. Random per page, so another
 * tab's apply — whose reply and refusal reach this tab too — never names one
 * of this tab's.
 */
const APPLY_ID_STEM = `graph-apply-${Math.random().toString(36).slice(2, 10)}-`
let appliesSent = 0

/** A fresh `requestId` for one apply. */
export const nextApplyRequestId = (): string =>
	`${APPLY_ID_STEM}${++appliesSent}`

/**
 * `narrativeGraph:applyProposal`'s params for a reviewed proposal.
 *
 * - `activityId` is the build being answered; the server reads the mode and
 *   everything else the client must not decide from it. There is no `mode`.
 * - `resolvedSceneCast` goes back as the build made it, less the characters
 *   the person removed: it is what saves each scene's cast (`castResolvedAt`)
 *   and what bounds how widely a new relationship is known.
 */
export function applyProposalParams(input: {
	lorebookId: number
	/** The parked build being reviewed, as Layout holds it. */
	build: Pick<GraphBuildState, "activityId" | "proposal">
	review: ReviewedProposal
	requestId: string
}): Sockets.NarrativeGraph.ApplyProposal.Params {
	const { build, review } = input
	if (!build.activityId)
		throw new Error("Only a build parked for review can be applied.")
	const removed = removedNodeTempIds(review.nodes)
	const kept = (tempIds: string[]) => tempIds.filter((t) => !removed.has(t))
	return {
		lorebookId: input.lorebookId,
		activityId: build.activityId,
		requestId: input.requestId,
		proposal: {
			nodes: review.nodes
				.filter((n) => !n._deleted)
				.map(({ _deleted, ...n }) => n),
			relationships: keptRelationships(review).map(
				({ _deleted, ...r }) => r
			),
			updatedNodes: review.updatedNodes
				.filter((u) => !u._deleted)
				.map(({ _deleted, ...u }) => u),
			resolvedSceneCast: (build.proposal?.resolvedSceneCast ?? []).map(
				(c) => ({
					...c,
					participantTempIds: kept(c.participantTempIds),
					mentionedTempIds: kept(c.mentionedTempIds)
				})
			)
		}
	}
}
