/**
 * 🚧 The **stat trail**: one stat's values over time, for one owner
 * (`core:query/stat-trail@1`, owner-confirmed 2026-09-27: "stats over time /
 * over cast progression"). Renamed from *stat history* the same day (R1) —
 * module, types, host table `stat_trail` and query pin together.
 *
 * ## Two clocks, and they are kept apart until the merge
 *
 * - **`messages`** — the scope session's own rows for the owner's session
 *   layer (`session`, `session_cast`, `session_location`), in anchor order:
 *   `valid_from_message_id`, then the row id, exactly as `inForce` orders
 *   them. A swiped or regenerated reply's rows are **gone** — the swipe path
 *   retracts them (`retractStateAnchoredTo`) — so nothing a player took back
 *   is ever a point here. A branched session is its own session with its own
 *   copies (`sessions/branch.ts`), so its rows never leak into its parent's
 *   answer or the reverse.
 * - **`timeline`** — the book's durable rows for the owner (`lorebook`,
 *   `cast_member`, `location`) across every session that wrote back, ordered
 *   by the date of the history entry each hangs from under THE comparator
 *   (`compareDates`, one comparator per calendar). A row with no history entry
 *   — an author's value, or a recording made before any capture — has no date
 *   and sorts first: it is "from the beginning", as a null anchor is.
 * - **`both`** — the timeline, then the session's messages. The session is
 *   played at the book's present, after everything the timeline records. A
 *   timeline row this session itself recorded is dropped in `both`: write-back
 *   copies a value the session already holds, and it is already a point.
 *
 * Every read is on the line being read (`isOnLine`: shared, or a line of its chain).
 * The timeline stands at a `LineReading` (`state/reading.ts`, rulings 15 and
 * 16): on a branch, main's dated rows only up to the fork date; at a moment,
 * nothing dated after it. The session's messages are its own and are not cut.
 */

import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { SlotValue } from "@serene-pub/sdk"
import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"
import { isOnLine, MAIN_LINE, type Line } from "$lib/shared/lorebooks/lineReading"
import {
	loadEntryDates,
	mainCutOf,
	readingOf,
	rowsOnReading,
	sessionReadingOf,
	type LineReading
} from "$lib/server/state/reading"
import type { StateOwner } from "$lib/server/state/owners"
import { nameLoreRefs, vocabularyFor } from "$lib/server/state/resolve"
import {
	assertOwnerInBook,
	durableRows,
	lorebookLinks,
	lorebookVocabularyFor,
	trackedSlotNamed,
	type LorebookLinks,
	type LorebookOwnerFilter
} from "$lib/server/state/lorebookState"

export type StatTrailMode = "messages" | "timeline" | "both"
export const STAT_TRAIL_MODES: readonly StatTrailMode[] = ["messages", "timeline", "both"]

/** Where a point sits: a message of the session, or a history entry of the book. */
export type StatPointAnchor =
	| { messageId: number | null }
	| { historyEntryId: number | null; date: StoryDate | null }

/** Who or what wrote a point. */
export interface StatPointProvenance {
	/** `user`, `run:<id>`, `session:<id>` (write-back) — the row's own `updated_by`. */
	updatedBy: string
	/** The session it was written in — for a timeline point, the one that recorded it. */
	sessionId: number | null
	messageId: number | null
	sceneId: number | null
	note: string | null
	createdAt: string
}

export interface StatPoint {
	value: SlotValue
	/** Which clock it came from. */
	layer: "session" | "timeline"
	anchor: StatPointAnchor
	provenance: StatPointProvenance
}

export interface StatTrailQuery {
	lorebookId: number
	/** The scope session; required for `messages`, and for `both` to include any. */
	sessionId?: number
	/** The line (null = main) when `reading` is not given; fork cut on, head. */
	branchId?: number | null
	/** 🚧 Where on the book the timeline is read — wins over `branchId`. */
	reading?: LineReading
	owner: LorebookOwnerFilter
	/** Full slot id or local name. */
	slotId: string
	mode?: StatTrailMode
	/** Keep only the last N points, after every other cut. */
	last?: number
	/** Only message points after this message (exclusive); in `both` the timeline precedes it and is dropped. */
	sinceMessageId?: number
	/** Only timeline points dated on or after this date (inclusive — a date is a period). */
	sinceDate?: StoryDate
}

