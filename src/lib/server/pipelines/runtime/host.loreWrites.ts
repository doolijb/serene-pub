/**
 * The host's lorebook writes that hold no run state: a lore link's ends and
 * its write, where a session's lore write lands (its own notes, the attached
 * book, the history day), a line's fork, typed fields checked against the
 * entry type, and the exits line's links.
 *
 * `createHost` hands these what they need; this module imports from no host
 * module but `host.types.ts`.
 */

import { eq, inArray, sql } from "drizzle-orm"
import { MAIN_LINE, rowReadsOnLine } from "$lib/shared/lorebooks/lineReading"
import * as schema from "$lib/server/db/schema"
import { fieldsFindings } from "@serene-pub/sdk"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import {
	assertRelationshipWrite,
	linksOnReadingThatWay,
	LINKED_THAT_WAY,
	type LinkOnReading
} from "$lib/server/utils/relationshipGuards"
import { RELATIONSHIP_TEXT_LIMITS } from "$lib/shared/lorebooks/linkVocabulary"
import type { LineReading } from "$lib/server/state/reading"
import { ownBookOf } from "$lib/server/lorebooks/ownBook"
import { HostScopeError, forPeople } from "./host.types"

/**
 * One end of a lore link, as a spec can hand it over.
 *
 * Three spellings, because three are what a spec actually has: a bare id, the
 * `{ status, ids }` write result an outlet publishes (every `write-result@1`
 * port resolves to the whole result, so `$.save.entryId` IS this), and a
 * `{ id }` row. Anything else is a name, and names are resolved against the
 * book.
 */
const linkEndId = (raw: unknown): number | null => {
	if (typeof raw === "number") return Number.isFinite(raw) ? raw : null
	if (typeof raw === "string")
		return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : null
	if (!raw || typeof raw !== "object") return null
	const o = raw as Record<string, unknown>
	const ids = (o.ids ?? null) as Record<string, unknown> | null
	for (const v of [ids?.entryId, ids?.id, o.entryId, o.id])
		if (typeof v === "number" && Number.isFinite(v)) return v
	return null
}

/**
 * The other end of a lore link — an entry id, or a **name** resolved within
 * this lorebook (L2, 2026-09-17).
 *
 * An end is an entry the session sees (plan A27, `whyUnseen(…, "session")`):
 * on its line at its moment and, as the line's amendments leave it by then,
 * neither archived nor switched Off — what every session reader of the book
 * answers by, the hop that reads links back included. A link to an entry the
 * session does not see would be a link its own story never reads.
 *
 * A name is what lets a link follow a create without holding an id — a later
 * outlet in the same run, or a later run, has only the name to go on. It is
 * found by the rooms' own name rule (`entryNamed`: the name exactly, then a
 * looser spelling with a leading "the" aside, then a key), over the names the
 * session shows — as amended, never a stored title a dated change replaced.
 * It is also the half that can be wrong, and each way is refused with a
 * sentence rather than repaired:
 *
 *  · **Nothing answers to it.** Creating the missing entry here would make a
 *    link outlet a second entry writer, which is the write law again with the
 *    name changed.
 *  · **Two entries answer to it alike.** Picking one would link the wrong
 *    room, and it would do it silently — a duplicate name is the author's to
 *    resolve, and the refusal is what tells them it exists.
 *  · **Only an entry the session does not see answers.** The same sentence as
 *    an id pointing at it.
 *
 * One lorebook, both ends: an edge whose ends live in two books belongs to
 * neither and the row carries one `lorebook_id`, so a cross-book end is
 * refused exactly as the socket handlers refuse one — held again here because
 * a pipeline does not come through them.
 *
 * That holds for every write that lands in the book it reads (the attached
 * lorebook on Full, a session's notes alone). **Two books, one row** is the one
 * exception, and it is a session whose own notes take the write while it reads
 * an attached lorebook (`then`): the row is kept in the notes, and an end may
 * be an entry of either book — an id is found in the notes, else in the
 * lorebook as the session reads it; a name is looked up in the notes first, and
 * only when none answers in the lorebook (a tie refuses within its own book).
 * An id in neither book is refused with its own sentence rather than "Both ends
 * of a link live in one book".
 */
async function resolveLoreLinkEnd(
	tx: Db,
	lorebookId: number,
	raw: unknown,
	where: string,
	/** The session's reading: its line's chain, fork cuts and moment. */
	reading: LineReading,
	/** What the entry is wanted for — the sentences say so (🚧 `update-lore-entry@1` changes one). */
	purpose: "link" | "change" = "link",
	/**
	 * Which entries answer: absent, the book's, on the reading. `update-lore-entry@1`
	 * of a session with an attached lorebook passes what the session reads — the
	 * attached book's, then its own book's (`sessionEntriesAsRead`).
	 */
	readEntries?: (entryIds?: readonly number[]) => Promise<import("$lib/server/state/entriesOnReading").EntryAsRead[]>,
	/**
	 * 🚧 The attached lorebook a session reads beside its own notes (`LoreWriteLine.alsoReads`):
	 * `lorebookId` and `reading` are then the notes'.
	 */
	then?: { lorebookId: number; reading: LineReading }
): Promise<number> {
	const { entriesAsRead, entryNamed } = await import(
		"$lib/server/state/entriesOnReading"
	)
	const read =
		readEntries ??
		((ids?: readonly number[]) => entriesAsRead(tx, lorebookId, reading, "session", null, ids))
	const readThen = then
		? (ids?: readonly number[]) => entriesAsRead(tx, then.lorebookId, then.reading, "session", null, ids)
		: null
	const { unseenSentence } = await import("$lib/shared/lorebooks/placeSight")
	const id = linkEndId(raw)
	if (id !== null) {
		let [row] = await read([id])
		if (!row && readThen) [row] = await readThen([id])
		if (!row)
			throw new HostScopeError(
				then && purpose === "link"
					? // 🚧 Provisional copy: the owner has not seen this sentence.
						`${where}: entry ${id} is not in this session's lorebook or its notes, so there is nothing here to link it to.`
					: purpose === "change"
					? `${where}: entry ${id} is not in this session's lorebook, so it is not this session's to change.`
					: `${where}: entry ${id} is not in this session's lorebook, so there is nothing here to link it to. Both ends of a link live in one book.`
			)
		if (row.unseen)
			throw new HostScopeError(
				`${where}: ${unseenSentence(row.name ? `'${row.name}'` : `entry ${id}`, row.unseen)}`
			)
		return row.entryId
	}
	const name = typeof raw === "string" ? raw.trim() : ""
	if (!name)
		throw new HostScopeError(
			`${where}: there is nothing to ${purpose} — wire an entry id, the write result of the entry that made it, or the name of an entry in this session's lorebook.`
		)
	let hit = entryNamed(name, await read())
	// Only when the notes answer to nothing is the lorebook asked.
	if (hit.kind === "none" && readThen) hit = entryNamed(name, await readThen())
	if (hit.kind === "one") return hit.entryId
	if (hit.kind === "tie") {
		const sentence = `“${name}” is the name of more than one entry in this session's lorebook (${hit.names.map((n) => `'${n}'`).join(", ")}), and picking one would link the wrong one silently. Rename one of them, or wire the entry's id.`
		throw forPeople(new HostScopeError(`${where}: ${sentence}`), sentence)
	}
	if (hit.kind === "unseen")
		throw new HostScopeError(`${where}: ${unseenSentence(`'${hit.name}'`, hit.why)}`)
	throw new HostScopeError(
		purpose === "change"
			? `${where}: no entry in this session's lorebook is called “${name}”, so there is nothing to change.`
			: `${where}: no entry in this session's lorebook is called “${name}”. Write it first — a link outlet never creates the entry it names.`
	)
}

