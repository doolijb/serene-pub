/**
 * 🚧 Live scenes (PROPOSAL-live-scenes §3, §8, §14 B): a scene is **opened**
 * at a message and stays the open scene until it is closed. The run between
 * the two boundaries IS the scene — no selection — so "unbroken" and "one
 * scene per message" hold by construction on its channel.
 *
 * Three deterministic things happen at a boundary, none of them a model:
 *
 * 1. **Filing** (at compile, not at open): a scene opens filed under nothing
 *    (`history_entry_id` null — not yet compiled) and creates no history
 *    entry. Compiling the history entry of its date (`historyEntryOfDate`,
 *    §0-B) files it there; the by-date compile (S-B2) will create that dated
 *    entry when the book has none.
 * 2. **Stamping**: the clock as it stood at each boundary — the boundary
 *    message's own stamp (`session_messages.story_clock_*`), else the
 *    session's story now.
 * 3. **Name and cast**: `Scene N` (N = the session's scenes on the channel
 *    + 1), ` · <place>` when the genre's state names one, ` · <date>` when the
 *    day differs from the previous scene's; the cast proposed by
 *    `sceneCastProposal` (no model) into `scene_characters`, at open and at
 *    close.
 *
 * `selectedMessageIds` is a **derived cache** this round: written at close
 * from the range (the channel's visible story lines, less any another scene
 * already captured), so every reader that still reads the list — process,
 * sceneMentions, parity — keeps working.
 *
 * Everything here is the owner's: a session's scene is a session writing its
 * book, refused by the genre's declared writes and by lore writes Off, as
 * `scenes:create` is.
 */
import type { EventCause } from "@serene-pub/sdk"
import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { canonicalChannel } from "$lib/server/messages/channels"
import { liveMessageWhere } from "$lib/server/messages/store"
import { notAFailedReplySql } from "$lib/server/messages/failedReply"
import {
	loreWritesOffRefusal,
	sceneWriteRefusal
} from "$lib/server/messages/writes"
import {
	bookCalendarOf,
	clockOf,
	clockOfNow,
	lockBookCalendar,
	sessionStoryNowOf
} from "$lib/server/state/storyTime"
import {
	compareDates,
	formatDate,
	type StoryClock,
	type StoryDate
} from "$lib/shared/lorebooks/storyDate"
import { sceneStartOf } from "./historyEntryOfDate"
import { BranchRefusal, lineOfBook } from "$lib/server/state/reading"
import {
	writeSceneCast,
	readSceneCast,
	type SceneCast,
	type SceneCastRedline
} from "$lib/server/utils/sceneCast"
import {
	proposeSceneCast,
	evidenceWords,
	quotedRanges,
	renderEvidence,
	type CastTurn
} from "$lib/server/utils/sceneCastProposal"
import { resolveOrCreateBinding } from "$lib/server/utils/characterBindingSync"
import {
	parseEntityKey,
	EMPTY_GAZETTEER,
	type Gazetteer
} from "$lib/server/pipelines/ranking/entities"
import { castMemberCards } from "$lib/server/utils/castMemberCards"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"
import {
	RUN_LOCK_SENTENCES,
	sceneLockedAgainstRuns
} from "$lib/shared/lorebooks/runLocks"
import { resolvePersonaName } from "$lib/shared/utils/resolveCharacterName"
import { cardsAsSeatsRead, seatCardsAsRead } from "$lib/server/pipelines/prompt/seatCards"

/** A refusal worded for the person who asked. */
export class SceneBoundaryRefusal extends Error {}

type SceneRow = typeof schema.scenes.$inferSelect

/** One listed participant, with the evidence the review shows. */
export interface ProposedSceneCastMember {
	key: string
	name: string
	evidenceLabel: string
	/** The book's member it was written as; null when no member resolved (not written). */
	bindingId: number | null
}

export interface LiveSceneResult {
	scene: SceneRow
	sessionId: number
	/** The scene an open closed first, when one was open on the channel. */
	closedScene?: SceneRow
	castProposal?: ProposedSceneCastMember[]
}

/** What a merge did: the scene that took the range, and the one that went. */
export interface MergedSceneResult extends LiveSceneResult {
	/** The later scene, removed — its summary with it. */
	removedSceneId: number
}

// ── clocks ──────────────────────────────────────────────────────────────────

const MESSAGE_CLOCK = {
	storyClockYear: schema.sessionMessages.storyClockYear,
	storyClockMonth: schema.sessionMessages.storyClockMonth,
	storyClockDay: schema.sessionMessages.storyClockDay,
	storyClockHour: schema.sessionMessages.storyClockHour,
	storyClockMinute: schema.sessionMessages.storyClockMinute
} as const

function prefixed(
	prefix: "opened" | "closed",
	clock: StoryClock | null
): Partial<typeof schema.scenes.$inferInsert> {
	const c = clock
	const month = c?.month ?? null
	const hour = c?.hour ?? null
	const cols = {
		Year: c?.year ?? null,
		Month: month,
		Day: month != null ? (c?.day ?? null) : null,
		Hour: hour,
		Minute: hour != null ? (c?.minute ?? 0) : null
	}
	return Object.fromEntries(
		Object.entries(cols).map(([k, v]) => [`${prefix}StoryClock${k}`, v])
	) as Partial<typeof schema.scenes.$inferInsert>
}

/** A scene's clock at one boundary, or null. */
export function sceneClockOf(
	scene: SceneRow,
	which: "opened" | "closed"
): StoryClock | null {
	const s = scene as unknown as Record<string, number | null>
	const year = s[`${which}StoryClockYear`]
	if (year == null) return null
	return {
		year,
		month: s[`${which}StoryClockMonth`],
		day: s[`${which}StoryClockDay`],
		hour: s[`${which}StoryClockHour`],
		minute: s[`${which}StoryClockMinute`]
	}
}

/** The session's story now as a clock, or null. */
async function sessionClock(db: Db, sessionId: number): Promise<StoryClock | null> {
	const now = await sessionStoryNowOf(db, sessionId)
	return now ? clockOfNow(now) : null
}

const dayOf = (c: StoryClock): StoryDate => ({
	year: c.year,
	month: c.month ?? null,
	day: c.month != null ? (c.day ?? null) : null
})

const sameDay = (a: StoryClock | null, b: StoryClock | null) =>
	!!a && !!b && compareDates(dayOf(a), dayOf(b)) === 0

// ── rows ────────────────────────────────────────────────────────────────────

/** The session row, refused unless `userId` owns it. */
async function ownedSession(db: Db, sessionId: number, userId: number) {
	const [session] = await db
		.select({
			id: schema.sessions.id,
			userId: schema.sessions.userId,
			lorebookId: schema.sessions.lorebookId,
			lorebookBranchId: schema.sessions.lorebookBranchId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session || session.userId !== userId)
		throw new SceneBoundaryRefusal("Session not found or access denied.")
	return session
}

/** The refusals every boundary write shares (`scenes:create`'s). */
async function assertSessionMayWriteScenes(db: Db, sessionId: number) {
	const noScenes = await sceneWriteRefusal(db, sessionId)
	if (noScenes) throw new SceneBoundaryRefusal(noScenes)
	const off = await loreWritesOffRefusal(db, sessionId)
	if (off) throw new SceneBoundaryRefusal(off)
}

/** One message of the session on the channel, with its stamp, or a refusal. */
async function boundaryMessage(
	db: Db,
	sessionId: number,
	channel: string,
	messageId: number
) {
	const [row] = await db
		.select({
			id: schema.sessionMessages.id,
			channel: schema.sessionMessages.channel,
			...MESSAGE_CLOCK
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.id, messageId),
				eq(schema.sessionMessages.sessionId, sessionId)
			)
		)
		.limit(1)
	if (!row) throw new SceneBoundaryRefusal("That message is not in this session.")
	if (canonicalChannel(row.channel) !== channel)
		throw new SceneBoundaryRefusal(
			"That message is on another channel, so it cannot bound this scene."
		)
	return row
}

/**
 * The scene's story lines: one lane, by id, from `from` to `to` (open-ended
 * when null). Hidden lines and failed replies (`notAFailedReplySql`: nobody
 * said them) are left out — the transcript a summary reads.
 */
export async function storyLinesInRange(
	db: Db,
	sessionId: number,
	channel: string,
	from: number,
	to: number | null
) {
	return db
		.select({
			id: schema.sessionMessages.id,
			content: schema.sessionMessages.content,
			role: schema.sessionMessages.role,
			characterId: schema.sessionMessages.characterId,
			personaId: schema.sessionMessages.personaId,
			castMemberId: schema.sessionMessages.castMemberId,
			isNarratorResponse: schema.sessionMessages.isNarratorResponse,
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel),
				eq(schema.sessionMessages.isHidden, false),
				notAFailedReplySql,
				gte(schema.sessionMessages.id, from),
				to != null ? lte(schema.sessionMessages.id, to) : undefined
			)
		)
		.orderBy(asc(schema.sessionMessages.id))
}

/** The newest story line on the channel at or after `from`, or null. */
async function newestLineId(
	db: Db,
	sessionId: number,
	channel: string,
	from: number
): Promise<number | null> {
	const [row] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel),
				gte(schema.sessionMessages.id, from),
				liveMessageWhere()
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	return row?.id ?? null
}

/** The last line on the channel strictly before `before`, or null. */
async function lineBefore(
	db: Db,
	sessionId: number,
	channel: string,
	before: number
): Promise<number | null> {
	const [row] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel),
				sql`${schema.sessionMessages.id} < ${before}`,
				liveMessageWhere()
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	return row?.id ?? null
}

/**
 * True when a live line of the session sits on `channel` after `after` and is
 * not one of `leaving`: a later line that stays.
 */
async function laterLineStays(
	db: Db,
	sessionId: number,
	channel: string,
	after: number,
	leaving: readonly number[]
): Promise<boolean> {
	const [row] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel),
				sql`${schema.sessionMessages.id} > ${after}`,
				liveMessageWhere(),
				leaving.length ? notInArray(schema.sessionMessages.id, [...leaving]) : undefined
			)
		)
		.limit(1)
	return row !== undefined
}

/** Every line of the lane from `from` to `to`, hidden ones too, by id. */
async function laneLineIds(
	db: Db,
	sessionId: number,
	channel: string,
	from: number,
	to: number
): Promise<number[]> {
	const rows = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel),
				gte(schema.sessionMessages.id, from),
				lte(schema.sessionMessages.id, to),
				liveMessageWhere()
			)
		)
	return rows.map((r) => r.id)
}

/**
 * 🚧 Every line of the session inside a live scene's range, with the scene
 * that holds it (lane E): a closed scene's run, and the open scene's from
 * its opening to the lane's newest line — hidden lines too. What
 * `scenes:scenedMessageIds` and a tick selection's capture rule read as
 * captured, so a live range is seen everywhere a captured line is.
 */
export async function liveRangeLineIds(
	db: Db,
	sessionId: number
): Promise<Map<number, number>> {
	const out = new Map<number, number>()
	const scenes = await db
		.select({
			id: schema.scenes.id,
			channel: schema.scenes.channel,
			opened: schema.scenes.openedAtMessageId,
			closed: schema.scenes.closedAtMessageId
		})
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				sql`${schema.scenes.openedAtMessageId} IS NOT NULL`
			)
		)
	if (!scenes.length) return out
	const from = Math.min(...scenes.map((s) => s.opened!))
	const rows = await db
		.select({
			id: schema.sessionMessages.id,
			channel: schema.sessionMessages.channel
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				gte(schema.sessionMessages.id, from),
				liveMessageWhere()
			)
		)
	for (const row of rows) {
		const lane = canonicalChannel(row.channel)
		const s = scenes.find(
			(x) =>
				x.channel === lane &&
				row.id >= x.opened! &&
				(x.closed == null || row.id <= x.closed)
		)
		if (s) out.set(row.id, s.id)
	}
	return out
}

/** Range scenes of the session on a channel, other than `except`. */
async function rangeScenes(
	db: Db,
	sessionId: number,
	channel: string,
	except?: number
): Promise<SceneRow[]> {
	const rows = await db
		.select()
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.channel, channel),
				sql`${schema.scenes.openedAtMessageId} IS NOT NULL`
			)
		)
		.orderBy(asc(schema.scenes.openedAtMessageId))
	return rows.filter((s) => s.id !== except)
}

/** Whether two id ranges meet (`null` end = open-ended). */
const meets = (
	a: [number, number | null],
	b: [number, number | null]
): boolean =>
	a[0] <= (b[1] ?? Number.POSITIVE_INFINITY) &&
	b[0] <= (a[1] ?? Number.POSITIVE_INFINITY)

/** Refuse a range another range scene on the channel already covers. */
function assertNoOverlap(
	range: [number, number | null],
	others: SceneRow[]
): void {
	for (const s of others) {
		const theirs: [number, number | null] = [
			s.openedAtMessageId!,
			s.closedAtMessageId
		]
		if (meets(range, theirs))
			throw new SceneBoundaryRefusal(
				`That would overlap ${s.name ?? "another scene"}. A message belongs to one scene.`
			)
	}
}

