import { db } from "$lib/server/db"
import { primerRowEditProblem } from "$lib/server/plugins/providedMarks"
import * as schema from "$lib/server/db/schema"
import { eq, desc, and, sql, inArray } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import {
	CHARACTER_LORE_TYPE_ID,
	sweepLoreEntryRankings,
	withEverythingFiledUnder
} from "$lib/server/utils/lorebookEntries"
import { orderedBindingPair } from "$lib/server/utils/duplicateBindingDetection"
import {
	foldRelationshipsUndatedBy
} from "$lib/server/utils/relationshipGuards"
import { refusable } from "$lib/server/sockets/refusable"
import { castTagNumber, rewriteBookCastTags } from "$lib/server/utils/castTags"
import {
	assertOwnedBook,
	assertReadableBook,
	findOwnedBook
} from "$lib/server/utils/ownedBook"
import {
	buildDuplicateCandidates,
	buildGraphList,
	afterCastTagRewrite
} from "./narrativeGraph.shared"
import { narrativeGraphApplyProposalHandler } from "./narrativeGraph.apply"
import {
	rewriteMergeLogCastTags,
	deleteMemberStats,
	narrativeGraphMergeNodeHandler,
	narrativeGraphUndoMergeHandler
} from "./narrativeGraph.merge"
import { narrativeGraphBuildHandler } from "./narrativeGraph.build"
import {
	narrativeGraphUpdateRelationshipHandler,
	narrativeGraphDeleteRelationshipHandler,
	narrativeGraphCreateRelationshipHandler,
	narrativeGraphTieSidesHandler,
	narrativeGraphSetTieSideHandler
} from "./narrativeGraph.relationships"
export {
	narrativeGraphUpdateRelationshipHandler,
	narrativeGraphDeleteRelationshipHandler,
	narrativeGraphCreateRelationshipHandler,
	narrativeGraphTieSidesHandler,
	narrativeGraphSetTieSideHandler
} from "./narrativeGraph.relationships"
export { narrativeGraphBuildHandler } from "./narrativeGraph.build"
export {
	narrativeGraphMergeNodeHandler,
	narrativeGraphUndoMergeHandler
} from "./narrativeGraph.merge"
export { narrativeGraphApplyProposalHandler } from "./narrativeGraph.apply"

// ─── List ─────────────────────────────────────────────────────────────────────

export const narrativeGraphListHandler: Handler<
	Sockets.NarrativeGraph.List.Params,
	Sockets.NarrativeGraph.List.Response
> = refusable(
	"narrativeGraph:list",
	async (socket, params: Sockets.NarrativeGraph.List.Params, emitToUser) => {
		const userId = socket.user!.id

		// A read: owner, share recipient or admin (lane A3).
		await assertReadableBook(db, userId, params.lorebookId, {
			isAdmin: !!socket.user?.isAdmin
		})

		const res = await buildGraphList(params.lorebookId)
		emitToUser("narrativeGraph:list", res)
		return res
	},
	"The graph could not be read."
)

// ─── Node CRUD ────────────────────────────────────────────────────────────────
//
// A cast row's own fields (its state, visibility, parent, scene and history
// anchors, name, aliases, card) are written through ONE door,
// `lorebooks:updateBinding` (`validateBindingCrossRefs`, plan B2). The graph's
// former `narrativeGraph:updateNode` duplicated it with an allowlist and had
// no client emitter.

export const narrativeGraphDeleteNodeHandler: Handler<
	Sockets.NarrativeGraph.DeleteNode.Params,
	Sockets.NarrativeGraph.DeleteNode.Response
