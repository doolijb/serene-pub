/**
 * 🚧 **Entry knowledge** — which entries a cast member does not know, and the
 * only writer of the marks and ties behind it.
 *
 * **Purpose.** Unknown content is left out of the prompt; the model is never
 * told what a character does not know. An entry marked **not common
 * knowledge** is read only by the cast members tied to it; a *kept from* tie
 * hides an entry from one member, marked or not.
 *
 * **Owns.** `lorebook_entries.not_common_knowledge` and the **knowledge ties**
 * (`narrative_relationships` rows with a `knowledge_kind`): every write to
 * them (the hand switch, a tie's end, and the move of a held play tie to the
 * lorebook on Apply or its drop for a hand tie), and the decision that reads them.
 *
 * **Does not own.** The reads' `knownToSpeaker` param (each read applies the
 * judgement to its own rows), the ties' readers (the graph, ranking, the
 * prompt's ties, lore links, the Timeline, embeddings, ruleset ties: each
 * filters knowledge ties out for itself), the line and moment rules (`lineReading.ts`), the
 * session's reading (`state/reading.ts`), seats (`sessions/seats.ts`).
 *
 * **The rule.**
 * 1. A member knows an entry when any active tie runs from its cast binding to
 *    the entry, reads on the reply's line at the reply's date, and is not
 *    *kept from*. An ordinary tie counts; so does every knowing kind.
 * 2. A tie's date is its history entry's date; undated is earliest and is
 *    never cut by a fork. A tie kept in the session's notes (with an attached
 *    lorebook) is the session's own: its branch is not judged, only a date
 *    after the reading's moment cuts it. With the Timeline off, dates play no
 *    part; lines and `status` still do.
 * 3. Of the ties that read for one entry, a hand tie wins over every other
 *    tie (ruled D39); of two hand ties, the nearer line (the notes, then the
 *    line's own steps in order), then the newest id. With no hand tie, the
 *    later date wins; at one date the nearer line; then *kept from*.
 * 4. Left out, for a reply spoken by one cast member on its own turn: a marked
 *    entry the winning tie does not know, and an entry a *kept from* tie wins
 *    for. The lore reads drop them at the source when their query's
 *    `knownToSpeaker` param is on (the default). A narrator, an envoy and a
 *    step writing for several characters read everything.
 * 5. The place a member stands in counts as known, even against a *kept from*
 *    tie: it is left out of nothing. The place is the value of
 *    `core:slot/location@1` on the member's own state owner, else the
 *    session's own (world) value; an entry reference (`{ entryId }`) names the
 *    entry, a name (as the Lair and Story store it) names the left-out place
 *    entry with the same name (`sameName`). Only a place entry counts; the
 *    value is read only when a place is left out.
 *
 * Every function takes its handle; it never statically imports
 * `$lib/server/db`. Inside a transaction, hand the transaction's `tx`.
 * The loader is read-only. The pure core does one pass over the rows.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { seatOf } from "$lib/server/sessions/seats"
import { readsAllReceipt } from "$lib/server/sessions/firsthandFilter"
import {
	BranchRefusal,
	historyEntryDate,
	readingOf,
	sessionReadingOf
} from "$lib/server/state/reading"
import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"
import {
	MAIN_LINE,
	rowReadsOnLine,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import {
	isKnowledgeKind,
	type KnowledgeKind
} from "$lib/shared/lorebooks/knowledgeKinds"

/** One cast→entry tie of the speaker, as the judgement reads it. */
export interface KnowledgeRowRead {
	id: number
	entryId: number
	/** NULL: an ordinary tie, which counts as knowing. */
	kind: KnowledgeKind | null
	branchId: number | null
	/** The history entry's date; null is undated. */
	date: StoryDate | null
	/** Kept in the session's notes while an attached lorebook exists. */
	inNotes: boolean
	/** A hand tie: `knows` or `kept_from`, undated and on no branch. */
	hand: boolean
}

/** Why an entry is left out: no knowing tie, or a *kept from* tie. */
export type KnowledgeCause = "not-known" | "kept-from"

/** What the judgement leaves out, with the count of each cause. */
export interface KnowledgeJudgement {
	leftOut: Array<{ entryId: number; cause: KnowledgeCause }>
	notKnown: number
	keptFrom: number
}

const HAND_KINDS = ["knows", "kept_from"] as const

/** The one spelling of a hand tie: a `knows` or `kept_from` tie, undated and on no branch. */
export const isHandTie = (t: {
	kind: string | null
	historyEntryId: number | null
	branchId: number | null
}) =>
	(HAND_KINDS as readonly string[]).includes(t.kind ?? "") &&
	t.historyEntryId == null &&
	t.branchId == null

const isKeptFrom = (row: KnowledgeRowRead) => row.kind === "kept_from"

/**
 * 🚧 The tie that wins for each entry among the rows that read: a hand tie
 * first (the nearer, then the newest id), else the later date, then the nearer
 * line (the notes, then the line's steps in order), then *kept from*. Entry id → its winning row, carrying the timeline-aware
 * date (null when the book's Timeline is off, so no date plays a part).
 */
export function winningTies(input: {
	rows: readonly KnowledgeRowRead[]
	line: Line
	moment: StoryDate | null
	timelineOff: boolean
	ownBookIsReading?: boolean
}): Map<number, KnowledgeRowRead> {
	return new Map(
		[...winnersOf(input)].map(([entryId, w]) => [
			entryId,
			{ ...w.row, date: w.date }
		])
	)
}

