/**
 * 🚧 **Only scenes the speaker was in** — which earlier-scene summaries, and
 * which History days, one cast member's own turn is shown, judged by the
 * scene's stored cast. The param `speakerInCast` of `core:query/earlier-scenes@1`
 * and `core:query/history-entries@1` runs it. (Name provisional.)
 *
 * The rule, for the speaker of the turn (the scope's character, through its
 * seat; else a card-less seat named by the scope):
 * 1. A scene is **in the speaker's cast** when a `scene_characters` row of the
 *    scene names the speaker's cast member with the role participant. A scene
 *    is **kept** for the speaker when it is in its cast, or it is open, or its
 *    cast was never worked out (`scenes.cast_resolved_at` is empty), or its
 *    cast was worked out and holds no participant at all (nobody to leave it
 *    out for). Anything else is left out.
 * 2. **Earlier scenes.** A summary is kept when its scene is kept.
 * 3. **History days.** A day is a History entry with at least one scene of this
 *    session compiled into it (`scenes.history_entry_id`). Every one of those
 *    scenes kept: the day is unchanged, its whole text (scenes other sessions
 *    on a shared lorebook compiled into it are not judged). Some left out: the
 *    day's text is replaced by the summaries of the kept scenes, in story
 *    order from the start, never longer than `REPLACED_DAY_CAP` times the
 *    day's own length (the latest summaries go first; the first is always
 *    kept). None kept, or no kept scene with a usable summary: the day is left
 *    out. A day with none of this session's scenes is never judged.
 * 4. A turn that is not one cast member's reads everything.
 *
 * Where it runs: the history judgement once, in the host's `lorebook_entries`
 * read (`pipelines/runtime/host.read.lorebookEntries.ts`), so every path that
 * reads lore reads the judged day; the earlier-scenes read asks the host for
 * the same judgement (`speaker_in_cast`). Both share one per-run load.
 *
 * What it owns: the judgement over a stored cast. What it does not: who a scene
 * lists (whoever spoke a line in it, minus those their place rules out) is the
 * scene compiler's answer, `utils/sceneCast*.ts`; **firsthand**
 * (`sessions/firsthandFilter.ts`, ⏳) is a separate rule, by who spoke, and
 * stays as it is.
 *
 * Names: the member is named as the session shows it, `membersAsRead(...)
 * .shownName`.
 *
 * Pure core (`speakerInCastViewOf`, `keptScenesInCast`, `historyDaysInCast`,
 * `fitSummaries`, the receipt sentences) and two loaders
 * (`loadSessionSceneCasts`, `loadSpeakerOfRef`), read-only, on the plain `db`:
 * one read of the session's scenes and one of their stored cast, never a query
 * per scene.
 */
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { parseSeatRef, seatOf } from "$lib/server/sessions/seats"
import { sceneStartOf } from "$lib/server/scenes/historyEntryOfDate"

/** A scene row as the judgement reads it. */
export interface SpeakerInCastSceneRow {
	id: number
	opened: number | null
	closed: number | null
	selected: readonly number[] | null
	/** The scene's cast was worked out (`cast_resolved_at` set). */
	castResolved: boolean
	/** 🚧 The cast was worked out and holds no participant row: kept for everyone. */
	castEmpty: boolean
	/** The History entry the scene is compiled into; null: none. */
	historyEntryId: number | null
	summary: string | null
	summaryStatus: string | null
}

export interface SpeakerInCastView {
	/** The cast member whose turn it is. */
	memberId: number
	/** As the session shows the member. */
	name: string
	/** The scenes judged, by id. */
	scenes: Map<number, SpeakerInCastSceneRow>
	/** Scenes whose stored cast lists the member as a participant. */
	inCastSceneIds: Set<number>
}

export type SpeakerInCastRead =
	| { kind: "reads-all" }
	| { kind: "speaker"; view: SpeakerInCastView }

/** The pure assembly of the view from rows already read. */
export function speakerInCastViewOf(input: {
	memberId: number
	name: string
	scenes: readonly SpeakerInCastSceneRow[]
	inCastSceneIds: Iterable<number>
}): SpeakerInCastView {
	return {
		memberId: input.memberId,
		name: input.name,
		scenes: new Map(input.scenes.map((s) => [s.id, s])),
		inCastSceneIds: new Set(input.inCastSceneIds)
	}
}