/**
 * One link a spec asked for, taken apart — the SDK's `LoreLinkInput`
 * (`@serene-pub/contracts`), unchecked: every field is whatever arrived, and
 * `writeLoreLink` reads only strings from it.
 */
interface LoreLinkRequest {
	to: unknown
	linkType?: unknown
	reverseLinkType?: unknown
	name?: unknown
	description?: unknown
}

/**
 * The links an outlet was handed: a list of names, ids, or `LoreLinkInput`s
 * (`{ to, linkType?, reverseLinkType?, name?, description? }`, places plan B2).
 * Anything that is not a list is none, and an entry with no `to` is dropped
 * here so the refusal below names the wiring rather than an empty object.
 * ⚠ The retired `label` is not read (no alias): it was the description under
 * a second name.
 */
const loreLinkRequests = (raw: unknown): LoreLinkRequest[] => {
	if (!Array.isArray(raw)) return []
	const out: LoreLinkRequest[] = []
	for (const item of raw) {
		if (item === null || item === undefined) continue
		if (typeof item === "object" && !Array.isArray(item)) {
			const o = item as Record<string, unknown>
			// A `{ to, … }` request, or a bare write result / row, which is
			// itself the other end.
			out.push(
				"to" in o
					? {
							to: o.to,
							linkType: o.linkType,
							reverseLinkType: o.reverseLinkType,
							name: o.name,
							description: o.description
						}
					: { to: o }
			)
		} else out.push({ to: item })
	}
	return out
}

/**
 * The relationship type a row carries when nothing said. Free text in the row
 * and free text here — the app's list is a vocabulary of suggestions, never a
 * constraint, and nothing reads a relationship type semantically (places plan
 * B2): which way a link walks is its `reverse_relationship_type`, and nothing
 * said is one way.
 */
const DEFAULT_LORE_LINK_TYPE = "leads to"

/**
 * A request's text field, trimmed and cut to its `RELATIONSHIP_TEXT_LIMITS`
 * ceiling — a cut, never a refusal, since a model wrote it (as the graph
 * build's apply cuts). Anything that is not a string is empty.
 */
const loreLinkText = (v: unknown, limit: number): string =>
	typeof v === "string" ? v.trim().slice(0, limit).trim() : ""

/** Where a session's lore writes land: its line, as a branch, and its reading. */
interface LoreWriteLine {
	/** Stamped on every row written. Null is main — shared. */
	branchId: number | null
	/**
	 * The dating a dated row written here carries (plan A22): the latest
	 * history entry the session's reading sees (`writeDatingAt`), null when
	 * it sees none. A lore link is dated by it, as a session's stat is.
	 */
	historyEntryId: number | null
	/**
	 * The session's whole reading — its line's chain, fork cuts and moment —
	 * which a lore link's ends are judged on (`resolveLoreLinkEnd`) and asks
	 * whether the session already reads that link.
	 */
	reading: LineReading
	/**
	 * 🚧 Set only on the own-book route of a session that reads an attached
	 * lorebook: the lorebook, and the session's reading of it. Rows are still
	 * written to the own book (`reading` above is the own book's main head); this
	 * is what a match, a bind, a link's end, an Exits line and a history date
	 * look at after the own book (`findLoreMatch`'s `then`).
	 */
	alsoReads?: { lorebookId: number; reading: LineReading }
}

/**
 * The line a session's lore writes land on (finding #0): the session's own
 * `lorebook_branch_id`, validated against its book by `sessionReadingOf` — a
 * stale id reads (and writes) main rather than failing the turn. A write from
 * a session on a branch that stamped nothing landed on main and so on every
 * line.
 */
async function loreWriteLineOf(
	db: Db,
	sessionId: number,
	lorebookId: number
): Promise<LoreWriteLine> {
	const { sessionReadingOf, writeDatingAt } = await import(
		"$lib/server/state/reading"
	)
	const reading = (await sessionReadingOf(db, sessionId)) ?? {
		lorebookId,
		branchId: null,
		moment: null,
		forkedAt: null,
		line: MAIN_LINE
	}
	return {
		branchId: reading.branchId ?? null,
		historyEntryId: (await writeDatingAt(db, reading))?.historyEntryId ?? null,
		reading
	}
}

