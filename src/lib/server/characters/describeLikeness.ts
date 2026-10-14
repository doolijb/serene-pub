/**
 * 🚧 **Describe from image** — the Likeness tab's helper, server side
 * (DESIGN-image-generation §5; follow-up D1, 2026-10-12).
 *
 * Runs `core:spec/describe-likeness` as a card action: the card's likeness
 * image (else its avatar) is shown to the model the pub reads pictures with
 * (the `text+image->text` job), asked the **Describe a likeness** row's
 * question, and its answer cleaned to one tag line. Nothing is written: the
 * line goes back to the tab, which fills the **Likeness prompt** field, and
 * the person saves it with the rest of the form, or not.
 *
 * Who may press it (the card's owner or an admin) is the caller's to check.
 */

import { DESCRIBE_LIKENESS_NODES, DESCRIBE_LIKENESS_SPEC_ID } from "@serene-pub/core-catalog"
import { capabilityIsSetUp } from "$lib/server/connections/capabilityTarget"
import { DESCRIBE_IMAGE_CAPABILITY } from "$lib/server/pipelines/runtime/describeImage"

export class DescribeLikenessError extends Error {}

/**
 * Whether *Describe from image* can run at all: a model that reads pictures
 * is set up (the `text+image->text` job has a default pair). The tab shows
 * the button only then.
 */
export async function describeLikenessAvailable(db: Db): Promise<boolean> {
	return capabilityIsSetUp(db, DESCRIBE_IMAGE_CAPABILITY)
}

/**
 * Run it and return the cleaned tag line. Throws `DescribeLikenessError`
 * with a sentence a person can act on when the run does not finish.
 */
export async function describeLikeness(
	db: Db,
	req: {
		characterId: number
		userId: number
		/**
		 * The likeness image the form shows, unsaved: one of the card's own
		 * pictures, or `null` for its avatar. Absent: what is stored.
		 */
		imageMediaId?: number | null
		runId?: string
		signal?: AbortSignal
		cancelSignal?: () => { by: string; reason: string } | undefined
	}
): Promise<string> {
	if (!(await describeLikenessAvailable(db)))
		throw new DescribeLikenessError(
			"No model that reads pictures is set up, so there is nothing to describe the image with."
		)
	const { runCardAction } = await import("$lib/server/pipelines/runtime/cardAction")
	const { haltExplanation } = await import(
		"$lib/server/pipelines/runtime/haltExplanation"
	)
	const receipt = await runCardAction({
		db,
		specId: DESCRIBE_LIKENESS_SPEC_ID,
		characterId: req.characterId,
		userId: req.userId,
		fields:
			req.imageMediaId === undefined
				? {}
				: { likenessImageMediaId: req.imageMediaId },
		runId: req.runId,
		signal: req.signal,
		cancelSignal: req.cancelSignal
	})
	if (receipt.outcome !== "ok")
		throw new DescribeLikenessError(
			haltExplanation(receipt) ?? "The description stopped before it finished."
		)
	const out = (receipt.nodes.find(
		(n) => n.nodeKey === DESCRIBE_LIKENESS_NODES.clean && n.result === "ok"
	)?.output ?? {}) as { prompt?: unknown }
	const prompt = typeof out.prompt === "string" ? out.prompt.trim() : ""
	if (!prompt)
		throw new DescribeLikenessError("The model wrote nothing about the picture.")
	return prompt
}
