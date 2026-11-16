/**
 * A **timeless copy** of a lorebook: a NEW book that keeps each entry, cast
 * member, link and stat as it reads now on the line being read, with no
 * dates, versions or other lines, and its Timeline off (owner rulings
 * 2026-11-13). The source is never written.
 *
 * **Now** is the head of the line asked for: `readingOf(tx, sourceId, {
 * branch })` with no moment, so every dated change on the line is applied —
 * what **Switch off here** would make the source read. The book's clock and
 * the line's clock play no part.
 *
 * Kept, undated, on main:
 * - the entries that read on the line, each written as the line's dated
 *   changes fold it (`entryAt`); every other entry goes, history entries
 *   among them. A kept entry that sat under a history entry or an entry that
 *   goes is kept at the top level.
 * - the cast members with a version in force: that one version, as their only
 *   (base) version. A member with none goes, unless something kept names it
 *   (an entry's anchor, a link, a scene's cast, a kept member's parent); then
 *   it keeps its base version, and one that holds none goes anyway.
 * - one link per tie: the one in force, with every `status` as it stands.
 * - one value and one configuration per owner and slot: the one in force.
 * - the scenes that read on the line, filed under nothing.
 *
 * Dropped: entry and cast amendments, presences, history entries, every line,
 * the book's clock and calendar, a scene's story clock. An entry's edit
 * history never travels (`lore_redlines`, not copied by the duplicate).
 *
 * Built on `duplicateLorebookRows` (an exact copy), then flattened. The order
 * keeps the entry-pair link index and the cascades safe: links, versions and
 * stats are replaced while every history entry still exists, entries are
 * un-anchored before the entries they hang from are deleted, lines go last.
 *
 * ⚠ Every statement runs on `tx`. The outer `db` inside this transaction
 * deadlocks PGlite silently.
 */