/**
 * 🚧 (sense-b4) The book a session's lorebook-annex write lands in: the route's
 * own answer (`loreWriteTargetFor`), the attached book or the session's own
 * book by the write setting, as it was before the scenes rule. A lorebook
 * annex is none of the entry, place, history day or link writes, so the rule
 * does not reach it.
 */
async function annexWriteBookOf(
	db: Db,
	sessionId: number,
	anchorMessageId?: number
): Promise<number> {
	const { loreWriteTargetFor } = await import("$lib/server/lorebooks/ownBook")
	return (await loreWriteTargetFor(db, sessionId, { anchorMessageId, fork: false })).lorebookId
}

/**
 * 🚧 Where a session's lore write lands (PLAN-rulesets §26): the attached
 * book on the session's line when the session may write it, else the
 * session's own notes — every row there stamped with the message that wrote it
 * (`loreWriteTargetFor`). Under Full on the owner's own lorebook the write is
 * the lorebook's (`book`), whether or not the session's scenes end by
 * themselves; the notes take it under Review changes and Off, for a book the
 * owner does not own, and for a filing tool's `opts.notes`. On the notes route
 * a session that reads an attached lorebook carries the two-book reading
 * (`alsoReads`). `scenesEndByThemselves` on the result is the session's own
 * answer on every route: a session whose scenes end by themselves settles by
 * scene close, never by `sources`.
 */
async function sessionLoreWriteTo(
	db: Db,
	sessionId: number,
	/** The turn's message (the run's live row), what a notes row anchors to. */
	anchorMessageId?: number,
	/**
	 * 🚧 Into the session's own notes whatever the book allows (lane 2): a
	 * filing tool on *Remember things*' Review — the lore write mode's own
	 * Review, where the person carries a note into their book. Host-internal:
	 * no declared port sets it.
	 */
	opts: { notes?: boolean } = {}
): Promise<{
	route: "book" | "own-book"
	lorebookId: number
	line: LoreWriteLine
	sourceMessageId: number | null
	/** 🚧 Host-internal: the session's scenes end by themselves, on every route. */
	scenesEndByThemselves: boolean
}> {
	const { loreWriteTargetFor, ownBookFor, turnAnchorOf, scenesEndByThemselves } = await import(
		"$lib/server/lorebooks/ownBook"
	)
	const endsByThemselves = await scenesEndByThemselves(db, sessionId)
	const target = opts.notes
		? {
				route: "own-book" as const,
				lorebookId: (await ownBookFor(db, sessionId)).id,
				sourceMessageId: await turnAnchorOf(db, sessionId, anchorMessageId)
			}
		: // Routed only: the line forks inside the write's own transaction
			// (`forkedLoreLine`), after its checks, so a refused write forks nothing.
			await loreWriteTargetFor(db, sessionId, { anchorMessageId, fork: false })
	if (target.route === "book")
		return {
			route: "book",
			lorebookId: target.lorebookId,
			line: await loreWriteLineOf(db, sessionId, target.lorebookId),
			sourceMessageId: null,
			scenesEndByThemselves: endsByThemselves
		}
	// The notes of a session that reads them alone on a line: the write lands
	// where the session reads, dated as an attached book's write is.
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const own = await sessionReadingOf(db, sessionId)
	if (own?.onOwnBook === true && own.branchId != null && own.lorebookId === target.lorebookId)
		return {
			route: "own-book",
			lorebookId: target.lorebookId,
			line: await loreWriteLineOf(db, sessionId, target.lorebookId),
			sourceMessageId: target.sourceMessageId,
			scenesEndByThemselves: endsByThemselves
		}
	// 🚧 A session that reads an attached lorebook carries that reading with the
	// write, and dates a row by the newest history day of the two books.
	// Not for a filing tool's write into the notes (`opts.notes`), unless the session's
	// scenes end by themselves: then every write on the notes route carries it.
	const reads = (!opts.notes || endsByThemselves) && own?.holderBookId != null ? own : null
	const counted = reads ? await ownBookDaysCounted(db, sessionId) : null
	return {
		route: "own-book",
		lorebookId: target.lorebookId,
		line: {
			branchId: null,
			historyEntryId: counted?.dating?.historyEntryId ?? null,
			reading: {
				lorebookId: target.lorebookId,
				branchId: null,
				moment: null,
				forkedAt: null,
				line: MAIN_LINE
			},
			...(reads ? { alsoReads: { lorebookId: reads.lorebookId, reading: reads } } : {})
		},
		sourceMessageId: target.sourceMessageId,
		scenesEndByThemselves: endsByThemselves
	}
}

/**
 * 🚧 The story days a session that reads an attached lorebook counts when its
 * own notes hold history days too: the newest history day of the lorebook and of
 * the notes (the notes' at or before the reading's moment, when it has one).
 * `dating` is the day a row the notes take is dated by — the newest, the
 * lorebook's on equal dates. `now` is the session's story now with the notes'
 * newest day counted: its clock when it has one (`session`, `clock`), else the
 * newer of its line's newest history day and the notes'. Null when the session
 * reads no attached lorebook or has no own book. `writeDatingAt` and
 * `sessionStoryNowOf` are not changed: stat values, the timeline and cast
 * versions date by the lorebook alone.
 */
