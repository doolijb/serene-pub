/**
 * What the narrative graph handlers share: the graph list read
 * (`buildGraphList`) and the relationship and story-state shaping it is built
 * from, the duplicate-candidate scan, a sentence's saying, the book's world
 * lore screen, a book's shown name, and the refresh after a cast tag rewrite.
 *
 * A leaf among the `narrativeGraph.*.ts` modules: each imports these from
 * here, never from `narrativeGraph.ts`, and this module imports no
 * `narrativeGraph*` module.
 */

import { db } from "$lib/server/db"
import { bookShownName } from "$lib/server/lorebooks/notesShown"
import * as schema from "$lib/server/db/schema"
import type { NodeState, NodeVisibility } from "$lib/server/db/schema"
import {
	eq,
	asc,
	and,
	isNull,
	gt,
	notExists,
	sql,
	inArray,
	type SQL
} from "drizzle-orm"
import {
	HISTORY_TYPE_ID,
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	fieldIsTrue,
	inBookOfType
} from "$lib/server/utils/lorebookEntries"
import type { EntryTypeId } from "$lib/shared/entries/types"
import { isCastEdge } from "$lib/server/utils/narrativeEdges"
import type { GraphBuilderWorldLoreEntry } from "$lib/server/utils/graphBuilder"
import {
	findDuplicateCandidates
} from "$lib/server/utils/duplicateBindingDetection"
import type { RelationshipSaying } from "$lib/server/utils/relationshipGuards"
import type { EntryReading } from "$lib/server/state/entriesOnReading"
import { castVersionsInForce } from "$lib/server/cast/memberAsRead"
import { relistEntries } from "$lib/server/sockets/entries"
import { autoEnqueueLorebook } from "$lib/server/embedding/vectorizationQueue"
import { enqueueLorebookAnnotation } from "$lib/server/annotations/queue"

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

/** Every row of a list, with its endpoints resolved in one query. */
async function wireRelationships(
	rows: readonly SelectNarrativeRelationship[]
): Promise<Sockets.NarrativeGraph.NarrativeRelationship[]> {
	const entries = await entryEndpointIndex(rows)
	return rows.map((row) => wireRelationship(row, entries))
}

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

/**
 * A member's story state as one reading has it: the node state and visibility
 * of the cast version in force, and that version. The columns are frozen
 * (plan §32 §8: their values live on versions), so the graph reads these.
 * A member with no version (an error: the lift gave every member a base) reads
 * the version defaults: active, normal (`version: null`).
 */
type StoryStateRead = {
	nodeState: NodeState
	nodeVisibility: NodeVisibility
	version: typeof schema.characterVersions.$inferSelect | null
}

/**
 * Each member's story state on `reading` (Main at its head where none is
 * given), in one read.
 */
async function storyStatesOf(
	handle: Db,
	members: readonly { id: number }[],
	reading?: EntryReading
): Promise<Map<number, StoryStateRead>> {
	if (members.length === 0) return new Map()
	const inForce = await castVersionsInForce(
		handle,
		members.map((m) => m.id),
		reading ? { reading } : {}
	)
	return new Map(
		members.map((m) => {
			const version = inForce.get(m.id)?.version ?? null
			return [
				m.id,
				{
					nodeState: version?.nodeState ?? "active",
					nodeVisibility: version?.nodeVisibility ?? "normal",
					version
				}
			]
		})
	)
}

/** `rows` with their node state and visibility read from their versions (`storyStatesOf`). */
async function withStoryStates<
	M extends {
		id: number
		nodeState: NodeState
		nodeVisibility: NodeVisibility
	}
>(handle: Db, rows: readonly M[], reading?: EntryReading): Promise<M[]> {
	const states = await storyStatesOf(handle, rows, reading)
	return rows.map((row) => {
		const read = states.get(row.id)
		return read
			? {
					...row,
					nodeState: read.nodeState,
					nodeVisibility: read.nodeVisibility
				}
			: row
	})
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
						where: and(
							eq(
								schema.narrativeRelationships.lorebookId,
								lorebookId
							),
							isNull(schema.narrativeRelationships.knowledgeKind)
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

	// The story state is on versions (the columns are frozen).
	const nodesRead = await withStoryStates(db, nodes)

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
		nodes: nodesRead,
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

/** A book's name as a person is shown it: a session's notes by the session's current name. */
async function shownNameOfBook(book: { id: number; name: string }): Promise<string> {
	const [row] = await db
		.select({ sessionId: schema.lorebooks.sessionId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, book.id))
		.limit(1)
	return bookShownName(db, { name: book.name, sessionId: row?.sessionId ?? null })
}

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
	const label = await shownNameOfBook(lorebook)
	autoEnqueueLorebook(lorebook.id, label, "").catch(console.error)
	enqueueLorebookAnnotation(lorebook.id, label)
	for (const typeId of entryTypeIds)
		await relistEntries(
			socket,
			lorebook.id,
			typeId as EntryTypeId,
			emitToUser
		)
}

export {
	buildDuplicateCandidates,
	entryEndpointIndex,
	wireRelationship,
	sayingOf,
	wireRelationships,
	directEntryOf,
	storyStatesOf,
	withStoryStates,
	buildGraphList,
	worldLoreOf,
	shownNameOfBook,
	afterCastTagRewrite
}
