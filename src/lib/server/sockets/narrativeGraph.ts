import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type {
	NodeState,
	RelationshipVisibility
} from "$lib/server/db/schema"
import {
	eq,
	asc,
	desc,
	and,
	or,
	isNotNull,
	isNull,
	gt,
	notExists,
	ne,
	sql,
	inArray,
	type SQL
} from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import {
	CHARACTER_LORE_TYPE_ID,
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	fieldIsTrue,
	historyDateOf,
	inBookOfType,
	mergeFields,
	sweepLoreEntryRankings,
	withEverythingFiledUnder
} from "$lib/server/utils/lorebookEntries"
import type { EntryTypeId } from "$lib/shared/entries/types"
import { castEdgeOnly, isCastEdge } from "$lib/server/utils/narrativeEdges"
import {
	buildGraphFromScenes,
	GraphParseError,
	worldLoreScreen,
	type GraphBuilderWorldLoreEntry,
	type GraphBuilderScene,
	type GraphBuilderSeedNode,
	type GraphBuilderSeedRelationship,
	type GraphBuilderResumeState
} from "$lib/server/utils/graphBuilder"
import {
	resolveCapabilityTarget,
	TEXT_CAPABILITY
} from "$lib/server/connections/capabilityTarget"
import {
	activityError,
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
	findDuplicateCandidates,
	orderedBindingPair
} from "$lib/server/utils/duplicateBindingDetection"
import {
	castFor,
	readSceneCasts,
	repointSceneCast,
	writeSceneCast
} from "$lib/server/utils/sceneCast"
import {
	deriveSceneMentions,
	mentionedSoFar,
	type SceneMentions
} from "$lib/server/utils/sceneMentions"
import {
	inferredRelationshipVisibility,
	sanitizeRelationshipVisibility,
	VALID_RELATIONSHIP_VISIBILITIES,
	type ObjectPresence
} from "$lib/server/utils/relationshipVisibility"
import {
	assertRelationshipWrite,
	foldRelationshipsUndatedBy,
	hasEntryEnd,
	LINKED_THAT_WAY,
	RelationshipRefusal,
	type RelationshipSaying,
	type RelationshipWrite
} from "$lib/server/utils/relationshipGuards"
import {
	RELATIONSHIP_STATUSES,
	RELATIONSHIP_TEXT_LIMITS,
	RELATIONSHIP_VISIBILITIES
} from "$lib/shared/lorebooks/linkVocabulary"
import { refusable } from "$lib/server/sockets/refusable"
import {
	isOnLine,
	MAIN_LINE,
	rowReadsOnLine,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import { nearestTieVersions } from "$lib/shared/lorebooks/tieVersions"
import {
	buildReadsScene,
	type GraphBuildScope
} from "$lib/shared/lorebooks/graphBuildScope"
import {
	BranchRefusal,
	historyEntryDate,
	lineOfBook,
	rowsOnReading,
	type LineReading
} from "$lib/server/state/reading"
import { onLineSql } from "$lib/server/state/lineSql"
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
import { relistEntries } from "$lib/server/sockets/entries"
import { autoEnqueueLorebook } from "$lib/server/embedding/vectorizationQueue"
import { enqueueLorebookAnnotation } from "$lib/server/annotations/queue"
import { bookLoreWriteMode } from "$lib/server/state/loreWriteMode"
import { LORE_WRITES_OFF } from "$lib/shared/lorebooks/loreWriteMode"
import { assertOwnedBook, findOwnedBook } from "$lib/server/utils/ownedBook"

// Resume states saved before each scene — keyed by "userId:lorebookId"
const buildResumeStates = new Map<string, GraphBuilderResumeState>()
/**
 * What a build read — its line, and the session an Extend from a session was
 * scoped to — by the same key as its checkpoint. A resume's scene index counts
 * into the list the build FIRST read, so a resume must re-read that same list:
 * a scoped build resumed unscoped would skip into another session's scenes,
 * and one resumed on another line into that line's.
 */
const buildResumeScopes = new Map<string, GraphBuildScope>()

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
 * The likely-duplicate pairs in one book.
 *
 * Split out so the three write cascades that re-send them — after an applied
 * proposal, after a merge, after an undo — can hand this to `emitToUser` as a
 * thunk (socket-interest plan, ruling 4): ONE source of truth for the payload,
 * and the pairwise scan behind it is paid only when some socket declared the
 * key. A merge made from a surface that shows no duplicate review pays for no
 * re-scan. Skipping the emit alone would save nothing; the scan is the cost.
 */
async function buildDuplicateCandidates(
	lorebookId: number
): Promise<Sockets.NarrativeGraph.DuplicateCandidates.Response> {
	return {
		lorebookId,
		candidates: await findDuplicateCandidates(lorebookId)
	}
}

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
 * What an entry endpoint needs to be drawn as a node.
 *
 * One query for every entry both ends of every row name, rather than one per
 * endpoint: a graph of a hundred roads would otherwise be two hundred reads.
 */
async function entryEndpointIndex(
	rows: readonly {
		fromEntryId: number | null
		toEntryId: number | null
	}[]
): Promise<Map<number, { name: string; typeId: EntryTypeId }>> {
	const ids = [
		...new Set(
			rows.flatMap((r) =>
				[r.fromEntryId, r.toEntryId].filter(
					(id): id is number => id != null
				)
			)
		)
	]
	const index = new Map<number, { name: string; typeId: EntryTypeId }>()
	if (ids.length === 0) return index
	const entries = await db
		.select({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title,
			typeId: schema.lorebookEntries.typeId
		})
		.from(schema.lorebookEntries)
		.where(inArray(schema.lorebookEntries.id, ids))
	for (const entry of entries)
		index.set(entry.id, {
			name: entry.title ?? "",
			typeId: entry.typeId as EntryTypeId
		})
	return index
}

/**
 * A stored row as the wire carries it.
 *
 * `from`/`to` are the endpoints of record; `fromNodeId`/`toNodeId` ride along
 * unchanged for the readers written before an endpoint could be an entry — see
 * the note on the wire type. An entry endpoint whose row has since been deleted
 * cannot occur (the FK cascades), so an id missing from the index would be a
 * read racing a delete: it is drawn nameless rather than dropped, because an
 * edge that vanishes from a graph without a reason is the worse failure.
 */
function wireRelationship(
	row: SelectNarrativeRelationship,
	entries: Map<number, { name: string; typeId: EntryTypeId }>
): Sockets.NarrativeGraph.NarrativeRelationship {
	const endpoint = (
		nodeId: number | null,
		entryId: number | null
	): Sockets.NarrativeGraph.WireRelationshipEndpoint => {
		if (entryId != null) {
			const entry = entries.get(entryId)
			return {
				kind: "entry",
				entryId,
				name: entry?.name ?? "",
				typeId: entry?.typeId ?? WORLD_LORE_TYPE_ID
			}
		}
		return { kind: "cast", bindingId: nodeId! }
	}
	// The name rides as `name`, as an entry's `title` column does; the
	// column's own spelling stays off the wire.
	const { title, ...columns } = row
	return {
		...columns,
		name: title,
		from: endpoint(row.fromNodeId, row.fromEntryId),
		to: endpoint(row.toNodeId, row.toEntryId)
	}
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

/** What a stored or about-to-be-stored row says, for the guard. */
const sayingOf = (row: {
	lorebookId: number
	branchId: number | null
	historyEntryId: number | null
	title: string
	relationshipType: string
	reverseRelationshipType: string | null
}): RelationshipSaying => ({
	lorebookId: row.lorebookId,
	branchId: row.branchId,
	historyEntryId: row.historyEntryId,
	title: row.title,
	relationshipType: row.relationshipType,
	reverseRelationshipType: row.reverseRelationshipType
})

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

/** Every row of a list, with its endpoints resolved in one query. */
async function wireRelationships(
	rows: readonly SelectNarrativeRelationship[]
): Promise<Sockets.NarrativeGraph.NarrativeRelationship[]> {
	const entries = await entryEndpointIndex(rows)
	return rows.map((row) => wireRelationship(row, entries))
}

// ─── List ─────────────────────────────────────────────────────────────────────

/**
 * What a Rebuild (replace) would delete, counted: the cast ties, on every
 * line, and nothing else — a rebuild never deletes a relationship with an
 * entry at either end (owner ruling 2026-09-29, Q1). Counted off the rows the
 * list already carries, so it costs no query.
 *
 * ⚠ There is no count of ties "drawn by hand": nothing records where a link
 * came from. A hand-drawn tie and a built one look the same, `historyEntryId`
 * included, and guessing would make a warning that is sometimes wrong.
 */
function relationshipCountsOf(
	rows: readonly {
		fromNodeId: number | null
		toNodeId: number | null
	}[]
): Sockets.NarrativeGraph.RelationshipCounts {
	return { castToCast: rows.filter(isCastEdge).length }
}

/**
 * A **direct** history entry of a line, as a graph build on that line reads
 * one (plan A3 and its review): written on the line, with text, and with no
 * scene captured on that same line. A build reads its own line's writing only
 * (`graphBuildScope.ts`): an ancestor's entries are the ancestor's build's,
 * and reach the branch as ties through the line. A scene played on another
 * line is that line's, so an entry whose scenes were all played elsewhere is
 * read here by its own text.
 *
 * `branchId` null is main; `"every"` takes every line's at once, for counts
 * grouped by line. `handle` is the caller's — its transaction when it has one.
 */
function directEntryOf(
	lorebookId: number,
	branchId: number | null | "every",
	handle: Db = db
): SQL {
	const entries = schema.lorebookEntries
	return and(
		inBookOfType(lorebookId, HISTORY_TYPE_ID),
		branchId === "every"
			? undefined
			: branchId === null
				? isNull(entries.branchId)
				: eq(entries.branchId, branchId),
		gt(sql`length(trim(${entries.content}))`, 0),
		notExists(
			handle
				.select({ _: sql`1` })
				.from(schema.scenes)
				.where(
					and(
						eq(schema.scenes.historyEntryId, entries.id),
						sql`${schema.scenes.branchId} is not distinct from ${entries.branchId}`
					)
				)
		)
	)!
}

/** What a build of one line would read, counted (`Sockets.NarrativeGraph.GraphBuildCounts`). */
function emptyBuildCounts(): Sockets.NarrativeGraph.GraphBuildCounts {
	return {
		ungraphedSceneCount: 0,
		unresolvedCastSceneCount: 0,
		ungraphedUnsummarizedCount: 0,
		totalSummarizedCount: 0,
		ungraphedHistoryEntryCount: 0,
		totalDirectHistoryEntryCount: 0
	}
}

/**
 * The graph list for one book — the handler's reply and the apply cascade's.
 *
 * ONE builder, so the two cannot drift: the cascade never spells the six
 * counting scans out a second time. `known` is the nodes and wired links a
 * caller has already read, so the cascade does not read them twice.
 *
 * The links are every line's (a view keeps its line's). The build counts are
 * per line, of each line's OWN scenes and direct history entries — what a
 * build of that line reads (plan A3 and its review): main's at the top level
 * (Rebuild, and Extend graph on main), each branch's in `branchCounts`
 * (Extend graph on that branch). Extend from a session counts that session's
 * scenes on the client, by the build's own rule (`extendCountsOf`).
 *
 * ⚠ Read-only: never write inside this read. In particular it must not stamp
 * scenes as `graphed` — on a book with a cast and no graph that marks EVERY
 * summarized scene graphed, and Extend then has nothing to read.
 */
async function buildGraphList(
	lorebookId: number,
	known?: {
		nodes: SelectLorebookBinding[]
		relationships: Sockets.NarrativeGraph.NarrativeRelationship[]
	}
): Promise<Sockets.NarrativeGraph.List.Response> {
	const [nodes, relationships, sceneRows, directRows] = await Promise.all([
		known
			? known.nodes
			: db.query.lorebookBindings.findMany({
					where: eq(schema.lorebookBindings.lorebookId, lorebookId),
					orderBy: asc(schema.lorebookBindings.id)
				}),
		known
			? known.relationships
			: db.query.narrativeRelationships
					.findMany({
						where: eq(
							schema.narrativeRelationships.lorebookId,
							lorebookId
						),
						orderBy: asc(schema.narrativeRelationships.id)
					})
					.then(wireRelationships),
		// Every scene's line and flags, counted per line below.
		db
			.select({
				branchId: schema.scenes.branchId,
				graphed: schema.scenes.graphed,
				summarized: sql<boolean>`${schema.scenes.summary} is not null`,
				castResolved: sql<boolean>`${schema.scenes.castResolvedAt} is not null`
			})
			.from(schema.scenes)
			.where(eq(schema.scenes.lorebookId, lorebookId)),
		// Every line's direct history entries, and whether each is graphed.
		db
			.select({
				branchId: schema.lorebookEntries.branchId,
				graphed: sql<boolean>`${fieldIsTrue("graphed")}`
			})
			.from(schema.lorebookEntries)
			.where(directEntryOf(lorebookId, "every"))
	])

	const byLine = new Map<number | null, Sockets.NarrativeGraph.GraphBuildCounts>()
	const countsOf = (branchId: number | null) => {
		let counts = byLine.get(branchId)
		if (!counts) byLine.set(branchId, (counts = emptyBuildCounts()))
		return counts
	}
	for (const scene of sceneRows) {
		const counts = countsOf(scene.branchId ?? null)
		if (scene.summarized) {
			counts.totalSummarizedCount++
			if (!scene.graphed) counts.ungraphedSceneCount++
			// Each costs one extraction call on the next build. A plain
			// marker check, not a scan of the cast columns' shapes.
			if (!scene.castResolved) counts.unresolvedCastSceneCount++
		} else if (!scene.graphed) counts.ungraphedUnsummarizedCount++
	}
	for (const entry of directRows) {
		const counts = countsOf(entry.branchId ?? null)
		counts.totalDirectHistoryEntryCount++
		if (!entry.graphed) counts.ungraphedHistoryEntryCount++
	}
	const main = byLine.get(null) ?? emptyBuildCounts()

	return {
		// The scope the gate reads. See the Response type.
		lorebookId,
		nodes,
		// Entries are on the graph too: an entry with an edge is a node, and
		// the endpoint carries what it takes to draw one.
		relationships,
		relationshipCounts: relationshipCountsOf(relationships),
		...main,
		namelessBindingCount: nodes.filter(
			(n) => !n.name.trim() && n.parentNodeId === null
		).length,
		branchCounts: [...byLine]
			.filter((pair): pair is [number, Sockets.NarrativeGraph.GraphBuildCounts] => pair[0] !== null)
			.map(([branchId, counts]) => ({ branchId, ...counts }))
			.sort((a, b) => a.branchId - b.branchId)
	}
}

export const narrativeGraphListHandler: Handler<
	Sockets.NarrativeGraph.List.Params,
	Sockets.NarrativeGraph.List.Response
> = refusable(
	"narrativeGraph:list",
	async (socket, params: Sockets.NarrativeGraph.List.Params, emitToUser) => {
		const userId = socket.user!.id

		await assertOwnedBook(db, userId, params.lorebookId)

		const res = await buildGraphList(params.lorebookId)
		emitToUser("narrativeGraph:list", res)
		return res
	},
	"The graph could not be read."
)

// ─── Build (LLM extraction) ───────────────────────────────────────────────────

/**
 * The book's world lore, places and items, as the world-lore screen reads
 * them (`worldLoreScreen`) — what a build screens the names it would add
 * against, and what an apply screens the review's new names against again.
 */
async function worldLoreOf(
	lorebookId: number,
	handle: Db
): Promise<GraphBuilderWorldLoreEntry[]> {
	return (
		await handle
			.select({
				name: schema.lorebookEntries.title,
				fields: schema.lorebookEntries.fields,
				typeId: schema.lorebookEntries.typeId
			})
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebookId),
					inArray(schema.lorebookEntries.typeId, [
						WORLD_LORE_TYPE_ID,
						LOCATION_TYPE_ID,
						ITEM_TYPE_ID
					])
				)
			)
	).map((e) => ({
		// `title` is nullable on the one table and `name` was NOT NULL on
		// the three; a row of these types cannot reach here without one,
		// since the socket namespace trims and requires it.
		name: e.name ?? "",
		category: (e.fields?.category as string | null) ?? null,
		// A place or an item screens by its whole title, whatever its
		// category (`GraphBuilderWorldLoreEntry`).
		typeId: e.typeId
	}))
}