type Win = { row: KnowledgeRowRead; date: StoryDate | null; near: number }

function winnersOf(input: {
	rows: readonly KnowledgeRowRead[]
	line: Line
	moment: StoryDate | null
	timelineOff: boolean
	ownBookIsReading?: boolean
}): Map<number, Win> {
	const { line, timelineOff } = input
	const moment = timelineOff ? null : input.moment
	const stepIndex = new Map<number | null, number>()
	line.steps.forEach((s, i) => {
		if (!stepIndex.has(s.branchId)) stepIndex.set(s.branchId, i)
	})
	// Nearness: the notes first, then the steps of the line in order.
	const nearness = (row: KnowledgeRowRead, notes: boolean) =>
		notes
			? -1
			: (stepIndex.get(row.branchId ?? null) ?? Number.MAX_SAFE_INTEGER)

	const winners = new Map<number, Win>()
	for (const row of input.rows) {
		const date = timelineOff ? null : row.date
		const notes = row.inNotes && !input.ownBookIsReading
		const reads = notes
			? !(moment && date && compareDates(date, moment) > 0)
			: rowReadsOnLine(row, line, date, moment)
		if (!reads) continue
		const cand: Win = { row, date, near: nearness(row, notes) }
		const cur = winners.get(row.entryId)
		if (!cur || beats(cand, cur)) winners.set(row.entryId, cand)
	}
	return winners
}

/**
 * Decides, per marked entry and per entry a *kept from* tie names, whether the
 * speaker's winning tie leaves it out.
 *
 * The order, in full:
 * 1. The place the speaker stands in counts as known, whatever the ties
 *    (rule 5; applied by `loadEntryKnowledge` after this judge).
 * 2. Of the ties that read for the pair, a hand tie wins over every other tie;
 *    of two hand ties, the nearer (the session's notes, then the line's
 *    steps), then the newest id.
 * 3. With no hand tie: the later date, then the nearer line, then *kept from*.
 * 4. The winning tie decides: *kept from* leaves the entry out, marked or not;
 *    any other tie means it is known.
 * 5. No tie reads: a marked entry is not known; an unmarked one is common
 *    knowledge.
 * `ownBookIsReading`: the reading is the
 * own book's, so its rows are judged like any other.
 */
export function judgeEntryKnowledge(input: {
	markedEntryIds: Iterable<number>
	rows: readonly KnowledgeRowRead[]
	line: Line
	moment: StoryDate | null
	timelineOff: boolean
	ownBookIsReading?: boolean
}): KnowledgeJudgement {
	const marked = new Set(input.markedEntryIds)
	const winners = winnersOf(input)

	const leftOut: KnowledgeJudgement["leftOut"] = []
	let notKnown = 0
	let keptFrom = 0
	const consider = new Set<number>(marked)
	// An entry a kept-from tie wins for is out whether or not it is marked.
	for (const [entryId, w] of winners)
		if (isKeptFrom(w.row)) consider.add(entryId)
	for (const entryId of consider) {
		const w = winners.get(entryId)
		if (w && isKeptFrom(w.row)) {
			leftOut.push({ entryId, cause: "kept-from" })
			keptFrom++
		} else if (marked.has(entryId) && !w) {
			// A winning row that is not *kept from* is an ordinary or knowing tie.
			leftOut.push({ entryId, cause: "not-known" })
			notKnown++
		}
	}
	leftOut.sort((a, b) => a.entryId - b.entryId)
	return { leftOut, notKnown, keptFrom }
}

/** Whether `a` wins over `b`: a hand tie, else later date, nearer line, then *kept from*. */
function beats(
	a: { row: KnowledgeRowRead; date: StoryDate | null; near: number },
	b: { row: KnowledgeRowRead; date: StoryDate | null; near: number }
): boolean {
	if (a.row.hand !== b.row.hand) return a.row.hand
	if (a.row.hand) {
		if (a.near !== b.near) return a.near < b.near
		return a.row.id > b.row.id
	}
	const order =
		a.date && b.date
			? compareDates(a.date, b.date)
			: a.date
				? 1
				: b.date
					? -1
					: 0
	if (order !== 0) return order > 0
	if (a.near !== b.near) return a.near < b.near
	return isKeptFrom(a.row) && !isKeptFrom(b.row)
}

/** 🚧 The receipt of a judged read: how many entries were left out, and why. */
export function knowledgeReceipt(
	name: string,
	judged: { notKnown: number; keptFrom: number }
): string {
	const { notKnown, keptFrom } = judged
	const n = notKnown + keptFrom
	if (n === 0) return `No entries left out for ${name}`
	const count = n === 1 ? "1 entry" : `${n} entries`
	if (keptFrom === 0) return `${count} left out: not known by ${name}`
	if (notKnown === 0) return `${count} left out: kept from ${name}`
	return `${count} left out: ${notKnown} not known by ${name}, ${keptFrom} kept from ${name}`
}

/** 🚧 The receipt when nothing is marked and nobody is kept from anything. */
export const NOTHING_MARKED_RECEIPT =
	"No entries left out: nothing here is marked not common knowledge or kept from anyone"

/**
 * 🚧 What one read left out of its rows, as the read's receipt says it:
 * the counts are this read's own, `leftOut` the judgement's whole list.
 */
export type KnowledgeDrop =
	| { kind: "reads-all" }
	| { kind: "nothing-marked" }
	| {
			kind: "judged"
			name: string
			notKnown: number
			keptFrom: number
			leftOut: Array<{ entryId: number; cause: KnowledgeCause }>
	  }