> = refusable(
	"narrativeGraph:deleteNode",
	async (socket, params: Sockets.NarrativeGraph.DeleteNode.Params, emitToUser) => {
		const userId = socket.user!.id

		// Behavior change from pre-merge (flag prominently in delete-
		// confirmation UI copy — see the merge plan): deleting a node used
		// to be graph-only and non-destructive, since the binding survived
		// with lorebookBindingId just set null. Post-merge, deleting the
		// row necessarily detaches any bound character/persona from the
		// lorebook and nulls any character-lore entries that referenced it
		// (via that FK's onDelete: set null).
		const existing = await db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, params.id)
		})
		if (!existing) throw new Error("That cast member is not in this lorebook.")

		const lorebook = await findOwnedBook(db, userId, existing.lorebookId)
		if (!lorebook) throw new Error("Access denied.")
		const primerProblem = await primerRowEditProblem(db, existing.lorebookId)
		if (primerProblem) throw new Error(primerProblem)

		/**
		 * Their private lore: the character-lore entries anchored to them.
		 *
		 * The anchor is `ON DELETE SET NULL`, so lore left behind becomes
		 * UNASSIGNED — and unassigned lore is narrator-visible. That is a
		 * disclosure, not a tidy-up, so the person decides (owner ruling 4):
		 * `"keep"` (the default, and what every caller got before this
		 * choice existed) leaves the lore in the book unassigned; `"delete"`
		 * removes every entry anchored to them, archived ones included — an
		 * archived private entry left unassigned would go narrator-visible
		 * the day it is restored. `checkNodeMergeReferences` counts them for
		 * the dialog before it asks.
		 */
		const privateLore = params.privateLore ?? "keep"
		if (privateLore !== "keep" && privateLore !== "delete")
			throw new Error('privateLore must be "keep" or "delete".')

		// Their places in scenes go by cascade (`scene_characters.binding_id`
		// is a real key, ON DELETE cascade), and so do their amendments and
		// presences. Their stats and stat sheets have no key to cascade on, so
		// they are removed by hand in the same transaction
		// (`deleteMemberStats`).
		/**
		 * What their cast tags become in the lore left behind: their name, as
		 * plain text (A16). A tag with no member reads as a raw `{{char:N}}` in
		 * the prompt and a dangling tag in the editor; the name keeps the prose
		 * readable, and no tag is left for an entry save to mint a blank member
		 * under. A member with no name at all keeps their tags — there is no
		 * name to write, and the entry save never mints a number the book has
		 * already issued.
		 */
		let nameInProse = existing.name?.trim() ?? ""
		if (!nameInProse && existing.characterId != null) {
			const card = await db.query.characters.findFirst({
				where: eq(schema.characters.id, existing.characterId)
			})
			nameInProse = card ? resolveCharacterName(card).trim() : ""
		}
		const tagNumber = castTagNumber(existing.binding)

		const deletion = await db.transaction(async (tx) => {
			// The entry save's lock (`syncLorebookBindings`): no save lands
			// between the rewrite and the row going.
			await tx.execute(
				sql`select pg_advisory_xact_lock(${existing.lorebookId})`
			)
			let deleted = 0
			if (privateLore === "delete") {
				const theirs = and(
					eq(schema.lorebookEntries.anchorBindingId, params.id),
					eq(schema.lorebookEntries.typeId, CHARACTER_LORE_TYPE_ID)
				)!
				// A history entry filed under their lore goes with it; the links
				// it dated fold first rather than fail the delete. The ranking
				// evidence about every row the delete takes goes too: its
				// subject id has no foreign key (`sweepLoreEntryRankings`).
				const lore = await tx
					.select({ id: schema.lorebookEntries.id })
					.from(schema.lorebookEntries)
					.where(theirs)
				await sweepLoreEntryRankings(
					tx,
					await withEverythingFiledUnder(
						tx,
						lore.map((row) => row.id)
					)
				)
				await foldRelationshipsUndatedBy(tx, theirs)
				const gone = await tx
					.delete(schema.lorebookEntries)
					.where(theirs)
					.returning({ id: schema.lorebookEntries.id })
				deleted = gone.length
			}
			await deleteMemberStats(tx, params.id)
			await tx
				.delete(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, params.id))
			const rewritten =
				tagNumber !== null && nameInProse
					? await rewriteBookCastTags(
							tx,
							existing.lorebookId,
							tagNumber,
							nameInProse
						)
					: null
			// And in what the book's merge logs keep for an undo to put back.
			if (tagNumber !== null && nameInProse)
				await rewriteMergeLogCastTags(
					tx,
					existing.lorebookId,
					tagNumber,
					nameInProse
				)
			return {
				deletedLoreCount: deleted,
				entryTypeIds: rewritten?.entryTypeIds ?? new Set<string>()
			}
		})

		const res: Sockets.NarrativeGraph.DeleteNode.Response = {
			success: "Node deleted.",
			id: params.id,
			lorebookId: existing.lorebookId,
			deletedLoreCount: deletion.deletedLoreCount
		}
		emitToUser("narrativeGraph:deleteNode", res)
		await afterCastTagRewrite(
			socket,
			emitToUser,
			lorebook,
			deletion.entryTypeIds
		)
		return res
	},
	"The cast member could not be deleted."
)

