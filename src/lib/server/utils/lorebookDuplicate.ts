/**
 * A copy of a lorebook, made row for row inside one transaction.
 *
 * ⚠ **Duplicate is an exact copy** (owner ruling 2026-09-28, superseding the
 * earlier "one copier, and it is the exporter" design). A copy that went out
 * through the file format and back in carried only what the file carried —
 * main-line entries only in spirit, no branches, no amendments, no presences,
 * no tags, places and items flattened to World lore, and unowned cards
 * unlinked. So this reads every row the book owns and writes it again under
 * new ids, remapping every reference between them:
 *
 * - branches (with the parent chain — a fork of a fork keeps its grandparent —
 *   and fork dates), entries (every line, archived rows, provenance, positions,
 *   declared fields such as an item's supply), bindings (the real
 *   `characterId`, even for a card another user owns; tokens; sprite set; the
 *   book's `nextBindingNumber`), entry and cast amendments (ids inside an
 *   amendment's `fields` are remapped too), cast presences, links of both
 *   endpoint kinds, scenes and their cast, tags, the story calendar and clock,
 *   the attribute rows the book and its members own at the template layer,
 *   dismissed duplicate pairs, binding suggestions, entry vectors and
 *   entry annotations.
 *
 * What deliberately does NOT travel:
 * - a scene's **session capture** (`sessionId`, `selectedMessageIds`) — those
 *   name messages in a session that reads the ORIGINAL book; a copy that kept
 *   them would show every captured scene twice in that session.
 * - session-layer attribute rows (they belong to the session, not the book).
 * - `binding_merge_logs` — an undo record of an operation done to the
 *   original's rows; undoing it on the copy would restore into the wrong book.
 * - the uuid (the copy is a new book; a re-import of the original's file must
 *   still find the original).
 *
 * ⚠ Every statement runs on `tx`. The outer `db` inside this transaction
 * deadlocks PGlite silently.
 */

import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"

type IdMap = Map<number, number>

/** A nullable reference through a map; a reference the map lacks is dropped. */
const via = (map: IdMap, id: number | null | undefined): number | null =>
	id == null ? null : (map.get(id) ?? null)

/**
 * Ids an amendment's `fields` may overlay (`changedFields` writes wire keys),
 * and which map each one is remapped through. Any other key is copied as is —
 * `characterId` included, because a card is not a row the book owns.
 */
function remapAmendedFields(
	fields: Record<string, unknown> | null | undefined,
	maps: { entries: IdMap; bindings: IdMap; scenes: IdMap }
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...(fields ?? {}) }
	const through: Record<string, IdMap> = {
		lorebookBindingId: maps.bindings,
		anchorBindingId: maps.bindings,
		parentNodeId: maps.bindings,
		anchorEntryId: maps.entries,
		historyEntryId: maps.entries,
		sceneId: maps.scenes
	}
	for (const [key, map] of Object.entries(through)) {
		if (!(key in out)) continue
		const v = out[key]
		out[key] = typeof v === "number" ? via(map, v) : v
	}
	return out
}

/** Attribute owner kinds a book's template layer holds, and whose id each is. */
const BOOK_OWNED_ATTRIBUTE_KINDS = ["lorebook", "cast_member", "location"]

export interface DuplicatedLorebook {
	id: number
	/** Source id → copy id, per table — returned for tests and callers. */
	maps: {
		branches: IdMap
		bindings: IdMap
		entries: IdMap
		scenes: IdMap
	}
}

/**
 * Copies `sourceId` (which the caller has already confirmed `userId` owns)
 * into a new book named `name`, owned by `userId`. Must be called with a
 * transaction handle.
 */