export interface StatTrail {
	lorebookId: number
	sessionId: number | null
	branchId: number | null
	/** 🚧 The moment the timeline was read at; null is the head. */
	moment: StoryDate | null
	/**
	 * 🚧 Where main was cut for this branch — the earliest fork date along
	 * its parent chain (`mainCutOf`); null when nothing was.
	 */
	forkedAt: StoryDate | null
	owner: LorebookOwnerFilter
	/** The slot's full id, or the name asked for when nothing tracks it. */
	slotId: string
	mode: StatTrailMode
	/** False when neither the book nor the session tracks the slot: no points (fails closed). */
	tracked: boolean
	points: StatPoint[]
}

/** The session-layer owner a durable owner is played as, or null. */
function sessionOwnerOf(
	owner: LorebookOwnerFilter,
	links: LorebookLinks,
	sessionId: number
): StateOwner | null {
	if (owner.kind === "lorebook") return { kind: "session", id: sessionId }
	if (owner.kind === "location") return { kind: "session_location", id: owner.id! }
	const member = links.cast.find((c) => c.castMemberId === owner.id)
	return member?.characterId ? { kind: "session_cast", id: member.characterId } : null
}

const durableOwnerOf = (owner: LorebookOwnerFilter, links: LorebookLinks): StateOwner =>
	owner.kind === "lorebook"
		? { kind: "lorebook", id: links.lorebookId }
		: { kind: owner.kind, id: owner.id! }

/**
 * The **messages** clock on its own: the scope session's rows for one
 * session-layer owner and one slot (its full id), on `line`, in anchor
 * order — `valid_from_message_id`, then the row id, as `inForce` orders
 * them. A swiped reply's rows are already gone (see the header). Values as
 * stored: a lore reference is not named here.
 */
export async function sessionLayerPoints(
	db: Db,
	q: {
		sessionId: number
		owner: StateOwner
		slotId: string
		line: Line
		/** Only points after this message (exclusive). */
		sinceMessageId?: number
	}
): Promise<StatPoint[]> {
	const rows = await db
		.select()
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.sessionId, q.sessionId),
				eq(schema.attributeValues.ownerKind, q.owner.kind),
				eq(schema.attributeValues.ownerId, q.owner.id),
				eq(schema.attributeValues.slotId, q.slotId)
			)
		)
	return rows
		.filter((r) => isOnLine(r, q.line))
		.filter(
			(r) =>
				typeof q.sinceMessageId !== "number" ||
				(r.validFromMessageId !== null && r.validFromMessageId > q.sinceMessageId)
		)
		.sort((a, b) => (a.validFromMessageId ?? -1) - (b.validFromMessageId ?? -1) || a.id - b.id)
		.map((r) => ({
			value: (r.value?.v ?? null) as SlotValue,
			layer: "session" as const,
			anchor: { messageId: r.validFromMessageId ?? null },
			provenance: {
				updatedBy: r.updatedBy,
				sessionId: q.sessionId,
				messageId: r.validFromMessageId ?? null,
				sceneId: r.sceneId ?? null,
				note: r.note ?? null,
				createdAt: new Date(r.createdAt).toISOString()
			}
		}))
}

