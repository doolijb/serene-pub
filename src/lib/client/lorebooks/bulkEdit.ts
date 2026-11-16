/**
 * 🚧 **Bulk edit** (owner, 2026-11-13/14): the entries list's selection and
 * the actions that run over it, one request per entry. Pure.
 */
import type { LineBranch } from "$lib/shared/lorebooks/lineReading"
import {
	linesBelow,
	moveDownProblems,
	moveDownSentence,
	takenAlong,
	type MoveDownWords,
	type TreeRow
} from "$lib/shared/lorebooks/moveDownTheTree"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"

/** A selected entry, as bulk edit reads it. `listed` false = a *could exist here* row (another line's). */
export interface BulkRow {
	id: number
	typeId: string
	name: string
	pinned: boolean
	off: boolean
	archived: boolean
	branchId: number | null
	listed: boolean
}

export type BulkAction =
	| "beginning"
	| "decay"
	| "pin"
	| "unpin"
	| "off"
	| "on"
	| "archive"
	| "unarchive"
	| "delete"

/** An entry left as it was, and the sentence that says why. */
export interface BulkNote {
	id: number
	name: string
	reason: string
}

export interface BulkPlan {
	send: BulkRow[]
	skip: BulkNote[]
	withParent: BulkRow[]
}

const alreadyAsked = (action: BulkAction, r: BulkRow): boolean =>
	(action === "pin" && r.pinned) ||
	(action === "unpin" && !r.pinned) ||
	(action === "off" && r.off) ||
	(action === "on" && !r.off) ||
	(action === "archive" && r.archived) ||
	(action === "unarchive" && !r.archived)

/**
 * Which selected entries an action is sent for. A *could exist here* row takes only Move down the tree; a
 * History entry takes no Beginning; an entry already as asked is left out silently; for Delete, an entry filed
 * (at any depth, through `parents`) under another selected entry is not sent: it goes with that one (`withParent`).
 */
export function planBulk(
	action: BulkAction,
	rows: readonly BulkRow[],
	opts: {
		lineName: (id: number | null) => string
		/** Every loaded entry's parent (`anchorEntryId`), for the delete cascade. */
		parents?: ReadonlyMap<number, number | null>
	}
): BulkPlan {
	const send: BulkRow[] = []
	const skip: BulkNote[] = []
	const withParent: BulkRow[] = []
	const selected = new Set(rows.map((r) => r.id))
	for (const r of rows) {
		if (!r.listed) {
			skip.push({
				id: r.id,
				name: r.name,
				reason: `On ${opts.lineName(r.branchId)}: only Move down the tree… reaches it from here.`
			})
			continue
		}
		if (action === "beginning" && r.typeId === HISTORY_TYPE_ID) {
			skip.push({
				id: r.id,
				name: r.name,
				reason: "A History entry takes no beginning: its date is its own."
			})
			continue
		}
		if (alreadyAsked(action, r)) continue
		if (action === "delete" && opts.parents) {
			const seen = new Set<number>([r.id])
			let cursor = opts.parents.get(r.id) ?? null
			let under = false
			while (cursor != null && !seen.has(cursor)) {
				if (selected.has(cursor)) {
					under = true
					break
				}
				seen.add(cursor)
				cursor = opts.parents.get(cursor) ?? null
			}
			if (under) {
				withParent.push(r)
				continue
			}
		}
		send.push(r)
	}
	return { send, skip, withParent }
}

/** The three two-way buttons as the selection decides them (listed rows only; none selected = the first word). */
export function toggleActions(rows: readonly BulkRow[]): {
	pin: "pin" | "unpin"
	off: "off" | "on"
	archive: "archive" | "unarchive"
} {
	const listed = rows.filter((r) => r.listed)
	return {
		pin:
			listed.some((r) => !r.pinned) || listed.length === 0
				? "pin"
				: "unpin",
		off: listed.some((r) => !r.off) || listed.length === 0 ? "off" : "on",
		archive:
			listed.some((r) => !r.archived) || listed.length === 0
				? "archive"
				: "unarchive"
	}
}

export const BULK_LABELS: Record<
	Exclude<BulkAction, "beginning" | "decay" | "delete">,
	string
> = {
	pin: "Pin",
	unpin: "Unpin",
	off: "Switch off",
	on: "Switch on",
	archive: "Archive",
	unarchive: "Unarchive"
}

/**
 * One request per entry, one after another. `send` resolves null when the entry changed, or a sentence when it
 * changed but something still decides otherwise (kept as a note); a rejection is the server's refusal, kept with
 * its message, and the rest go on. `onProgress(done)` after each.
 */
export async function runBulk(
	rows: readonly BulkRow[],
	send: (row: BulkRow) => Promise<string | null>,
	onProgress?: (done: number) => void
): Promise<{ changed: number; refused: BulkNote[]; notes: BulkNote[] }> {
	let changed = 0
	const refused: BulkNote[] = []
	const notes: BulkNote[] = []
	let done = 0
	for (const row of rows) {
		try {
			const note = await send(row)
			changed++
			if (note) notes.push({ id: row.id, name: row.name, reason: note })
		} catch (err) {
			refused.push({
				id: row.id,
				name: row.name,
				reason:
					err instanceof Error && err.message
						? err.message
						: "The entry could not be changed."
			})
		}
		onProgress?.(++done)
	}
	return { changed, refused, notes }
}

