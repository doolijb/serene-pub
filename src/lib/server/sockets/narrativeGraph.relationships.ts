/**
 * Relationship writes from the graph: update, delete and create a link, its
 * endpoints and the checks on its date, scene and words, and a rule-fed
 * tie's sides (`narrativeGraph:tieSides`, `narrativeGraph:setTieSide`).
 */

import { db } from "$lib/server/db"
import { primerRowEditProblem } from "$lib/server/plugins/providedMarks"
import * as schema from "$lib/server/db/schema"
import type { RelationshipVisibility } from "$lib/server/db/schema"
import { eq, and } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { HISTORY_TYPE_ID } from "$lib/server/utils/lorebookEntries"
import {
	assertRelationshipWrite,
	hasEntryEnd
} from "$lib/server/utils/relationshipGuards"
import {
	RELATIONSHIP_STATUSES,
	RELATIONSHIP_TEXT_LIMITS,
	RELATIONSHIP_VISIBILITIES
} from "$lib/shared/lorebooks/linkVocabulary"
import { refusable } from "$lib/server/sockets/refusable"
import {
	isOnLine,
	rowReadsOnLine,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import { historyEntryDate, lineOfBook } from "$lib/server/state/reading"
import { assertOwnedBook, findOwnedBook } from "$lib/server/utils/ownedBook"
import {
	entryEndpointIndex,
	wireRelationship,
	sayingOf
} from "./narrativeGraph.shared"

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * An edge's two ends, as stored: one column of each pair set, the other null.
 *
 * The database holds the rule as two CHECK constraints; this is the one place
 * the application states it, so no handler builds half a pair by hand.
 */
type EndpointColumns =
	| { nodeId: number; entryId: null }
	| { nodeId: null; entryId: number }

/** The stored pair a wire endpoint names. */
const endpointColumns = (
	endpoint: Sockets.NarrativeGraph.RelationshipEndpoint
): EndpointColumns =>
	endpoint.kind === "cast"
		? { nodeId: endpoint.bindingId, entryId: null }
		: { nodeId: null, entryId: endpoint.entryId }

/**
 * An endpoint a client named, checked against the book it claims to be in
 * and the line the link is on.
 *
 * Cross-lorebook edges are refused rather than repaired: an edge whose ends
 * live in two books belongs to neither, and the row carries one `lorebookId`.
 * An entry end must be one the link's line has — shared, the line's own, or
 * an ancestor fork's (`isOnLine`): a link on main to a fork's own room, or on
 * one fork to a sibling's, would join something that line does not hold.
 * A cast member belongs to the whole book, so a cast end has no line.
 */
async function resolveEndpoint(
	endpoint: Sockets.NarrativeGraph.RelationshipEndpoint,
	lorebookId: number,
	side: "From" | "To",
	line: Line
): Promise<EndpointColumns> {
	if (endpoint.kind === "cast") {
		const node = await db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, endpoint.bindingId),
			columns: { lorebookId: true }
		})
		if (!node || node.lorebookId !== lorebookId)
			throw new Error(
				`The ${endOf(side)} end of this link is not a cast member of this lorebook.`
			)
		return { nodeId: endpoint.bindingId, entryId: null }
	}
	const entry = await db.query.lorebookEntries.findFirst({
		where: eq(schema.lorebookEntries.id, endpoint.entryId),
		columns: { lorebookId: true, branchId: true }
	})
	if (!entry || entry.lorebookId !== lorebookId)
		throw new Error(
			`The ${endOf(side)} end of this link is not an entry in this lorebook.`
		)
	if (!isOnLine(entry, line))
		throw new Error(
			`The ${endOf(side)} end of this link was written on another line of this lorebook, so this line does not have it.`
		)
	return { nodeId: null, entryId: endpoint.entryId }
}

/** A link's end as a sentence names it. */
const endOf = (side: "From" | "To") => (side === "From" ? "first" : "second")

/**
 * The date a link is filed at — a history entry — checked as its ends are:
 * in the book, and on the link's line. On the line means read there (plan
 * A8), the rule a scene's history entry and the graph apply are held to: an
 * ancestor's entry dated after the line forked is a moment the line never
 * had, and a link dated by it would lose its date with that ancestor.
 */
