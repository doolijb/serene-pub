/**
 * Absorbing one cast member into another and taking it back:
 * `narrativeGraph:mergeNode` and `narrativeGraph:undoMerge`, with the
 * absorbed member's own story (snapshot, restore) and the merge logs' cast
 * tag rewrite a node delete also uses.
 */

import { db } from "$lib/server/db"
import { primerRowEditProblem } from "$lib/server/plugins/providedMarks"
import * as schema from "$lib/server/db/schema"
import {
	eq,
	asc,
	and,
	or,
	isNotNull,
	ne,
	sql,
	inArray,
	type SQL
} from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { CHARACTER_LORE_TYPE_ID } from "$lib/server/utils/lorebookEntries"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import {
	castFor,
	readSceneCasts,
	repointSceneCast,
	writeSceneCast
} from "$lib/server/utils/sceneCast"
import {
	deriveSceneMentions,
	mentionedSoFar
} from "$lib/server/utils/sceneMentions"
import {
	assertRelationshipWrite,
	LINKED_THAT_WAY,
	RelationshipRefusal,
	type RelationshipWrite
} from "$lib/server/utils/relationshipGuards"
import { refusable } from "$lib/server/sockets/refusable"
import {
	CAST_VERSION_TAG_COLUMNS,
	insertCastMember,
	insertCharacterVersions,
	writeCastVersion,
	type CastVersionChanges
} from "$lib/server/characters/versions"
import { CHARACTER_PROFILE_FIELDS } from "$lib/shared/characters/profile"
import { deleteOwnerStats } from "$lib/server/state/lorebookState"
import { pendingChangesFor } from "$lib/server/lorebooks/tableRegistry"
import {
	castTag,
	castTagNumber,
	revertCastTagRewrites,
	rewriteBookCastTags,
	rewriteCastTagsDeep,
	type CastTagReplacer,
	type CastTagRewrite,
	type CastTagRows
} from "$lib/server/utils/castTags"
import { findOwnedBook } from "$lib/server/utils/ownedBook"
import {
	buildDuplicateCandidates,
	sayingOf,
	storyStatesOf,
	withStoryStates,
	afterCastTagRewrite
} from "./narrativeGraph.shared"

// ─── A cast member's own story (absorb / undo) ────────────────────────────────

/**
 * Where an absorb files the absorbed member's dated story inside the log's
 * `absorbedSnapshot`.
 *
 * A key no binding column can ever be spelled as, so the snapshot stays "the
 * row, verbatim" for everything else and undo can take this off before it
 * re-inserts the row. Kept in the snapshot rather than a column of its own
 * because it IS the absorbed member's — their amendments, their presences,
 * their stats and stat sheets — and a new column is a migration for no gain.
 */
const MEMBER_STORY_KEY = "$memberStory"

/** The rows that belong to one cast member and go when the member does. */
type MemberStory = {
	castAmendments: Record<string, unknown>[]
	castPresences: Record<string, unknown>[]
	attributeValues: Record<string, unknown>[]
	attributeConfigs: Record<string, unknown>[]
	/**
	 * Their `owner_sheets` rows. Absent from a log whose absorb did not keep
	 * sheets: that undo has none to put back.
	 */
	ownerSheets?: Record<string, unknown>[]
	/**
	 * The changes to their stats still waiting in a session's review
	 * (`pendingChangesFor`). Absent from a log whose absorb did not keep
	 * them: that undo has none to put back.
	 */
	stateProposals?: Record<string, unknown>[]
	/**
	 * Their cast versions (`character_versions` rows), base first. Absent from
	 * a log whose absorb did not keep them: that undo makes the base from the
	 * saved row's columns and has nothing dated to put back.
	 */
	castVersions?: Record<string, unknown>[]
}

/**
 * Rewrite member `from`'s cast tags in the lore text a book's merge logs keep
 * (A16) — what `rewriteBookCastTags` does for the live rows, on the saved side.
 *
 * A delete runs it. Two things there hold lore text an undo puts back:
 *  - the absorbed member's **saved copy** — their summary, their dated
 *    changes, their presence notes, the links the merge removed. Left alone,
 *    an undo brought back a tag for a member deleted since, naming nobody,
 *    where every live text reads their name.
 *  - the **undo notes'** `before`. An undo finds the tags its merge rewrote
 *    by position, against the row's layout as it reads now; a delete that
 *    wrote a name into the row changes that layout, so it writes the same
 *    name into `before` and the two keep matching.
 *
 * A merge never needs it: it swaps a tag for a tag, which moves no position,
 * and a saved copy naming a member merged away since is resolved when that
 * copy comes back (`resolveRestoredCastTags`).
 */
async function rewriteMergeLogCastTags(
	tx: Db,
	lorebookId: number,
	from: number,
	to: string
) {
	const replace: CastTagReplacer = (n) => (n === from ? to : null)
	const retext = <T extends Record<string, unknown>>(
		row: T,
		columns: readonly string[]
	): T => {
		const out: Record<string, unknown> = { ...row }
		for (const column of columns)
			if (out[column] != null)
				out[column] = rewriteCastTagsDeep(out[column], replace)
		return out as T
	}
	const logs = await tx
		.select({
			id: schema.bindingMergeLogs.id,
			absorbedSnapshot: schema.bindingMergeLogs.absorbedSnapshot,
			deletedRelationships: schema.bindingMergeLogs.deletedRelationships,
			tagRewrites: schema.bindingMergeLogs.tagRewrites
		})
		.from(schema.bindingMergeLogs)
		.where(eq(schema.bindingMergeLogs.lorebookId, lorebookId))
	for (const log of logs) {
		const snapshot = retext(
			log.absorbedSnapshot as Record<string, unknown>,
			["summary"]
		)
		const story = snapshot[MEMBER_STORY_KEY] as MemberStory | undefined
		if (story)
			snapshot[MEMBER_STORY_KEY] = {
				...story,
				castAmendments: story.castAmendments.map((r) =>
					retext(r, ["fields"])
				),
				castPresences: story.castPresences.map((r) =>
					retext(r, ["note"])
				),
				castVersions: story.castVersions?.map((r) =>
					retext(r, CAST_VERSION_TAG_COLUMNS)
				)
			}
		const deletedRelationships = (
			log.deletedRelationships as Record<string, unknown>[]
		).map((r) => retext(r, ["title", "description", "reason"]))
		const tagRewrites = ((log.tagRewrites ?? []) as CastTagRewrite[]).map(
			(note) => ({
				...note,
				before: rewriteCastTagsDeep(note.before, replace)
			})
		)
		const next = {
			absorbedSnapshot: snapshot,
			deletedRelationships,
			tagRewrites
		}
		const was = {
			absorbedSnapshot: log.absorbedSnapshot,
			deletedRelationships: log.deletedRelationships,
			tagRewrites: log.tagRewrites ?? []
		}
		if (JSON.stringify(next) === JSON.stringify(was)) continue
		await tx
			.update(schema.bindingMergeLogs)
			.set(next as any)
			.where(eq(schema.bindingMergeLogs.id, log.id))
	}
}

/**
 * Cast tags in the rows an undo just put back, read against the book as it
 * stands (A16).
 *
 * The saved copy is as the merge found it, and the book has moved on since:
 *  - another member merged away since is named by their survivor's tag,
 *    exactly as that merge rewrote every live text — and the rewrite is
 *    noted on THAT merge's log, so undoing it later puts their tag back here
 *    too;
 *  - the member themselves, back under a fresh tag (a member who is not
 *    blank holds their old one), is named by it.
 * A member deleted since was already written in by name, into the saved copy
 * (`rewriteMergeLogCastTags`).
 */