/** Message ids already captured by a scene of the session, other than `except`. */
async function capturedElsewhere(
	db: Db,
	sessionId: number,
	except: number
): Promise<Set<number>> {
	const rows = await db
		.select({
			id: schema.scenes.id,
			selectedMessageIds: schema.scenes.selectedMessageIds
		})
		.from(schema.scenes)
		.where(eq(schema.scenes.sessionId, sessionId))
	return new Set(
		rows
			.filter((r) => r.id !== except)
			.flatMap((r) => (r.selectedMessageIds ?? []) as number[])
	)
}

/** `selectedMessageIds` for a closed range — the derived cache. */
async function derivedSelection(
	db: Db,
	scene: Pick<SceneRow, "id" | "sessionId" | "channel">,
	from: number,
	to: number
): Promise<number[]> {
	const lines = await storyLinesInRange(
		db,
		scene.sessionId!,
		scene.channel,
		from,
		to
	)
	const taken = await capturedElsewhere(db, scene.sessionId!, scene.id)
	return lines.map((l) => l.id).filter((id) => !taken.has(id))
}

/** The capture lock `scenes:create` takes (`capturableMessageIds`). */
const lockCapture = (tx: Db, sessionId: number) =>
	tx.execute(
		sql`select pg_advisory_xact_lock(hashtext('sceneCapture'), ${sessionId})`
	)

