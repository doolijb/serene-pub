/**
 * 🚧 A scene's **summary status** around the review (PROPOSAL-live-scenes
 * §15 G8). `scenes:process` moves a scene `running` → `review` (or
 * `failed`); only **Apply** in the Scene summary window (`scenes:update`
 * carrying the summary) makes it `done`. A review that goes away unapplied —
 * discarded, dismissed from the Activity panel — puts back the status the
 * scene had before the run, as a cancel does; and a run or review the server
 * lost by stopping (the activity store is memory) is settled at boot.
 */
import { and, eq, inArray, notInArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/**
 * A review discarded unapplied: the scene takes back `statusBefore` — only
 * while it still reads `review`, so a boundary moved meanwhile (which set
 * `none`) or a save that landed first (`done`) is never overwritten.
 * Returns whether a row moved.
 */
export async function restoreDiscardedReview(
	db: Db,
	sceneId: number,
	statusBefore: schema.SceneSummaryStatus
): Promise<boolean> {
	// A status to restore is a settled one: never back to a run or a review.
	const to: schema.SceneSummaryStatus =
		statusBefore === "running" || statusBefore === "review" ? "none" : statusBefore
	const moved = await db
		.update(schema.scenes)
		.set({ summaryStatus: to })
		.where(and(eq(schema.scenes.id, sceneId), eq(schema.scenes.summaryStatus, "review")))
		.returning({ id: schema.scenes.id })
	return moved.length > 0
}

/**
 * At boot: a scene left `running` or `review` has no run and no review behind
 * it any more (both live in the activity store, in memory), so it would say
 * *Summarizing…* or *Ready to review* forever and *Summarize all* would skip
 * it. It goes back to `none` — summary text kept: what it was before the run
 * is not stored, and `none` over kept text reads *out of date* on a live
 * scene, which invites a re-run rather than hiding one. Scenes `keep` names
 * (a run this process is doing) are left alone. Returns how many moved.
 */
export async function reconcileDerelictSceneSummaries(
	db: Db,
	keep: readonly number[] = []
): Promise<number> {
	const where = and(
		inArray(schema.scenes.summaryStatus, ["running", "review"]),
		...(keep.length ? [notInArray(schema.scenes.id, [...keep])] : [])
	)
	const moved = await db
		.update(schema.scenes)
		.set({ summaryStatus: "none" })
		.where(where)
		.returning({ id: schema.scenes.id })
	return moved.length
}
