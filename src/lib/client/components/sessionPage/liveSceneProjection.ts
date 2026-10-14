/**
 * 🚧 Live scenes as the conversation's dossier tells them (PROPOSAL-live-scenes
 * §7, §14 C): the session's scene rows projected to `ConversationSceneV1`
 * (their lane, boundaries, clocks and summary state), whether the viewer may
 * place **scene boundaries**, and which lines a tick selection may not take
 * (a line already in a scene). Pure, so the projection and its tests read one
 * answer.
 */
import { formatChannel, parseChannel, type StoryTime } from "@serene-pub/sdk"
import type {
	ConversationSceneCastV1,
	ConversationSceneV1
} from "@serene-pub/core-catalog/conversation"

/** A scene row as `scenes:list` sends it — the columns this reads. */
export interface LiveSceneRow {
	id: number
	name: string | null
	lorebookId: number
	historyEntryId: number | null
	selectedMessageIds?: number[] | null
	historyEntry?: {
		id: number
		year: number
		month: number | null
		day: number | null
		isCompleted: boolean
		nextEntry?: { id: number; year: number; month: number | null; day: number | null } | null
	} | null
	channel?: string | null
	openedAtMessageId?: number | null
	closedAtMessageId?: number | null
	openedStoryClockYear?: number | null
	openedStoryClockMonth?: number | null
	openedStoryClockDay?: number | null
	openedStoryClockHour?: number | null
	openedStoryClockMinute?: number | null
	closedStoryClockYear?: number | null
	closedStoryClockMonth?: number | null
	closedStoryClockDay?: number | null
	closedStoryClockHour?: number | null
	closedStoryClockMinute?: number | null
	summaryStatus?: string | null
	/** The summary text, when it has one (the divider says *out of date* of a stale one). */
	summary?: string | null
	/** 🚧 Its cast's participants, as `scenes:list` projects them (lane E): book members' ids. */
	participantCharacters?: number[] | null
}

/**
 * 🚧 The page's naming of a scene's cast (lane E): the book members' ids in,
 * the divider's faces out — null when the page cannot name them (a guest's
 * page holds no member list), and the divider falls back to its speakers.
 */
export type SceneCastFaces = (bindingIds: readonly number[]) => ConversationSceneCastV1[] | null

const SUMMARY_STATUSES = new Set(["none", "running", "review", "done", "failed"])

/** A lane, canonically: `main` and `main:1` are one. */
export const laneOfChannel = (channel: unknown): string =>
	formatChannel(parseChannel(channel))

/** A scene's clock at one boundary, or null. */
function clockAt(row: LiveSceneRow, which: "opened" | "closed"): StoryTime | null {
	const r = row as unknown as Record<string, number | null | undefined>
	const year = r[`${which}StoryClockYear`]
	if (typeof year !== "number") return null
	const part = (k: string) => {
		const v = r[`${which}StoryClock${k}`]
		return typeof v === "number" ? v : null
	}
	return { year, month: part("Month"), day: part("Day"), hour: part("Hour"), minute: part("Minute") }
}

/**
 * One scene row as the conversation reads it. 🚧 `castOf` names its cast
 * for the divider's faces (lane E); without it, or when it cannot, the
 * scene carries none.
 */
export function conversationSceneOf(
	row: LiveSceneRow,
	castOf?: SceneCastFaces
): ConversationSceneV1 {
	const live = typeof row.openedAtMessageId === "number"
	const status = row.summaryStatus ?? undefined
	const cast =
		castOf && Array.isArray(row.participantCharacters)
			? castOf(row.participantCharacters)
			: null
	return {
		id: row.id,
		name: row.name ?? null,
		lorebookId: row.lorebookId,
		historyEntryId: row.historyEntryId ?? null,
		selectedMessageIds: row.selectedMessageIds ?? [],
		historyEntry: row.historyEntry
			? {
					id: row.historyEntry.id,
					year: row.historyEntry.year,
					month: row.historyEntry.month,
					day: row.historyEntry.day,
					isCompleted: row.historyEntry.isCompleted,
					nextEntry: row.historyEntry.nextEntry ?? null
				}
			: null,
		channel: laneOfChannel(row.channel),
		openedAtMessageId: live ? row.openedAtMessageId! : null,
		closedAtMessageId: live ? (row.closedAtMessageId ?? null) : null,
		openedAt: clockAt(row, "opened"),
		closedAt: clockAt(row, "closed"),
		...(status && SUMMARY_STATUSES.has(status)
			? { summaryStatus: status as NonNullable<ConversationSceneV1["summaryStatus"]> }
			: {}),
		hasSummary: !!row.summary?.trim(),
		...(cast ? { cast } : {})
	}
}