/**
 * Read-only pre-check for narrativeGraph:deleteNode's confirmation UI: whether
 * a merge log still names the member, and how much private lore they anchor.
 * bindingMergeLogs references node ids as plain JSON, not real FKs — a
 * node that's a past merge's survivorId or a relationship endpoint in some
 * log's relationshipRewrites/deletedRelationships gets silently orphaned
 * or has that merge's undo permanently disabled if deleted with no
 * warning. Queries every log for the lorebook (not the capped/summarized
 * narrativeGraph:listMergeLogs, which doesn't return the fields needed
 * here).
 */
export const narrativeGraphCheckNodeMergeReferencesHandler: Handler<
	Sockets.NarrativeGraph.CheckNodeMergeReferences.Params,
	Sockets.NarrativeGraph.CheckNodeMergeReferences.Response
> = refusable(
	"narrativeGraph:checkNodeMergeReferences",
	async (socket, params: Sockets.NarrativeGraph.CheckNodeMergeReferences.Params, emitToUser) => {
		const userId = socket.user!.id
		const { nodeId } = params

		const node = await db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, nodeId)
		})
		if (!node) throw new Error("That cast member is not in this lorebook.")

		const lorebook = await findOwnedBook(db, userId, node.lorebookId)
		if (!lorebook) throw new Error("Access denied.")

		const logs = await db.query.bindingMergeLogs.findMany({
			where: eq(schema.bindingMergeLogs.lorebookId, node.lorebookId)
		})

		const referenced = logs.some(
			(log) =>
				log.survivorId === nodeId ||
				log.relationshipRewrites.some(
					(rw) =>
						rw.oldFromNodeId === nodeId || rw.oldToNodeId === nodeId
				) ||
				(log.deletedRelationships as Record<string, unknown>[]).some(
					(rel) =>
						rel.fromNodeId === nodeId || rel.toNodeId === nodeId
				)
		)

		// The member's private lore, for the delete dialog's keep-or-delete
		// question (see `narrativeGraph:deleteNode`'s `privateLore`). Archived
		// rows are counted apart, matching the default entry list, so the
		// headline figure is what the person can see in the book.
		const anchored = await db
			.select({ archived: schema.lorebookEntries.archived })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.anchorBindingId, nodeId),
					eq(schema.lorebookEntries.typeId, CHARACTER_LORE_TYPE_ID)
				)
			)

		const res: Sockets.NarrativeGraph.CheckNodeMergeReferences.Response = {
			// Top level, so every listener filters the same way (plan B5).
			lorebookId: node.lorebookId,
			nodeId: params.nodeId,
			referencedByMergeLog: referenced,
			privateLoreCount: anchored.filter((e) => !e.archived).length,
			archivedPrivateLoreCount: anchored.filter((e) => e.archived).length
		}
		emitToUser("narrativeGraph:checkNodeMergeReferences", res)
		return res
	},
	"What refers to this cast member could not be checked."
)

export const narrativeGraphListMergeLogsHandler: Handler<
	Sockets.NarrativeGraph.ListMergeLogs.Params,
	Sockets.NarrativeGraph.ListMergeLogs.Response
> = refusable(
	"narrativeGraph:listMergeLogs",
	async (socket, params: Sockets.NarrativeGraph.ListMergeLogs.Params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId } = params

		// A read: owner, share recipient or admin (lane A3).
		await assertReadableBook(db, userId, lorebookId, {
			isAdmin: !!socket.user?.isAdmin
		})

		const logs = await db.query.bindingMergeLogs.findMany({
			where: eq(schema.bindingMergeLogs.lorebookId, lorebookId),
			orderBy: desc(schema.bindingMergeLogs.createdAt),
			limit: 20,
			with: {
				survivor: { columns: { name: true } }
			}
		})

		const res: Sockets.NarrativeGraph.ListMergeLogs.Response = {
			lorebookId,
			mergeLogs: logs.map((log) => ({
				id: log.id,
				survivorId: log.survivorId,
				survivorName: log.survivor?.name ?? null,
				absorbedName: (log.absorbedSnapshot as Record<string, unknown>)
					.name as string,
				createdAt: log.createdAt
			}))
		}
		emitToUser("narrativeGraph:listMergeLogs", res)
		return res
	},
	"The merge history could not be read."
)

export const narrativeGraphDuplicateCandidatesHandler: Handler<
	Sockets.NarrativeGraph.DuplicateCandidates.Params,
	Sockets.NarrativeGraph.DuplicateCandidates.Response
