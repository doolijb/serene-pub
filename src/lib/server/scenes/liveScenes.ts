/**
 * 🚧 Live scenes (PROPOSAL-live-scenes §3, §8, §14 B): a scene is **opened**
 * at a message and stays the open scene until it is closed. The run between
 * the two boundaries IS the scene — no selection — so "unbroken" and "one
 * scene per message" hold by construction on its channel.
 *
 * Three deterministic things happen at a boundary, none of them a model:
 *
 * 1. **Filing** (at open): under the history entry the session reads *now* —
 *    the newest entry on the session's line dated at or before the clock. When
 *    the clock has stepped past that entry's day, the boundary **creates the
 *    entry dated at the clock** (not one step past the newest). A line with no
 *    clock and no history starts at Year 1, Month 1, Day 1, as a session's
 *    other lore writes do (`historyDateOfSessionWrite`).
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
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { canonicalChannel } from "$lib/server/messages/channels"
import { liveMessageWhere } from "$lib/server/messages/store"
import {
	loreWritesOffRefusal,
	sceneWriteRefusal
} from "$lib/server/messages/writes"
import {
	assertDateLands,
	bookCalendarOf,
	clockOf,
	clockOfNow,
	lockBookCalendar,
	sessionStoryNowOf
} from "$lib/server/state/storyTime"
import {
	historyEntryDate,
	lineOfBook,
	BranchRefusal
} from "$lib/server/state/reading"
import { rowReadsOnLine } from "$lib/shared/lorebooks/lineReading"
import {
	compareDates,
	formatDate,
	type StoryClock,
	type StoryDate
} from "$lib/shared/lorebooks/storyDate"
import { HISTORY_TYPE_ID, entryInsert } from "$lib/server/utils/lorebookEntries"
import { writeSceneCast, readSceneCast } from "$lib/server/utils/sceneCast"
import {
	proposeSceneCast,
	type CastTurn,
	type RosterMember
} from "$lib/server/utils/sceneCastProposal"
import { resolveOrCreateBinding } from "$lib/server/utils/characterBindingSync"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"
import { resolvePersonaName } from "$lib/shared/utils/resolveCharacterName"

/** A refusal worded for the person who asked. */
export class SceneBoundaryRefusal extends Error {}

type SceneRow = typeof schema.scenes.$inferSelect

/** One proposed participant, with the evidence the review shows. */
export interface ProposedSceneCastMember {
	key: string
	name: string
	evidenceLabel: string
	/** The book's member it was written as; null for an open-tier name (not written). */
	bindingId: number | null
}

export interface LiveSceneResult {
	scene: SceneRow
	sessionId: number
	/** The scene an open closed first, when one was open on the channel. */
	closedScene?: SceneRow
	createdHistoryEntry?: boolean
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
 * when null). Hidden lines are left out — the transcript a summary reads.
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
			personaId: schema.sessionMessages.personaId
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel),
				eq(schema.sessionMessages.isHidden, false),
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

// ── filing ──────────────────────────────────────────────────────────────────

/**
 * The history entry a scene opening at `clock` files under, created when the
 * clock has stepped past the newest entry's day. Inside the caller's
 * transaction, under the book's lock.
 */