/**
 * May the viewer place scene boundaries in this session — the server's
 * refusals (`scenes:open`'s), mirrored: the session's owner, a genre that
 * writes scenes, a session reading a lorebook, and lore writes not Off.
 */
export function sceneBoundariesFor(o: {
	isOwner: boolean
	readsLorebook: boolean
	opensScenes: boolean
	loreWritesOff: boolean
}): boolean {
	return o.isOwner && o.readsLorebook && o.opensScenes && !o.loreWritesOff
}

/**
 * The lines a tick selection may not take: the ones the server says a scene
 * captured, and every loaded line inside a live scene's range on its lane —
 * the open scene's included, whose recorded lines are written only when it
 * closes. A line in two scenes is what both paths refuse.
 */
export function capturedLineIds(
	scened: Iterable<number>,
	scenes: readonly LiveSceneRow[],
	messages: readonly { id: number; channel?: string | null }[]
): number[] {
	const out = new Set(scened)
	const live = scenes.filter((s) => typeof s.openedAtMessageId === "number")
	if (!live.length) return [...out]
	for (const m of messages) {
		if (out.has(m.id)) continue
		const lane = laneOfChannel(m.channel)
		for (const s of live) {
			if (laneOfChannel(s.channel) !== lane) continue
			if (m.id < s.openedAtMessageId!) continue
			if (s.closedAtMessageId != null && m.id > s.closedAtMessageId) continue
			out.add(m.id)
			break
		}
	}
	return [...out]
}

/**
 * 🚧 The live scene before `scene` on its lane — the one *Remove boundary*
 * joins it to (lane E) — or null when it is the lane's first.
 */
export function sceneBefore<
	S extends {
		id: number
		channel?: string | null
		openedAtMessageId?: number | null
	}
>(scene: S, scenes: readonly S[]): S | null {
	if (typeof scene.openedAtMessageId !== "number") return null
	const lane = laneOfChannel(scene.channel)
	let best: S | null = null
	for (const s of scenes) {
		if (s.id === scene.id || typeof s.openedAtMessageId !== "number") continue
		if (laneOfChannel(s.channel) !== lane) continue
		if (s.openedAtMessageId >= scene.openedAtMessageId) continue
		if (!best || s.openedAtMessageId > best.openedAtMessageId!) best = s
	}
	return best
}

/**
 * What *Remove boundary* asks, in words (STYLE-GUIDE §6.6: what goes and what
 * stays). 🚧 With a scene before it on its lane (`into`, lane E) the scene
 * **joins** that one: its lines become that scene's, its own summary goes,
 * and the joined scene's summary is out of date. The lane's first scene
 * goes: its lines stay, outside any scene, and the scene — with its
 * summary, when it has one — leaves the lorebook.
 */
export function removeSceneBody(
	scene: { name: string | null; summarized: boolean } | null,
	into: { name: string | null; summarized: boolean } | null = null
): string {
	const name = scene?.name ? `“${scene.name}”` : "This scene"
	if (into) {
		const target = into.name ? `“${into.name}”` : "the scene before it"
		return (
			`${name} joins ${target}: its lines stay in the conversation, now in ${target}. ` +
			(scene?.summarized ? `Its own summary leaves the lorebook. ` : "") +
			(into.summarized
				? `The summary of ${target} is kept, marked out of date.`
				: `${target.charAt(0).toUpperCase()}${target.slice(1)} has no summary yet.`)
		).trim()
	}
	return (
		`${name} stops being a scene: its lines stay in the conversation, outside any scene. ` +
		`The scene leaves the lorebook${scene?.summarized ? ", with its summary" : ""}.`
	)
}