async function assertLinkDate(
	historyEntryId: number,
	lorebookId: number,
	line: Line
): Promise<void> {
	const [historyEntry] = await db
		.select({
			lorebookId: schema.lorebookEntries.lorebookId,
			branchId: schema.lorebookEntries.branchId,
			fields: schema.lorebookEntries.fields
		})
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.id, historyEntryId),
				eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
			)
		)
	if (!historyEntry || historyEntry.lorebookId !== lorebookId)
		throw new Error("History entry not found.")
	if (!isOnLine(historyEntry, line))
		throw new Error(
			"That date was written on another line of this lorebook, so this line does not have it."
		)
	if (!rowReadsOnLine(historyEntry, line, historyEntryDate(historyEntry.fields)))
		throw new Error(
			"That date is later than where this line forked, so this line does not have it."
		)
}

/**
 * A link's scene, held to its line as its date is (`assertLinkDate`): a
 * scene belongs to the line it was captured on, and its date is its history
 * entry's — so a scene the line it left captured after the fork is a moment
 * this line never had, and the link would lose it with that line.
 */
async function assertLinkScene(
	scene: { branchId: number | null; historyEntryId: number | null },
	line: Line
): Promise<void> {
	if (!isOnLine(scene, line))
		throw new Error(
			"That scene was captured on another line of this lorebook, so this line does not have it."
		)
	if (scene.historyEntryId == null) return
	const [dated] = await db
		.select({ fields: schema.lorebookEntries.fields })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, scene.historyEntryId))
	if (dated && !rowReadsOnLine(scene, line, historyEntryDate(dated.fields)))
		throw new Error(
			"That scene is later than where this line forked, so this line does not have it."
		)
}

/**
 * A relationship's words as a writer states them, refused past
 * `RELATIONSHIP_TEXT_LIMITS` and outside `RELATIONSHIP_STATUSES` and
 * `RELATIONSHIP_VISIBILITIES` — a refusal, never a cut: the person typed
 * them. `stored` is the row an update lands on; a column it leaves as stored
 * is not judged again, so a row saved before the ceilings (or a 0.5.x status)
 * can still be edited in its other fields.
 */
function assertRelationshipWords(
	words: {
		relationshipType?: string | null
		reverseRelationshipType?: string | null
		title?: string | null
		description?: unknown
		reason?: unknown
		status?: unknown
		visibility?: unknown
	},
	stored?: SelectNarrativeRelationship
): void {
	const changed = <K extends keyof typeof words>(key: K) =>
		words[key] !== undefined &&
		(!stored || words[key] !== (stored as Record<string, unknown>)[key])
	const longer = (value: unknown, limit: number) =>
		typeof value === "string" && value.length > limit
	for (const key of ["description", "reason"] as const)
		if (changed(key) && words[key] != null && typeof words[key] !== "string")
			throw new Error(`A relationship's ${key} must be text.`)
	if (
		(changed("relationshipType") &&
			longer(words.relationshipType, RELATIONSHIP_TEXT_LIMITS.wording)) ||
		(changed("reverseRelationshipType") &&
			longer(
				words.reverseRelationshipType,
				RELATIONSHIP_TEXT_LIMITS.wording
			))
	)
		throw new Error(
			`A relationship's wording can be at most ${RELATIONSHIP_TEXT_LIMITS.wording} characters each way.`
		)
	if (changed("title") && longer(words.title, RELATIONSHIP_TEXT_LIMITS.name))
		throw new Error(
			`A relationship's name can be at most ${RELATIONSHIP_TEXT_LIMITS.name} characters.`
		)
	if (
		changed("description") &&
		longer(words.description, RELATIONSHIP_TEXT_LIMITS.description)
	)
		throw new Error(
			`A relationship's description can be at most ${RELATIONSHIP_TEXT_LIMITS.description} characters.`
		)
	if (changed("reason") && longer(words.reason, RELATIONSHIP_TEXT_LIMITS.reason))
		throw new Error(
			`The reason can be at most ${RELATIONSHIP_TEXT_LIMITS.reason} characters.`
		)
	if (
		changed("status") &&
		!(RELATIONSHIP_STATUSES as readonly unknown[]).includes(words.status)
	)
		throw new Error(
			`"${String(words.status)}" is not a status a relationship can have. Choose active, resolved, broken or evolved.`
		)
	if (
		changed("visibility") &&
		!(RELATIONSHIP_VISIBILITIES as readonly unknown[]).includes(
			words.visibility
		)
	)
		throw new Error(
			`"${String(words.visibility)}" is not a visibility a relationship can have. Choose secret, acknowledged or public.`
		)
}

/**
 * A relationship's words or name as a writer states them: trimmed, so the
 * one-row-per-way check and the unique index compare what a person reads.
 * Anything that is not a string is empty.
 */