export async function fileSceneUnder(
	tx: Db,
	lorebookId: number,
	branchId: number | null,
	clock: StoryClock | null
): Promise<{ historyEntryId: number; created: boolean }> {
	let line
	try {
		line = await lineOfBook(tx, lorebookId, branchId)
	} catch (e) {
		if (e instanceof BranchRefusal)
			throw new SceneBoundaryRefusal(
				"This session's line is not one of this lorebook's.",
				{ cause: e }
			)
		throw e
	}
	const rows = await tx
		.select({
			id: schema.lorebookEntries.id,
			branchId: schema.lorebookEntries.branchId,
			fields: schema.lorebookEntries.fields,
			position: schema.lorebookEntries.position
		})
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
			)
		)
	const target = clock ? dayOf(clock) : null
	let best: { id: number; date: StoryDate; position: number } | null = null
	for (const row of rows) {
		const date = historyEntryDate(row.fields)
		if (!date || !rowReadsOnLine(row, line, date)) continue
		if (target && compareDates(date, target) > 0) continue
		const order = best ? compareDates(date, best.date) : 1
		if (order > 0 || (order === 0 && row.position > best!.position))
			best = { id: row.id, date, position: row.position }
	}
	if (best && (!target || compareDates(best.date, target) === 0))
		return { historyEntryId: best.id, created: false }

	// Nothing on the line is dated at the clock's day: the boundary makes the
	// entry, dated at the clock — or at Year 1, Month 1, Day 1 on a line with
	// no dates at all.
	const date = target ?? { year: 1, month: 1, day: 1 }
	await assertDateLands(tx, lorebookId, date)
	const [last] = await tx
		.select({ position: schema.lorebookEntries.position })
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
			)
		)
		.orderBy(desc(schema.lorebookEntries.position))
		.limit(1)
	const [created] = await tx
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				typeId: HISTORY_TYPE_ID,
				lorebookId,
				keys: [],
				content: "",
				year: date.year,
				month: date.month ?? null,
				day: date.day ?? null,
				position: (last?.position ?? -1) + 1,
				branchId
			} as any)
		)
		.returning({ id: schema.lorebookEntries.id })
	return { historyEntryId: created.id, created: true }
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
	const { sessionLinks, vocabularyFor, valueOf, slotKey, qualifiedSlotKey } =
		await import("$lib/server/state/resolve")
	const links = await sessionLinks(db, sessionId)
	const vocabulary = await vocabularyFor(db, sessionId, links)
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

/** `Scene N` [` · <place>`] [` · <date>`], deterministic — the place as it stood at the opening line. */
async function sceneNameFor(
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
	const parts = [`Scene ${prior.length + 1}`]
	const place = await scenePlaceOf(db, sessionId, { messageId: at })
	if (place) parts.push(place)
	const previous = prior[0]
	const previousClock = previous
		? (sceneClockOf(previous, "closed") ?? sceneClockOf(previous, "opened"))
		: null
	if (clock && !sameDay(clock, previousClock))
		parts.push(formatDate(dayOf(clock), await bookCalendarOf(db, lorebookId)))
	return parts.join(" · ")
}

// ── cast ────────────────────────────────────────────────────────────────────

/**
 * Propose the scene's cast from its lines (`proposeSceneCast`, no model) and
 * write the participants that resolve to a card as the scene's
 * `scene_characters`. Open-tier names are returned, not written: a name with
 * no member is a person's to accept.
 */
async function proposeAndWriteCast(
	db: Db,
	scene: SceneRow
): Promise<ProposedSceneCastMember[]> {
	const proposal = await readCastProposal(db, scene)
	if (!proposal) return []
	return writeProposedCast(db, scene, proposal)
}

/** Write a proposal's card participants as the scene's `scene_characters` — open and close's write. */
async function writeProposedCast(
	db: Db,
	scene: SceneRow,
	proposal: NonNullable<Awaited<ReturnType<typeof readCastProposal>>>
): Promise<ProposedSceneCastMember[]> {
	const out: ProposedSceneCastMember[] = []
	const participantIds: number[] = []
	for (const p of proposal.participants) {
		const m = /^character:(\d+)$/.exec(p.key)
		let bindingId: number | null = null
		if (m) {
			bindingId = await resolveOrCreateBinding(
				{ lorebookId: scene.lorebookId, characterId: Number(m[1]) },
				db
			)
			if (bindingId != null) participantIds.push(bindingId)
		}
		out.push({
			key: p.key,
			name: p.name,
			evidenceLabel: p.evidenceLabel,
			bindingId
		})
	}
	await writeSceneCast(scene.id, { participantCharacters: participantIds }, db)
	await db
		.update(schema.scenes)
		.set({ castResolvedAt: new Date() })
		.where(eq(schema.scenes.id, scene.id))
	return out
}

/**
 * 🚧 Keep an **open** scene's stored cast current (live scenes §15 G3): a
 * line landed on its lane, so propose the cast again (`proposeSceneCast`, no
 * model) and write it as open and close do — but only when the proposal's
 * card participants differ from the stored ones, so a line by someone
 * already in the scene writes nothing. True when the cast was rewritten.
 * Only an open range scene the line belongs to (at or after its opening);
 * anything else is left alone.
 */
