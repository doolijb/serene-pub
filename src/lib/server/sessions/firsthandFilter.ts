/**
 * 🚧 **What a character was there for** — which messages of a history read, and
 * which earlier-scene summaries, one cast member's own turn is shown.
 *
 * Unknown content is left out of the prompt; the model is never told what a
 * character does not know. For a reply spoken by one cast member on its own
 * turn (a card's character, or a card-less seat named by the session scope) —
 * 1. **By scene.** A member was there for a scene when it spoke at least once
 *    in it: it is the `cast_member_id` of a live line in the scene's whole
 *    range (never the history window). Hidden, rewound and still-generating
 *    lines do not count. The member's own lines are always kept; a message in
 *    no scene is kept; an open scene is kept for the speaker. **Bench plays no
 *    part.**
 * 2. **By place, when a cast-level slot is named.** A message is kept when
 *    the member's value of that slot in force at the message equals the
 *    speaker's value in force at it (references by `entryId`, words trimmed
 *    and case-folded). Only values set in the session count, on the messages
 *    clock; a value known only from the lorebook's timeline counts as
 *    missing. Where either value is missing rule 1 decides; where both exist
 *    rule 2 decides, both ways. The member's own lines are kept.
 * 3. **Summaries.** A closed scene's summary is kept when the member was
 *    there for (rules 1 and 2) the scene's last live line, or more than half
 *    of its live lines. A scene with no live line is kept when it is open, or
 *    when its stored cast (`scene_characters`, role participant) holds the
 *    member; otherwise it is left out.
 * 4. A turn that is not one cast member's reads everything.
 * 5. **History entries.** An entry is left out when at least one scene of this
 *    session compiled into it (`scenes.history_entry_id`) is one the member
 *    was not there for by rule 3. Scenes of other sessions, scenes whose
 *    session was deleted, and text a person wrote into the entry are not
 *    judged: an entry with none of this session's scenes behind it is kept.
 *
 * Names: the member is named as the session shows it, `membersAsRead(...)
 * .shownName` (the seated member's own name, else its card's).
 *
 * Pure core (`firsthandViewOf`, `wasThereFor`, `keptLineIds`, `keptSceneIds`,
 * `leftOutEntryIds`, the receipt sentences, `historyExclusionReason`) and one
 * loader (`loadFirsthandView`), read-only, on the plain `db`. No query per
 * message and none per scene; one grouped read of the stored cast, only when a
 * closed scene has no live line; one value trail per distinct cast member
 * involved. The pure core does no scan per line: scenes
 * are matched to lines in one pass, and a trail is indexed once and answered
 * by binary search.
 */
import { and, eq, gte, inArray, or } from "drizzle-orm"
import { isSlotLoreRef } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { canonicalChannel } from "$lib/server/messages/channels"
import { liveMessageWhere } from "$lib/server/messages/liveHistory"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { seatOf } from "$lib/server/sessions/seats"
import { statTrailFor, type StatPoint } from "$lib/server/state/statTrail"

/** A live line: its id and its speaker's cast member (null: none). */
export interface FirsthandLine {
	id: number
	castMemberId: number | null
}

export interface FirsthandView {
	/** The cast member whose turn it is. */
	memberId: number
	/** As the session shows the member. */
	name: string
	/** The cast-level slot named, or null. */
	slotId: string | null
	/** False only when the slot was named and the book answered "not tracked". */
	slotTracked: boolean
	/** A live line → the scene that holds it (a range scene wins over a tick selection). */
	sceneOfLine: Map<number, number>
	/** A scene → its live lines, oldest first. */
	sceneLines: Map<number, FirsthandLine[]>
	/** Scenes opened and not closed. */
	openSceneIds: Set<number>
	/** Scenes holding a live line of the member. */
	spokeInSceneIds: Set<number>
	/** Scenes with no live line whose stored cast (`scene_characters`, participant) holds the member. */
	storedCastSceneIds: Set<number>
	/** A History entry → this session's scenes compiled into it, by scene id ascending. */
	scenesOfEntry: Map<number, number[]>
	/** The normalised value of the slot for a member in force at a message, or null. */
	placeAt(castMemberId: number, messageId: number): string | null
}

