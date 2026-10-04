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
import { isOnLine } from "$lib/shared/lorebooks/lineReading"
import { loadEntryDates, mainCutOf, readingOf, rowsOnReading, type LineReading } from "$lib/server/state/reading"
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
	if (mode !== "timeline" && sessionId !== null && played) {
		const rows = await db
			.select()
			.from(schema.attributeValues)
			.where(
				and(
					eq(schema.attributeValues.sessionId, sessionId),
					eq(schema.attributeValues.ownerKind, played.kind),
					eq(schema.attributeValues.ownerId, played.id),
					eq(schema.attributeValues.slotId, decl.id)
				)
			)
		messages = rows
			.filter((r) => isOnLine(r, reading.line))
			.filter(
				(r) =>
					typeof query.sinceMessageId !== "number" ||
					(r.validFromMessageId !== null && r.validFromMessageId > query.sinceMessageId)
			)
			.sort(
				(a, b) =>
					(a.validFromMessageId ?? -1) - (b.validFromMessageId ?? -1) || a.id - b.id
			)
			.map((r) => ({
				value: (r.value?.v ?? null) as SlotValue,
				layer: "session" as const,
				anchor: { messageId: r.validFromMessageId ?? null },
				provenance: {
					updatedBy: r.updatedBy,
					sessionId,
					messageId: r.validFromMessageId ?? null,
					sceneId: r.sceneId ?? null,
					note: r.note ?? null,
					createdAt: new Date(r.createdAt).toISOString()
				}
			}))
	}

	let points = [...timeline, ...messages]
	if (typeof query.last === "number" && query.last > 0) points = points.slice(-Math.trunc(query.last))
	// A lore reference reads by its title, as `stateFor` names them — read-time only.
	const bags = points.map((p) => ({ value: p.value }) as Record<string, unknown>)
	await nameLoreRefs(db, bags, reading, "book")
	points.forEach((p, i) => (p.value = bags[i].value as SlotValue))
	answer.points = points
	return answer
}