function isOpenSceneConflict(err: unknown): boolean {
	const e = err as { code?: string; message?: string; cause?: any } | null
	const text = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`
	return (
		e?.code === "23505" ||
		e?.cause?.code === "23505" ||
		text.includes("scenes_open_per_session_channel")
	)
}

// ── naming ──────────────────────────────────────────────────────────────────

/**
 * 🚧 The state key a session's genre names as its **place**
 * (`SessionShape.scenes.place`, live scenes §15 G2) — `location` for
 * Adventure and the Lair — or null: a genre that names none has no place.
 */
export async function scenePlaceKeyOf(
	db: Db,
	sessionId: number
): Promise<string | null> {
	const [row] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return null
	const [{ getSessionGenre, STANDARD_GENRE_ID }, { declaredScenePlace }] =
		await Promise.all([
			import("$lib/server/pipelines/entities/sessionGenres"),
			import("@serene-pub/sdk")
		])
	try {
		const genre = await getSessionGenre(db, row.genreId ?? STANDARD_GENRE_ID)
		return declaredScenePlace(genre?.shape)?.stateKey ?? null
	} catch {
		return null
	}
}

/**
 * 🚧 A reader of the session's world state keys as display text — now, or
 * with `at`, **as each stood when that line was written** (the state ledger
 * read at the line, `ValueQuery.asOfMessageId`: every write is an append) —
 * null where the session's state holds no such key or no value. Words are
 * themselves; a lore reference (a place entry) is its title. The session's
 * links and vocabulary are read once, so the boundary watcher's several
 * reads at one line pay for them once. The one read the place and a
 * declared trigger's `stateKey` both make.
 */
export async function worldStateReader(
	db: Db,
	sessionId: number
): Promise<(stateKey: string, at?: { messageId: number }) => Promise<string | null>> {
	const { sessionLinks, vocabularyFor } = await import("$lib/server/state/resolve")
	const links = await sessionLinks(db, sessionId)
	const vocabulary = await vocabularyFor(db, sessionId, links)
	return worldStateReaderWith(db, sessionId, links, vocabulary)
}

/** `worldStateReader` over links and vocabulary the caller already loaded. */
async function worldStateReaderWith(
	db: Db,
	sessionId: number,
	links: StateLinks,
	vocabulary: StateVocabulary
): Promise<(stateKey: string, at?: { messageId: number }) => Promise<string | null>> {
	const { valueOf, slotKey, qualifiedSlotKey } = await import("$lib/server/state/resolve")
	return async (stateKey, at) => {
		const decl = vocabulary.entries
			.map((e) => e.decl)
			.find(
				(d) =>
					d.appliesTo.includes("world") &&
					(slotKey(d.id) === stateKey || qualifiedSlotKey(d.id) === stateKey)
			)
		if (!decl) return null
		const value = await valueOf(
			db,
			{
				sessionId,
				owner: { kind: "session", id: sessionId },
				slotId: decl.id,
				...(at ? { asOfMessageId: at.messageId } : {})
			},
			{ links, vocabulary }
		)
		return stateValueText(db, value)
	}
}

type StateResolve = typeof import("$lib/server/state/resolve")
type StateLinks = Awaited<ReturnType<StateResolve["sessionLinks"]>>
type StateVocabulary = Awaited<ReturnType<StateResolve["vocabularyFor"]>>

/** One state value as words: a string trimmed, a number, a lore reference's title; else null. */
async function stateValueText(db: Db, value: unknown): Promise<string | null> {
	if (typeof value === "string") return value.trim() || null
	if (typeof value === "number" && Number.isFinite(value)) return String(value)
	if (typeof value === "boolean") return value ? "yes" : "no"
	const { isSlotLoreRef } = await import("@serene-pub/sdk")
	if (isSlotLoreRef(value)) {
		const ref = value as { entryId: number; name?: unknown }
		if (typeof ref.name === "string" && ref.name.trim()) return ref.name.trim()
		const [row] = await db
			.select({ title: schema.lorebookEntries.title })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, Number(ref.entryId)))
			.limit(1)
		return row?.title?.trim() || null
	}
	return null
}

/**
 * 🚧 The place the genre's state names for the session (live scenes §15
 * G2): the world's value of the genre's place key
 * (`SessionShape.scenes.place.stateKey`), as display text — now, or with
 * `at`, as it stood when that line was written — or null where the genre
 * names no place or the state holds none. What a scene's name carries
 * (`Scene N · <place>`) and what the boundary watcher's *place changed*
 * compares. `known.stateKey` spares the genre read when the caller has it
 * (null: no place).
 */
export async function scenePlaceOf(
	db: Db,
	sessionId: number,
	at?: { messageId: number },
	known?: { stateKey?: string | null }
): Promise<string | null> {
	const stateKey =
		known && "stateKey" in known
			? (known.stateKey ?? null)
			: await scenePlaceKeyOf(db, sessionId)
	if (!stateKey) return null
	return (await worldStateReader(db, sessionId))(stateKey, at)
}
/**
 * A line as the speaker rules read it: the card columns, the member column
 * and the two `metadata` stamps that name a speaker where no card does.
 */
export interface SpokenLine {
	id: number
	characterId: number | null
	personaId: number | null
	castMemberId: number | null
	/** The line's text and kind: read for speech tags only on a narrator line (`isNarratorLine`). */
	content?: string | null
	role?: string | null
	isNarratorResponse?: boolean | null
	isHidden?: boolean | null
	metadata?: {
		speaker?: string | null
		sideCharacter?: { characterId?: number | null } | null
	} | null
}

/**
 * Who spoke a line. A card (`cardId`, a character or a persona) is resolved to
 * its member by the reader; with no card the speaker is `memberId`, a live
 * member of the session's book. `playerSeatId` is the player seat the line
 * was stamped with, which owns the speaker's place state.
 */
export interface LineSpeaker {
	cardId: number | null
	memberId: number | null
	memberName: string | null
	playerSeatId: number | null
}

/** A speaker as one string, the key of a set: `card:<id>` or `member:<id>`. */
export const speakerRefOf = (s: LineSpeaker): string =>
	s.cardId != null ? `card:${s.cardId}` : `member:${s.memberId}`

/**
 * 🚧 Who spoke each line, from what the line stores — never from its text.
 * In order: the card columns (`character_id`, then `persona_id`); the member
 * column (`cast_member_id`, a card-less character seat); `metadata.speaker`
 * `player-seat:<id>` (a card-less player seat) mapped to that seat's member;
 * `metadata.speaker` `character:<id>`, else `metadata.sideCharacter
 * .characterId` (a side-character turn, which keeps `character_id` null),
 * mapped to that card's member in the session's book. A line with none of
 * these, or whose member is not in the book (gone), has no entry: nobody
 * spoke it. Speech tags inside narration name nobody here.
 */
export async function lineSpeakersOf(
	db: Db,
	scene: { sessionId: number; lorebookId: number },
	lines: ReadonlyArray<SpokenLine>
): Promise<Map<number, LineSpeaker>> {
	const out = new Map<number, LineSpeaker>()
	const bare = lines.filter((l) => (l.characterId ?? l.personaId) == null)
	const stamped = new Map<
		number,
		{ seatId: number | null; cardId: number | null }
	>()
	for (const l of bare) {
		const speaker = l.metadata?.speaker
		const seat = typeof speaker === "string" ? /^player-seat:(\d+)$/.exec(speaker) : null
		const card =
			typeof speaker === "string" ? /^character:(\d+)$/.exec(speaker) : null
		stamped.set(l.id, {
			seatId: seat ? Number(seat[1]) : null,
			cardId: card
				? Number(card[1])
				: (l.metadata?.sideCharacter?.characterId ?? null)
		})
	}
	const seatIds = [
		...new Set([...stamped.values()].flatMap((s) => (s.seatId != null ? [s.seatId] : [])))
	]
	const seatMember = new Map<number, number | null>()
	if (seatIds.length) {
		const rows = await db
			.select({
				id: schema.sessionPersonas.id,
				castMemberId: schema.sessionPersonas.castMemberId
			})
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, scene.sessionId),
					inArray(schema.sessionPersonas.id, seatIds)
				)
			)
		for (const r of rows) seatMember.set(r.id, r.castMemberId)
	}
	const needCards = [...stamped.values()].some((s) => s.cardId != null)
	const memberOfCard = needCards
		? (await castMemberCards(db, scene.lorebookId)).memberOf
		: new Map<number, number>()
	const members = new Map<number, { memberId: number; seatId: number | null }>()
	for (const l of bare) {
		const s = stamped.get(l.id)!
		const memberId =
			l.castMemberId ??
			(s.seatId != null ? seatMember.get(s.seatId) : null) ??
			(s.cardId != null ? memberOfCard.get(s.cardId) : null) ??
			null
		if (memberId != null) members.set(l.id, { memberId, seatId: s.seatId })
	}
	const live = new Map<number, string>()
	const ids = [...new Set([...members.values()].map((m) => m.memberId))]
	if (ids.length)
		for (const r of await db
			.select({
				id: schema.lorebookBindings.id,
				name: schema.lorebookBindings.name
			})
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, scene.lorebookId),
					inArray(schema.lorebookBindings.id, ids)
				)
			))
			live.set(r.id, r.name)
	for (const l of lines) {
		const card = l.characterId ?? l.personaId
		if (card != null) {
			out.set(l.id, {
				cardId: card,
				memberId: l.castMemberId,
				memberName: null,
				playerSeatId: null
			})
			continue
		}
		const m = members.get(l.id)
		if (!m || !live.has(m.memberId)) continue
		out.set(l.id, {
			cardId: null,
			memberId: m.memberId,
			memberName: live.get(m.memberId) ?? null,
			playerSeatId: m.seatId != null && seatMember.has(m.seatId) ? m.seatId : null
		})
	}
	return out
}

/** The session's card → member (character seats) and persona → player seat maps, a card's first live seat winning. */
interface SeatMaps {
	memberOfCard: Map<number, number>
	playerSeatOfPersona: Map<number, number>
}

async function seatMapsOf(db: Db, sessionId: number): Promise<SeatMaps> {
	const [characterSeats, playerSeats] = await Promise.all([
		db
			.select({
				characterId: schema.sessionCharacters.characterId,
				castMemberId: schema.sessionCharacters.castMemberId
			})
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, sessionId))
			.orderBy(
				sql`(${schema.sessionCharacters.removedAt} is not null)`,
				asc(sql`coalesce(${schema.sessionCharacters.position}, 0)`),
				asc(schema.sessionCharacters.id)
			),
		db
			.select({
				id: schema.sessionPersonas.id,
				personaId: schema.sessionPersonas.personaId
			})
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, sessionId))
			.orderBy(
				sql`(${schema.sessionPersonas.removedAt} is not null)`,
				asc(sql`coalesce(${schema.sessionPersonas.position}, 0)`),
				asc(schema.sessionPersonas.id)
			)
	])
	const memberOfCard = new Map<number, number>()
	for (const r of characterSeats)
		if (
			r.characterId != null &&
			r.castMemberId != null &&
			!memberOfCard.has(r.characterId)
		)
			memberOfCard.set(r.characterId, r.castMemberId)
	const playerSeatOfPersona = new Map<number, number>()
	for (const r of playerSeats)
		if (r.personaId != null && !playerSeatOfPersona.has(r.personaId))
			playerSeatOfPersona.set(r.personaId, r.id)
	return { memberOfCard, playerSeatOfPersona }
}

/**
 * The place rule for one speaker's line, as a check to call per line. A line
 * passes when the speaker has no place of its own as of that line, or the
 * scene has no place at that line, or one of the speaker's own places names
 * the scene's place. What the comparison needs: the session's state links
 * (read when a speaker is first checked), the speaker's own place as of the
 * line, and — only when the speaker has one — the vocabulary that names the
 * genre's place slot, for the scene's place as of the line. The seat maps
 * (card → member, persona → player seat) are read only for a card's line,
 * and only when `seats` is not passed.
 */
async function placeRuleOf(
	db: Db,
	sessionId: number,
	placeKey: string,
	seats?: {
		memberOfCard: Map<number, number>
		playerSeatOfPersona: Map<number, number>
	}
): Promise<(line: SpokenLine, who: LineSpeaker) => Promise<boolean>> {
	const { sessionLinks, vocabularyFor, valueOf } = await import(
		"$lib/server/state/resolve"
	)
	const { castOwnerOf } = await import("$lib/server/state/owners")
	const { HOST_PLACE_SLOT_ID, sameName } = await import("@serene-pub/sdk")
	let links: StateLinks | undefined
	let vocabulary: StateVocabulary | undefined
	const linksOnce = async () => (links ??= await sessionLinks(db, sessionId))
	let seatMaps = seats
	const seatsOf = async () => (seatMaps ??= await seatMapsOf(db, sessionId))
	const placeAt = new Map<number, string | null>()
	let readWorld: Awaited<ReturnType<typeof worldStateReaderWith>> | null = null
	const scenePlaceAt = async (messageId: number) => {
		if (placeAt.has(messageId)) return placeAt.get(messageId)!
		const known = await linksOnce()
		vocabulary ??= await vocabularyFor(db, sessionId, known)
		readWorld ??= await worldStateReaderWith(db, sessionId, known, vocabulary)
		const place = await readWorld(placeKey, { messageId })
		placeAt.set(messageId, place)
		return place
	}
	return async (l, who) => {
		let owner
		if (who.cardId == null)
			owner =
				who.playerSeatId != null
					? ({ kind: "player_seat", id: who.playerSeatId } as const)
					: ({ kind: "seated_member", id: who.memberId! } as const)
		else {
			const { memberOfCard, playerSeatOfPersona } = await seatsOf()
			owner =
				l.characterId != null
					? castOwnerOf({
							characterId: l.characterId,
							seatMemberId:
								l.castMemberId ?? memberOfCard.get(l.characterId) ?? null
						})
					: castOwnerOf({
							characterId: l.personaId!,
							playerSeatId: playerSeatOfPersona.get(l.personaId!) ?? null
						})
		}
		const own = await valueOf(
			db,
			{ sessionId, owner, slotId: HOST_PLACE_SLOT_ID, asOfMessageId: l.id },
			{ links: await linksOnce(), ...(vocabulary ? { vocabulary } : {}) }
		)
		const places: string[] = []
		for (const item of Array.isArray(own) ? own : [own]) {
			const text = await stateValueText(db, item)
			if (text) places.push(text)
		}
		if (!places.length) return true
		const here = await scenePlaceAt(l.id)
		return here == null || places.some((p) => sameName(p, here))
	}
}

/**
 * A narrator line: voiced by no one in the cast. It is not hidden, carries no
 * card, member or side-character stamp, no `metadata.speaker` naming a seat
 * (`player-seat:`, `seated-member:`) or a card (`character:`), and is either
 * flagged a narrator response or sent by the assistant. A person's line
 * (`role` user), a system line and a character's line are never one.
 */
export function isNarratorLine(l: SpokenLine): boolean {
	if (l.isHidden) return false
	if (l.characterId != null || l.personaId != null || l.castMemberId != null)
		return false
	if (l.metadata?.sideCharacter?.characterId != null) return false
	const speaker = l.metadata?.speaker
	if (
		typeof speaker === "string" &&
		/^(player-seat|seated-member|character):/.test(speaker)
	)
		return false
	return l.isNarratorResponse === true || l.role === "assistant"
}

/** A member a narrator line's speech tag names: the surface form, the lines (1-based positions in the list read) and the card the tag's key names. */
interface TaggedMember {
	name: string
	positions: number[]
	cardId: number | null
}

/**
 * 🚧 The members of the session's lorebook that a **narrator line** names with
 * a speech tag (the detector of `sceneCastProposal`, `classifySite` →
 * `speech-tag`: a name beside a speech verb, outside the quotation, in a
 * passage that has one). Only lines `isNarratorLine` accepts and `spoken`
 * has no speaker for are read; a tag in a person's or a character's own line
 * names nobody here. Only gazetteer hits that are members count (the
 * book's own names, never an open-tier name, an entry or a place); nothing is
 * minted. A name only addressed, spoken to or mentioned is not a tag. The names
 * are loaded only when a narrator line has a quotation (a speech tag needs
 * one).
 */
async function narratorTagged(
	db: Db,
	scene: { lorebookId: number },
	lines: ReadonlyArray<SpokenLine>,
	spoken: ReadonlyMap<number, LineSpeaker>,
	opts: { gazetteer?: Gazetteer } = {}
): Promise<Map<number, TaggedMember>> {
	const out = new Map<number, TaggedMember>()
	const turns: CastTurn[] = []
	lines.forEach((l, i) => {
		if (spoken.has(l.id) || !isNarratorLine(l) || !l.content) return
		if (!quotedRanges(l.content).length) return
		turns.push({ index: i + 1, content: l.content, senderKey: null })
	})
	if (!turns.length) return out
	const gazetteer =
		opts.gazetteer ??
		(await (await import("$lib/server/annotations")).loadVocabulary(
			db,
			scene.lorebookId
		)).gazetteer
	const tags = proposeSceneCast(turns, { gazetteer }).participants.flatMap((p) => {
		const tag = p.evidence.find((e) => e.kind === "speech-tag")
		const ref = parseEntityKey(p.key)
		return tag && p.tier === "gazetteer" && ref && ref.kind !== "entry"
			? [{ p, tag, ref }]
			: []
	})
	// A card's name answers for the member linked to it in this book (a book
	// holds a card once); one read for every tagged card.
	const cardIds = tags.flatMap((t) => (t.ref.kind === "character" ? [t.ref.id] : []))
	const memberOfCard = new Map<number, number>()
	if (cardIds.length)
		for (const r of await db
			.select({
				id: schema.lorebookBindings.id,
				characterId: schema.lorebookBindings.characterId
			})
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, scene.lorebookId),
					inArray(schema.lorebookBindings.characterId, cardIds)
				)
			))
			memberOfCard.set(r.characterId!, r.id)
	for (const { p, tag, ref } of tags) {
		const memberId =
			ref.kind === "cast_member" ? ref.id : (memberOfCard.get(ref.id) ?? null)
		if (memberId == null) continue
		const hit = out.get(memberId)
		if (hit) {
			hit.positions = [...new Set([...hit.positions, ...tag.turns])].sort(
				(a, b) => a - b
			)
			continue
		}
		out.set(memberId, {
			name: p.name,
			positions: [...tag.turns],
			cardId: ref.kind === "character" ? ref.id : null
		})
	}
	return out
}

/**
 * The tagged members the place rule keeps: a member's own place as of a line
 * their tag sits in, against the scene's place at that line, exactly as for a
 * sender; kept when one line passes. `passes` null: the genre names no place
 * key, nobody is ruled out. A tagged card is a player's persona when a player
 * seat holds it (`seats.playerSeatOfPersona`), else a character.
 */
async function taggedKept(
	tagged: ReadonlyMap<number, TaggedMember>,
	lines: ReadonlyArray<SpokenLine>,
	passes: ((line: SpokenLine, who: LineSpeaker) => Promise<boolean>) | null,
	seats: SeatMaps | undefined
): Promise<Map<number, TaggedMember>> {
	if (!passes) return new Map(tagged)
	const kept = new Map<number, TaggedMember>()
	for (const [memberId, t] of tagged) {
		for (const position of t.positions) {
			const at = lines[position - 1]!
			const persona =
				t.cardId != null && seats?.playerSeatOfPersona.has(t.cardId)
			const as: SpokenLine = {
				id: at.id,
				characterId: t.cardId != null && !persona ? t.cardId : null,
				personaId: persona ? t.cardId : null,
				castMemberId: memberId
			}
			const who: LineSpeaker = {
				cardId: t.cardId,
				memberId,
				memberName: null,
				playerSeatId: null
			}
			if (await passes(as, who)) {
				kept.set(memberId, t)
				break
			}
		}
	}
	return kept
}

/**
 * 🚧 The speakers a scene's `lines` list, and the narrator-tagged members
 * among them: those that spoke at least one line (`lineSpeakersOf`) or that a
 * narrator line names with a speech tag (`narratorTagged`), and that their
 * place does not rule out. A line passes when the genre names no place key, or
 * the member has no place of its own as of that line, or the scene has no
 * place at that line, or one of the member's own places names the scene's
 * place; a member is listed when one of its lines passes (benching plays no
 * part, and the session's world place is never the member's own). Owner
 * rulings: "Attended = spoke in the scene" … "For core catelogue, we will go
 * with: Spoke at least once, and further filtering by cast members position"
 * (D57, 2026-11-16); "Active means spoke at least once in the scene" (B1,
 * 2026-11-17); "A cast member with a speech tag in the narrator's lines
 * counts as having spoken" (SC2, 2026-11-17). A genre or plugin may compile a
 * scene's cast differently; the reads only ask the stored cast.
 *
 * `speakers` holds refs (`speakerRefOf`: `card:<id>` for a card's line,
 * `member:<id>` for a card-less speaker or a tagged member); `tagged` the
 * kept tagged members by member id. `seats` spares the seat reads when the
 * caller has them; `gazetteer` the name list.
 */
export async function castSpeakersOf(
	db: Db,
	scene: { sessionId: number; lorebookId: number },
	lines: ReadonlyArray<SpokenLine>,
	opts: { seats?: SeatMaps; gazetteer?: Gazetteer } = {}
): Promise<{ speakers: Set<string>; tagged: Map<number, TaggedMember> }> {
	const speakers = new Set<string>()
	const who = await lineSpeakersOf(db, scene, lines)
	const found = await narratorTagged(db, scene, lines, who, {
		gazetteer: opts.gazetteer
	})
	if (!who.size && !found.size) return { speakers, tagged: found }
	const placeKey = await scenePlaceKeyOf(db, scene.sessionId)
	if (!placeKey) {
		for (const s of who.values()) speakers.add(speakerRefOf(s))
		for (const memberId of found.keys()) speakers.add(`member:${memberId}`)
		return { speakers, tagged: found }
	}
	let seats = opts.seats
	if (!seats && [...found.values()].some((t) => t.cardId != null))
		seats = await seatMapsOf(db, scene.sessionId)
	const passes = await placeRuleOf(db, scene.sessionId, placeKey, seats)
	for (const l of lines) {
		const s = who.get(l.id)
		if (!s || speakers.has(speakerRefOf(s))) continue
		if (await passes(l, s)) speakers.add(speakerRefOf(s))
	}
	const tagged = await taggedKept(found, lines, passes, seats)
	for (const memberId of tagged.keys()) speakers.add(`member:${memberId}`)
	return { speakers, tagged }
}

/** `castSpeakersOf`'s refs: who a scene's lines list. */
export async function sceneCastSpeakers(
	db: Db,
	scene: { sessionId: number; lorebookId: number },
	lines: ReadonlyArray<SpokenLine>,
	seats?: SeatMaps
): Promise<Set<string>> {
	return (await castSpeakersOf(db, scene, lines, { seats })).speakers
}

/** `Scene N` [` · <place>`] [` · <date>`], deterministic — the place as it stood at the opening line. */
export async function sceneNameFor(
	db: Db,
	sessionId: number,
	channel: string,
	lorebookId: number,
	clock: StoryClock | null,
	at: number
): Promise<string> {
	const prior = await db
		.select()
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.channel, channel)
			)
		)
		.orderBy(desc(schema.scenes.id))
	// Numbered by position: 1 + the lane's scenes that start before `at`.
	// A scene that starts nowhere (`sceneStartOf` is null) is not counted.
	const before = prior
		.map((s) => ({ scene: s, start: sceneStartOf(s) }))
		.filter((s): s is { scene: (typeof prior)[number]; start: number } => s.start !== null && s.start < at)
		.sort((a, b) => b.start - a.start)
	const parts = [`Scene ${before.length + 1}`]
	const place = await scenePlaceOf(db, sessionId, { messageId: at })
	if (place) parts.push(place)
	// The scene before this one by position, not the newest by id: a scene
	// opened between two others compares its day with the one it follows.
	const previous = before[0]?.scene
	const previousClock = previous
		? (sceneClockOf(previous, "closed") ?? sceneClockOf(previous, "opened"))
		: null
	if (clock && !sameDay(clock, previousClock))
		parts.push(formatDate(dayOf(clock), await bookCalendarOf(db, lorebookId)))
	return parts.join(" · ")
}

/**
 * 🚧 ★4b — each scene's name as shown, by id. A stored automatic name
 * (`nameIsDefault`, `Scene N · <place> · <day>`) has only its leading
 * `Scene N` replaced: `N` is 1 + the scenes on its lane (same session and
 * channel) that start before it — `sceneNameFor`'s start rule (the opening
 * line, else the smallest selected line; neither: starts nowhere, not
 * counted). The place and day stay as stored. A custom name, a null name, a
 * default name with no session or no start is shown as stored. One read for
 * the lanes of all the given scenes; a pure function of stored rows.
 */
export async function sceneDisplayNames(
	db: Db,
	scenes: ReadonlyArray<
		Pick<
			SceneRow,
			| "id"
			| "sessionId"
			| "channel"
			| "name"
			| "nameIsDefault"
			| "openedAtMessageId"
			| "selectedMessageIds"
		>
	>
): Promise<Map<number, string | null>> {
	const out = new Map<number, string | null>()
	const numbered = scenes.filter(
		(s) => s.nameIsDefault && s.sessionId != null && s.name != null && /^Scene \d+(?= · |$)/.test(s.name)
	)
	const sessionIds = [...new Set(numbered.map((s) => s.sessionId as number))]
	const lanes = sessionIds.length
		? await db
				.select({
					id: schema.scenes.id,
					sessionId: schema.scenes.sessionId,
					channel: schema.scenes.channel,
					openedAtMessageId: schema.scenes.openedAtMessageId,
					selectedMessageIds: schema.scenes.selectedMessageIds
				})
				.from(schema.scenes)
				.where(inArray(schema.scenes.sessionId, sessionIds))
		: []
	// Each lane's (session, channel) start lines, ascending — so a scene's
	// position is a lower-bound search, not a scan of every row.
	const numberedSet = new Set(numbered)
	const laneStarts = new Map<number, Map<string | null, number[]>>()
	const rowOf = new Map<number, { row: (typeof lanes)[number]; start: number | null }>()
	for (const o of lanes) {
		const start = sceneStartOf(o)
		rowOf.set(o.id, { row: o, start })
		if (start === null || o.sessionId == null) continue
		let byChannel = laneStarts.get(o.sessionId)
		if (!byChannel) laneStarts.set(o.sessionId, (byChannel = new Map()))
		const starts = byChannel.get(o.channel)
		if (starts) starts.push(start)
		else byChannel.set(o.channel, [start])
	}
	for (const byChannel of laneStarts.values())
		for (const starts of byChannel.values()) starts.sort((a, b) => a - b)
	for (const s of scenes) {
		out.set(s.id, s.name ?? null)
		if (!numberedSet.has(s)) continue
		const at = sceneStartOf(s)
		if (at == null) continue
		const starts = laneStarts.get(s.sessionId as number)?.get(s.channel) ?? []
		// First index whose start is >= at: the rows starting strictly earlier.
		let lo = 0
		let hi = starts.length
		while (lo < hi) {
			const mid = (lo + hi) >> 1
			if (starts[mid] < at) lo = mid + 1
			else hi = mid
		}
		// A scene is not its own predecessor: take its stored row back out when
		// that row sits on this lane and starts before `at`.
		const own = rowOf.get(s.id)
		const selfCounted =
			own !== undefined &&
			own.row.sessionId === s.sessionId &&
			own.row.channel === s.channel &&
			own.start !== null &&
			own.start < at
		const position = 1 + lo - (selfCounted ? 1 : 0)
		out.set(s.id, (s.name as string).replace(/^Scene \d+/, `Scene ${position}`))
	}
	return out
}

// ── cast ────────────────────────────────────────────────────────────────────

/**
 * List the scene's cast from its lines (`readCastProposal`: whoever sent a
 * line or is tagged as the speaker in a narrator line, minus those their
 * place rules out) and write the participants that
 * resolve to a member as the scene's `scene_characters`.
 */
async function proposeAndWriteCast(
	db: Db,
	scene: SceneRow,
	redline?: SceneCastRedline
): Promise<ProposedSceneCastMember[]> {
	if (sceneLockedAgainstRuns(scene)) return []
	const proposal = await readCastProposal(db, scene)
	if (!proposal) return []
	return (await writeProposedCast(db, scene, proposal, redline)) ?? []
}

/**
 * The `cast_member:` keys of a proposal that name a member of `lorebookId` —
 * a `cast_member:` key names the member itself, and counts only in its own
 * book (a gone member, or another book's, is skipped).
 */
async function proposedMembersInBook(
	db: Db,
	lorebookId: number,
	proposal: NonNullable<Awaited<ReturnType<typeof readCastProposal>>>
): Promise<Set<number>> {
	const memberIds = proposal.participants.flatMap((p) => {
		const ref = parseEntityKey(p.key)
		return ref?.kind === "cast_member" ? [ref.id] : []
	})
	if (!memberIds.length) return new Set()
	const rows = await db
		.select({ id: schema.lorebookBindings.id })
		.from(schema.lorebookBindings)
		.where(
			and(
				eq(schema.lorebookBindings.lorebookId, lorebookId),
				inArray(schema.lorebookBindings.id, memberIds)
			)
		)
	return new Set(rows.map((r) => r.id))
}

/**
 * Write a listing's participants as the scene's `scene_characters` — every live write's (open, close, move, merge, refresh).
 * A locked scene keeps its cast as it is: nothing is written and the result is null.
 */
async function writeProposedCast(
	db: Db,
	scene: SceneRow,
	proposal: NonNullable<Awaited<ReturnType<typeof readCastProposal>>>,
	redline?: SceneCastRedline
): Promise<ProposedSceneCastMember[] | null> {
	if (sceneLockedAgainstRuns(scene)) return null
	const out: ProposedSceneCastMember[] = []
	const participantIds: number[] = []
	const liveMembers = await proposedMembersInBook(
		db,
		scene.lorebookId,
		proposal
	)
	for (const p of proposal.participants) {
		const ref = parseEntityKey(p.key)
		let bindingId: number | null = null
		if (ref?.kind === "character") {
			bindingId = await resolveOrCreateBinding(
				{ lorebookId: scene.lorebookId, characterId: ref.id },
				db
			)
		} else if (ref?.kind === "cast_member" && liveMembers.has(ref.id)) {
			bindingId = ref.id
		}
		// One member can arrive twice (a seat keyed by its card and a mention
		// keyed by the member), so a member is written once.
		if (bindingId != null && !participantIds.includes(bindingId))
			participantIds.push(bindingId)
		out.push({
			key: p.key,
			name: p.name,
			evidenceLabel: p.evidenceLabel,
			bindingId
		})
	}
	await writeSceneCast(
		scene.id,
		{ participantCharacters: participantIds },
		db,
		redline
	)
	await db
		.update(schema.scenes)
		.set({ castResolvedAt: new Date() })
		.where(eq(schema.scenes.id, scene.id))
	return out
}

/**
 * A refresh for a line nobody in the cast spoke: only a narrator line with a
 * speech tag can add anyone (`narratorTagged`, this one line). The names are
 * loaded only for a narrator line that has a quotation; the stored cast is
 * read only when a tag names a member, and no place read happens unless a new
 * member is tagged. True when the cast was rewritten.
 */
async function refreshFromTags(
	db: Db,
	scene: SceneRow,
	sessionId: number,
	line: SpokenLine,
	placeKeyHeld: string | null | undefined
): Promise<boolean> {
	if (!isNarratorLine(line) || !line.content || !quotedRanges(line.content).length)
		return false
	const named = await narratorTagged(db, scene, [line], new Map())
	if (!named.size) return false
	const stored = (await readSceneCast(scene.id, db)).participantCharacters
	const found = new Map([...named].filter(([id]) => !stored.includes(id)))
	if (!found.size) return false
	const placeKey =
		placeKeyHeld !== undefined
			? placeKeyHeld
			: await scenePlaceKeyOf(db, sessionId)
	let kept = found
	if (placeKey) {
		const seats = [...found.values()].some((t) => t.cardId != null)
			? await seatMapsOf(db, sessionId)
			: undefined
		kept = await taggedKept(
			found,
			[line],
			await placeRuleOf(db, sessionId, placeKey, seats),
			seats
		)
	}
	if (!kept.size) return false
	const listed = (id: number) => ({
		key: `cast_member:${id}`,
		name: "",
		evidenceLabel: "",
		evidenceWords: ""
	})
	const written = await writeProposedCast(
		db,
		scene,
		{
			participants: [...stored, ...kept.keys()].map(listed),
			lineCount: 0
		},
		{
			by: { sessionId },
			cause: "scene-compiler",
			before: { participantCharacters: stored }
		}
	)
	return written !== null
}

/**
 * 🚧 Keep an **open** scene's stored cast current (live scenes §15 G3): a
 * line landed on its lane. A scene lists whoever spoke in it, so a new line
 * can only add its own speaker (`lineSpeakersOf`) or, on a narrator line,
 * the members its speech tags name (`refreshFromTags`): one the stored cast
 * already lists writes nothing and reads no other line; a new one is added
 * after the stored cast when their place does not rule them out (the one
 * line). `placeKey` is the genre's place key when the
 * caller holds it (null: no place), read here when absent. True when the
 * cast was rewritten. A person added by hand who never spoke stays listed.
 * Only an open range scene the line belongs to (at or after its opening);
 * anything else is left alone.
 */
export async function refreshOpenSceneCast(
	db: Db,
	params: {
		sessionId: number
		channel: string
		messageId: number
		placeKey?: string | null
	}
): Promise<boolean> {
	const [scene] = await db
		.select()
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, params.sessionId),
				eq(schema.scenes.channel, params.channel),
				sql`${schema.scenes.openedAtMessageId} IS NOT NULL`,
				sql`${schema.scenes.closedAtMessageId} IS NULL`
			)
		)
		.limit(1)
	if (!scene || scene.openedAtMessageId! > params.messageId) return false
	if (sceneLockedAgainstRuns(scene)) return false
	const [line] = await db
		.select({
			id: schema.sessionMessages.id,
			characterId: schema.sessionMessages.characterId,
			personaId: schema.sessionMessages.personaId,
			castMemberId: schema.sessionMessages.castMemberId,
			content: schema.sessionMessages.content,
			role: schema.sessionMessages.role,
			isNarratorResponse: schema.sessionMessages.isNarratorResponse,
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.id, params.messageId),
				eq(schema.sessionMessages.sessionId, params.sessionId),
				eq(schema.sessionMessages.isHidden, false),
				notAFailedReplySql
			)
		)
		.limit(1)
	if (!line) return false
	const scenePair = { sessionId: params.sessionId, lorebookId: scene.lorebookId }
	const who = (await lineSpeakersOf(db, scenePair, [line])).get(line.id)
	if (!who) return refreshFromTags(db, scene, params.sessionId, line, params.placeKey)
	// A card is compared as its member in this book (any card of theirs,
	// `castMemberCards`); a card with no member yet would be minted by the write.
	const memberId =
		who.cardId != null
			? ((await castMemberCards(db, scene.lorebookId)).memberOf.get(
					who.cardId
				) ?? null)
			: who.memberId
	const stored = (await readSceneCast(scene.id, db)).participantCharacters
	if (memberId != null && stored.includes(memberId)) return false
	const placeKey =
		params.placeKey !== undefined
			? params.placeKey
			: await scenePlaceKeyOf(db, params.sessionId)
	if (placeKey) {
		const passes = await placeRuleOf(db, params.sessionId, placeKey)
		if (!(await passes(line, who))) return false
	}
	const listed = (key: string) => ({
		key,
		name: "",
		evidenceLabel: "",
		evidenceWords: ""
	})
	const written = await writeProposedCast(
		db,
		scene,
		{
			participants: [
				...stored.map((id) => listed(`cast_member:${id}`)),
				listed(
					memberId != null ? `cast_member:${memberId}` : `character:${who.cardId}`
				)
			],
			lineCount: 0
		},
		{
			by: { sessionId: params.sessionId },
			cause: "scene-compiler",
			before: { participantCharacters: stored }
		}
	)
	return written !== null
}

/**
 * 🚧 The scene's cast as core's compiler lists it: whoever sent a line or a
 * narrator line's speech tag names, minus those their place rules out
 * (`castSpeakersOf`), each with its evidence — and nothing written: what
 * Chronicle's *Open scene* card shows while the scene is still being played.
 * The roster and the other names found in the lines make no participant. Null for a scene with no range.
 */
export async function readCastProposal(
	db: Db,
	scene: SceneRow
): Promise<{
	participants: Array<{ key: string; name: string; evidenceLabel: string; evidenceWords: string }>
	lineCount: number
} | null> {
	if (scene.sessionId == null || scene.openedAtMessageId == null) return null
	const lines = await storyLinesInRange(
		db,
		scene.sessionId,
		scene.channel,
		scene.openedAtMessageId,
		scene.closedAtMessageId
	)
	const ids = [
		...new Set(
			lines.flatMap((l) => [l.characterId, l.personaId]).filter(
				(v): v is number => v != null
			)
		)
	]
	const [sessionPersonas, memberSeats] = await Promise.all([
		db
			.select({
				id: schema.sessionPersonas.id,
				personaId: schema.sessionPersonas.personaId,
				castMemberId: schema.sessionPersonas.castMemberId
			})
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, scene.sessionId))
			// A card's seat: live before departed, then position, then id.
			.orderBy(
				sql`(${schema.sessionPersonas.removedAt} is not null)`,
				asc(sql`coalesce(${schema.sessionPersonas.position}, 0)`),
				asc(schema.sessionPersonas.id)
			),
		// ⏳ Every character seat's member by card (departed too: a line of a
		// seat that has gone still names its member), for the flip's keys.
		db
			.select({
				characterId: schema.sessionCharacters.characterId,
				castMemberId: schema.sessionCharacters.castMemberId
			})
			.from(schema.sessionCharacters)
			.where(eq(schema.sessionCharacters.sessionId, scene.sessionId))
			.orderBy(
				sql`(${schema.sessionCharacters.removedAt} is not null)`,
				asc(sql`coalesce(${schema.sessionCharacters.position}, 0)`),
				asc(schema.sessionCharacters.id)
			)
	])
	const cards = ids.length
		? await db
				.select()
				.from(schema.characters)
				.where(inArray(schema.characters.id, ids))
		: []
	// A persona is a character row (0132); it is named as the summarizer names
	// a persona's line (`resolvePersonaName`), a character by its name.
	const personaIds = new Set([
		...lines.map((l) => l.personaId),
		...sessionPersonas.map((r) => r.personaId)
	])
	// A character is named as its seat reads it (the seated member's own name, else the card's); a persona as the summarizer names it.
	const seated = await cardsAsSeatsRead(
		db,
		scene.sessionId,
		cards.filter((c) => !personaIds.has(c.id))
	)
	// A player seat is named as its member reads (★pT-1, 2026-11-05:
	// "Everything in session is cast -> active card"): the seat holding the
	// card, else the card's own name.
	const seatOfPersona = new Map<number, number | null>()
	for (const r of sessionPersonas)
		if (r.personaId != null && !seatOfPersona.has(r.personaId))
			seatOfPersona.set(r.personaId, r.castMemberId ?? null)
	const personaCards = cards.filter((c) => personaIds.has(c.id))
	const personasRead = await seatCardsAsRead(
		db,
		scene.sessionId,
		personaCards.map((c) => ({
			castMemberId: seatOfPersona.get(c.id) ?? null,
			character: c
		}))
	)
	const nameOf = new Map(
		cards.map((c) => [
			c.id,
			personaIds.has(c.id)
				? resolvePersonaName(
						personasRead.find((x) => x.character.id === c.id)?.character ?? c
					)
				: seated.find((x) => x.id === c.id)?.name || c.name
		])
	)
	// A seat is keyed as the book's vocabulary keys its member (lane s4-ner,
	// `annotations/index.ts` `loadVocabulary`): by its card while the card is
	// live, as `cast_member:<id>` once the card is soft-deleted. A member-less
	// seat keeps its card key. A card-less line of a member whose card also
	// has lines here (a side-character turn) takes that same key, so one
	// person lists once.
	const memberOfCard = new Map<number, number>()
	for (const r of memberSeats)
		if (
			r.characterId != null &&
			r.castMemberId != null &&
			!memberOfCard.has(r.characterId)
		)
			memberOfCard.set(r.characterId, r.castMemberId)
	const memberOfPersona = new Map<number, number>()
	for (const r of sessionPersonas)
		if (
			r.personaId != null &&
			r.castMemberId != null &&
			!memberOfPersona.has(r.personaId)
		)
			memberOfPersona.set(r.personaId, r.castMemberId)
	const deletedCards = new Set(
		cards.filter((c) => c.isDeleted).map((c) => c.id)
	)
	const seatKey = (cardId: number, member: number | null | undefined) =>
		member != null && deletedCards.has(cardId)
			? `cast_member:${member}`
			: `character:${cardId}`
	const scenePair = { sessionId: scene.sessionId, lorebookId: scene.lorebookId }
	const whoOf = await lineSpeakersOf(db, scenePair, lines)
	// The card a member's lines are keyed by, when that card has a line here.
	const cardOfMember = new Map<number, number>()
	const bookCards = await castMemberCards(db, scene.lorebookId)
	for (const [cardId, memberId] of bookCards.memberOf)
		if (cards.some((c) => c.id === cardId) && !cardOfMember.has(memberId))
			cardOfMember.set(memberId, cardId)
	const turns: CastTurn[] = lines.map((l, i) => {
		const sender = l.characterId ?? l.personaId
		const cardless = sender == null ? whoOf.get(l.id) : undefined
		if (cardless) {
			const card = cardOfMember.get(cardless.memberId!)
			return {
				index: i + 1,
				content: l.content,
				senderKey:
					card != null
						? seatKey(card, cardless.memberId)
						: `cast_member:${cardless.memberId}`,
				senderName: cardless.memberName ?? undefined
			}
		}
		const member =
			l.castMemberId ??
			(l.characterId != null
				? memberOfCard.get(l.characterId)
				: l.personaId != null
					? memberOfPersona.get(l.personaId)
					: undefined)
		return {
			index: i + 1,
			content: l.content,
			senderKey: sender != null ? seatKey(sender, member) : null,
			senderName: sender != null ? nameOf.get(sender) : undefined
		}
	})
	let gazetteer
	try {
		const { loadVocabulary } = await import("$lib/server/annotations")
		gazetteer = (await loadVocabulary(db, scene.lorebookId)).gazetteer
	} catch {
		gazetteer = undefined
	}
	const proposal = proposeSceneCast(turns, { gazetteer })
	// Whoever sent a line, minus those their place rules out: the sender
	// tier only. A key is a sender's when a turn carries it.
	const playerSeatOfPersona = new Map<number, number>()
	for (const r of sessionPersonas)
		if (r.personaId != null && !playerSeatOfPersona.has(r.personaId))
			playerSeatOfPersona.set(r.personaId, r.id)
	const { speakers, tagged } = await castSpeakersOf(db, scenePair, lines, {
		seats: { memberOfCard, playerSeatOfPersona },
		gazetteer: gazetteer ?? EMPTY_GAZETTEER
	})
	// Two deleted cards of one member share a `cast_member:` key: any of them counts.
	const sendersOfKey = new Map<string, Set<string>>()
	lines.forEach((l, i) => {
		const key = turns[i]!.senderKey
		const who = whoOf.get(l.id)
		if (!key || !who) return
		const refs = sendersOfKey.get(key)
		if (refs) refs.add(speakerRefOf(who))
		else sendersOfKey.set(key, new Set([speakerRefOf(who)]))
	})
	const listed = proposal.participants.filter(
		(p) =>
			p.evidence.some((e) => e.kind === "sender") &&
			[...(sendersOfKey.get(p.key) ?? [])].some((ref) => speakers.has(ref))
	)
	// A member a narrator line's speech tag names (`narratorTagged`) is keyed by
	// member, once: not again when their own lines already list them.
	const memberOfKey = (key: string) => {
		const ref = parseEntityKey(key)
		return ref?.kind === "cast_member"
			? ref.id
			: ref?.kind === "character"
				? bookCards.memberOf.get(ref.id)
				: undefined
	}
	const listedMembers = new Set(listed.map((p) => memberOfKey(p.key)))
	const tags = [...tagged].filter(([memberId]) => !listedMembers.has(memberId))
	return {
		participants: [
			...listed.map((p) => ({
				key: p.key,
				name: p.name,
				evidenceLabel: p.evidenceLabel,
				evidenceWords: evidenceWords(p.evidence)
			})),
			...tags.map(([memberId, t]) => {
				const evidence = [{ kind: "speech-tag" as const, turns: t.positions }]
				return {
					key: `cast_member:${memberId}`,
					name: t.name,
					evidenceLabel: renderEvidence(evidence),
					evidenceWords: evidenceWords(evidence)
				}
			})
		],
		lineCount: lines.length
	}
}

/**
 * The scene as a reply carries it: no vectors, cast projected, named as every
 * list names it (the display name, numbered at render).
 */
export async function sceneReplyRow(db: Db, scene: SceneRow) {
	const { embedding: _e, embeddingModel: _m, ...rest } = scene
	const name = (await sceneDisplayNames(db, [scene])).get(scene.id) ?? scene.name
	const cause = (await sceneCauses(db, [scene])).get(scene.id)
	return {
		...rest,
		name,
		...(await readSceneCast(scene.id, db)),
		...causeKeys(cause)
	}
}

/** What a scene row says of why it opened and why its cast moves — `sceneCauses`. */
export interface SceneCause {
	openedBecause?: string
	castCause?: string
}

/** The cause keys a reply row spreads: only the ones present, so a row without a cause has no key. */
export function causeKeys(cause: SceneCause | undefined): SceneCause {
	return {
		...(cause?.openedBecause ? { openedBecause: cause.openedBecause } : {}),
		...(cause?.castCause ? { castCause: cause.castCause } : {})
	}
}

/**
 * 🚧 ★S-4 (owner, 2026-11-04): the causes a scene row carries, DERIVED AT
 * READ — no column, no store, no second writer.
 *
 * - `openedBecause`: a live scene a cue PLACED (Automatic) says so, in the
 *   chip's own words (`sceneCueWording`) over the `placed` cues at its
 *   opening line. A scene a person opened — by hand or by accepting a cue
 *   (`accepted`, not `placed`) — has none.
 * - `castCause`: an OPEN live scene whose genre keeps its cast up to date
 *   (`castRefresh`, scene mode not Manual) says what does it and how to
 *   stop it (`openSceneCastCause`) — the condition `followOpenSceneCast`
 *   runs on. Never on a closed scene or one captured by selection.
 *
 * One cue query for all the scenes, one `sessionSceneContext` per session
 * (read in parallel). Only scenes with a cause get an entry; keys absent when absent.
 */
export async function sceneCauses(
	db: Db,
	scenes: ReadonlyArray<
		Pick<
			SceneRow,
			"id" | "sessionId" | "channel" | "openedAtMessageId" | "closedAtMessageId"
		>
	>
): Promise<Map<number, SceneCause>> {
	const out = new Map<number, SceneCause>()
	const live = scenes.filter(
		(s) => s.sessionId != null && s.openedAtMessageId != null
	)
	if (!live.length) return out
	const { sceneCueWording, openSceneCastCause } = await import(
		"$lib/server/scenes/boundaryWatcher"
	)
	const { sessionSceneContext } = await import(
		"$lib/server/sessions/sceneSettings"
	)
	const sessionIds = [...new Set(live.map((s) => s.sessionId!))]
	const placed = await db
		.select({
			sessionId: schema.sceneCues.sessionId,
			channel: schema.sceneCues.channel,
			atMessageId: schema.sceneCues.atMessageId,
			trigger: schema.sceneCues.trigger,
			reason: schema.sceneCues.reason
		})
		.from(schema.sceneCues)
		.where(
			and(
				inArray(schema.sceneCues.sessionId, sessionIds),
				eq(schema.sceneCues.state, "placed"),
				inArray(schema.sceneCues.atMessageId, [
					...new Set(live.map((s) => s.openedAtMessageId!))
				])
			)
		)
		.orderBy(asc(schema.sceneCues.id))
	const contexts = new Map<
		number,
		Awaited<
			ReturnType<
				(typeof import("$lib/server/sessions/sceneSettings"))["sessionSceneContext"]
			>
		>
	>()
	const read = await Promise.all(
		sessionIds.map((sessionId) => sessionSceneContext(db, sessionId))
	)
	sessionIds.forEach((sessionId, i) => contexts.set(sessionId, read[i]))
	for (const scene of live) {
		const ctx = contexts.get(scene.sessionId!)
		const cues = placed.filter(
			(c) =>
				c.sessionId === scene.sessionId &&
				c.channel === scene.channel &&
				c.atMessageId === scene.openedAtMessageId
		)
		const cause: SceneCause = {}
		if (cues.length)
			cause.openedBecause = (
				await sceneCueWording(ctx?.declaredTriggers ?? [], cues)
			).reason
		if (
			scene.closedAtMessageId == null &&
			ctx &&
			ctx.castRefresh &&
			ctx.settings.mode !== "manual"
		)
			cause.castCause = openSceneCastCause(ctx.genreName)
		if (cause.openedBecause || cause.castCause) out.set(scene.id, cause)
	}
	return out
}

// ── open / close / move ─────────────────────────────────────────────────────

/** Close `scene` at `at` on the caller's transaction (no cast, no checks). */
async function closeWithin(
	tx: Db,
	scene: SceneRow,
	at: number
): Promise<SceneRow> {
	const [msg] = await tx
		.select(MESSAGE_CLOCK)
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, at))
		.limit(1)
	const clock = clockOf(msg) ?? (await sessionClock(tx, scene.sessionId!))
	const selectedMessageIds = await derivedSelection(
		tx,
		scene,
		scene.openedAtMessageId!,
		at
	)
	const [closed] = await tx
		.update(schema.scenes)
		.set({
			closedAtMessageId: at,
			...prefixed("closed", clock),
			selectedMessageIds
		})
		.where(eq(schema.scenes.id, scene.id))
		.returning()
	return closed
}

/**
 * 🚧 **Note it in a scene** (`core:outlet/note-scene@1`, ★S4 2026-11-10):
 * append one note to `scenes.notes` — a fact that is not a story line. The
 * scene is `sceneId`, else the session's open scene on `channel`. One atomic
 * append, never a read-modify-write. Never writes history and never adds a
 * message; a closed or already compiled scene still takes the note.
 *
 * Refuses (`SceneBoundaryRefusal`, the sentence without the node prefix): blank
 * text; a genre that writes no scenes; lore writes off; a scene that is not
 * there or is another session's; no open scene to note.
 *
 * A replacement, Back or a delete of the note's message takes it back
 * (`takeSceneNotesAt`); Forward puts it back (`restoreSceneNotes`).
 */
export async function appendSceneNote(
	tx: Db,
	input: {
		sessionId: number
		/** A scene id; absent or null → the open scene on `channel`. */
		sceneId?: unknown
		/** The run's lane, any spelling; absent or blank → `main`. */
		channel?: string | null
		text: string
		runId: string | null
		messageId: number | null
	}
): Promise<{
	sceneId: number
	notes: NonNullable<SceneRow["notes"]>
	lockedNote?: string
}> {
	const { sessionId } = input
	// 🚧 Provisional copy: the owner has not seen these sentences.
	const text = typeof input.text === "string" ? input.text.trim() : ""
	if (!text) throw new SceneBoundaryRefusal("a note needs text.")
	if (await sceneWriteRefusal(tx, sessionId))
		throw new SceneBoundaryRefusal("this genre keeps no scenes.")
	const off = await loreWritesOffRefusal(tx, sessionId)
	if (off) throw new SceneBoundaryRefusal(off)

	const sceneColumns = {
		id: schema.scenes.id,
		sessionId: schema.scenes.sessionId,
		channel: schema.scenes.channel,
		name: schema.scenes.name,
		nameIsDefault: schema.scenes.nameIsDefault,
		openedAtMessageId: schema.scenes.openedAtMessageId,
		selectedMessageIds: schema.scenes.selectedMessageIds,
		notes: schema.scenes.notes,
		sceneLock: schema.scenes.sceneLock
	}
	let id: number
	let target: {
		id: number
		sessionId: number | null
		channel: string
		name: string | null
		nameIsDefault: boolean
		openedAtMessageId: number | null
		selectedMessageIds: number[]
		notes: SceneRow["notes"]
		sceneLock: boolean
	}
	if (input.sceneId !== undefined && input.sceneId !== null) {
		const n = Number(input.sceneId)
		const missing = `there is no scene ${String(input.sceneId)}.`
		if (!Number.isSafeInteger(n) || n <= 0) throw new SceneBoundaryRefusal(missing)
		const [row] = await tx
			.select(sceneColumns)
			.from(schema.scenes)
			.where(eq(schema.scenes.id, n))
			.limit(1)
		if (!row) throw new SceneBoundaryRefusal(missing)
		if (row.sessionId !== sessionId)
			throw new SceneBoundaryRefusal("that scene belongs to another session.")
		id = row.id
		target = row
	} else {
		const channel = canonicalChannel(input.channel ?? "main")
		const [open] = await tx
			.select(sceneColumns)
			.from(schema.scenes)
			.where(
				and(
					eq(schema.scenes.sessionId, sessionId),
					eq(schema.scenes.channel, channel),
					sql`${schema.scenes.openedAtMessageId} IS NOT NULL`,
					sql`${schema.scenes.closedAtMessageId} IS NULL`
				)
			)
			.limit(1)
		if (!open)
			throw new SceneBoundaryRefusal(
				"no scene is open to note; open one first (propose-scene-cue@1)."
			)
		id = open.id
		target = open
	}

	// A locked scene takes no run's note: nothing is written and the run is told.
	if (sceneLockedAgainstRuns(target)) {
		const shown = (await sceneDisplayNames(tx, [target])).get(target.id)
		return {
			sceneId: id,
			notes: target.notes ?? [],
			lockedNote: RUN_LOCK_SENTENCES.scene(shown ?? target.name ?? "This scene")
		}
	}

	const note = {
		text,
		runId: input.runId,
		messageId: input.messageId,
		at: new Date().toISOString()
	}
	const [row] = await tx
		.update(schema.scenes)
		.set({
			notes: sql`coalesce(${schema.scenes.notes}, '[]'::jsonb) || ${JSON.stringify([note])}::jsonb`
		})
		.where(eq(schema.scenes.id, id))
		.returning({ notes: schema.scenes.notes })
	return { sceneId: id, notes: row?.notes ?? [note] }
}

/**
 * Open a scene at `atMessageId` on `channel`. A scene already open on the
 * channel is closed first, at the last line before the new boundary.
 *
 * 🚧 With `closeAt` the scene opens and closes in the one transaction — a
 * **closed** scene over `atMessageId … closeAt` (lane E, *Mark as scene*), so
 * any run that overlaps no range scene can be marked, an earlier one
 * included. A run wholly before the lane's open scene leaves that scene
 * open; a run after its opening closes it at the line before, as an open
 * does. A line of the run another scene captured by selection refuses it.
 */
export async function openScene(
	db: Db,
	params: {
		sessionId: number
		userId: number
		channel?: string | null
		atMessageId: number
		closeAt?: number | null
		/** 🚧 Why it opened, for the `scene-opened` it emits — a person's press unless said. */
		cause?: EventCause
	}
): Promise<LiveSceneResult> {
	const { sessionId, userId } = params
	const session = await ownedSession(db, sessionId, userId)
	await assertSessionMayWriteScenes(db, sessionId)
	// 🚧 pr-6 (§B-3a): no shared book — a scene is filed in the session's
	// own book, which is main-line only.
	const lorebookId = session.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
	if (lorebookId == null) throw new SceneBoundaryRefusal("That session is gone.")
	const branchId = session.lorebookId != null ? (session.lorebookBranchId ?? null) : null
	const channel = canonicalChannel(params.channel ?? "main")
	const at = Number(params.atMessageId)
	if (!Number.isInteger(at))
		throw new SceneBoundaryRefusal("Say which message the scene starts at.")
	const closeAt = params.closeAt != null ? Number(params.closeAt) : null
	if (closeAt != null && !Number.isInteger(closeAt))
		throw new SceneBoundaryRefusal("Say which message the scene ends at.")
	if (closeAt != null && closeAt < at)
		throw new SceneBoundaryRefusal(
			"A scene cannot end before the message it starts at."
		)

	let result: { scene: SceneRow; closed?: SceneRow }
	try {
		result = await db.transaction(async (tx) => {
			await lockBookCalendar(tx, lorebookId)
			await lockCapture(tx, sessionId)
			try {
				await lineOfBook(tx, lorebookId, branchId)
			} catch (e) {
				if (e instanceof BranchRefusal)
					throw new SceneBoundaryRefusal(
						"This session's line is not one of this lorebook's.",
						{ cause: e }
					)
				throw e
			}
			const msg = await boundaryMessage(tx, sessionId, channel, at)
			const endMsg =
				closeAt != null
					? await boundaryMessage(tx, sessionId, channel, closeAt)
					: null

			const others = await rangeScenes(tx, sessionId, channel)
			const open = others.find((s) => s.closedAtMessageId == null)
			let closed: SceneRow | undefined
			// A closed run wholly before the open scene leaves it open.
			const beforeOpen =
				!!open && closeAt != null && closeAt < open.openedAtMessageId!
			if (open && !beforeOpen) {
				if (at <= open.openedAtMessageId!)
					throw new SceneBoundaryRefusal(
						`${open.name ?? "The open scene"} is open from a later message; move its start instead.`
					)
				const end = await lineBefore(tx, sessionId, channel, at)
				closed = await closeWithin(tx, open, end ?? open.openedAtMessageId!)
			}
			assertNoOverlap(
				[at, closeAt],
				others
					.filter((s) => s.id !== closed?.id)
					.concat(closed ? [closed] : [])
			)
			const taken = await capturedElsewhere(tx, sessionId, -1)
			if (taken.has(at))
				throw new SceneBoundaryRefusal(
					"That message is already in another scene. A message belongs to one scene."
				)
			let selectedMessageIds: number[] | undefined
			if (closeAt != null) {
				const run = await laneLineIds(tx, sessionId, channel, at, closeAt)
				if (run.some((id) => taken.has(id)))
					throw new SceneBoundaryRefusal(
						"Some of those lines are already in another scene. A message belongs to one scene."
					)
				selectedMessageIds = (
					await storyLinesInRange(tx, sessionId, channel, at, closeAt)
				).map((l) => l.id)
			}

			const clock = clockOf(msg) ?? (await sessionClock(tx, sessionId))
			const endClock =
				endMsg != null
					? (clockOf(endMsg) ?? (await sessionClock(tx, sessionId)))
					: null
			const name = await sceneNameFor(tx, sessionId, channel, lorebookId, clock, at)
			const [scene] = await tx
				.insert(schema.scenes)
				.values({
					lorebookId,
					sessionId,
					historyEntryId: null,
					branchId,
					channel,
					name,
					nameIsDefault: true,
					openedAtMessageId: at,
					...prefixed("opened", clock),
					...(closeAt != null
						? {
								closedAtMessageId: closeAt,
								...prefixed("closed", endClock),
								selectedMessageIds
							}
						: {}),
					summaryStatus: "none"
				})
				.returning()
			return { scene, closed }
		})
	} catch (err) {
		if (isOpenSceneConflict(err))
			throw new SceneBoundaryRefusal(
				"This session already has an open scene on that channel.",
				{ cause: err }
			)
		throw err
	}

	if (result.closed)
		await proposeAndWriteCast(db, result.closed, {
			by: { sessionId },
			cause: "scene-compiler"
		})
	const castProposal = await proposeAndWriteCast(db, result.scene)
	/**
	 * 🚧 The session moments (PLAN-layering D7, lane 6): the scene this
	 * opening closed, then the scene it opened — when it is a live scene
	 * still open (not a range filed after the fact). Registrations and
	 * routines answer them (*Picture each new scene* is a routine on
	 * `scene-opened`). Never the reason a scene fails to open.
	 */
	{
		const { noteScene } = await import("$lib/server/pipelines/routines/moments")
		const moment = { sessionId, userId, cause: params.cause ?? { kind: "user" as const, userId } }
		if (result.closed)
			await noteScene(db, { ...moment, opened: false, sceneId: result.closed.id, messageId: result.closed.closedAtMessageId })
		// Held changes apply as the scene closes (after the commit; never the reason the close fails).
		if (result.closed) await applyAtSceneClose(db, sessionId, result.closed.id)
		if (closeAt == null) await noteScene(db, { ...moment, opened: true, sceneId: result.scene.id, messageId: at })
	}
	return {
		sessionId,
		scene: await reread(db, result.scene.id),
		...(result.closed
			? { closedScene: await reread(db, result.closed.id) }
			: {}),
		castProposal
	}
}

/**
 * 🚧 A scene has closed and its transaction has committed: the session's held
 * changes apply (`applyHeldAutomatically`, "scene-close"; it waits itself while
 * the scene's summary is being written or reviewed). Guarded: a failure here
 * is a warning, never the reason the close fails.
 */
async function applyAtSceneClose(db: Db, sessionId: number, sceneId: number): Promise<void> {
	try {
		const { applyHeldAutomaticallyAndTell } = await import("$lib/server/sockets/sessions")
		await applyHeldAutomaticallyAndTell(db, { sessionId, automatic: "scene-close", sceneId })
	} catch (err) {
		console.warn(`[scenes] the automatic apply for scene ${sceneId} failed:`, err)
	}
}

async function reread(db: Db, id: number): Promise<SceneRow> {
	const [row] = await db
		.select()
		.from(schema.scenes)
		.where(eq(schema.scenes.id, id))
		.limit(1)
	return row
}

/** The live scene `sceneId`, checked for the owner. */
async function ownedLiveScene(db: Db, sceneId: number, userId: number) {
	const scene = await reread(db, Number(sceneId))
	if (!scene) throw new SceneBoundaryRefusal("Scene not found.")
	if (scene.sessionId == null)
		throw new SceneBoundaryRefusal(
			"This scene's session is gone, so its boundaries cannot move."
		)
	await ownedSession(db, scene.sessionId, userId)
	if (scene.openedAtMessageId == null)
		throw new SceneBoundaryRefusal(
			"This scene was captured by selection; it has no boundaries to move."
		)
	await assertSessionMayWriteScenes(db, scene.sessionId)
	return scene as SceneRow & { sessionId: number; openedAtMessageId: number }
}

/** Close the open scene at `atMessageId`, or at the channel's newest line. */
export async function closeScene(
	db: Db,
	params: {
		sceneId: number
		userId: number
		atMessageId?: number | null
		/** 🚧 Why it closed, for the `scene-closed` it emits — a person's press unless said. */
		cause?: EventCause
	}
): Promise<LiveSceneResult> {
	const scene = await ownedLiveScene(db, params.sceneId, params.userId)
	if (scene.closedAtMessageId != null)
		throw new SceneBoundaryRefusal("That scene is already closed.")
	const closed = await db.transaction(async (tx) => {
		await lockCapture(tx, scene.sessionId)
		const at =
			params.atMessageId != null
				? Number(params.atMessageId)
				: await newestLineId(
						tx,
						scene.sessionId,
						scene.channel,
						scene.openedAtMessageId
					)
		if (at == null || !Number.isInteger(at))
			throw new SceneBoundaryRefusal("Say which message the scene ends at.")
		await boundaryMessage(tx, scene.sessionId, scene.channel, at)
		if (at < scene.openedAtMessageId)
			throw new SceneBoundaryRefusal(
				"A scene cannot end before the message it starts at."
			)
		assertNoOverlap(
			[scene.openedAtMessageId, at],
			await rangeScenes(tx, scene.sessionId, scene.channel, scene.id)
		)
		return closeWithin(tx, scene, at)
	})
	const castProposal = await proposeAndWriteCast(db, closed, {
		by: { sessionId: scene.sessionId },
		cause: "scene-compiler"
	})
	// 🚧 The session moment (PLAN-layering D7, lane 6): `scene-closed`.
	{
		const { noteScene } = await import("$lib/server/pipelines/routines/moments")
		await noteScene(db, {
			sessionId: scene.sessionId,
			userId: params.userId,
			cause: params.cause ?? { kind: "user", userId: params.userId },
			opened: false,
			sceneId: closed.id,
			messageId: closed.closedAtMessageId
		})
		await applyAtSceneClose(db, scene.sessionId, closed.id)
	}
	return {
		sessionId: scene.sessionId,
		scene: await reread(db, closed.id),
		castProposal
	}
}

/** The summary state a moved range leaves: out of date, unless a run is under way. */
const resetSummary = (scene: SceneRow): SceneRow["summaryStatus"] =>
	scene.summaryStatus === "running" ? "running" : "none"

/**
 * The reset as a patch. A summary the routine saved by itself also loses its
 * draft mark, so the routine takes the scene again once it is due
 * (`sceneSummaryDueOf` asks for no draft mark). A person's keeps it: what a
 * person saved or discarded is never taken.
 */
const summaryResetPatch = (
	scene: SceneRow
): Pick<typeof schema.scenes.$inferInsert, "summaryStatus" | "processedBySpecId"> => ({
	summaryStatus: resetSummary(scene),
	...(scene.summaryOrigin === "routine" && scene.summaryStatus === "done"
		? { processedBySpecId: null }
		: {})
})

/**
 * Move one or both boundaries of a scene. 🚧 `closedAt: null` (lane E)
 * **reopens** a closed scene — it runs on to its lane's newest line again —
 * refused while a later range scene stands on its lane. Every move resets
 * `summaryStatus` to `none`: a summary written for the old range is kept,
 * and reads as out of date until it is summarized again.
 */
export async function moveSceneBoundary(
	db: Db,
	params: {
		sceneId: number
		userId: number
		openedAt?: number | null
		closedAt?: number | null
	}
): Promise<LiveSceneResult> {
	const scene = await ownedLiveScene(db, params.sceneId, params.userId)
	const movesOpen = params.openedAt != null
	const reopens = params.closedAt === null
	const movesClose = params.closedAt != null
	if (!movesOpen && !movesClose && !reopens)
		throw new SceneBoundaryRefusal("Say which boundary moves, and to where.")
	if (movesClose && scene.closedAtMessageId == null)
		throw new SceneBoundaryRefusal(
			"The scene is still open; close it to give it an end."
		)
	if (reopens && scene.closedAtMessageId == null)
		throw new SceneBoundaryRefusal("That scene is already open.")

	let moved: SceneRow
	try {
		moved = await db.transaction(async (tx) => {
			await lockCapture(tx, scene.sessionId)
			const others = await rangeScenes(
				tx,
				scene.sessionId,
				scene.channel,
				scene.id
			)
			const opened = movesOpen ? Number(params.openedAt) : scene.openedAtMessageId
			const closedAt = reopens
				? null
				: movesClose
					? Number(params.closedAt)
					: scene.closedAtMessageId
			const patch: Partial<typeof schema.scenes.$inferInsert> = {
				...summaryResetPatch(scene)
			}
			if (movesOpen) {
				const msg = await boundaryMessage(tx, scene.sessionId, scene.channel, opened)
				const clock = clockOf(msg)
				patch.openedAtMessageId = opened
				if (clock) Object.assign(patch, prefixed("opened", clock))
			}
			if (movesClose) {
				const msg = await boundaryMessage(
					tx,
					scene.sessionId,
					scene.channel,
					closedAt!
				)
				const clock = clockOf(msg)
				patch.closedAtMessageId = closedAt
				if (clock) Object.assign(patch, prefixed("closed", clock))
			}
			if (reopens) {
				const later = others.find(
					(s) => s.openedAtMessageId! > scene.openedAtMessageId
				)
				if (later)
					throw new SceneBoundaryRefusal(
						`${later.name ?? "Another scene"} comes after it on this lane, so it cannot run on to the newest line. Remove that boundary first, or move this scene's end.`
					)
				Object.assign(patch, prefixed("closed", null), {
					closedAtMessageId: null,
					// The derived cache is written at close; an open scene has none.
					selectedMessageIds: []
				})
			}
			if (closedAt != null && closedAt < opened)
				throw new SceneBoundaryRefusal(
					"A scene cannot end before the message it starts at."
				)
			assertNoOverlap([opened, closedAt], others)
			if (closedAt != null)
				patch.selectedMessageIds = await derivedSelection(
					tx,
					scene,
					opened,
					closedAt
				)
			const [row] = await tx
				.update(schema.scenes)
				.set(patch)
				.where(eq(schema.scenes.id, scene.id))
				.returning()
			return row
		})
	} catch (err) {
		if (isOpenSceneConflict(err))
			throw new SceneBoundaryRefusal(
				"This session already has an open scene on that channel.",
				{ cause: err }
			)
		throw err
	}
	const castProposal = await proposeAndWriteCast(db, moved, {
		by: { sessionId: scene.sessionId },
		cause: "scene-compiler"
	})
	return {
		sessionId: scene.sessionId,
		scene: await reread(db, moved.id),
		castProposal
	}
}

