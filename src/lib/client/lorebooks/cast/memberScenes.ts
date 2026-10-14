/**
 * The scenes a cast member is in, for the Timeline tab of their page.
 *
 * A scene names who was there (`participantCharacters`, by binding id, which
 * is the cast member's own id) and carries no date of its own: it borrows the
 * date of the history entry it was compiled into, as it does on the Time lens
 * (`time/storyTime.ts`). The list reads oldest first by `compareDates`, never
 * the packed `dateValue`; a scene whose entry is undated or not on the line
 * reads after the dated ones, by id, rather than at a guessed place.
 *
 * Pure, and handed the line's scenes: the workspace already holds them
 * (`getBookData().scenes`), so the tab asks the server for nothing.
 */
import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"
import {
	sceneNote,
	type TimeEntryRow,
	type TimeSceneRow
} from "../time/storyTime"

export interface MemberScene {
	id: number
	/** The history entry the scene was compiled into: its address. */
	historyEntryId: number
	label: string
	/** The entry's date, or null when it has none. */
	date: StoryDate | null
	/** What the scene holds: its messages, or that it is not compiled yet. */
	note: string
	/** Dated after the moment being read, so not yet happened there. */
	later: boolean
}

export function memberScenes(input: {
	castId: number
	scenes: readonly TimeSceneRow[]
	/** The history entries that date the scenes. */
	entries: readonly TimeEntryRow[]
	/** The moment being read; absent is now, where nothing is later. */
	at?: StoryDate | null
}): MemberScene[] {
	const dates = new Map<number, StoryDate>()
	for (const row of input.entries)
		if (row.year != null)
			dates.set(row.id, {
				year: row.year,
				month: row.month ?? null,
				day: row.day ?? null
			})

	const out: MemberScene[] = []
	for (const scene of input.scenes) {
		if (!(scene.participantCharacters ?? []).includes(input.castId))
			continue
		const date = dates.get(scene.historyEntryId) ?? null
		out.push({
			id: scene.id,
			historyEntryId: scene.historyEntryId,
			label: (scene.name ?? "").trim() || "Unnamed Scene",
			date,
			note: sceneNote(scene),
			later: !!(input.at && date && compareDates(date, input.at) > 0)
		})
	}
	return out.sort((a, b) => {
		if (a.date && b.date) {
			const byDate = compareDates(a.date, b.date)
			if (byDate !== 0) return byDate
		} else if (a.date || b.date) return a.date ? -1 : 1
		return a.id - b.id
	})
}