/**
 * Build a lorebook's graph from its scenes and history, as a proposal for
 * review.
 *
 * Refused before the build begins, in the handler's own sentence and to the
 * tab that asked, echoing the book (`buildGraph`'s first lines). Once the
 * build's activity exists, every failure is that activity's
 * `status: "error"` — what GraphBuildModal and the Activity panel read — and
 * never a refusal as well: nothing is left building, and nothing is said
 * twice.
 */
export const narrativeGraphBuildHandler: Handler<
	Sockets.NarrativeGraph.Build.Params,
	Sockets.NarrativeGraph.Build.Response
> = refusable(
	"narrativeGraph:build",
	async (socket, params: Sockets.NarrativeGraph.Build.Params, emitToUser) => {
		const started: { activityId?: string } = {}
		try {
			return await buildGraph(socket, params, emitToUser, started)
		} catch (err) {
			if (started.activityId === undefined) throw err
			console.error("narrativeGraph:build failed after it began:", err)
			// `activityError` rather than `err.message`: the record is served
			// back to a non-admin, and a service's words can name its address.
			activityStore.update(started.activityId, {
				status: "error",
				...activityError(err)
			})
			return {
				proposal: { nodes: [], relationships: [] },
				sceneLabels: [],
				seedTempIdMap: {}
			}
		}
	},
	"The graph could not be built.",
	undefined,
	(params) => ({
		lorebookId: (params as { lorebookId?: unknown } | null)?.lorebookId
	})
)