/** One stat's values over time. See the header. */
export async function statTrailFor(db: Db, query: StatTrailQuery): Promise<StatTrail> {
	const mode: StatTrailMode =
		query.mode && STAT_TRAIL_MODES.includes(query.mode) ? query.mode : "both"
	const reading =
		query.reading ?? (await readingOf(db, query.lorebookId, { branch: query.branchId ?? "main" }))
	const branchId = reading.branchId
	const sessionId = query.sessionId ?? null
	const links = await lorebookLinks(db, query.lorebookId, reading)
	assertOwnerInBook(links, query.owner)

	// Tracked by the book (its world attributes) or by the session reading it.
	const book = await lorebookVocabularyFor(db, links)
	const inSession =
		sessionId !== null && mode !== "timeline"
			? (await vocabularyFor(db, sessionId)).entries.map((e) => e.decl)
			: []
	const decl = trackedSlotNamed(book.decls, query.slotId) ?? trackedSlotNamed(inSession, query.slotId)
	const answer: StatTrail = {
		lorebookId: links.lorebookId,
		sessionId,
		branchId,
		moment: reading.moment,
		// The effective cut — the earliest fork along the chain — not the
		// branch's own fork date, which a fork of a fork can postdate.
		forkedAt: mainCutOf(reading),
		owner: query.owner,
		slotId: decl?.id ?? query.slotId,
		mode,
		tracked: !!decl,
		points: []
	}
	if (!decl || decl.type === "derived") return answer

	let timeline: StatPoint[] = []
	if (mode !== "messages") {
		const owned = (await durableRows(db, [durableOwnerOf(query.owner, links)], [decl.id]))
			.filter((r) => r.ownerKind === durableOwnerOf(query.owner, links).kind)
			.filter((r) => !(mode === "both" && sessionId !== null && r.sourceSessionId === sessionId))
		// The line, the fork cut and the moment: `rowsOnReading`, the one rule.
		const rows = await rowsOnReading(db, owned, reading)
		const dates = await loadEntryDates(
			db,
			reading,
			rows.map((r) => r.historyEntryId).filter((id): id is number => id != null)
		)
		timeline = rows
			.map((r) => {
				const date = r.historyEntryId != null ? (dates.get(r.historyEntryId) ?? null) : null
				return {
					id: r.id,
					date,
					point: {
						value: (r.value?.v ?? null) as SlotValue,
						layer: "timeline" as const,
						anchor: { historyEntryId: r.historyEntryId ?? null, date },
						provenance: {
							updatedBy: r.updatedBy,
							sessionId: r.sourceSessionId ?? null,
							messageId: r.sourceMessageId ?? null,
							sceneId: r.sceneId ?? null,
							note: r.note ?? null,
							createdAt: new Date(r.createdAt).toISOString()
						}
					}
				}
			})
			.sort((a, b) =>
				a.date && b.date
					? compareDates(a.date, b.date) || a.id - b.id
					: a.date
						? 1
						: b.date
							? -1
							: a.id - b.id
			)
			.filter((t) => !query.sinceDate || (t.date !== null && compareDates(t.date, query.sinceDate) >= 0))
			.map((t) => t.point)
		// A message cut in `both`: the whole timeline precedes the session.
		if (mode === "both" && typeof query.sinceMessageId === "number") timeline = []
	}

	let messages: StatPoint[] = []
	const played = sessionId !== null ? sessionOwnerOf(query.owner, links, sessionId) : null
	if (mode !== "timeline" && sessionId !== null && played)
		messages = await sessionLayerPoints(db, {
			sessionId,
			owner: played,
			slotId: decl.id,
			line: reading.line,
			sinceMessageId: query.sinceMessageId
		})

	let points = [...timeline, ...messages]
	if (typeof query.last === "number" && query.last > 0) points = points.slice(-Math.trunc(query.last))
	// A lore reference reads by its title, as `stateFor` names them — read-time only.
	const bags = points.map((p) => ({ value: p.value }) as Record<string, unknown>)
	await nameLoreRefs(db, bags, reading, "book")
	points.forEach((p, i) => (p.value = bags[i].value as SlotValue))
	answer.points = points
	return answer
}

// ── The session's own trail, for a widget (F2) ──────────────────────────────

/**
 * 🚧 One change on a session's stat trail, as core's Stats widget lists it
 * (`stat-trail`, PLAN-core-widgets §3.10, F2 2026-10-11) — the SDK's
 * `StatTrailChangeV1`, made here.
 */
export interface SessionStatChange {
	messageId: number | null
	/** When the row was written, in ms since the epoch. */
	at: number
	/** What the slot read before; null for the first with nothing recorded before it. */
	from: SlotValue | null
	/** What it read after; null is a clear (the read inherits again). */
	to: SlotValue | null
	by: "user" | "model" | "pipeline"
}

export interface SessionStatTrailQuery {
	sessionId: number
	/** A session-layer owner: `session` (its id the session's), `session_cast`, `session_location`. */
	owner: StateOwner
	/** Full slot id or local name. */
	slotId: string
	/** Keep the newest this many (default 20, at most 100). */
	limit?: number
}

export interface SessionStatTrail {
	/** False when the session does not track the slot (or it is derived): no changes. */
	tracked: boolean
	/** Oldest first. */
	changes: SessionStatChange[]
}