async function ownBookDaysCounted(
	db: Db,
	sessionId: number
): Promise<{
	dating: import("$lib/server/state/reading").StoryDating | null
	now: import("$lib/server/state/storyTime").StoryNow | null
} | null> {
	const { sessionReadingOf, writeDatingAt } = await import("$lib/server/state/reading")
	const { sessionStoryNowOf, bookCalendarOf } = await import("$lib/server/state/storyTime")
	const { compareDates, formatDate } = await import("$lib/shared/lorebooks/storyDate")
	const reading = await sessionReadingOf(db, sessionId)
	if (!reading || reading.holderBookId == null) return null
	if (reading.timelineOff) return { dating: null, now: null }
	const ownDay = await writeDatingAt(db, {
		lorebookId: reading.holderBookId,
		branchId: null,
		moment: reading.moment,
		forkedAt: null,
		line: MAIN_LINE
	})
	const loreDay = await writeDatingAt(db, reading)
	const dating =
		ownDay && (!loreDay || compareDates(ownDay.date, loreDay.date) > 0) ? ownDay : loreDay
	let now = await sessionStoryNowOf(db, sessionId)
	if (
		ownDay &&
		(!now ||
			(now.from === "history" &&
				compareDates(ownDay.date, { year: now.year, month: now.month ?? null, day: now.day ?? null }) > 0))
	) {
		now = { year: ownDay.date.year, from: "history" }
		if (ownDay.date.month != null) now.month = ownDay.date.month
		if (ownDay.date.day != null) now.day = ownDay.date.day
		const calendar = await bookCalendarOf(db, reading.lorebookId)
		if (calendar) now.label = formatDate(now, calendar)
	}
	return { dating, now }
}

/**
 * 🚧 The session's notes as a write on the `book` route reaches them: the
 * notes' id, the message a notes row anchors to, and the line a row written
 * there carries — main's head, dated by the newest history day of the two
 * books, reading the lorebook beside it (`alsoReads`). Null on the notes
 * route, with no notes, or when the notes are the lorebook. Never makes the
 * notes; call before the write's transaction.
 */
async function notesBesideBook(
	db: Db,
	sessionId: number,
	anchorMessageId: number | undefined,
	target: { route: "book" | "own-book"; lorebookId: number; line: LoreWriteLine }
): Promise<{ lorebookId: number; sourceMessageId: number | null; line: LoreWriteLine } | null> {
	if (target.route !== "book") return null
	const notes = await ownBookOf(db, sessionId)
	if (!notes || notes.id === target.lorebookId) return null
	const { turnAnchorOf } = await import("$lib/server/lorebooks/ownBook")
	return {
		lorebookId: notes.id,
		sourceMessageId: await turnAnchorOf(db, sessionId, anchorMessageId),
		line: {
			branchId: null,
			historyEntryId: (await ownBookDaysCounted(db, sessionId))?.dating?.historyEntryId ?? null,
			reading: {
				lorebookId: notes.id,
				branchId: null,
				moment: null,
				forkedAt: null,
				line: MAIN_LINE
			},
			alsoReads: { lorebookId: target.lorebookId, reading: target.line.reading }
		}
	}
}

/**
 * 🚧 The notes row a link's end answers to, when it answers to exactly one the
 * session sees: an id that is a seen notes row, or a name that `entryNamed`
 * finds once among the notes' rows as the notes' reading reads them. Anything
 * else (no hit, a tie, unseen, an id of the lorebook) is null: not a notes end.
 */
async function notesRowAnswering(
	tx: Db,
	notes: { lorebookId: number; line: LoreWriteLine },
	raw: unknown
): Promise<number | null> {
	const { entriesAsRead, entryNamed } = await import("$lib/server/state/entriesOnReading")
	const read = (ids?: readonly number[]) =>
		entriesAsRead(tx, notes.lorebookId, notes.line.reading, "session", null, ids)
	const id = linkEndId(raw)
	if (id !== null) {
		const [row] = await read([id])
		return row && !row.unseen ? row.entryId : null
	}
	const name = typeof raw === "string" ? raw.trim() : ""
	if (!name) return null
	const hit = entryNamed(name, await read())
	return hit.kind === "one" ? hit.entryId : null
}

/**
 * A history date's month or day with no year is refused with this sentence,
 * ahead of any typed-fields check, so the person reads the cause.
 */
export function refuseYearlessHistoryDate(nodeKey: string, fields: Record<string, unknown>): void {
	if (typeof fields.year === "number") return
	if (typeof fields.month === "number" || typeof fields.day === "number")
		// 🚧 Provisional copy: the owner has not seen this sentence.
		throw new HostScopeError(
			`${nodeKey}: a history date needs a year. Give this write a year in its fields, or leave the date out to use the story's day.`
		)
}

/**
 * 🚧 The date a history write files under: its own `fields` year, else the
 * session's story now (the notes' days counted when `countNotes`); null with
 * neither. A month or day with no year is refused.
 */
async function historyDateOf(
	tx: Db,
	a: {
		nodeKey: string
		sessionId: number
		fields: Record<string, unknown>
		countNotes: boolean
	}
): Promise<{ year: number; month: number | null; day: number | null } | null> {
	const { sessionStoryNowOf, loreWriteDateOf } = await import("$lib/server/state/storyTime")
	const { fields } = a
	const part = (v: unknown) => (typeof v === "number" ? v : null)
	refuseYearlessHistoryDate(a.nodeKey, fields)
	if (typeof fields.year === "number")
		return { year: fields.year, month: part(fields.month), day: part(fields.day) }
	if (!a.countNotes) {
		const written = await loreWriteDateOf(tx, a.sessionId)
		return written.kind === "dated"
			? { year: written.date.year, month: written.date.month ?? null, day: written.date.day ?? null }
			: null
	}
	// 🚧 With the notes in the reading, the default day counts the notes' own
	// history days too.
	const storyNow = (await ownBookDaysCounted(tx, a.sessionId))?.now ?? (await sessionStoryNowOf(tx, a.sessionId))
	return storyNow
		? {
				year: storyNow.year,
				month: storyNow.month ?? null,
				day: storyNow.month != null ? (storyNow.day ?? null) : null
			}
		: null
}

/**
 * 🚧 Whether a history day on the `book` route is the notes' to take: the
 * notes hold a day for that date, or the session's scenes end by themselves
 * and rule C would refuse the day on the line (a pending line fork's own
 * fork date, else `historyDayOwnerRefusal`). Takes the notes' advisory lock
 * (after the lorebook's); call on the write's transaction handle, before the
 * line forks.
 */