export type FirsthandRead = { kind: "reads-all" } | { kind: "viewpoint"; view: FirsthandView }

/** A scene row as the assembly reads it. */
export interface FirsthandSceneRow {
	id: number
	channel: string
	/** The message a range scene opened at; null for a tick scene. */
	opened: number | null
	/** The message it closed at; null while open (or for a tick scene). */
	closed: number | null
	/** A tick scene's selected messages. */
	selected: readonly number[] | null
	/** The History entry the scene is compiled into; null or absent: not compiled. */
	historyEntryId?: number | null
}

/** A live message row as the assembly reads it. */
export interface FirsthandLineRow {
	id: number
	channel: string | null
	castMemberId: number | null
}

/** A trail's message points, oldest anchor first; a null anchor sorts before every message. */
interface TrailIndex {
	at: number[]
	key: (string | null)[]
}

function indexTrail(points: readonly StatPoint[]): TrailIndex {
	const message = points
		.filter((p) => p.layer !== "timeline")
		.map((p, order) => ({
			at: (p.anchor as { messageId?: number | null }).messageId ?? Number.NEGATIVE_INFINITY,
			order,
			key: placeKeyOf(p.value)
		}))
		.sort((p, q) => (p.at === q.at ? p.order - q.order : p.at < q.at ? -1 : 1))
	return { at: message.map((p) => p.at), key: message.map((p) => p.key) }
}

/** The key of the newest point anchored at or before `messageId`, or null. */
function keyAt(index: TrailIndex, messageId: number): string | null {
	let lo = 0
	let hi = index.at.length
	while (lo < hi) {
		const mid = (lo + hi) >>> 1
		if (index.at[mid]! <= messageId) lo = mid + 1
		else hi = mid
	}
	return lo === 0 ? null : index.key[lo - 1]!
}

/**
 * The pure assembly of a viewpoint from rows already read. `trails` maps a
 * cast member to its value points; it may be filled after this call and before
 * the first `placeAt`, which indexes each member's trail once. Scenes of one
 * channel do not overlap: a line belongs to the latest-opened range that opened
 * at or before it, when that one still covers it.
 */
