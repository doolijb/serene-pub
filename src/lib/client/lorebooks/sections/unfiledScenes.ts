import { compareDates, type StoryDate } from "./historyDates"
import { dayOnly } from "$lib/shared/lorebooks/storyDate"
import type { PoolSource } from "./types"

/**
 * The day a scene belongs to, for *Not yet compiled* — the story clock it was
 * opened at, hour and minute dropped; a day without a month is dropped too, so
 * a Day-count clock with no month dates by its year. None without a clock.
 *
 * It reads the day through the one `dayOnly`
 * (`$lib/shared/lorebooks/storyDate.ts`) that the compile files by.
 */
export function sceneDayOf(scene: PoolSource): StoryDate | null {
	const year = scene.openedStoryClockYear
	if (year == null) return null
	return dayOnly({
		year,
		month: scene.openedStoryClockMonth ?? null,
		day: scene.openedStoryClockDay ?? null
	})
}

export interface UnfiledDay {
	/** Stable per day; `undated` for the scenes with no clock. */
	key: string
	/** null = *Undated*. */
	date: StoryDate | null
	scenes: PoolSource[]
}

/**
 * The line's scenes not yet compiled, grouped by day in story order, the
 * Undated group last, scenes in id order. Only scenes of the line's OWN
 * (`branchId`, null for main) are listed: the compile files a scene by the
 * entry of its own line, so a fork's group is the fork's.
 */
export function unfiledScenesByDay(
	scenes: readonly PoolSource[],
	branchId: number | null
): UnfiledDay[] {
	const days = new Map<string, UnfiledDay>()
	const own = scenes
		.filter(
			(s) => s.historyEntryId == null && (s.branchId ?? null) === branchId
		)
		.sort((a, b) => a.id - b.id)
	for (const scene of own) {
		const date = sceneDayOf(scene)
		const key = date
			? `${date.year}-${date.month ?? ""}-${date.day ?? ""}`
			: "undated"
		const day = days.get(key) ?? { key, date, scenes: [] }
		day.scenes.push(scene)
		days.set(key, day)
	}
	return [...days.values()].sort((a, b) =>
		a.date && b.date
			? compareDates(a.date, b.date)
			: a.date
				? -1
				: b.date
					? 1
					: 0
	)
}