const DROPS = new WeakMap<object, KnowledgeDrop>()

/** 🚧 Records what a read dropped on the rows it returns. */
export function noteKnowledgeDrop(rows: object, drop: KnowledgeDrop): void {
	DROPS.set(rows, drop)
}

/** 🚧 What the read that returned `rows` dropped; undefined when it did not judge. */
export function knowledgeDropOf(rows: unknown): KnowledgeDrop | undefined {
	return typeof rows === "object" && rows !== null
		? DROPS.get(rows)
		: undefined
}

/** 🚧 The receipt sentence for one read's drop. */
export function knowledgeDropReceipt(drop: KnowledgeDrop): string {
	if (drop.kind === "reads-all") return readsAllReceipt()
	if (drop.kind === "nothing-marked") return NOTHING_MARKED_RECEIPT
	return knowledgeReceipt(drop.name, drop)
}

/** What the loader answers. */
export type EntryKnowledgeRead =
	| { kind: "reads-all" }
	| { kind: "nothing-marked" }
	| ({ kind: "judged"; name: string } & KnowledgeJudgement)

/** The books the session reads: its attached lorebook and its own notes. */
const BOOKS_READ = (sessionId: number) => sql`(
	SELECT lorebook_id AS id FROM sessions WHERE id = ${sessionId} AND lorebook_id IS NOT NULL
	UNION
	SELECT id FROM lorebooks WHERE session_id = ${sessionId}
)`

/**
 * Judges what the speaker of a reply knows. `speaker` is a seat ref
 * (`character:<id>`, `seated-member:<id>`); anything else, or a ref with no seat
 * and cast member (a narrator, an envoy), reads everything. One statement when
 * nothing is marked and nobody is kept from anything. Read-only; never call it
 * inside a transaction with the outer `db`.
 */
export async function loadEntryKnowledge(
	db: Db,
	opts: { sessionId: number; speaker: unknown }
): Promise<EntryKnowledgeRead> {
	const { sessionId, speaker } = opts
	if (typeof speaker !== "string" || !speaker.trim())
		return { kind: "reads-all" }

	const flagged = rawRows<{ k: string; id: number }>(
		await db.execute(sql`
			SELECT 'marked' AS k, e.id FROM lorebook_entries e
			WHERE e.not_common_knowledge AND e.lorebook_id IN ${BOOKS_READ(sessionId)}
			UNION ALL
			SELECT 'kept' AS k, r.to_entry_id AS id FROM narrative_relationships r
			WHERE r.knowledge_kind = 'kept_from' AND r.status = 'active'
				AND r.to_entry_id IS NOT NULL AND r.lorebook_id IN ${BOOKS_READ(sessionId)}
		`)
	)
	if (!flagged.length) return { kind: "nothing-marked" }
	const marked = flagged
		.filter((f) => f.k === "marked")
		.map((f) => Number(f.id))

	const seat = await seatOf(db, sessionId, speaker)
	const member = seat?.castMemberId ?? null
	if (member == null) return { kind: "reads-all" }

	const found = rawRows<{
		id: number
		to_entry_id: number
		knowledge_kind: string | null
		branch_id: number | null
		history_entry_id: number | null
		fields: unknown
		in_notes: boolean
	}>(
		await db.execute(sql`
			SELECT r.id, r.to_entry_id, r.knowledge_kind, r.branch_id, r.history_entry_id, h.fields,
				(l.session_id IS NOT NULL AND EXISTS (
					SELECT 1 FROM sessions s WHERE s.id = l.session_id AND s.lorebook_id IS NOT NULL
				)) AS in_notes
			FROM narrative_relationships r
			JOIN lorebooks l ON l.id = r.lorebook_id
			LEFT JOIN lorebook_entries h ON h.id = r.history_entry_id
			WHERE r.from_node_id = ${member} AND r.to_entry_id IS NOT NULL
				AND r.status = 'active' AND r.lorebook_id IN ${BOOKS_READ(sessionId)}
		`)
	)
	const rows: KnowledgeRowRead[] = found.map((r) => ({
		id: Number(r.id),
		entryId: Number(r.to_entry_id),
		kind: isKnowledgeKind(r.knowledge_kind) ? r.knowledge_kind : null,
		branchId: r.branch_id == null ? null : Number(r.branch_id),
		date: historyEntryDate(r.fields),
		inNotes: r.in_notes === true,
		hand: isHandTie({
			kind: isKnowledgeKind(r.knowledge_kind) ? r.knowledge_kind : null,
			historyEntryId:
				r.history_entry_id == null ? null : Number(r.history_entry_id),
			branchId: r.branch_id == null ? null : Number(r.branch_id)
		})
	}))

	const shown = (await membersAsRead(db, [member], { sessionId })).get(
		member
	)?.shownName
	const name = (shown ?? "").trim() || "this character"

	const reading = rows.length ? await sessionReadingOf(db, sessionId) : null
	const judged = judgeEntryKnowledge({
		markedEntryIds: marked,
		rows,
		line: reading?.line ?? MAIN_LINE,
		moment: reading?.moment ?? null,
		timelineOff: reading?.timelineOff === true,
		ownBookIsReading: reading?.onOwnBook === true
	})
	if (judged.leftOut.length) {
		const standing = await standingPlaceIds(db, sessionId, seat!, judged.leftOut)
		if (standing.size) {
			const leftOut = judged.leftOut.filter((l) => !standing.has(l.entryId))
			return {
				kind: "judged",
				name,
				leftOut,
				notKnown: leftOut.filter((l) => l.cause === "not-known").length,
				keptFrom: leftOut.filter((l) => l.cause === "kept-from").length
			}
		}
	}
	return { kind: "judged", name, ...judged }
}

