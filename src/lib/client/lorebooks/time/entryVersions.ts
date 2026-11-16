/**
 * An entry as one entry with versions over story time: the arithmetic the
 * entry form's rail and its saves call. Nothing here draws anything.
 *
 * Storage is unchanged: a dated version of an entry is an `entry_amendments`
 * row holding only the fields that differ. This module derives the rail from
 * `amendmentsOnLine` (the one line rule) and never re-implements it.
 *
 * ⚠ **One rule: a field is the entry's until it is made to differ at a date.**
 * Always the entry's: the line, Beginning (`year`, `month`, `day`), Decay
 * (`decayRate`) and archive. Keywords, Pinned, Off and Part of (`ZONE_FIELDS`,
 * and only these four): the entry's while no dated change on the line being
 * read carries the field, per version once one does. Every other field is
 * always the version's.
 *
 * ⚠ One version per entry, line and date. Old data may hold two changes at one
 * date on one line: they are drawn as one version, folded in id order, and
 * editing it edits the later row.
 */
import {
	compareDates,
	formatDate,
	type StoryDate
} from "../sections/historyDates"
import {
	amendmentsOnLine,
	lineOf,
	rowReadsOnLine,
	type Line,
	type LineBranch
} from "$lib/shared/lorebooks/lineReading"

type EntryRow = Sockets.Amendments.EntryRow

/** The four fields that are the entry's until a dated change carries them. */
export const ZONE_FIELDS = [
	"keys",
	"constant",
	"enabled",
	"anchorEntryId"
] as const
export type ZoneField = (typeof ZONE_FIELDS)[number]

/** Fields that are the entry's whatever version is selected. */
export const ENTRY_ONLY_FIELDS: ReadonlySet<string> = new Set([
	"year",
	"month",
	"day",
	"decayRate",
	"archived"
])

/** 🚧 One version on the rail, whatever it is a version of. */
export interface RailVersion {
	/** Stable across a re-date. */
	key: string
	kind: "beginning" | "dated"
	/** The version's date; null is a Perpetual beginning. */
	date: StoryDate | null
	/** The line the version is on; null is main. */
	branchId: number | null
	/** Whether the version is on the line being read, not inherited. */
	own: boolean
	/** The field keys it changes, captioned by the rail's `describe`. */
	changes: string[]
	/** Its date can be changed in place. */
	movable: boolean
	/** The edit-history subjects whose rows sit under it (the rail's `edits` snippet gets these). */
	editIds: readonly (number | null)[]
	/** Shown and selected only: it is changed elsewhere (a session's version). */
	locked?: boolean
	/** Words beside its date, when another version shares the date. */
	chip?: string | null
	/** The one the lorebook reads at its date, when several share it. */
	readHere?: boolean
}

/** 🚧 A version on a line the reading does not read (the rail's Elsewhere group). */
export interface RailElsewhere {
	id: number
	branchId?: number | null
	year: number
	month?: number | null
	day?: number | null
	fields: Record<string, unknown>
	locked?: boolean
	chip?: string | null
}

/** One version of an entry on the rail: the beginning, or a dated change. */
export interface EntryVersion extends RailVersion {
	/** Every row of this line and date, in id order. Empty for the beginning. */
	rows: EntryRow[]
	/** The last of `rows`: the one an edit writes. Null for the beginning. */
	editRow: EntryRow | null
}

interface EntryDate {
	branchId?: number | null
	year?: unknown
	month?: unknown
	day?: unknown
}

function entryBeginning(entry: EntryDate): StoryDate | null {
	return typeof entry.year === "number"
		? {
				year: entry.year,
				month: typeof entry.month === "number" ? entry.month : null,
				day: typeof entry.day === "number" ? entry.day : null
			}
		: null
}

function rowDate(row: EntryRow): StoryDate {
	return { year: row.year, month: row.month ?? null, day: row.day ?? null }
}

