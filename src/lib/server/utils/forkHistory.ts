/**
 * Deleting a line keeps the history entries its forks' own rows point at
 * (plan A17).
 *
 * A fork's rows can hang from a history entry written on the line it left:
 * a stat or a link recorded on the fork is dated by the newest history entry
 * the fork reads (`writeDatingAt`), and that is the parent's while the fork
 * has none of its own; a scene captured on the fork is filed under one. The
 * date lives only in the history entry, so deleting it with its line would
 * leave those rows undated — read as "from the beginning", under every dated
 * value — and would delete the scenes outright (`scenes.history_entry_id`
 * cascades).
 *
 * So before the line goes, every history entry of it that a fork reads and
 * that the fork's rows (or those of a line forked from it) point at stays,
 * as the fork's own: the first such fork gets the entry itself, each other
 * fork an exact copy with its rows moved onto the copy. Moved onto the fork,
 * the entry reads on exactly the lines, at exactly the moments, it read on
 * before (`forksThrough`). What was written on the deleted line and nothing
 * on a fork points at goes with it, as the rest of the line does.
 *
 * That keeps only an entry the fork READS, so the other half is that a
 * fork's rows never point at one it does not: they are written only under
 * an entry their line reads (`scenes:create`, `assertLinkDate`,
 * `writeDatingAt`), and an entry is never re-dated past where a line whose
 * rows use it reads it (`assertRedateKeepsLines`).
 */
