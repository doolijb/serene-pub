/**
 * Loose ends — the "finish this book" queue, as arithmetic (note 5, built
 * 2026-10-02; plan: PLAN-lorebooks-consolidation "Loose ends rethink").
 *
 * A **loose end** is one thing a person can do to a book; its **chore** is
 * the kind of fix it needs (needs keywords, undated history, …). The queue
 * lists every loose end, grouped by chore, and each row opens with the field
 * that fixes it focused. A row leaves only when it is FIXED — there is no
 * per-row dismissal (owner, 2026-10-02) — or, where the chore says so, when
 * the entry is pinned or switched off.
 *
 * Not a saved scope: a scope narrows a list, this is a list of work. It
 * replaced the two saved scopes "Needs keywords" and "Loose ends" (the
 * keyword filter chip stays in the pool's filters).
 *
 * Kept pure so "what is left to do in this book?" is answerable without a
 * browser, and the rail's figure, the queue's groups and Next agree.
 */

import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	LOCATION_TYPE_ID
} from "$lib/shared/entries/types"
import { CAST_KIND, needsKeywords, SCENE_KIND, type PoolItem } from "./poolFilter"
import type { CastKind } from "./castPool"

/**
 * The kinds of loose end, in the order the queue works through them.
 *
 * ⏳ SEAM — "never-read-in" (an in-play entry no session on the line has ever
 * read in) comes with E2's server-side rollup. It slots in after
 * `needs-keywords`: add the id here and to `CHORES`, and feed `looseEnds` the
 * set of keys ever read in; nothing else in the queue changes.
 */
export type ChoreId =
	| "needs-keywords"
	| "undated-history"
	| "empty-content"
	| "undescribed-place"
	| "cast-suggestion"
	| "orphan-member"

/** The field a row opens with focused, when the fix is a field. */
export type ChoreField = "keywords" | "date" | "content"

export interface Chore {
	id: ChoreId
	/** The group's heading. */
	label: string
	/** What fixes one, said once under the heading. */
	fix: string
	/** The editor field that fixes it, focused when a row opens. */
	field: ChoreField | null
}

export const CHORES: readonly Chore[] = [
	{
		id: "needs-keywords",
		label: "Needs keywords",
		fix: "Add a keyword, or pin it or switch it off.",
		field: "keywords"
	},
	{
		id: "undated-history",
		label: "Undated history",
		fix: "Give it a year.",
		field: "date"
	},
	{
		id: "empty-content",
		label: "Empty content",
		fix: "Write what it says.",
		field: "content"
	},
	{
		id: "undescribed-place",
		label: "Undescribed places",
		fix: "Describe it, or link it to another place.",
		field: "content"
	},
	{
		id: "cast-suggestion",
		label: "Cast suggestions",
		fix: "Accept or dismiss it in the cast's Suggestions.",
		field: null
	},
	{
		id: "orphan-member",
		label: "Orphan cast members",
		fix: "Give them lore or a relationship, or delete them.",
		field: null
	}
]

const CHORE_ORDER = new Map(CHORES.map((c, i) => [c.id, i]))

export function choreOf(id: ChoreId): Chore {
	return CHORES[CHORE_ORDER.get(id)!]
}

/** One row of the queue. */
export interface LooseEnd {
	/** `${chore}:${subject}` — one subject can be a loose end of two chores. */
	id: string
	chore: ChoreId
	/**
	 * What the row opens: an entry, a cast member, or the cast's Suggestions
	 * panel (on the tab the suggestion is filed under).
	 */
	target:
		| { kind: "entry"; entryId: number }
		| { kind: "member"; castId: number }
		| { kind: "suggestions"; tab: "suggestions" | "duplicates" }
	/** The pool key of an entry or member; absent on a suggestion. */
	key?: string
	name: string
	/** The entry's kind (a type id) or `cast`, for the row's small label. */
	kind: string
	updatedAt: number
}

/** A cast member as the queue reads one. */
export interface LooseEndMember {
	id: number
	name: string
	castKind: CastKind
	updatedAt: number
}

export interface LooseEndsInput {
	/** The book's pool on the line being read (scenes ignored). */
	items: readonly PoolItem[]
	/** The cast on the line being read. */
	members?: readonly LooseEndMember[]
	/**
	 * Every pool key a relationship touches (`entry#N`, `cast#N`) on the
	 * line — a place with a link is described enough; a member with one is
	 * no orphan.
	 */
	linkedKeys?: ReadonlySet<string>
	/** The ids of members with character lore anchored to them. */
	membersWithLore?: ReadonlySet<number>
	/** Pending suggested members, by name. */
	suggestions?: readonly { id: number; name: string }[]
	/** Possible duplicate pairs. */
	duplicates?: readonly { nameA: string; nameB: string }[]
}

const blank = (s: string | null | undefined) => !s || s.trim().length === 0

/**
 * Every loose end in the book, sorted by chore and then most recently
 * changed first — the reader works one kind of fix at a time.
 */