const wayWords = (value: unknown): string =>
	typeof value === "string" ? value.trim() : ""

/** A reverse relationship type as stated: blank is none — one way. */
const reverseWords = (value: unknown): string | null => wayWords(value) || null

/**
 * The endpoint a payload states, in one shape.
 *
 * `from`/`to` win; `fromNodeId`/`toNodeId` are the pre-0124 spelling of a cast
 * endpoint and are accepted for one release. Naming neither is refused rather
 * than defaulted: an edge has to start somewhere, and a default would be a
 * guess at which row.
 */
function statedEndpoint(
	endpoint: Sockets.NarrativeGraph.RelationshipEndpoint | undefined,
	legacyNodeId: number | undefined,
	side: "From" | "To"
): Sockets.NarrativeGraph.RelationshipEndpoint {
	if (endpoint) return endpoint
	if (legacyNodeId != null) return { kind: "cast", bindingId: legacyNodeId }
	throw new Error(`${side} endpoint is required.`)
}

// ─── Relationship CRUD ────────────────────────────────────────────────────────

export const narrativeGraphUpdateRelationshipHandler: Handler<
	Sockets.NarrativeGraph.UpdateRelationship.Params,
	Sockets.NarrativeGraph.UpdateRelationship.Response
> = refusable(
	"narrativeGraph:updateRelationship",
	async (socket, params: Sockets.NarrativeGraph.UpdateRelationship.Params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.narrativeRelationships.findFirst({
			where: eq(schema.narrativeRelationships.id, params.relationship.id)
		})
		// Another person's link reads as one that is not there.
		// A knowledge tie is not a link: `lorebooks/entryKnowledge.ts` is its only writer.
		if (!existing || existing.knowledgeKind != null)
			throw new Error("That link is not in this lorebook.")

		const lorebook = await findOwnedBook(db, userId, existing.lorebookId)
		if (!lorebook) throw new Error("That link is not in this lorebook.")
		const primerProblem = await primerRowEditProblem(db, existing.lorebookId)
		if (primerProblem) throw new Error(primerProblem)

		// Explicit allowlist, not a denylist — a denylist previously let a
		// client rewrite fromNodeId/toNodeId/lorebookId to point anywhere.
		// Never writable here: lorebookId, embedding, embeddingModel. An
		// endpoint IS writable, and only through `from`/`to`, which go through
		// the same validation `createRelationship` puts a new endpoint through:
		// the row keeps its own lorebook and both ends must be in it.
		const fields: Partial<
			typeof schema.narrativeRelationships.$inferInsert
		> = {}
		const r = params.relationship
		/** The row's own line — where its ends and its date must be. */
		let rowLine: Line | undefined
		const lineOfRow = async () =>
			(rowLine ??= await lineOfBook(
				db,
				existing.lorebookId,
				existing.branchId ?? null
			))

		if (r.from !== undefined) {
			const from = await resolveEndpoint(
				r.from,
				existing.lorebookId,
				"From",
				await lineOfRow()
			)
			fields.fromNodeId = from.nodeId
			fields.fromEntryId = from.entryId
		}
		if (r.to !== undefined) {
			const to = await resolveEndpoint(
				r.to,
				existing.lorebookId,
				"To",
				await lineOfRow()
			)
			fields.toNodeId = to.nodeId
			fields.toEntryId = to.entryId
		}

		// 🚧 A row the rules feed (T2, T3): its fed words follow the held tie
		// side, so a hand that retypes them is refused — the number is set
		// from the tie instead (Set…, a change for review).
		if (
			existing.rulesRunId &&
			r.relationshipType !== undefined &&
			wayWords(r.relationshipType) !== existing.relationshipType
		)
			throw new Error(
				"This relationship's type comes from the rules. Set the number it follows instead."
			)
		// The words and the name, trimmed; a blank reverse is one way (B1).
		if (r.relationshipType !== undefined)
			fields.relationshipType = wayWords(r.relationshipType)
		if (r.name !== undefined) fields.title = wayWords(r.name)
		if (r.reverseRelationshipType !== undefined)
			fields.reverseRelationshipType = reverseWords(
				r.reverseRelationshipType
			)
		// NULL clears it to the empty string: the column holds text (`capText`).
		if (r.description !== undefined) fields.description = r.description ?? ""
		if (r.reason !== undefined) fields.reason = r.reason
		if (r.status !== undefined) fields.status = r.status
		// Judged, never *bounded*. This is the authoring path: a person may
		// still set `public`, which `inferredRelationshipVisibility`'s ceiling
		// makes unreachable by inference precisely because only an author can
		// claim it. A value the list does not have is refused with the words
		// below (`assertRelationshipWords`) — see `relationshipVisibility.ts`
		// on why conflating the two is the bug.
		if (r.visibility !== undefined)
			fields.visibility = r.visibility as RelationshipVisibility

		// historyEntryId/sceneId are FKs — must stay scoped to this
		// relationship's own lorebook, same reasoning as `validateBindingCrossRefs`.
		if (r.historyEntryId !== undefined) {
			if (r.historyEntryId === null) {
				fields.historyEntryId = null
			} else {
				if (r.historyEntryId !== existing.historyEntryId)
					await assertLinkDate(
						r.historyEntryId,
						existing.lorebookId,
						await lineOfRow()
					)
				fields.historyEntryId = r.historyEntryId
			}
		}
		if (r.sceneId !== undefined) {
			if (r.sceneId === null) {
				fields.sceneId = null
			} else {
				const scene = await db.query.scenes.findFirst({
					where: eq(schema.scenes.id, r.sceneId)
				})
				if (!scene || scene.lorebookId !== existing.lorebookId) {
					throw new Error("Scene not found.")
				}
				// A scene is a date pointer too: on the row's line and read
				// there, as its history entry is (`assertLinkScene`).
				if (r.sceneId !== existing.sceneId)
					await assertLinkScene(scene, await lineOfRow())
				fields.sceneId = r.sceneId
			}
		}

		const after = { ...existing, ...fields }
		// A reverse relationship type needs an entry at one end — a cast
		// tie's other side is its own perspective row. Sanitised, never
		// refused: moving both ends onto cast members takes a stored reverse
		// with it, as the CHECK requires.
		if (after.reverseRelationshipType != null && !hasEntryEnd(after)) {
			fields.reverseRelationshipType = null
			after.reverseRelationshipType = null
		}
		// From the row's own line only, never onto itself (plan B0), and never
		// a second row for one way (B1). Each is judged only when this update
		// CHANGES what it is about — compared, not merely sent: a client may
		// resend the ends it read (the canvas's `updateLinkParams` sends only
		// the form's fields, but the wire takes the whole row), so a row
		// already stored (a 0.5.x cast self-loop) can still be reworded.
		const moved =
			after.fromNodeId !== existing.fromNodeId ||
			after.fromEntryId !== existing.fromEntryId ||
			after.toNodeId !== existing.toNodeId ||
			after.toEntryId !== existing.toEntryId
		const saysOtherwise =
			moved ||
			after.relationshipType !== existing.relationshipType ||
			after.reverseRelationshipType !==
				existing.reverseRelationshipType ||
			after.title !== existing.title ||
			after.historyEntryId !== existing.historyEntryId
		await assertRelationshipWrite(db, {
			op: "update",
			row: existing,
			line: params.branchId ?? null,
			ends: moved ? after : null,
			saying: saysOtherwise ? sayingOf(after) : null
		})
		// The words, judged where they change (after the line: a writer on
		// another line hears that first).
		assertRelationshipWords(
			{
				relationshipType: fields.relationshipType,
				reverseRelationshipType: fields.reverseRelationshipType,
				title: fields.title,
				description: fields.description,
				reason: fields.reason,
				status: fields.status,
				visibility: fields.visibility
			},
			existing
		)

		await db
			.update(schema.narrativeRelationships)
			.set(fields)
			.where(eq(schema.narrativeRelationships.id, params.relationship.id))
		// A person's edit settles the fields' standing imprints at once (pr-6 A3).
		{
			const { markImprintsKept } = await import("$lib/server/lorebooks/imprints")
			await markImprintsKept(db, {
				subjectKind: "relationship",
				subjectId: params.relationship.id,
				fields: Object.keys(fields)
			})
		}

		const [updated] = await db
			.select()
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, params.relationship.id))

		const res: Sockets.NarrativeGraph.UpdateRelationship.Response = {
			relationship: wireRelationship(
				updated,
				await entryEndpointIndex([updated])
			)
		}
		emitToUser("narrativeGraph:updateRelationship", res)
		return res
	},
	"The link could not be saved."
)