/**
 * The left-out entries the speaker stands in (rule 5): the seat's own location
 * value, else the session's. Costs nothing unless called, and is called only
 * when something is left out.
 */
async function standingPlaceIds(
	db: Db,
	sessionId: number,
	seat: NonNullable<Awaited<ReturnType<typeof seatOf>>>,
	leftOut: KnowledgeJudgement["leftOut"]
): Promise<Set<number>> {
	// Only a place can be stood in: the left-out place entries, read first, so
	// a judgement that leaves out no place reads no value at all.
	const { LOCATION_TYPE_ID } = await import("$lib/shared/entries/types")
	const places = await db
		.select({ id: schema.lorebookEntries.id, title: schema.lorebookEntries.title })
		.from(schema.lorebookEntries)
		.where(
			and(
				inArray(
					schema.lorebookEntries.id,
					leftOut.map((l) => l.entryId)
				),
				eq(schema.lorebookEntries.typeId, LOCATION_TYPE_ID)
			)
		)
	if (!places.length) return new Set()
	const { valueOf, sessionLinks } = await import("$lib/server/state/resolve")
	const { castOwnerOf } = await import("$lib/server/state/owners")
	const { HOST_PLACE_SLOT_ID, isSlotLoreRef, sameName } = await import(
		"@serene-pub/sdk"
	)
	const owner = castOwnerOf({
		characterId: seat.cardId ?? 0,
		...(seat.kind === "player"
			? { playerSeatId: seat.seatId }
			: { seatMemberId: seat.castMemberId })
	})
	// The session's links are read once for both owners.
	const links = await sessionLinks(db, sessionId)
	const own =
		owner.kind === "session_cast" && seat.cardId == null
			? undefined
			: await valueOf(db, { sessionId, owner, slotId: HOST_PLACE_SLOT_ID }, { links })
	const value =
		own ??
		(await valueOf(
			db,
			{
				sessionId,
				owner: { kind: "session", id: sessionId },
				slotId: HOST_PLACE_SLOT_ID
			},
			{ links }
		))
	const items: readonly unknown[] = Array.isArray(value) ? value : [value]
	const out = new Set<number>()
	for (const item of items)
		for (const place of places)
			if (
				isSlotLoreRef(item)
					? item.entryId === place.id
					: typeof item === "string" && sameName(item, place.title)
			)
				out.add(place.id)
	return out
}

/** 🚧 Knowledge ties, like the marks, are the lorebook owner's alone; a session's other members are refused. */
const TIE_REFUSAL = "Only the lorebook's owner can say who knows what."

/** Marks an entry not common knowledge, or clears the mark. The lorebook's owner only. */
export async function setEntryCommonKnowledge(
	db: Db,
	input: { userId: number; entryId: number; notCommonKnowledge: boolean }
): Promise<void> {
	const refusal =
		"Only the lorebook's owner can mark what is common knowledge."
	const { findOwnedBook } = await import("$lib/server/utils/ownedBook")
	await db.transaction(async (tx) => {
		const [entry] = await tx
			.select({ lorebookId: schema.lorebookEntries.lorebookId })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, input.entryId))
			.limit(1)
		const book = entry
			? await findOwnedBook(tx, input.userId, entry.lorebookId)
			: undefined
		if (!book || book.userId !== input.userId) throw new Error(refusal)
		await tx
			.update(schema.lorebookEntries)
			.set({ notCommonKnowledge: input.notCommonKnowledge })
			.where(eq(schema.lorebookEntries.id, input.entryId))
	})
}

/**
 * Writes one knowledge tie from a cast member to an entry, active, and returns
 * its id. The binding and the entry must belong to `lorebookId` or, for a
 * session's notes, to that session's attached lorebook.
 */
export async function writeKnowledgeTie(
	db: Db,
	input: {
		userId: number
		lorebookId: number
		castMemberId: number
		entryId: number
		kind: KnowledgeKind
		historyEntryId?: number | null
		branchId?: number | null
	}
): Promise<number> {
	const { findOwnedBook } = await import("$lib/server/utils/ownedBook")
	return db.transaction(async (tx) => {
		if (!isKnowledgeKind(input.kind))
			throw new Error("That is not a kind of knowledge.")
		const book = await findOwnedBook(tx, input.userId, input.lorebookId)
		if (!book) throw new Error("Lorebook not found.")
		if (book.userId !== input.userId) throw new Error(TIE_REFUSAL)
		const [row] = await tx
			.select({ sessionId: schema.lorebooks.sessionId })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, book.id))
			.limit(1)
		const reach = [book.id]
		if (row?.sessionId != null) {
			const [session] = await tx
				.select({ lorebookId: schema.sessions.lorebookId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, row.sessionId))
				.limit(1)
			if (session?.lorebookId != null) reach.push(session.lorebookId)
		}
		const [member] = await tx
			.select({ lorebookId: schema.lorebookBindings.lorebookId })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, input.castMemberId))
			.limit(1)
		if (!member || !reach.includes(member.lorebookId))
			throw new Error("That cast member is not in this lorebook.")
		const [entry] = await tx
			.select({ lorebookId: schema.lorebookEntries.lorebookId })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, input.entryId))
			.limit(1)
		if (!entry || !reach.includes(entry.lorebookId))
			throw new Error("That entry is not in this lorebook.")
		const [tie] = await tx
			.insert(schema.narrativeRelationships)
			.values({
				lorebookId: book.id,
				fromNodeId: input.castMemberId,
				toEntryId: input.entryId,
				relationshipType: input.kind,
				knowledgeKind: input.kind,
				status: "active",
				historyEntryId: input.historyEntryId ?? null,
				branchId: input.branchId ?? null
			})
			.returning({ id: schema.narrativeRelationships.id })
		return tie!.id
	})
}

