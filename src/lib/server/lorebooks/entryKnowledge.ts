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
 * them, and the decision that reads them.
 *
 * **Does not own.** The ties' readers (the graph, ranking, the prompt's ties,
 * lore links, the Timeline, embeddings, ruleset ties: each filters knowledge
 * ties out for itself), the line and moment rules (`lineReading.ts`), the
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
 * 3. Of the ties that read for one entry, the later date wins; at one date the
 *    nearer line (the notes, then the line's own steps in order); then *kept
 *    from*.
 * 4. Left out, for a reply spoken by one cast member on its own turn: a marked
 *    entry the winning tie does not know, and an entry a *kept from* tie wins
 *    for. A narrator, an envoy and a step writing for several characters read
 *    everything.
 *
 * Every function takes its handle; it never statically imports
 * `$lib/server/db`. Inside a transaction, hand the transaction's `tx`.
 * The loader is read-only. The pure core does one pass over the rows.
 */
import { eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { seatOf } from "$lib/server/sessions/seats"
import { historyEntryDate, sessionReadingOf } from "$lib/server/state/reading"
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
}

/** Why an entry is left out: no knowing tie, or a *kept from* tie. */
export type KnowledgeCause = "not-known" | "kept-from"

/** What the judgement leaves out, with the count of each cause. */
export interface KnowledgeJudgement {
	leftOut: Array<{ entryId: number; cause: KnowledgeCause }>
	notKnown: number
	keptFrom: number
}

const isKeptFrom = (row: KnowledgeRowRead) => row.kind === "kept_from"

/**
 * Decides, per marked entry and per entry a *kept from* tie names, whether the
 * speaker's winning tie leaves it out. `ownBookIsReading`: the reading is the
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
	const { line, timelineOff } = input
	const moment = timelineOff ? null : input.moment
	const marked = new Set(input.markedEntryIds)
	const stepIndex = new Map<number | null, number>()
	line.steps.forEach((s, i) => {
		if (!stepIndex.has(s.branchId)) stepIndex.set(s.branchId, i)
	})
	// Nearness: the notes first, then the steps of the line in order.
	const nearness = (row: KnowledgeRowRead, notes: boolean) =>
		notes
			? -1
			: (stepIndex.get(row.branchId ?? null) ?? Number.MAX_SAFE_INTEGER)

	type Win = { row: KnowledgeRowRead; date: StoryDate | null; near: number }
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

/** Whether `a` wins over `b`: later date, nearer line, then *kept from*. */
function beats(
	a: { row: KnowledgeRowRead; date: StoryDate | null; near: number },
	b: { row: KnowledgeRowRead; date: StoryDate | null; near: number }
): boolean {
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

/** 🚧 The reason a left-out entry carries in a candidate's exclusion list. */
export function knowledgeExclusionReason(
	cause: KnowledgeCause,
	name: string
): string {
	return cause === "kept-from"
		? `Kept from ${name}.`
		: `Not known by ${name}.`
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
 * The candidate sources an entry reaches eligibility under. `history` also
 * covers the vector index's `historyEntry` (eligibility aliases it).
 */
export const KNOWLEDGE_SOURCES = [
	"worldLore",
	"characterLore",
	"history"
] as const

/** One exclusion per left-out entry per source. */
export function knowledgeExclusions(
	leftOut: ReadonlyArray<{ entryId: number; cause: KnowledgeCause }>,
	name: string
): Array<{
	source: (typeof KNOWLEDGE_SOURCES)[number]
	id: number
	reason: string
}> {
	return leftOut.flatMap((l) =>
		KNOWLEDGE_SOURCES.map((source) => ({
			source,
			id: l.entryId,
			reason: knowledgeExclusionReason(l.cause, name)
		}))
	)
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
		fields: unknown
		in_notes: boolean
	}>(
		await db.execute(sql`
			SELECT r.id, r.to_entry_id, r.knowledge_kind, r.branch_id, h.fields,
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
		inNotes: r.in_notes === true
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
	return { kind: "judged", name, ...judged }
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