export function firsthandViewOf(input: {
	memberId: number
	name: string
	slotId: string | null
	slotTracked: boolean
	scenes: readonly FirsthandSceneRow[]
	lines: readonly FirsthandLineRow[]
	trails: ReadonlyMap<number, readonly StatPoint[]>
	storedCastSceneIds?: ReadonlySet<number>
}): FirsthandView {
	const { memberId, scenes } = input
	const ranges = scenes.filter((s) => s.opened !== null)
	const ticks = scenes.filter((s) => s.opened === null && s.closed === null)

	// Range scenes per channel, by opening message.
	const rangesByChannel = new Map<string, FirsthandSceneRow[]>()
	for (const r of ranges) {
		const list = rangesByChannel.get(r.channel)
		if (list) list.push(r)
		else rangesByChannel.set(r.channel, [r])
	}
	for (const list of rangesByChannel.values()) list.sort((p, q) => p.opened! - q.opened!)
	const rangeOf = (channel: string, id: number): FirsthandSceneRow | null => {
		const list = rangesByChannel.get(channel)
		if (!list) return null
		let lo = 0
		let hi = list.length
		while (lo < hi) {
			const mid = (lo + hi) >>> 1
			if (list[mid]!.opened! <= id) lo = mid + 1
			else hi = mid
		}
		const found = lo === 0 ? null : list[lo - 1]!
		return found && (found.closed === null || id <= found.closed) ? found : null
	}

	// Tick scenes per selected message, in scene order.
	const ticksOfLine = new Map<number, number[]>()
	for (const t of ticks)
		for (const id of t.selected ?? []) {
			const list = ticksOfLine.get(id)
			if (!list) ticksOfLine.set(id, [t.id])
			else if (list[list.length - 1] !== t.id) list.push(t.id)
		}

	const sceneOfLine = new Map<number, number>()
	const sceneLines = new Map<number, FirsthandLine[]>(scenes.map((s) => [s.id, []]))
	const spokeInSceneIds = new Set<number>()
	const put = (sceneId: number, line: FirsthandLine) => {
		sceneLines.get(sceneId)!.push(line)
		if (line.castMemberId === memberId) spokeInSceneIds.add(sceneId)
	}
	const sorted = [...input.lines].sort((a, b) => a.id - b.id)
	for (const row of sorted) {
		const line = { id: row.id, castMemberId: row.castMemberId ?? null }
		const range = rangeOf(canonicalChannel(row.channel), row.id)
		if (range) {
			sceneOfLine.set(row.id, range.id)
			put(range.id, line)
		}
		for (const tickId of ticksOfLine.get(row.id) ?? []) {
			if (!sceneOfLine.has(row.id)) sceneOfLine.set(row.id, tickId)
			put(tickId, line)
		}
	}

	const scenesOfEntry = new Map<number, number[]>()
	for (const s of [...scenes].sort((p, q) => p.id - q.id)) {
		if (s.historyEntryId == null) continue
		const list = scenesOfEntry.get(s.historyEntryId)
		if (list) list.push(s.id)
		else scenesOfEntry.set(s.historyEntryId, [s.id])
	}

	const indexed = new Map<number, TrailIndex>()
	return {
		memberId,
		name: input.name,
		slotId: input.slotId,
		slotTracked: input.slotTracked,
		sceneOfLine,
		sceneLines,
		openSceneIds: new Set(ranges.filter((s) => s.closed === null).map((s) => s.id)),
		spokeInSceneIds,
		storedCastSceneIds: new Set(input.storedCastSceneIds ?? []),
		scenesOfEntry,
		placeAt: (castMemberId, messageId) => {
			let index = indexed.get(castMemberId)
			if (!index) {
				const points = input.trails.get(castMemberId)
				if (!points) return null
				index = indexTrail(points)
				indexed.set(castMemberId, index)
			}
			return keyAt(index, messageId)
		}
	}
}

/** Whether the member was there for one line (rules 1 and 2). */
export function wasThereFor(view: FirsthandView, line: FirsthandLine): boolean {
	if (line.castMemberId === view.memberId) return true
	if (view.slotId !== null && line.castMemberId !== null) {
		const mine = view.placeAt(view.memberId, line.id)
		const theirs = view.placeAt(line.castMemberId, line.id)
		if (mine !== null && theirs !== null) return mine === theirs
	}
	const sceneId = view.sceneOfLine.get(line.id)
	if (sceneId === undefined) return true
	if (view.openSceneIds.has(sceneId)) return true
	return view.spokeInSceneIds.has(sceneId)
}

/** The lines kept (order preserved) and how many were left out. */
export function keptLineIds(
	view: FirsthandView,
	lines: readonly FirsthandLine[]
): { keptIds: number[]; leftOut: number } {
	const keptIds = lines.filter((l) => wasThereFor(view, l)).map((l) => l.id)
	return { keptIds, leftOut: lines.length - keptIds.length }
}

/** The scenes whose summary is kept (order preserved) and how many were left out. */
export function keptSceneIds(
	view: FirsthandView,
	sceneIds: readonly number[]
): { keptIds: number[]; leftOut: number } {
	const keptIds = sceneIds.filter((id) => {
		const lines = view.sceneLines.get(id) ?? []
		if (!lines.length) return view.openSceneIds.has(id) || view.storedCastSceneIds.has(id)
		if (wasThereFor(view, lines[lines.length - 1]!)) return true
		const seen = lines.filter((l) => wasThereFor(view, l)).length
		return seen * 2 > lines.length
	})
	return { keptIds, leftOut: sceneIds.length - keptIds.length }
}

/** The History entries left out (rule 5), ascending id; reuses the summary rule. */
export function leftOutEntryIds(view: FirsthandView): number[] {
	return [...view.scenesOfEntry]
		.filter(([, sceneIds]) => keptSceneIds(view, sceneIds).leftOut > 0)
		.map(([entryId]) => entryId)
		.sort((a, b) => a - b)
}