import { and, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type Column, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { historyEntryDate } from "$lib/server/state/reading"
import { bookCalendarOf } from "$lib/server/state/storyTime"
import { inBookOfType, parkingFloor } from "$lib/server/utils/lorebookEntries"
import {
	earlierCut,
	forksThrough,
	lineOf,
	rowReadsOnLine,
	stepOf,
	type LineBranch
} from "$lib/shared/lorebooks/lineReading"
import { formatDate, type StoryDate } from "$lib/shared/lorebooks/storyDate"

/** What `keepHistoryForForks` kept, and where. */
export interface KeptHistory {
	/** A history entry of the deleted line → the fork it now belongs to. */
	moved: Map<number, number>
	/** A fork's own copy: of which entry, the copy's id, and the fork. */
	copied: { from: number; id: number; branchId: number }[]
}

/**
 * Keep, as the forks' own, the history entries of `deletedId` that the
 * forks' rows point at. Call it inside the delete's transaction, with the
 * book's lines as they stand BEFORE any fork is moved past the deleted one.
 */
export async function keepHistoryForForks(
	tx: Db,
	lorebookId: number,
	deletedId: number,
	lines: readonly LineBranch[]
): Promise<KeptHistory> {
	const kept: KeptHistory = { moved: new Map(), copied: [] }
	const groups = forksThrough(deletedId, lines)
	if (groups.size === 0) return kept

	const history = await tx
		.select({
			id: schema.lorebookEntries.id,
			fields: schema.lorebookEntries.fields,
			anchorEntryId: schema.lorebookEntries.anchorEntryId
		})
		.from(schema.lorebookEntries)
		.where(
			and(
				inBookOfType(lorebookId, HISTORY_TYPE_ID),
				eq(schema.lorebookEntries.branchId, deletedId)
			)
		)
		.orderBy(schema.lorebookEntries.id)
	if (history.length === 0) return kept

	const sessions = await tx
		.select({
			id: schema.sessions.id,
			branchId: schema.sessions.lorebookBranchId
		})
		.from(schema.sessions)
		.where(inArray(schema.sessions.lorebookBranchId, [...groups.values()].flat()))
	const sessionsOn = (group: readonly number[]) =>
		sessions.filter((s) => s.branchId != null && group.includes(s.branchId)).map((s) => s.id)

	// Which forks keep which entry: an entry the fork reads at its head, that
	// the rows of its group point at. One the fork never read, none of its
	// group read either, so none of them loses it.
	const keepers = new Map<number, number[]>()
	for (const fork of [...groups.keys()].sort((a, b) => a - b)) {
		const line = lineOf(fork, lines)
		const read = history
			.filter((h) => rowReadsOnLine({ branchId: deletedId }, line, historyEntryDate(h.fields), null))
			.map((h) => h.id)
		if (read.length === 0) continue
		const group = groups.get(fork)!
		for (const id of await pointedAt(tx, read, group, sessionsOn(group)))
			keepers.set(id, [...(keepers.get(id) ?? []), fork])
	}
	if (keepers.size === 0) return kept

	// A history entry filed under another entry of the deleted line would go
	// with its parent (`anchor_entry_id` cascades). Read before anything moves.
	const anchors = [...new Set(history.map((h) => h.anchorEntryId).filter((id): id is number => id != null))]
	const anchoredOnDeleted = new Set(
		anchors.length === 0
			? []
			: (
					await tx
						.select({ id: schema.lorebookEntries.id })
						.from(schema.lorebookEntries)
						.where(
							and(
								inArray(schema.lorebookEntries.id, anchors),
								eq(schema.lorebookEntries.branchId, deletedId)
							)
						)
				).map((r) => r.id)
	)

	/** `${entry}:${fork}` → the row that is that entry on that fork now. */
	const onFork = new Map<string, number>()
	let locked = false
	for (const h of history) {
		const forks = keepers.get(h.id)
		if (!forks) continue
		const [first, ...others] = forks
		await tx
			.update(schema.lorebookEntries)
			.set({ branchId: first, updatedAt: sql`${schema.lorebookEntries.updatedAt}` })
			.where(eq(schema.lorebookEntries.id, h.id))
		kept.moved.set(h.id, first)
		onFork.set(`${h.id}:${first}`, h.id)

		for (const fork of others) {
			// A new row takes a position, which is unique per book and type.
			if (!locked) {
				await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
				locked = true
			}
			const id = await copyEntryOnto(tx, h.id, fork)
			const group = groups.get(fork)!
			await pointOnto(tx, h.id, id, group, sessionsOn(group))
			kept.copied.push({ from: h.id, id, branchId: fork })
			onFork.set(`${h.id}:${fork}`, id)
		}
	}

	// Filed under an entry of the deleted line: under that entry's own row on
	// the same fork when it was kept there too, else at the top level.
	for (const h of history) {
		if (h.anchorEntryId == null || !anchoredOnDeleted.has(h.anchorEntryId)) continue
		for (const [key, id] of onFork) {
			const [entry, fork] = key.split(":").map(Number)
			if (entry !== h.id) continue
			await tx
				.update(schema.lorebookEntries)
				.set({
					anchorEntryId: onFork.get(`${h.anchorEntryId}:${fork}`) ?? null,
					updatedAt: sql`${schema.lorebookEntries.updatedAt}`
				})
				.where(eq(schema.lorebookEntries.id, id))
		}
	}
	return kept
}

/** On the group's lines, or — for a session's own rows — in its sessions. */
function ofGroup(
	branchColumn: Column,
	sessionColumn: Column | null,
	group: readonly number[],
	sessionIds: readonly number[]
): SQL {
	const onLines = inArray(branchColumn, [...group])
	return sessionColumn && sessionIds.length
		? or(onLines, inArray(sessionColumn, [...sessionIds]))!
		: onLines
}

/**
 * The entries of `ids` that rows of the group point at: dated by, filed
 * under, amending, or linked to. A search vector or an annotation is derived
 * from the entry and keeps nothing.
 */
async function pointedAt(
	tx: Db,
	ids: number[],
	group: readonly number[],
	sessionIds: readonly number[]
): Promise<Set<number>> {
	const found: (number | null)[] = []
	const s = schema.scenes
	for (const r of await tx
		.select({ id: s.historyEntryId })
		.from(s)
		.where(and(inArray(s.historyEntryId, ids), ofGroup(s.branchId, null, group, sessionIds))))
		found.push(r.id)
	const l = schema.narrativeRelationships
	for (const r of await tx
		.select({ from: l.fromEntryId, to: l.toEntryId, dated: l.historyEntryId })
		.from(l)
		.where(
			and(
				ofGroup(l.branchId, null, group, sessionIds),
				or(inArray(l.fromEntryId, ids), inArray(l.toEntryId, ids), inArray(l.historyEntryId, ids))
			)
		))
		found.push(r.from, r.to, r.dated)
	const e = schema.entryAmendments
	for (const r of await tx
		.select({ entry: e.entryId, dated: e.historyEntryId })
		.from(e)
		.where(
			and(
				ofGroup(e.branchId, null, group, sessionIds),
				or(inArray(e.entryId, ids), inArray(e.historyEntryId, ids))
			)
		))
		found.push(r.entry, r.dated)
	const c = schema.castAmendments
	for (const r of await tx
		.select({ id: c.historyEntryId })
		.from(c)
		.where(and(inArray(c.historyEntryId, ids), ofGroup(c.branchId, null, group, sessionIds))))
		found.push(r.id)
	for (const t of [schema.attributeValues, schema.attributeConfigs, schema.stateProposals] as const)
		for (const r of await tx
			.select({ id: t.historyEntryId })
			.from(t)
			.where(and(inArray(t.historyEntryId, ids), ofGroup(t.branchId, t.sessionId, group, sessionIds))))
			found.push(r.id)
	const wanted = new Set(ids)
	return new Set(found.filter((id): id is number => id != null && wanted.has(id)))
}

/**
 * An exact copy of a history entry on `branchId`, listed right after it, with
 * its search vectors and annotations (nothing is embedded twice). Answers the
 * copy's id.
 */
async function copyEntryOnto(tx: Db, entryId: number, branchId: number): Promise<number> {
	const t = schema.lorebookEntries
	const [{ id: _id, ...row }] = await tx.select().from(t).where(eq(t.id, entryId))
	const position = await openPositionAfter(tx, row.lorebookId, row.typeId, row.position)
	const [copy] = await tx
		.insert(t)
		.values({ ...row, branchId, position })
		.returning({ id: t.id })

	const vectors = await tx
		.select()
		.from(schema.lorebookEntryVectors)
		.where(eq(schema.lorebookEntryVectors.entryId, entryId))
	if (vectors.length)
		await tx
			.insert(schema.lorebookEntryVectors)
			.values(vectors.map((v) => ({ ...v, entryId: copy.id })))
	const annotations = await tx
		.select()
		.from(schema.entryAnnotations)
		.where(eq(schema.entryAnnotations.entryId, entryId))
	if (annotations.length)
		await tx.insert(schema.entryAnnotations).values(
			annotations.map((a) => ({
				...a,
				entryId: copy.id,
				refEntryId: a.refEntryId === entryId ? copy.id : a.refEntryId
			}))
		)
	return copy.id
}

/**
 * Free the position after `position` in the book's list of this type and
 * answer it: every row past it moves up one. Parked below every live row
 * first, then placed — `lorebook_entries_position_uq` is checked row by row,
 * so a straight `position + 1` over a run collides partway through (the same
 * two reflections as `entries:iterateNext`). Holding the book's advisory lock.
 */
async function openPositionAfter(
	tx: Db,
	lorebookId: number,
	typeId: string,
	position: number
): Promise<number> {
	const t = schema.lorebookEntries
	const inBook = inBookOfType(lorebookId, typeId)
	const target = position + 1
	const floor = await parkingFloor(tx, inBook)
	await tx
		.update(t)
		.set({ position: sql`${floor + target} - ${t.position}`, updatedAt: sql`${t.updatedAt}` })
		.where(and(inBook, gte(t.position, target)))
	await tx
		.update(t)
		.set({ position: sql`${floor + target + 1} - ${t.position}`, updatedAt: sql`${t.updatedAt}` })
		.where(and(inBook, lte(t.position, floor)))
	return target
}

/**
 * Move every row of the group that points at `from` onto `to`, its copy on
 * the group's fork — the same rows `pointedAt` counts, and the annotations of
 * the group's sessions' messages. A row's `updated_at` is left as it was:
 * pointing at the copy changes nothing it says.
 */
async function pointOnto(
	tx: Db,
	from: number,
	to: number,
	group: readonly number[],
	sessionIds: readonly number[]
): Promise<void> {
	const s = schema.scenes
	await tx
		.update(s)
		.set({ historyEntryId: to, updatedAt: sql`${s.updatedAt}` })
		.where(and(eq(s.historyEntryId, from), ofGroup(s.branchId, null, group, sessionIds)))
	const l = schema.narrativeRelationships
	for (const column of ["fromEntryId", "toEntryId", "historyEntryId"] as const)
		await tx
			.update(l)
			.set({ [column]: to, updatedAt: sql`${l.updatedAt}` })
			.where(and(eq(l[column], from), ofGroup(l.branchId, null, group, sessionIds)))
	const e = schema.entryAmendments
	for (const column of ["entryId", "historyEntryId"] as const)
		await tx
			.update(e)
			.set({ [column]: to, updatedAt: sql`${e.updatedAt}` })
			.where(and(eq(e[column], from), ofGroup(e.branchId, null, group, sessionIds)))
	const c = schema.castAmendments
	await tx
		.update(c)
		.set({ historyEntryId: to, updatedAt: sql`${c.updatedAt}` })
		.where(and(eq(c.historyEntryId, from), ofGroup(c.branchId, null, group, sessionIds)))
	for (const t of [schema.attributeValues, schema.attributeConfigs, schema.stateProposals] as const)
		await tx
			.update(t)
			.set({ historyEntryId: to })
			.where(and(eq(t.historyEntryId, from), ofGroup(t.branchId, t.sessionId, group, sessionIds)))
	if (sessionIds.length) {
		const m = schema.messageAnnotations
		await tx
			.update(m)
			.set({ refEntryId: to })
			.where(
				and(
					eq(m.refEntryId, from),
					inArray(
						m.messageId,
						tx
							.select({ id: schema.messages.id })
							.from(schema.messages)
							.where(inArray(schema.messages.sessionId, [...sessionIds]))
					)
				)
			)
	}
}

/**
 * Refuse re-dating history entry `entryId` to `to` when that takes it away
 * from a line whose rows use it: the line read the entry at its stored date
 * and, cut at its fork, does not at the new one. Its scenes would sit under
 * a moment the line never had, its links and stats would be dated by one,
 * and deleting the entry's line would take them along (`keepHistoryForForks`
 * keeps for a fork only the entries it reads). A move that stays inside every
 * such line's fork date, or that no line's rows would feel, goes through.
 *
 * Call it inside the re-date's transaction, after `lockBookCalendar`: a fork
 * is made under the same lock, so no line appears between the check and the
 * write. Only `tx`.
 */
export async function assertRedateKeepsLines(
	tx: Db,
	entryId: number,
	to: StoryDate
): Promise<void> {
	const using = await linesUsing(tx, entryId)
	if (using.size === 0) return
	const [entry] = await tx
		.select({
			lorebookId: schema.lorebookEntries.lorebookId,
			branchId: schema.lorebookEntries.branchId,
			fields: schema.lorebookEntries.fields
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, entryId))
	if (!entry) return
	const b = schema.lorebookBranches
	const lines = await tx
		.select({
			id: b.id,
			name: b.name,
			forkedFromBranchId: b.forkedFromBranchId,
			forkYear: b.forkYear,
			forkMonth: b.forkMonth,
			forkDay: b.forkDay
		})
		.from(b)
		.where(eq(b.lorebookId, entry.lorebookId))
		.orderBy(b.id)
	const nameOf = (id: number | null) =>
		id == null ? "main" : (lines.find((l) => l.id === id)?.name ?? "a deleted line")
	const from = historyEntryDate(entry.fields)
	const own = { branchId: entry.branchId }
	const lost: number[] = []
	let cut: StoryDate | null = null
	for (const l of [null, ...lines.map((l) => l.id)]) {
		if (!using.has(l)) continue
		const line = lineOf(l, lines)
		if (!rowReadsOnLine(own, line, from) || rowReadsOnLine(own, line, to)) continue
		lost.push(l as number)
		cut = earlierCut(cut, stepOf(line, entry.branchId)!.cut)
	}
	if (lost.length === 0 || cut === null) return
	const date = formatDate(cut, await bookCalendarOf(tx, entry.lorebookId))
	const names = lost.map(nameOf)
	const listed =
		names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
	const one = names.length === 1
	throw new Error(
		`${listed} ${one ? "has" : "have"} scenes, links, stats or amendments tied to this history entry, ` +
			`but ${one ? `${listed} reads` : "they read"} ${nameOf(entry.branchId)} only up to ${date}, ` +
			`so the entry cannot move past ${date}.`
	)
}

/**
 * The lines whose rows use history entry `entryId` — the rows `pointedAt`
 * counts, by their own line: filed under it, dated by it, amending it,
 * linked to it. A session's own stat (no line of its own) is on its
 * session's line. NULL is main.
 */
async function linesUsing(tx: Db, entryId: number): Promise<Set<number | null>> {
	const lines = new Set<number | null>()
	const s = schema.scenes
	for (const r of await tx.select({ line: s.branchId }).from(s).where(eq(s.historyEntryId, entryId)))
		lines.add(r.line)
	const l = schema.narrativeRelationships
	for (const r of await tx
		.select({ line: l.branchId })
		.from(l)
		.where(or(eq(l.fromEntryId, entryId), eq(l.toEntryId, entryId), eq(l.historyEntryId, entryId))))
		lines.add(r.line)
	const e = schema.entryAmendments
	for (const r of await tx
		.select({ line: e.branchId })
		.from(e)
		.where(or(eq(e.entryId, entryId), eq(e.historyEntryId, entryId))))
		lines.add(r.line)
	const c = schema.castAmendments
	for (const r of await tx.select({ line: c.branchId }).from(c).where(eq(c.historyEntryId, entryId)))
		lines.add(r.line)
	const p = schema.stateProposals
	for (const r of await tx.select({ line: p.branchId }).from(p).where(eq(p.historyEntryId, entryId)))
		lines.add(r.line)
	for (const t of [schema.attributeValues, schema.attributeConfigs] as const) {
		for (const r of await tx
			.select({ line: t.branchId })
			.from(t)
			.where(and(eq(t.historyEntryId, entryId), or(isNull(t.sessionId), isNotNull(t.branchId)))))
			lines.add(r.line)
		for (const r of await tx
			.select({ line: schema.sessions.lorebookBranchId })
			.from(t)
			.innerJoin(schema.sessions, eq(schema.sessions.id, t.sessionId))
			.where(and(eq(t.historyEntryId, entryId), isNull(t.branchId))))
			lines.add(r.line)
	}
	return lines
}