export async function refreshOpenSceneCast(
	db: Db,
	params: { sessionId: number; channel: string; messageId: number }
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
	const proposal = await readCastProposal(db, scene)
	if (!proposal) return false
	const proposed = new Set(
		proposal.participants.flatMap((p) => {
			const m = /^character:(\d+)$/.exec(p.key)
			return m ? [Number(m[1])] : []
		})
	)
	const stored = await readSceneCast(scene.id, db)
	const storedCharacters = stored.participantCharacters.length
		? await db
				.select({ characterId: schema.lorebookBindings.characterId })
				.from(schema.lorebookBindings)
				.where(inArray(schema.lorebookBindings.id, stored.participantCharacters))
		: []
	const had = new Set(
		storedCharacters
			.map((r) => r.characterId)
			.filter((v): v is number => v != null)
	)
	const same =
		had.size === proposed.size &&
		stored.participantCharacters.length === had.size &&
		[...proposed].every((id) => had.has(id))
	if (same) return false
	await writeProposedCast(db, scene, proposal)
	return true
}

/**
 * 🚧 The scene's cast as `proposeSceneCast` proposes it now — senders,
 * roster, names in the lines (no model), each with its evidence — and
 * nothing written: what Chronicle's *Open scene* card shows while the scene
 * is still being played. Null for a scene with no range.
 */
export async function readCastProposal(
	db: Db,
	scene: SceneRow
): Promise<{
	participants: Array<{ key: string; name: string; evidenceLabel: string }>
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
	const [sessionChars, sessionPersonas] = await Promise.all([
		db
			.select({ characterId: schema.sessionCharacters.characterId })
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, scene.sessionId),
					eq(schema.sessionCharacters.isActive, true)
				)
			),
		db
			.select({ personaId: schema.sessionPersonas.personaId })
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, scene.sessionId))
	])
	const rosterIds = [
		...sessionChars.map((r) => r.characterId),
		...sessionPersonas.map((r) => r.personaId)
	].filter((v): v is number => v != null)
	const allIds = [...new Set([...ids, ...rosterIds])]
	const cards = allIds.length
		? await db
				.select()
				.from(schema.characters)
				.where(inArray(schema.characters.id, allIds))
		: []
	// A persona is a character row (0132); it is named as the summarizer names
	// a persona's line (`resolvePersonaName`), a character by its name.
	const personaIds = new Set([
		...lines.map((l) => l.personaId),
		...sessionPersonas.map((r) => r.personaId)
	])
	const nameOf = new Map(
		cards.map((c) => [
			c.id,
			personaIds.has(c.id) ? resolvePersonaName(c) : c.name
		])
	)
	const turns: CastTurn[] = lines.map((l, i) => {
		const sender = l.characterId ?? l.personaId
		return {
			index: i + 1,
			content: l.content,
			senderKey: sender != null ? `character:${sender}` : null,
			senderName: sender != null ? nameOf.get(sender) : undefined
		}
	})
	const roster: RosterMember[] = rosterIds
		.filter((id) => nameOf.has(id))
		.map((id) => ({ key: `character:${id}`, name: nameOf.get(id)! }))
	let gazetteer
	try {
		const { loadVocabulary } = await import("$lib/server/annotations")
		gazetteer = (await loadVocabulary(db, scene.lorebookId)).gazetteer
	} catch {
		gazetteer = undefined
	}
	const proposal = proposeSceneCast(turns, { roster, gazetteer })
	return {
		participants: proposal.participants.map((p) => ({
			key: p.key,
			name: p.name,
			evidenceLabel: p.evidenceLabel
		})),
		lineCount: lines.length
	}
}