/** Ends one knowledge tie (`status = 'resolved'`, a status every reader and the import know); an ordinary row is refused. */
export async function endKnowledgeTie(
	db: Db,
	input: { userId: number; tieId: number }
): Promise<void> {
	const { findOwnedBook } = await import("$lib/server/utils/ownedBook")
	await db.transaction(async (tx) => {
		const [tie] = await tx
			.select({
				lorebookId: schema.narrativeRelationships.lorebookId,
				knowledgeKind: schema.narrativeRelationships.knowledgeKind
			})
			.from(schema.narrativeRelationships)
			.where(eq(schema.narrativeRelationships.id, input.tieId))
			.limit(1)
		const book = tie
			? await findOwnedBook(tx, input.userId, tie.lorebookId)
			: undefined
		if (!tie || !book) throw new Error("Lorebook not found.")
		if (book.userId !== input.userId) throw new Error(TIE_REFUSAL)
		if (tie.knowledgeKind == null)
			throw new Error("That is not a knowledge tie.")
		await tx
			.update(schema.narrativeRelationships)
			.set({ status: "resolved" })
			.where(eq(schema.narrativeRelationships.id, input.tieId))
	})
}

/** 🚧 Every active knowledge tie (any kind) from one cast member to one entry in the books the session reads; `inNotes` is this session's own notes. Read-only. */
export async function knowledgeTiesOfPair(
	db: Db,
	input: { sessionId: number; castMemberId: number; entryId: number }
): Promise<
	{
		id: number
		kind: KnowledgeKind
		lorebookId: number
		branchId: number | null
		inNotes: boolean
	}[]
> {
	const found = rawRows<{
		id: number
		knowledge_kind: string
		lorebook_id: number
		branch_id: number | null
		in_notes: boolean
	}>(
		await db.execute(sql`
			SELECT r.id, r.knowledge_kind, r.lorebook_id, r.branch_id,
				(l.session_id = ${input.sessionId}) AS in_notes
			FROM narrative_relationships r
			JOIN lorebooks l ON l.id = r.lorebook_id
			WHERE r.from_node_id = ${input.castMemberId} AND r.to_entry_id = ${input.entryId}
				AND r.knowledge_kind IS NOT NULL AND r.status = 'active'
				AND r.lorebook_id IN ${BOOKS_READ(input.sessionId)}
			ORDER BY r.id
		`)
	)
	return found
		.filter((r) => isKnowledgeKind(r.knowledge_kind))
		.map((r) => ({
			id: Number(r.id),
			kind: r.knowledge_kind as KnowledgeKind,
			lorebookId: Number(r.lorebook_id),
			branchId: r.branch_id == null ? null : Number(r.branch_id),
			inNotes: r.in_notes === true
		}))
}

/**
 * 🚧 The owner's read of who knows what in one book: for each (member, entry)
 * asked, what `judgeEntryKnowledge` decides at the reading, the tie that wins
 * and the member's hand tie. Only this book's own ties are read. The row's
 * owner only; `entryId` and `castMemberId` pick the pairs (neither: none).
 */