/** What the bar says after an action: how many changed, then one line per entry left as it was. */
export function bulkReport(o: {
	changed: number
	refused: readonly BulkNote[]
	skipped: readonly BulkNote[]
	notes: readonly BulkNote[]
}): { headline: string; lines: string[] } {
	const headline =
		o.changed === 0
			? "No entry changed."
			: o.changed === 1
				? "1 entry changed."
				: `${o.changed} entries changed.`
	return {
		headline,
		lines: [...o.skipped, ...o.refused, ...o.notes].map(
			(n) => `${n.name}: ${n.reason}`
		)
	}
}

/**
 * The one confirmation of a bulk delete. `filedUnder` is how many entries filed under the sent ones go too;
 * null = not known (an entry type that can be filed under another is not loaded), so no number is given.
 */
export function bulkDeleteCopy(o: {
	count: number
	filedUnder: number | null
	lines: boolean
}): { title: string; message: string } {
	const parts: string[] = []
	if (o.filedUnder === null) parts.push("Entries filed under them go too.")
	else if (o.filedUnder > 0)
		parts.push(
			`${o.filedUnder} ${o.filedUnder === 1 ? "entry" : "entries"} filed under them go too.`
		)
	parts.push(
		"Their relationships, amendments and edit history are deleted with them. This cannot be undone."
	)
	if (o.lines)
		parts.push(
			"Each goes from every line that reads it, not only this one."
		)
	return {
		title: o.count === 1 ? "Delete 1 entry?" : `Delete ${o.count} entries?`,
		message: parts.join(" ")
	}
}

/** How many loaded entries are filed (at any depth) under the sent ones and are not themselves selected. */
export function filedUnderCount(
	sent: readonly number[],
	selected: ReadonlySet<number>,
	parents: ReadonlyMap<number, number | null>
): number {
	const sentSet = new Set(sent)
	let count = 0
	for (const id of parents.keys()) {
		if (selected.has(id)) continue
		const seen = new Set<number>([id])
		let cursor = parents.get(id) ?? null
		while (cursor != null && !seen.has(cursor)) {
			if (sentSet.has(cursor)) {
				count++
				break
			}
			seen.add(cursor)
			cursor = parents.get(cursor) ?? null
		}
	}
	return count
}

/**
 * Which `withParent` rows a bulk delete took along. A row went iff its nearest sent ancestor (through `parents`)
 * was sent and not refused; any other is a note naming its nearest selected ancestor (a row of `send` or
 * `withParent`, else of `selected`), and stays selected.
 */
export function withParentOutcome(o: {
	send: readonly BulkRow[]
	withParent: readonly BulkRow[]
	selected: readonly BulkRow[]
	refusedIds: ReadonlySet<number>
	parents: ReadonlyMap<number, number | null>
}): { went: BulkRow[]; notes: BulkNote[] } {
	const sent = new Set(o.send.map((r) => r.id))
	const chosen = new Map<number, BulkRow>()
	for (const r of o.selected) chosen.set(r.id, r)
	for (const r of [...o.send, ...o.withParent]) chosen.set(r.id, r)
	const went: BulkRow[] = []
	const notes: BulkNote[] = []
	for (const row of o.withParent) {
		const seen = new Set<number>([row.id])
		let cursor = o.parents.get(row.id) ?? null
		let nearest: BulkRow | undefined
		while (cursor != null && !sent.has(cursor) && !seen.has(cursor)) {
			nearest ??= chosen.get(cursor)
			seen.add(cursor)
			cursor = o.parents.get(cursor) ?? null
		}
		if (cursor != null && sent.has(cursor)) nearest ??= chosen.get(cursor)
		if (cursor != null && sent.has(cursor) && !o.refusedIds.has(cursor))
			went.push(row)
		else
			notes.push({
				id: row.id,
				name: row.name,
				reason: `Not deleted: ${nearest?.name ?? "its parent"} was not.`
			})
	}
	return { went, notes }
}

/**
 * How many entries a bulk move carries: the selection and the entries taken along with it on its line
 * (the dialog's own ids), each once.
 */
export function bulkMoveCount(
	ids: readonly number[],
	rows: readonly TreeRow[]
): number {
	const source = rows.find((r) => r.id === ids[0])?.branchId ?? null
	const along = source == null ? [] : takenAlong(ids, rows, source)
	return new Set([...ids, ...along.map((a) => a.row.id)]).size
}

/**
 * Why the selection cannot move down the tree together, or null: one line, not main, no History. The lines it
 * may move to, and their reasons, are the dialog's.
 */
export function bulkMoveProblem(
	ids: readonly number[],
	rows: readonly TreeRow[],
	branches: readonly LineBranch[],
	words: MoveDownWords
): string | null {
	if (ids.length === 0) return null
	const first = rows.find((r) => r.id === ids[0])
	const target =
		first?.branchId == null
			? null
			: (linesBelow(first.branchId, branches)[0] ?? null)
	const p = moveDownProblems({ ids, rows, target, branches }).find((x) =>
		["onMain", "mixedLines", "history"].includes(x.kind)
	)
	return p ? moveDownSentence(p, words) : null
}