export function looseEnds(input: LooseEndsInput): LooseEnd[] {
	const out: LooseEnd[] = []
	const linked = input.linkedKeys ?? new Set<string>()
	const entry = (chore: ChoreId, item: PoolItem): LooseEnd => ({
		id: `${chore}:${item.key}`,
		chore,
		target: { kind: "entry", entryId: item.id },
		key: item.key,
		name: item.name,
		kind: item.kind,
		updatedAt: item.updatedAt
	})

	for (const item of input.items) {
		// Archived rows are out of the book's way on purpose; scenes and the
		// people are not entries (a member's chores are below).
		if (item.archived) continue
		if (item.kind === SCENE_KIND || item.kind === CAST_KIND) continue

		if (needsKeywords(item)) out.push(entry("needs-keywords", item))
		if (item.kind === HISTORY_TYPE_ID && !item.date)
			out.push(entry("undated-history", item))
		if (item.kind === LOCATION_TYPE_ID) {
			if (blank(item.content) && !linked.has(item.key))
				out.push(entry("undescribed-place", item))
		} else if (blank(item.content)) out.push(entry("empty-content", item))
	}

	input.suggestions?.forEach((s) =>
		out.push({
			id: `cast-suggestion:suggestion#${s.id}`,
			chore: "cast-suggestion",
			target: { kind: "suggestions", tab: "suggestions" },
			name: s.name,
			kind: CAST_KIND,
			updatedAt: 0
		})
	)
	input.duplicates?.forEach((d) =>
		out.push({
			id: `cast-suggestion:duplicate#${d.nameA}|${d.nameB}`,
			chore: "cast-suggestion",
			target: { kind: "suggestions", tab: "duplicates" },
			name: `${d.nameA} · ${d.nameB}?`,
			kind: CAST_KIND,
			updatedAt: 0
		})
	)

	const withLore = input.membersWithLore ?? new Set<number>()
	for (const m of input.members ?? []) {
		const key = `cast#${m.id}`
		if (m.castKind !== "background") continue
		if (withLore.has(m.id) || linked.has(key)) continue
		out.push({
			id: `orphan-member:${key}`,
			chore: "orphan-member",
			target: { kind: "member", castId: m.id },
			key,
			name: m.name,
			kind: CAST_KIND,
			updatedAt: m.updatedAt
		})
	}

	return out.sort(
		(a, b) =>
			CHORE_ORDER.get(a.chore)! - CHORE_ORDER.get(b.chore)! ||
			b.updatedAt - a.updatedAt
	)
}

/** The ids of members with lore anchored to them, from character lore rows. */
export function membersWithLore(
	rows: readonly { lorebookBindingId?: number | null; typeId?: string }[]
): Set<number> {
	const out = new Set<number>()
	for (const row of rows)
		if (
			row.lorebookBindingId != null &&
			(row.typeId === undefined || row.typeId === CHARACTER_LORE_TYPE_ID)
		)
			out.add(row.lorebookBindingId)
	return out
}

export interface LooseEndGroup {
	chore: Chore
	rows: LooseEnd[]
}

/** The queue as groups, in chore order; a chore with nothing left is absent. */
export function groupLooseEnds(rows: readonly LooseEnd[]): LooseEndGroup[] {
	const groups = new Map<ChoreId, LooseEnd[]>()
	for (const row of rows) {
		const list = groups.get(row.chore) ?? []
		list.push(row)
		groups.set(row.chore, list)
	}
	return CHORES.filter((c) => groups.has(c.id)).map((chore) => ({
		chore,
		rows: groups.get(chore.id)!
	}))
}

/**
 * The queue on screen: the snapshot taken when it opened, in ITS order, less
 * every row that has since been fixed. Nothing new joins and nothing moves
 * while the reader works — a fixed row only leaves. New loose ends appear
 * when the queue is opened again (it is refreshed on leave).
 */
export function liveQueue(
	snapshot: readonly LooseEnd[],
	live: readonly LooseEnd[]
): LooseEnd[] {
	const still = new Map(live.map((row) => [row.id, row]))
	const out: LooseEnd[] = []
	for (const row of snapshot) {
		const now = still.get(row.id)
		// The live row, so a rename shows; the snapshot's place, so it stays put.
		if (now) out.push(now)
	}
	return out
}

/**
 * The row after `currentId` in the queue — "Next loose end". Wraps to the
 * top; null when the queue holds nothing else.
 *
 * `currentId` may already have left the queue (it was just fixed), so its
 * place is read from the snapshot, which still has it.
 */
export function nextLooseEnd(
	snapshot: readonly LooseEnd[],
	live: readonly LooseEnd[],
	currentId: string | null
): LooseEnd | null {
	const queue = liveQueue(snapshot, live)
	if (!queue.length) return null
	if (currentId === null) return queue[0]
	const at = snapshot.findIndex((row) => row.id === currentId)
	if (at === -1) return queue[0]
	const liveIds = new Set(queue.map((row) => row.id))
	const after = snapshot.slice(at + 1).find((row) => liveIds.has(row.id))
	if (after) return queue.find((row) => row.id === after.id) ?? null
	const first = queue[0]
	return first.id === currentId ? null : first
}