export async function readBookKnowledge(
	db: Db,
	input: {
		userId: number
		lorebookId: number
		entryId?: number
		castMemberId?: number
		branchId: number | null
		moment: StoryDate | null
	}
): Promise<{ markedEntryIds: number[]; rows: Sockets.EntryKnowledge.Row[] }> {
	const { findOwnedBook } = await import("$lib/server/utils/ownedBook")
	const book = await findOwnedBook(db, input.userId, input.lorebookId)
	if (!book) throw new Error("Lorebook not found.")
	if (book.userId !== input.userId) throw new Error(TIE_REFUSAL)

	// The book's Timeline switch is passed, not left to the reading: asked with
	// no moment, the reading would not ask it, and dates would play a part.
	const { timelineOfBook } = await import("$lib/server/lorebooks/timeline")
	let reading: Awaited<ReturnType<typeof readingOf>>
	try {
		reading = await readingOf(db, book.id, {
			branch: input.branchId ?? "main",
			moment: input.moment,
			timelineEnabled: await timelineOfBook(db, book.id)
		})
	} catch (e) {
		if (e instanceof BranchRefusal)
			throw new Error("That is not a line of this lorebook.")
		throw e
	}
	const E = schema.lorebookEntries
	const marked = (
		await db
			.select({ id: E.id })
			.from(E)
			.where(and(eq(E.lorebookId, book.id), eq(E.notCommonKnowledge, true)))
			.orderBy(asc(E.id))
	).map((r) => r.id)
	if (input.entryId == null && input.castMemberId == null)
		return { markedEntryIds: marked, rows: [] }

	const reach = await bookReach(db, book.id)
	const B = schema.lorebookBindings
	let entryTypes = new Map<number, string>()
	const entryRow = async (ids: number[]) => {
		const found = await db
			.select({ id: E.id, typeId: E.typeId })
			.from(E)
			.where(and(inArray(E.id, ids), inArray(E.lorebookId, reach)))
		return found
	}
	if (input.entryId != null) {
		const [e] = await entryRow([input.entryId])
		if (!e) throw new Error("That entry is not in this lorebook.")
	}
	let members: { id: number; name: string }[]
	if (input.castMemberId != null) {
		const [m] = await db
			.select({ id: B.id, name: B.name })
			.from(B)
			.where(and(eq(B.id, input.castMemberId), inArray(B.lorebookId, reach)))
		if (!m) throw new Error("That cast member is not in this lorebook.")
		members = [m]
	} else {
		members = await db
			.select({ id: B.id, name: B.name })
			.from(B)
			.where(inArray(B.lorebookId, reach))
			.orderBy(asc(B.id))
	}

	// This book's active ties of the members asked, to the entry asked or to any.
	const R = schema.narrativeRelationships
	const H = alias(schema.lorebookEntries, "tie_history")
	const found = members.length
		? await db
				.select({
					id: R.id,
					memberId: R.fromNodeId,
					entryId: R.toEntryId,
					kind: R.knowledgeKind,
					relationshipType: R.relationshipType,
					branchId: R.branchId,
					historyEntryId: R.historyEntryId,
					fields: H.fields
				})
				.from(R)
				.leftJoin(H, eq(H.id, R.historyEntryId))
				.where(
					and(
						eq(R.lorebookId, book.id),
						eq(R.status, "active"),
						inArray(
							R.fromNodeId,
							members.map((m) => m.id)
						),
						input.entryId != null
							? eq(R.toEntryId, input.entryId)
							: sql`${R.toEntryId} IS NOT NULL`
					)
				)
				.orderBy(asc(R.id))
		: []

	const markedSet = new Set(marked)
	const entryIds = new Set<number>()
	if (input.entryId != null) entryIds.add(input.entryId)
	else {
		for (const id of marked) entryIds.add(id)
		for (const t of found) entryIds.add(t.entryId!)
	}
	const entries = entryIds.size ? await entryRow([...entryIds]) : []
	entryTypes = new Map(entries.map((e) => [e.id, e.typeId]))
	const asked = [...entryIds].filter((id) => entryTypes.has(id))
	const { LOCATION_TYPE_ID } = await import("$lib/shared/entries/types")
	const shown = await membersAsRead(db, members.map((m) => m.id))

	const line = reading.line
	const moment = reading.moment
	const timelineOff = reading.timelineOff === true
	type Tie = (typeof found)[number]
	const byId = new Map<number, Tie>(found.map((t) => [t.id, t]))
	const isHand = (t: Tie) => isHandTie(t)

	const out: Sockets.EntryKnowledge.Row[] = []
	for (const m of members) {
		const mine = found.filter((t) => t.memberId === m.id)
		const rows: KnowledgeRowRead[] = mine.map((t) => ({
			id: t.id,
			entryId: t.entryId!,
			kind: isKnowledgeKind(t.kind) ? t.kind : null,
			branchId: t.branchId ?? null,
			date: historyEntryDate(t.fields),
			inNotes: false,
			hand: isHand(t)
		}))
		const winners = winningTies({ rows, line, moment, timelineOff })
		// The tie that would win if no hand tie stood: the same judge, hand ties out.
		const without = winningTies({
			rows: rows.filter((r) => !r.hand),
			line,
			moment,
			timelineOff
		})
		const winnerOf = (
			w: KnowledgeRowRead
		): Sockets.EntryKnowledge.Winner => ({
			tieId: w.id,
			kind: w.kind,
			relationshipType: byId.get(w.id)?.relationshipType ?? "",
			hand: w.hand,
			date: w.date
				? {
						year: w.date.year,
						month: w.date.month ?? null,
						day: w.date.day ?? null
					}
				: null
		})
		const judged = judgeEntryKnowledge({
			markedEntryIds: asked.filter((id) => markedSet.has(id)),
			rows,
			line,
			moment,
			timelineOff
		})
		const leftOut = new Set(judged.leftOut.map((l) => l.entryId))
		const name =
			(shown.get(m.id)?.shownName ?? "").trim() || (m.name ?? "").trim()
		for (const entryId of asked) {
			const w = winners.get(entryId)
			const tie = w ? byId.get(w.id) : undefined
			const date = w?.date ?? null
			const over = w?.hand ? without.get(entryId) : undefined
			out.push({
				castMemberId: m.id,
				name,
				entryId,
				known: !leftOut.has(entryId),
				winner:
					w && tie
						? {
								tieId: w.id,
								kind: w.kind,
								relationshipType: tie.relationshipType ?? "",
								hand: isHand(tie),
								date: date
									? {
											year: date.year,
											month: date.month ?? null,
											day: date.day ?? null
										}
									: null
							}
						: null,
				hand: w?.hand ? (w.kind as "knows" | "kept_from") : null,
				overruled: over ? winnerOf(over) : null,
				placeEntry: entryTypes.get(entryId) === LOCATION_TYPE_ID
			})
		}
	}
	if (input.entryId != null)
		out.sort((a, b) => a.name.localeCompare(b.name))
	else out.sort((a, b) => a.entryId - b.entryId)
	return { markedEntryIds: marked, rows: out }
}

