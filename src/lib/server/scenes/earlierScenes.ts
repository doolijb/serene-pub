/**
 * 🚧 **Earlier in the story** — the scenes read for the reply prompt's
 * `core:var/earlier-scenes@1` block (names provisional).
 *
 * The rule: a reply's prompt gains one block holding the summaries of this
 * session's closed main-channel scenes any of whose lines are no longer in
 * the prompt, oldest first, each under its scene's name. A scene is eligible
 * only with a usable summary (`summaryStatus = 'done'`, a person's or the
 * routine's, not blank) that has not been compiled into a history entry
 * (`history_entry_id IS NULL`), and only when it is closed (a range scene) or
 * a tick selection. An open scene is never eligible. Which of them show —
 * those that lost a line to the cut, and fit the block's share of the
 * budget — is the fit's call (`transcriptFit.earlierScenesShown`); this read
 * only says which scenes could.
 *
 * Read-only, on the plain `db`. ⚠ Not `sceneSummaryDueOf` (the scene
 * summaries routine's look at which scene to summarize next), not
 * `scenesToSummarize` (*Summarize all*, a person's press), not the history
 * read (the compiled entries).
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { sceneStartOf } from "$lib/server/scenes/historyEntryOfDate"

/** 🚧 The most eligible scenes the read returns: the newest 200. */
export const EARLIER_SCENES_MOST = 200

export interface EarlierScene {
	sceneId: number
	/** The name as shown (`sceneDisplayNames`); "" when the scene has none. */
	name: string
	/** Trimmed. */
	summary: string
	/** Where the scene starts (`sceneStartOf`). */
	firstLineId: number
}

/** The session's eligible scenes, oldest first by start (ties by scene id), at most the newest {@link EARLIER_SCENES_MOST}. */
export async function earlierScenesOf(
	db: Db,
	sessionId: number
): Promise<EarlierScene[]> {
	const s = schema.scenes
	const candidates = await db
		.select({
			id: s.id,
			openedAtMessageId: s.openedAtMessageId,
			selectedMessageIds: s.selectedMessageIds
		})
		.from(s)
		.where(
			and(
				eq(s.sessionId, sessionId),
				eq(s.channel, "main"),
				eq(s.summaryStatus, "done"),
				isNull(s.historyEntryId),
				sql`btrim(coalesce(${s.summary}, '')) <> ''`,
				sql`(${isNotNull(s.closedAtMessageId)} OR (${isNull(s.openedAtMessageId)} AND coalesce(json_array_length(${s.selectedMessageIds}), 0) > 0))`
			)
		)
	const started = candidates
		.map((c) => ({ id: c.id, start: sceneStartOf(c) }))
		.filter((c): c is { id: number; start: number } => c.start != null)
		.sort((a, b) => a.start - b.start || a.id - b.id)
		.slice(-EARLIER_SCENES_MOST)
	if (!started.length) return []

	const rows = await db
		.select({
			id: s.id,
			sessionId: s.sessionId,
			channel: s.channel,
			name: s.name,
			nameIsDefault: s.nameIsDefault,
			openedAtMessageId: s.openedAtMessageId,
			selectedMessageIds: s.selectedMessageIds,
			summary: s.summary
		})
		.from(s)
		.where(
			inArray(
				s.id,
				started.map((c) => c.id)
			)
		)
	const { sceneDisplayNames } = await import("$lib/server/scenes/liveScenes")
	const names = await sceneDisplayNames(db, rows)
	const byId = new Map(rows.map((r) => [r.id, r]))
	return started.map((c) => ({
		sceneId: c.id,
		name: names.get(c.id) ?? "",
		summary: (byId.get(c.id)?.summary ?? "").trim(),
		firstLineId: c.start
	}))
}