> = refusable(
	"narrativeGraph:duplicateCandidates",
	async (socket, params: Sockets.NarrativeGraph.DuplicateCandidates.Params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId } = params

		// A read: owner, share recipient or admin (lane A3).
		await assertReadableBook(db, userId, lorebookId, {
			isAdmin: !!socket.user?.isAdmin
		})

		const res = await buildDuplicateCandidates(lorebookId)
		emitToUser("narrativeGraph:duplicateCandidates", res)
		return res
	},
	"Possible duplicates could not be found."
)

export const narrativeGraphDismissDuplicateHandler: Handler<
	Sockets.NarrativeGraph.DismissDuplicate.Params,
	Sockets.NarrativeGraph.DismissDuplicate.Response
> = refusable(
	"narrativeGraph:dismissDuplicate",
	async (socket, params: Sockets.NarrativeGraph.DismissDuplicate.Params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId, bindingIdA, bindingIdB } = params

		const lorebook = await assertOwnedBook(db, userId, lorebookId)
		const primerProblem = await primerRowEditProblem(db, lorebookId)
		if (primerProblem) throw new Error(primerProblem)

		const [a, b] = orderedBindingPair(bindingIdA, bindingIdB)
		// Both this book's own members: the pair's keys reach any binding, so
		// unchecked, a caller could file a pair of another book's members
		// under their own — and learn which ids exist from the key's refusal.
		const members = await db
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(
				and(
					inArray(schema.lorebookBindings.id, [a, b]),
					eq(schema.lorebookBindings.lorebookId, lorebookId)
				)
			)
		if (members.length !== new Set([a, b]).size)
			throw new Error("Those two are not both cast members of this lorebook.")

		await db
			.insert(schema.dismissedDuplicatePairs)
			.values({ lorebookId, bindingIdA: a, bindingIdB: b })
			.onConflictDoNothing()

		// EAGER, deliberately, unlike the three cascades that go through
		// `buildDuplicateCandidates` lazily: the refreshed list IS this
		// handler's own declared reply — it just travels under the
		// `duplicateCandidates` name — so a thunk here could only skip an
		// emit, never the scan, and skipping an emit alone saves nothing.
		// Built once and used twice, which is what keeps the two answers
		// from disagreeing.
		const res: Sockets.NarrativeGraph.DismissDuplicate.Response =
			await buildDuplicateCandidates(lorebookId)
		emitToUser("narrativeGraph:duplicateCandidates", res)
		return res
	},
	"That pair could not be dismissed."
)

// The pre-merge scene backfill (findPreMergeSceneIds plus the detect/preview/
// backfill handlers) lived here. It existed to find scenes whose cast columns
// still held pre-merge NAME STRINGS instead of binding ids, and to resolve
// them one scene at a time. scene_characters.binding_id is an integer FK — a
// name string cannot be stored — so the condition it detected is now
// unrepresentable. The one-time conversion of existing name strings happens in
// the join-table migration itself, which is where a data fix belongs.

// resolveBindingName is gone — now that a bound row's `name` is always kept
// in sync with its character/persona (decision 2, see the merge plan), the
// row's own `.name` already IS the resolved display name; no separate
// resolution helper is needed.

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerNarrativeGraphHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, narrativeGraphListHandler, emitToUser)
	register(socket, narrativeGraphBuildHandler, emitToUser)
	register(socket, narrativeGraphApplyProposalHandler, emitToUser)
	register(socket, narrativeGraphDeleteNodeHandler, emitToUser)
	register(socket, narrativeGraphCheckNodeMergeReferencesHandler, emitToUser)
	register(socket, narrativeGraphUpdateRelationshipHandler, emitToUser)
	register(socket, narrativeGraphDeleteRelationshipHandler, emitToUser)
	register(socket, narrativeGraphCreateRelationshipHandler, emitToUser)
	register(socket, narrativeGraphTieSidesHandler, emitToUser)
	register(socket, narrativeGraphSetTieSideHandler, emitToUser)
	register(socket, narrativeGraphMergeNodeHandler, emitToUser)
	register(socket, narrativeGraphUndoMergeHandler, emitToUser)
	register(socket, narrativeGraphListMergeLogsHandler, emitToUser)
	register(socket, narrativeGraphDuplicateCandidatesHandler, emitToUser)
	register(socket, narrativeGraphDismissDuplicateHandler, emitToUser)
}