async function resolveRestoredCastTags(
	tx: Db,
	lorebookId: number,
	undoneLogId: number,
	restored: CastTagRows,
	own: { from: number | null; as: string }
) {
	if (own.from !== null && castTag(own.from) !== own.as)
		await rewriteBookCastTags(tx, lorebookId, own.from, own.as, restored)
	const others = await tx
		.select({
			id: schema.bindingMergeLogs.id,
			survivorId: schema.bindingMergeLogs.survivorId,
			absorbedSnapshot: schema.bindingMergeLogs.absorbedSnapshot,
			tagRewrites: schema.bindingMergeLogs.tagRewrites
		})
		.from(schema.bindingMergeLogs)
		.where(
			and(
				eq(schema.bindingMergeLogs.lorebookId, lorebookId),
				ne(schema.bindingMergeLogs.id, undoneLogId),
				isNotNull(schema.bindingMergeLogs.survivorId)
			)
		)
		.orderBy(asc(schema.bindingMergeLogs.id))
	for (const other of others) {
		const absorbed = castTagNumber(
			(other.absorbedSnapshot as Record<string, unknown>).binding
		)
		if (absorbed === null) continue
		const [survivor] = await tx
			.select({ binding: schema.lorebookBindings.binding })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, other.survivorId!))
		if (!survivor || castTagNumber(survivor.binding) === null) continue
		const { rewrites } = await rewriteBookCastTags(
			tx,
			lorebookId,
			absorbed,
			survivor.binding,
			restored
		)
		if (rewrites.length === 0) continue
		await tx
			.update(schema.bindingMergeLogs)
			.set({
				tagRewrites: [
					...((other.tagRewrites ?? []) as CastTagRewrite[]),
					...rewrites
				]
			})
			.where(eq(schema.bindingMergeLogs.id, other.id))
	}
}

/**
 * A member nobody has filled in: no card, no name, no summary, no aliases, no
 * sprite set, no state or visibility but the defaults, no scene, date or
 * parent — what the pre-A16 entry save minted over a merged member's tag.
 * Anything a person set on it makes it somebody.
 */
function isBlankMember(m: {
	characterId: number | null
	name: string | null
	summary: string | null
	aliases: string[] | null
	absorbedAliases: string[] | null
	spriteSet: string | null
	nodeState: string
	nodeVisibility: string
	sceneId: number | null
	historyEntryId: number | null
	parentNodeId: number | null
}) {
	return (
		m.characterId == null &&
		!m.name?.trim() &&
		!m.summary?.trim() &&
		(m.aliases ?? []).length === 0 &&
		(m.absorbedAliases ?? []).length === 0 &&
		!m.spriteSet?.trim() &&
		m.nodeState === "active" &&
		m.nodeVisibility === "normal" &&
		m.sceneId == null &&
		m.historyEntryId == null &&
		m.parentNodeId == null
	)
}

/**
 * Whether anything points at a cast member: a relationship end, a place in a
 * scene, lore filed under them, a member filed under them, a dated change or
 * presence, an attribute row, a sheet they have, a pending change to their
 * state, a resolved suggestion, or a merge log (as its survivor, or in the
 * links it moved or deleted). Their cast tag in text is not asked: the caller
 * knows what the text names.
 */
async function memberIsLinked(
	tx: Db,
	lorebookId: number,
	bindingId: number
): Promise<boolean> {
	const any = async (table: any, where: SQL | undefined) =>
		(await tx.select({ id: table.id }).from(table).where(where).limit(1))
			.length > 0
	const r = schema.narrativeRelationships
	const ownedBy = <T extends { ownerKind: any; ownerId: any }>(t: T) =>
		and(eq(t.ownerKind, "cast_member"), eq(t.ownerId, bindingId))
	if (
		(await any(r, or(eq(r.fromNodeId, bindingId), eq(r.toNodeId, bindingId)))) ||
		(await any(
			schema.sceneCharacters,
			eq(schema.sceneCharacters.bindingId, bindingId)
		)) ||
		(await any(
			schema.lorebookEntries,
			eq(schema.lorebookEntries.anchorBindingId, bindingId)
		)) ||
		(await any(
			schema.lorebookBindings,
			eq(schema.lorebookBindings.parentNodeId, bindingId)
		)) ||
		(await any(
			schema.castAmendments,
			eq(schema.castAmendments.lorebookBindingId, bindingId)
		)) ||
		// A cast version that is not the base: a dated change, one on a
		// line or at a life point, or one a session wrote.
		(await any(
			schema.characterVersions,
			and(
				eq(schema.characterVersions.castMemberId, bindingId),
				or(
					isNotNull(schema.characterVersions.branchId),
					isNotNull(schema.characterVersions.year),
					isNotNull(schema.characterVersions.personalPosition),
					isNotNull(schema.characterVersions.sourceSessionId)
				)
			)
		)) ||
		(await any(
			schema.castPresences,
			eq(schema.castPresences.lorebookBindingId, bindingId)
		)) ||
		(await any(schema.attributeValues, ownedBy(schema.attributeValues))) ||
		(await any(schema.attributeConfigs, ownedBy(schema.attributeConfigs))) ||
		(await any(schema.ownerSheets, ownedBy(schema.ownerSheets))) ||
		(await any(
			schema.stateProposals,
			pendingChangesFor(["cast_member"], [bindingId])
		)) ||
		(await any(
			schema.bindingSuggestions,
			eq(schema.bindingSuggestions.resolvedBindingId, bindingId)
		))
	)
		return true
	const logs = await tx
		.select({
			survivorId: schema.bindingMergeLogs.survivorId,
			relationshipRewrites: schema.bindingMergeLogs.relationshipRewrites,
			deletedRelationships: schema.bindingMergeLogs.deletedRelationships
		})
		.from(schema.bindingMergeLogs)
		.where(eq(schema.bindingMergeLogs.lorebookId, lorebookId))
	const names = (rel: {
		fromNodeId?: unknown
		toNodeId?: unknown
		oldFromNodeId?: unknown
		oldToNodeId?: unknown
	}) =>
		[rel.fromNodeId, rel.toNodeId, rel.oldFromNodeId, rel.oldToNodeId].includes(
			bindingId
		)
	return logs.some(
		(log) =>
			log.survivorId === bindingId ||
			(log.relationshipRewrites as Record<string, unknown>[]).some(names) ||
			(log.deletedRelationships as Record<string, unknown>[]).some(names)
	)
}

/**
 * Read a cast member's dated story, before an absorb takes it away.
 *
 * Amendments and presences hang off the binding with `ON DELETE CASCADE`, so
 * deleting the absorbed row deletes them; stats and stat sheets name the
 * member by a plain `(owner_kind, owner_id)` pair with no key, and pending
 * changes name them in their payload, and those are deleted by hand
 * (`deleteMemberStats`). All six are snapshotted here so an undo can put the
 * member back as they were, not as a bare row. Their cast versions go with
 * the row too (`ON DELETE CASCADE`) and are snapshotted with the rest.
 */
async function snapshotMemberStory(
	tx: Db,
	bindingId: number
): Promise<MemberStory> {
	const castAmendments = await tx
		.select()
		.from(schema.castAmendments)
		.where(eq(schema.castAmendments.lorebookBindingId, bindingId))
	const castPresences = await tx
		.select()
		.from(schema.castPresences)
		.where(eq(schema.castPresences.lorebookBindingId, bindingId))
	const ownedBy = <T extends { ownerKind: any; ownerId: any }>(t: T) =>
		and(eq(t.ownerKind, "cast_member"), eq(t.ownerId, bindingId))
	const attributeValues = await tx
		.select()
		.from(schema.attributeValues)
		.where(ownedBy(schema.attributeValues))
	const attributeConfigs = await tx
		.select()
		.from(schema.attributeConfigs)
		.where(ownedBy(schema.attributeConfigs))
	const ownerSheets = await tx
		.select()
		.from(schema.ownerSheets)
		.where(ownedBy(schema.ownerSheets))
	const stateProposals = await tx
		.select()
		.from(schema.stateProposals)
		.where(pendingChangesFor(["cast_member"], [bindingId]))
	const castVersions = await tx
		.select()
		.from(schema.characterVersions)
		.where(eq(schema.characterVersions.castMemberId, bindingId))
		.orderBy(asc(schema.characterVersions.id))
	return {
		castAmendments,
		castPresences,
		attributeValues,
		attributeConfigs,
		ownerSheets,
		stateProposals,
		castVersions
	}
}