const untrackedSuffix = (view: FirsthandView): string =>
	view.slotId !== null && !view.slotTracked
		? ` (${view.slotId} is not tracked here, so by scene only)`
		: ""

/** 🚧 The receipt for the history read. */
export function linesReceipt(view: FirsthandView, leftOut: number): string {
	const head =
		leftOut === 0
			? `No messages left out for ${view.name}`
			: `${leftOut === 1 ? "1 message" : `${leftOut} messages`} left out: ${view.name} was not there`
	return head + untrackedSuffix(view)
}

/** 🚧 The receipt for the earlier-scenes read. */
export function scenesReceipt(view: FirsthandView, leftOut: number): string {
	const head =
		leftOut === 0
			? `No scene summaries left out for ${view.name}`
			: `${leftOut === 1 ? "1 scene summary" : `${leftOut} scene summaries`} left out: ${view.name} was not there`
	return head + untrackedSuffix(view)
}

/** 🚧 The receipt for the history-entries read. */
export function historyReceipt(view: FirsthandView, leftOut: number): string {
	const head =
		leftOut === 0
			? `No history entries left out for ${view.name}`
			: leftOut === 1
				? `1 history entry left out: ${view.name} was not there for all of its scenes`
				: `${leftOut} history entries left out: ${view.name} was not there for all of their scenes`
	return head + untrackedSuffix(view)
}

/** 🚧 Why one History entry is left out; published per entry. */
export function historyExclusionReason(view: FirsthandView): string {
	return `${view.name} was not there for all of this history entry's scenes.`
}

/** 🚧 The receipt when the turn is not one cast member's. */
export const readsAllReceipt = (): string => "Reads everything: not one cast member's turn"

/** A slot value as a comparable key; null when it names nothing. */
export function placeKeyOf(value: unknown): string | null {
	if (isSlotLoreRef(value as never)) return `entry:${(value as { entryId: number }).entryId}`
	if (typeof value === "string") {
		const w = value.trim().toLowerCase()
		return w === "" ? null : w
	}
	if (typeof value === "number" || typeof value === "boolean") return String(value)
	return null
}

/**
 * The value in force at `messageId`: the newest session point anchored null or
 * at/before it. Timeline points are ignored; none in force is null.
 */
export function valueInForce(points: readonly StatPoint[], messageId: number): string | null {
	return keyAt(indexTrail(points), messageId)
}

/**
 * Reads the session once and answers for one speaking character.
 * `lineIds` / `sceneIds` are the lines and scene summaries about to be judged;
 * they only bound whose value trails are read (none given: the viewpoint's
 * alone). The member is the card's seated member, or, for a card-less seat's
 * turn (no card id), `castMemberId`. Read-only; never call it from inside a
 * transaction with the outer `db`.
 */