function sameDate(a: StoryDate, b: StoryDate): boolean {
	return (
		a.year === b.year &&
		(a.month ?? null) === (b.month ?? null) &&
		(a.day ?? null) === (b.day ?? null)
	)
}

/**
 * The rail: the beginning, then each dated version the line reads in story
 * order. `elsewhere` is every change the line does not read (other lines, an
 * ancestor's changes dated past the fork), by date then id.
 */
export function entryVersions(args: {
	entry: EntryDate
	amendments: readonly EntryRow[]
	line: Line
}): { versions: EntryVersion[]; elsewhere: EntryRow[] } {
	const { entry, amendments, line } = args
	const versions: EntryVersion[] = [
		{
			key: "beginning",
			kind: "beginning",
			date: entryBeginning(entry),
			branchId: entry.branchId ?? null,
			rows: [],
			editRow: null,
			own: (entry.branchId ?? null) === line.branchId,
			changes: [],
			movable: false,
			editIds: [null]
		}
	]
	const head = amendmentsOnLine(amendments, line)
	// Array.prototype.sort is stable: ties keep the apply order.
	const sorted = [...head].sort((a, b) => compareDates(a, b))
	const groups: EntryRow[][] = []
	for (const row of sorted) {
		const group = groups.find(
			(g) =>
				(g[0].branchId ?? null) === (row.branchId ?? null) &&
				sameDate(rowDate(g[0]), rowDate(row))
		)
		if (group) group.push(row)
		else groups.push([row])
	}
	for (const rows of groups) {
		rows.sort((a, b) => a.id - b.id)
		const editRow = rows[rows.length - 1]
		const changes: string[] = []
		for (const r of rows)
			for (const k of Object.keys(r.fields))
				if (!changes.includes(k)) changes.push(k)
		versions.push({
			key: `row:${editRow.id}`,
			kind: "dated",
			date: rowDate(editRow),
			branchId: editRow.branchId ?? null,
			rows,
			editRow,
			own: (editRow.branchId ?? null) === line.branchId,
			changes,
			movable: rows.length <= 1,
			editIds: rows.map((r) => r.id)
		})
	}
	const inHead = new Set(head.map((r) => r.id))
	const elsewhere = amendments
		.filter((r) => !inHead.has(r.id))
		.sort((a, b) => compareDates(a, b) || a.id - b.id)
	return { versions, elsewhere }
}

/**
 * The version in force at the moment: null (now) is the last; otherwise the
 * last dated version on or before it; none is the beginning.
 */
export function versionAt(
	versions: readonly EntryVersion[],
	moment: StoryDate | null
): EntryVersion {
	if (moment === null) return versions[versions.length - 1]
	let found = versions[0]
	for (const v of versions)
		if (v.kind === "dated" && compareDates(v.date!, moment) <= 0) found = v
	return found
}

/**
 * The moment a selected version sets: its date; a Perpetual beginning is the
 * year before the first dated version, and null (leave the moment alone) when
 * nothing is dated.
 */
export function momentOfVersion(
	versions: readonly RailVersion[],
	v: RailVersion
): StoryDate | null {
	if (v.kind === "dated" || v.date) return v.date
	const first = versions.find((x) => x.kind === "dated")
	return first ? { year: first.date!.year - 1, month: null, day: null } : null
}

/** Every field key any dated version carries, inherited ones too. */
export function carriedFields(versions: readonly EntryVersion[]): Set<string> {
	const out = new Set<string>()
	for (const v of versions) for (const k of v.changes) out.add(k)
	return out
}

/** Where a zone field is edited: the version once carried or promoted, else the entry. */
export function zoneOf(
	field: ZoneField,
	carried: ReadonlySet<string>,
	promoted: ReadonlySet<string>
): "entry" | "version" {
	return carried.has(field) || promoted.has(field) ? "version" : "entry"
}

function isZoneField(key: string): key is ZoneField {
	return (ZONE_FIELDS as readonly string[]).includes(key)
}

