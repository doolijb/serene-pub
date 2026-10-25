/**
 * 🚧 `history-entries` (PLAN-core-widgets W3): core's Chronicle reads where
 * the session stands in its story and what its lorebook has recorded of it.
 * Core's widgets, or a plugin's widget granted `lore` (the askers table,
 * `./askers.ts`). The composer's Lore pane's history half, moved: the same
 * reads it made, through the same events, now answered on request.
 *
 * Composed from what already exists — no server read of its own:
 *
 * - the clock: `sessions:storyClock` (anyone in the session), its own
 *   clock or its line's present, spelled through the book's calendar;
 * - the history: `entries:list` for the history entry type and
 *   `lorebooks:lines` for the line's ancestor chain — both the book
 *   owner's alone, so they are asked only when the server says the viewer
 *   owns the session (a guest reads the clock, and is told whose the rest
 *   is: `ownerOnly`);
 * - the scenes: the page's own scene list (`scenes:list`, this session's);
 * - 🚧 the open scene (live scenes §7): `scenes:openScenes` — its lines so
 *   far and its proposed cast, read fresh on each ask — and the session's
 *   summary mode off the same reply's scene settings.
 *
 * **Now** is the newest dated history entry the session reads on its line
 * up to where it stands (its own clock, else its line's present) — later
 * entries have not happened yet for it. An undated entry is a loose end of
 * the book, not a moment, and is left out.
 */
import { realDateTime } from "$lib/client/utils/realTime.svelte"
import type {
	HistoryEntriesV1,
	HistoryEntryV1,
	HistoryOpenSceneV1,
	HistorySceneV1,
	WidgetRequests
} from "@serene-pub/sdk"
import {
	compareDates,
	formatDate,
	readStoryCalendar,
	type StoryClock,
	type StoryDate
} from "$lib/shared/lorebooks/storyDate"
import {
	lineOf,
	rowsReadingOnLine,
	type LineBranch
} from "$lib/shared/lorebooks/lineReading"
import { extendCountsOf } from "$lib/shared/lorebooks/graphBuildScope"
import {
	ownClockOf,
	storyClockV1,
	storyTimeOf,
	type StoryClockRead
} from "./storyClock"

type Params = WidgetRequests["history-entries"]["params"]

/** A history entry as `entries:list` carries it — as little of it as this reads. */
export interface HistoryRow {
	id: number
	year?: number | null
	month?: number | null
	day?: number | null
	content?: string | null
	branchId?: number | null
}

/** A scene as the page's scene list carries it — as little of it as this reads. */
export interface SceneRow {
	id: number
	sessionId?: number | null
	historyEntryId?: number | null
	name?: string | null
	selectedMessageIds?: number[] | null
	summary?: string | null
	graphed?: boolean | null
	branchId?: number | null
	castResolvedAt?: unknown
	/** 🚧 A live scene's opening message (live scenes §3); null for one captured by selection. */
	openedAtMessageId?: number | null
	/** 🚧 A live scene's closing message; null while it is the open scene (live scenes §7, lane D). */
	closedAtMessageId?: number | null
	/** 🚧 Where its summary stands (`none` · `running` · `review` · `done` · `failed`). */
	summaryStatus?: string | null
	/** 🚧 What its applied summary was written from (`scenes:list`, pr-6s2); null or absent: nothing recorded. */
	loreSources?: Sockets.Scenes.List.SceneLoreSources | null
}

/**
 * 🚧 A scene's summary state as its dot reads it. A live scene's status is the
 * whole answer: `none` with text is a summary out of date after a moved
 * boundary (the divider's *Summary out of date*). A scene captured by
 * selection with text and status `none` holds a summary written before the
 * status existed, and reads `done`. `review` (§15 G8): the run finished and
 * waits for the person's Apply — its text, if any, is the OLD summary.
 */
export function summaryStatusOf(
	s: Pick<SceneRow, "summary" | "summaryStatus" | "openedAtMessageId">
): "none" | "running" | "review" | "done" | "failed" {
	const st = s.summaryStatus
	if (st === "running" || st === "review" || st === "failed" || st === "done") return st
	if (st === "none" && s.openedAtMessageId != null) return "none"
	return s.summary?.trim() ? "done" : "none"
}

/** 🚧 The scene is open: opened at a line and not yet closed. */
export const isOpenScene = (
	s: Pick<SceneRow, "openedAtMessageId" | "closedAtMessageId">
) => s.openedAtMessageId != null && s.closedAtMessageId == null

/**
 * 🚧 A closed scene whose summary has not run, or failed — what *Summarize
 * all (N)* counts. Never one in `review`: its run finished and waits for the
 * person (the server's `scenesToSummarize` skips it too).
 */