async function historyDayInNotes(
	tx: Db,
	a: {
		sessionId: number
		notesId: number
		lorebookId: number
		line: LoreWriteLine
		scenesEndByThemselves: boolean
		date: { year: number; month: number | null; day: number | null }
	}
): Promise<boolean> {
	const { historyEntryOfDate, historyDayOwnerRefusal } = await import(
		"$lib/server/scenes/historyEntryOfDate"
	)
	await tx.execute(sql`select pg_advisory_xact_lock(${a.notesId})`)
	const waiting = await historyEntryOfDate(
		tx,
		{ lorebookId: a.notesId, branchId: null, date: a.date },
		{ create: false }
	)
	if (waiting) return true
	if (!a.scenesEndByThemselves) return false
	const { forkDateOf } = await import("$lib/shared/lorebooks/lineReading")
	const { compareDates, dayOnly } = await import("$lib/shared/lorebooks/storyDate")
	if (await pendingLineFork(tx, a.sessionId, a.lorebookId)) {
		const m = a.line.reading.moment
		const forkDate = forkDateOf({
			id: 0,
			forkYear: m?.year ?? null,
			forkMonth: m?.month ?? null,
			forkDay: m?.day ?? null
		})
		return forkDate === null || compareDates(dayOnly(a.date), forkDate) <= 0
	}
	try {
		return (
			(await historyDayOwnerRefusal(tx, {
				lorebookId: a.lorebookId,
				branchId: a.line.branchId,
				date: a.date
			})) !== null
		)
	} catch (e) {
		// Only a refusal means the line is asked as usual; a database fault passes through unchanged.
		const { BranchRefusal } = await import("$lib/server/state/reading")
		if (e instanceof Error && (e.constructor === Error || e instanceof BranchRefusal)) return false
		throw e
	}
}

/**
 * 🚧 The line a lore write lands on, after the session's first write forked
 * it: call on the write's transaction handle, after the book's lock, before
 * the insert. A session still riding its parent's line forks its own here
 * (`ensureSessionLine`), inside the transaction, so a refusal that rolls the
 * transaction back forks nothing and two first writers cannot both fork. A
 * write to the session's notes (`own-book`) forks nothing: the notes are
 * main, or the line the session already reads them on.
 */
async function forkedLoreLine(
	tx: Db,
	sessionId: number,
	target: { route: "book" | "own-book"; lorebookId: number; line: LoreWriteLine }
): Promise<LoreWriteLine> {
	if (target.route !== "book") return target.line
	const { ensureSessionLine } = await import("$lib/server/lorebooks/sessionLine")
	await ensureSessionLine(tx, sessionId)
	return loreWriteLineOf(tx, sessionId, target.lorebookId)
}

/**
 * The session's own book when it reads an attached lorebook: whose held
 * amendments give that lorebook's entries their names for this session alone
 * (`loadVocabulary`'s `holderBookId`). Undefined with no attached lorebook.
 */
async function holderBookOf(db: Db, sessionId: number): Promise<number | undefined> {
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	return (await sessionReadingOf(db, sessionId))?.holderBookId
}

/**
 * Whether the session's next write to this book forks its own line first
 * (`line_on_first_write`): true only for a write to the attached lorebook
 * (`sessions.lorebook_id`), so a write to the notes never waits on a fork.
 */