export async function duplicateLorebookRows(
	tx: Db,
	sourceId: number,
	userId: number,
	name: string
): Promise<DuplicatedLorebook> {
	const [source] = await tx
		.select()
		.from(schema.lorebooks)
		.where(
			and(
				eq(schema.lorebooks.id, sourceId),
				eq(schema.lorebooks.userId, userId)
			)
		)
	if (!source) throw new Error("Lorebook not found.")

	const {
		id: _id,
		uuid: _uuid,
		createdAt: _createdAt,
		updatedAt: _updatedAt,
		...bookColumns
	} = source
	const [book] = await tx
		.insert(schema.lorebooks)
		.values({ ...bookColumns, name, userId })
		.returning({ id: schema.lorebooks.id })
	const newId = book.id

	// ── Branches — inserted flat, then the parent chain is written once every
	// branch has its new id (a fork of a fork names a branch that may come
	// later in id order after an edit).
	const branches = new Map<number, number>()
	const sourceBranches = await tx
		.select()
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, sourceId))
	for (const { id, ...row } of sourceBranches) {
		const [ins] = await tx
			.insert(schema.lorebookBranches)
			.values({ ...row, lorebookId: newId, forkedFromBranchId: null })
			.returning({ id: schema.lorebookBranches.id })
		branches.set(id, ins.id)
	}
	for (const row of sourceBranches) {
		if (row.forkedFromBranchId == null) continue
		await tx
			.update(schema.lorebookBranches)
			.set({ forkedFromBranchId: via(branches, row.forkedFromBranchId) })
			.where(eq(schema.lorebookBranches.id, branches.get(row.id)!))
	}

	// ── Bindings — their scene / history / parent references are written after
	// those rows exist.
	const bindings = new Map<number, number>()
	const sourceBindings = await tx
		.select()
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, sourceId))
	for (const { id, ...row } of sourceBindings) {
		const [ins] = await tx
			.insert(schema.lorebookBindings)
			.values({
				...row,
				lorebookId: newId,
				parentNodeId: null,
				sceneId: null,
				historyEntryId: null
			})
			.returning({ id: schema.lorebookBindings.id })
		bindings.set(id, ins.id)
	}

	// ── Entries — every line, archived rows included. The `parent` role
	// (anchorEntryId) is written in a second pass.
	const entries = new Map<number, number>()
	const sourceEntries = await tx
		.select()
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, sourceId))
	for (const { id, ...row } of sourceEntries) {
		const [ins] = await tx
			.insert(schema.lorebookEntries)
			.values({
				...row,
				lorebookId: newId,
				anchorBindingId: via(bindings, row.anchorBindingId),
				anchorEntryId: null,
				branchId: via(branches, row.branchId)
			})
			.returning({ id: schema.lorebookEntries.id })
		entries.set(id, ins.id)
	}
	for (const row of sourceEntries) {
		if (row.anchorEntryId == null) continue
		await tx
			.update(schema.lorebookEntries)
			.set({ anchorEntryId: via(entries, row.anchorEntryId) })
			.where(eq(schema.lorebookEntries.id, entries.get(row.id)!))
	}

	const sourceEntryIds = [...entries.keys()]
	if (sourceEntryIds.length > 0) {
		const vectors = await tx
			.select()
			.from(schema.lorebookEntryVectors)
			.where(inArray(schema.lorebookEntryVectors.entryId, sourceEntryIds))
		if (vectors.length > 0)
			await tx.insert(schema.lorebookEntryVectors).values(
				vectors.map((v) => ({
					...v,
					entryId: entries.get(v.entryId)!
				}))
			)
		const annotations = await tx
			.select()
			.from(schema.entryAnnotations)
			.where(inArray(schema.entryAnnotations.entryId, sourceEntryIds))
		if (annotations.length > 0)
			await tx.insert(schema.entryAnnotations).values(
				annotations.map((a) => ({
					...a,
					entryId: entries.get(a.entryId)!,
					refEntryId: via(entries, a.refEntryId)
				}))
			)
	}

	// ── Scenes and their cast. The session capture stays with the original.
	const scenes = new Map<number, number>()
	const sourceScenes = await tx
		.select()
		.from(schema.scenes)
		.where(eq(schema.scenes.lorebookId, sourceId))
	for (const { id, ...row } of sourceScenes) {
		const historyEntryId = via(entries, row.historyEntryId)
		if (historyEntryId == null) continue
		const [ins] = await tx
			.insert(schema.scenes)
			.values({
				...row,
				lorebookId: newId,
				historyEntryId,
				branchId: via(branches, row.branchId),
				sessionId: null,
				selectedMessageIds: []
			})
			.returning({ id: schema.scenes.id })
		scenes.set(id, ins.id)
	}
	const sourceSceneIds = [...scenes.keys()]
	if (sourceSceneIds.length > 0) {
		const cast = await tx
			.select()
			.from(schema.sceneCharacters)
			.where(inArray(schema.sceneCharacters.sceneId, sourceSceneIds))
		const rows = cast
			.map(({ id: _id, ...c }) => ({
				...c,
				sceneId: scenes.get(c.sceneId)!,
				bindingId: via(bindings, c.bindingId)
			}))
			.filter((c): c is typeof c & { bindingId: number } => c.bindingId != null)
		if (rows.length > 0) await tx.insert(schema.sceneCharacters).values(rows)
	}

	// Binding references that needed scenes and entries to exist.
	for (const row of sourceBindings) {
		if (
			row.parentNodeId == null &&
			row.sceneId == null &&
			row.historyEntryId == null
		)
			continue
		await tx
			.update(schema.lorebookBindings)
			.set({
				parentNodeId: via(bindings, row.parentNodeId),
				sceneId: via(scenes, row.sceneId),
				historyEntryId: via(entries, row.historyEntryId)
			})
			.where(eq(schema.lorebookBindings.id, bindings.get(row.id)!))
	}

	// ── Links, both endpoint kinds, with their dates (history entry / scene)
	// and their line.
	const sourceLinks = await tx
		.select()
		.from(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, sourceId))
	for (const { id: _id, ...row } of sourceLinks) {
		const fromNodeId = via(bindings, row.fromNodeId)
		const fromEntryId = via(entries, row.fromEntryId)
		const toNodeId = via(bindings, row.toNodeId)
		const toEntryId = via(entries, row.toEntryId)
		// An endpoint outside this book cannot be carried; half a link is not
		// a link.
		if ((fromNodeId == null) === (fromEntryId == null)) continue
		if ((toNodeId == null) === (toEntryId == null)) continue
		await tx.insert(schema.narrativeRelationships).values({
			...row,
			lorebookId: newId,
			fromNodeId,
			fromEntryId,
			toNodeId,
			toEntryId,
			historyEntryId: via(entries, row.historyEntryId),
			sceneId: via(scenes, row.sceneId),
			branchId: via(branches, row.branchId)
		})
	}

	const maps = { entries, bindings, scenes }

	// ── Amendments and presences.
	const entryAmendments = await tx
		.select()
		.from(schema.entryAmendments)
		.where(eq(schema.entryAmendments.lorebookId, sourceId))
	const entryAmendmentRows = entryAmendments.flatMap(({ id: _id, ...a }) => {
		const entryId = via(entries, a.entryId)
		return entryId == null
			? []
			: [
					{
						...a,
						lorebookId: newId,
						entryId,
						branchId: via(branches, a.branchId),
						historyEntryId: via(entries, a.historyEntryId),
						fields: remapAmendedFields(a.fields, maps)
					}
				]
	})
	if (entryAmendmentRows.length > 0)
		await tx.insert(schema.entryAmendments).values(entryAmendmentRows)

	const castAmendments = await tx
		.select()
		.from(schema.castAmendments)
		.where(eq(schema.castAmendments.lorebookId, sourceId))
	const castAmendmentRows = castAmendments.flatMap(({ id: _id, ...a }) => {
		const lorebookBindingId = via(bindings, a.lorebookBindingId)
		return lorebookBindingId == null
			? []
			: [
					{
						...a,
						lorebookId: newId,
						lorebookBindingId,
						branchId: via(branches, a.branchId),
						historyEntryId: via(entries, a.historyEntryId),
						fields: remapAmendedFields(a.fields, maps)
					}
				]
	})
	if (castAmendmentRows.length > 0)
		await tx.insert(schema.castAmendments).values(castAmendmentRows)

	const presences = await tx
		.select()
		.from(schema.castPresences)
		.where(eq(schema.castPresences.lorebookId, sourceId))
	const presenceRows = presences.flatMap(({ id: _id, ...p }) => {
		const lorebookBindingId = via(bindings, p.lorebookBindingId)
		return lorebookBindingId == null
			? []
			: [
					{
						...p,
						lorebookId: newId,
						lorebookBindingId,
						branchId: via(branches, p.branchId)
					}
				]
	})
	if (presenceRows.length > 0)
		await tx.insert(schema.castPresences).values(presenceRows)

	// ── Tags.
	const tags = await tx
		.select({ tagId: schema.lorebookTags.tagId })
		.from(schema.lorebookTags)
		.where(eq(schema.lorebookTags.lorebookId, sourceId))
	if (tags.length > 0)
		await tx
			.insert(schema.lorebookTags)
			.values(tags.map((t) => ({ lorebookId: newId, tagId: t.tagId })))
			.onConflictDoNothing()

	// ── Attribute sheets and values the book and its members own (template
	// layer only — a session's rows belong to the session).
	const ownerMap = (kind: string): IdMap =>
		kind === "lorebook"
			? new Map([[sourceId, newId]])
			: kind === "cast_member"
				? bindings
				: entries
	for (const table of [
		schema.attributeConfigs,
		schema.attributeValues
	] as const) {
		for (const kind of BOOK_OWNED_ATTRIBUTE_KINDS) {
			const map = ownerMap(kind)
			const ownerIds = [...map.keys()]
			if (ownerIds.length === 0) continue
			const rows: any[] = await tx
				.select()
				.from(table as any)
				.where(
					and(
						eq((table as any).ownerKind, kind),
						inArray((table as any).ownerId, ownerIds),
						isNull((table as any).sessionId)
					)
				)
			const copies = rows.map(({ id: _id, ...r }) => ({
				...r,
				ownerId: map.get(r.ownerId)!,
				// No FK on branch_id (see the schema), but a copy must still
				// name the COPY's branch, never the original's.
				branchId: r.branchId == null ? null : via(branches, r.branchId),
				historyEntryId: via(entries, r.historyEntryId),
				sceneId: via(scenes, r.sceneId)
			}))
			if (copies.length > 0)
				await tx.insert(table as any).values(copies)
		}
	}

	// ── Curation the user already did on this cast.
	const dismissed = await tx
		.select()
		.from(schema.dismissedDuplicatePairs)
		.where(eq(schema.dismissedDuplicatePairs.lorebookId, sourceId))
	const dismissedRows = dismissed.flatMap(({ id: _id, ...d }) => {
		const a = via(bindings, d.bindingIdA)
		const b = via(bindings, d.bindingIdB)
		return a == null || b == null
			? []
			: [{ ...d, lorebookId: newId, bindingIdA: a, bindingIdB: b }]
	})
	if (dismissedRows.length > 0)
		await tx.insert(schema.dismissedDuplicatePairs).values(dismissedRows)

	const suggestions = await tx
		.select()
		.from(schema.bindingSuggestions)
		.where(eq(schema.bindingSuggestions.lorebookId, sourceId))
	const suggestionRows = suggestions.map(({ id: _id, ...s }) => ({
		...s,
		lorebookId: newId,
		resolvedBindingId: via(bindings, s.resolvedBindingId),
		exampleSourceId:
			s.exampleSourceKind === "entry"
				? via(entries, s.exampleSourceId)
				: s.exampleSourceId
	}))
	if (suggestionRows.length > 0)
		await tx.insert(schema.bindingSuggestions).values(suggestionRows)

	// Keep the counter past every token the copy holds, whatever the source's
	// column said (a hand-edited or legacy book may be behind its own tokens).
	let maxToken = 0
	for (const row of sourceBindings) {
		const n = Number(/:(\d+)\}\}?$/.exec(row.binding)?.[1])
		if (Number.isInteger(n) && n > maxToken) maxToken = n
	}
	if (maxToken > 0)
		await tx
			.update(schema.lorebooks)
			.set({
				nextBindingNumber: sql`GREATEST(${schema.lorebooks.nextBindingNumber}, ${maxToken + 1})`
			})
			.where(eq(schema.lorebooks.id, newId))

	return { id: newId, maps: { branches, bindings, entries, scenes } }
}