/**
 * Delete the stats a cast member owns: values, configurations and sheets,
 * and the changes to them still waiting in a session's review.
 *
 * The other half of their story cascades with the binding; these have no key
 * to cascade on, so every path that removes a member (absorb, delete) removes
 * them by hand in the same transaction (`deleteOwnerStats`).
 */
async function deleteMemberStats(tx: Db, bindingId: number) {
	await deleteOwnerStats(tx, ["cast_member"], [bindingId])
}

/** Which of `ids` still exist in `table` — one query per table. */
async function stillThere(
	tx: Db,
	table: any,
	ids: readonly (number | null | undefined)[]
): Promise<Set<number>> {
	const wanted = [
		...new Set(ids.filter((id): id is number => typeof id === "number"))
	]
	if (wanted.length === 0) return new Set()
	const rows: { id: number }[] = await tx
		.select({ id: table.id })
		.from(table)
		.where(inArray(table.id, wanted))
	return new Set(rows.map((r) => r.id))
}

/**
 * A snapshotted row made insertable again: no id (it returns under a new one),
 * and every timestamp revived — a JSON snapshot hands them back as ISO strings,
 * which a `timestamp` column refuses.
 */
function reviveRow(row: Record<string, unknown>): Record<string, any> {
	const { id: _id, ...rest } = row
	for (const key of ["createdAt", "updatedAt"])
		if (typeof rest[key] === "string")
			rest[key] = new Date(rest[key] as string)
	return rest
}

/**
 * Put a cast member's dated story back onto their recreated row.
 *
 * What the snapshot names may have gone since the absorb, and the undo must not
 * fail on it. A row whose LINE is gone (its branch, or its session for a
 * session-layer row) went with that line and is skipped, as is a sheet row
 * whose sheet has been deleted; a row whose MOMENT is gone (a history entry, a
 * scene) keeps its value and loses the pointer, exactly as the foreign key's
 * own `SET NULL` would have done.
 *
 * Returns how many rows could not be put back.
 */
async function restoreMemberStory(
	tx: Db,
	story: MemberStory,
	newBindingId: number,
	versions: {
		/** The recreated member's base version (`insertCastMember`'s); null for an overlay row. */
		base: typeof schema.characterVersions.$inferSelect | null
		lorebookId: number
		writtenBy: string
	}
): Promise<number> {
	const ownerSheets = story.ownerSheets ?? []
	// A waiting change names its owner in its payload: pointed at the
	// recreated row there.
	const stateProposals = (story.stateProposals ?? []).map(
		(row): Record<string, unknown> => {
			const payload = row.payload as { owner?: Record<string, unknown> } | null
			return {
				...row,
				payload: { ...payload, owner: { ...payload?.owner, id: newBindingId } }
			}
		}
	)
	const castVersions = story.castVersions ?? []
	const all = [
		...story.castAmendments,
		...story.castPresences,
		...story.attributeValues,
		...story.attributeConfigs,
		...ownerSheets,
		...stateProposals,
		...castVersions
	]
	if (all.length === 0) return 0
	const col = (key: string) => all.map((r) => r[key] as number | null)
	// One after another, not `Promise.all`: these run on the transaction's
	// one connection either way, and sequential is what keeps it that way.
	const branches = await stillThere(
		tx,
		schema.lorebookBranches,
		col("branchId")
	)
	const historyEntries = await stillThere(
		tx,
		schema.lorebookEntries,
		col("historyEntryId")
	)
	const scenes = await stillThere(tx, schema.scenes, col("sceneId"))
	const sessions = await stillThere(tx, schema.sessions, [
		...col("sessionId"),
		...col("sourceSessionId")
	])
	const messages = await stillThere(tx, schema.messages, [
		...col("validFromMessageId"),
		...col("messageId")
	])
	const sheetIds = [
		...new Set(
			ownerSheets
				.map((r) => r.sheetId)
				.filter((id): id is string => typeof id === "string")
		)
	]
	const sheets = new Set(
		sheetIds.length === 0
			? []
			: (
					await tx
						.select({ id: schema.attributeSheets.id })
						.from(schema.attributeSheets)
						.where(inArray(schema.attributeSheets.id, sheetIds))
				).map((r) => r.id)
	)
	const gone = (set: Set<number>, id: unknown) =>
		typeof id === "number" && !set.has(id)
	let skipped = 0

	/**
	 * Every `branch_id` in the story is keyed to `lorebook_branches`, the
	 * attribute tables' included, so a row on a deleted line would fail its
	 * insert: it is skipped and counted instead.
	 */
	const revive = (row: Record<string, unknown>) => {
		if (gone(branches, row.branchId)) return null
		if (gone(sessions, row.sessionId)) return null
		if (gone(messages, row.validFromMessageId)) return null
		if (gone(messages, row.messageId)) return null
		if (typeof row.sheetId === "string" && !sheets.has(row.sheetId))
			return null
		const out = reviveRow(row)
		if (gone(historyEntries, row.historyEntryId)) out.historyEntryId = null
		if ("sceneId" in out && gone(scenes, row.sceneId)) out.sceneId = null
		return out
	}

	const tables: [Record<string, unknown>[], any, Record<string, number>][] = [
		[story.castAmendments, schema.castAmendments, { lorebookBindingId: newBindingId }],
		[story.castPresences, schema.castPresences, { lorebookBindingId: newBindingId }],
		[story.attributeValues, schema.attributeValues, { ownerId: newBindingId }],
		[story.attributeConfigs, schema.attributeConfigs, { ownerId: newBindingId }],
		[ownerSheets, schema.ownerSheets, { ownerId: newBindingId }],
		[stateProposals, schema.stateProposals, {}]
	]
	for (const [rows, table, owner] of tables)
		for (const row of rows) {
			const values = revive(row)
			if (!values) {
				skipped++
				continue
			}
			await tx.insert(table).values({ ...values, ...owner })
		}
	skipped += await restoreCastVersions(tx, castVersions, newBindingId, {
		...versions,
		skip: (row) =>
			gone(branches, row.branchId) ||
			gone(sessions, row.sourceSessionId) ||
			gone(messages, row.validFromMessageId),
		historyEntryGone: (id) => gone(historyEntries, id)
	})
	return skipped
}

