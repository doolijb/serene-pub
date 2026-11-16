/**
 * 🚧 The pass that sets every lorebook's **Timeline** switch
 * (`lorebooks.timeline_enabled`) from what the book stores. Registered at boot
 * as the `timeline-switch` task, after `plugins` so plugin genres resolve.
 *
 * The rule: "off" is only a book with no `overlay_of`, not a starter kit
 * (`kind` 'starter_kit', primers included: never decided, left as they are),
 * nothing dated and no history entry, no clock, the default calendar, one
 * line (`holdsSomethingDated`), and no session reading it (`sessions.lorebook_id`)
 * or owning it (`lorebooks.session_id`), archived or not, whose genre keeps
 * story time or does not resolve (retired, plugin disabled or missing: the
 * book stays on). A session's notes over a lorebook copy that lorebook's value;
 * for notes that are the session's whole world the calendar they are born with
 * does not count as dated.
 *
 * A lorebook the pass switches off is marked (`TIMELINE_OFF_BY_PASS_KEY`), so
 * its Timeline card can say what happened and how to switch it back.
 *
 * Runs once and never again (boot marker, `startup/bootMarkers.ts`): a
 * person's later switch-off stands, and a lorebook that gains a dated row
 * later is not switched on by it. A fresh install has nothing to do.
 */
import { and, eq, isNull, ne, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { getGenre } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	holdsSomethingDated,
	TIMELINE_OFF_BY_PASS_KEY
} from "$lib/server/lorebooks/timeline"
import { genreCalendarOf } from "$lib/server/lorebooks/ownBook"

export async function settleTimelineSwitches(
	db: Db
): Promise<{ on: number; off: number; notesCopied: number }> {
	return db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const l = schema.lorebooks
		const books = await t
			.select({
				id: l.id,
				sessionId: l.sessionId,
				timelineEnabled: l.timelineEnabled,
				extraJson: l.extraJson
			})
			.from(l)
			.where(and(isNull(l.overlayOf), eq(l.kind, "book")))
		let on = 0
		let off = 0
		for (const book of books) {
			const defaultCalendar =
				book.sessionId === null
					? null
					: await genreCalendarOf(t, book.sessionId)
			const sessionGenres = await t
				.select({ genreId: schema.sessions.genreId })
				.from(schema.sessions)
				.where(
					or(
						eq(schema.sessions.lorebookId, book.id),
						book.sessionId === null
							? undefined
							: eq(schema.sessions.id, book.sessionId)
					)
				)
			const dated =
				sessionGenres.some((s) => {
					const genre = getGenre(s.genreId)
					return !genre || genre.keepsTime === "story"
				}) ||
				(await holdsSomethingDated(t, book.id, { defaultCalendar }))
			if (book.timelineEnabled !== dated)
				await t
					.update(l)
					.set({
						timelineEnabled: dated,
						// Switched off here: the book says so, for its Timeline card.
						...(dated
							? {}
							: {
									extraJson: {
										...(book.extraJson ?? {}),
										[TIMELINE_OFF_BY_PASS_KEY]: new Date().toISOString()
									}
								})
					})
					.where(eq(l.id, book.id))
			if (dated) on++
			else off++
		}
		const parent = alias(l, "parent")
		const copied = await t
			.update(l)
			.set({ timelineEnabled: sql`${parent.timelineEnabled}` })
			.from(parent)
			.where(
				and(
					eq(l.overlayOf, parent.id),
					ne(l.timelineEnabled, parent.timelineEnabled)
				)
			)
			.returning({ id: l.id })
		return { on, off, notesCopied: copied.length }
	})
}