export const awaitsSummary = (s: SceneRow) =>
	!isOpenScene(s) && ["none", "failed"].includes(summaryStatusOf(s))

/** What this answer needs of the page. */
export interface HistoryEntriesDeps {
	/** The page's session; null when it has none yet. */
	sessionId(): number | null
	/** One `sessions:storyClock`, settled on ITS reply. */
	readStoryClock: StoryClockRead
	/** The book's history entries (`entries:list`, the owner's). */
	readHistory(lorebookId: number): Promise<HistoryRow[]>
	/** The book's lines (`lorebooks:lines`, the owner's). */
	readLines(lorebookId: number): Promise<LineBranch[]>
	/** This session's scenes, as the page holds them. */
	sceneList(): readonly SceneRow[]
	/** 🚧 The session's own book: read when the clock reading names no lorebook (pr-6 B §B-3). */
	ownBookId?(): number | null
	/** The session's genre captures scenes. */
	opensScenes(): boolean
	/** The page keeps its copy of the session's own clock current. */
	noteStoryClock?(own: StoryClock | null): void
	/** 🚧 …and of its book's calendar, which the conversation spells its dates through (§15 G9). */
	noteStoryCalendar?(calendar: unknown): void
	/**
	 * 🚧 The session's open scenes and its scene settings
	 * (`scenes:openScenes`, live scenes §7) — the *Open scene* card and the
	 * summary mode. Absent: no card, summaries on request.
	 */
	readOpenScenes?(): Promise<Sockets.Scenes.OpenScenes.Response>
}

/** The default and the ceiling of `earlierLimit`. */
export const EARLIER_DEFAULT = 10
export const EARLIER_MAX = 50

const dateOf = (e: HistoryRow): StoryDate | null =>
	typeof e.year === "number"
		? {
				year: e.year,
				month: e.month ?? null,
				day: e.month != null ? (e.day ?? null) : null
			}
		: null

/** An entry's first written line, trimmed and cut; empty when it says nothing. */
export function firstLineOf(
	content: string | null | undefined,
	max = 140
): string {
	const line = (content ?? "")
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l.length > 0)
	if (!line) return ""
	return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/**
 * Where a scene begins in the session: a live scene's opening message, else
 * its first line's id (scenes with neither, last) — the order the
 * conversation colours its scene dividers in too (`sceneSwatches`).
 */
const sceneStart = (s: SceneRow) =>
	typeof s.openedAtMessageId === "number"
		? s.openedAtMessageId
		: s.selectedMessageIds?.length
			? Math.min(...s.selectedMessageIds)
			: Number.POSITIVE_INFINITY

/**
 * 🚧 When the newest line a scene's summary was written from was written, as Chronicle says it: a day and a time in the
 * viewer's zone ("3 Oct, 14:20"); "" when unknown, and Chronicle then draws no line (pr-6s2, I §I-2).
 */