const sameJson = (a: unknown, b: unknown) =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Put a cast member's versions back onto their recreated row. The recreated
 * row has a fresh base, made from the saved row's columns (which can be stale);
 * the logged **base** is brought onto it by one author write, and every other
 * logged version is inserted again (`insertCharacterVersions`) in id order,
 * keeping its write order and retire mark, so the member reads as before.
 *
 * A version whose line, session or turn is gone went with it and is skipped
 * (the amendments' rule), a history entry that is gone is let go of, and a
 * version whose card version is gone loses its parent and so its `follows`
 * (the followed values are not recoverable: the card went with them).
 * Answers how many versions could not be put back.
 */
async function restoreCastVersions(
	tx: Db,
	logged: Record<string, unknown>[],
	newBindingId: number,
	opts: {
		base: typeof schema.characterVersions.$inferSelect | null
		lorebookId: number
		writtenBy: string
		skip: (row: Record<string, unknown>) => boolean
		historyEntryGone: (id: unknown) => boolean
	}
): Promise<number> {
	if (logged.length === 0) return 0
	const isBase = (row: Record<string, unknown>) =>
		row.branchId == null &&
		row.year == null &&
		row.personalPosition == null &&
		row.sourceSessionId == null
	const loggedBase = logged.find(isBase)
	const { base } = opts

	if (loggedBase && base) {
		const wasFollowing = new Set((loggedBase.follows ?? []) as string[])
		const changes: Record<string, unknown> = {}
		for (const field of CHARACTER_PROFILE_FIELDS) {
			const nowFollows = base.follows.includes(field)
			if (wasFollowing.has(field) && base.parentVersionId != null) {
				if (!nowFollows) changes[field] = { follow: true }
			} else if (nowFollows || !sameJson(base[field], loggedBase[field]))
				changes[field] = loggedBase[field] ?? null
		}
		for (const key of ["nodeState", "nodeVisibility"] as const)
			if (loggedBase[key] != null && loggedBase[key] !== base[key])
				changes[key] = loggedBase[key]
		if (Object.keys(changes).length > 0)
			await writeCastVersion(tx, {
				member: newBindingId,
				changes: changes as CastVersionChanges,
				writtenBy: opts.writtenBy,
				at: { branchId: null, date: null, personalPosition: null }
			})
	}

	const others = logged.filter((row) => !(base && loggedBase && isBase(row)))
	const parentsLeft = await stillThere(
		tx,
		schema.characterVersions,
		others.map((row) => row.parentVersionId as number | null)
	)
	let skipped = 0
	const rows: Record<string, unknown>[] = []
	for (const row of others) {
		if (opts.skip(row)) {
			skipped++
			continue
		}
		const {
			id: _id,
			createdAt: _createdAt,
			updatedAt: _updatedAt,
			...rest
		} = row
		const parentLeft =
			typeof row.parentVersionId === "number" &&
			parentsLeft.has(row.parentVersionId)
		rows.push({
			...rest,
			castMemberId: newBindingId,
			lorebookId: opts.lorebookId,
			parentVersionId: parentLeft ? row.parentVersionId : null,
			follows: parentLeft ? (row.follows ?? []) : [],
			historyEntryId: opts.historyEntryGone(row.historyEntryId)
				? null
				: (row.historyEntryId ?? null)
		})
	}
	await insertCharacterVersions(
		tx,
		rows as unknown as Parameters<typeof insertCharacterVersions>[1]
	)
	return skipped
}

// ─── Merge Node ───────────────────────────────────────────────────────────────

/**
 * Consolidating "absorb" — replaces the old parentNodeId-tagging merge.
 * Deletes the absorbed row and rewrites every reference to it onto the
 * survivor (relationships, scene participant/mentioned arrays, character
 * lore), instead of just tagging one row as a cosmetic alias of another
 * (which never actually fixed anything beyond display — see the plan
 * this implements). Destructive, but reversible: everything needed to
 * undo is written to `bindingMergeLogs` in the same transaction.
 *
 * Every refusal names the pair it refuses (`nodeId`, `parentNodeId`, as
 * sent): the absorb window and the duplicates list can each be waiting on an
 * absorb, and each says only its own (`absorbCastMember`).
 */
export const narrativeGraphMergeNodeHandler: Handler<
	Sockets.NarrativeGraph.MergeNode.Params,
	Sockets.NarrativeGraph.MergeNode.Response
> = refusable(
	"narrativeGraph:mergeNode",
	async (socket, params: Sockets.NarrativeGraph.MergeNode.Params, emitToUser) => {
		const userId = socket.user!.id
		const { nodeId, parentNodeId } = params

		if (nodeId === parentNodeId) {
			throw new Error("A cast member cannot be merged into itself.")
		}

		const [child, parent] = await Promise.all([
			db.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, nodeId)
			}),
			db.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, parentNodeId)
			})
		])
		if (!child) throw new Error("That cast member is not in this lorebook.")
		if (!parent) throw new Error("The cast member to merge into is not in this lorebook.")
		if (child.lorebookId !== parent.lorebookId)
			throw new Error("Both cast members must be in the same lorebook.")

		const lorebook = await findOwnedBook(db, userId, child.lorebookId)
		if (!lorebook) throw new Error("Access denied.")
		const primerProblem = await primerRowEditProblem(db, child.lorebookId)
		if (primerProblem) throw new Error(primerProblem)

		// Binding IS the row, so absorbing two bound rows into each other
		// would mean reassigning one character's identity onto a different
		// row — that's data corruption, not a merge. Unconditional,
		// non-negotiable guard, no exception.
		const childIsBound = child.characterId != null
		const parentIsBound = parent.characterId != null
		if (childIsBound && parentIsBound) {
			throw new Error(
				"Both of these cast members have a character card of their own: they are different people, and cannot be merged."
			)
		}

		// Auto-swap: the bound row always survives, so characterId
		// is never copied between rows (no risk of losing sync) and the
		// bound row's identity/id stays stable.
		const survivorId = childIsBound ? nodeId : parentNodeId
		const absorbedId = childIsBound ? parentNodeId : nodeId
		const absorbed = absorbedId === nodeId ? child : parent
		const survivor = survivorId === nodeId ? child : parent

		const merged = await db.transaction(async (tx) => {
			// The entry save's lock (`syncLorebookBindings`): no save lands
			// between the tag rewrite below and the absorbed row going.
			await tx.execute(sql`select pg_advisory_xact_lock(${lorebook.id})`)

			// 1. Snapshot the absorbed row before anything changes.
			const absorbedSnapshot: Record<string, unknown> = { ...absorbed }

			// 2. Rewrite relationships from the absorbed id to the survivor's.
			const affectedRels = await tx.query.narrativeRelationships.findMany(
				{
					where: and(
						eq(
							schema.narrativeRelationships.lorebookId,
							lorebook.id
						),
						or(
							eq(
								schema.narrativeRelationships.fromNodeId,
								absorbedId
							),
							eq(
								schema.narrativeRelationships.toNodeId,
								absorbedId
							)
						)
					)
				}
			)
			// The survivor's own relationships, to fold rewritten ones into.
			const survivorRels = await tx.query.narrativeRelationships.findMany(
				{
					where: and(
						eq(
							schema.narrativeRelationships.lorebookId,
							lorebook.id
						),
						or(
							eq(
								schema.narrativeRelationships.fromNodeId,
								survivorId
							),
							eq(
								schema.narrativeRelationships.toNodeId,
								survivorId
							)
						)
					)
				}
			)

			const relationshipRewrites: {
				id: number
				oldFromNodeId: number | null
				oldToNodeId: number | null
			}[] = []
			const deletedRelationships: Record<string, unknown>[] = []

			/**
			 * The survivor's side as the merge builds it: their own rows, and
			 * every row moved onto them so far at its new ends — so two twins
			 * the absorbed member held fold into one as well. `row` is the row
			 * as read before the merge (its old ends are what an undo needs).
			 * A row between the two members is in both reads; it is the
			 * self-loop below, never a row to fold into.
			 */
			const affectedIds = new Set(affectedRels.map((r) => r.id))
			const survivorSide = survivorRels
				.filter((r) => !affectedIds.has(r.id))
				.map((row) => ({
					row,
					fromNodeId: row.fromNodeId,
					toNodeId: row.toNodeId
				}))
			const sameWords = (a: string | null, b: string | null) =>
				(a == null) === (b == null) &&
				(a ?? "").toLowerCase() === (b ?? "").toLowerCase()

			/**
			 * Move one row onto the survivor, through the guard every writer
			 * goes through (plan B0/B1). What reaches it is never the same
			 * link twice, drawn from either end (that was folded), nor a
			 * self-loop (deleted), so its refusal is a row saying PART of what
			 * another says, or all of it while standing differently (another
			 * status, visibility or scene): not a merge's call to fold, so the
			 * person is asked to choose.
			 */
			const moveOnto = async (
				rel: (typeof affectedRels)[number],
				fromNodeId: number | null,
				toNodeId: number | null
			) => {
				const after = { ...rel, fromNodeId, toNodeId }
				try {
					await assertRelationshipWrite(tx, {
						op: "update",
						row: rel,
						// The merge speaks for the whole book: every line's row
						// moves, each judged on its own line.
						line: rel.branchId ?? null,
						ends: after,
						saying: sayingOf(after)
					})
				} catch (e) {
					if (
						!(e instanceof RelationshipRefusal) ||
						e.message !== LINKED_THAT_WAY
					)
						throw e
					const otherEntryId =
						fromNodeId === survivorId ? rel.toEntryId : rel.fromEntryId
					const [other] =
						otherEntryId == null
							? []
							: await tx
									.select({ title: schema.lorebookEntries.title })
									.from(schema.lorebookEntries)
									.where(eq(schema.lorebookEntries.id, otherEntryId))
					throw new Error(
						`${survivor.name?.trim() || "The member kept"} would be linked to "${other?.title?.trim() || "an entry"}" twice the same way. Change or delete one of those links, then merge again.`
					)
				}
				relationshipRewrites.push({
					id: rel.id,
					oldFromNodeId: rel.fromNodeId,
					oldToNodeId: rel.toNodeId
				})
				await tx
					.update(schema.narrativeRelationships)
					.set({ fromNodeId, toNodeId })
					.where(eq(schema.narrativeRelationships.id, rel.id))
				survivorSide.push({ row: rel, fromNodeId, toNodeId })
			}

			// ⚠ **Only the cast endpoints move.** `affectedRels` is selected on
			// the two node columns, so an entry endpoint is never `absorbedId`
			// and never rewritten: absorbing a character rewrites their end of
			// "keeper of the shrine" and leaves the shrine where it is.
			for (const rel of affectedRels) {
				const newFromNodeId =
					rel.fromNodeId === absorbedId ? survivorId : rel.fromNodeId
				const newToNodeId =
					rel.toNodeId === absorbedId ? survivorId : rel.toNodeId

				// Self-loop: the single most common case this feature exists
				// for (two rows turning out to be the same person) very
				// plausibly already has a relationship *between them* —
				// rewriting both endpoints to the survivor's id would leave
				// a relationship from someone to themselves. Two entry
				// endpoints are both null and are not a self-loop, which is
				// why this asks for a real id rather than for equality alone.
				if (newFromNodeId !== null && newFromNodeId === newToNodeId) {
					deletedRelationships.push({ ...rel })
					relationshipRewrites.push({
						id: rel.id,
						oldFromNodeId: rel.fromNodeId,
						oldToNodeId: rel.toNodeId
					})
					await tx
						.delete(schema.narrativeRelationships)
						.where(eq(schema.narrativeRelationships.id, rel.id))
					continue
				}

				// A duplicate is the SAME dated state on the SAME line: same
				// ends, same type, same name, same reverse (each case aside, as
				// B1's one row per way reads them), same branch, same history
				// entry (two differently named relationships between one pair
				// are two relationships, as the entry-pair index holds; a row
				// with an entry end may read both ways, and folding it into a
				// one-way row would delete its way back). Two versions filed at
				// different dates, or on different lines, are two records, not
				// one said twice — collapsing them loses a dated version of the
				// link (and the tie-break below goes by row id, the
				// later-written, never a history entry's id read as a date).
				//
				// Its MIRROR is the same link too (B1): drawn from the far
				// end, each row's way there is the other's way back. Only a
				// two-way row has one — a cast tie carries no reverse, and its
				// other side is its own perspective row.
				//
				// And it stands the same way: the same status, visibility and
				// scene. A broken tie and an active one, or a secret link and
				// an acknowledged one, are not one said twice; which to keep is
				// the person's call, never the description's length.
				const newFromEntryId = rel.fromEntryId
				const newToEntryId = rel.toEntryId
				const sameLink = (
					r: (typeof affectedRels)[number],
					fromNodeId: number | null,
					toNodeId: number | null
				) =>
					(fromNodeId === newFromNodeId &&
						toNodeId === newToNodeId &&
						r.fromEntryId === newFromEntryId &&
						r.toEntryId === newToEntryId &&
						(r.knowledgeKind ?? null) === (rel.knowledgeKind ?? null) &&
						sameWords(r.relationshipType, rel.relationshipType) &&
						sameWords(
							r.reverseRelationshipType ?? null,
							rel.reverseRelationshipType ?? null
						)) ||
					(rel.reverseRelationshipType != null &&
						fromNodeId === newToNodeId &&
						toNodeId === newFromNodeId &&
						r.fromEntryId === newToEntryId &&
						r.toEntryId === newFromEntryId &&
						(r.knowledgeKind ?? null) === (rel.knowledgeKind ?? null) &&
						sameWords(r.relationshipType, rel.reverseRelationshipType) &&
						sameWords(r.reverseRelationshipType ?? null, rel.relationshipType))
				const duplicateAt = survivorSide.findIndex(
					({ row: r, fromNodeId, toNodeId }) =>
						r.id !== rel.id &&
						sameLink(r, fromNodeId, toNodeId) &&
						sameWords(r.title, rel.title) &&
						(r.branchId ?? null) === (rel.branchId ?? null) &&
						(r.historyEntryId ?? null) ===
							(rel.historyEntryId ?? null) &&
						r.status === rel.status &&
						r.visibility === rel.visibility &&
						(r.sceneId ?? null) === (rel.sceneId ?? null)
				)
				if (duplicateAt !== -1) {
					const duplicate = survivorSide[duplicateAt]!.row
					// Keep the more complete one; on a tie, the later-written.
					const told = (r: { description: string }) =>
						r.description.length
					const relIsBetter =
						told(rel) > told(duplicate) ||
						(told(rel) === told(duplicate) && rel.id > duplicate.id)
					if (!relIsBetter) {
						deletedRelationships.push({ ...rel })
						relationshipRewrites.push({
							id: rel.id,
							oldFromNodeId: rel.fromNodeId,
							oldToNodeId: rel.toNodeId
						})
						await tx
							.delete(schema.narrativeRelationships)
							.where(eq(schema.narrativeRelationships.id, rel.id))
						continue
					}
					deletedRelationships.push({ ...duplicate })
					await tx
						.delete(schema.narrativeRelationships)
						.where(eq(schema.narrativeRelationships.id, duplicate.id))
					survivorSide.splice(duplicateAt, 1)
				}

				await moveOnto(rel, newFromNodeId, newToNodeId)
			}

			// 3. Repoint the absorbed binding's scene appearances onto the
			// survivor. Cascade alone would be wrong here — an absorbed
			// character's appearances must MOVE to the survivor, not vanish
			// with the row.
			//
			// Snapshots are still captured first, and still in the array shape
			// bindingMergeLogs.sceneSnapshots has always stored, so undoMerge
			// can restore pre-existing logs written before the join table
			// existed as well as new ones.
			const lorebookScenes = await tx.query.scenes.findMany({
				where: eq(schema.scenes.lorebookId, lorebook.id),
				columns: { id: true, selectedMessageIds: true }
			})
			const castsBefore = await readSceneCasts(
				lorebookScenes.map((s) => s.id),
				tx
			)
			const affectedScenes = lorebookScenes.filter((scene) => {
				const cast = castFor(castsBefore, scene.id)
				return (
					cast.participantCharacters.includes(absorbedId) ||
					cast.mentionedCharacters.includes(absorbedId)
				)
			})
			/**
			 * ⚠ The mentioned half is SNAPSHOTTED, not read back later.
			 *
			 * A merge log is a point-in-time record by definition, and
			 * `mentioned` is derived now — re-deriving it at undo time would
			 * answer about the vocabulary as it stands *then*, which is not the
			 * cast this merge saw. Freezing it here is what keeps the record
			 * true; it is not a reason to make the stored row primary again.
			 */
			const mentionsBefore = await deriveSceneMentions(
				tx,
				lorebook.id,
				affectedScenes.map((s) => ({
					id: s.id,
					selectedMessageIds: s.selectedMessageIds ?? null
				}))
			)
			const sceneSnapshots: {
				sceneId: number
				participantCharacters: number[]
				mentionedCharacters: number[]
			}[] = []
			for (const scene of affectedScenes) {
				const cast = castFor(castsBefore, scene.id)
				const mentions = mentionsBefore.get(scene.id)
				sceneSnapshots.push({
					sceneId: scene.id,
					participantCharacters: cast.participantCharacters,
					mentionedCharacters: mentions
						? mentionedSoFar(mentions)
						: cast.mentionedCharacters
				})
			}
			await repointSceneCast(lorebook.id, absorbedId, survivorId, tx)

			// 4. Reassign character-lore entries (onDelete: "set null" —
			// without this, private lore attached to the absorbed row goes
			// permanently unbound/invisible the moment it's deleted).
			const reassignedLoreEntries = await tx
				.select({ id: schema.lorebookEntries.id })
				.from(schema.lorebookEntries)
				.where(
					and(
						eq(schema.lorebookEntries.anchorBindingId, absorbedId),
						eq(
							schema.lorebookEntries.typeId,
							CHARACTER_LORE_TYPE_ID
						)
					)
				)
			const reassignedCharacterLoreEntryIds = reassignedLoreEntries.map(
				(e) => e.id
			)
			if (reassignedCharacterLoreEntryIds.length > 0) {
				await tx
					.update(schema.lorebookEntries)
					.set({ anchorBindingId: survivorId })
					.where(
						inArray(
							schema.lorebookEntries.id,
							reassignedCharacterLoreEntryIds
						)
					)
			}

			// 4.5. Reassign child nodes (onDelete: "set null" on parentNodeId —
			// without this, any alias-children of the absorbed row would be
			// silently orphaned the moment it's deleted, and undo would have
			// no record to restore the link from).
			const reassignedChildNodes =
				await tx.query.lorebookBindings.findMany({
					where: eq(schema.lorebookBindings.parentNodeId, absorbedId),
					columns: { id: true }
				})
			const reassignedChildNodeIds = reassignedChildNodes.map((n) => n.id)
			if (reassignedChildNodeIds.length > 0) {
				await tx
					.update(schema.lorebookBindings)
					.set({ parentNodeId: survivorId })
					.where(
						inArray(
							schema.lorebookBindings.id,
							reassignedChildNodeIds
						)
					)
			}

			// 5. Append the absorbed identity to the survivor's
			// absorbedAliases — never `aliases` directly (see schema.ts:
			// `aliases` is a one-directional sync target from the bound
			// entity, a full replace on every entity edit; an alias written
			// there would vanish the next time the survivor's character/
			// persona is edited at all).
			const candidateNames = [
				absorbed.name,
				...(absorbed.aliases ?? []),
				...(absorbed.absorbedAliases ?? [])
			]
				.map((n) => n?.trim())
				.filter((n): n is string => !!n && n !== survivor.name)
			const existingAbsorbed = new Set(survivor.absorbedAliases ?? [])
			const absorbedAliasesAdded = [
				...new Set(
					candidateNames.filter((n) => !existingAbsorbed.has(n))
				)
			]
			const newAbsorbedAliases = [
				...(survivor.absorbedAliases ?? []),
				...absorbedAliasesAdded
			]

			// 6/7. Carry over first-appearance tracking if the survivor
			// doesn't have it. The survivor's vector stays: it embeds the
			// name and the summary, and a merge changes neither — the
			// absorbed names go to `absorbedAliases`, which are not embedded.
			await tx
				.update(schema.lorebookBindings)
				.set({
					absorbedAliases: newAbsorbedAliases,
					sceneId: survivor.sceneId ?? absorbed.sceneId ?? null,
					historyEntryId:
						survivor.historyEntryId ??
						absorbed.historyEntryId ??
						null
				})
				.where(eq(schema.lorebookBindings.id, survivorId))

			// 7.5. The absorbed member's own dated story — their amendments,
			// presences and attribute rows. The first two cascade with the row
			// below and the attribute rows have no key to cascade on, so all of
			// it is snapshotted into the log first; undo puts it back onto the
			// recreated row. Left on the absorbed member, not moved onto the
			// survivor: two members' dated overlays can collide on one date,
			// and which one wins is not a merge's call to make.
			absorbedSnapshot[MEMBER_STORY_KEY] = await snapshotMemberStory(
				tx,
				absorbedId
			)
			await deleteMemberStats(tx, absorbedId)

			// 8. Delete the absorbed row.
			await tx
				.delete(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, absorbedId))

			// 9. Their cast tags, everywhere the book's lore text holds one,
			// become the survivor's (A16). Left alone, the next entry save
			// found the absorbed tag with no member and minted a blank one
			// under it. Each rewritten column is noted, so undo can put the
			// absorbed tag back where nobody has edited since.
			const absorbedTag = castTagNumber(absorbed.binding)
			const survivorTag = castTagNumber(survivor.binding)
			const rewritten =
				absorbedTag !== null && survivorTag !== null
					? await rewriteBookCastTags(
							tx,
							lorebook.id,
							absorbedTag,
							castTag(survivorTag)
						)
					: null

			// Audit log — what makes this safe to be destructive.
			await tx.insert(schema.bindingMergeLogs).values({
				lorebookId: lorebook.id,
				userId,
				survivorId,
				absorbedSnapshot,
				relationshipRewrites,
				deletedRelationships,
				sceneSnapshots,
				absorbedAliasesAdded,
				reassignedCharacterLoreEntryIds,
				reassignedChildNodeIds,
				tagRewrites: rewritten?.rewrites ?? []
			})

			const updated = await tx.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, survivorId)
			})
			return {
				survivorNode: updated!,
				entryTypeIds: rewritten?.entryTypeIds ?? new Set<string>()
			}
		})

		const res: Sockets.NarrativeGraph.MergeNode.Response = {
			survivorNode: (
				await withStoryStates(db, [merged.survivorNode])
			)[0]
		}
		emitToUser("narrativeGraph:mergeNode", res)
		await afterCastTagRewrite(
			socket,
			emitToUser,
			lorebook,
			merged.entryTypeIds
		)

		// Refresh duplicate candidates — any other candidate pair involving
		// the now-deleted absorbed id would otherwise dangle in the UI. LAZY:
		// see `buildDuplicateCandidates`.
		await emitToUser("narrativeGraph:duplicateCandidates", () =>
			buildDuplicateCandidates(lorebook.id)
		)

		return res
	},
	"The two cast members could not be merged.",
	undefined,
	absorbPairOf
)