/**
 * The build itself. `started.activityId` is set the moment the build's
 * activity exists, which is where a throw stops being a refusal.
 */
async function buildGraph(
	socket: any,
	params: Sockets.NarrativeGraph.Build.Params,
	emitToUser: (event: string, data: any) => void,
	started: { activityId?: string }
): Promise<Sockets.NarrativeGraph.Build.Response> {
	const userId = socket.user!.id

	// Refused before the build begins — a book that is not the caller's, a
	// step with nothing set to run it: the refusal is `refusable`'s, in
	// the handler's own sentence, echoing the book. GraphBuildModal flips
	// to "building" before the server has accepted anything and un-sticks
	// on it; Layout toasts the sentence. No activity exists yet, so none
	// is left building. After `activityStore.start`, a failure is the
	// activity's `status: "error"` instead (`narrativeGraphBuildHandler`).
	const lorebook = await assertOwnedBook(db, userId, params.lorebookId)

	// A graph build turns what sessions played into the book: the owner's
	// lore write mode Off refuses it before any work (plan A22).
	if ((await bookLoreWriteMode(db, params.lorebookId)) === "off")
		throw new Error(LORE_WRITES_OFF)

	const mode = params.mode ?? "replace"
	// A Rebuild wipes the cast ties of every line and re-creates them from
	// main (owner question: a branch Rebuild is not ruled), so it is never
	// run on a branch in the person's name.
	if (mode !== "extend" && params.branchId != null)
		throw new Error(
			"Rebuild reads and writes main only. Open main to rebuild the graph."
		)
	const resumeKey = `${userId}:${params.lorebookId}`
	const resumeState: GraphBuilderResumeState | undefined = params.resume
		? buildResumeStates.get(resumeKey)
		: undefined
	const resumedScope: GraphBuildScope | undefined =
		params.resume && mode === "extend"
			? buildResumeScopes.get(resumeKey)
			: undefined
	// Extend from one session reads that session alone. Replace
	// re-reads main by definition, so it takes no scope.
	const scopeSessionId: number | null =
		mode !== "extend"
			? null
			: resumedScope
				? resumedScope.sessionId
				: (params.sessionId ?? null)

	/*
	 * Graph extraction is a structured-output task and should not inherit
	 * session's decoding parameters — at session temperature a roleplay-finetuned
	 * model answered 45% of perspective calls with narrative prose rather
	 * than JSON, and re-prompting recovered 1 of 13. Each step therefore
	 * carries its own connection, sampling and prompt.
	 */
	// Every step resolves through the **pipeline config layer** — the same
	// world, the same five-layer chain, the same rows the pipeline panel
	// edits — so a connection, sampling profile or prompt chosen for a graph
	// step in the panel is what the next build runs on. 0.5's
	// `graph_build_configs` prose seeded the pipeline's shipped prompts.
	const { resolveGraphStepConfigs } = await import(
		"$lib/server/pipelines/config/graphSteps"
	)
	const pipelineSteps = await resolveGraphStepConfigs(db)

	// A step whose connection or sampling was never chosen runs on the
	// instance default — dispatchStep's rule, and what a person expects the
	// first time they press Build.
	//
	// This IS a real tier here, not a fourth one: graph node keys are
	// `building.item.*`, which `buildWorld`'s defaults layer (keyed to the
	// spec's single provider node) does not reach, so an unconfigured graph
	// step genuinely arrives with nothing set. What changed is only where
	// the value comes from — `connection_defaults` keyed by capability,
	// rather than the two `system_settings` columns this read before (0181).
	//
	// Resolved once for the whole build rather than per step: five steps
	// asking the same question five times is five chances for them to
	// disagree, and the answer cannot change mid-build.
	const pubDefault = await resolveCapabilityTarget(db, {
		capability: TEXT_CAPABILITY
	})
	const defaultConnection = pubDefault.ok
		? pubDefault.connection
		: undefined
	const defaultSampling = pubDefault.ok
		? (pubDefault.sampling ?? undefined)
		: undefined

	const graphSteps = Object.fromEntries(
		Object.entries(pipelineSteps).map(([step, cfg]) => [
			step,
			{
				systemPrompt: cfg.systemPrompt,
				connection: cfg.connection ?? defaultConnection,
				sampling: cfg.sampling ?? defaultSampling
			}
		])
	) as Record<
		string,
		{
			systemPrompt?: string
			connection?: any
			// The sampling ROW, not a resolved parameter set (0171):
			// buildGraphFromScenes labels each queued call with the config's
			// name and resolves the values itself where it builds an
			// adapter. Typed rather than `any` so handing it the wrong one
			// of the two is a compile error here.
			sampling?: SelectSamplingConfig
		}
	>

	// The perspective step still supplies the build-wide fallback, since it
	// is the pass that dominates a build and the one whose failure modes the
	// extraction profile was measured against.
	//
	// The `?? connection` / `?? sampling` that used to close these two came
	// from `getUserConfigurations`, which was a second reading of the same
	// instance default the step already fell back to two dozen lines up — a
	// fourth tier that could only ever agree with the third, until the day
	// one of them was repointed.
	const graphConnection = graphSteps.perspective.connection
	const graphSampling = graphSteps.perspective.sampling

	if (!graphConnection) {
		// The resolver's sentence names which way it failed and which screen
		// fixes it. Reachable only when the perspective step chose nothing
		// AND no `text->text` default is registered, which under the
		// no-implicit-pickup ruling is a real state a fresh install is in.
		throw new Error(
			(!pubDefault.ok && pubDefault.problem.message) ||
				"No AI connection configured. Please set up a connection first."
		)
	}
	// ⚠ Same asymmetry as `scenes.ts`: a missing sampling config is not fatal
	// to the chain (`resolveSampling(null)` is "use the backend's own
	// defaults") but IS fatal to `buildGraphFromScenes`, which takes a row
	// and reads `sampling.name` off it to label each queued call. Refused
	// here, where the sentence can name a screen, rather than reaching the
	// builder as a null.
	if (!graphSampling) {
		throw new Error(
			"No sampling config is set for chat, and building the graph needs one. " +
				"Choose one in Admin → Defaults."
		)
	}

	/**
	 * The line this build reads and its apply writes (plan A3 and its
	 * review): Extend from a session, the session's line; Extend graph, the
	 * line the Graph lens is reading; Rebuild, main. The build reads that
	 * line's OWN scenes and direct history entries (`graphBuildScope.ts`) —
	 * an ancestor's are the ancestor's build's, and reach the line as ties —
	 * and seeds from every tie the line reads, its ancestors' up to each fork.
	 */
	let buildBranchId: number | null = null
	if (resumedScope) buildBranchId = resumedScope.branchId
	else if (scopeSessionId !== null) {
		const session = await db.query.sessions.findFirst({
			where: eq(schema.sessions.id, scopeSessionId),
			columns: { lorebookId: true, lorebookBranchId: true }
		})
		if (!session || session.lorebookId !== params.lorebookId)
			throw new Error(
				"That session does not read this lorebook, so the graph cannot be extended from it."
			)
		buildBranchId = session.lorebookBranchId ?? null
	} else if (mode === "extend") buildBranchId = params.branchId ?? null
	let line: Line
	try {
		line = await lineOfBook(db, params.lorebookId, buildBranchId)
	} catch (e) {
		if (!(e instanceof BranchRefusal)) throw e
		// A session whose branch is no longer the book's reads main, as its
		// own turns do (`sessionReadingOf`). A line the person named, or the
		// one a resumed build read, has nothing left to read.
		if (scopeSessionId === null || resumedScope)
			throw new Error(
				"That is not a line of this lorebook, so the graph cannot be extended on it."
			)
		buildBranchId = null
		line = MAIN_LINE
	}
	const scope: GraphBuildScope = {
		branchId: buildBranchId,
		sessionId: scopeSessionId
	}

	buildResumeScopes.set(resumeKey, scope)
	const activityId = activityStore.start({
		userId,
		lorebookId: params.lorebookId,
		lorebookLabel: lorebook.name,
		mode,
		branchId: buildBranchId
	})
	started.activityId = activityId
	const abortController = new AbortController()
	activityStore.setAbortController(activityId, abortController)

	// The line's own scenes and direct history entries (plan A3 review).
	// Neither is cut by a date: a line is never cut off from its own rows.
	const [rawScenes, rawDirectEntries] = await Promise.all([
		db.query.scenes.findMany({
			where: and(
				eq(schema.scenes.lorebookId, params.lorebookId),
				buildBranchId === null
					? isNull(schema.scenes.branchId)
					: eq(schema.scenes.branchId, buildBranchId)
			),
			orderBy: asc(schema.scenes.id),
			with: {
				// The date is a declared field now, so the row carries
				// `fields` and `historyDateOf` reads it out.
				historyEntry: {
					columns: { id: true, fields: true }
				}
			}
		}),
		// History entries with content and no scene of the line's own
		db
			.select({
				id: schema.lorebookEntries.id,
				fields: schema.lorebookEntries.fields,
				content: schema.lorebookEntries.content
			})
			.from(schema.lorebookEntries)
			.where(directEntryOf(params.lorebookId, buildBranchId))
	])

	// Fetch bindings with left joins (explicit joins have reliable TS inference).
	// A deleted card is nobody in a lorebook (plan A25): its member is named by
	// their own name, as a member without a card is.
	const bindings = await db
		.select({
			binding: schema.lorebookBindings.binding,
			memberName: schema.lorebookBindings.name,
			characterName: schema.characters.name,
			characterNickname: schema.characters.nickname
		})
		.from(schema.lorebookBindings)
		.leftJoin(
			schema.characters,
			and(
				eq(schema.lorebookBindings.characterId, schema.characters.id),
				eq(schema.characters.isDeleted, false)
			)
		)
		.where(eq(schema.lorebookBindings.lorebookId, params.lorebookId))

	// Build substitution map: binding token → display name
	const bindingMap: Record<string, string> = {}
	for (const b of bindings) {
		if (!b.binding) continue
		const label = b.characterName
			? b.characterNickname || b.characterName
			: b.memberName?.trim() || b.binding
		bindingMap[b.binding] = label
	}

	function resolveBindings(text: string): string {
		let out = text
		for (const [token, name] of Object.entries(bindingMap)) {
			out = out.replaceAll(token, name)
		}
		return out
	}

	// In extend mode, only process scenes not yet graphed — and, when the
	// extend was started from a session, only that session's.
	const filteredRawScenes =
		mode === "extend"
			? rawScenes.filter((s) => !s.graphed && buildReadsScene(s, scope))
			: rawScenes

	// In extend mode, only process direct entries not yet graphed. A
	// direct entry has no scene and so no session: a session-scoped
	// extend reads none of them.
	const filteredDirectEntries =
		mode === "extend"
			? scopeSessionId !== null
				? []
				: rawDirectEntries.filter((e) => !e.fields?.graphed)
			: rawDirectEntries

	if (
		mode === "extend" &&
		filteredRawScenes.length === 0 &&
		filteredDirectEntries.length === 0
	) {
		// A session's scenes played on another line are that line's build's
		// to read (`graphBuildScope.ts`): said, rather than "all graphed".
		const elsewhere =
			scopeSessionId === null
				? 0
				: (
						await db
							.select({ n: sql<number>`count(*)`.mapWith(Number) })
							.from(schema.scenes)
							.where(
								and(
									eq(schema.scenes.lorebookId, params.lorebookId),
									eq(schema.scenes.sessionId, scopeSessionId),
									eq(schema.scenes.graphed, false),
									isNotNull(schema.scenes.summary),
									buildBranchId === null
										? isNotNull(schema.scenes.branchId)
										: or(
												isNull(schema.scenes.branchId),
												ne(schema.scenes.branchId, buildBranchId)
											)
								)
							)
					)[0].n
		activityStore.update(activityId, {
			status: "error",
			errorMessage:
				elsewhere > 0
					? `No new content to process on this session's line. ${elsewhere} of this session's scenes ${elsewhere === 1 ? "was" : "were"} played on another line: read that line in the lorebook's Graph lens and use Extend graph there.`
					: scopeSessionId !== null
						? "No new content to process. Every summarized scene in this session has already been graphed."
						: "No new content to process. All scenes and history entries have already been graphed."
		})
		return {
			proposal: { nodes: [], relationships: [] },
			sceneLabels: [],
			seedTempIdMap: {}
		}
	}

	// Direct history entries used to get their own extraction+resolution
	// pass right here, because graphBuilder's Phase 1 was a plain id lookup
	// that would otherwise extract nobody from a scene-less lorebook. That
	// block is gone: Phase 1 now applies one uniform rule (ids → lookup,
	// names → resolve, nothing → extract) to scenes and entries alike, so
	// entries just flow through the mapping below with no cast of their own
	// and get extracted from their content like any other castless item.
	//
	// Deleting it also removes the last DB write in the build path. It
	// called a name resolver (since deleted) that *created* a binding
	// row per unmatched name, mid-build, in its own committed transaction —
	// so cancelling or discarding a build still left new characters behind.
	// Its own doc (availableSceneCast.ts) scoped it to "callers
	// with no review step downstream"; a graph build has one, so this was
	// misuse by its own contract. The build now proposes; apply commits.

	// Cast has to be read explicitly: migration 0091 moved it off the scenes
	// row into the `scene_characters` join table, so a scene row carries no
	// cast fields at all. Reading it as `s.participantCharacters` — which is
	// what this did, behind an `(s: any)` that hid it from the compiler —
	// silently yielded undefined for every scene, so the build ignored every
	// saved cast, re-derived it by LLM, and overwrote the user's on apply.
	// The annotation is gone so the next column change is a type error.
	const sceneCasts = await readSceneCasts(
		filteredRawScenes.map((s) => s.id)
	)

	/**
	 * The other half of the cast, DERIVED rather than read (plan §1).
	 *
	 * `mentioned` is exactly *(scene text × vocabulary)*, and
	 * `message_annotations` already holds that more precisely than a scene
	 * row ever did. Deriving it here is what makes a widened vocabulary
	 * reach every historical scene at once, and what lets an absorb stop
	 * remapping mentioned ids by hand — the annotations resolve through a
	 * gazetteer that already reflects the merge.
	 *
	 * ⚠ Annotation is a background lane, so a scene can legitimately answer
	 * "not yet" instead of "nobody". That is reported rather than flattened:
	 * an incomplete list silently presented as complete is the one outcome
	 * worse than a stale one. The build still runs on what is known — the
	 * proposal is reviewed by a person before anything is written — but the
	 * log names how many scenes were answered short.
	 */
	const sceneMentions = await deriveSceneMentions(
		db,
		params.lorebookId,
		filteredRawScenes.map((s) => ({
			id: s.id,
			selectedMessageIds: s.selectedMessageIds ?? null
		}))
	)
	const pendingMentionScenes = [...sceneMentions.values()].filter(
		(m) => m.status === "pending"
	).length
	if (pendingMentionScenes > 0) {
		console.warn(
			`[narrativeGraph] ${pendingMentionScenes} of ${filteredRawScenes.length} scene(s) in lorebook ${params.lorebookId} ` +
				`are not fully annotated yet; their mentioned cast is a floor, not an answer. ` +
				`Re-run the build once the annotation lane has caught up to widen it.`
		)
	}

	// Map scenes to GraphBuilderScene format with binding substitution applied
	const scenes: GraphBuilderScene[] = [
		...filteredRawScenes.map((s) => {
			const cast = castFor(sceneCasts, s.id)
			const mentions: SceneMentions | undefined = sceneMentions.get(
				s.id
			)
			return {
				id: s.id,
				name: s.name,
				summary: s.summary ? resolveBindings(s.summary) : s.summary,
				historyEntryId: s.historyEntryId ?? null,
				historyEntry: s.historyEntry
					? {
							id: s.historyEntry.id,
							...historyDateOf(s.historyEntry)
						}
					: null,
				participantCharacters: cast.participantCharacters,
				// Derived, never `cast.mentionedCharacters` — see above.
				// Any `mentioned` rows still in `scene_characters` are
				// pre-icing leftovers and are deliberately not read.
				mentionedCharacters: mentions
					? mentionedSoFar(mentions)
					: [],
				sessionId: s.sessionId ?? null,
				selectedMessageIds: s.selectedMessageIds?.length
					? s.selectedMessageIds
					: null
			}
		}),
		// Map direct history entries to GraphBuilderScene format
		...filteredDirectEntries.map((he) => ({
			id: he.id,
			name: null,
			summary: resolveBindings(he.content),
			historyEntryId: he.id,
			historyEntry: { id: he.id, ...historyDateOf(he) },
			sourceHistoryEntryId: he.id,
			// No stored cast — Phase 1's extract branch derives it.
			participantCharacters: null,
			mentionedCharacters: null
		}))
	]

	// Load seed nodes and relationships for LLM context. Both modes share
	// the same seeding query now — every lorebookBindings row already is
	// the graph row, bound or not, so there's no more separate
	// "narrativeNodes for extend, bindings-joined-to-characters for
	// replace" split (see the lorebookBindings/narrativeNodes merge
	// plan). Replace mode's own redefinition — resetting rather than
	// deleting bound/referenced rows — is what makes this safe: a
	// binding's stored name/aliases/summary are always meaningful
	// current state to seed from, not stale leftovers about to be wiped.
	let seedNodes: GraphBuilderSeedNode[] | undefined
	let seedRelationships: GraphBuilderSeedRelationship[] | undefined
	{
		const allBindings = await db.query.lorebookBindings.findMany({
			where: eq(
				schema.lorebookBindings.lorebookId,
				params.lorebookId
			),
			orderBy: asc(schema.lorebookBindings.id)
		})

		// Resolve character/persona sheet data as a fallback summary
		// source for rows that have never been graphed yet (empty
		// `summary` column) — matches the original replace-mode
		// bootstrap behavior for a lorebook with no graph history.
		const characterIds = allBindings
			.map((b) => b.characterId)
			.filter((id): id is number => id != null)
		const characters =
			characterIds.length > 0
				? await db
						.select({
							id: schema.characters.id,
							name: schema.characters.name,
							nickname: schema.characters.nickname,
							description: schema.characters.description,
							summary: schema.characters.summary
						})
						.from(schema.characters)
						.where(
							and(
								inArray(schema.characters.id, characterIds),
								// A deleted card seeds nothing (plan A25).
								eq(schema.characters.isDeleted, false)
							)
						)
				: []
		const charMap = new Map(characters.map((c) => [c.id, c]))

		function fallbackSummary(b: (typeof allBindings)[number]): string {
			if (b.characterId) {
				const char = charMap.get(b.characterId)
				return (
					char?.summary?.trim() || char?.description.trim() || ""
				)
			}
			return ""
		}

		// extend mode only processes ungraphed scenes (filtered above);
		// replace mode reprocesses everything — but the seed *set* is the
		// same either way, so the mode branch that used to live here is
		// gone.
		// Cast edges only: the builder seeds the model with characters and
		// the ties between them, and an edge with an entry end has no
		// second character to name.
		// The line's ties (plan A3): a sibling's tie is a story this line
		// never had, an ancestor's dated past the fork's cut is not in it
		// yet, and where the line tells an inherited tie its own way at the
		// same date, its own telling is the one it reads.
		const existingRelationships =
			mode === "extend"
				? nearestTieVersions(
						await rowsOnReading(
							db,
							await db.query.narrativeRelationships.findMany({
								where: and(
									eq(
										schema.narrativeRelationships.lorebookId,
										params.lorebookId
									),
									castEdgeOnly,
									onLineSql(
										schema.narrativeRelationships.branchId,
										line
									)
								),
								orderBy: asc(schema.narrativeRelationships.id)
							}),
							{
								lorebookId: params.lorebookId,
								branchId: buildBranchId,
								moment: null,
								forkedAt: null,
								line
							}
						),
						line
					)
				: []

		// Build alias name map: non-hidden alias-child names per parent
		const childrenByParent = new Map<number, string[]>()
		for (const b of allBindings) {
			if (b.parentNodeId !== null && b.nodeVisibility !== "hidden") {
				const list = childrenByParent.get(b.parentNodeId) ?? []
				list.push(b.name)
				childrenByParent.set(b.parentNodeId, list)
			}
		}

		// Only parent (non-alias) bindings as seeds; the schema-mandated
		// alias union plus this caller's own extra, child names.
		//
		// `absorbedAliases` used to be missing here — the one violator of
		// the invariant lorebookBindings.absorbedAliases documents. That is
		// precisely the wrong place to omit it: an identity absorbed by a
		// merge was invisible to the build, so the build re-proposed the
		// duplicate the merge had just resolved, after every merge, forever.
		const seeds: GraphBuilderSeedNode[] = []
		for (const b of allBindings) {
			if (b.parentNodeId !== null) continue
			const name = b.name.trim()
			if (!name) continue
			seeds.push({
				id: b.id,
				name,
				nodeState: b.nodeState,
				summary: b.summary?.trim() || fallbackSummary(b) || null,
				aliases: [
					...new Set([
						...collectAliases(b),
						...(childrenByParent.get(b.id) ?? [])
					])
				]
			})
		}
		if (seeds.length > 0) seedNodes = seeds

		seedRelationships = existingRelationships
			.filter(isCastEdge)
			.map((r) => ({
				fromNodeId: r.fromNodeId,
				toNodeId: r.toNodeId,
				relationshipType: r.relationshipType,
				visibility: r.visibility,
				status: r.status,
				description: r.description,
				reason: r.reason
			}))
	}

	// Screens newly-proposed character nodes: a station or an artefact with
	// its own World Lore page is a subject of the setting, not a member of
	// the cast, and the extraction prompt's one line saying so is routinely
	// ignored. Names that already match a bound character never reach the
	// filter — see resolveNameRefs.
	//
	// Places and items are screened with world lore: each was world lore
	// before it had its own entry type, and a place minted as a character
	// is the one way a Rebuild could put a place on the graph (places plan
	// L1 — a rebuild touches character ties only).
	const worldLore = await worldLoreOf(params.lorebookId, db)

	let latestSceneSnapshot: GraphBuilderResumeState | undefined
	// For the run receipt: which calls ran, so the pipeline page's run list
	// can say what a build cost without storing every payload twice (the
	// build log already streams them).
	let llmCallCount = 0
	const startedAt = Date.now()

	try {
		const result = await buildGraphFromScenes({
			scenes,
			connection: graphConnection,
			sampling: graphSampling,
			steps: graphSteps,
			seedNodes,
			seedRelationships,
			worldLore,
			signal: abortController.signal,
			resumeState,
			onSceneStart: (state) => {
				latestSceneSnapshot = state
			},
			onProgress: (data) => {
				activityStore.update(activityId, {
					phase: data.phase,
					sceneIndex: data.sceneIndex,
					totalScenes: data.totalScenes,
					nodesFound: data.nodesFound,
					relsFound: data.relationshipsFound,
					currentPair: data.currentPair,
					currentSceneLabel: data.currentSceneLabel
				})
			},
			onLlmCall: (entry) => {
				llmCallCount++
				emitToUser("narrativeGraph:buildLog", {
					...entry,
					// Present so the shell files the call under ITS book's
					// build (`graphBuilds.appendTrace` — one build per book),
					// never under whichever build is newest. The builder's
					// entry names only the call it made — it has no idea
					// which book started it — so the book is added here.
					// Not a scope: the event is deliberately absent from
					// `SCOPED_EVENTS`, because the shell's one listener wants
					// every book's log (plan B5).
					lorebookId: params.lorebookId
				} satisfies Sockets.NarrativeGraph.BuildLogEntry)
			},
			fetchSceneMessages: async (sessionId, messageIds) => {
				if (messageIds.length === 0) return []
				const msgs = await db.query.sessionMessages.findMany({
					where: and(
						eq(schema.sessionMessages.sessionId, sessionId),
						inArray(schema.sessionMessages.id, messageIds),
						eq(schema.sessionMessages.isHidden, false)
					),
					orderBy: asc(schema.sessionMessages.id),
					columns: {
						id: true,
						content: true,
						characterId: true,
						personaId: true,
						role: true
					}
				})
				const charIds = [
					...new Set(
						msgs
							.filter((m) => m.characterId)
							.map((m) => m.characterId!)
					)
				]
				const personaIds = [
					...new Set(
						msgs
							.filter((m) => m.personaId)
							.map((m) => m.personaId!)
					)
				]
				const [characters, personas] = await Promise.all([
					charIds.length > 0
						? db
								.select({
									id: schema.characters.id,
									name: schema.characters.name,
									nickname: schema.characters.nickname
								})
								.from(schema.characters)
								.where(
									inArray(schema.characters.id, charIds)
								)
						: Promise.resolve([]),
					personaIds.length > 0
						? db
								.select({
									id: schema.characters.id,
									name: schema.characters.name
								})
								.from(schema.characters)
								.where(
									inArray(
										schema.characters.id,
										personaIds
									)
								)
						: Promise.resolve([])
				])
				const characterMap = new Map(
					characters.map((c) => [c.id, resolveCharacterName(c)])
				)
				const personaMap = new Map(
					personas.map((p) => [p.id, p.name])
				)
				return msgs.map((m) => ({
					senderName: m.characterId
						? (characterMap.get(m.characterId) ??
							m.role ??
							"Character")
						: m.personaId
							? (personaMap.get(m.personaId) ??
								m.role ??
								"User")
							: (m.role ?? "System"),
					content: m.content
				}))
			}
		})

		// Build completed — clear any saved checkpoint for this lorebook
		buildResumeStates.delete(resumeKey)
		buildResumeScopes.delete(resumeKey)

		// Guard: if the user cancelled while the last LLM call was still completing,
		// the abort signal may have fired after buildGraphFromScenes returned normally.
		if (abortController.signal.aborted) {
			return {
				proposal: { nodes: [], relationships: [] },
				sceneLabels: [],
				seedTempIdMap: {}
			}
		}

		// resolvedSceneCast rides inside the proposal so it survives the
		// review round-trip and is committed by the same apply the user
		// approves — a discarded proposal writes nothing, which is the
		// whole persistence contract.
		const proposal: Sockets.NarrativeGraph.GraphProposal = {
			...result.proposal,
			resolvedSceneCast: result.resolvedSceneCast
		}

		// The build is a pipeline run and gets a run row — halted at the
		// proposal, which is the truthful outcome: nothing was applied, a
		// person decides on the Review screen. Never allowed to fail the
		// build (saveReceipt swallows its own errors).
		{
			const { saveReceipt } = await import(
				"$lib/server/pipelines/runtime/receipts"
			)
			const { GRAPH_BUILD_SPEC_ID, GRAPH_BUILD_VERSION } =
				await import("$lib/server/pipelines/specs/graphBuild")
			const { v4: uuidv4 } = await import("uuid")
			const endedAt = Date.now()
			await saveReceipt(
				db,
				{
					runId: uuidv4(),
					specId: GRAPH_BUILD_SPEC_ID,
					specVersion: GRAPH_BUILD_VERSION,
					outcome: "halt",
					haltNodeKey: "propose",
					haltReason: `proposal held for review — ${result.proposal.nodes.length} nodes, ${result.proposal.relationships.length} relationships from ${result.sceneLabels.length} scenes (${llmCallCount} model calls)`,
					triggerSource: "ui",
					seed: `build:${params.lorebookId}`,
					startedAt,
					endedAt,
					nodes: []
				} as any,
				{ userId }
			)
		}
		activityStore.update(activityId, {
			status: "review",
			proposal,
			sceneLabels: result.sceneLabels,
			seedTempIdMap: result.seedTempIdMap,
			seedNodeNames: result.seedNodeNames,
			relationshipDiagnostics: result.relationshipDiagnostics,
			filteredWorldLoreNames: result.filteredWorldLoreNames,
			processedSceneIds: filteredRawScenes
				.filter((s) => s.summary != null)
				.map((s) => s.id),
			processedHistoryEntryIds: filteredDirectEntries.map((e) => e.id)
		})
		return {
			proposal,
			sceneLabels: result.sceneLabels,
			seedTempIdMap: result.seedTempIdMap
		}
	} catch (err) {
		// If the build was aborted (cancel/stop), return silently regardless of error type.
		// An LLM network failure can race with the abort signal — treat both as a clean stop.
		if (
			abortController.signal.aborted ||
			(err instanceof Error && err.name === "AbortError")
		) {
			return {
				proposal: { nodes: [], relationships: [] },
				sceneLabels: [],
				seedTempIdMap: {}
			}
		}
		if (err instanceof GraphParseError) {
			// Save the pre-scene snapshot so the user can retry from this exact scene
			if (latestSceneSnapshot)
				buildResumeStates.set(resumeKey, latestSceneSnapshot)
			// Through `activityError` like every other terminalising write
			// here, even though `GraphParseError` is a `ComposedError`
			// whose own message survives it unchanged — so that no write
			// on this path is the one that reads `err.message` directly.
			// The truncation sentence is composed here and overrides it.
			activityStore.update(activityId, {
				status: "error",
				...activityError(err),
				...(err.truncated
					? {
							errorMessage:
								"The model ran out of response tokens before finishing the graph. Increase Max Response Tokens in your sampling config and try again."
						}
					: {}),
				errorRaw: err.raw
			})
			return {
				proposal: { nodes: [], relationships: [] },
				sceneLabels: [],
				seedTempIdMap: {}
			}
		}
		// Unexpected error (network failure, DB error, etc.) — show in modal rather than a generic toast
		// `activityError` rather than `err.message`: this record is served
		// back to a non-admin by `activityStore.getFor`, and an adapter
		// failure's words are the base URL and the model file.
		activityStore.update(activityId, {
			status: "error",
			...activityError(err)
		})
		return {
			proposal: { nodes: [], relationships: [] },
			sceneLabels: [],
			seedTempIdMap: {}
		}
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
					const [inserted] = await tx
						.insert(schema.lorebookBindings)
						.values({
							lorebookId,
							characterId: null,
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
						})
						.returning()
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
						await tx
							.update(schema.lorebookBindings)
							.set({
								nodeState: sanitizeNodeState(update.nodeState)
							})
							.where(
								and(
									eq(schema.lorebookBindings.id, id),
									eq(
										schema.lorebookBindings.lorebookId,
										lorebookId
									)
								)
							)
					}
					if (update.summary !== undefined) {
						// Fill-blanks-only, enforced in the WHERE rather than by
						// reading first: a non-empty summary is either a prior
						// build's output or a hand edit made through
						// lorebooks:updateBinding (which does not strip `summary`),
						// and the column cannot tell them apart. Encoding it here
						// also means a concurrent edit can't slip through, and the
						// client-supplied previousSummary is never trusted.
						await tx
							.update(schema.lorebookBindings)
							.set({
								summary: capText(
									update.summary,
									MAX_NODE_TEXT_LENGTH
								)
							})
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
						tx
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
					where: eq(
						schema.narrativeRelationships.lorebookId,
						lorebookId
					),
					orderBy: asc(schema.narrativeRelationships.id)
				})
			])
			nodes = bindingRows
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

