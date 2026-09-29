/**
 * Story time, as arithmetic.
 *
 * The time lens draws one line and a lane for everybody standing on it, so
 * what sits where is a function of the rows rather than of the drawing: a
 * dated entry sits at its own date, a scene sits at the date of the entry it
 * was compiled into, and the session reading the book sits at now. Pure,
 * because "whose lane is this on" is a rule worth testing without a browser.
 *
 * ⚠ Dates are the only thing on the line. An amendment dated at a moment is
 * not built (see docs' amendments design), so a row's date is the row's own
 * and there is nothing to resolve as of anything.
 */

import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import {
	compareDates,
	dateValue,
	formatDate,
	type StoryDate
} from "../sections/historyDates"

/** What one thing on the line is. */
export type TimeItemKind = "history" | "scene" | "world" | "session"

export interface TimeItem {
	/** The pool's key, so a click here addresses the same row the pool does. */
	key: string
	id: number
	kind: TimeItemKind
	/** What the row is called on the line. */
	label: string
	/** Where it sits, or null for the session, which sits at now. */
	date: StoryDate | null
	/**
	 * The date as the axis's own unit, or null at now. PLACEMENT ONLY — the
	 * line is ordered by `date` through `compareDates`, never by this.
	 */
	value: number | null
	/** What it reads under its kind: a scene's messages, and so on. */
	note: string
	/** The cast present in it, by binding id, first appearance first. */
	present: number[]
}

/** An entry as the wire sends it. Only history carries date fields today. */
export interface TimeEntryRow {
	id: number
	typeId?: string | null
	name?: string | null
	content?: string | null
	year?: number | null
	month?: number | null
	day?: number | null
}

export interface TimeSceneRow {
	id: number
	historyEntryId: number
	name?: string | null
	summary?: string | null
	selectedMessageIds?: number[] | null
	participantCharacters?: number[] | null
}

/** The session reading this book, which stands at now. */
export interface TimeSessionRow {
	id: number
	name: string
}

export interface StoryTimeInput {
	entries: readonly TimeEntryRow[]
	scenes: readonly TimeSceneRow[]
	session?: TimeSessionRow | null
}

/** Whether a row carries a date at all. */
export function isDated(row: TimeEntryRow): boolean {
	return row.year != null
}

/** Whether a row's kind has date fields to write. */
export function isDatable(row: TimeEntryRow): boolean {
	return row.typeId === HISTORY_TYPE_ID
}

/** What dropping a row onto the line can do with it. */
export function dropOffer(row: TimeEntryRow): "date" | "history-about" {
	return isDatable(row) ? "date" : "history-about"
}

/** The first line of what is written in a row, as its heading. */
function firstLine(text: string | null | undefined): string {
	for (const line of (text ?? "").split("\n")) {
		const trimmed = line.trim()
		if (trimmed) return trimmed
	}
	return ""
}

/**
 * What a dated entry reads as on the line.
 *
 * History declares no title role, so its heading everywhere else is its date —
 * which the line already draws as a position. What is left to say is what
 * happened, and the date is the fallback for an entry with nothing in it yet.
 */
export function entryLabel(row: TimeEntryRow): string {
	return (
		(row.name ?? "").trim() ||
		firstLine(row.content) ||
		formatDate(row as StoryDate)
	)
}

/** What a scene reads under its name: how much of a session it holds. */
export function sceneNote(scene: TimeSceneRow): string {
	if (!scene.summary?.trim()) return "not yet compiled"
	const count = scene.selectedMessageIds?.length ?? 0
	return count ? `${count} message${count === 1 ? "" : "s"}` : ""
}

const dateOf = (row: TimeEntryRow): StoryDate => ({
	year: row.year as number,
	month: row.month ?? null,
	day: row.day ?? null
})

/**
 * The order the line reads in: oldest first, and now last.
 *
 * ⚠ By `compareDates`, never the packed `value`: that collides once a month
 * or a day passes 100 (a book numbering days of the year) and would put
 * day 150 of Year 1 after Year 2.
 */
function compareItems(a: TimeItem, b: TimeItem): number {
	if (a.date === null || b.date === null)
		return (a.date === null ? 1 : 0) - (b.date === null ? 1 : 0)
	const byDate = compareDates(a.date, b.date)
	if (byDate !== 0) return byDate
	// An entry stands before the scenes it was compiled from: the entry is
	// what the date belongs to, and the scenes hang off it.
	const rank = (item: TimeItem) => (item.kind === "scene" ? 1 : 0)
	if (rank(a) !== rank(b)) return rank(a) - rank(b)
	return a.id - b.id
}

/**
 * Everything that sits on the line, oldest first.
 *
 * A scene carries no date of its own, so it borrows the one of the entry it
 * was compiled into; a scene whose entry is gone or undated has no position at
 * all and is left off rather than drawn at a guess.
 */