/**
 * 🚧 **Merge** a live scene into the one before it on its lane (lane E) —
 * what *Remove boundary* does to a scene that has one: the earlier scene's
 * range runs on to the later one's end (open-ended when the later was the
 * open scene, which the earlier then becomes), the later row is removed with
 * its summary, and the earlier's `summaryStatus` is reset to `none` (its
 * text kept, out of date). Refused when no range scene precedes it.
 */
export async function mergeScene(
	db: Db,
	params: { sceneId: number; userId: number }
): Promise<MergedSceneResult> {
	const scene = await ownedLiveScene(db, params.sceneId, params.userId)
	const merged = await db.transaction(async (tx) => {
		await lockCapture(tx, scene.sessionId)
		const earlier = (
			await rangeScenes(tx, scene.sessionId, scene.channel, scene.id)
		).filter((s) => s.openedAtMessageId! < scene.openedAtMessageId)
		const previous = earlier.at(-1)
		if (!previous)
			throw new SceneBoundaryRefusal(
				"No scene comes before it on this lane, so there is nothing to join it to."
			)
		// The later row goes first: when it is the lane's open scene, the
		// earlier one takes that place (one open scene per lane).
		await tx.delete(schema.scenes).where(eq(schema.scenes.id, scene.id))
		const end = scene.closedAtMessageId
		const [row] = await tx
			.update(schema.scenes)
			.set({
				closedAtMessageId: end,
				...prefixed("closed", end != null ? sceneClockOf(scene, "closed") : null),
				selectedMessageIds:
					end != null
						? await derivedSelection(
								tx,
								previous,
								previous.openedAtMessageId!,
								end
							)
						: [],
				...summaryResetPatch(previous)
			})
			.where(eq(schema.scenes.id, previous.id))
			.returning()
		return row
	})
	const castProposal = await proposeAndWriteCast(db, merged, {
		by: { sessionId: scene.sessionId },
		cause: "scene-compiler"
	})
	return {
		sessionId: scene.sessionId,
		scene: await reread(db, merged.id),
		removedSceneId: scene.id,
		castProposal
	}
}