async function pendingLineFork(
	db: Db,
	sessionId: number,
	lorebookId: number
): Promise<boolean> {
	const [row] = await db
		.select({
			flag: schema.sessions.lineOnFirstWrite,
			lorebookId: schema.sessions.lorebookId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return !!row?.flag && row.lorebookId === lorebookId
}

/** What `writeLoreLink` did: the row's id, and whether this call made it. */
interface LoreLinkWrite {
	id: number
	/**
	 * The row's own `from` end: the requested `from`, or — when the session
	 * already read the link drawn from the far end (its mirror) — the far end.
	 */
	fromEntryId: number
	/**
	 * False when the session already read the link (the same way, or its
	 * mirror): the id is the standing row's, and nothing was written.
	 */
	written: boolean
	/** 🚧 The book of the row, when it is not the book the write was for (the lorebook's own row, found beside the notes'). */
	lorebookId?: number
}

/** A lore link that shares words with one the session reads, but not all of them. */
const LINKED_IN_PART =
	"The link that stands says only part of what this one asks, and a pipeline never rewords a link. Change it in the lorebook, or ask for what it already says."

/** Why a lore link the session holds is not read: it is ended, or secret. */
const linkNotStanding = (link: LinkOnReading): string =>
	link.visibility === "secret"
		? "That link is secret, and a pipeline never reveals a secret link."
		: `That link is ${link.status}, and a pipeline never reopens a link.`

/**
 * Write one lore link, on the session's line — or find the one that already
 * says it (places plan B2).
 *
 * **Idempotent, as the session reads.** The question is "does this session
 * already read this link?" (`linksOnReadingThatWay`, review round): a
 * relationship with this name (case aside) that the session's reading holds —
 * its own line or one it inherits (main's before the fork), undated or dated
 * at or before its moment — and that says EVERYTHING the request says: the
 * same words read from the same end, both ways when both were asked, or its
 * true mirror drawn from the far end. Its id comes back with `written: false`
 * and nothing is inserted, so a re-run, a swipe or a repeated line in `links`
 * never stacks a room's ways out. The standing row is never rewritten: a
 * pipeline's repeat does not reword a link somebody drew.
 *
 * Refused with a sentence, never answered with a row the request does not
 * match: a row that shares ONE sentence and not the rest (a one-way door
 * where both ways was asked — a second row would say that sentence twice, and
 * no call here can add the way back), and a row that says it all but no
 * longer stands (resolved, broken, secret) — nothing the session reads would
 * state it, and a pipeline does not reopen or reveal it.
 *
 * ⚠ **A found row is not the run's.** The caller must not record it as a
 * `lore_link` artifact the run `created`: an undo of the run would delete a
 * row it never made. (Nothing undoes by artifact today; the rule stands for
 * whatever does. One known gap from B1: 0193 folded stored duplicates keeping
 * the one with the most description, so a pre-B1 row recorded as a run's may
 * now stand in for a hand-drawn twin it absorbed — an undo built later must
 * not delete a relationship by artifact alone.)
 */
async function writeLoreLink(
	tx: Db,
	lorebookId: number,
	fromEntryId: number,
	req: LoreLinkRequest,
	where: string,
	line: LoreWriteLine
): Promise<LoreLinkWrite> {
	const toEntryId = await resolveLoreLinkEnd(
		tx,
		lorebookId,
		req.to,
		where,
		line.reading,
		"link",
		undefined,
		line.alsoReads
	)
	const ends = { fromNodeId: null, fromEntryId, toNodeId: null, toEntryId }
	const linkType =
		loreLinkText(req.linkType, RELATIONSHIP_TEXT_LIMITS.wording) ||
		DEFAULT_LORE_LINK_TYPE
	// Blank is one way — NULL in the row, never an empty wording.
	const reverseLinkType =
		loreLinkText(req.reverseLinkType, RELATIONSHIP_TEXT_LIMITS.wording) ||
		null
	const name = loreLinkText(req.name, RELATIONSHIP_TEXT_LIMITS.name)
	const description = loreLinkText(
		req.description,
		RELATIONSHIP_TEXT_LIMITS.description
	)
	const saying = {
		lorebookId,
		title: name,
		relationshipType: linkType,
		reverseRelationshipType: reverseLinkType
	}
	// The guard the canvas's writes go through (plan B0): never an entry
	// linked to itself — a room whose way out names the room. Judged before
	// the standing-row lookup, so a self-link is refused, never "found".
	await assertRelationshipWrite(tx, { op: "create", ends, where })
	const held = await linksOnReadingThatWay(tx, ends, saying, line.reading, line.alsoReads)
	const whole =
		held.find((link) => link.saysAll && link.standing) ??
		held.find((link) => link.saysAll)
	if (whole?.standing) {
		// 🚧 Standing in either book: the answer names the book of the row.
		const [stands] = line.alsoReads
			? await tx
					.select({ lorebookId: schema.narrativeRelationships.lorebookId })
					.from(schema.narrativeRelationships)
					.where(eq(schema.narrativeRelationships.id, whole.id))
					.limit(1)
			: []
		return {
			id: whole.id,
			fromEntryId: whole.fromEntryId ?? fromEntryId,
			written: false,
			...(stands && stands.lorebookId !== lorebookId ? { lorebookId: stands.lorebookId } : {})
		}
	}
	if (whole) {
		const sentence = `${LINKED_THAT_WAY} ${linkNotStanding(whole)}`
		throw forPeople(new HostScopeError(`${where}: ${sentence}`), sentence)
	}
	if (held.length) {
		const sentence = `${LINKED_THAT_WAY} ${LINKED_IN_PART}`
		throw forPeople(new HostScopeError(`${where}: ${sentence}`), sentence)
	}
	// Inserted on the session's own line at its dating (`writeDatingAt`,
	// plan A22) — a history entry the reading sees, so the row is one the
	// reading holds, and the unique index's exact twin (line and dating are
	// in it) was found above rather than raised here.
	const [row] = await tx
		.insert(schema.narrativeRelationships)
		.values({
			lorebookId,
			// An entry-ended edge: the two CHECK constraints require exactly
			// one of node/entry per side, so both node columns stay null.
			fromNodeId: null,
			toNodeId: null,
			fromEntryId,
			toEntryId,
			relationshipType: linkType,
			reverseRelationshipType: reverseLinkType,
			title: name,
			description,
			// The session's line: a road drawn on a fork is that fork's road.
			branchId: line.branchId,
			// Where the session stands: a road found in Year 7 was not there
			// from the start of the line.
			historyEntryId: line.historyEntryId
		})
		.returning({ id: schema.narrativeRelationships.id })
	return { id: row!.id, fromEntryId, written: true }
}

/**
 * 🚧 An outlet's typed `fields` (Lair rewrite D2, 2026-10-21), checked
 * against the entry type — whole for a new entry, a patch for a change
 * (`partial`: only the keys it names, `null` clears one). Absent or `null`
 * is none. A misfit is refused with every field named (`fieldsFindings`,
 * the SDK's one checker); never coerced, never dropped.
 */
function typedFieldsOf(
	where: string,
	typeId: string,
	raw: unknown,
	opts: { partial: boolean }
): Record<string, unknown> {
	if (raw === undefined || raw === null) return {}
	if (typeof raw !== "object" || Array.isArray(raw))
		throw new HostScopeError(
			`${where}: 'fields' is one object keyed by field — got ${Array.isArray(raw) ? "a list" : typeof raw}.`
		)
	const yearUnset =
		typeId === HISTORY_TYPE_ID &&
		!opts.partial &&
		((raw as Record<string, unknown>).year ?? null) === null
	const findings = fieldsFindings(typeId, raw, { partial: opts.partial }).filter(
		// A new history entry with no year files under the story's day, so a
		// missing year is not a misfit.
		(f) => f.severity !== "warning" && !(yearUnset && f.field === "year")
	)
	if (findings.length)
		throw new HostScopeError(
			`${where}: the fields do not fit ${typeId} — ` +
				findings.map((f) => `${f.message} (${f.fix})`).join("; ") +
				"."
		)
	return raw as Record<string, unknown>
}

/**
 * 🚧 **The Exits line, linked on save** (Lair rewrite D10): the links a new
 * place's `Exits:` line names, written in the entry's own transaction — see
 * the create-lore-entry commit. Only a place: a way out leads to a place.
 * Each signpost (`parseExitsLine`) is found among the places the session
 * reads by the one room rule (`entryNamed`: its longer readings first), and
 * linked one way in the line's words (`leads north to`, or `leads to` with
 * the bearing as the link's name). Skipped, as words: a name nothing or two
 * places answer to, the place itself, a place the requested links already
 * reach. Returns the ids of the rows it made.
 */
async function exitsLineLinks(
	tx: Db,
	at: {
		lorebookId: number
		entryId: number
		typeId: string
		content: string
		/** The links the outlet itself wrote — their far ends are reached already. */
		reached: readonly number[]
		where: string
		line: LoreWriteLine
	}
): Promise<number[]> {
	const { LOCATION_TYPE_ID } = await import("$lib/shared/entries/types")
	if (at.typeId !== LOCATION_TYPE_ID) return []
	const { parseExitsLine } = await import("$lib/shared/lorebooks/exitsLine")
	const signposts = parseExitsLine(at.content)
	if (!signposts.length) return []
	const { entriesAsRead, entryNamed } = await import("$lib/server/state/entriesOnReading")
	const places = await entriesAsRead(tx, at.lorebookId, at.line.reading, "session", [LOCATION_TYPE_ID])
	// 🚧 A session that reads an attached lorebook beside its own notes: a way
	// out the notes' places do not answer to is looked for among the lorebook's.
	const lorePlaces = at.line.alsoReads
		? await entriesAsRead(tx, at.line.alsoReads.lorebookId, at.line.alsoReads.reading, "session", [LOCATION_TYPE_ID])
		: null
	const reached = new Set<number>([at.entryId])
	if (at.reached.length)
		for (const r of await tx
			.select({ to: schema.narrativeRelationships.toEntryId, from: schema.narrativeRelationships.fromEntryId })
			.from(schema.narrativeRelationships)
			.where(inArray(schema.narrativeRelationships.id, [...at.reached])))
			for (const end of [r.to, r.from]) if (typeof end === "number") reached.add(end)
	const made: number[] = []
	for (const signpost of signposts) {
		let place: number | null = null
		let stopped = false
		for (const name of [...signpost.longerNames, signpost.to]) {
			const hit = entryNamed(name, places)
			if (hit.kind === "one") {
				place = hit.entryId
				break
			}
			if (hit.kind !== "none") {
				stopped = true
				break
			}
		}
		if (place === null && !stopped && lorePlaces)
			for (const name of [...signpost.longerNames, signpost.to]) {
				const hit = entryNamed(name, lorePlaces)
				if (hit.kind === "one") {
					place = hit.entryId
					break
				}
				if (hit.kind !== "none") break
			}
		if (place === null || reached.has(place)) continue
		reached.add(place)
		const wrote = await writeLoreLink(
			tx,
			at.lorebookId,
			at.entryId,
			{ to: place, linkType: signpost.wording, ...(signpost.name ? { name: signpost.name } : {}) },
			at.where,
			at.line
		)
		if (wrote.written) made.push(wrote.id)
	}
	return made
}

/**
 * 🚧 `core:outlet/note-entry-knowledge@1`'s commit (kn-4b): one cast member came
 * to know one entry in play, or stops knowing it — a knowledge tie of play's two
 * kinds, written for the session's owner in the lorebook on the session's line
 * (route `book`) or in the session's notes, and imprinted with the reply that
 * wrote it. Never writes, ends or changes a hand tie (`knows`, `kept_from`).
 * One transaction under the target book's lock; the caller has checked the
 * session and `writes.lore`, and read the anchors beforehand.
 */
async function noteEntryKnowledgeWrite(
	db: Db,
	a: {
		sessionId: number
		nodeKey: string
		member: unknown
		entry: unknown
		kind: "was_told" | "has_been_there"
		end: boolean
		target: { route: "book" | "own-book"; lorebookId: number; line: LoreWriteLine }
		notes: { lorebookId: number; line: LoreWriteLine } | null
		/** The imprint anchor of a write into the lorebook (null: a press with no turn files none). */
		anchor: import("$lib/server/lorebooks/imprints").ImprintAnchor | null
		/** The same for a write into the session's notes. */
		notesAnchor: import("$lib/server/lorebooks/imprints").ImprintAnchor | null
	}
): Promise<Record<string, unknown>> {
	const { sessionId, nodeKey, target, notes } = a
	const { resolveCastMember, CastMemberRefusal } = await import("$lib/server/pipelines/runtime/castMember")
	const { writeKnowledgeTie, endKnowledgeTie, knowledgeTiesOfPair, PLAY_KINDS } = await import(
		"$lib/server/lorebooks/entryKnowledge"
	)
	const { imprintMade, imprintField } = await import("$lib/server/lorebooks/imprints")
	/** The two writers' own sentences ("That cast member is not in this lorebook.") are this step's refusals. */
	const writer = async <T>(run: () => Promise<T>): Promise<T> => {
		try {
			return await run()
		} catch (err) {
			if (err instanceof Error && !(err instanceof HostScopeError))
				throw new HostScopeError(`${nodeKey}: ${err.message}`)
			throw err
		}
	}
	try {
		return await db.transaction(async (tx) => {
			await tx.execute(sql`select pg_advisory_xact_lock(${target.lorebookId})`)
			const [session] = await tx
				.select({ userId: schema.sessions.userId })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
				.limit(1)
			if (!session) throw new HostScopeError(`${nodeKey}: session ${sessionId} does not exist`)
			// The session's owner writes — never the member who pressed.
			const ownerId = session.userId

			// The member: a seat ref of a character, any other form, or a cast member id.
			let castMemberId: number
			if (typeof a.member === "string" && a.member.trim().startsWith("character:")) {
				const { seatOf } = await import("$lib/server/sessions/seats")
				const seat = await seatOf(tx, sessionId, a.member.trim())
				if (!seat) throw new CastMemberRefusal(`'${a.member.trim()}' is not seated in this session.`)
				if (seat.castMemberId == null)
					throw new CastMemberRefusal(`'${a.member.trim()}' voices no cast member in this session.`)
				castMemberId = seat.castMemberId
			} else castMemberId = await resolveCastMember(tx, sessionId, a.member)

			// The notes take the tie when the member's binding or the entry exists only there.
			const [binding] = await tx
				.select({ lorebookId: schema.lorebookBindings.lorebookId })
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, castMemberId))
				.limit(1)
			const notesEntry = notes ? await notesRowAnswering(tx, notes, a.entry) : null
			const inNotes =
				target.route === "own-book" ||
				(notes !== null && (notesEntry !== null || binding?.lorebookId === notes.lorebookId))
			const tieBook = inNotes ? (notes?.lorebookId ?? target.lorebookId) : target.lorebookId
			if (inNotes && tieBook !== target.lorebookId)
				await tx.execute(sql`select pg_advisory_xact_lock(${tieBook})`)
			const line =
				inNotes && notes
					? notes.line
					: await forkedLoreLine(tx, sessionId, target)
			const entryId =
				notesEntry !== null
					? notesEntry
					: await resolveLoreLinkEnd(tx, tieBook, a.entry, nodeKey, line.reading, "link", undefined, line.alsoReads)

			const ties = await knowledgeTiesOfPair(tx, { sessionId, castMemberId, entryId })
			const names = async () => {
				const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
				const shown = (await membersAsRead(tx, [castMemberId], { sessionId })).get(castMemberId)?.shownName
				const [entry] = await tx
					.select({ title: schema.lorebookEntries.title })
					.from(schema.lorebookEntries)
					.where(eq(schema.lorebookEntries.id, entryId))
					.limit(1)
				return {
					member: (shown ?? "").trim() || `cast member ${castMemberId}`,
					entry: (entry?.title ?? "").trim() || `entry ${entryId}`
				}
			}
			const hand = ties.find((t) => !(PLAY_KINDS as readonly string[]).includes(t.kind))
			const play = ties.filter((t) => (PLAY_KINDS as readonly string[]).includes(t.kind))
			const notesAnchor = a.notesAnchor
			const anchorOf = (inTheNotes: boolean) => (inTheNotes ? notesAnchor : a.anchor)
			const readsHere = (t: { inNotes: boolean; branchId: number | null }) =>
				t.inNotes || rowReadsOnLine(t, line.alsoReads?.reading.line ?? line.reading.line)

			if (a.end) {
				// Only ties this session may end: its notes, and its own line in the lorebook.
				const mine = play.filter(
					(t) => t.inNotes || (target.route === "book" && t.branchId !== null && t.branchId === line.branchId)
				)
				for (const t of mine) {
					await writer(() => endKnowledgeTie(tx, { userId: ownerId, tieId: t.id }))
					const at = anchorOf(t.inNotes)
					if (at)
						await imprintField(
							tx,
							at,
							{ lorebookId: t.lorebookId, subject: "relationship", subjectId: t.id, field: "status" },
							"active",
							"resolved"
						)
				}
				const stays = play.length - mine.length
				return {
					id: mine[0]?.id ?? null,
					tieId: mine[0]?.id ?? null,
					lorebookId: tieBook,
					route: inNotes ? "own-book" : "book",
					written: mine.length > 0,
					...(stays
						? {
								notes: [
									// 🚧 Provisional copy: the owner has not seen this sentence.
									`${stays} tie(s) noted elsewhere stay: a session ends only the ties on its own line or in its notes.`
								]
							}
						: {})
				}
			}

			if (hand) {
				const n = await names()
				// The tie that stands is not play's: a later step must not take it for one.
				return {
					id: null,
					tieId: null,
					lorebookId: hand.lorebookId,
					route: inNotes ? "own-book" : "book",
					written: false,
					notes: [
						// 🚧 Provisional copy: the owner has not seen this sentence.
						`Not noted: ${hand.kind === "knows" ? "Knows" : "Kept from"} is already set for ${n.member} and ${n.entry}.`
					]
				}
			}

			const standing = play.find((t) => t.kind === a.kind && readsHere(t))
			if (standing)
				return {
					id: standing.id,
					tieId: standing.id,
					lorebookId: standing.lorebookId,
					route: inNotes ? "own-book" : "book",
					written: false
				}

			const tieId = await writer(() => writeKnowledgeTie(tx, {
				userId: ownerId,
				lorebookId: tieBook,
				castMemberId,
				entryId,
				kind: a.kind,
				branchId: line.branchId,
				historyEntryId: line.historyEntryId
			}))
			const at = anchorOf(inNotes)
			if (at) await imprintMade(tx, at, { lorebookId: tieBook, subject: "relationship", subjectId: tieId })
			// 🚧 Provisional copy: the owner has not seen these sentences. What is true of a tie kept in the notes, by where its ends are.
			let keptInNotes: string | null = null
			if (inNotes && (await ownBookOf(tx, sessionId))?.overlayOf != null) {
				const [entryRow] = await tx
					.select({ lorebookId: schema.lorebookEntries.lorebookId })
					.from(schema.lorebookEntries)
					.where(eq(schema.lorebookEntries.id, entryId))
					.limit(1)
				if (binding?.lorebookId === tieBook)
					keptInNotes = `Kept in this session's notes: ${(await names()).member} is in this session's cast only.`
				else if (entryRow?.lorebookId === tieBook || notesEntry !== null) {
					const { entry } = await names()
					keptInNotes = `Kept in this session's notes with ${entry}; it goes to the lorebook when ${entry} is applied.`
				}
				else keptInNotes = "Kept in this session's notes; Apply offers it to the lorebook."
			}
			return {
				id: tieId,
				tieId,
				lorebookId: tieBook,
				route: inNotes ? "own-book" : "book",
				...(keptInNotes ? { notes: [keptInNotes] } : {}),
				written: true
			}
		})
	} catch (err) {
		if (err instanceof CastMemberRefusal) throw new HostScopeError(`${nodeKey}: ${err.message}`)
		throw err
	}
}

export {
	resolveLoreLinkEnd,
	loreLinkRequests,
	type LoreWriteLine,
	annexWriteBookOf,
	sessionLoreWriteTo,
	noteEntryKnowledgeWrite,
	ownBookDaysCounted,
	notesBesideBook,
	notesRowAnswering,
	historyDateOf,
	historyDayInNotes,
	forkedLoreLine,
	holderBookOf,
	pendingLineFork,
	writeLoreLink,
	typedFieldsOf,
	exitsLineLinks
}