/** Whether the scene is kept for the speaker (rule 1). A scene the view does not hold is kept. */
function sceneKept(view: SpeakerInCastView, sceneId: number): boolean {
	const scene = view.scenes.get(sceneId)
	if (!scene) return true
	if (view.inCastSceneIds.has(sceneId)) return true
	if (scene.opened !== null && scene.closed === null) return true
	return !scene.castResolved || scene.castEmpty
}

/** The scenes kept (order preserved) and how many were left out. */
export function keptScenesInCast(
	view: SpeakerInCastView,
	sceneIds: readonly number[]
): { keptIds: number[]; leftOut: number } {
	const keptIds = sceneIds.filter((id) => sceneKept(view, id))
	return { keptIds, leftOut: sceneIds.length - keptIds.length }
}

/**
 * What a History day becomes for the speaker (rule 3). `none` carries why:
 * `"none"` the speaker is in the cast of none of its scenes, `"some"` it missed
 * some and no kept scene has a usable summary.
 */
export type HistoryDay =
	| { kind: "whole" }
	| { kind: "scenes"; summaries: string[] }
	| { kind: "none"; why: "none" | "some" }

/** Per History entry id with at least one scene of this session behind it. */
export function historyDaysInCast(
	view: SpeakerInCastView
): Map<number, HistoryDay> {
	const byEntry = new Map<number, SpeakerInCastSceneRow[]>()
	for (const scene of view.scenes.values()) {
		if (scene.historyEntryId === null) continue
		const list = byEntry.get(scene.historyEntryId)
		if (list) list.push(scene)
		else byEntry.set(scene.historyEntryId, [scene])
	}
	const days = new Map<number, HistoryDay>()
	for (const [entryId, scenes] of byEntry) {
		const kept = scenes.filter((s) => sceneKept(view, s.id))
		if (kept.length === scenes.length) {
			days.set(entryId, { kind: "whole" })
			continue
		}
		if (kept.length === 0) {
			days.set(entryId, { kind: "none", why: "none" })
			continue
		}
		const start = (s: SpeakerInCastSceneRow) =>
			sceneStartOf({
				openedAtMessageId: s.opened,
				selectedMessageIds: s.selected ? [...s.selected] : null
			}) ?? Number.MAX_SAFE_INTEGER
		const summaries = kept
			.filter(
				(s) =>
					s.summaryStatus === "done" &&
					(s.summary ?? "").trim() !== ""
			)
			.sort((a, b) => start(a) - start(b) || a.id - b.id)
			.map((s) => s.summary!.trim())
		days.set(
			entryId,
			summaries.length
				? { kind: "scenes", summaries }
				: { kind: "none", why: "some" }
		)
	}
	return days
}

/**
 * 🚧 ★ A replaced History day is never longer than this many times the day's
 * own length, in characters. The host read has no token budget (the lanes
 * publish band intents; the ranker spends the budget later), so the cap is
 * the day's own size, doubled.
 */
export const REPLACED_DAY_CAP = 2

/**
 * 🚧 The kept summaries in story order from the start, joined by a blank line,
 * each added while the joined text stays within `maxChars`; the rest are
 * dropped from the end. The first is always kept whole, even alone over the
 * cap: a day never loses how it began. `cut` is true when any was dropped.
 */
export function fitSummaries(
	summaries: readonly string[],
	maxChars: number
): { text: string; cut: boolean } {
	if (summaries.length === 0) return { text: "", cut: false }
	let text = summaries[0]
	let used = 1
	while (used < summaries.length) {
		const next = `${text}\n\n${summaries[used]}`
		if (next.length > maxChars) break
		text = next
		used++
	}
	return { text, cut: used < summaries.length }
}

const plural = (n: number, one: string, many: string): string =>
	n === 1 ? `1 ${one}` : `${n} ${many}`

/** 🚧 The receipt for the earlier-scenes read. */
export function inCastScenesReceipt(name: string, leftOut: number): string {
	return leftOut === 0
		? `No scene summaries left out: ${name} is in the cast of every one`
		: leftOut === 1
			? `1 scene summary left out: ${name} is not in its cast`
			: `${leftOut} scene summaries left out: ${name} is not in their cast`
}

/**
 * 🚧 ★ The receipt for the history read: days shown as the scenes the speaker
 * was in (`cut` of them cut short), days left out.
 */
export function inCastHistoryReceipt(
	name: string,
	shown: number,
	leftOut: number,
	cut: number
): string {
	if (shown === 0 && leftOut === 0)
		return `No history entries changed for ${name}`
	const parts = [
		...(shown > 0
			? [
					`${plural(shown, "day", "days")} shown as the scenes ${name} was in`
				]
			: []),
		...(cut > 0 ? [`${cut} cut short`] : []),
		...(leftOut > 0 ? [`${leftOut} left out`] : [])
	]
	return `History for ${name}: ${parts.join(", ")}`
}