// ── process: which spec summarizes a scene ─────────────────────────────────

/** Core's default summarize-scene spec — what runs when a genre names none. */
export const DEFAULT_SUMMARIZE_SCENE_SPEC_ID = "core:spec/summarize-scene"

/**
 * The summarize-scene spec for a session (PROPOSAL-live-scenes §13, item 3):
 * the one its registrations run on the summarize-scene action
 * (`summaryRegistrationOf`), else its genre's declared `summarize.scene`, else core's
 * default. A genre whose declared spec is not published here (its plugin
 * uninstalled or disabled) falls back to the default with a note the review
 * shows. Resolution is the socket's, never the view's.
 */
export async function resolveSummarizeSceneSpec(
	db: Db,
	sessionId: number | null
): Promise<{ specId: string; note?: string }> {
	if (sessionId == null) return { specId: DEFAULT_SUMMARIZE_SCENE_SPEC_ID }
	const { summaryRegistrationOf } = await import("$lib/server/pipelines/registrations/summaryRegistration")
	const registered = await summaryRegistrationOf(db, sessionId, "scene")
	if (registered) return { specId: registered.spec }
	const [row] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return declaredSummarizeSceneSpec(db, row?.genreId ?? null)
}

/**
 * 🚧 The summarize-scene spec a genre's sessions resolve to — the same rule
 * `resolveSummarizeSceneSpec` applies to a session, from the genre id (the
 * settings form has no session yet when it creates one): the genre's own
 * registration on the summarize-scene action, else its declared
 * `summarize.scene`, else core's default.
 */