export const SESSION_STAT_TRAIL_LIMIT = 20
export const SESSION_STAT_TRAIL_MOST = 100

/**
 * Who wrote a row, in the widget's three words, from its `updated_by`
 * (`StateWriter`): `user` a person's own edit; `run:<id>` a turn's run — what
 * the reply said, or a proposal from it someone accepted — `model`; any
 * other writer (`script:<id>`, a write-back) `pipeline`.
 */
export function statChangeBy(updatedBy: string): SessionStatChange["by"] {
	if (updatedBy === "user") return "user"
	return updatedBy.startsWith("run:") ? "model" : "pipeline"
}

/** The book's durable owner a session-layer owner is played as, or null. */
function durableOwnerFor(
	owner: StateOwner,
	links: LorebookLinks,
	sessionId: number
): LorebookOwnerFilter | null {
	if (owner.kind === "session")
		return owner.id === sessionId ? { kind: "lorebook", id: links.lorebookId } : null
	if (owner.kind === "session_location")
		return links.locations.some((l) => l.entryId === owner.id) ? { kind: "location", id: owner.id } : null
	if (owner.kind === "session_cast") {
		const member = links.cast.find((c) => c.characterId === owner.id)
		return member ? { kind: "cast_member", id: member.castMemberId } : null
	}
	return null
}

/**
 * 🚧 One session-layer owner's stat trail as a widget reads it (F2): the
 * session's own changes to one slot, oldest first, each with what it read
 * before. The same ledger and the same reader as `core:query/stat-trail@1`
 * — `statTrailFor` in `both` when the session reads a book that holds the
 * owner (so the first change's `from` is what the book's timeline last
 * recorded, at the session's reading), else the messages clock alone
 * (`sessionLayerPoints`) on the session's line. Timeline points are never
 * changes here: they are the book's, not this session's. The caller judges
 * who may ask; nothing here reads beyond the session and its book.
 */
export async function sessionStatTrail(
	db: Db,
	query: SessionStatTrailQuery
): Promise<SessionStatTrail> {
	const { sessionId, owner } = query
	if (owner.kind === "session" && owner.id !== sessionId) return { tracked: false, changes: [] }
	const limit =
		typeof query.limit === "number" && Number.isInteger(query.limit) && query.limit > 0
			? Math.min(query.limit, SESSION_STAT_TRAIL_MOST)
			: SESSION_STAT_TRAIL_LIMIT
	const reading = await sessionReadingOf(db, sessionId)
	const links = reading ? await lorebookLinks(db, reading.lorebookId, reading) : null
	const durable = links ? durableOwnerFor(owner, links, sessionId) : null

	let tracked: boolean
	let points: StatPoint[]
	if (reading && durable) {
		const trail = await statTrailFor(db, {
			lorebookId: reading.lorebookId,
			sessionId,
			reading,
			owner: durable,
			slotId: query.slotId,
			mode: "both"
		})
		tracked = trail.tracked
		points = trail.points
	} else {
		const decls = (await vocabularyFor(db, sessionId)).entries.map((e) => e.decl)
		const decl = trackedSlotNamed(decls, query.slotId)
		tracked = !!decl && decl.type !== "derived"
		points = tracked
			? await sessionLayerPoints(db, {
					sessionId,
					owner,
					slotId: decl!.id,
					line: reading?.line ?? MAIN_LINE
				})
			: []
		// A lore reference reads by its title, as the session's own state names it.
		const bags = points.map((p) => ({ value: p.value }) as Record<string, unknown>)
		await nameLoreRefs(db, bags, reading, "session")
		points.forEach((p, i) => (p.value = bags[i].value as SlotValue))
	}

	const changes: SessionStatChange[] = []
	let before: SlotValue | null = null
	for (const point of points) {
		if (point.layer === "session") {
			const at = Date.parse(point.provenance.createdAt)
			changes.push({
				messageId: point.provenance.messageId,
				at: Number.isFinite(at) ? at : 0,
				from: before,
				to: point.value ?? null,
				by: statChangeBy(point.provenance.updatedBy)
			})
		}
		before = point.value ?? null
	}
	return { tracked, changes: changes.slice(-limit) }
}