/** The book and, for a session's notes, the lorebook the session attaches. */
async function bookReach(db: Db, bookId: number): Promise<number[]> {
	const [row] = await db
		.select({ sessionId: schema.lorebooks.sessionId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, bookId))
		.limit(1)
	const reach = [bookId]
	if (row?.sessionId != null) {
		const [session] = await db
			.select({ lorebookId: schema.sessions.lorebookId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, row.sessionId))
			.limit(1)
		if (session?.lorebookId != null) reach.push(session.lorebookId)
	}
	return reach
}

/**
 * 🚧 Marks several entries of one book not common knowledge, or clears the
 * marks: one transaction, so a refusal on any entry marks none. The row's
 * owner only. Returns the book's marked ids after the write.
 */
export async function setBookCommonKnowledge(
	db: Db,
	input: {
		userId: number
		lorebookId: number
		entryIds: number[]
		notCommonKnowledge: boolean
	}
): Promise<number[]> {
	const ids = [...new Set(input.entryIds)]
	if (!ids.length || !ids.every((id) => Number.isInteger(id)))
		throw new Error("Name the entries to mark.")
	const { findOwnedBook } = await import("$lib/server/utils/ownedBook")
	const bookId = await db.transaction(async (tx) => {
		const book = await findOwnedBook(tx, input.userId, input.lorebookId)
		if (!book) throw new Error("Lorebook not found.")
		if (book.userId !== input.userId)
			throw new Error(
				"Only the lorebook's owner can mark what is common knowledge."
			)
		const E = schema.lorebookEntries
		const own = await tx
			.select({ id: E.id })
			.from(E)
			.where(and(inArray(E.id, ids), eq(E.lorebookId, book.id)))
		if (own.length !== ids.length)
			throw new Error("That entry is not in this lorebook.")
		for (const entryId of ids)
			await setEntryCommonKnowledge(tx, {
				userId: input.userId,
				entryId,
				notCommonKnowledge: input.notCommonKnowledge
			})
		return book.id
	})
	const E = schema.lorebookEntries
	return (
		await db
			.select({ id: E.id })
			.from(E)
			.where(and(eq(E.lorebookId, bookId), eq(E.notCommonKnowledge, true)))
			.orderBy(asc(E.id))
	).map((r) => r.id)
}

/**
 * 🚧 Sets what the hand switch says for one member and one entry: ends the
 * member's live hand ties (`knows` / `kept_from`, undated, on every line),
 * then writes the new one. Play's ties, dated or line-bound ties and ordinary
 * relationships are never touched. The row's owner only.
 */
export async function setHandKnowledgeTie(
	db: Db,
	input: {
		userId: number
		lorebookId: number
		castMemberId: number
		entryId: number
		hand: "knows" | "kept_from" | null
	}
): Promise<void> {
	if (input.hand !== null && input.hand !== "knows" && input.hand !== "kept_from")
		throw new Error("That is not a kind of knowledge.")
	const { findOwnedBook } = await import("$lib/server/utils/ownedBook")
	await db.transaction(async (tx) => {
		const book = await findOwnedBook(tx, input.userId, input.lorebookId)
		if (!book) throw new Error("Lorebook not found.")
		if (book.userId !== input.userId) throw new Error(TIE_REFUSAL)
		const R = schema.narrativeRelationships
		const live = await tx
			.select({ id: R.id })
			.from(R)
			.where(
				and(
					eq(R.lorebookId, book.id),
					eq(R.fromNodeId, input.castMemberId),
					eq(R.toEntryId, input.entryId),
					eq(R.status, "active"),
					inArray(R.knowledgeKind, [...HAND_KINDS]),
					isNull(R.historyEntryId),
					isNull(R.branchId)
				)
			)
			.orderBy(asc(R.id))
		for (const t of live)
			await endKnowledgeTie(tx, { userId: input.userId, tieId: t.id })
		if (input.hand !== null)
			await writeKnowledgeTie(tx, {
				userId: input.userId,
				lorebookId: book.id,
				castMemberId: input.castMemberId,
				entryId: input.entryId,
				kind: input.hand
			})
	})
}

/** 🚧 The id of an active hand tie (`knows` / `kept_from`, undated, on no branch) from one member to one entry in one book, else null. Read-only. The SQL spells `isHandTie`, the definition it must match. */
export async function handTieInBook(
	db: Db,
	input: { lorebookId: number; castMemberId: number; entryId: number }
): Promise<number | null> {
	const R = schema.narrativeRelationships
	const [row] = await db
		.select({ id: R.id })
		.from(R)
		.where(
			and(
				eq(R.lorebookId, input.lorebookId),
				eq(R.fromNodeId, input.castMemberId),
				eq(R.toEntryId, input.entryId),
				eq(R.status, "active"),
				inArray(R.knowledgeKind, [...HAND_KINDS]),
				isNull(R.historyEntryId),
				isNull(R.branchId)
			)
		)
		.orderBy(asc(R.id))
		.limit(1)
	return row?.id ?? null
}

/** The play kinds of knowledge tie: what play writes (the hand kinds are the person's). */
export const PLAY_KINDS = ["was_told", "has_been_there"] as const

/**
 * 🚧 The one predicate for a play tie held in a session's notes that the
 * lorebook may take: a play kind, active, on no branch, not a ruleset's row,
 * whose member and entry are both the lorebook's. Oldest first. Apply's review
 * lists these and Apply drops the superseded ones from the same set.
 */
