/**
 * Applying a reviewed build: `narrativeGraph:applyProposal`, the proposal
 * read and its caps, the refusals, the check that the proposal is the
 * build's, and the set of builds being applied (`buildsBeingApplied`).
 */

import { db } from "$lib/server/db"
import { primerRowEditProblem } from "$lib/server/plugins/providedMarks"
import * as schema from "$lib/server/db/schema"
import type { NodeState, RelationshipVisibility } from "$lib/server/db/schema"
import {
	eq,
	asc,
	desc,
	and,
	or,
	isNotNull,
	isNull,
	sql,
	inArray
} from "drizzle-orm"
import {
	HISTORY_TYPE_ID,
	inBookOfType,
	mergeFields
} from "$lib/server/utils/lorebookEntries"
import { castEdgeOnly } from "$lib/server/utils/narrativeEdges"
import { worldLoreScreen } from "$lib/server/utils/graphBuilder"
import {
	activityStore,
	type GraphBuildActivity
} from "$lib/server/utils/activityStore"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import {
	collectAliases,
	entryMatches,
	type CastEntry
} from "$lib/server/utils/summarizer/availableSceneCast"
import {
	castFor,
	readSceneCasts,
	writeSceneCast
} from "$lib/server/utils/sceneCast"
import {
	inferredRelationshipVisibility,
	sanitizeRelationshipVisibility,
	VALID_RELATIONSHIP_VISIBILITIES,
	type ObjectPresence
} from "$lib/server/utils/relationshipVisibility"
import {
	assertRelationshipWrite,
	RelationshipRefusal,
	type RelationshipWrite
} from "$lib/server/utils/relationshipGuards"
import {
	RELATIONSHIP_STATUSES,
	RELATIONSHIP_TEXT_LIMITS
} from "$lib/shared/lorebooks/linkVocabulary"
import { refusable } from "$lib/server/sockets/refusable"
import type { Line } from "$lib/shared/lorebooks/lineReading"
import { nearestTieVersions } from "$lib/shared/lorebooks/tieVersions"
import {
	BranchRefusal,
	lineOfBook,
	rowsOnReading,
	type LineReading
} from "$lib/server/state/reading"
import {
	insertCastMember,
	writeCastVersion
} from "$lib/server/characters/versions"
import { onLineSql } from "$lib/server/state/lineSql"
import { bookLoreWriteMode } from "$lib/server/state/loreWriteMode"
import { LORE_WRITES_OFF } from "$lib/shared/lorebooks/loreWriteMode"
import { findOwnedBook } from "$lib/server/utils/ownedBook"
import {
	buildDuplicateCandidates,
	wireRelationships,
	directEntryOf,
	storyStatesOf,
	withStoryStates,
	buildGraphList,
	worldLoreOf
} from "./narrativeGraph.shared"

/**
 * Where on its member's line a cast version sits (its line, date, history
 * entry and life point): the `at` of an author write that lands on it. No
 * version is the base's place, main undated.
 */
function keyOfVersion(v: typeof schema.characterVersions.$inferSelect | null) {
	return {
		branchId: v?.branchId ?? null,
		date:
			v?.year == null
				? null
				: { year: v.year, month: v.month, day: v.day },
		historyEntryId: v?.historyEntryId ?? null,
		personalPosition: v?.personalPosition ?? null
	}
}

// ─── Apply Proposal ───────────────────────────────────────────────────────────

// Round-12 audit fix (MEDIUM): graphBuilder.ts's LLM-output parsers do pure
// String(...) coercion with no length cap and no validation against the
// real NodeState/RelationshipVisibility unions — the proposal is reviewed/
// edited by the user client-side before submission, but applyProposal
// (below) is the actual DB commit point. Cap/validate here rather than in
// every parser.
const MAX_NODE_NAME_LENGTH = 200

const MAX_NODE_TEXT_LENGTH = 2000

/**
 * A relationship type as an apply writes it. The builder's words are short
 * ("ally", "life_debt"); the ceiling keeps a pasted paragraph out of the
 * column every edge label and prompt line prints.
 */
const MAX_RELATIONSHIP_TYPE_LENGTH = RELATIONSHIP_TEXT_LIMITS.wording

const VALID_NODE_STATES = new Set<NodeState>([
	"active",
	"deceased",
	"missing",
	"departed"
])

const VALID_RELATIONSHIP_STATUSES = new Set<string>(RELATIONSHIP_STATUSES)

// `VALID_RELATIONSHIP_VISIBILITIES` / `sanitizeRelationshipVisibility` moved to
// `utils/relationshipVisibility.ts`, beside the bound that now caps what an
// inference may claim — the two answer one question and had to stop being
// reachable separately.

/**
 * Text cut to its ceiling. A value the wire sends as null or leaves out reads
 * as empty: the columns it fills hold text, never NULL.
 */
function capText(value: string | null | undefined, maxLength: number): string {
	return (value ?? "").slice(0, maxLength)
}

function sanitizeNodeState(value: string | undefined | null): NodeState {
	return VALID_NODE_STATES.has(value as NodeState)
		? (value as NodeState)
		: "active"
}

function sanitizeRelationshipStatus(value: string | undefined | null): string {
	return value != null && VALID_RELATIONSHIP_STATUSES.has(value)
		? value
		: "active"
}

/** A relationship type as stated: trimmed and capped. Blank is `neutral`. */
function relationshipTypeOf(value: string | undefined | null): string {
	return (
		capText((value ?? "").trim(), MAX_RELATIONSHIP_TYPE_LENGTH) || "neutral"
	)
}

const EXISTING_TEMP_ID_PREFIX = "existing_"

/**
 * `existing_<lorebookBindings.id>` → the id, or null if it isn't that shape.
 * Strict on purpose: this is the sole path from a client-supplied tempId to a
 * real row id, so anything ambiguous (leading zeros, negatives, overflow) is
 * rejected rather than coerced.
 */
function parseExistingTempId(tempId: string): number | null {
	if (!tempId.startsWith(EXISTING_TEMP_ID_PREFIX)) return null
	const raw = tempId.slice(EXISTING_TEMP_ID_PREFIX.length)
	if (!/^[1-9]\d*$/.test(raw)) return null
	const id = Number(raw)
	return Number.isSafeInteger(id) ? id : null
}

// ─── Apply: refusals ──────────────────────────────────────────────────────────

/**
 * An apply's refusal: a sentence the person can act on, which always says
 * nothing was changed — the apply is one transaction. It reaches them through
 * `refusable`; anything that is not one answers with `APPLY_FAILED` instead
 * (a TypeError's words, or a query's, are nobody's) and still reaches the
 * server log.
 */
class ApplyRefusal extends Error {}

function refuseApply(sentence: string): never {
	throw new ApplyRefusal(sentence)
}

const APPLY_FAILED = "The graph could not be applied. Nothing was changed."

/** After the commit: the graph IS written — only showing it failed. */
const APPLIED_NOT_SHOWN =
	"The graph was applied, but it could not be loaded to show you. Open the graph again to see it."

const PROPOSAL_UNREADABLE =
	"This graph proposal could not be read. Nothing was changed."

const PROPOSAL_NOT_FROM_BUILD =
	"This proposal does not match the build it came from. Nothing was changed; build the graph again."

const REVIEW_GONE =
	"This proposal has already been applied, discarded or replaced by a newer build. Nothing was changed."

const REVIEW_BEING_APPLIED =
	"This proposal is already being applied. Nothing was changed."

function unreadable(): never {
	return refuseApply(PROPOSAL_UNREADABLE)
}

// ─── Apply: reading the proposal ──────────────────────────────────────────────

/**
 * A relationship as the apply reads it: its type trimmed and capped, its
 * status one of `RELATIONSHIP_STATUSES`. Absent words, visibility or status
 * stay absent — an Extend update keeps the stored one.
 */
type ReadRelationship = Omit<
	Sockets.NarrativeGraph.RelationshipProposal,
	"description" | "visibility" | "status"
> & {
	description?: string
	visibility?: string
	status?: string
	/**
	 * The visibility the PERSON chose in review, when they changed it — set by
	 * `markPickedVisibilities`. Written as chosen: a person's choice is
	 * authoring, not an inference, so the bound never touches it.
	 */
	pickedVisibility?: RelationshipVisibility
}