export async function resolveSummarizeSceneSpecOfGenre(
	db: Db,
	genreId: string | null
): Promise<{ specId: string; note?: string }> {
	if (!genreId) return { specId: DEFAULT_SUMMARIZE_SCENE_SPEC_ID }
	const { summaryRegistrationIn } = await import("$lib/server/pipelines/registrations/summaryRegistration")
	const { genreRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	const registered = summaryRegistrationIn(await genreRegistrations(db, genreId), "scene")
	if (registered) return { specId: registered.spec }
	return declaredSummarizeSceneSpec(db, genreId)
}

/** The genre's declared `summarize.scene` (a plugin genre's by its manifest), else core's default, with a note when the declared spec is not published. */
async function declaredSummarizeSceneSpec(
	db: Db,
	genreId: string | null
): Promise<{ specId: string; note?: string }> {
	if (!genreId) return { specId: DEFAULT_SUMMARIZE_SCENE_SPEC_ID }
	const { getGenre } = await import("@serene-pub/sdk")
	// 🚧 lane A exports this: `GenreDecl.summarize?: { scene?: string }`.
	const decl = getGenre(genreId) as
		| ({ summarize?: { scene?: unknown }; name?: unknown } & object)
		| undefined
	let declared = decl?.summarize?.scene
	if (!decl) {
		// A plugin's genre the in-process registry has not seen: its
		// manifest's declaration, as the session page reads it.
		const enabled = await db
			.select({ manifest: schema.plugins.manifest })
			.from(schema.plugins)
			.where(eq(schema.plugins.enabled, true))
		const fromManifest = enabled
			.flatMap(
				(e) =>
					((e.manifest as { genres?: unknown[] } | null)?.genres ??
						[]) as Array<{ id?: string; summarize?: { scene?: unknown } }>
			)
			.find((g) => g?.id === genreId)
		declared = fromManifest?.summarize?.scene
	}
	if (typeof declared !== "string" || !declared)
		return { specId: DEFAULT_SUMMARIZE_SCENE_SPEC_ID }
	if (declared === DEFAULT_SUMMARIZE_SCENE_SPEC_ID) return { specId: declared }
	const { publishedVersionOf } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	if (await publishedVersionOf(db, declared)) return { specId: declared }
	return {
		specId: DEFAULT_SUMMARIZE_SCENE_SPEC_ID,
		note: "Summarized with the default pipeline: this genre's is not installed."
	}
}

/**
 * 🚧 A spec's **declared boundary triggers** (★9, live scenes §15 G1): its
 * active published version's `contributes.boundaryTriggers`, each read on
 * its own (`boundaryTriggersOf` — one that does not read is left out). A
 * SELECT of the version row, never a document load. Empty for a spec that
 * declares none or is not published.
 */
export async function boundaryTriggersOfSpec(
	db: Db,
	specId: string
): Promise<import("@serene-pub/sdk").BoundaryTriggerDecl[]> {
	const [row] = await db
		.select({ contributes: schema.pipelineSpecVersions.contributes })
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId)
		)
		.where(
			and(
				eq(schema.pipelineSpecs.slug, specId),
				eq(schema.pipelineSpecVersions.status, "published")
			)
		)
		.limit(1)
	if (!row?.contributes) return []
	const { boundaryTriggersOf } = await import("@serene-pub/sdk")
	return boundaryTriggersOf(row.contributes)
}

