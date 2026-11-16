/**
 * A cast member's versions as the rail draws them: the arithmetic the member
 * page's rail and its saves call. Nothing here draws or sends anything.
 *
 * A cast version is a whole profile (`character_versions`). The order and the
 * one "in force" are the server reader's (`versionInForce`), never re-derived:
 * date, the nearer line, the higher life point, the higher write order, id.
 * Several versions at one date are several nodes, each its own.
 */
import {
	rowReadsOnLine,
	versionInForce,
	type Line,
	type LineCastVersion
} from "$lib/shared/lorebooks/lineReading"
import { compareDates, type StoryDate } from "../sections/historyDates"
import { castFieldWord } from "./castSave"
import type { RailVersion } from "../time/entryVersions"

type CastRow = Sockets.Amendments.CastRow

/** 🚧 One cast version on the rail: the base (*From the beginning*) or a dated one. */
export interface CastVersion extends RailVersion {
	/** The cast version's id; null only for a member with no base. */
	versionId: number | null
	/** Its Changes row; null for the base. */
	row: CastRow | null
	personalPosition: number | null
}

/** 🚧 A version on a line the reading does not read. */
export type CastElsewhere = CastRow & { locked: boolean; chip: string | null }

function dateOfRow(row: CastRow): StoryDate {
	return { year: row.year, month: row.month ?? null, day: row.day ?? null }
}

function asLineVersion(row: CastRow): CastRow & LineCastVersion {
	return { ...row, retiredOrder: null, sourceMessageId: null }
}

/** 🚧 Words beside a version's date: its session and its life point. */
export function castVersionChip(row: CastRow): string {
	const parts: string[] = []
	if (row.sourceSessionId != null)
		parts.push(
			row.sourceSessionName
				? `written in ${row.sourceSessionName}`
				: "written in a session"
		)
	if (row.personalPosition != null)
		parts.push(`at ${row.personalPosition} in their life`)
	else if (parts.length === 0) parts.push("at every point in their life")
	return parts.join(" · ")
}

/** Oldest first by date, write order, id. */
function byDateThenOrder(a: CastRow, b: CastRow): number {
	return (
		compareDates(dateOfRow(a), dateOfRow(b)) ||
		a.writeOrder - b.writeOrder ||
		a.id - b.id
	)
}

/**
 * The rail: the base, then each version the line reads by date, several at one
 * date in the reader's order (the last is the one the lorebook reads there).
 * `elsewhere` is every version the line does not read, by date, write order, id.
 */
export function castVersions(args: {
	baseVersionId: number | null
	rows: readonly CastRow[]
	line: Line
}): { versions: CastVersion[]; elsewhere: CastElsewhere[] } {
	const { baseVersionId, rows, line } = args
	const versions: CastVersion[] = [
		{
			key: "beginning",
			kind: "beginning",
			date: null,
			branchId: null,
			own: line.branchId === null,
			changes: [],
			movable: false,
			editIds: baseVersionId != null ? [baseVersionId] : [],
			versionId: baseVersionId,
			row: null,
			personalPosition: null
		}
	]
	const read = rows
		.filter((row) => rowReadsOnLine(row, line, dateOfRow(row), null))
		.sort(byDateThenOrder)
	const elsewhere: CastElsewhere[] = rows
		.filter((row) => !rowReadsOnLine(row, line, dateOfRow(row), null))
		.sort(byDateThenOrder)
		.map((row) => ({
			...row,
			locked: row.sourceSessionId != null,
			chip:
				row.sourceSessionId != null || row.personalPosition != null
					? castVersionChip(row)
					: null
		}))

	for (let i = 0; i < read.length; ) {
		let j = i + 1
		while (
			j < read.length &&
			compareDates(dateOfRow(read[j]), dateOfRow(read[i])) === 0
		)
			j++
		const group = read.slice(i, j)
		i = j
		const date = dateOfRow(group[0])
		// Lowest first: the reader's winner is taken off the end, repeatedly.
		const ordered: CastRow[] = []
		let rest = group.map(asLineVersion)
		for (;;) {
			const winner = versionInForce(rest, line, date, null)
			if (!winner) break
			ordered.unshift(group.find((r) => r.id === winner.id)!)
			rest = rest.filter((r) => r.id !== winner.id)
		}
		// Rows a session cut hides from the reader sit below the rest.
		ordered.unshift(...group.filter((r) => rest.some((x) => x.id === r.id)))
		for (const row of ordered) {
			const locked = row.sourceSessionId != null
			const own = row.branchId === line.branchId
			const several = ordered.length > 1
			versions.push({
				key: `v:${row.id}`,
				kind: "dated",
				date,
				branchId: row.branchId,
				own,
				changes: Object.keys(row.fields),
				movable: own && !locked,
				editIds: [row.id],
				locked,
				versionId: row.id,
				row,
				personalPosition: row.personalPosition,
				chip: several ? castVersionChip(row) : null,
				...(several && row === ordered[ordered.length - 1]
					? { readHere: true }
					: {})
			})
		}
	}
	return { versions, elsewhere }
}