export const narrativeGraphDeleteRelationshipHandler: Handler<
	Sockets.NarrativeGraph.DeleteRelationship.Params,
	Sockets.NarrativeGraph.DeleteRelationship.Response
> = refusable(
	"narrativeGraph:deleteRelationship",
	async (socket, params: Sockets.NarrativeGraph.DeleteRelationship.Params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.narrativeRelationships.findFirst({
			where: eq(schema.narrativeRelationships.id, params.id)
		})
		// Another person's link reads as one that is not there.
		// A knowledge tie is not a link: `lorebooks/entryKnowledge.ts` is its only writer.
		if (!existing || existing.knowledgeKind != null)
			throw new Error("That link is not in this lorebook.")

		const lorebook = await findOwnedBook(db, userId, existing.lorebookId)
		if (!lorebook) throw new Error("That link is not in this lorebook.")
		const primerProblem = await primerRowEditProblem(db, existing.lorebookId)
		if (primerProblem) throw new Error(primerProblem)
		// From the row's own line only (plan B0): absent or null is main.
		await assertRelationshipWrite(db, {
			op: "delete",
			row: existing,
			line: params.branchId ?? null
		})

		await db
			.delete(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, params.id))
		// 🚧 T4: the held tie sides that read onto it retire with it — in
		// every session reading the book. Never the reverse.
		try {
			await (
				await import("$lib/server/rulesets/ties")
			).retireTieSides(db, existing)
		} catch (e) {
			console.warn("[narrativeGraph] the tie sides of a deleted link could not be retired:", e)
		}

		// The id and book ride the reply so an open canvas drops the one edge
		// in place (no reload, the layout stays) and a canvas on another book
		// ignores it — the write is bare, so the listener filters.
		const res: Sockets.NarrativeGraph.DeleteRelationship.Response = {
			success: "Relationship deleted.",
			id: existing.id,
			lorebookId: existing.lorebookId
		}
		emitToUser("narrativeGraph:deleteRelationship", res)
		return res
	},
	"The link could not be deleted."
)