export function storyItems(input: StoryTimeInput): TimeItem[] {
	const dated = input.entries.filter(isDated)
	const byId = new Map(dated.map((row) => [row.id, row]))

	const scenesOf = new Map<number, TimeSceneRow[]>()
	for (const scene of input.scenes) {
		if (!byId.has(scene.historyEntryId)) continue
		const list = scenesOf.get(scene.historyEntryId) ?? []
		list.push(scene)
		scenesOf.set(scene.historyEntryId, list)
	}

	const items: TimeItem[] = []
	for (const row of dated) {
		const present: number[] = []
		for (const scene of scenesOf.get(row.id) ?? [])
			for (const id of scene.participantCharacters ?? [])
				if (!present.includes(id)) present.push(id)
		items.push({
			key: `entry#${row.id}`,
			id: row.id,
			kind: row.typeId === HISTORY_TYPE_ID ? "history" : "world",
			label: entryLabel(row),
			date: dateOf(row),
			value: dateValue(dateOf(row)),
			note: "",
			present
		})
	}

	for (const scene of input.scenes) {
		const entry = byId.get(scene.historyEntryId)
		if (!entry) continue
		items.push({
			key: `scene#${scene.id}`,
			id: scene.id,
			kind: "scene",
			label: (scene.name ?? "").trim() || "Unnamed Scene",
			date: dateOf(entry),
			value: dateValue(dateOf(entry)),
			note: sceneNote(scene),
			present: [...(scene.participantCharacters ?? [])]
		})
	}

	if (input.session)
		items.push({
			key: `session#${input.session.id}`,
			id: input.session.id,
			kind: "session",
			label: input.session.name,
			date: null,
			value: null,
			note: "reading now",
			present: []
		})

	return items.sort(compareItems)
}

export type LaneKind = "story" | "cast" | "world"

export interface TimeLane {
	id: string
	label: string
	kind: LaneKind
	items: TimeItem[]
}

export interface LaneCastMember {
	id: number
	name: string
}

/**
 * The lanes, in the order they are read.
 *
 * The story's own lane first, then one per cast member the line names, then
 * the World. A member nothing dated names gets no lane — a lane is a claim
 * that somebody was there, and an empty one about a person says they were
 * absent, which is a fact the book does not hold. The World lane stands even
 * while it is empty, because it is a place rather than a person: what it draws
 * is a dated entry of a kind other than history, and nothing writes one yet.
 */
export function buildLanes(
	items: readonly TimeItem[],
	cast: readonly LaneCastMember[]
): TimeLane[] {
	const story: TimeLane = {
		id: "story",
		label: "Story",
		kind: "story",
		items: items.filter((i) => i.kind !== "world")
	}
	const world: TimeLane = {
		id: "world",
		label: "World",
		kind: "world",
		items: items.filter((i) => i.kind === "world")
	}
	const castLanes = cast
		.map<TimeLane>((member) => ({
			id: `cast#${member.id}`,
			label: member.name,
			kind: "cast",
			items: items.filter((i) => i.present.includes(member.id))
		}))
		.filter((lane) => lane.items.length > 0)
		.sort((a, b) => {
			// Earliest first appearance first, by the calendar; an undated
			// first item (the session, at now) sorts last.
			const da = a.items[0].date
			const db = b.items[0].date
			if (da === null || db === null)
				return (
					(da === null ? 1 : 0) - (db === null ? 1 : 0) ||
					a.label.localeCompare(b.label)
				)
			return compareDates(da, db) || a.label.localeCompare(b.label)
		})
	return [story, ...castLanes, world]
}

/**
 * The first dated thing naming each cast member, by binding id.
 *
 * Their arrival, as far as the book records one. A member named only by
 * something undated has no arrival here at all, which is the difference
 * between "arrives later" and "the book does not say".
 */
export function castArrivals(items: readonly TimeItem[]): Map<number, number> {
	// ⚠ The earliest by `compareDates`, whatever order the items come in —
	// the map's value is the arrival's placement on the axis, never the key
	// it was chosen by.
	const first = new Map<number, TimeItem>()
	for (const item of items) {
		if (item.date == null || item.value == null) continue
		for (const id of item.present) {
			const was = first.get(id)
			if (!was || compareDates(item.date, was.date!) < 0)
				first.set(id, item)
		}
	}
	return new Map([...first].map(([id, item]) => [id, item.value!]))
}

/** The entries carrying no date, in the order the pool holds them. */
export function undatedEntries(
	entries: readonly TimeEntryRow[]
): TimeEntryRow[] {
	return entries.filter((row) => !isDated(row))
}

/** The undated list said out loud, with what can be done about it. */
export function undatedLine(count: number): string {
	if (count === 1)
		return "1 entry carries no date, drag it onto the line, or leave it timeless"
	return `${count} entries carry no date, drag one onto the line, or leave it timeless`
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

/**
 * The line said out loud: what is on it, and what is missing from it.
 *
 * A book with no gaps says nothing about gaps: a clause reading "0 gaps" is a
 * figure about an absence nobody asked for.
 */
export function timeHeaderLine(counts: {
	dated: number
	scenes: number
	gaps: number
}): string {
	const parts = [
		plural(counts.dated, "dated entry", "dated entries"),
		plural(counts.scenes, "scene", "scenes")
	]
	if (counts.gaps > 0) parts.push(plural(counts.gaps, "gap", "gaps"))
	return parts.join(" · ")
}

/**
 * Where a dated entry stands in what the newest run read in.
 *
 * The rank is over the dated entries alone, because that is the set the line
 * draws; rank one is the most recent thing that had happened by now, which is
 * the reason it was reached rather than a score.
 */
export function readInLine(rank: number, total: number): string {
	const line = `Read in · rank ${rank} of ${plural(total, "dated entry", "dated entries")}`
	return rank === 1 ? `${line} · most recent before now` : line
}