/** 🚧 The declared boundary triggers a genre's sessions watch for: its summarize-scene spec's. */
export async function genreBoundaryTriggers(
	db: Db,
	genreId: string | null
): Promise<import("@serene-pub/sdk").BoundaryTriggerDecl[]> {
	const { specId } = await resolveSummarizeSceneSpecOfGenre(db, genreId)
	return boundaryTriggersOfSpec(db, specId)
}

/** 🚧 The declared boundary triggers one session watches for: its summarize-scene spec's. */
export async function sessionBoundaryTriggers(
	db: Db,
	sessionId: number
): Promise<import("@serene-pub/sdk").BoundaryTriggerDecl[]> {
	const { specId } = await resolveSummarizeSceneSpec(db, sessionId)
	return boundaryTriggersOfSpec(db, specId)
}

/**
 * The scene as the summarize request carries it (`request.scene`): its name,
 * 🚧 its place, and its opening date, spelled through the book's calendar.
 * What the transcript's preamble reads (`scene.name`, `scene.place`,
 * `scene.date`).
 *
 * 🚧 The place (live scenes §15 G17) is the genre's place as it stood at the
 * scene's opening line (`scenePlaceOf` read at that line, as the name was
 * written) — a tick-captured scene's first line; nothing for a genre that
 * names no place, or a scene whose session is gone. The name may carry it
 * too (`Scene N · <place>`); a renamed scene's does not, so the
 * preamble is told it apart from the name.
 */