/** The scene as a reply carries it: no vectors, cast projected. */
export async function sceneReplyRow(db: Db, scene: SceneRow) {
	const { embedding: _e, embeddingModel: _m, ...rest } = scene
	return { ...rest, ...(await readSceneCast(scene.id, db)) }
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

	let result: { scene: SceneRow; closed?: SceneRow; created: boolean }
	try {
		result = await db.transaction(async (tx) => {
			await lockBookCalendar(tx, lorebookId)
			await lockCapture(tx, sessionId)
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
			const filed = await fileSceneUnder(tx, lorebookId, branchId, clock)
			const name = await sceneNameFor(tx, sessionId, channel, lorebookId, clock, at)
			const [scene] = await tx
				.insert(schema.scenes)
				.values({
					lorebookId,
					sessionId,
					historyEntryId: filed.historyEntryId,
					branchId,
					channel,
					name,
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
			return { scene, closed, created: filed.created }
		})
	} catch (err) {
		if (isOpenSceneConflict(err))
			throw new SceneBoundaryRefusal(
				"This session already has an open scene on that channel.",
				{ cause: err }
			)
		throw err
	}

	if (result.closed) await proposeAndWriteCast(db, result.closed)
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
		if (closeAt == null) await noteScene(db, { ...moment, opened: true, sceneId: result.scene.id, messageId: at })
	}
	return {
		sessionId,
		scene: await reread(db, result.scene.id),
		...(result.closed
			? { closedScene: await reread(db, result.closed.id) }
			: {}),
		createdHistoryEntry: result.created,
		castProposal
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
	const castProposal = await proposeAndWriteCast(db, closed)
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
				summaryStatus: resetSummary(scene)
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
	const castProposal = await proposeAndWriteCast(db, moved)
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
				summaryStatus: resetSummary(previous)
			})
			.where(eq(schema.scenes.id, previous.id))
			.returning()
		return row
	})
	const castProposal = await proposeAndWriteCast(db, merged)
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
 * its genre's `summarize.scene`, else core's default. A genre whose spec is
 * not published here (its plugin uninstalled or disabled) falls back to the
 * default with a note the review shows. Resolution is the socket's, never
 * the view's.
 */
export async function resolveSummarizeSceneSpec(
	db: Db,
	sessionId: number | null
): Promise<{ specId: string; note?: string }> {
	if (sessionId == null) return { specId: DEFAULT_SUMMARIZE_SCENE_SPEC_ID }
	const [row] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return resolveSummarizeSceneSpecOfGenre(db, row?.genreId ?? null)
}

/**
 * 🚧 The summarize-scene spec a genre's sessions resolve to — the same rule
 * `resolveSummarizeSceneSpec` applies to a session, from the genre id (the
 * settings form has no session yet when it creates one).
 */
export async function resolveSummarizeSceneSpecOfGenre(
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
	if (scene.name) out.name = scene.name
	const opening =
		scene.openedAtMessageId ??
		(Array.isArray(scene.selectedMessageIds) && scene.selectedMessageIds.length
			? Math.min(...scene.selectedMessageIds)
			: null)
	if (scene.sessionId != null && opening != null) {
		const place = await scenePlaceOf(db, scene.sessionId, { messageId: opening })
		if (place) out.place = place
	}
	const clock = sceneClockOf(scene, "opened")
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
 */
export type SceneBoundaryTaken =
	| { kind: "removed"; row: SceneRow }
	| { kind: "changed"; row: SceneRow }

/** Reopen: no close, no closing clock, an empty selection, a reset summary. */
const reopenedPatch = (scene: SceneRow): Partial<typeof schema.scenes.$inferInsert> => ({
	closedAtMessageId: null,
	...prefixed("closed", null),
	selectedMessageIds: [],
	summaryStatus: resetSummary(scene),
	updatedAt: new Date()
})

/**
 * 🚧 Back's half: the scene boundaries anchored to `messageId`, taken, in the
 * order taken — inside the caller's transaction (`retractStateAnchoredTo`
 * with `scenes: 'take'`). Rules, in order (shapes §A-2): a scene opened at the
 * row is removed and the one before it reopens; a scene closed at the row
 * reopens (or its close moves back); a selection holding the row loses it.
 * A scene with an applied summary is never touched.
 */
export async function takeSceneBoundariesAt(tx: Db, messageId: number): Promise<SceneBoundaryTaken[]> {
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
	const notDone = (s: SceneRow) => s.summaryStatus !== "done"

	// 1. Scenes opened at the row.
	for (const s of (await sceneRows()).filter(
		(x) => x.openedAtMessageId === messageId && notDone(x)
	)) {
		await tx.delete(schema.scenes).where(eq(schema.scenes.id, s.id))
		taken.push({ kind: "removed", row: s })
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
					summaryStatus: resetSummary(s),
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
		const left = ((s.selectedMessageIds ?? []) as number[]).filter(
			(id) => id !== messageId
		)
		if (s.openedAtMessageId == null && left.length === 0) {
			await tx.delete(schema.scenes).where(eq(schema.scenes.id, s.id))
			taken.push({ kind: "removed", row: s })
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