/** The node the reading takes at a moment, or at now. */
export function castVersionAt(args: {
	versions: CastVersion[]
	rows: readonly CastRow[]
	line: Line
	moment: StoryDate | null
	shownVersionId: number | null
}): CastVersion {
	const { versions, rows, line, moment, shownVersionId } = args
	const base = versions[0]
	const nodeOf = (row: CastRow | null): CastVersion | null =>
		row ? (versions.find((v) => v.row?.id === row.id) ?? null) : null
	const inForce = (at: StoryDate | null): CastVersion =>
		nodeOf(versionInForce(rows.map(asLineVersion), line, at, null)) ?? base
	if (moment) return inForce(moment)
	if (line.branchId === null) {
		if (shownVersionId != null) {
			const shown = versions.find((v) => v.versionId === shownVersionId)
			if (shown) return shown
		}
		return versions[versions.length - 1]
	}
	return inForce(null)
}

/**
 * The line's own person-written version already at `date` with the same life
 * point as `moving`, other than `moving`: what a move there is refused for.
 * With no `moving` (a new version, life point null): what it would merge into.
 */
export function castTakenAt(
	versions: readonly CastVersion[],
	date: StoryDate,
	lineBranchId: number | null,
	moving: CastVersion | null
): CastVersion | null {
	const lifePoint = moving?.personalPosition ?? null
	return (
		versions.find(
			(v) =>
				v.kind === "dated" &&
				v.key !== moving?.key &&
				v.own &&
				v.branchId === lineBranchId &&
				!v.locked &&
				v.date != null &&
				compareDates(v.date, date) === 0 &&
				v.personalPosition === lifePoint
		) ?? null
	)
}

/**
 * How many versions a save of `v` leaves with their own words when *Change
 * later versions too* stays off: for the base every main row; for a dated one
 * the rows on its line ordered after it. Session rows count.
 */
export function castLaterCount(
	rows: readonly CastRow[],
	v: CastVersion
): number {
	if (v.kind === "beginning")
		return rows.filter((r) => r.branchId == null).length
	const self = v.row
	if (!self) return 0
	return rows.filter(
		(r) =>
			r.branchId === v.branchId &&
			r.id !== self.id &&
			(compareDates(dateOfRow(r), dateOfRow(self)) ||
				r.writeOrder - self.writeOrder ||
				r.id - self.id) > 0
	).length
}

/** 🚧 Keys a dated change cannot carry: they save through the member save, as the book's present has them. */
export const UNDATED_MEMBER_KEYS = ["ownName", "ownNickname", "timbre"] as const

function splitUndated(diff: Record<string, unknown>): {
	undated: Record<string, unknown> | null
	versionPart: Record<string, unknown>
} {
	const undated: Record<string, unknown> = {}
	const versionPart: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(diff))
		if ((UNDATED_MEMBER_KEYS as readonly string[]).includes(key))
			undated[key] = value
		else versionPart[key] = value
	return {
		undated: Object.keys(undated).length ? undated : null,
		versionPart
	}
}

/**
 * A save of the selected version. `undated`: sent with `lorebooks:updateBinding`
 * and no `castVersionId`. `version`: for the base, `updateBinding` with
 * `castVersionId`; for a dated one, `amendments:update` `fields` — its own
 * `row.fields` plus the diff, never a folded whole. Null when the diff has no
 * version key.
 */
export function castVersionSave(
	v: CastVersion,
	diff: Record<string, unknown>
): {
	undated: Record<string, unknown> | null
	version: Record<string, unknown> | null
} {
	const { undated, versionPart } = splitUndated(diff)
	if (!Object.keys(versionPart).length) return { undated, version: null }
	return {
		undated,
		version:
			v.kind === "dated" && v.row
				? { ...v.row.fields, ...versionPart }
				: versionPart
	}
}

/** A new dated version's save: the undated keys go to the member save, the rest are its `fields`. */
export function castNewVersionSave(diff: Record<string, unknown>): {
	undated: Record<string, unknown> | null
	fields: Record<string, unknown>
} {
	const { undated, versionPart } = splitUndated(diff)
	return { undated, fields: versionPart }
}

/** 🚧 What a version changes, in words. */
export function castChangesWords(keys: string[]): string {
	return keys.length
		? `changes ${keys.map(castFieldWord).join(", ")}`
		: "changes nothing"
}

/** 🚧 The question before a person's version is deleted from the rail. */
export function castDeleteSentence(
	name: string
): (when: string, line: string | null) => string {
	return (when, line) =>
		`Delete the version dated ${when}${line ? ` on ${line}` : ""}? From then on ${name} reads as the version before it, and this version's edit history goes with it.`
}