// ─── Node CRUD ────────────────────────────────────────────────────────────────
//
// A cast row's own fields (its state, visibility, parent, scene and history
// anchors, name, aliases, card) are written through ONE door,
// `lorebooks:updateBinding` (`validateBindingCrossRefs`, plan B2). The graph's
// former `narrativeGraph:updateNode` duplicated it with an allowlist and had
// no client emitter.

/**
 * After a merge, an undo or a delete rewrote cast tags in a book's entries:
 * the derived data and the lists a client holds.
 *
 * The rewrite changed what those entries say, so their vectors and entity
 * annotations are stale; the queues judge each entry by its source hash and
 * re-embed only what changed. And an open editor holding the old text would
 * save the old tag back, so the entry lists go out again (lazily, to a socket
 * showing that type).
 */
async function afterCastTagRewrite(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	lorebook: { id: number; name: string },
	entryTypeIds: ReadonlySet<string>
) {
	if (entryTypeIds.size === 0) return
	autoEnqueueLorebook(lorebook.id, lorebook.name, "").catch(console.error)
	enqueueLorebookAnnotation(lorebook.id, lorebook.name)
	for (const typeId of entryTypeIds)
		await relistEntries(
			socket,
			lorebook.id,
			typeId as EntryTypeId,
			emitToUser
		)
}

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
		if (!existing) throw new Error("That link is not in this lorebook.")

		const lorebook = await findOwnedBook(db, userId, existing.lorebookId)
		if (!lorebook) throw new Error("That link is not in this lorebook.")

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
		if (!existing) throw new Error("That link is not in this lorebook.")

		const lorebook = await findOwnedBook(db, userId, existing.lorebookId)
		if (!lorebook) throw new Error("That link is not in this lorebook.")
		// From the row's own line only (plan B0): absent or null is main.
		await assertRelationshipWrite(db, {
			op: "delete",
			row: existing,
			line: params.branchId ?? null
		})

		await db
			.delete(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, params.id))

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
 * member back as they were, not as a bare row.
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
	return {
		castAmendments,
		castPresences,
		attributeValues,
		attributeConfigs,
		ownerSheets,
		stateProposals
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
	newBindingId: number
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
	const all = [
		...story.castAmendments,
		...story.castPresences,
		...story.attributeValues,
		...story.attributeConfigs,
		...ownerSheets,
		...stateProposals
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
	const sessions = await stillThere(tx, schema.sessions, col("sessionId"))
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
			survivorNode: merged.survivorNode
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
					spriteSet: schema.lorebookBindings.spriteSet,
					nodeState: schema.lorebookBindings.nodeState,
					nodeVisibility: schema.lorebookBindings.nodeVisibility,
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
				const blank = isBlankMember(tagHolder)
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
			const [inserted] = await tx
				.insert(schema.lorebookBindings)
				.values({
					...(rest as typeof schema.lorebookBindings.$inferInsert),
					binding: restoredTag,
					vectorizedAt: snapshotVectorizedAt
						? new Date(snapshotVectorizedAt as string)
						: null,
					createdAt: snapshotCreatedAt
						? new Date(snapshotCreatedAt as string)
						: new Date()
				})
				.returning()

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
						inserted.id
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
					castAmendment: (await ownedBy(schema.castAmendments)).map(
						(r: { id: number }) => r.id
					),
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
			restoredNode: restored.inserted,
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

export const narrativeGraphListMergeLogsHandler: Handler<
	Sockets.NarrativeGraph.ListMergeLogs.Params,
	Sockets.NarrativeGraph.ListMergeLogs.Response
> = refusable(
	"narrativeGraph:listMergeLogs",
	async (socket, params: Sockets.NarrativeGraph.ListMergeLogs.Params, emitToUser) => {
		const userId = socket.user!.id
		const { lorebookId } = params

		await assertOwnedBook(db, userId, lorebookId)

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

		await assertOwnedBook(db, userId, lorebookId)

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
	register(socket, narrativeGraphMergeNodeHandler, emitToUser)
	register(socket, narrativeGraphUndoMergeHandler, emitToUser)
	register(socket, narrativeGraphListMergeLogsHandler, emitToUser)
	register(socket, narrativeGraphDuplicateCandidatesHandler, emitToUser)
	register(socket, narrativeGraphDismissDuplicateHandler, emitToUser)
}