// ─── Create Relationship ──────────────────────────────────────────────────────

export const narrativeGraphCreateRelationshipHandler: Handler<
	Sockets.NarrativeGraph.CreateRelationship.Params,
	Sockets.NarrativeGraph.CreateRelationship.Response
> = refusable(
	"narrativeGraph:createRelationship",
	async (socket, params: Sockets.NarrativeGraph.CreateRelationship.Params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId, status, description, visibility, historyEntryId } =
			params
		// The words and the name, trimmed (plan B1).
		const relationshipType = wayWords(params.relationshipType)
		const title = wayWords(params.name)

		const lorebook = await assertOwnedBook(db, userId, lorebookId)
		const primerProblem = await primerRowEditProblem(db, lorebookId)
		if (primerProblem) throw new Error(primerProblem)

		assertRelationshipWords({
			relationshipType,
			reverseRelationshipType: reverseWords(
				params.reverseRelationshipType
			),
			title,
			description,
			status,
			visibility
		})

		/**
		 * The line the link is drawn on. A link drawn while reading a fork is
		 * that fork's, exactly as an entry written there is — so the branch
		 * must be one of THIS book's (a foreign id is refused, never clamped to
		 * main). Absent or null is main. Its ends and its date must be on it.
		 */
		const branchId = params.branchId ?? null
		if (branchId != null) {
			const branch = await db.query.lorebookBranches.findFirst({
				where: eq(schema.lorebookBranches.id, branchId),
				columns: { lorebookId: true }
			})
			if (!branch || branch.lorebookId !== lorebookId)
				throw new Error("Branch not found in this lorebook.")
		}
		const line = await lineOfBook(db, lorebookId, branchId)

		const [from, to] = await Promise.all([
			resolveEndpoint(
				statedEndpoint(params.from, params.fromNodeId, "From"),
				lorebookId,
				"From",
				line
			),
			resolveEndpoint(
				statedEndpoint(params.to, params.toNodeId, "To"),
				lorebookId,
				"To",
				line
			)
		])
		const ends = {
			fromNodeId: from.nodeId,
			fromEntryId: from.entryId,
			toNodeId: to.nodeId,
			toEntryId: to.entryId
		}
		// A blank reverse is one way; a cast tie keeps none — its other side
		// is its own perspective row (sanitised, as on update).
		const reverseRelationshipType = hasEntryEnd(ends)
			? reverseWords(params.reverseRelationshipType)
			: null

		if (historyEntryId != null)
			await assertLinkDate(historyEntryId, lorebookId, line)

		// Never onto itself, whichever kind of end (plan B0), and never a
		// second row for one way (B1).
		await assertRelationshipWrite(db, {
			op: "create",
			ends,
			saying: {
				lorebookId,
				branchId,
				historyEntryId: historyEntryId ?? null,
				title,
				relationshipType,
				reverseRelationshipType
			}
		})

		const [inserted] = await db
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId,
				branchId,
				...ends,
				relationshipType,
				title,
				reverseRelationshipType,
				visibility: (visibility ??
					"acknowledged") as RelationshipVisibility,
				status,
				description: description ?? "",
				reason: null,
				historyEntryId: historyEntryId ?? null
			})
			.returning()

		// 🚧 T4: a tie drawn on the lorebook makes its held sides in every
		// session reading the book whose rules keep ties of its kind.
		try {
			await (
				await import("$lib/server/rulesets/ties")
			).drawTieSides(db, inserted)
		} catch (e) {
			console.warn("[narrativeGraph] the held sides of a drawn tie could not be made:", e)
		}

		const res: Sockets.NarrativeGraph.CreateRelationship.Response = {
			relationship: wireRelationship(
				inserted,
				await entryEndpointIndex([inserted])
			)
		}
		emitToUser("narrativeGraph:createRelationship", res)
		return res
	},
	"The link could not be saved."
)