/** The pair an absorb's refusal names: the ids as the request sent them. */
function absorbPairOf(raw: unknown): { nodeId?: number; parentNodeId?: number } {
	const params = raw as { nodeId?: unknown; parentNodeId?: unknown } | undefined
	return {
		...(Number.isInteger(params?.nodeId) ? { nodeId: params!.nodeId as number } : {}),
		...(Number.isInteger(params?.parentNodeId)
			? { parentNodeId: params!.parentNodeId as number }
			: {})
	}
}

/**
 * Reverses a previous absorb via its bindingMergeLogs entry — re-inserts
 * the absorbed row from its recorded snapshot under a new primary key, with
 * its own cast tag (a book never reissues a number, so the tag is still
 * theirs), then restores every rewrite/deletion the absorb performed.
 *
 * Their tags in the book's text come back from the merge's undo notes
 * (`tag_rewrites`, A16): a column that still reads as the merge left it gets
 * its old text back; one edited since keeps the survivor's tag and is counted
 * in `unrestoredTextCount`. Should a member already hold the absorbed tag
 * (only the pre-A16 entry save put one there), the undo never fails on
 * `lorebook_bindings_binding_unique`: a blank holder nothing links to is
 * deleted, a blank holder something links to moves to a fresh tag, and a
 * holder somebody has filled in keeps the tag while the restored member takes
 * a fresh one, with the text restored following it.
 */