/** A proposal as the apply reads it: every list present, every field its kind. */
interface ReadProposal {
	nodes: Sockets.NarrativeGraph.NodeProposal[]
	relationships: ReadRelationship[]
	updatedNodes: Sockets.NarrativeGraph.NodeUpdateProposal[]
	resolvedSceneCast: Sockets.NarrativeGraph.ResolvedSceneCast[]
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

const isText = (v: unknown): v is string => typeof v === "string"

const isOptionalText = (v: unknown): boolean => v == null || isText(v)

const isOptionalRowId = (v: unknown): boolean =>
	v == null || (Number.isSafeInteger(v) && (v as number) > 0)

const isTexts = (v: unknown): v is string[] =>
	Array.isArray(v) && v.every(isText)

const rowIdOrUndefined = (v: unknown): number | undefined =>
	v == null ? undefined : (v as number)

const textOrUndefined = (v: unknown): string | undefined =>
	v == null ? undefined : (v as string)

/**
 * The proposal as it came off the wire, checked field by field — a number
 * where a name belongs used to reach `capText` and answer with a TypeError.
 * Anything off is `PROPOSAL_UNREADABLE`.
 */
function readProposal(raw: unknown): ReadProposal {
	if (!isRecord(raw)) unreadable()
	const list = (v: unknown): unknown[] =>
		v == null ? [] : Array.isArray(v) ? v : unreadable()
	if (!Array.isArray(raw.nodes) || !Array.isArray(raw.relationships))
		unreadable()
	return {
		nodes: list(raw.nodes).map((n) => {
			if (
				!isRecord(n) ||
				!isText(n.tempId) ||
				!isText(n.name) ||
				!isOptionalText(n.nodeState) ||
				!isOptionalText(n.summary) ||
				!isOptionalRowId(n.sceneId) ||
				!isOptionalRowId(n.historyEntryId)
			)
				unreadable()
			return {
				tempId: n.tempId as string,
				name: n.name as string,
				nodeState: (n.nodeState as string | null) ?? "active",
				summary: (n.summary as string | null) ?? "",
				sceneId: rowIdOrUndefined(n.sceneId),
				historyEntryId: rowIdOrUndefined(n.historyEntryId)
			}
		}),
		relationships: list(raw.relationships).map((r): ReadRelationship => {
			if (
				!isRecord(r) ||
				!isText(r.fromTempId) ||
				!isText(r.toTempId) ||
				!isOptionalText(r.relationshipType) ||
				!isOptionalText(r.description) ||
				!isOptionalText(r.visibility) ||
				!isOptionalText(r.status) ||
				!isOptionalText(r.reason) ||
				!isOptionalRowId(r.sceneId) ||
				!isOptionalRowId(r.historyEntryId)
			)
				unreadable()
			return {
				fromTempId: r.fromTempId as string,
				toTempId: r.toTempId as string,
				relationshipType: relationshipTypeOf(
					r.relationshipType as string | null
				),
				description: textOrUndefined(r.description),
				visibility: textOrUndefined(r.visibility),
				status:
					r.status == null
						? undefined
						: sanitizeRelationshipStatus(r.status as string),
				reason: textOrUndefined(r.reason),
				sceneId: rowIdOrUndefined(r.sceneId),
				historyEntryId: rowIdOrUndefined(r.historyEntryId)
			}
		}),
		updatedNodes: list(raw.updatedNodes).map((u) => {
			if (
				!isRecord(u) ||
				!isText(u.tempId) ||
				!isOptionalText(u.nodeState) ||
				!isOptionalText(u.summary)
			)
				unreadable()
			return {
				tempId: u.tempId as string,
				name: isText(u.name) ? u.name : "",
				nodeState: textOrUndefined(u.nodeState),
				summary: textOrUndefined(u.summary)
			}
		}),
		resolvedSceneCast: list(raw.resolvedSceneCast).map((c) => {
			if (
				!isRecord(c) ||
				!isOptionalRowId(c.sceneId) ||
				!isOptionalRowId(c.historyEntryId) ||
				!isTexts(c.participantTempIds) ||
				!(c.mentionedTempIds == null || isTexts(c.mentionedTempIds))
			)
				unreadable()
			return {
				sceneId: (c.sceneId as number | null) ?? null,
				historyEntryId: (c.historyEntryId as number | null) ?? null,
				participantTempIds: c.participantTempIds as string[],
				mentionedTempIds: (c.mentionedTempIds as string[] | null) ?? []
			}
		})
	}
}

/** Which scene or direct history entry a cast entry is about. */
const castKey = (c: Sockets.NarrativeGraph.ResolvedSceneCast): string =>
	c.sceneId != null ? `scene:${c.sceneId}` : `entry:${c.historyEntryId}`

/**
 * Hold the proposal sent to the build it answers: a review removes and edits,
 * it never adds. Every new character, change to a member, relationship and
 * scene cast sent must be one the build proposed — each once (two copies of
 * one new character inserted two members, the first orphaned). That also
 * bounds the proposal's size by the build's own.
 *
 * What a review may change is left to the checks below: names, states and
 * summaries, a relationship's words, status, visibility and reason. A
 * relationship is known by its two ends, as many times as the build proposed
 * that pair; a scene's cast only loses members (the removed characters).
 */
function assertFromBuild(
	sent: ReadProposal,
	parked: Sockets.NarrativeGraph.GraphProposal
): void {
	const notFromBuild = (): never => refuseApply(PROPOSAL_NOT_FROM_BUILD)
	const once = (sentIds: string[], parkedIds: Iterable<string>) => {
		const allowed = new Set(parkedIds)
		const seen = new Set<string>()
		for (const id of sentIds) {
			if (!allowed.has(id) || seen.has(id)) notFromBuild()
			seen.add(id)
		}
	}
	once(
		sent.nodes.map((n) => n.tempId),
		parked.nodes.map((n) => n.tempId)
	)
	once(
		sent.updatedNodes.map((u) => u.tempId),
		(parked.updatedNodes ?? []).map((u) => u.tempId)
	)
	const pairs = new Map<string, number>()
	const pairOf = (r: { fromTempId: string; toTempId: string }) =>
		`${r.fromTempId}\u0000${r.toTempId}`
	for (const r of parked.relationships)
		pairs.set(pairOf(r), (pairs.get(pairOf(r)) ?? 0) + 1)
	for (const r of sent.relationships) {
		const left = pairs.get(pairOf(r)) ?? 0
		if (left === 0) notFromBuild()
		pairs.set(pairOf(r), left - 1)
	}
	const parkedCast = new Map(
		(parked.resolvedSceneCast ?? []).map((c) => [castKey(c), c])
	)
	once(sent.resolvedSceneCast.map(castKey), parkedCast.keys())
	for (const c of sent.resolvedSceneCast) {
		const was = parkedCast.get(castKey(c))!
		const within = (sentIds: string[], parkedIds: string[]) =>
			sentIds.every((t) => parkedIds.includes(t))
		if (
			!within(c.participantTempIds, was.participantTempIds) ||
			!within(c.mentionedTempIds, was.mentionedTempIds)
		)
			notFromBuild()
	}
}

/**
 * Mark each relationship whose visibility the person changed in review.
 *
 * The review's picker holds the build's claim until the person changes it, so
 * a value the build never proposed for that pair — nor for any other of the
 * same two ends, since a review may have removed one of several — is the
 * person's (plan A21 review: a picked `public` was written `acknowledged`, the
 * pick read as a model's claim). A value the build did propose stays a claim,
 * and is bounded as one; so an ambiguous pick errs toward the bound.
 */
function markPickedVisibilities(
	sent: ReadRelationship[],
	parked: Sockets.NarrativeGraph.RelationshipProposal[]
): void {
	const pairOf = (r: { fromTempId: string; toTempId: string }) =>
		`${r.fromTempId}\u0000${r.toTempId}`
	const proposed = new Map<string, Set<string | undefined>>()
	for (const r of parked) {
		const seen = proposed.get(pairOf(r)) ?? new Set()
		seen.add(r.visibility ?? undefined)
		proposed.set(pairOf(r), seen)
	}
	for (const r of sent) {
		const v = r.visibility as RelationshipVisibility | undefined
		if (
			v !== undefined &&
			VALID_RELATIONSHIP_VISIBILITIES.has(v) &&
			!proposed.get(pairOf(r))?.has(v)
		)
			r.pickedVisibility = v
	}
}

// ─── Apply: the build it answers ──────────────────────────────────────────────

/**
 * Builds being applied right now, by activity id — the other half of
 * consuming one. A build's activity is taken away once its apply commits; this
 * holds it while the transaction runs, so a second apply of it (a retry, a
 * second tab) is refused instead of queueing behind the first and applying it
 * again.
 */
const buildsBeingApplied = new Set<string>()

/** The build parked at review as `activityId`, when it is this person's for this book. */
function reviewAwaiting(
	activityId: string,
	userId: number,
	lorebookId: number
):
	| (GraphBuildActivity & { proposal: Sockets.NarrativeGraph.GraphProposal })
	| null {
	const build = activityStore.getById(activityId)
	if (
		build?.kind !== "graph_build" ||
		build.userId !== userId ||
		build.lorebookId !== lorebookId ||
		build.status !== "review" ||
		!build.proposal
	)
		return null
	return build as GraphBuildActivity & {
		proposal: Sockets.NarrativeGraph.GraphProposal
	}
}

/** "1 relationship was" / "3 relationships were". */
const relationshipsWere = (n: number): string =>
	n === 1 ? "1 relationship was" : `${n} relationships were`

/**
 * The member each of `ids` was merged into, for those that were — following
 * later merges to the member who still stands in this book. Read from the
 * book's merge logs: a merged member's row is gone, and its id lives on only
 * in the log's snapshot of it. A member deleted outright is absent.
 */
async function mergedInto(
	lorebookId: number,
	ids: number[]
): Promise<
	Map<
		number,
		{ survivorId: number; survivorName: string; absorbedName: string }
	>
> {
	const logs = await db
		.select({
			survivorId: schema.bindingMergeLogs.survivorId,
			absorbed: schema.bindingMergeLogs.absorbedSnapshot
		})
		.from(schema.bindingMergeLogs)
		.where(eq(schema.bindingMergeLogs.lorebookId, lorebookId))
		.orderBy(asc(schema.bindingMergeLogs.id))
	/** Absorbed id → the member it joined, and its own name; the latest merge wins. */
	const joined = new Map<number, { into: number | null; name: string }>()
	for (const log of logs) {
		const id = log.absorbed?.id
		if (typeof id !== "number") continue
		const name = log.absorbed.name
		joined.set(id, {
			into: log.survivorId,
			name: typeof name === "string" ? name : ""
		})
	}
	const ends = new Map<number, number>()
	for (const id of ids) {
		let at: number | null = id
		const seen = new Set<number>()
		while (at != null && joined.has(at) && !seen.has(at)) {
			seen.add(at)
			at = joined.get(at)!.into
		}
		if (at != null && at !== id) ends.set(id, at)
	}
	const answer = new Map<
		number,
		{ survivorId: number; survivorName: string; absorbedName: string }
	>()
	if (ends.size === 0) return answer
	const standing = await db.query.lorebookBindings.findMany({
		where: (n, { and, eq, inArray }) =>
			and(
				inArray(n.id, [...new Set(ends.values())]),
				eq(n.lorebookId, lorebookId)
			),
		columns: { id: true, name: true, binding: true }
	})
	const nameOf = new Map(standing.map((m) => [m.id, m.name || m.binding]))
	for (const [id, survivorId] of ends) {
		const survivorName = nameOf.get(survivorId)
		if (survivorName !== undefined)
			answer.set(id, {
				survivorId,
				survivorName,
				absorbedName: joined.get(id)!.name
			})
	}
	return answer
}

/**
 * Commit a reviewed graph proposal (plan A21).
 *
 * An apply answers ONE parked build (`activityId`), and the build — never the
 * client — decides what it is: its mode, what it read (stamped graphed), the
 * proposal the review may only have trimmed and edited. The apply consumes the
 * build in the same transaction that writes it, so it lands once.
 *
 * Removing a proposed character in review takes its relationships with it
 * (the modal does so; a relationship still naming one is dropped here with a
 * note, never refused). A new character whose name is now a member's — one
 * added while the review was open, or a name the review typed — joins that
 * member, as `resolveOrCreateBindingByName` would; one whose name is a place's
 * or a thing's is refused, as the build would have screened it.
 */
export const narrativeGraphApplyProposalHandler = refusable<
	Sockets.NarrativeGraph.ApplyProposal.Params,
	Sockets.NarrativeGraph.ApplyProposal.Response
>(
	"narrativeGraph:applyProposal",
	async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sent: unknown = params
		if (
			!isRecord(sent) ||
			!Number.isSafeInteger(sent.lorebookId) ||
			!isText(sent.activityId)
		)
			unreadable()
		const lorebookId = sent.lorebookId as number
		const activityId = sent.activityId as string
		const requestId = isText(sent.requestId) ? sent.requestId : undefined

		const lorebook = await findOwnedBook(db, userId, lorebookId)
		if (!lorebook)
			refuseApply("That lorebook was not found. Nothing was changed.")
		const primerProblem = await primerRowEditProblem(db, lorebookId)
		if (primerProblem) refuseApply(primerProblem)
		// The owner's lore write mode Off: nothing a build proposed is
		// written (plan A22), even from a review opened before it was set.
		if ((await bookLoreWriteMode(db, lorebookId)) === "off")
			refuseApply(LORE_WRITES_OFF)

		const build = reviewAwaiting(activityId, userId, lorebookId)
		if (!build) refuseApply(REVIEW_GONE)
		const mode = build.mode
		/**
		 * The line the build read, which is where its ties are written
		 * (plan A3) — the build's, never the client's. Null is main.
		 */
		const writeBranchId = build.branchId ?? null
		let line: Line
		try {
			line = await lineOfBook(db, lorebookId, writeBranchId)
		} catch (e) {
			if (e instanceof BranchRefusal)
				refuseApply(
					"The line this graph was built on has been deleted. Nothing was changed."
				)
			throw e
		}
		/** The build's line at its head: what the line holds, fork cuts applied. */
		const writeReading: LineReading = {
			lorebookId,
			branchId: writeBranchId,
			moment: null,
			forkedAt: null,
			line
		}
		const proposal = readProposal(sent.proposal)
		assertFromBuild(proposal, build.proposal)
		markPickedVisibilities(
			proposal.relationships,
			build.proposal.relationships
		)

		// A new character is new: the builder never lists a member among them,
		// and inserting one would put a second row beside them on every apply.
		if (proposal.nodes.some((n) => parseExistingTempId(n.tempId) != null))
			refuseApply(
				"This proposal would add a member who is already in the cast. Nothing was changed; build the graph again."
			)
		if (proposal.nodes.some((n) => !n.name.trim()))
			refuseApply(
				"Every new character needs a name. Nothing was changed."
			)

		/** What this apply did otherwise than the proposal says — for the person. */
		const applyNotes: string[] = []

		/**
		 * A relationship naming a character the review removed goes with them.
		 * The modal takes them out itself; one that still arrives is left out
		 * here with a note — before this, Apply refused the whole proposal
		 * ("references an unknown node") and the review was stuck.
		 */
		const keptNewTempIds = new Set(proposal.nodes.map((n) => n.tempId))
		const resolvable = (tempId: string) =>
			keptNewTempIds.has(tempId) || parseExistingTempId(tempId) != null
		const removedInReview = new Set(
			build.proposal.nodes
				.map((n) => n.tempId)
				.filter((t) => !keptNewTempIds.has(t))
		)
		for (const r of proposal.relationships)
			for (const end of [r.fromTempId, r.toTempId])
				if (!resolvable(end) && !removedInReview.has(end))
					refuseApply(
						"This proposal names a character that is not in it. Nothing was changed; build the graph again."
					)
		const relationships = proposal.relationships.filter(
			(r) => resolvable(r.fromTempId) && resolvable(r.toTempId)
		)
		const leftWithRemoved =
			proposal.relationships.length - relationships.length
		if (leftWithRemoved > 0)
			applyNotes.push(
				`${relationshipsWere(leftWithRemoved)} left out because a character ${
					leftWithRemoved === 1 ? "it names" : "they name"
				} was removed from the proposal.`
			)
		// …and out of the scene casts it was in.
		let resolvedSceneCast = proposal.resolvedSceneCast.map((c) => ({
			...c,
			participantTempIds: c.participantTempIds.filter(resolvable),
			mentionedTempIds: c.mentionedTempIds.filter(resolvable)
		}))
		for (const u of proposal.updatedNodes)
			if (parseExistingTempId(u.tempId) == null)
				refuseApply(PROPOSAL_NOT_FROM_BUILD)

		// Replace mode redefinition (post-merge — see the lorebookBindings/
		// narrativeNodes merge plan): a binding IS the character's identity
		// and lore-privacy anchor now, so wholesale delete-and-rebuild would
		// destroy real character relationships, not just graph-derived
		// state. A rebuild NEVER deletes a lorebookBindings row, full stop,
		// and never touches its existing fields either — nothing downstream
		// of a fresh build ever writes fresh values back onto an existing
		// binding (summary/state included; see graphBuilder.ts's header and
		// the deferred update-tracking note below), so there is no refill
		// for any field a reset would clear. A previous version of this
		// branch reset nodeState/nodeVisibility/summary/parentNodeId/
		// sceneId/historyEntryId/embedding/embeddingModel/vectorizedAt to
		// defaults and cleared bindingMergeLogs.relationshipRewrites/
		// deletedRelationships to `[]` on every row/log in the lorebook —
		// silent, unrecoverable data loss (a real merge hierarchy in
		// parentNodeId, a past merge's restorable relationship content) with
		// no compensating benefit: the "crash-prone otherwise" justification
		// for clearing the merge-log fields didn't hold up either: undo's
		// rewrite-restore loop is a no-op against a relationship id that no
		// longer exists, and its re-insert loop skips (and counts) any
		// snapshotted link whose endpoints are gone, so leaving them
		// populated is strictly safe, not just less destructive.
		// bindingMergeLogs also has no real FK protection on the node ids it
		// stores (aside from survivorId's onDelete: "set null"), which is
		// why a rebuild never deletes a lorebookBindings row at all — a
		// deleted relationship endpoint would leave relationshipRewrites/
		// deletedRelationships dangling, and a deleted past merge *survivor*
		// would silently null survivorId, permanently disabling that merge's
		// undo with no visible error until someone tried it. Manual
		// per-node deletion is still available via
		// narrativeGraphDeleteNodeHandler for a user who actually wants a
		// ghost row gone. Cast ties are wiped wholesale and rebuilt from
		// the fresh proposal — bindingMergeLogs keeps referencing them by id
		// from the log's own JSON snapshot/rewrite records, not a live FK, so
		// the wipe below doesn't orphan anything a future undo depends on.
		//
		// ⚠ Cast ties ONLY — both ends cast members (`castEdgeOnly`). A
		// relationship with an entry at either end (a road between two places,
		// the keeper of a place) is never deleted, created or rewritten here:
		// the builder cannot derive one, and places are "largely static"
		// (owner ruling 2026-09-29, Q1 — "Rebuild is only for relationships",
		// superseding ruling 6 of 2026-09-28's wipe-everything). The proposal
		// cannot name an entry either: every endpoint resolves to a binding
		// below. The confirmation counts what this deletes —
		// `narrativeGraph:list`'s `relationshipCounts.castToCast`.
		// The wipe runs inside the transaction below, so a throw rolls it back
		// instead of leaving the graph deleted with nothing put back.

		/**
		 * Build tempId → real binding id WITHOUT trusting the client.
		 *
		 * Every tempId graphBuilder emits for an existing row is literally
		 * `existing_<lorebookBindings.id>`, so the id IS the payload — there
		 * is no client map to trust. Every `existing_` id the apply will write
		 * with is checked against this book here: the relationships' ends,
		 * the member changes, and the scene casts' participants (a scene's
		 * lone participant is in no relationship — unchecked, it was dropped
		 * from the cast the apply saves).
		 *
		 * Discovered nodes use `new_N` tempIds and are resolved by the INSERT
		 * loop instead — they have no id yet, by design.
		 */
		const tempIdMap = new Map<string, number>()
		/** Members a relationship or a change names — each must still be here. */
		const namedIds = new Set<number>()
		for (const tempId of [
			...relationships.flatMap((r) => [r.fromTempId, r.toTempId]),
			...proposal.updatedNodes.map((u) => u.tempId)
		]) {
			const id = parseExistingTempId(tempId)
			if (id == null) continue
			tempIdMap.set(tempId, id)
			namedIds.add(id)
		}
		for (const tempId of resolvedSceneCast.flatMap(
			(c) => c.participantTempIds
		)) {
			const id = parseExistingTempId(tempId)
			if (id != null) tempIdMap.set(tempId, id)
		}
		const seededIds = [...new Set(tempIdMap.values())]
		if (seededIds.length > 0) {
			const rows = await db.query.lorebookBindings.findMany({
				where: (n, { inArray }) => inArray(n.id, seededIds),
				columns: { id: true, lorebookId: true }
			})
			if (rows.some((r) => r.lorebookId !== lorebookId))
				refuseApply(
					"This proposal names a character from another book. Nothing was changed."
				)
			const live = new Set(rows.map((r) => r.id))
			if ([...namedIds].some((id) => !live.has(id)))
				refuseApply(
					"A character in this proposal was deleted while it was being reviewed. Nothing was changed; build the graph again."
				)
			/**
			 * A member only a scene's cast names, deleted or merged away while
			 * the review was open (plan A21 review). Refusing the whole apply
			 * for them cost a paid rebuild, and it is not what a deleted scene
			 * does: the cast is saved without them, or with the member they
			 * joined — each said in a note.
			 */
			const gone = seededIds.filter((id) => !live.has(id))
			if (gone.length > 0) {
				const joined = await mergedInto(lorebookId, gone)
				for (const id of gone) {
					const tempId = `${EXISTING_TEMP_ID_PREFIX}${id}`
					const into = joined.get(id)
					const name =
						build.seedNodeNames?.[tempId] ??
						into?.absorbedName ??
						"A character"
					if (into) {
						tempIdMap.set(tempId, into.survivorId)
						applyNotes.push(
							`${name} was merged into ${into.survivorName} while this was being reviewed, so ${into.survivorName} is listed in the scenes ${name} was in.`
						)
					} else {
						tempIdMap.delete(tempId)
						applyNotes.push(
							`${name} was deleted while this was being reviewed, so the scenes ${name} was in were saved without them.`
						)
					}
				}
			}
		}

		/**
		 * The scenes and history entries the proposal names, checked against
		 * this book — each is client-supplied, and the cast write-back names
		 * scene rows it UPDATES. One from another book is refused. One deleted
		 * while the review was open (realistic: a scene or a timeline event
		 * deleted from another tab) is refused when a new character or a
		 * relationship is filed under it, and quietly skipped when only a
		 * scene cast names it — there is no row left to save a cast to.
		 */
		const filedSceneIds = new Set<number>()
		const filedHistoryEntryIds = new Set<number>()
		for (const r of [...proposal.nodes, ...relationships]) {
			if (r.sceneId != null) filedSceneIds.add(r.sceneId)
			if (r.historyEntryId != null)
				filedHistoryEntryIds.add(r.historyEntryId)
		}
		const castSceneIds = resolvedSceneCast
			.map((c) => c.sceneId)
			.filter((id): id is number => id != null)
		const castHistoryEntryIds = resolvedSceneCast
			.map((c) => c.historyEntryId)
			.filter((id): id is number => id != null)
		const sceneIds = [...new Set([...filedSceneIds, ...castSceneIds])]
		const foundScenes =
			sceneIds.length === 0
				? []
				: await db.query.scenes.findMany({
						where: (s, { inArray }) => inArray(s.id, sceneIds),
						columns: {
							id: true,
							lorebookId: true,
							branchId: true,
							historyEntryId: true
						}
					})
		if (foundScenes.some((s) => s.lorebookId !== lorebookId))
			refuseApply(
				"This proposal names a scene from another book. Nothing was changed."
			)
		const liveSceneIds = new Set(foundScenes.map((s) => s.id))
		if ([...filedSceneIds].some((id) => !liveSceneIds.has(id)))
			refuseApply(
				"A scene this proposal came from has been deleted. Nothing was changed; build the graph again."
			)
		// Filed where the build wrote, at a date the line has: a scene on
		// another line, or an ancestor's dated past the fork's cut, is a story
		// this line does not have — the build could never have read it (plan
		// A3 review). A scene is dated by its history entry.
		const filedScenesOnLine = new Set(
			(
				await rowsOnReading(
					db,
					foundScenes
						.filter((s) => filedSceneIds.has(s.id))
						.map((s) => ({
							id: s.id,
							branchId: s.branchId,
							historyEntryId: s.historyEntryId
						})),
					writeReading
				)
			).map((s) => s.id)
		)
		if (
			foundScenes.some(
				(s) => filedSceneIds.has(s.id) && !filedScenesOnLine.has(s.id)
			)
		)
			refuseApply(
				"A scene this proposal came from is on another line of this lorebook. Nothing was changed."
			)
		const historyEntryIds = [
			...new Set([...filedHistoryEntryIds, ...castHistoryEntryIds])
		]
		const foundEntries =
			historyEntryIds.length === 0
				? []
				: await db
						.select({
							id: schema.lorebookEntries.id,
							lorebookId: schema.lorebookEntries.lorebookId,
							typeId: schema.lorebookEntries.typeId,
							branchId: schema.lorebookEntries.branchId
						})
						.from(schema.lorebookEntries)
						.where(
							inArray(schema.lorebookEntries.id, historyEntryIds)
						)
		if (
			foundEntries.some(
				(e) =>
					e.lorebookId !== lorebookId || e.typeId !== HISTORY_TYPE_ID
			)
		)
			refuseApply(
				"This proposal names a history entry from another book. Nothing was changed."
			)
		const liveHistoryEntryIds = new Set(foundEntries.map((e) => e.id))
		if (
			[...filedHistoryEntryIds].some((id) => !liveHistoryEntryIds.has(id))
		)
			refuseApply(
				"A history entry this proposal came from has been deleted. Nothing was changed; build the graph again."
			)
		const filedEntriesOnLine = new Set(
			(
				await rowsOnReading(
					db,
					foundEntries
						.filter((e) => filedHistoryEntryIds.has(e.id))
						.map((e) => ({
							id: e.id,
							branchId: e.branchId,
							historyEntryId: e.id
						})),
					writeReading
				)
			).map((e) => e.id)
		)
		if (
			foundEntries.some(
				(e) =>
					filedHistoryEntryIds.has(e.id) && !filedEntriesOnLine.has(e.id)
			)
		)
			refuseApply(
				"A history entry this proposal came from is on another line of this lorebook. Nothing was changed."
			)
		resolvedSceneCast = resolvedSceneCast.filter((c) =>
			c.sceneId != null
				? liveSceneIds.has(c.sceneId)
				: c.historyEntryId == null ||
					liveHistoryEntryIds.has(c.historyEntryId)
		)

		// Everything below writes the graph for this lorebook in one pass —
		// one transaction, so a failure partway (nodes inserted, their
		// relationships not) leaves nothing half-applied.
		let holding = false
		try {
			await db.transaction(async (tx) => {
				// Consume the build — first, before anything is written. Another
				// apply of it either is running (held) or has committed (taken
				// away below); either way this one refuses, and writes nothing.
				if (buildsBeingApplied.has(activityId))
					refuseApply(REVIEW_BEING_APPLIED)
				if (reviewAwaiting(activityId, userId, lorebookId) !== build)
					refuseApply(REVIEW_GONE)
				buildsBeingApplied.add(activityId)
				holding = true

				// The book's cast lock — the key every cast writer takes
				// (`resolveOrCreateBindingByName`, `syncLorebookBindings`), so
				// the name check below and the insert after it cannot race a
				// member added by another write.
				await tx.execute(
					sql`select pg_advisory_xact_lock(${lorebookId})`
				)

				// Replace mode deletes the book's cast ties — every line's — and
				// rebuilds them from the proposal (see the note above).
				if (mode === "replace") {
					await tx
						.delete(schema.narrativeRelationships)
						.where(
							and(
								eq(
									schema.narrativeRelationships.lorebookId,
									lorebookId
								),
								castEdgeOnly
							)
						)
				}

				/**
				 * The cast as it stands now, for the re-screen: a new
				 * character's name is checked again at commit, against members
				 * added and places created while the review was open.
				 */
				const members = await tx.query.lorebookBindings.findMany({
					where: eq(schema.lorebookBindings.lorebookId, lorebookId),
					columns: {
						id: true,
						name: true,
						aliases: true,
						absorbedAliases: true
					}
				})
				/** Members before this apply — the rows Extend may update ties between. */
				const standing = new Set(members.map((m) => m.id))
				const cast: CastEntry[] = members.map((m) => ({
					id: m.id,
					name: m.name,
					aliases: collectAliases(m)
				}))
				const nameOf = new Map(members.map((m) => [m.id, m.name]))
				const isPlaceOrThing = worldLoreScreen(
					await worldLoreOf(lorebookId, tx)
				)
				/** Members this apply added — a second new name matching one is not "already in the cast". */
				const addedHere = new Set<number>()

				// INSERT discovered characters — at apply, once, after the
				// person kept them through review. `existing_` tempIds never
				// reach here (`assertFromBuild` holds nodes to the build's own
				// new ones, and graphBuilder never puts a seed among them).
				for (const nodeProposal of proposal.nodes) {
					const name = capText(
						nodeProposal.name.trim(),
						MAX_NODE_NAME_LENGTH
					)
					// The build's own rule, run again: a name that is a
					// member's IS that member (as `resolveOrCreateBindingByName`
					// answers) — never a second row beside them.
					const member = cast.find((c) => entryMatches(c, name))
					if (member?.id != null) {
						tempIdMap.set(nodeProposal.tempId, member.id)
						applyNotes.push(
							addedHere.has(member.id)
								? `Two new characters were both named ${member.name}, so they were added as one.`
								: `${member.name} is already in the cast, so the proposal's ${name} was added to that member instead of a new one.`
						)
						continue
					}
					if (isPlaceOrThing(name))
						refuseApply(
							`“${name}” is the name of a place or thing in this book, so it can't be added as a character. Rename it or remove it, then apply again. Nothing was changed.`
						)
					const token = await deriveNextBindingToken(lorebookId, tx)
					const { member: inserted } = await insertCastMember(
						tx,
						{
							lorebookId,
							characterId: null,
							createdBy: userId,
							binding: token,
							name,
							nodeState: sanitizeNodeState(
								nodeProposal.nodeState
							),
							summary: capText(
								nodeProposal.summary ?? "",
								MAX_NODE_TEXT_LENGTH
							),
							sceneId: nodeProposal.sceneId ?? null,
							historyEntryId: nodeProposal.historyEntryId ?? null
						},
						{ writtenBy: `user:${userId}` }
					)
					tempIdMap.set(nodeProposal.tempId, inserted.id)
					addedHere.add(inserted.id)
					cast.push({ id: inserted.id, name, aliases: [] })
					nameOf.set(inserted.id, name)
				}

				// UPDATE existing bindings with description/state derived during
				// the build. Separate from the INSERT loop above ON PURPOSE — an
				// existing binding is updated in place and never re-inserted.
				// Identity fields (name, aliases, binding token, characterId,
				// personaId, parentNodeId, nodeVisibility) are never written here:
				// they belong to entity sync and to the merge hierarchy, and the
				// never-reset invariant above depends on this loop not touching
				// them. A summary this writes moves the row's embedded text, and
				// the queue's text hash re-embeds it, so nothing nulls the vector
				// by hand.
				for (const update of proposal.updatedNodes) {
					const id = tempIdMap.get(update.tempId)
					if (id == null) refuseApply(PROPOSAL_NOT_FROM_BUILD)
					if (update.nodeState !== undefined) {
						// The state is a cast version's now (the column is
						// frozen): written at the key of the version in force at
						// the build's line head, so that line reads it there.
						// Nothing is written when the state already reads so.
						const nodeState = sanitizeNodeState(update.nodeState)
						const [member] = await tx
							.select({
								id: schema.lorebookBindings.id
							})
							.from(schema.lorebookBindings)
							.where(
								and(
									eq(schema.lorebookBindings.id, id),
									eq(
										schema.lorebookBindings.lorebookId,
										lorebookId
									)
								)
							)
						if (member) {
							const read = (
								await storyStatesOf(tx, [member], writeReading)
							).get(id)!
							if (read.nodeState !== nodeState) {
								await writeCastVersion(tx, {
									member: id,
									changes: { nodeState },
									writtenBy: `user:${userId}`,
									at: keyOfVersion(read.version)
								})
							}
						}
					}
					if (update.summary !== undefined) {
						// Fill-blanks-only, enforced in the WHERE rather than by
						// reading first: a non-empty summary is either a prior
						// build's output or a hand edit made through
						// lorebooks:updateBinding (which does not strip `summary`),
						// and the column cannot tell them apart. Encoding it here
						// also means a concurrent edit can't slip through, and the
						// client-supplied previousSummary is never trusted.
						const summary = capText(
							update.summary,
							MAX_NODE_TEXT_LENGTH
						)
						const filled = await tx
							.update(schema.lorebookBindings)
							.set({ summary })
							.where(
								and(
									eq(schema.lorebookBindings.id, id),
									eq(
										schema.lorebookBindings.lorebookId,
										lorebookId
									),
									or(
										isNull(schema.lorebookBindings.summary),
										eq(schema.lorebookBindings.summary, "")
									)
								)
							)
							.returning({ id: schema.lorebookBindings.id })
						// The base keeps in step: the summary is a profile field
						// of the member's versions too.
						if (filled.length > 0)
							await writeCastVersion(tx, {
								member: id,
								changes: { summary },
								writtenBy: `user:${userId}`,
								at: {
									branchId: null,
									date: null,
									personalPosition: null
								}
							})
					}
				}

				/**
				 * Who was actually THERE, per scene — what bounds an inferred
				 * relationship's publicity (plan §6).
				 *
				 * Built before the relationship loop because that loop needs it,
				 * and from `participantTempIds` rather than from the derived
				 * mentions: presence is the stored decision, so the bound is
				 * unaffected by how far the annotation lane has got. A scene
				 * whose mentions are still `pending` still bounds its edges
				 * correctly.
				 *
				 * `resolvedSceneCast` covers the scenes this build re-derived —
				 * the modal sends it back (it did not, so every such scene read
				 * as empty: new edges were born `secret` and Extend demoted
				 * `acknowledged` ones); every other scene keeps whatever cast it
				 * already had, so its stored participants are read. Both are
				 * needed — a build in extend mode legitimately updates an edge
				 * belonging to a scene it did not touch.
				 */
				const presentBySceneId = new Map<number, Set<number>>()
				for (const resolved of resolvedSceneCast) {
					if (resolved.sceneId == null) continue
					presentBySceneId.set(
						resolved.sceneId,
						new Set(
							resolved.participantTempIds
								.map((t) => tempIdMap.get(t))
								.filter((id): id is number => id != null)
						)
					)
				}
				{
					const unresolved = [...filedSceneIds].filter(
						(id) => !presentBySceneId.has(id)
					)
					if (unresolved.length > 0) {
						const stored = await readSceneCasts(unresolved, tx)
						for (const id of unresolved)
							presentBySceneId.set(
								id,
								new Set(
									castFor(stored, id).participantCharacters
								)
							)
					}
				}
				/**
				 * Where the OBJECT of an edge stood in the scene it came from.
				 *
				 * `unknown` for an edge with no scene — a direct history entry
				 * has no cast row to read, and inventing privacy from an absence
				 * of evidence would hide edges nobody claimed were private.
				 * `public` is refused in every case; that rule does not depend
				 * on provenance.
				 *
				 * ⚠ Also `unknown` for a scene the map does not hold, which is a
				 * scene the proposal never referenced — reachable only through
				 * an update falling back to the stored `sceneId`. Deliberately
				 * not "absent": failing to *resolve* a cast is not evidence the
				 * object was missing from it, and this bound must only ever err
				 * wide, never tighten an existing row on a fact it could not
				 * establish.
				 */
				const presenceOf = (
					sceneId: number | null | undefined,
					objectId: number
				): ObjectPresence => {
					if (sceneId == null) return "unknown"
					const present = presentBySceneId.get(sceneId)
					if (!present) return "unknown"
					return present.has(objectId) ? "present" : "absent"
				}

				/**
				 * Where the object stood in the scene a STANDING tie is filed at
				 * — for a tie a later scene re-states (plan A21 review). Its
				 * scene is where the tie's publicity was established, and the
				 * re-stating scene lacking the object is no evidence about it:
				 * judged by the re-stating scene alone, an Extend demoted an
				 * `acknowledged` tie whenever a scene of the same date mentioned
				 * it without its object there.
				 *
				 * The proposal's own casts when it has that scene; otherwise the
				 * scene's saved cast, and only once saved (`castResolvedAt`) — an
				 * unsaved cast is no evidence, so `unknown`, which errs wide.
				 */
				const savedPresence = new Map<number, Set<number> | null>()
				const presenceAtFiledScene = async (
					sceneId: number | null,
					objectId: number
				): Promise<ObjectPresence> => {
					if (sceneId == null) return "unknown"
					if (presentBySceneId.has(sceneId))
						return presenceOf(sceneId, objectId)
					if (!savedPresence.has(sceneId)) {
						const scene = await tx.query.scenes.findFirst({
							where: and(
								eq(schema.scenes.id, sceneId),
								eq(schema.scenes.lorebookId, lorebookId)
							),
							columns: { castResolvedAt: true }
						})
						savedPresence.set(
							sceneId,
							scene?.castResolvedAt
								? new Set(
										castFor(
											await readSceneCasts([sceneId], tx),
											sceneId
										).participantCharacters
									)
								: null
						)
					}
					const present = savedPresence.get(sceneId)
					if (!present) return "unknown"
					return present.has(objectId) ? "present" : "absent"
				}
				/** The wider of two answers: there in either is there. */
				const wider = (
					a: ObjectPresence,
					b: ObjectPresence
				): ObjectPresence =>
					a === "present" || b === "present"
						? "present"
						: a === "absent" && b === "absent"
							? "absent"
							: "unknown"

				/**
				 * Relationships the bound wrote narrower than the review showed
				 * them — said in a note, so what the person approved and what
				 * was saved never differ in silence.
				 */
				let boundToSecret = 0
				let boundFromPublic = 0
				const countBound = (
					shown: string | undefined,
					written: RelationshipVisibility | undefined
				) => {
					if (written === undefined) return
					const claim = sanitizeRelationshipVisibility(shown)
					if (written === "secret" && claim !== "secret")
						boundToSecret++
					else if (claim === "public" && written !== "public")
						boundFromPublic++
				}

				/**
				 * The date a link version is filed at, as the history entry that
				 * carries it — a scene's date is its history entry's. `null` for
				 * a version with neither: an undated link.
				 *
				 * The history entry stands in for the date on purpose: two
				 * versions under one entry are one dated state, and comparing
				 * ids needs no calendar. Cached, since every candidate version
				 * asks.
				 */
				const historyOfScene = new Map<number, number | null>()
				const dateKeyOf = async (
					historyEntryId: number | null,
					sceneId: number | null
				): Promise<number | null> => {
					if (historyEntryId != null) return historyEntryId
					if (sceneId == null) return null
					if (!historyOfScene.has(sceneId)) {
						const scene = await tx.query.scenes.findFirst({
							where: eq(schema.scenes.id, sceneId),
							columns: { historyEntryId: true }
						})
						historyOfScene.set(
							sceneId,
							scene?.historyEntryId ?? null
						)
					}
					return historyOfScene.get(sceneId) ?? null
				}

				/**
				 * Every relationship write is judged by the guard every other
				 * writer goes through (plan B0): never onto itself, never another
				 * line's row. Its refusal is the person's sentence, and the whole
				 * apply rolls back.
				 */
				const guarded = async (write: RelationshipWrite) => {
					try {
						await assertRelationshipWrite(tx, write)
					} catch (e) {
						if (e instanceof RelationshipRefusal)
							refuseApply(`${e.message} Nothing was changed.`)
						throw e
					}
				}
				const nameFor = (id: number) => nameOf.get(id) ?? `#${id}`

				/** Self-links a joined member made, by member — left out with a note. */
				const selfLinks = new Map<number, number>()

				// Insert (or update) relationships
				for (const rel of relationships) {
					const fromId = tempIdMap.get(rel.fromTempId)
					const toId = tempIdMap.get(rel.toTempId)
					// Unreachable: every tempId was checked above or inserted by
					// the loop just now. A reviewed, approved row is never skipped
					// in silence; inside the transaction this rolls back.
					if (fromId == null || toId == null)
						refuseApply(APPLY_FAILED)
					// A new character who joined a member now names both ends.
					if (fromId === toId) {
						selfLinks.set(fromId, (selfLinks.get(fromId) ?? 0) + 1)
						continue
					}
					const relationshipType = rel.relationshipType

					// In extend mode, when both ends were members before this
					// apply, the LLM may have updated a relationship that already
					// exists — find it and UPDATE rather than INSERT a duplicate.
					const bothStanding =
						mode === "extend" &&
						standing.has(fromId) &&
						standing.has(toId)

					if (bothStanding) {
						// Exact direction only — A→B and B→A are distinct
						// perspective entries and must never be collapsed into one
						// row. A new type between existing nodes that has no
						// exact-match row falls through to INSERT below.
						//
						// The versions the build's line reads (plan A3 and its
						// review): its own, and an ancestor's up to the fork's
						// cut — where the line holds its own telling of an
						// inherited version at the same date, that telling.
						const versions = nearestTieVersions(
							await rowsOnReading(
								tx,
								await tx.query.narrativeRelationships.findMany({
									where: and(
										eq(
											schema.narrativeRelationships
												.lorebookId,
											lorebookId
										),
										eq(
											schema.narrativeRelationships
												.fromNodeId,
											fromId
										),
										eq(
											schema.narrativeRelationships.toNodeId,
											toId
										),
										eq(
											schema.narrativeRelationships
												.relationshipType,
											relationshipType
										),
										onLineSql(
											schema.narrativeRelationships.branchId,
											line
										)
									),
									orderBy: desc(schema.narrativeRelationships.id)
								}),
								writeReading
							),
							line
						)

						/**
						 * WHICH version the proposal speaks about.
						 *
						 * A link can hold several dated versions. Never take
						 * whichever `findFirst` happens to return and rewrite it
						 * in place — that keeps its old date, so "Y5: they fell
						 * out" silently becomes the text of the Y2 version.
						 * Instead:
						 *
						 * - a proposal with a date updates only the version filed
						 *   at that same date, and otherwise INSERTS a new dated
						 *   row (falls through below) — an old version is never
						 *   rewritten;
						 * - a proposal with no date updates the newest version,
						 *   preferring one still active — deterministically.
						 */
						const proposedAt = await dateKeyOf(
							rel.historyEntryId ?? null,
							rel.sceneId ?? null
						)
						let existing: (typeof versions)[number] | undefined
						if (proposedAt === null) {
							existing =
								versions.find((v) => v.status === "active") ??
								versions[0]
						} else {
							for (const version of versions) {
								if (
									(await dateKeyOf(
										version.historyEntryId,
										version.sceneId
									)) === proposedAt
								) {
									existing = version
									break
								}
							}
						}

						if (existing) {
							/**
							 * ⚠ A CEILING on the proposal, never an assignment
							 * onto the row (plan §6).
							 *
							 * `undefined` means *leave the column alone*, which is
							 * what an author's `public` gets: `public` is never
							 * inferred, so a row holding it was widened by a
							 * person, and a re-scan must not quietly pull it back
							 * down. Writing `sanitize(...)` unconditionally — what
							 * this did — demoted exactly that edge on every build.
							 */
							let objectPresence = presenceOf(
								rel.sceneId ?? existing.sceneId,
								toId
							)
							// Re-stated from another scene than the one the tie
							// is filed at: there in either is there. When
							// neither settles it — absent from the re-stating
							// scene, the tie's own cast unknown — the tie keeps
							// the standing it has: a re-statement moves it
							// neither down (an `acknowledged` tie made secret)
							// nor up (a `secret` one made known).
							if (
								rel.sceneId != null &&
								existing.sceneId != null &&
								rel.sceneId !== existing.sceneId
							) {
								objectPresence = wider(
									objectPresence,
									await presenceAtFiledScene(
										existing.sceneId,
										toId
									)
								)
								if (objectPresence === "unknown")
									objectPresence =
										existing.visibility === "secret"
											? "absent"
											: "present"
							}
							const boundedVisibility =
								rel.pickedVisibility ??
								inferredRelationshipVisibility({
									claim:
										rel.visibility ?? existing.visibility,
									objectPresence,
									stored: existing.visibility
								})
							// What the proposal says, anything it leaves out
							// read from the version it speaks about.
							const said = {
								relationshipType,
								description: capText(
									rel.description ?? existing.description,
									RELATIONSHIP_TEXT_LIMITS.description
								),
								status: rel.status ?? existing.status,
								reason: rel.reason
									? capText(
											rel.reason,
											RELATIONSHIP_TEXT_LIMITS.reason
										)
									: existing.reason
							}
							if ((existing.branchId ?? null) === writeBranchId) {
								await guarded({
									op: "update",
									row: existing,
									ends: null,
									line: writeBranchId
								})
								await tx
									.update(schema.narrativeRelationships)
									.set({
										...said,
										...(boundedVisibility === undefined
											? {}
											: { visibility: boundedVisibility })
									})
									.where(
										eq(
											schema.narrativeRelationships.id,
											existing.id
										)
									)
							} else {
								// An ancestor's version: never rewritten from
								// here, where every other line would read the
								// change. The line gets its own telling of it,
								// at the same date and scene, which it then
								// reads in place of the inherited one
								// (`nearestTieVersions`).
								await guarded({
									op: "create",
									ends: {
										fromNodeId: fromId,
										fromEntryId: null,
										toNodeId: toId,
										toEntryId: null
									},
									where: `${nameFor(fromId)} → ${nameFor(toId)}`
								})
								await tx.insert(schema.narrativeRelationships).values({
									lorebookId,
									fromNodeId: fromId,
									toNodeId: toId,
									...said,
									title: existing.title,
									reverseRelationshipType:
										existing.reverseRelationshipType,
									visibility:
										boundedVisibility ?? existing.visibility,
									sceneId: existing.sceneId,
									historyEntryId: existing.historyEntryId,
									branchId: writeBranchId
								})
							}
							if (!rel.pickedVisibility)
								countBound(
									rel.visibility ?? existing.visibility,
									boundedVisibility
								)
							continue
						}
					}

					await guarded({
						op: "create",
						ends: {
							fromNodeId: fromId,
							fromEntryId: null,
							toNodeId: toId,
							toEntryId: null
						},
						where: `${nameFor(fromId)} → ${nameFor(toId)}`
					})
					const bornVisibility =
						rel.pickedVisibility ??
						inferredRelationshipVisibility({
							claim: rel.visibility,
							objectPresence: presenceOf(rel.sceneId, toId)
						})
					if (!rel.pickedVisibility)
						countBound(rel.visibility, bornVisibility)
					await tx.insert(schema.narrativeRelationships).values({
						lorebookId,
						fromNodeId: fromId,
						toNodeId: toId,
						relationshipType,
						description: capText(
							rel.description ?? "",
							RELATIONSHIP_TEXT_LIMITS.description
						),
						// Born bounded — unless the person chose it in review.
						// The column's `"acknowledged"` default is precisely the
						// over-scoping plan §6 names: an edge formed in a scene its
						// object was not in must not assert that they know about it.
						visibility: bornVisibility,
						status: rel.status ?? "active",
						reason: rel.reason
							? capText(rel.reason, RELATIONSHIP_TEXT_LIMITS.reason)
							: null,
						sceneId: rel.sceneId ?? null,
						historyEntryId: rel.historyEntryId ?? null,
						// On the build's line (plan A3).
						branchId: writeBranchId
					})
				}
				for (const [memberId, count] of selfLinks)
					applyNotes.push(
						`${relationshipsWere(count)} left out because both ${
							count === 1 ? "its" : "their"
						} ends are now ${nameFor(memberId)}.`
					)
				if (boundToSecret > 0)
					applyNotes.push(
						`${relationshipsWere(boundToSecret)} saved as secret, because the character ${
							boundToSecret === 1 ? "it is" : "each is"
						} about was not in the scene it came from.`
					)
				if (boundFromPublic > 0)
					applyNotes.push(
						`${relationshipsWere(boundFromPublic)} saved as acknowledged rather than public, because a build never makes a relationship public. Make ${
							boundFromPublic === 1 ? "it" : "them"
						} public on the graph if ${
							boundFromPublic === 1 ? "it" : "they"
						} should be.`
					)

				// Write derived cast back onto the scene rows. This is the ONLY
				// place a build's character resolution reaches the database, and
				// it happens after the user approved the proposal — cancel or
				// discard and nothing here runs, so the next build simply
				// re-derives.
				//
				// tempIds resolve through the same map the relationships used,
				// so a character discovered during this build lands as the real
				// id the INSERT loop above just created — or as the member they
				// joined.
				//
				// No extra lorebook filter here, deliberately. Every id in
				// tempIdMap is already proven in-lorebook: `existing_` ids were
				// validated against this lorebook before the transaction opened,
				// and `new_` ids were just INSERTed into it (or joined one of its
				// members). Note also that scenes.ts's
				// filterCharacterIdsToLorebook is NOT the right tool — it scopes
				// by `characterId`, i.e. it treats these arrays as character ids,
				// while everything post-merge (graphBuilder,
				// the apply's own name resolution) stores lorebookBindings ids.
				for (const resolved of resolvedSceneCast) {
					const participantCharacters = [
						...new Set(
							resolved.participantTempIds
								.map((t) => tempIdMap.get(t))
								.filter((id): id is number => id != null)
						)
					]
					// ⚠ `resolved.mentionedTempIds` is deliberately NOT resolved
					// or written. `mentioned` is derived from annotations now
					// (plan §1) and storing a second, weaker copy is what this
					// lane removed; the proposal still carries the field so
					// reviving the stored form is a one-line change rather than a
					// re-derivation. castResolvedAt is set even when the list is
					// empty — that is the marker's entire purpose. A scene that
					// genuinely features nobody must be distinguishable from one
					// never processed, or it re-extracts on every build forever.
					if (resolved.sceneId == null) continue
					// Participants only — `writeSceneCast` rewrites exactly the
					// roles it is handed, so any pre-icing `mentioned` rows are
					// left where they are rather than being clobbered by a build
					// that no longer has an opinion about them. The scene is this
					// book's (checked above) and still there.
					await writeSceneCast(
						resolved.sceneId,
						{ participantCharacters },
						tx,
						{ by: { userId }, cause: "save" }
					)
					await tx
						.update(schema.scenes)
						.set({ castResolvedAt: new Date() })
						.where(
							and(
								eq(schema.scenes.id, resolved.sceneId),
								eq(schema.scenes.lorebookId, lorebookId)
							)
						)
					// Direct history entries have no scene row to write to; their
					// cast is re-derived each build. Filed with the entry
					// resolved-marker follow-up.
				}

				// Mark what the build READ as graphed — entirely server-side,
				// from its own activity. Replace resets the whole book first,
				// since a rebuild re-reads it all; either mode then stamps
				// exactly the scenes and direct history entries the build fed
				// the builder, so a scene summarized while the build was running
				// stays ungraphed and the next Extend reads it.
				if (mode === "replace") {
					await tx
						.update(schema.scenes)
						.set({ graphed: false })
						.where(eq(schema.scenes.lorebookId, lorebookId))
					// Reset history entries graphed status too.
					// ⚠ Merged into `fields`, never written over it — the
					// summarizer's `isCompleted` lives in the same object and a
					// whole-object write from here would erase it.
					await tx
						.update(schema.lorebookEntries)
						.set({ fields: mergeFields({ graphed: false }) })
						.where(inBookOfType(lorebookId, HISTORY_TYPE_ID))
				}
				const readSceneIds = build.processedSceneIds ?? []
				const readHistoryEntryIds = build.processedHistoryEntryIds ?? []
				if (readSceneIds.length > 0)
					await tx
						.update(schema.scenes)
						.set({ graphed: true })
						.where(
							and(
								eq(schema.scenes.lorebookId, lorebookId),
								inArray(schema.scenes.id, readSceneIds),
								isNotNull(schema.scenes.summary)
							)
						)
				// ⚠ Merged, for the same reason as the reset above. Direct
				// on the build's line — the rule the build read them by.
				if (readHistoryEntryIds.length > 0)
					await tx
						.update(schema.lorebookEntries)
						.set({ fields: mergeFields({ graphed: true }) })
						.where(
							and(
								directEntryOf(lorebookId, writeBranchId, tx),
								inArray(
									schema.lorebookEntries.id,
									readHistoryEntryIds
								)
							)
						)
			})
			// Committed: the build is used. Taken away here — while the hold
			// still stands, so no second apply slips between the commit and
			// this — and its notification cleared as acted on.
			activityStore.remove(activityId, "acted")
		} finally {
			if (holding) buildsBeingApplied.delete(activityId)
		}

		// ⚠ Committed: from here on the graph IS written and the build used,
		// so nothing below may answer "Nothing was changed" (plan A21 review —
		// a failed list refresh was reported as the apply failing).

		// The two reads this handler's OWN reply is made of. They stay eager:
		// the caller asked for the applied graph and is waiting on it.
		let res: Sockets.NarrativeGraph.ApplyProposal.Response
		let nodes: (typeof schema.lorebookBindings.$inferSelect)[]
		let wiredRelationships: Awaited<ReturnType<typeof wireRelationships>>
		try {
			const [bindingRows, relationshipRows] = await Promise.all([
				db.query.lorebookBindings.findMany({
					where: eq(schema.lorebookBindings.lorebookId, lorebookId),
					orderBy: asc(schema.lorebookBindings.id)
				}),
				db.query.narrativeRelationships.findMany({
					where: and(
						eq(
							schema.narrativeRelationships.lorebookId,
							lorebookId
						),
						isNull(schema.narrativeRelationships.knowledgeKind)
					),
					orderBy: asc(schema.narrativeRelationships.id)
				})
			])
			nodes = await withStoryStates(db, bindingRows)
			wiredRelationships = await wireRelationships(relationshipRows)
			res = {
				lorebookId,
				...(requestId !== undefined ? { requestId } : {}),
				nodes,
				relationships: wiredRelationships,
				applyNotes: [...new Set(applyNotes)]
			}
		} catch (e) {
			throw new ApplyRefusal(APPLIED_NOT_SHOWN, { cause: e })
		}

		// The COUNT reads the refreshed graph list is made of, and nothing
		// else — LAZY (socket-interest plan, ruling 4). A proposal applied from
		// a surface with no graph list open pays for none of them; the reply
		// above is unaffected either way. Skipping the emit alone would save
		// nothing; these scans are the cost. The cast count is re-derived
		// rather than carried over: the apply just wrote castResolvedAt onto
		// every scene it resolved, so it should normally have dropped to 0.
		// A refresh that fails is logged, never the apply's answer.
		try {
			await emitToUser("narrativeGraph:list", () =>
				buildGraphList(lorebookId, {
					nodes,
					relationships: wiredRelationships
				})
			)
		} catch (e) {
			console.error(
				"[narrativeGraph:applyProposal] graph list refresh",
				e
			)
		}
		emitToUser("narrativeGraph:applyProposal", res)

		// Proactive duplicate review — surface likely-duplicate pairs right
		// after a build/extend completes, not just on the next time someone
		// happens to open the Bindings tab. LAZY: see
		// `buildDuplicateCandidates`.
		try {
			await emitToUser("narrativeGraph:duplicateCandidates", () =>
				buildDuplicateCandidates(lorebookId)
			)
		} catch (e) {
			console.error("[narrativeGraph:applyProposal] duplicate review", e)
		}

		return res
	},
	APPLY_FAILED,
	(e) => (e instanceof ApplyRefusal ? undefined : APPLY_FAILED),
	(params) => {
		const p = isRecord(params) ? params : {}
		return {
			...(Number.isSafeInteger(p.lorebookId)
				? { lorebookId: p.lorebookId }
				: {}),
			...(isText(p.requestId) ? { requestId: p.requestId } : {})
		}
	}
)