import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm"
import { HISTORY_TYPE_ID, LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"
import { nearestTieVersions } from "$lib/shared/lorebooks/tieVersions"
import { castVersionsInForce } from "$lib/server/cast/memberAsRead"
import {
	insertCharacterVersions,
	isBaseVersion
} from "$lib/server/characters/versions"
import {
	readingOf,
	rowsOnReading,
	type LineReading
} from "$lib/server/state/reading"
import {
	entryAt,
	entryOnReadingSql,
	entryOverlaysFor
} from "$lib/server/state/entriesOnReading"
import { inForce } from "$lib/server/state/resolve"
import {
	splitUpdate,
	takesBeginning,
	toEntryRow
} from "$lib/server/utils/lorebookEntries"
import { ENTRY_DATE_PARTS } from "$lib/shared/lorebooks/amendments"
import {
	duplicateLorebookRows,
	type DuplicatedLorebook
} from "$lib/server/utils/lorebookDuplicate"
import {
	deleteOwnedRows,
	via,
	type IdMap
} from "$lib/server/lorebooks/tableRegistry"

/** 🚧 The refusal for a session's notes (copying them collides on `lorebooks_session_id_idx`). */
export const TIMELESS_COPY_NOTES_REFUSAL =
	"Session notes can't be made into a timeless copy."

/** Rows per statement. */
const BATCH = 100
/** Ids per `IN` list. */
const CHUNK = 500

const chunks = <T>(list: readonly T[], size: number): T[][] => {
	const out: T[][] = []
	for (let i = 0; i < list.length; i += size)
		out.push(list.slice(i, i + size))
	return out
}

/** The rows of a stat table owned by a book, a member or a place of `bookId` (not a session's layer). */
function statOwnedByBook(
	t: { ownerKind: any; ownerId: any },
	bookId: number
): SQL {
	return sql`(
		(${t.ownerKind} = 'lorebook' and ${t.ownerId} = ${bookId})
		or (${t.ownerKind} = 'cast_member' and ${t.ownerId} in (select id from lorebook_bindings where lorebook_id = ${bookId}))
		or (${t.ownerKind} = 'location' and ${t.ownerId} in (select id from lorebook_entries where lorebook_id = ${bookId} and type_id = ${LOCATION_TYPE_ID}))
	)`
}

/** Story date of a row's history entry, undated earliest. */
const compareRowDates = (a: StoryDate | null, b: StoryDate | null): number =>
	a && b ? compareDates(a, b) : a ? 1 : b ? -1 : 0

/** The key of the tie a link belongs to (see the entry-pair index and `tieVersions.ts`). */
function tieKeyOf(
	r: typeof schema.narrativeRelationships.$inferSelect
): string {
	const castOnly =
		r.fromNodeId != null &&
		r.toNodeId != null &&
		r.fromEntryId == null &&
		r.toEntryId == null
	if (castOnly)
		return JSON.stringify([
			"cast",
			r.fromNodeId,
			r.toNodeId,
			r.relationshipType
		])
	return JSON.stringify([
		"edge",
		r.fromNodeId != null ? `n${r.fromNodeId}` : `e${r.fromEntryId}`,
		r.toNodeId != null ? `n${r.toNodeId}` : `e${r.toEntryId}`,
		r.relationshipType.toLowerCase(),
		r.title.toLowerCase(),
		r.knowledgeKind ?? null
	])
}

/** One link row in force per tie: latest story date, then the nearer line, then the higher id. */
function linksInForce(
	rows: (typeof schema.narrativeRelationships.$inferSelect)[],
	reading: LineReading
): (typeof schema.narrativeRelationships.$inferSelect)[] {
	const dateOf = (r: (typeof rows)[number]) =>
		r.historyEntryId != null
			? (reading.dates?.get(r.historyEntryId) ?? null)
			: null
	const depthOf = (r: (typeof rows)[number]) => {
		const at = reading.line.steps.findIndex(
			(s) => s.branchId === (r.branchId ?? null)
		)
		return at < 0 ? Number.POSITIVE_INFINITY : at
	}
	const best = new Map<string, (typeof rows)[number]>()
	for (const row of rows) {
		const key = tieKeyOf(row)
		const held = best.get(key)
		if (!held) {
			best.set(key, row)
			continue
		}
		const byDate = compareRowDates(dateOf(row), dateOf(held))
		const byDepth = depthOf(held) - depthOf(row)
		if (
			byDate > 0 ||
			(byDate === 0 &&
				(byDepth > 0 || (byDepth === 0 && row.id > held.id)))
		)
			best.set(key, row)
	}
	return [...best.values()]
}

/** The row in force per owner and slot. */
function statsInForce<
	T extends {
		ownerKind: string
		ownerId: number
		slotId: string
		id: number
		validFromMessageId: number | null
		historyEntryId: number | null
	}
>(rows: T[], reading: LineReading): T[] {
	const groups = new Map<string, T[]>()
	for (const r of rows) {
		const key = `${r.ownerKind}:${r.ownerId}:${r.slotId}`
		const list = groups.get(key)
		if (list) list.push(r)
		else groups.set(key, [r])
	}
	const out: T[] = []
	for (const group of groups.values()) {
		const won = inForce(group, reading.dates)
		if (won) out.push(won)
	}
	return out
}

export async function makeTimelessCopy(
	tx: Db,
	opts: {
		sourceId: number
		branchId: number | null
		userId: number
		name: string
	}
): Promise<DuplicatedLorebook> {
	const { sourceId, branchId, userId, name } = opts

	const [book] = await tx
		.select({ sessionId: schema.lorebooks.sessionId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, sourceId))
	if (!book) throw new Error("Lorebook not found.")
	if (book.sessionId != null) throw new Error(TIMELESS_COPY_NOTES_REFUSAL)

	// ── Step 0: read the SOURCE, before anything is copied ────────────────
	const reading = await readingOf(tx, sourceId, { branch: branchId })
	const e = schema.lorebookEntries

	const readEntries = await tx
		.select()
		.from(e)
		.where(
			and(
				eq(e.lorebookId, sourceId),
				entryOnReadingSql(reading),
				ne(e.typeId, HISTORY_TYPE_ID)
			)
		)
	const overlays = await entryOverlaysFor(tx, sourceId, reading)
	/** Source entry id → its wire row as the line folds it (only entries with dated changes). */
	const folded = new Map<number, Record<string, any>>()
	for (const row of readEntries)
		if (overlays.get(row.id)?.length)
			folded.set(
				row.id,
				entryAt(toEntryRow(row) as any, overlays, reading) as Record<
					string,
					any
				>
			)
	const keptEntries = new Set(readEntries.map((r) => r.id))

	const members = await tx
		.select({
			id: schema.lorebookBindings.id,
			parentNodeId: schema.lorebookBindings.parentNodeId
		})
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, sourceId))
	const versions = await castVersionsInForce(
		tx,
		members.map((m) => m.id),
		{ reading }
	)

	const nr = schema.narrativeRelationships
	const linkRows = await tx
		.select()
		.from(nr)
		.where(eq(nr.lorebookId, sourceId))
	const linkCandidates = linksInForce(
		nearestTieVersions(
			await rowsOnReading(tx, linkRows, reading),
			reading.line
		),
		reading
	).filter(
		// A link to an entry that goes goes with it (the endpoint's delete cascades).
		(r) =>
			(r.fromEntryId == null || keptEntries.has(r.fromEntryId)) &&
			(r.toEntryId == null || keptEntries.has(r.toEntryId))
	)

	const av = schema.attributeValues
	const ac = schema.attributeConfigs
	const valuesInForce = statsInForce(
		await rowsOnReading(
			tx,
			await tx
				.select()
				.from(av)
				.where(
					and(
						sql`${av.sessionId} is null`,
						statOwnedByBook(av, sourceId)
					)
				),
			reading
		),
		reading
	)
	const configsInForce = statsInForce(
		await rowsOnReading(
			tx,
			await tx
				.select()
				.from(ac)
				.where(
					and(
						sql`${ac.sessionId} is null`,
						statOwnedByBook(ac, sourceId)
					)
				),
			reading
		),
		reading
	)

	const sc = schema.scenes
	const readScenes = new Set(
		(
			await rowsOnReading(
				tx,
				await tx
					.select({
						id: sc.id,
						branchId: sc.branchId,
						historyEntryId: sc.historyEntryId
					})
					.from(sc)
					.where(eq(sc.lorebookId, sourceId)),
				reading
			)
		).map((s) => s.id)
	)
	const sceneCast = (
		await tx
			.select({
				sceneId: schema.sceneCharacters.sceneId,
				bindingId: schema.sceneCharacters.bindingId
			})
			.from(schema.sceneCharacters)
			.where(
				sql`${schema.sceneCharacters.sceneId} in (select id from scenes where lorebook_id = ${sourceId})`
			)
	).filter((c) => readScenes.has(c.sceneId))

	// Which members stay: one with a version in force, and one something kept names.
	const named = new Set<number>()
	for (const row of readEntries) {
		const f = folded.get(row.id)
		const anchor = f ? (f.lorebookBindingId ?? null) : row.anchorBindingId
		if (anchor != null) named.add(anchor)
	}
	for (const l of linkCandidates) {
		if (l.fromNodeId != null) named.add(l.fromNodeId)
		if (l.toNodeId != null) named.add(l.toNodeId)
	}
	for (const c of sceneCast) named.add(c.bindingId)
	const parentOf = new Map(members.map((m) => [m.id, m.parentNodeId]))
	// A kept member's parent is named too, and its parent's.
	const queue = [...new Set([...versions.keys(), ...named])]
	for (const id of queue) {
		const parent = parentOf.get(id)
		if (parent != null && !named.has(parent) && !versions.has(parent)) {
			named.add(parent)
			queue.push(parent)
		}
	}
	const withoutVersion = [...named].filter(
		(id) => !versions.has(id) && parentOf.has(id)
	)
	const baseOf = new Map<
		number,
		typeof schema.characterVersions.$inferSelect
	>()
	for (const part of chunks(withoutVersion, CHUNK)) {
		const rows = await tx
			.select()
			.from(schema.characterVersions)
			.where(inArray(schema.characterVersions.castMemberId, part))
		for (const r of rows)
			if (r.lorebookId === sourceId && isBaseVersion(r))
				baseOf.set(r.castMemberId!, r)
	}

	// ── Step 1: the exact copy ─────────────────────────────────────────────
	const dup = await duplicateLorebookRows(tx, sourceId, userId, name)
	const copyId = dup.id
	const { maps } = dup

	// ── Flatten the copy, in order ─────────────────────────────────────────
	// 1. Replace versions, links and stats with the ones in force, undated.
	await tx
		.delete(schema.characterVersions)
		.where(eq(schema.characterVersions.lorebookId, copyId))
	const keptMembers: {
		source: number
		version: typeof schema.characterVersions.$inferSelect
		/** A base kept for a named member with no version in force: it keeps its retire mark, so the copy reads it as the source does. */
		keptBase: boolean
	}[] = [
		...[...versions].map(([source, { version }]) => ({
			source,
			version,
			keptBase: false
		})),
		...[...baseOf].map(([source, version]) => ({
			source,
			version,
			keptBase: true
		}))
	]
	const versionRows = keptMembers.flatMap(({ source, version, keptBase }) => {
		const castMemberId = via(maps.bindings, source)
		if (castMemberId == null) return []
		const {
			id: _id,
			createdAt: _c,
			updatedAt: _u,
			writeOrder: _w,
			...v
		} = version
		return [
			{
				...v,
				castMemberId,
				lorebookId: copyId,
				branchId: null,
				year: null,
				month: null,
				day: null,
				historyEntryId: null,
				// The member's base version (`isBaseVersion`): no hour, no life point, no source session.
				atHour: null,
				atMinute: null,
				personalPosition: null,
				sourceSessionId: null,
				sourceMessageId: null,
				validFromMessageId: null,
				retiredOrder: keptBase ? v.retiredOrder : null,
				liftedFromAmendmentId: null
			}
		]
	})
	for (const part of chunks(versionRows, BATCH))
		await insertCharacterVersions(tx, part)

	await tx.delete(nr).where(eq(nr.lorebookId, copyId))
	const linkValues = linkCandidates.flatMap(({ id: _id, ...r }) => {
		const fromNodeId = via(maps.bindings, r.fromNodeId)
		const fromEntryId = via(maps.entries, r.fromEntryId)
		const toNodeId = via(maps.bindings, r.toNodeId)
		const toEntryId = via(maps.entries, r.toEntryId)
		if ((fromNodeId == null) === (fromEntryId == null)) return []
		if ((toNodeId == null) === (toEntryId == null)) return []
		return [
			{
				...r,
				lorebookId: copyId,
				fromNodeId,
				fromEntryId,
				toNodeId,
				toEntryId,
				historyEntryId: null,
				branchId: null,
				sceneId: via(maps.scenes, r.sceneId)
			}
		]
	})
	for (const part of chunks(linkValues, BATCH))
		await tx.insert(nr).values(part)

	const ownerMapOf = (kind: string): IdMap =>
		kind === "lorebook"
			? new Map([[sourceId, copyId]])
			: kind === "cast_member"
				? maps.bindings
				: maps.entries
	await tx
		.delete(av)
		.where(and(sql`${av.sessionId} is null`, statOwnedByBook(av, copyId)))
	await tx
		.delete(ac)
		.where(and(sql`${ac.sessionId} is null`, statOwnedByBook(ac, copyId)))
	const valueRows = valuesInForce.flatMap(
		({ id: _id, createdAt: _c, ...r }) => {
			const ownerId = via(ownerMapOf(r.ownerKind), r.ownerId)
			if (ownerId == null) return []
			return [
				{
					...r,
					ownerId,
					validFromMessageId: null,
					branchId: null,
					historyEntryId: null,
					sceneId: via(maps.scenes, r.sceneId),
					storyClockYear: null,
					storyClockMonth: null,
					storyClockDay: null,
					storyClockHour: null,
					storyClockMinute: null
				}
			]
		}
	)
	for (const part of chunks(valueRows, BATCH))
		await tx.insert(av).values(part)
	const configRows = configsInForce.flatMap(
		({ id: _id, createdAt: _c, ...r }) => {
			const ownerId = via(ownerMapOf(r.ownerKind), r.ownerId)
			if (ownerId == null) return []
			return [
				{
					...r,
					ownerId,
					validFromMessageId: null,
					branchId: null,
					historyEntryId: null,
					sceneId: via(maps.scenes, r.sceneId)
				}
			]
		}
	)
	for (const part of chunks(configRows, BATCH))
		await tx.insert(ac).values(part)

	await tx
		.delete(schema.castPresences)
		.where(eq(schema.castPresences.lorebookId, copyId))
	await tx
		.delete(schema.entryAmendments)
		.where(eq(schema.entryAmendments.lorebookId, copyId))
	await tx
		.delete(schema.castAmendments)
		.where(eq(schema.castAmendments.lorebookId, copyId))

	// 2. Fold the entries that read. `position` is never folded: dated changes do not move rows.
	const copyEntries = await tx
		.select({
			id: e.id,
			typeId: e.typeId,
			fields: e.fields,
			anchorEntryId: e.anchorEntryId
		})
		.from(e)
		.where(eq(e.lorebookId, copyId))
	const copyFields = new Map(copyEntries.map((r) => [r.id, r.fields]))
	for (const row of readEntries) {
		const wire = folded.get(row.id)
		const copyEntryId = maps.entries.get(row.id)
		if (!wire || copyEntryId == null) continue
		const { columns, fields } = splitUpdate(row.typeId, wire)
		delete columns.position
		if ("anchorEntryId" in columns)
			columns.anchorEntryId = via(maps.entries, columns.anchorEntryId)
		if ("anchorBindingId" in columns)
			columns.anchorBindingId = via(
				maps.bindings,
				columns.anchorBindingId
			)
		await tx
			.update(e)
			.set({
				...columns,
				fields: { ...(copyFields.get(copyEntryId) ?? {}), ...fields }
			})
			.where(eq(e.id, copyEntryId))
	}

	// A timeless copy has no Beginning: every kept entry that takes one loses its
	// date parts (it reads Perpetual) and keeps its decay rate.
	for (const row of await tx
		.select({ id: e.id, typeId: e.typeId, fields: e.fields })
		.from(e)
		.where(eq(e.lorebookId, copyId))) {
		if (!takesBeginning(row.typeId)) continue
		const fields = { ...((row.fields ?? {}) as Record<string, unknown>) }
		if (!ENTRY_DATE_PARTS.some((part) => part in fields)) continue
		for (const part of ENTRY_DATE_PARTS) delete fields[part]
		await tx.update(e).set({ fields }).where(eq(e.id, row.id))
	}

	// 3. Unfile the scenes; keep what hung from a history entry or an entry that goes at the top level.
	await tx
		.update(sc)
		.set({ historyEntryId: null })
		.where(eq(sc.lorebookId, copyId))
	const keptCopyEntries = new Set(
		[...keptEntries].map((id) => maps.entries.get(id)!)
	)
	const goneEntries = copyEntries
		.filter((r) => !keptCopyEntries.has(r.id))
		.map((r) => r.id)
	const goneEntrySet = new Set(goneEntries)
	const keptAnchors = copyEntries.filter((r) => keptCopyEntries.has(r.id))
	// A folded anchor replaced the copy's (step 2), so read the anchors again.
	const anchors = new Map<number, number | null>(
		(
			await tx
				.select({ id: e.id, anchorEntryId: e.anchorEntryId })
				.from(e)
				.where(eq(e.lorebookId, copyId))
		).map((r) => [r.id, r.anchorEntryId])
	)
	const unanchor = keptAnchors
		.filter((r) => {
			const anchor = anchors.get(r.id)
			return anchor != null && goneEntrySet.has(anchor)
		})
		.map((r) => r.id)
	for (const part of chunks(unanchor, CHUNK))
		await tx
			.update(e)
			.set({ anchorEntryId: null })
			.where(inArray(e.id, part))

	// 4. Delete what does not read, with every row nothing cascades to.
	const goneMembers = members
		.map((m) => m.id)
		// A member a kept row names stays, even with no version: the copy holds it as the source does.
		.filter((id) => !versions.has(id) && !baseOf.has(id) && !named.has(id))
		.map((id) => maps.bindings.get(id)!)
		.filter((id) => id != null)
	const gonePlaces = copyEntries
		.filter((r) => r.typeId === LOCATION_TYPE_ID && goneEntrySet.has(r.id))
		.map((r) => r.id)
	for (const part of chunks(gonePlaces, CHUNK))
		await deleteOwnedRows(tx, ["location"], part)
	for (const part of chunks(goneMembers, CHUNK))
		await deleteOwnedRows(tx, ["cast_member"], part)

	// References with no foreign key: annotations and suggestions naming a row that goes.
	const goneKeys = new Set([
		...goneEntries.map((id) => `entry:${id}`),
		...goneMembers.map((id) => `cast_member:${id}`)
	])
	if (goneKeys.size > 0) {
		const ann = schema.entryAnnotations
		const held = await tx
			.select({ entryId: ann.entryId, entityKey: ann.entityKey })
			.from(ann)
			.where(
				sql`${ann.entryId} in (select id from lorebook_entries where lorebook_id = ${copyId})`
			)
		for (const a of held)
			if (goneKeys.has(a.entityKey))
				await tx
					.delete(ann)
					.where(
						and(
							eq(ann.entryId, a.entryId),
							eq(ann.entityKey, a.entityKey)
						)
					)
		const bs = schema.bindingSuggestions
		const suggestions = await tx
			.select({
				id: bs.id,
				entityKey: bs.entityKey,
				exampleSourceKind: bs.exampleSourceKind,
				exampleSourceId: bs.exampleSourceId
			})
			.from(bs)
			.where(eq(bs.lorebookId, copyId))
		for (const s of suggestions) {
			if (goneKeys.has(s.entityKey))
				await tx.delete(bs).where(eq(bs.id, s.id))
			else if (
				s.exampleSourceKind === "entry" &&
				s.exampleSourceId != null &&
				goneEntrySet.has(s.exampleSourceId)
			)
				await tx
					.update(bs)
					.set({
						exampleSourceKind: "",
						exampleSourceId: null,
						exampleContext: ""
					})
					.where(eq(bs.id, s.id))
		}
	}

	for (const part of chunks(goneEntries, CHUNK))
		await tx.delete(e).where(inArray(e.id, part))
	for (const part of chunks(goneMembers, CHUNK))
		await tx
			.delete(schema.lorebookBindings)
			.where(inArray(schema.lorebookBindings.id, part))
	const goneScenes = [...maps.scenes]
		.filter(([source]) => !readScenes.has(source))
		.map(([, copy]) => copy)
	for (const part of chunks(goneScenes, CHUNK))
		await tx.delete(sc).where(inArray(sc.id, part))

	// 5. Clear the remaining dates.
	await tx.update(e).set({ branchId: null }).where(eq(e.lorebookId, copyId))
	await tx
		.update(schema.lorebookBindings)
		.set({ historyEntryId: null })
		.where(eq(schema.lorebookBindings.lorebookId, copyId))
	await tx
		.update(sc)
		.set({
			branchId: null,
			openedStoryClockYear: null,
			openedStoryClockMonth: null,
			openedStoryClockDay: null,
			openedStoryClockHour: null,
			openedStoryClockMinute: null,
			closedStoryClockYear: null,
			closedStoryClockMonth: null,
			closedStoryClockDay: null,
			closedStoryClockHour: null,
			closedStoryClockMinute: null
		})
		.where(eq(sc.lorebookId, copyId))
	await tx
		.update(schema.lorebooks)
		.set({
			storyClockYear: null,
			storyClockMonth: null,
			storyClockDay: null,
			storyClockHour: null,
			storyClockMinute: null,
			storyCalendar: null
		})
		.where(eq(schema.lorebooks.id, copyId))

	// 6. Lines go, then the switch.
	await tx
		.delete(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, copyId))
	await tx
		.update(schema.lorebooks)
		.set({ timelineEnabled: false })
		.where(eq(schema.lorebooks.id, copyId))

	return dup
}