export async function loadFirsthandView(
	db: Db,
	opts: {
		sessionId: number
		characterId: unknown
		castMemberId?: unknown
		slotId?: string | null
		lineIds?: readonly number[]
		sceneIds?: readonly number[]
		/** Also read the value trails of every speaker in a scene compiled into a History entry. */
		judgeHistoryEntries?: boolean
	}
): Promise<FirsthandRead> {
	const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0
	let memberId: number | null = null
	if (isId(opts.characterId)) {
		const seat = await seatOf(db, opts.sessionId, `character:${opts.characterId}`)
		memberId = seat?.castMemberId ?? null
	} else if (isId(opts.castMemberId)) memberId = opts.castMemberId
	if (memberId === null) return { kind: "reads-all" }

	const [session] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, opts.sessionId))
		.limit(1)
	const lorebookId = session?.lorebookId ?? null

	const scenes = await db
		.select({
			id: schema.scenes.id,
			channel: schema.scenes.channel,
			opened: schema.scenes.openedAtMessageId,
			closed: schema.scenes.closedAtMessageId,
			selected: schema.scenes.selectedMessageIds,
			historyEntryId: schema.scenes.historyEntryId
		})
		.from(schema.scenes)
		.where(eq(schema.scenes.sessionId, opts.sessionId))
	const ranges = scenes.filter((s) => s.opened !== null)
	const ticks = scenes.filter((s) => s.opened === null && s.closed === null)
	const tickIds = [...new Set(ticks.flatMap((s) => s.selected ?? []))]
	const judgedLineIds = [...new Set(opts.lineIds ?? [])]

	const slotId = opts.slotId ? opts.slotId : null
	const wantedByTrail = slotId !== null && lorebookId !== null
	const from = ranges.length ? Math.min(...ranges.map((s) => s.opened!)) : null
	const wanted = [
		...(from !== null ? [gte(schema.sessionMessages.id, from)] : []),
		...(tickIds.length ? [inArray(schema.sessionMessages.id, tickIds)] : []),
		...(wantedByTrail && judgedLineIds.length
			? [inArray(schema.sessionMessages.id, judgedLineIds)]
			: [])
	]
	const rows = wanted.length
		? await db
				.select({
					id: schema.sessionMessages.id,
					channel: schema.sessionMessages.channel,
					castMemberId: schema.sessionMessages.castMemberId
				})
				.from(schema.sessionMessages)
				.where(
					and(
						eq(schema.sessionMessages.sessionId, opts.sessionId),
						eq(schema.sessionMessages.isHidden, false),
						eq(schema.sessionMessages.isGenerating, false),
						liveMessageWhere(),
						or(...wanted)
					)
				)
		: []

	const read = await membersAsRead(db, [memberId], { sessionId: opts.sessionId })
	const name = (read.get(memberId)?.shownName ?? "").trim() || "this character"

	// Value trails: one per distinct member involved, only when a slot is named.
	// Filled after the assembly (which tells whose lines the judged scenes hold)
	// and before the first `placeAt`.
	const trails = new Map<number, StatPoint[]>()
	const view = firsthandViewOf({
		memberId,
		name,
		slotId,
		slotTracked: true,
		scenes,
		lines: rows,
		trails
	})
	// A closed scene with no live line is judged by its stored cast: one grouped read.
	const bare = scenes
		.map((s) => s.id)
		.filter((id) => !view.sceneLines.get(id)?.length && !view.openSceneIds.has(id))
	if (bare.length) {
		const cast = await db
			.select({ sceneId: schema.sceneCharacters.sceneId })
			.from(schema.sceneCharacters)
			.where(
				and(
					inArray(schema.sceneCharacters.sceneId, bare),
					eq(schema.sceneCharacters.bindingId, memberId),
					eq(schema.sceneCharacters.role, "participant")
				)
			)
		for (const row of cast) view.storedCastSceneIds.add(row.sceneId)
	}
	if (wantedByTrail) {
		const involved = new Set<number>([memberId])
		const byId = new Map(rows.map((r) => [r.id, r.castMemberId]))
		for (const id of judgedLineIds) {
			const m = byId.get(id)
			if (m != null) involved.add(m)
		}
		for (const sceneId of opts.sceneIds ?? [])
			for (const l of view.sceneLines.get(sceneId) ?? [])
				if (l.castMemberId !== null) involved.add(l.castMemberId)
		if (opts.judgeHistoryEntries)
			for (const sceneIds of view.scenesOfEntry.values())
				for (const sceneId of sceneIds)
					for (const l of view.sceneLines.get(sceneId) ?? [])
						if (l.castMemberId !== null) involved.add(l.castMemberId)
		for (const member of involved) {
			try {
				const trail = await statTrailFor(db, {
					lorebookId: lorebookId!,
					sessionId: opts.sessionId,
					owner: { kind: "cast_member", id: member },
					slotId: slotId!,
					mode: "messages"
				})
				if (!trail.tracked) view.slotTracked = false
				trails.set(member, trail.points)
			} catch {
				// An owner the book does not hold has no value.
			}
		}
	}
	return { kind: "viewpoint", view }
}
