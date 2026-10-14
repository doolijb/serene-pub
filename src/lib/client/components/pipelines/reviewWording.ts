/**
 * What the two "a run is waiting for you" dialogs say first, in plain words
 * (PLAN-less-confusing D3, 2026-10-11): the review modal
 * (`PipelineReviewModal`) and the cap pause (`CapPauseDialog`).
 *
 * Neither opens on the machinery ("Generate image · Chat · step 'render':
 * This step's write", "These pipelines keep setting each other off"); that
 * line sits under Details. Both are mounted globally, so a member reads them too. The plain line says what is about to happen and what
 * each button does; the technical line moves into a **Details** disclosure
 * beneath it, unchanged, for whoever wants the pipeline and the step.
 *
 * Pure, so the wording is tested without a DOM.
 */

/** The half of a pending review this reads (`Sockets.Pipelines.PendingReview`). */
export interface ReviewWordingInput {
	definitionId: string
	values?: Record<string, unknown>
}

/**
 * One sentence: what the paused step is about to do, and what Approve does.
 * Keyed on the node definition, version stripped; a definition this does not
 * know gets the general sentence, never the step's internal name.
 */
export function reviewPlainLine(review: ReviewWordingInput): string {
	const bare = review.definitionId.replace(/@\d+$/, "")
	switch (bare) {
		case "core:oracle/generate-image":
			return "The AI wants to generate an image. Approve to make it, or change the prompt first."
		case "core:outlet/create-message":
			// The reply's placeholder (`generating`): parked before the model
			// has written a word, so there is nothing to change yet.
			return review.values?.generating === true
				? "The AI is about to start a reply. Approve to let it write."
				: "The AI wants to post a new message. Approve to post it, or change it first."
		case "core:outlet/update-message":
			return "The AI wants to save its finished message. Approve to save it, or change it first."
		case "core:outlet/attach-image":
			return "The AI wants to attach an image to a message. Approve to attach it, or change it first."
	}
	return "The AI paused before acting, for you to check. Approve to let it continue, or change what it will use first."
}

/**
 * The cap pause's sentence: how many runs wait to start, and what each button
 * does. `waiting` is the pause's count of runs held at the cap; anything below
 * one is read as one, since a pause always holds the run that reached it.
 */
export function capPauseLine(waiting: number): string {
	const n = Math.max(1, Math.floor(waiting) || 1)
	const requests = n === 1 ? "1 more request" : `${n} more requests`
	const them = n === 1 ? "it" : "them"
	return `The AI is about to make ${requests} in a chain. Continue lets ${them} run; Stop here keeps what is done.`
}
