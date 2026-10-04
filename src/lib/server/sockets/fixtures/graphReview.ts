/**
 * A graph build at review, for tests of `narrativeGraph:applyProposal`.
 *
 * An apply answers a build: the server reads its mode, what it read and the
 * proposal it made from the build's activity, and consumes that activity. So
 * a test leaves one exactly as `narrativeGraph:build` leaves it at review,
 * then applies against its id.
 */
import { activityStore } from "$lib/server/utils/activityStore"

export interface BuildAtReview {
	userId: number
	lorebookId: number
	mode: "replace" | "extend"
	/** The build's line — where apply writes. Default main. */
	branchId?: number | null
	proposal: Sockets.NarrativeGraph.GraphProposal
	/** What the build read — stamped graphed at apply. Default none. */
	processedSceneIds?: number[]
	processedHistoryEntryIds?: number[]
	seedNodeNames?: Record<string, string>
}

/** A build at review; returns its activity id. */
export function buildAtReview(review: BuildAtReview): string {
	const activityId = activityStore.start({
		userId: review.userId,
		lorebookId: review.lorebookId,
		lorebookLabel: "Test book",
		mode: review.mode,
		branchId: review.branchId ?? null
	})
	activityStore.update(activityId, {
		status: "review",
		proposal: review.proposal,
		sceneLabels: [],
		seedTempIdMap: {},
		seedNodeNames: review.seedNodeNames ?? {},
		processedSceneIds: review.processedSceneIds ?? [],
		processedHistoryEntryIds: review.processedHistoryEntryIds ?? []
	})
	return activityId
}

/**
 * The params an apply of `proposal` sends, with the build it answers put at
 * review first — for tests that hold a proposal and a mode and only need the apply
 * to run as the client's would, unedited.
 */
export function applyAtReview(
	userId: number,
	params: {
		lorebookId: number
		mode: "replace" | "extend"
		branchId?: number | null
		proposal: Sockets.NarrativeGraph.GraphProposal
		processedSceneIds?: number[]
		processedHistoryEntryIds?: number[]
	}
): Sockets.NarrativeGraph.ApplyProposal.Params {
	const activityId = buildAtReview({ userId, ...params })
	return {
		lorebookId: params.lorebookId,
		proposal: params.proposal,
		activityId
	} as Sockets.NarrativeGraph.ApplyProposal.Params
}