export async function sceneHeaderOf(
	db: Db,
	scene: SceneRow
): Promise<{ name?: string; place?: string; date?: string }> {
	const out: { name?: string; place?: string; date?: string } = {}
	const shownName = (await sceneDisplayNames(db, [scene])).get(scene.id)
	if (shownName) out.name = shownName
	const opening =
		scene.openedAtMessageId ??
		(Array.isArray(scene.selectedMessageIds) && scene.selectedMessageIds.length
			? Math.min(...scene.selectedMessageIds)
			: null)
	if (scene.sessionId != null && opening != null) {
		const place = await scenePlaceOf(db, scene.sessionId, { messageId: opening })
		if (place) out.place = place
	}
	// A lorebook that keeps no timeline puts no date in the preamble.
	const { timelineOfBook, sessionTimelineOf } = await import("$lib/server/lorebooks/timeline")
	const keepsTimeline =
		scene.lorebookId != null
			? await timelineOfBook(db, scene.lorebookId)
			: scene.sessionId != null
				? await sessionTimelineOf(db, scene.sessionId)
				: true
	const clock = keepsTimeline ? sceneClockOf(scene, "opened") : null
	if (clock)
		out.date = formatDate(dayOf(clock), await bookCalendarOf(db, scene.lorebookId))
	// The preamble says each fact once: an automatic name already carries
	// its place and date (`Scene 2 · the Vault · Day 4`), so a part the
	// name already says is left out of the header.
	if (out.name) {
		const parts = out.name.split(" · ").map((p) => p.trim())
		if (out.place && parts.includes(out.place)) delete out.place
		if (out.date && parts.includes(out.date)) delete out.date
	}
	return out
}

/* ── scene boundaries under Back · Forward (pr-6 A2) ─────────────────────── */

/**
 * 🚧 What Back did to one scene at one taken row, for Forward to put back
 * (pr-6 C9, ruled 2026-10-24: "boundaries are anchored changes — Back
 * moves/removes them, Forward restores them"; shapes §A-2). Always the scene
 * as it stood BEFORE: `removed` — it opened at the taken row and was deleted;
 * `changed` — it was reopened, its close moved, or its selection trimmed.
 * A `removed` scene carries its cast as it stood; a record without one restores
 * the scene row alone.
 */
export type SceneBoundaryTaken =
	| { kind: "removed"; row: SceneRow; cast?: SceneCast }
	| { kind: "changed"; row: SceneRow }

/** 🚧 The notes one scene lost to `takeSceneNotesAt`, in their original order. */
export type SceneNotesTaken = { sceneId: number; notes: NonNullable<SceneRow["notes"]> }

/**
 * 🚧 **Take a message's notes back** (B2-1, 2026-11-10): from every scene of
 * its session, the notes whose `messageId` is `messageId` — a retake, Back
 * or delete of the turn that wrote them. Returns what it took, for
 * `restoreSceneNotes`. Inside the caller's transaction (`tx` only). A deleted
 * message names no session: hand it as `sessionId`.
 */
export async function takeSceneNotesAt(
	tx: Db,
	messageId: number,
	sessionId?: number
): Promise<SceneNotesTaken[]> {
	let sid = sessionId
	if (sid === undefined) {
		const [msg] = await tx
			.select({ sessionId: schema.sessionMessages.sessionId })
			.from(schema.sessionMessages)
			.where(eq(schema.sessionMessages.id, messageId))
			.limit(1)
		sid = msg?.sessionId ?? undefined
	}
	if (sid === undefined) return []
	const rows = await tx
		.select({ id: schema.scenes.id, notes: schema.scenes.notes })
		.from(schema.scenes)
		.where(and(eq(schema.scenes.sessionId, sid), sql`${schema.scenes.notes} IS NOT NULL`))
	const taken: SceneNotesTaken[] = []
	for (const row of rows) {
		const all = row.notes ?? []
		const mine = all.filter((n) => n.messageId === messageId)
		if (!mine.length) continue
		await tx
			.update(schema.scenes)
			.set({ notes: all.filter((n) => n.messageId !== messageId) })
			.where(eq(schema.scenes.id, row.id))
		taken.push({ sceneId: row.id, notes: mine })
	}
	return taken
}

/**
 * 🚧 Forward's half: the taken notes appended back in their original order,
 * skipping any already present (same text, run, message and time). A scene
 * that is gone takes nothing.
 */
export async function restoreSceneNotes(tx: Db, taken: readonly SceneNotesTaken[]): Promise<void> {
	for (const { sceneId, notes } of taken) {
		const [row] = await tx
			.select({ notes: schema.scenes.notes })
			.from(schema.scenes)
			.where(eq(schema.scenes.id, sceneId))
			.limit(1)
		if (!row) continue
		const have = row.notes ?? []
		const same = (a: (typeof have)[number], b: (typeof have)[number]) =>
			a.text === b.text && a.runId === b.runId && a.messageId === b.messageId && a.at === b.at
		const add = notes.filter((n) => !have.some((h) => same(h, n)))
		if (!add.length) continue
		await tx
			.update(schema.scenes)
			.set({ notes: [...have, ...add] })
			.where(eq(schema.scenes.id, sceneId))
	}
}

/** Reopen: no close, no closing clock, an empty selection, a reset summary. */
const reopenedPatch = (scene: SceneRow): Partial<typeof schema.scenes.$inferInsert> => ({
	closedAtMessageId: null,
	...prefixed("closed", null),
	selectedMessageIds: [],
	...summaryResetPatch(scene),
	updatedAt: new Date()
})

/**
 * 🚧 Back's half: the scene boundaries anchored to `messageId`, taken, in the
 * order taken — inside the caller's transaction. Called by
 * `retractStateAnchoredTo` (a row that leaves and a row that is replaced alike)
 * and by `deleteTurnYield`. Rules, in order (shapes §A-2): a scene opened at the
 * row is removed and the one before it reopens; a scene closed at the row
 * reopens (or its close moves back); a selection holding the row loses it.
 * A scene with a person's applied summary is never touched (one the scene
 * summaries routine saved is taken like an unsummarized scene). A scene is also left exactly
 * as it is when a later live line of the session sits after the row on its
 * channel and stays: a boundary goes with the newest line, not with an older one
 * that later lines already sit in. `opts.leavingWith` lists rows that leave in
 * the same transaction; they do not count as later lines.
 */
export async function takeSceneBoundariesAt(
	tx: Db,
	messageId: number,
	opts: { leavingWith?: readonly number[] } = {}
): Promise<SceneBoundaryTaken[]> {
	const leaving = opts.leavingWith ?? []
	const taken: SceneBoundaryTaken[] = []
	const [msg] = await tx
		.select({ sessionId: schema.sessionMessages.sessionId })
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!msg?.sessionId) return taken
	const sessionId = msg.sessionId
	const sceneRows = () =>
		tx.select().from(schema.scenes).where(eq(schema.scenes.sessionId, sessionId))
	// A summary the scene summaries routine saved is not yet the record: Back takes
	// that scene as an unsummarized one (its status goes `none`, the origin stays).
	const notDone = (s: SceneRow) => s.summaryStatus !== "done" || s.summaryOrigin === "routine"

	// 1. Scenes opened at the row.
	for (const s of (await sceneRows()).filter(
		(x) => x.openedAtMessageId === messageId && notDone(x)
	)) {
		if (await laterLineStays(tx, sessionId, s.channel, messageId, leaving)) continue
		const cast = await readSceneCast(s.id, tx)
		await tx.delete(schema.scenes).where(eq(schema.scenes.id, s.id))
		taken.push({ kind: "removed", row: s, cast })
		const before = await lineBefore(tx, sessionId, s.channel, messageId)
		const prior = (await sceneRows())
			.filter(
				(x) =>
					x.channel === s.channel &&
					x.openedAtMessageId != null &&
					x.openedAtMessageId < messageId
			)
			.sort((a, b) => b.openedAtMessageId! - a.openedAtMessageId!)[0]
		if (
			prior &&
			notDone(prior) &&
			prior.closedAtMessageId != null &&
			prior.closedAtMessageId === before
		) {
			await tx
				.update(schema.scenes)
				.set(reopenedPatch(prior))
				.where(eq(schema.scenes.id, prior.id))
			taken.push({ kind: "changed", row: prior })
		}
	}

	// 2. Scenes closed at the row.
	for (const s of (await sceneRows()).filter(
		(x) => x.closedAtMessageId === messageId && notDone(x)
	)) {
		if (await laterLineStays(tx, sessionId, s.channel, messageId, leaving)) continue
		const all = await sceneRows()
		const stands = all.some(
			(x) =>
				x.id !== s.id &&
				x.channel === s.channel &&
				x.openedAtMessageId != null &&
				(x.openedAtMessageId > (s.openedAtMessageId ?? 0) ||
					x.closedAtMessageId == null)
		)
		if (!stands) {
			await tx
				.update(schema.scenes)
				.set(reopenedPatch(s))
				.where(eq(schema.scenes.id, s.id))
		} else {
			const before = await lineBefore(tx, sessionId, s.channel, messageId)
			if (before == null || s.openedAtMessageId == null) continue
			const m = await boundaryMessage(tx, sessionId, s.channel, before)
			await tx
				.update(schema.scenes)
				.set({
					closedAtMessageId: before,
					...prefixed("closed", clockOf(m)),
					selectedMessageIds: await derivedSelection(
						tx,
						s,
						s.openedAtMessageId,
						before
					),
					...summaryResetPatch(s),
					updatedAt: new Date()
				})
				.where(eq(schema.scenes.id, s.id))
		}
		taken.push({ kind: "changed", row: s })
	}

	// 3. Selections holding the row.
	for (const s of (await sceneRows()).filter(
		(x) =>
			notDone(x) && ((x.selectedMessageIds ?? []) as number[]).includes(messageId)
	)) {
		if (await laterLineStays(tx, sessionId, s.channel, messageId, leaving)) continue
		const left = ((s.selectedMessageIds ?? []) as number[]).filter(
			(id) => id !== messageId
		)
		if (s.openedAtMessageId == null && left.length === 0) {
			const cast = await readSceneCast(s.id, tx)
			await tx.delete(schema.scenes).where(eq(schema.scenes.id, s.id))
			taken.push({ kind: "removed", row: s, cast })
		} else {
			await tx
				.update(schema.scenes)
				.set({ selectedMessageIds: left, updatedAt: new Date() })
				.where(eq(schema.scenes.id, s.id))
			taken.push({ kind: "changed", row: s })
		}
	}
	return taken
}

/**
 * 🚧 Forward's half: each taken record put back, the LAST taken first — a
 * removed scene inserted again with its id, a changed one set back column for
 * column. Inside the caller's transaction.
 */
export async function restoreSceneBoundaries(tx: Db, taken: readonly SceneBoundaryTaken[]): Promise<void> {
	for (const t of [...taken].reverse()) {
		if (t.kind === "removed") {
			await tx.insert(schema.scenes).values(t.row)
			// Put back as stored, with no Edit history row: restoring is not a new change.
			// A member deleted since is skipped.
			if (t.cast) {
				const ids = [...t.cast.participantCharacters, ...t.cast.mentionedCharacters]
				const live = new Set(
					ids.length
						? (
								await tx
									.select({ id: schema.lorebookBindings.id })
									.from(schema.lorebookBindings)
									.where(inArray(schema.lorebookBindings.id, ids))
							).map((r) => r.id)
						: []
				)
				await writeSceneCast(
					t.row.id,
					{
						participantCharacters: t.cast.participantCharacters.filter((i) => live.has(i)),
						mentionedCharacters: t.cast.mentionedCharacters.filter((i) => live.has(i))
					},
					tx
				)
			}
		} else {
			await tx.update(schema.scenes).set(t.row).where(eq(schema.scenes.id, t.row.id))
		}
	}
}

/** 🚧 Each scene's folded lore sources (pr-6s2 G5): one grouped read of `lore_sources` (subject `scene`) and one read of the through lines' times; a scene with none is absent. */
export async function sceneLoreSourcesOf(
	db: Db,
	sceneIds: readonly number[]
): Promise<Map<number, Sockets.Scenes.List.SceneLoreSources>> {
	const out = new Map<number, Sockets.Scenes.List.SceneLoreSources>()
	if (!sceneIds.length) return out
	const ls = schema.loreSources
	const rows = await db
		.select({
			subjectId: ls.subjectId,
			from: sql<number>`min(${ls.fromMessageId})`.mapWith(Number),
			through: sql<number>`max(${ls.throughMessageId})`.mapWith(Number)
		})
		.from(ls)
		.where(and(eq(ls.subjectKind, "scene"), inArray(ls.subjectId, [...sceneIds])))
		.groupBy(ls.subjectId)
	if (!rows.length) return out
	const times = await db
		.select({ id: schema.messages.id, createdAt: schema.messages.createdAt })
		.from(schema.messages)
		.where(inArray(schema.messages.id, [...new Set(rows.map((r) => r.through))]))
	const at = new Map(times.map((t) => [t.id, t.createdAt]))
	for (const r of rows) {
		const t = at.get(r.through)
		const d = t ? new Date(t as any) : null
		out.set(r.subjectId, {
			fromMessageId: r.from,
			throughMessageId: r.through,
			throughAt: d && Number.isFinite(d.getTime()) ? d.toISOString() : null
		})
	}
	return out
}