/** 🚧 What the host's lore read did to its history rows, for the history lane's receipt. */
export type InCastHistory =
	| { kind: "reads-all" }
	| {
			kind: "judged"
			name: string
			shown: number
			cut: number
			leftOut: number
	  }

const IN_CAST_HISTORY = new WeakMap<object, InCastHistory>()

/** 🚧 Records the judgement on the rows the read returns (never on a shared array). */
export function noteInCastHistory(rows: object, note: InCastHistory): void {
	IN_CAST_HISTORY.set(rows, note)
}

/** 🚧 What the read that returned `rows` did; undefined when it did not judge. */
export function inCastHistoryOf(rows: unknown): InCastHistory | undefined {
	return typeof rows === "object" && rows !== null
		? IN_CAST_HISTORY.get(rows)
		: undefined
}

/** 🚧 A session's scenes and who each lists as a participant, read once. */
export interface SessionSceneCasts {
	scenes: SpeakerInCastSceneRow[]
	/** Scene id to the cast member ids it lists as participants; no key: none. */
	participants: Map<number, Set<number>>
}

/**
 * 🚧 The session's scenes (one query) and, only if there are any, every
 * participant row of those scenes (one query). Read-only; never call it from
 * inside a transaction with the outer `db`.
 */
export async function loadSessionSceneCasts(
	db: Db,
	sessionId: number
): Promise<SessionSceneCasts> {
	const s = schema.scenes
	const rows = await db
		.select({
			id: s.id,
			opened: s.openedAtMessageId,
			closed: s.closedAtMessageId,
			selected: s.selectedMessageIds,
			castResolvedAt: s.castResolvedAt,
			historyEntryId: s.historyEntryId,
			summary: s.summary,
			summaryStatus: s.summaryStatus
		})
		.from(s)
		.where(eq(s.sessionId, sessionId))
	const participants = new Map<number, Set<number>>()
	if (rows.length) {
		const cast = await db
			.select({
				sceneId: schema.sceneCharacters.sceneId,
				bindingId: schema.sceneCharacters.bindingId
			})
			.from(schema.sceneCharacters)
			.where(
				and(
					inArray(
						schema.sceneCharacters.sceneId,
						rows.map((r) => r.id)
					),
					eq(schema.sceneCharacters.role, "participant")
				)
			)
		for (const c of cast) {
			const set = participants.get(c.sceneId)
			if (set) set.add(c.bindingId)
			else participants.set(c.sceneId, new Set([c.bindingId]))
		}
	}
	return {
		scenes: rows.map((r) => ({
			id: r.id,
			opened: r.opened,
			closed: r.closed,
			selected: r.selected,
			castResolved: r.castResolvedAt !== null,
			castEmpty: r.castResolvedAt !== null && !participants.has(r.id),
			historyEntryId: r.historyEntryId,
			summary: r.summary,
			summaryStatus: r.summaryStatus
		})),
		participants
	}
}

/**
 * 🚧 The speaker a participant ref names: the cast member and the name as the
 * session shows it. `seated-member:N` is member N; `character:C` is the member
 * of C's seat; no such member: null, and the speaker reads everything.
 */
export async function loadSpeakerOfRef(
	db: Db,
	sessionId: number,
	ref: string
): Promise<{ memberId: number; name: string } | null> {
	const parsed = parseSeatRef(ref)
	let memberId: number | null = null
	if (parsed?.form === "seated-member") memberId = parsed.id
	else if (parsed?.form === "character")
		memberId = (await seatOf(db, sessionId, ref))?.castMemberId ?? null
	if (memberId === null) return null
	const read = await membersAsRead(db, [memberId], { sessionId })
	const name =
		(read.get(memberId)?.shownName ?? "").trim() || "this character"
	return { memberId, name }
}

/** 🚧 The view of one speaker over a session's scenes already read. */
export function speakerInCastReadOf(
	casts: SessionSceneCasts,
	speaker: { memberId: number; name: string } | null
): SpeakerInCastRead {
	if (speaker === null) return { kind: "reads-all" }
	return {
		kind: "speaker",
		view: speakerInCastViewOf({
			memberId: speaker.memberId,
			name: speaker.name,
			scenes: casts.scenes,
			inCastSceneIds: casts.scenes
				.filter((sc) =>
					casts.participants.get(sc.id)?.has(speaker.memberId)
				)
				.map((sc) => sc.id)
		})
	}
}