export async function heldPlayTiesIn(
	db: Db,
	input: { notesId: number; lorebookId: number }
): Promise<Array<typeof schema.narrativeRelationships.$inferSelect>> {
	const R = schema.narrativeRelationships
	const all = await db
		.select()
		.from(R)
		.where(
			and(
				eq(R.lorebookId, input.notesId),
				eq(R.status, "active"),
				isNull(R.branchId),
				isNull(R.rulesRunId),
				inArray(R.knowledgeKind, [...PLAY_KINDS])
			)
		)
		.orderBy(asc(R.id))
	const ends = all.filter((l) => l.fromNodeId != null && l.toEntryId != null)
	if (!ends.length) return []
	const B = schema.lorebookBindings
	const E = schema.lorebookEntries
	const members = new Set(
		(
			await db
				.select({ id: B.id })
				.from(B)
				.where(and(eq(B.lorebookId, input.lorebookId), inArray(B.id, ends.map((l) => l.fromNodeId!))))
		).map((r) => r.id)
	)
	const entries = new Set(
		(
			await db
				.select({ id: E.id })
				.from(E)
				.where(and(eq(E.lorebookId, input.lorebookId), inArray(E.id, ends.map((l) => l.toEntryId!))))
		).map((r) => r.id)
	)
	return ends.filter((l) => members.has(l.fromNodeId!) && entries.has(l.toEntryId!))
}

/**
 * 🚧 Moves one held play tie (`was_told`, `has_been_there`) from a session's
 * notes to the lorebook, the same row and id, on the given line and day
 * (ruled D41, 2026-11-16: "Offer it in Apply"). "A hand tie always wins over
 * what play wrote" (D39): with an active hand tie for the pair in the book the
 * row is deleted (`superseded`); an active twin there (same member, entry, kind,
 * line and day; a resolved one does not count) deletes it too (`twin`). A tie
 * that is gone, not a play kind, or whose member or entry is not the book's
 * is left as it is (`gone`). The book's owner only.
 */
export async function moveKnowledgeTieToBook(
	db: Db,
	input: {
		userId: number
		tieId: number
		lorebookId: number
		branchId: number | null
		historyEntryId: number | null
	}
): Promise<"moved" | "superseded" | "twin" | "gone"> {
	const { findOwnedBook } = await import("$lib/server/utils/ownedBook")
	const book = await findOwnedBook(db, input.userId, input.lorebookId)
	if (!book) throw new Error("Lorebook not found.")
	if (book.userId !== input.userId) throw new Error(TIE_REFUSAL)
	const R = schema.narrativeRelationships
	const [tie] = await db.select().from(R).where(eq(R.id, input.tieId)).limit(1)
	if (
		!tie ||
		tie.status !== "active" ||
		!(PLAY_KINDS as readonly string[]).includes(tie.knowledgeKind ?? "") ||
		tie.fromNodeId == null ||
		tie.toEntryId == null
	)
		return "gone"
	const [member] = await db
		.select({ lorebookId: schema.lorebookBindings.lorebookId })
		.from(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.id, tie.fromNodeId))
		.limit(1)
	const [entry] = await db
		.select({ lorebookId: schema.lorebookEntries.lorebookId })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, tie.toEntryId))
		.limit(1)
	if (member?.lorebookId !== book.id || entry?.lorebookId !== book.id) return "gone"
	const drop = async (why: "superseded" | "twin") => {
		await db.delete(R).where(eq(R.id, tie.id))
		return why
	}
	if ((await handTieInBook(db, { lorebookId: book.id, castMemberId: tie.fromNodeId, entryId: tie.toEntryId })) != null)
		return drop("superseded")
	const [twin] = await db
		.select({ id: R.id })
		.from(R)
		.where(
			and(
				eq(R.lorebookId, book.id),
				eq(R.fromNodeId, tie.fromNodeId),
				eq(R.toEntryId, tie.toEntryId),
				eq(R.knowledgeKind, tie.knowledgeKind!),
				eq(R.status, "active"),
				sql`coalesce(${R.branchId}, 0) = ${input.branchId ?? 0}`,
				sql`coalesce(${R.historyEntryId}, 0) = ${input.historyEntryId ?? 0}`
			)
		)
		.limit(1)
	if (twin) return drop("twin")
	await db
		.update(R)
		.set({ lorebookId: book.id, branchId: input.branchId, historyEntryId: input.historyEntryId })
		.where(eq(R.id, tie.id))
	return "moved"
}

/**
 * 🚧 Deletes every active play-kind tie in a session's notes whose pair has an
 * active hand tie in the lorebook ("A hand tie always wins over what play
 * wrote", D39); returns their ids. The lorebook's owner only.
 */
export async function dropSupersededKnowledgeTies(
	db: Db,
	input: { userId: number; notesId: number; lorebookId: number }
): Promise<number[]> {
	const { findOwnedBook } = await import("$lib/server/utils/ownedBook")
	const book = await findOwnedBook(db, input.userId, input.lorebookId)
	if (!book) throw new Error("Lorebook not found.")
	if (book.userId !== input.userId) throw new Error(TIE_REFUSAL)
	const R = schema.narrativeRelationships
	const held = (await heldPlayTiesIn(db, { notesId: input.notesId, lorebookId: book.id })).map((l) => ({
		id: l.id,
		from: l.fromNodeId,
		to: l.toEntryId
	}))
	const gone: number[] = []
	for (const h of held) {
		if (h.from == null || h.to == null) continue
		if ((await handTieInBook(db, { lorebookId: book.id, castMemberId: h.from, entryId: h.to })) == null) continue
		await db.delete(R).where(eq(R.id, h.id))
		gone.push(h.id)
	}
	return gone
}