// ─── Ties on the graph: a rule-fed row's sides (T1–T4) ────────────────────────

/**
 * 🚧 `narrativeGraph:tieSides` (screen 3): the held sides a rule-fed row
 * reads from — each side's words and numbers, from the session whose run
 * last wrote it — and how the row changed, read from its runs' receipts.
 * The book's owner's, as the row is.
 */
export const narrativeGraphTieSidesHandler: Handler<
	Sockets.NarrativeGraph.TieSides.Params,
	Sockets.NarrativeGraph.TieSides.Response
> = refusable(
	"narrativeGraph:tieSides",
	async (socket, params: Sockets.NarrativeGraph.TieSides.Params, emitToUser) => {
		const userId = socket.user!.id
		const id = Number(params?.relationshipId)
		const existing = Number.isSafeInteger(id)
			? await db.query.narrativeRelationships.findFirst({
					where: eq(schema.narrativeRelationships.id, id)
				})
			: undefined
		if (!existing || !(await findOwnedBook(db, userId, existing.lorebookId)))
			throw new Error("That link is not in this lorebook.")
		const { sidesOfRow, tieHistory } = await import("$lib/server/rulesets/ties")
		const res: Sockets.NarrativeGraph.TieSides.Response = {
			relationshipId: existing.id,
			sides: await sidesOfRow(db, existing.id),
			history: existing.rulesRunId ? await tieHistory(db, existing.id) : []
		}
		emitToUser("narrativeGraph:tieSides", res)
		return res
	},
	"The sides of that tie could not be read."
)

/**
 * 🚧 `narrativeGraph:setTieSide` (screen 3's **Set…**): the game master sets
 * one side's number of a rule-fed row. Never written here: it files a held
 * change in that side's session, and the row follows only when it is kept.
 */
export const narrativeGraphSetTieSideHandler: Handler<
	Sockets.NarrativeGraph.SetTieSide.Params,
	Sockets.NarrativeGraph.SetTieSide.Response
> = refusable(
	"narrativeGraph:setTieSide",
	async (socket, params: Sockets.NarrativeGraph.SetTieSide.Params, emitToUser) => {
		const userId = socket.user!.id
		const id = Number(params?.relationshipId)
		const existing = Number.isSafeInteger(id)
			? await db.query.narrativeRelationships.findFirst({
					where: eq(schema.narrativeRelationships.id, id)
				})
			: undefined
		if (!existing || !(await findOwnedBook(db, userId, existing.lorebookId)))
			throw new Error("That link is not in this lorebook.")
		const primerProblem = await primerRowEditProblem(db, existing.lorebookId)
		if (primerProblem) throw new Error(primerProblem)
		const { fileHeldFieldChange } = await import("$lib/server/rulesets/ties")
		const filed = await fileHeldFieldChange(db, {
			relationshipId: existing.id,
			owner: String(params.owner ?? ""),
			field: String(params.field ?? ""),
			value: Number(params.value),
			userId
		})
		const res: Sockets.NarrativeGraph.SetTieSide.Response = {
			success: "Filed as a change for review.",
			relationshipId: existing.id,
			...filed
		}
		emitToUser("narrativeGraph:setTieSide", res)
		return res
	},
	"That number could not be set."
)
