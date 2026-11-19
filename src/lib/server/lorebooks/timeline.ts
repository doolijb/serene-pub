/**
 * 🚧 A lorebook's **Timeline** switch (owner, 2026-11-14): `lorebooks.timeline_enabled`.
 *
 * On, the book keeps time as `docs/lorebook-time.md` describes. Off, the book
 * is read as it stands now (no moment), written undated, no history day is
 * written or compiled, and its story time does not move. Nothing dated is
 * deleted while it is off; switching it on brings every dated row back. Lines
 * are not part of it.
 *
 * **Whose switch governs a session:** its attached lorebook's; a session that
 * reads only its own notes, the notes'. The notes copy their lorebook's switch
 * when they are made and when that switch changes, so the notes' own value
 * decides only for a session whose lorebook is its notes.
 *
 * Every reader asks here (`timelineOf`, `timelineOfBook`, `sessionTimelineOf`,
 * `sessionTimelineSql`); no other module reads the column. `timelineDefaultFor`
 * is also asked here; it reads no column. Leaf module: the
 * schema, drizzle and shared helpers only.
 */
import { eq, sql, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import {
	readStoryCalendar,
	type StoryCalendar
} from "$lib/shared/lorebooks/storyDate"

/**
 * 🚧 The key in `lorebooks.extra_json` that says the one-time `timeline-switch`
 * pass switched this lorebook's Timeline off (the value is the ISO time it did).
 * The Timeline card shows it as the cause (P1). Removed by any save of the
 * switch; never copied by Duplicate.
 */
export const TIMELINE_OFF_BY_PASS_KEY = "timelineOffByPass"

/** `extra_json` without the pass's mark. */
export function withoutTimelinePassMark<T extends Record<string, any> | null | undefined>(
	extraJson: T
): Record<string, any> {
	const { [TIMELINE_OFF_BY_PASS_KEY]: _mark, ...rest } = extraJson ?? {}
	return rest
}

/** 🚧 The sentences a write or a move answers with while the governing book's timeline is off. Provisional copy. */
export const TIMELINE_OFF_SENTENCES = {
	history: "This lorebook has no timeline, so no history is kept.",
	clock: "This lorebook has no timeline, so its story time doesn't move.",
	dated: "This lorebook has no timeline, so nothing dated is written to it."
} as const

/**
 * 🚧 Whether a genre mandates a timeline for its sessions' own notes: it
 * declares `timeline: 'required'`, or does not resolve. A preset may override
 * the genre's default, never this. The one place both cases are named; the
 * preset list and `sessions:create` both ask it.
 */
export function timelineRequiredFor(
	genre: { timeline?: unknown } | null | undefined
): boolean {
	return !genre || genre.timeline === "required"
}

/**
 * 🚧 Whether the notes of a new session whose lorebook is its own notes start
 * with a timeline. In this order: a genre that does not resolve, or that
 * declares `timeline: 'required'`, is on; else the preset's `defaults.timeline`
 * when it is a boolean; else off. Where a genre or preset supports undated
 * play, undated is the default; `keepsTime` does not pick it (it still feeds
 * ruleset fit and the one-time boot pass over existing data, a different
 * question). A preset may override the genre's default, never its mandate.
 * Reads no column; the lorebook's own switch decides afterwards.
 */
export function timelineDefaultFor(
	genre: { timeline?: unknown; keepsTime?: unknown } | null | undefined,
	preset: { defaults?: unknown } | null | undefined
): boolean {
	if (timelineRequiredFor(genre)) return true
	const pinned = (preset?.defaults as { timeline?: unknown } | null | undefined)
		?.timeline
	if (typeof pinned === "boolean") return pinned
	return false
}

/** Whether a lorebook row keeps a timeline. A missing row (or value) reads as on: what every book did before the switch. */
export function timelineOf(
	book: { timelineEnabled: boolean | null } | null | undefined
): boolean {
	return book?.timelineEnabled ?? true
}

/**
 * A lorebook row's switch as a scalar for a query over `lorebooks`: the
 * overlaid lorebook's when the row is a session's notes over one, else its
 * own. Written qualified by hand (see `sessionTimelineSql`); read the value
 * through `timelineOf`.
 */
export function bookTimelineSql(): SQL<boolean> {
	return sql<boolean>`coalesce((select ov.timeline_enabled from lorebooks ov where ov.id = "lorebooks"."overlay_of"), "lorebooks"."timeline_enabled")`
}

/** Whether lorebook `lorebookId` keeps a timeline (notes over a lorebook answer with that lorebook's switch); a book that is not there reads as on. */
export async function timelineOfBook(
	db: Db,
	lorebookId: number
): Promise<boolean> {
	const [row] = await db
		.select({ timelineEnabled: bookTimelineSql() })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	return timelineOf(row)
}

/**
 * The governing book's switch as a scalar for a query over `sessions`: the
 * attached lorebook's, else the session's notes'. NULL when the session has
 * neither; read the value through `timelineOf`.
 */
export function sessionTimelineSql(): SQL<boolean | null> {
	// Written qualified by hand: a one-table select renders drizzle's column
	// references unqualified, and inside these subqueries a bare "id" binds to
	// the inner table.
	return sql<
		boolean | null
	>`(select tl.timeline_enabled from lorebooks tl where tl.id = coalesce("sessions"."lorebook_id", (select tn.id from lorebooks tn where tn.session_id = "sessions"."id" limit 1)))`
}

/** Whether the book that governs session `sessionId` keeps a timeline (see the header); a missing session reads as on. */
export async function sessionTimelineOf(
	db: Db,
	sessionId: number
): Promise<boolean> {
	const [row] = await db
		.select({ timelineEnabled: sessionTimelineSql() })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return timelineOf(row)
}

/** A value as JSON with object keys sorted, so two equal calendars compare equal whatever their key order. */
function stableJson(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`
	if (v && typeof v === "object") {
		const o = v as Record<string, unknown>
		return `{${Object.keys(o)
			.filter((k) => o[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
			.join(",")}}`
	}
	return JSON.stringify(v ?? null)
}

/**
 * **Whether a lorebook holds something dated** — the one test of it (the
 * Timeline pass, `timelinePass.ts`). True when any of these is stored:
 *
 * - a clock on the book, on any of its branches, or on a session reading it
 *   (for a session's notes, the session itself when it reads the notes alone);
 * - a calendar other than `defaultCalendar` (NULL, free-form, for a lorebook;
 *   the calendar a session's notes are born with for notes);
 * - a second line (any branch);
 * - a history entry, dated or not;
 * - any other entry that has a Beginning (a numeric `year` in its `fields`);
 * - a dated entry amendment (`year` set: a held, undated one is a session's
 *   diff, not a dated change), any cast amendment, a cast version with a date
 *   or a history day, a link dated by a history entry, a stat dated by a
 *   history entry of this book;
 * - a cast presence (every one is dated), or a scene stamped with story time.
 *
 * False for a book that is not there.
 */
export async function holdsSomethingDated(
	db: Db,
	lorebookId: number,
	opts: { defaultCalendar?: StoryCalendar | null } = {}
): Promise<boolean> {
	const l = schema.lorebooks
	// Every reference is qualified by hand: a one-table select renders drizzle's
	// column references unqualified, and inside a correlated subquery a bare
	// "id" binds to the inner table.
	const [book] = await db
		.select({
			storyCalendar: l.storyCalendar,
			dated: sql<boolean>`(
				"lorebooks"."story_clock_year" is not null
				or exists (select 1 from lorebook_branches br where br.lorebook_id = "lorebooks"."id")
				or exists (select 1 from sessions se where se.story_clock_year is not null and (se.lorebook_id = "lorebooks"."id" or (se.lorebook_id is null and se.id = "lorebooks"."session_id")))
				or exists (select 1 from lorebook_entries he where he.lorebook_id = "lorebooks"."id" and he.type_id = ${HISTORY_TYPE_ID})
				or exists (select 1 from lorebook_entries be where be.lorebook_id = "lorebooks"."id" and be.type_id <> ${HISTORY_TYPE_ID} and jsonb_typeof(be.fields -> 'year') = 'number')
				or exists (select 1 from entry_amendments ea where ea.lorebook_id = "lorebooks"."id" and ea.year is not null)
				or exists (select 1 from cast_amendments ca where ca.lorebook_id = "lorebooks"."id")
				or exists (select 1 from character_versions cv where cv.lorebook_id = "lorebooks"."id" and (cv.year is not null or cv.history_entry_id is not null))
				or exists (select 1 from narrative_relationships nr where nr.lorebook_id = "lorebooks"."id" and nr.knowledge_kind is null and nr.history_entry_id is not null)
				or exists (select 1 from attribute_values av inner join lorebook_entries ae on ae.id = av.history_entry_id where ae.lorebook_id = "lorebooks"."id")
				or exists (select 1 from cast_presences cp where cp.lorebook_id = "lorebooks"."id")
				or exists (select 1 from scenes sc where sc.lorebook_id = "lorebooks"."id" and (sc.opened_story_clock_year is not null or sc.closed_story_clock_year is not null))
			)`
		})
		.from(l)
		.where(eq(l.id, lorebookId))
		.limit(1)
	if (!book) return false
	if (book.dated) return true
	return (
		stableJson(readStoryCalendar(book.storyCalendar ?? null)) !==
		stableJson(readStoryCalendar(opts.defaultCalendar ?? null))
	)
}

/**
 * 🚧 What switching a lorebook's Timeline off would hide (Book settings'
 * prompt): its dated entry amendments and its cast amendments, its history
 * entries (dated or not), the entries that have a Beginning, its cast presences, and whether the book or any
 * of its lines holds a clock. The same predicates `holdsSomethingDated` uses.
 */
export async function timelineCountsOf(
	db: Db,
	lorebookId: number
): Promise<{
	datedChanges: number
	historyEntries: number
	beginnings: number
	presences: number
	clockSet: boolean
}> {
	const l = schema.lorebooks
	const [row] = await db
		.select({
			datedChanges: sql<number>`(
				(select count(*) from entry_amendments ea where ea.lorebook_id = "lorebooks"."id" and ea.year is not null)
				+ (select count(*) from cast_amendments ca where ca.lorebook_id = "lorebooks"."id")
			)::int`,
			historyEntries: sql<number>`(select count(*) from lorebook_entries he where he.lorebook_id = "lorebooks"."id" and he.type_id = ${HISTORY_TYPE_ID})::int`,
			beginnings: sql<number>`(select count(*) from lorebook_entries be where be.lorebook_id = "lorebooks"."id" and be.type_id <> ${HISTORY_TYPE_ID} and jsonb_typeof(be.fields -> 'year') = 'number')::int`,
			presences: sql<number>`(select count(*) from cast_presences cp where cp.lorebook_id = "lorebooks"."id")::int`,
			clockSet: sql<boolean>`(
				"lorebooks"."story_clock_year" is not null
				or exists (select 1 from lorebook_branches br where br.lorebook_id = "lorebooks"."id" and br.story_clock_year is not null)
			)`
		})
		.from(l)
		.where(eq(l.id, lorebookId))
		.limit(1)
	return {
		datedChanges: row?.datedChanges ?? 0,
		historyEntries: row?.historyEntries ?? 0,
		beginnings: row?.beginnings ?? 0,
		presences: row?.presences ?? 0,
		clockSet: row?.clockSet ?? false
	}
}