export const narrativeGraphUndoMergeHandler: Handler<
	Sockets.NarrativeGraph.UndoMerge.Params,
	Sockets.NarrativeGraph.UndoMerge.Response
> = refusable(
	"narrativeGraph:undoMerge",
	async (socket, params: Sockets.NarrativeGraph.UndoMerge.Params, emitToUser) => {
		const userId = socket.user!.id
		const { mergeLogId } = params

		const log = await db.query.bindingMergeLogs.findFirst({
			where: eq(schema.bindingMergeLogs.id, mergeLogId)
		})
		if (!log) throw new Error("Merge record not found.")

		const lorebook = await findOwnedBook(db, userId, log.lorebookId)
		if (!lorebook) throw new Error("Access denied.")
		const primerProblem = await primerRowEditProblem(db, log.lorebookId)
		if (primerProblem) throw new Error(primerProblem)

		if (log.survivorId === null) {
			throw new Error(
				"This merge can no longer be undone — the surviving character has since been absorbed elsewhere or deleted."
			)
		}
		const survivorId = log.survivorId

		const restored = await db.transaction(async (tx) => {
			const snapshot = log.absorbedSnapshot as Record<string, unknown>
			const oldAbsorbedId = snapshot.id as number
			const {
				id: _oldId,
				createdAt: snapshotCreatedAt,
				updatedAt: _oldUpdatedAt,
				// A timestamp comes back out of the JSONB snapshot as an ISO
				// *string*, and drizzle calls `.toISOString()` on whatever a
				// `timestamp` column is handed — so it is revived below, never
				// spread.
				vectorizedAt: snapshotVectorizedAt,
				// GENERATED from the row's own text; never written.
				embedTextHash: _oldEmbedTextHash,
				// Not a column: the member's dated story, restored below once
				// the row has its new id. Absent from logs written before it
				// was recorded, which restore nothing for it.
				[MEMBER_STORY_KEY]: memberStory,
				...rest
			} = snapshot

			// The entry save's lock (`syncLorebookBindings`), as the merge took.
			await tx.execute(
				sql`select pg_advisory_xact_lock(${log.lorebookId})`
			)
			// Their own tag — a book never reissues a number, so it is still
			// theirs. Only the pre-A16 entry save put anyone else on it: a
			// BLANK member minted over the tag the merge left in the text. That
			// text meant the absorbed member all along, so the member comes
			// back under their own tag, and the blank one is deleted — or,
			// when something links to it, steps aside to a fresh tag. Anyone
			// else holding it (a member somebody has filled in since) keeps
			// it, and the member comes back under a fresh one.
			const snapshotTag = String(rest.binding ?? "")
			const [tagHolder] = await tx
				.select({
					id: schema.lorebookBindings.id,
					characterId: schema.lorebookBindings.characterId,
					name: schema.lorebookBindings.name,
					summary: schema.lorebookBindings.summary,
					aliases: schema.lorebookBindings.aliases,
					absorbedAliases: schema.lorebookBindings.absorbedAliases,
					sceneId: schema.lorebookBindings.sceneId,
					historyEntryId: schema.lorebookBindings.historyEntryId,
					parentNodeId: schema.lorebookBindings.parentNodeId
				})
				.from(schema.lorebookBindings)
				.where(
					and(
						eq(schema.lorebookBindings.lorebookId, log.lorebookId),
						eq(schema.lorebookBindings.binding, snapshotTag)
					)
				)
				.limit(1)
			let restoredTag = snapshotTag
			if (tagHolder) {
				// Their state and sprite set are their versions' (the columns
				// are frozen).
				const holderRead = (
					await storyStatesOf(tx, [tagHolder])
				).get(tagHolder.id)!
				const blank = isBlankMember({
					...tagHolder,
					nodeState: holderRead.nodeState,
					nodeVisibility: holderRead.nodeVisibility,
					spriteSet: holderRead.version?.spriteSet ?? null
				})
				if (
					blank &&
					!(await memberIsLinked(tx, log.lorebookId, tagHolder.id))
				) {
					// Nobody, whom nothing names: the text on this tag meant
					// the absorbed member, so the blank one goes rather than
					// stay under a number no text uses.
					await tx
						.delete(schema.lorebookBindings)
						.where(eq(schema.lorebookBindings.id, tagHolder.id))
				} else {
					const fresh = await deriveNextBindingToken(
						log.lorebookId,
						tx
					)
					if (blank)
						await tx
							.update(schema.lorebookBindings)
							.set({ binding: fresh })
							.where(eq(schema.lorebookBindings.id, tagHolder.id))
					else restoredTag = fresh
				}
			}

			// Re-insert the absorbed row verbatim under a new primary key —
			// its vector, model and source hash included. The vector lives on
			// the row and describes the row's text, which comes back as it
			// was, so it needs no embed; the queue's hash check re-embeds it
			// only if that text did move (`columnStoreNeedsEmbedding`).
			const { member: inserted, base: insertedBase } =
				await insertCastMember(
					tx,
					{
						...(rest as typeof schema.lorebookBindings.$inferInsert),
						binding: restoredTag,
						vectorizedAt: snapshotVectorizedAt
							? new Date(snapshotVectorizedAt as string)
							: null,
						createdAt: snapshotCreatedAt
							? new Date(snapshotCreatedAt as string)
							: new Date()
					},
					{ writtenBy: `user:${userId}` }
				)

			// Null passes straight through: that end of the edge is an entry,
			// which a merge never touched and an undo must not invent one for.
			const remapId = <T extends number | null>(id: T) =>
				(id === oldAbsorbedId ? inserted.id : id) as T

			/**
			 * Every relationship the undo writes goes through the guard every
			 * writer does (plan B0/B1). The book has moved on since the merge,
			 * so a link put back may now say what one drawn since says; that
			 * one is left out and counted, never the reason the whole undo
			 * fails. Only the guard's refusal (`RelationshipRefusal`) is left
			 * out: a failed query or a bug still fails the undo.
			 */
			let unrestoredLinkCount = 0
			/** Of those, the ones the merge had moved: they stay with the survivor. */
			let unrestoredMovedLinkCount = 0
			const guardAllows = async (write: RelationshipWrite) => {
				try {
					await assertRelationshipWrite(tx, write)
					return true
				} catch (e) {
					if (!(e instanceof RelationshipRefusal)) throw e
					unrestoredLinkCount++
					if (write.op === "update") unrestoredMovedLinkCount++
					return false
				}
			}

			// Restore relationships still standing (rewritten, not deleted)
			// back to their original endpoints.
			const deletedIds = new Set(
				(log.deletedRelationships as Record<string, unknown>[]).map(
					(r) => r.id as number
				)
			)
			for (const rw of log.relationshipRewrites) {
				if (deletedIds.has(rw.id)) continue // handled via re-insert below
				const current = await tx.query.narrativeRelationships.findFirst({
					where: eq(schema.narrativeRelationships.id, rw.id)
				})
				if (!current) continue // deleted since: nothing to move back
				const after = {
					...current,
					fromNodeId: remapId(rw.oldFromNodeId),
					toNodeId: remapId(rw.oldToNodeId)
				}
				if (
					!(await guardAllows({
						op: "update",
						row: current,
						line: current.branchId ?? null,
						ends: after,
						saying: sayingOf(after)
					}))
				)
					continue
				await tx
					.update(schema.narrativeRelationships)
					.set({ fromNodeId: after.fromNodeId, toNodeId: after.toNodeId })
					.where(eq(schema.narrativeRelationships.id, rw.id))
			}

			// Re-insert relationships deleted outright (self-loops, or the
			// losing side of a third-party dedup).
			//
			// ⚠ Not a no-op against a world that moved on. Anything a
			// snapshotted link names may have been deleted since the merge — an
			// entry at one end, the other cast member, its branch — and one
			// such row must not fail the insert and with it the WHOLE undo. So
			// the ends are checked first: a link whose end or line is gone is
			// skipped and counted (it went with that end), and a link whose
			// history entry or scene is gone keeps itself and loses the pointer,
			// as the foreign key's own `SET NULL` would have done.
			const deletedRels = log.deletedRelationships as Record<
				string,
				unknown
			>[]
			const remapped = deletedRels.map((r) => ({
				row: r,
				fromNodeId: remapId((r.fromNodeId ?? null) as number | null),
				toNodeId: remapId((r.toNodeId ?? null) as number | null)
			}))
			const nodesLeft = await stillThere(
				tx,
				schema.lorebookBindings,
				remapped.flatMap((r) => [r.fromNodeId, r.toNodeId])
			)
			const entriesLeft = await stillThere(
				tx,
				schema.lorebookEntries,
				deletedRels.flatMap((r) => [
					r.fromEntryId as number | null,
					r.toEntryId as number | null,
					r.historyEntryId as number | null
				])
			)
			const scenesLeft = await stillThere(
				tx,
				schema.scenes,
				deletedRels.map((r) => r.sceneId as number | null)
			)
			const branchesLeft = await stillThere(
				tx,
				schema.lorebookBranches,
				deletedRels.map((r) => r.branchId as number | null)
			)
			const missing = (set: Set<number>, id: unknown) =>
				typeof id === "number" && !set.has(id)
			const reinsertedLinkIds: number[] = []
			for (const { row, fromNodeId, toNodeId } of remapped) {
				if (
					missing(nodesLeft, fromNodeId) ||
					missing(nodesLeft, toNodeId) ||
					missing(entriesLeft, row.fromEntryId) ||
					missing(entriesLeft, row.toEntryId) ||
					missing(branchesLeft, row.branchId)
				) {
					unrestoredLinkCount++
					continue
				}
				const {
					id: _oldRelId,
					createdAt: relCreatedAt,
					updatedAt: _relUpdatedAt,
					// Revived, as the binding snapshot's is above: an ISO
					// string in a timestamp column crashes the insert. The
					// vector, its model and source hash come back with the
					// edge, as the member's do.
					vectorizedAt: relVectorizedAt,
					...relRest
				} = row
				const values = {
					...(relRest as typeof schema.narrativeRelationships.$inferInsert),
					// Text, never NULL: a copy saved before the repair
					// migration can carry none (see `capText`).
					description:
						typeof relRest.description === "string"
							? relRest.description
							: "",
					vectorizedAt: relVectorizedAt
						? new Date(relVectorizedAt as string)
						: null,
					fromNodeId,
					toNodeId,
					historyEntryId: missing(entriesLeft, row.historyEntryId)
						? null
						: ((row.historyEntryId ?? null) as number | null),
					sceneId: missing(scenesLeft, row.sceneId)
						? null
						: ((row.sceneId ?? null) as number | null),
					createdAt: relCreatedAt
						? new Date(relCreatedAt as string)
						: new Date()
				}
				const ends = {
					fromNodeId,
					fromEntryId: values.fromEntryId ?? null,
					toNodeId,
					toEntryId: values.toEntryId ?? null
				}
				if (
					!(await guardAllows({
						op: "create",
						ends,
						saying: sayingOf({
							lorebookId: log.lorebookId,
							branchId: values.branchId ?? null,
							historyEntryId: values.historyEntryId,
							title: values.title ?? "",
							relationshipType: values.relationshipType ?? "neutral",
							reverseRelationshipType:
								values.reverseRelationshipType ?? null
						})
					}))
				)
					continue
				const [link] = await tx
					.insert(schema.narrativeRelationships)
					.values(values)
					.returning({ id: schema.narrativeRelationships.id })
				reinsertedLinkIds.push(link.id)
			}

			// The member's own dated story, back onto the recreated row.
			const unrestoredStoryCount = memberStory
				? await restoreMemberStory(
						tx,
						memberStory as MemberStory,
						inserted.id,
						{
							base: insertedBase,
							lorebookId: inserted.lorebookId,
							writtenBy: `user:${userId}`
						}
					)
				: 0

			// Restore scene cast to its recorded pre-merge value (remapped onto
			// the recreated row's new id). The snapshot format is unchanged —
			// still the two id arrays — so logs written before scene_characters
			// existed replay identically; only the write target moved.
			//
			// ⚠ **Participants only, and the mentioned remap is deleted.**
			// `mentioned` is derived from annotations now, and the derivation
			// reverts by itself: this same transaction recreates the absorbed
			// binding and strips the names it lent the survivor's
			// `absorbedAliases`, so the gazetteer the next read resolves through
			// is the pre-merge one again. Remapping ids into a row nothing reads
			// would be work whose only effect is to look like an answer.
			// `sceneSnapshots.mentionedCharacters` stays in the log as the
			// frozen record of what the merge saw.
			//
			// A scene deleted since is skipped, and a cast member deleted since
			// is left out of the list — either would fail the insert and take
			// the whole undo with it.
			const snapScenesLeft = await stillThere(
				tx,
				schema.scenes,
				log.sceneSnapshots.map((s) => s.sceneId)
			)
			const castLeft = await stillThere(
				tx,
				schema.lorebookBindings,
				log.sceneSnapshots.flatMap((s) =>
					s.participantCharacters.map(remapId)
				)
			)
			for (const sceneSnap of log.sceneSnapshots) {
				if (!snapScenesLeft.has(sceneSnap.sceneId)) continue
				await writeSceneCast(
					sceneSnap.sceneId,
					{
						participantCharacters: sceneSnap.participantCharacters
							.map(remapId)
							.filter((id) => castLeft.has(id))
					},
					tx
				)
			}

			// Move reassigned character-lore entries back to the recreated row.
			if (log.reassignedCharacterLoreEntryIds.length > 0) {
				await tx
					.update(schema.lorebookEntries)
					.set({ anchorBindingId: inserted.id })
					.where(
						inArray(
							schema.lorebookEntries.id,
							log.reassignedCharacterLoreEntryIds
						)
					)
			}

			// Move reassigned child nodes (alias-children of the absorbed row)
			// back to point at the recreated row.
			if (log.reassignedChildNodeIds.length > 0) {
				await tx
					.update(schema.lorebookBindings)
					.set({ parentNodeId: inserted.id })
					.where(
						inArray(
							schema.lorebookBindings.id,
							log.reassignedChildNodeIds
						)
					)
			}

			// Remove exactly the strings this merge added to the survivor's
			// absorbedAliases — tolerate them already being gone (e.g. a
			// further edit happened in between).
			if (log.absorbedAliasesAdded.length > 0) {
				const survivor = await tx.query.lorebookBindings.findFirst({
					where: eq(schema.lorebookBindings.id, survivorId)
				})
				if (survivor) {
					const toRemove = new Set(log.absorbedAliasesAdded)
					await tx
						.update(schema.lorebookBindings)
						.set({
							absorbedAliases: (
								survivor.absorbedAliases ?? []
							).filter((a) => !toRemove.has(a))
						})
						.where(eq(schema.lorebookBindings.id, survivorId))
				}
			}

			// Their tags back into the text the merge rewrote.
			const tagsBack = await revertCastTagRewrites(
				tx,
				(log.tagRewrites ?? []) as CastTagRewrite[],
				() => restoredTag
			)

			// And the text this undo put back from the saved copy, read against
			// the book as it stands now.
			const ownedBy = (table: any) =>
				tx
					.select({ id: table.id })
					.from(table)
					.where(eq(table.lorebookBindingId, inserted.id))
			await resolveRestoredCastTags(
				tx,
				log.lorebookId,
				log.id,
				{
					castMember: [inserted.id],
					castVersion: (
						await tx
							.select({ id: schema.characterVersions.id })
							.from(schema.characterVersions)
							.where(
								eq(schema.characterVersions.castMemberId, inserted.id)
							)
					).map((r) => r.id),
					castPresence: (await ownedBy(schema.castPresences)).map(
						(r: { id: number }) => r.id
					),
					relationship: reinsertedLinkIds
				},
				{ from: castTagNumber(snapshotTag), as: restoredTag }
			)
			// The member as the resolution left them (their summary can name
			// a survivor now).
			const member = await tx.query.lorebookBindings.findFirst({
				where: eq(schema.lorebookBindings.id, inserted.id)
			})

			await tx
				.delete(schema.bindingMergeLogs)
				.where(eq(schema.bindingMergeLogs.id, mergeLogId))

			return {
				inserted: member ?? inserted,
				unrestoredLinkCount,
				unrestoredMovedLinkCount,
				unrestoredStoryCount,
				unrestoredTextCount: tagsBack.unrestored,
				entryTypeIds: tagsBack.entryTypeIds
			}
		})

		const res: Sockets.NarrativeGraph.UndoMerge.Response = {
			// Top level, so every listener filters the same way (plan B5),
			// and the record it undid, so the list that asked claims it (B8).
			lorebookId: log.lorebookId,
			mergeLogId,
			restoredNode: (await withStoryStates(db, [restored.inserted]))[0],
			unrestoredLinkCount: restored.unrestoredLinkCount,
			unrestoredMovedLinkCount: restored.unrestoredMovedLinkCount,
			unrestoredStoryCount: restored.unrestoredStoryCount,
			unrestoredTextCount: restored.unrestoredTextCount
		}
		emitToUser("narrativeGraph:undoMerge", res)
		await afterCastTagRewrite(
			socket,
			emitToUser,
			lorebook,
			restored.entryTypeIds
		)

		// LAZY: see `buildDuplicateCandidates`.
		await emitToUser("narrativeGraph:duplicateCandidates", () =>
			buildDuplicateCandidates(log.lorebookId)
		)

		return res
	},
	"The merge could not be undone."
)

export { rewriteMergeLogCastTags, deleteMemberStats }