export function throughLabelOf(throughAt: string | null | undefined): string {
	return realDateTime(throughAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
}

/**
 * Everything the Chronicle reads, composed (the module note). Also what
 * `start-history-entry` starts from: `currentRow` and the line.
 */
export async function readChronicle(
	deps: HistoryEntriesDeps,
	earlierLimit: number
): Promise<{
	answer: HistoryEntriesV1
	currentRow: HistoryRow | null
	branchId: number | null
}> {
	const sessionId = deps.sessionId()
	if (sessionId == null)
		throw new Error("this page has no session to read the story of")
	const reading = await deps.readStoryClock({ sessionId })
	if (reading.error) throw new Error(reading.error)
	if (reading.lorebookId === undefined)
		throw new Error("the server did not say where the story stands")
	deps.noteStoryClock?.(ownClockOf(reading))
	deps.noteStoryCalendar?.(reading.calendar ?? null)
	const clock = storyClockV1(reading)
	// 🚧 No shared lorebook: the session's own book (its Session notes, one line) — the clock reading
	// names none (the server's storyClock read does not look at it; its clock reads unset there).
	const own = reading.lorebookId == null ? (deps.ownBookId?.() ?? null) : null
	const lorebookId = reading.lorebookId ?? own
	const branchId = own != null ? null : (reading.branchId ?? null)
	const empty: HistoryEntriesV1 = {
		lorebookId,
		ownerOnly: reading.isOwner !== true,
		clock,
		current: null,
		scenes: [],
		earlier: [],
		earlierTotal: 0,
		ungraphedScenes: 0,
		opensScenes: deps.opensScenes()
	}
	if (lorebookId == null || reading.isOwner !== true)
		return { answer: empty, currentRow: null, branchId }

	const [rows, branches] = await Promise.all([
		deps.readHistory(lorebookId),
		deps.readLines(lorebookId)
	])
	const calendar = readStoryCalendar(reading.calendar ?? null)
	const moment = storyTimeOf(reading.present)
	const onLine = rowsReadingOnLine(
		rows.filter((r) => dateOf(r) !== null),
		lineOf(branchId, branches),
		dateOf,
		moment
	).sort((a, b) => compareDates(dateOf(b)!, dateOf(a)!) || b.id - a.id)

	const scenes = deps
		.sceneList()
		.filter((s) => s.sessionId == null || s.sessionId === sessionId)
	const order = new Map(
		[...scenes]
			.sort((a, b) => sceneStart(a) - sceneStart(b) || a.id - b.id)
			.map((s, i) => [s.id, i])
	)
	const sceneCount = new Map<number, number>()
	for (const s of scenes)
		if (s.historyEntryId != null)
			sceneCount.set(
				s.historyEntryId,
				(sceneCount.get(s.historyEntryId) ?? 0) + 1
			)

	const entryOf = (r: HistoryRow): HistoryEntryV1 => {
		const date = dateOf(r)!
		return {
			id: r.id,
			date: {
				year: date.year,
				...(date.month != null ? { month: date.month } : {}),
				...(date.day != null ? { day: date.day } : {})
			},
			label: formatDate(date, calendar),
			firstLine: firstLineOf(r.content),
			sceneCount: sceneCount.get(r.id) ?? 0
		}
	}
	const currentRow = onLine[0] ?? null
	const counts = extendCountsOf(scenes, { branchId, sessionId })
	const cap = Math.min(EARLIER_MAX, Math.max(0, earlierLimit))

	// 🚧 The open scene on the main lane, read fresh (its line count moves
	// with every line), and the session's summary mode off the same reply.
	const live = deps.readOpenScenes ? await deps.readOpenScenes() : null
	const open = live?.scenes.find((o) => (o.channel ?? "main") === "main") ?? null
	const openScene: HistoryOpenSceneV1 | null = open
		? {
				id: open.id,
				name: open.name?.trim() ? open.name : null,
				channel: open.channel ?? "main",
				since: open.since ?? "",
				lineCount: open.lineCount,
				order: order.get(open.id) ?? order.size,
				cast: open.cast.map((c) => ({ name: c.name, evidence: c.evidence }))
			}
		: null
	const liveLines = new Map(
		(live?.scenes ?? []).map((o) => [o.id, o.lineCount] as const)
	)
	return {
		answer: {
			...empty,
			openScene,
			...(live ? { summaryMode: live.settings.summary } : {}),
			unsummarizedScenes: scenes.filter(awaitsSummary).length,
			current: currentRow ? entryOf(currentRow) : null,
			scenes: currentRow
				? scenes
						.filter((s) => s.historyEntryId === currentRow.id)
						.sort(
							(a, b) =>
								(order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
						)
						.map(
							(s): HistorySceneV1 => ({
								id: s.id,
								name: s.name?.trim() ? s.name : null,
								lineCount:
									liveLines.get(s.id) ??
									s.selectedMessageIds?.length ??
									0,
								order: order.get(s.id) ?? 0,
								summarized: !!s.summary?.trim(),
								graphed: s.graphed === true,
								summaryStatus: summaryStatusOf(s),
								...(s.loreSources
									? {
											loreSources: {
												fromMessageId: s.loreSources.fromMessageId,
												throughMessageId: s.loreSources.throughMessageId,
												throughLabel: throughLabelOf(s.loreSources.throughAt)
											}
										}
									: {})
							})
						)
				: [],
			earlier: onLine.slice(1, 1 + cap).map(entryOf),
			earlierTotal: Math.max(0, onLine.length - 1),
			ungraphedScenes: counts.ready + counts.unsummarized
		},
		currentRow,
		branchId
	}
}

/**
 * Answer one `history-entries` for the page's session. Rejects, in words,
 * with anything a widget could have got wrong and with the server's own
 * refusal.
 */
export async function answerHistoryEntries(
	params: unknown,
	deps: HistoryEntriesDeps
): Promise<HistoryEntriesV1> {
	const p = (params ?? {}) as Partial<Record<keyof Params, unknown>>
	const limit = p.earlierLimit
	if (
		limit !== undefined &&
		!(typeof limit === "number" && Number.isInteger(limit) && limit >= 0)
	)
		throw new Error(
			"history-entries takes an earlierLimit of 0 or more, whole"
		)
	return (
		await readChronicle(
			deps,
			(limit as number | undefined) ?? EARLIER_DEFAULT
		)
	).answer
}