function splitDiff(args: {
	diff: Record<string, unknown>
	draft: Record<string, unknown>
	carried: ReadonlySet<string>
	promoted: ReadonlySet<string>
	allToEntry: boolean
}): {
	entryPart: Record<string, unknown>
	versionPart: Record<string, unknown>
	promotedPart: Record<string, unknown>
} {
	const { diff, draft, carried, promoted, allToEntry } = args
	const entryPart: Record<string, unknown> = {}
	const versionPart: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(diff)) {
		const toEntry =
			allToEntry ||
			ENTRY_ONLY_FIELDS.has(key) ||
			(isZoneField(key) && zoneOf(key, carried, promoted) === "entry")
		if (toEntry) entryPart[key] = value
		else versionPart[key] = value
	}
	const promotedPart: Record<string, unknown> = {}
	if (!allToEntry) for (const key of promoted) promotedPart[key] = draft[key]
	return { entryPart, versionPart, promotedPart }
}

/**
 * Splits a Save of the selected version: the entry's own fields to an entry
 * patch, the version's to its edited row's fields (merged over what it holds).
 */
export function splitVersionSave(args: {
	diff: Record<string, unknown>
	draft: Record<string, unknown>
	selected: EntryVersion
	carried: ReadonlySet<string>
	promoted: ReadonlySet<string>
}): {
	entryPatch: Record<string, unknown> | null
	versionFields: Record<string, unknown> | null
} {
	const { entryPart, versionPart, promotedPart } = splitDiff({
		...args,
		allToEntry: args.selected.kind === "beginning"
	})
	const hasVersion =
		Object.keys(versionPart).length > 0 ||
		Object.keys(promotedPart).length > 0
	return {
		entryPatch: Object.keys(entryPart).length ? entryPart : null,
		versionFields: hasVersion
			? {
					...(args.selected.editRow?.fields ?? {}),
					...versionPart,
					...promotedPart
				}
			: null
	}
}

/** Splits a Save as a new version: the same split; `fields` may be `{}`. */
export function splitNewVersion(args: {
	diff: Record<string, unknown>
	draft: Record<string, unknown>
	carried: ReadonlySet<string>
	promoted: ReadonlySet<string>
}): {
	entryPatch: Record<string, unknown> | null
	fields: Record<string, unknown>
} {
	const { entryPart, versionPart, promotedPart } = splitDiff({
		...args,
		allToEntry: false
	})
	return {
		entryPatch: Object.keys(entryPart).length ? entryPart : null,
		fields: { ...versionPart, ...promotedPart }
	}
}

/** The dates a version's date may sit between; null is unbounded. */
export interface DateBounds {
	after: StoryDate | null
	before: StoryDate | null
	beginning: StoryDate | null
}

/** The gap for adding a version under `v`: after `v`, before the next dated one. */
export function addVersionBounds(
	versions: readonly RailVersion[],
	v: RailVersion
): DateBounds {
	const i = versions.findIndex((x) => x.key === v.key)
	const next = i < 0 ? undefined : versions.slice(i + 1).find((x) => x.date)
	return {
		after: v.date,
		before: next?.date ?? null,
		beginning: versions[0].date
	}
}

/** The bounds for a new version from Save, or a changed date: only the Beginning. */
export function versionDateBounds(
	versions: readonly RailVersion[]
): DateBounds {
	return { after: null, before: null, beginning: versions[0].date }
}

/** Why a date can't be a version's, or null. 🚧 */
export function versionDateProblem(
	date: StoryDate,
	b: DateBounds
): string | null {
	if (b.beginning && compareDates(date, b.beginning) < 0)
		return `This entry began at ${formatDate(b.beginning)}, so a version can't be dated before it.`
	const tooEarly = b.after !== null && compareDates(date, b.after) <= 0
	const tooLate = b.before !== null && compareDates(date, b.before) >= 0
	if (!tooEarly && !tooLate) return null
	if (b.after && b.before)
		return `Pick a date after ${formatDate(b.after)} and before ${formatDate(b.before)}.`
	if (b.after) return `Pick a date after ${formatDate(b.after)}.`
	return `Pick a date before ${formatDate(b.before!)}.`
}

/** The line's own dated version at exactly this date; inherited ones never count. */
export function takenVersion<V extends RailVersion>(
	versions: readonly V[],
	date: StoryDate,
	lineBranchId: number | null
): V | null {
	return (
		versions.find(
			(v) =>
				v.kind === "dated" &&
				v.branchId === lineBranchId &&
				sameDate(v.date!, date)
		) ?? null
	)
}

/** Said when Save as a new version lands on a taken date. 🚧 */
export const TAKEN_SAVE_SENTENCE = (date: StoryDate): string =>
	`${formatDate(date)} already has a version on this line. Saving changes that version.`

/** Said when a re-date lands on a taken date. 🚧 */
export const TAKEN_REDATE_SENTENCE = (date: StoryDate): string =>
	`${formatDate(date)} already has a version on this line. Pick another date.`

/**
 * Making a zone field the same everywhere: the entry takes the value, the own
 * versions lose the key. An inherited version that carries it blocks the whole
 * write (`blockedBy`): nothing should be written then.
 */
export function sameEverywherePlan(
	field: ZoneField,
	versions: readonly EntryVersion[],
	value: unknown
): {
	rewrites: { id: number; fields: Record<string, unknown> }[]
	versionsChanged: number
	entryPatch: Record<string, unknown>
	blockedBy: EntryVersion | null
} {
	const carriers = versions.filter(
		(v) => v.kind === "dated" && v.changes.includes(field)
	)
	const rewrites: { id: number; fields: Record<string, unknown> }[] = []
	let versionsChanged = 0
	for (const v of carriers.filter((c) => c.own)) {
		versionsChanged++
		for (const row of v.rows) {
			if (!(field in row.fields)) continue
			const { [field]: _dropped, ...rest } = row.fields
			rewrites.push({ id: row.id, fields: rest })
		}
	}
	return {
		rewrites,
		versionsChanged,
		entryPatch: { [field]: value },
		blockedBy: carriers.find((c) => !c.own) ?? null
	}
}

/** Why an inherited version blocks Same everywhere. 🚧 */
export function blockedSentence(v: EntryVersion, lineName: string): string {
	return `${lineName}'s version of ${formatDate(v.date!)} sets it too, so it differs by version there.`
}

/** Whether any line other than the entry's own reads the entry. Branches only: main never reads a branch's row. */
export function otherLinesRead(
	entry: EntryDate,
	branches: readonly LineBranch[]
): boolean {
	const own = entry.branchId ?? null
	const beginning = entryBeginning(entry)
	return branches.some(
		(b) =>
			b.id !== own &&
			rowReadsOnLine(entry, lineOf(b.id, branches), beginning)
	)
}

/** The columns a dated change names, in the reader's words (as the amendment list says them). */
export const CHANGE_LABELS: Record<string, string> = {
	name: "name",
	content: "content",
	keys: "triggers",
	secondaryKeys: "secondary keys",
	enabled: "on or off",
	constant: "always on",
	priority: "priority",
	state: "state",
	summary: "summary",
	anchorEntryId: "part of"
}

/** "changes ‹fields›" for a version's keys, or "changes nothing". */
export function changesWords(keys: string[]): string {
	const named = [...new Set(keys.map((k) => CHANGE_LABELS[k] ?? k))]
	return named.length ? `changes ${named.join(", ")}` : "changes nothing"
}

/** The fold's words for the edit history scoped to the shown entry version. 🚧 */
export const editsToVersionLabel = (n: number): string =>
	`Edits to this version · ${n}`

/** The `lore_redlines.amendmentId` values an entry version owns: null is the entry's own edits. */
export function versionRedlineIds(v: EntryVersion): (number | null)[] {
	return v.kind === "beginning" ? [null] : v.rows.map((r) => r.id)
}
