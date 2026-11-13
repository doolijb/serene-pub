/**
 * What a session card quotes: the row's message count and its last visible
 * line.
 *
 * ONE projection with two callers. `sessions:list`
 * (`sockets/sessions.ts`'s `buildSessionsListFor`) asks it for every session at
 * once; the `sessions:rowChanged` push (`sessions/rowPush.ts`) asks it for a
 * single session after a message lands, is edited, hidden, deleted or
 * streamed. Both therefore read the same `main`-only rule and three exclusions — an in-flight
 * generation, a hidden message, a blank body — so a row the push keeps current
 * says exactly what the next list would.
 *
 * `db` is a parameter, never an import: the list calls it on the app handle,
 * the push on its own, and a test on the one it built.
 */

import { and, asc, count, desc, eq, inArray, or, isNotNull, isNull, sql, type SQL, type SQLWrapper } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { DEFAULT_CHANNEL } from "@serene-pub/sdk"
import { isFailedReplySql } from "$lib/server/messages/failedReply"
import { liveMessageWhere } from "$lib/server/messages/store"
import { cardsNow } from "$lib/server/cast/seatedCast"
import { membersAsRead, type MemberAsRead } from "$lib/server/cast/memberAsRead"
import {
	seatCardAsRead,
	type SeatCardRow
} from "$lib/server/pipelines/prompt/seatCards"
import { castMemberCards } from "$lib/server/utils/castMemberCards"
import { withSeatName } from "$lib/server/sessions/seatName"
import {
	resolveCharacterName,
	resolvePersonaName
} from "$lib/shared/utils/resolveCharacterName"

/**
 * `characters`, joined a SECOND time as the voiced side.
 *
 * `session_messages.persona_id` and `session_messages.character_id` both point
 * at `characters`, so a query that reads the speaking character AND the voiced
 * one has to name the table twice — one join cannot answer for both, and
 * without the alias the second silently overwrites the first.
 */
const voicedCharacter = alias(schema.characters, "voiced_character")

/**
 * A message's last line as a person reads it: one line, no markup.
 *
 * The same 160-character shape as `retrievalExcerpt` in `sockets/pipelines.ts`,
 * plus a markdown strip — this text is rendered as PLAIN text in a card, and a
 * roleplay message is mostly `*stage directions*`, so the markers would show.
 *
 * Underscores are left alone on purpose: `_emphasis_` is rare next to how often
 * a name or a key in a message is `snake_case`, and stripping them would eat
 * the word rather than the markup.
 */
export function messageExcerpt(content: string | null | undefined): string {
	if (typeof content !== "string") return ""
	const flat = content
		// Code first: a fence's contents are not prose, and an inline span's
		// backticks would otherwise survive into the card.
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]*)`/g, "$1")
		// Images before links — an image inside a link must not leave its alt
		// text behind as the link's label.
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		// Line-leading markers: quote, heading, bullet, ordered item.
		.replace(
			/^[ \t]{0,3}(?:>+[ \t]*|#{1,6}[ \t]+|[-*+][ \t]+|\d+\.[ \t]+)/gm,
			""
		)
		// Emphasis markers, never the words between them.
		.replace(/\*+/g, "")
		.replace(/~~/g, "")
		.replace(/\s+/g, " ")
		.trim()
	return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat
}

/**
 * The last visible line of each of these sessions, keyed by session id.
 *
 * `DISTINCT ON (session_id) … ORDER BY session_id, id DESC` — the newest row
 * per session in ONE pass, whether the caller asked about one session or forty.
 * `id DESC` and not `created_at`: that column is a `date` (day granularity), so
 * it cannot order two messages from the same afternoon. The session page sorts
 * by id for the same reason.
 *
 * The three exclusions are what "visible line" means: a placeholder
 * mid-generation, a message the owner hid, and a blank body. Without them a
 * session that is generating right now shows an empty quote. A session with
 * nothing to show is absent from the map rather than present with a null.
 *
 * The read is the `main` channel's alone (2026-10-15): a card is seen by
 * everyone in the session, and another channel may be private — a Dungeon
 * Crawler's Planner lane (`parley:2`) is one person's talk, and its newest
 * line quoted on every member's card was a leak. A session's other channels
 * (folios, lanes, side channels) never stand in for its story.
 */
export async function lastVisibleMessages(
	db: Db,
	sessionIds: number[],
	opts?: { withMemberWords?: ReadonlySet<number> }
): Promise<Map<number, Sockets.Sessions.List.LastMessage>> {
	const lastMessages = new Map<number, Sockets.Sessions.List.LastMessage>()
	if (sessionIds.length === 0) return lastMessages

	const latestRaw = await db
		.selectDistinctOn([schema.sessionMessages.sessionId], {
			sessionId: schema.sessionMessages.sessionId,
			content: schema.sessionMessages.content,
			role: schema.sessionMessages.role,
			metadata: schema.sessionMessages.metadata,
			updatedAt: schema.sessionMessages.updatedAt,
			characterId: schema.sessionMessages.characterId,
			castMemberId: schema.sessionMessages.castMemberId,
			personaId: schema.sessionMessages.personaId
		})
		.from(schema.sessionMessages)
		.where(
			and(
				inArray(schema.sessionMessages.sessionId, sessionIds),
				eq(schema.sessionMessages.channel, DEFAULT_CHANNEL),
				eq(schema.sessionMessages.isGenerating, false),
				eq(schema.sessionMessages.isHidden, false),
				// Whitespace spelled with `chr()` rather than an escape:
				// `\t` inside a template literal would reach the server as
				// a literal control character in the SQL text.
				sql`btrim(${schema.sessionMessages.content}, ' ' || chr(9) || chr(10) || chr(13)) <> ''`
			)
		)
		.orderBy(
			schema.sessionMessages.sessionId,
			desc(schema.sessionMessages.id)
		)
	// The speaking cards' names are their current card version's (never the
	// ⏳ copies); the VOICED character (`personaId`) is read the same way.
	const cardNow = await cardsNow(
		db,
		latestRaw.flatMap((r) => [
			...(r.characterId != null ? [r.characterId] : []),
			...(r.personaId != null ? [r.personaId] : [])
		])
	)
	// A card-less seat's line (`character_id` null, `cast_member_id` set) is
	// named by its member as the session reads it: the member is its own words.
	const cardlessSpeakers = new Map<number, number[]>()
	for (const r of latestRaw) {
		if (r.characterId == null && r.personaId == null && r.castMemberId != null) {
			cardlessSpeakers.set(r.sessionId, [
				...(cardlessSpeakers.get(r.sessionId) ?? []),
				r.castMemberId
			])
		}
	}
	const cardlessNames = new Map<string, string>()
	for (const [sessionId, memberIds] of cardlessSpeakers) {
		const reads = await membersAsRead(db, memberIds, { sessionId })
		for (const [memberId, read] of reads) {
			cardlessNames.set(
				`${sessionId}:${memberId}`,
				resolveCharacterName({ name: read.name, nickname: read.nickname }, "")
			)
		}
	}
	const latestRows = latestRaw.map((r) => ({
		...r,
		characterName:
			(r.characterId != null ? cardNow.get(r.characterId)?.name : null) ?? null,
		characterNickname:
			(r.characterId != null ? cardNow.get(r.characterId)?.nickname : null) ?? null,
		personaName:
			(r.personaId != null ? cardNow.get(r.personaId)?.name : null) ?? null,
		cardlessName:
			r.characterId == null && r.personaId == null && r.castMemberId != null
				? (cardlessNames.get(`${r.sessionId}:${r.castMemberId}`) ?? null)
				: null
	}))

	// The sessions whose seats may read a member over their card (s27 S2):
	// the caller's candidate set when it already asked (`opts.withMemberWords`),
	// else one query; then each speaker's card read as its seat reads it
	// (`cardsAsSeatsRead`'s rule, in one batch) only for those sessions.
	const speakerSessions = latestRows
		.filter((r) => r.characterId != null || r.personaId != null)
		.map((r) => r.sessionId)
	const candidates = opts?.withMemberWords
		? new Set(speakerSessions.filter((id) => opts.withMemberWords!.has(id)))
		: await sessionsWithMemberWords(db, speakerSessions)
	const shownCards = new Map<number, Map<number, string>>()
	if (candidates.size) {
		const cardsOf = new Map<
			number,
			Map<number, { id: number; name: string | null; nickname: string | null }>
		>()
		for (const r of latestRows)
			if (candidates.has(r.sessionId) && r.characterId != null) {
				const cards = cardsOf.get(r.sessionId) ?? new Map()
				cards.set(r.characterId, {
					id: r.characterId,
					name: r.characterName,
					nickname: r.characterNickname
				})
				cardsOf.set(r.sessionId, cards)
			}
		// Each card's seat: live before departed, then position, then id.
		const cs = schema.sessionCharacters
		const seats = await db
			.select({
				sessionId: cs.sessionId,
				cardId: cs.characterId,
				castMemberId: cs.castMemberId,
				removedAt: cs.removedAt
			})
			.from(cs)
			.where(
				and(
					inArray(cs.sessionId, [...cardsOf.keys()]),
					inArray(
						cs.characterId,
						[...cardsOf.values()].flatMap((m) => [...m.keys()])
					)
				)
			)
			.orderBy(asc(sql`coalesce(${cs.position}, 0)`), asc(cs.id))
		const seatOfCard = new Map<string, number | null>()
		for (const live of [true, false])
			for (const s of seats) {
				const key = `${s.sessionId}:${s.cardId}`
				if (
					s.cardId != null &&
					(s.removedAt == null) === live &&
					!seatOfCard.has(key)
				)
					seatOfCard.set(key, s.castMemberId ?? null)
			}
		const seated = [...cardsOf].map(([sessionId, cards]) => ({
			sessionId,
			rows: [...cards.values()].map((card) => ({
				castMemberId: seatOfCard.get(`${sessionId}:${card.id}`) ?? null,
				character: card
			}))
		}))
		const asReads = await seatMembersAsReadForSessions(db, seated)
		for (const { sessionId, rows } of seated) {
			const reads = asReads.get(sessionId) ?? []
			shownCards.set(
				sessionId,
				new Map(
					rows.map((row, i) => {
						const asRead = reads[i]
						const card = asRead
							? seatCardAsRead(row.character, asRead)
							: row.character
						return [card.id, resolveCharacterName(card, "")]
					})
				)
			)
		}
	}

	// A persona-voiced line is named as its player seat reads (★pT-1, owner
	// ruling 2026-11-05: "a persona seat reads its cast member like every
	// seat"): the seat's member over its active card, the seat name winning
	// (`withSeatName`). The card's seat: live before departed, then position,
	// then id — the character seats' rule above.
	const shownPersonas = new Map<number, Map<number, string>>()
	const personaLines = latestRows.filter((r) => r.personaId != null && r.personaName)
	if (personaLines.length) {
		const ps = schema.sessionPersonas
		const seats = await db
			.select({
				sessionId: ps.sessionId,
				cardId: ps.personaId,
				castMemberId: ps.castMemberId,
				seatName: ps.seatName,
				removedAt: ps.removedAt
			})
			.from(ps)
			.where(
				and(
					inArray(ps.sessionId, [...new Set(personaLines.map((r) => r.sessionId))]),
					inArray(ps.personaId, [...new Set(personaLines.map((r) => r.personaId!))])
				)
			)
			.orderBy(asc(sql`coalesce(${ps.position}, 0)`), asc(ps.id))
		const seatOf = new Map<string, (typeof seats)[number]>()
		for (const live of [true, false])
			for (const seat of seats) {
				const key = `${seat.sessionId}:${seat.cardId}`
				if ((seat.removedAt == null) === live && !seatOf.has(key))
					seatOf.set(key, seat)
			}
		const seated = personaLines.map((r) => ({
			sessionId: r.sessionId,
			rows: [
				{
					castMemberId: seatOf.get(`${r.sessionId}:${r.personaId}`)?.castMemberId ?? null,
					character: { id: r.personaId!, name: r.personaName ?? undefined, nickname: null }
				}
			]
		}))
		const readable = seated.filter((s) => candidates.has(s.sessionId))
		const asReads = readable.length
			? await seatMembersAsReadForSessions(db, readable)
			: new Map<number, (MemberAsRead | null)[]>()
		for (const { sessionId, rows } of seated) {
			const [row] = rows
			const asRead = asReads.get(sessionId)?.[0]
			const card = asRead ? seatCardAsRead(row.character, asRead) : row.character
			const seatName = seatOf.get(`${sessionId}:${row.character.id}`)?.seatName
			const named = withSeatName(card, seatName)
			const map = shownPersonas.get(sessionId) ?? new Map<number, string>()
			map.set(row.character.id, resolvePersonaName(named, ""))
			shownPersonas.set(sessionId, map)
		}
	}

	for (const row of latestRows) {
		const excerpt = messageExcerpt(row.content)
		if (!excerpt) continue
		// Persona before character: a message carries at most one of the
		// two, and a persona message is the caller's own side.
		const speakerName = row.personaName
			? ((row.personaId != null
					? shownPersonas.get(row.sessionId)?.get(row.personaId)
					: undefined) ?? resolvePersonaName({ name: row.personaName }, ""))
			: row.characterName || row.characterNickname
				? ((row.characterId != null
						? shownCards.get(row.sessionId)?.get(row.characterId)
						: undefined) ??
					resolveCharacterName(
						{
							name: row.characterName,
							nickname: row.characterNickname
						},
						""
					))
				: (row.cardlessName ?? row.metadata?.narratorName ?? "")
		lastMessages.set(row.sessionId, {
			excerpt,
			speakerName: speakerName || null,
			isUser: row.role === "user",
			createdAt: new Date(row.updatedAt).toISOString(),
			// 🚧 A revision branch's last line (`REVISED_TURN_KEY`): the turn
			// after it was revised away, so no reply is owed.
			...((row.metadata as Record<string, unknown> | null)?.revisedTurn === true ? { revisedTurn: true } : {})
		})
	}
	/**
	 * 🚧 **A reply that failed after it** (2026-10-16 walk): the newest
	 * settled row on `main` is a failed one — an error and no words — which
	 * the excerpt read above skips as blank. Without this the card read the
	 * person's line as the newest and said "Waiting on the model" over a
	 * failure. One more DISTINCT ON, the same channel and exclusions minus
	 * the blank-body one.
	 */
	if (lastMessages.size) {
		const newest = await db
			.selectDistinctOn([schema.sessionMessages.sessionId], {
				sessionId: schema.sessionMessages.sessionId,
				failed: isFailedReplySql
			})
			.from(schema.sessionMessages)
			.where(
				and(
					inArray(schema.sessionMessages.sessionId, [...lastMessages.keys()]),
					eq(schema.sessionMessages.channel, DEFAULT_CHANNEL),
					eq(schema.sessionMessages.isGenerating, false),
					eq(schema.sessionMessages.isHidden, false)
				)
			)
			.orderBy(schema.sessionMessages.sessionId, desc(schema.sessionMessages.id))
		for (const row of newest) {
			const last = lastMessages.get(row.sessionId)
			if (last && row.failed === true) last.replyFailed = true
		}
	}
	return lastMessages
}

/** 🚧 Each session's live message count (rewound rows not counted: `liveMessageWhere()`), one grouped read; a session with none is absent. */
export async function liveMessageCounts(
	handle: Db,
	sessionIds: readonly number[]
): Promise<Map<number, number>> {
	const counts = new Map<number, number>()
	if (sessionIds.length === 0) return counts
	const rows = await handle
		.select({ sessionId: schema.sessionMessages.sessionId, n: count() })
		.from(schema.sessionMessages)
		.where(
			and(
				inArray(schema.sessionMessages.sessionId, [...sessionIds]),
				liveMessageWhere()
			)
		)
		.groupBy(schema.sessionMessages.sessionId)
	for (const row of rows) counts.set(row.sessionId, Number(row.n))
	return counts
}

/**
 * 🚧 `seatMembersAsRead` for many sessions at once — each session's value is
 * exactly `seatMembersAsRead(db, sessionId, rows)` (`pipelines/prompt/seatCards.ts`),
 * read in fewer queries: one for every session's books, one for every stored
 * member's book, one `castMemberCards` per distinct book asked, and the
 * member reads in groups. A session that reads its own notes alone reads
 * on its own book's reading (`sessionReadingOf`); while that is main at its
 * head with no cuts (no line, no story clock of the session's or the book's,
 * no branch ancestry) such sessions share a group, and any other keeps its
 * own reads. A session with an attached book keeps its own reads — its story
 * clock is its own. A session id with no
 * row reads nobody, as `seatBookOf` returning null does.
 */
async function seatMembersAsReadForSessions(
	db: Db,
	sessions: readonly { sessionId: number; rows: readonly SeatCardRow[] }[]
): Promise<Map<number, (MemberAsRead | null)[]>> {
	const cardIdOf = (row: SeatCardRow): number | null => {
		const id = (row.character as { id?: unknown } | null | undefined)?.id
		return typeof id === "number" ? id : null
	}
	// The member each row's seat seats: stored (when it lives in one of the
	// session's books), else found for its card (find-only, attached book first).
	const memberIdsOf = new Map<number, (number | null)[]>()
	for (const s of sessions)
		memberIdsOf.set(
			s.sessionId,
			s.rows.map((row) =>
				cardIdOf(row) == null ? null : (row.castMemberId ?? null)
			)
		)
	const carded = sessions.filter((s) => s.rows.some((row) => cardIdOf(row) != null))
	if (carded.length) {
		const ownBook = alias(schema.lorebooks, "own_book")
		const books = new Map(
			(
				await db
					.select({
						id: schema.sessions.id,
						attachedId: schema.sessions.lorebookId,
						ownBookId: ownBook.id,
						lineId: schema.sessions.lorebookBranchId,
						ancestry: schema.sessions.branchAncestry,
						clockYear: schema.sessions.storyClockYear,
						ownClockYear: ownBook.storyClockYear
					})
					.from(schema.sessions)
					.leftJoin(ownBook, eq(ownBook.sessionId, schema.sessions.id))
					.where(inArray(schema.sessions.id, carded.map((s) => s.sessionId)))
			).map((b) => [b.id, b])
		)
		const stored = [
			...new Set(
				carded.flatMap((s) =>
					books.has(s.sessionId)
						? memberIdsOf.get(s.sessionId)!.filter((id): id is number => id != null)
						: []
				)
			)
		]
		const homeOf = new Map<number, number>()
		if (stored.length)
			for (const home of await db
				.select({
					id: schema.lorebookBindings.id,
					lorebookId: schema.lorebookBindings.lorebookId
				})
				.from(schema.lorebookBindings)
				.where(inArray(schema.lorebookBindings.id, stored)))
				homeOf.set(home.id, home.lorebookId)
		const unfilled = new Map<number, { i: number; card: number }[]>()
		for (const s of carded) {
			const book = books.get(s.sessionId)
			if (!book) continue
			const memberIds = memberIdsOf.get(s.sessionId)!
			s.rows.forEach((row, i) => {
				const card = cardIdOf(row)
				const memberId = memberIds[i]
				const home = memberId == null ? undefined : homeOf.get(memberId)
				const trusted =
					home != null && (home === book.attachedId || home === book.ownBookId)
				if (card != null && !trusted) {
					const list = unfilled.get(s.sessionId) ?? []
					list.push({ i, card })
					unfilled.set(s.sessionId, list)
				}
			})
		}
		// Each distinct book is read once, whoever asks. (Sequential: PGlite
		// runs one statement at a time in-process, so concurrency saves nothing.)
		const cardsOfBook = new Map<number, Awaited<ReturnType<typeof castMemberCards>>>()
		for (const sessionId of unfilled.keys()) {
			const book = books.get(sessionId)!
			for (const lorebookId of [book.attachedId, book.ownBookId])
				if (lorebookId != null && !cardsOfBook.has(lorebookId))
					cardsOfBook.set(lorebookId, await castMemberCards(db, lorebookId))
		}
		for (const [sessionId, list] of unfilled) {
			const book = books.get(sessionId)!
			const memberIds = memberIdsOf.get(sessionId)!
			for (const { i, card } of list)
				memberIds[i] =
					(book.attachedId == null
						? undefined
						: cardsOfBook.get(book.attachedId)?.memberOf.get(card)) ??
					(book.ownBookId == null
						? undefined
						: cardsOfBook.get(book.ownBookId)?.memberOf.get(card)) ??
					null
		}
		for (const s of carded)
			if (!books.has(s.sessionId))
				memberIdsOf.set(
					s.sessionId,
					s.rows.map(() => null)
				)
		// Reads: a member is layered over its active card, so a group needs each
		// member once. A session with an attached book, or notes read off main's head, has its own group
		// (`sessionId`); every other session shares the one Main group (`null`).
		const groups = new Map<
			number | null,
			{ memberIds: Set<number>; reads: Map<number, MemberAsRead> }
		>()
		const groupKeyOf = (sessionId: number): number | null => {
			const book = books.get(sessionId)
			if ((book?.attachedId ?? null) != null) return sessionId
			// Notes read alone: the shared Main group only while the reading
			// is main at its head with no cuts (`sessionReadingOf`).
			const atMainHead =
				book?.ownBookId == null ||
				(book.lineId == null &&
					!book.ancestry?.length &&
					book.clockYear == null &&
					book.ownClockYear == null)
			return atMainHead ? null : sessionId
		}
		for (const s of carded) {
			const key = groupKeyOf(s.sessionId)
			const group = groups.get(key) ?? { memberIds: new Set(), reads: new Map() }
			groups.set(key, group)
			for (const memberId of memberIdsOf.get(s.sessionId)!)
				if (memberId != null) group.memberIds.add(memberId)
		}
		for (const [key, group] of groups)
			group.reads = await membersAsRead(
				db,
				[...group.memberIds],
				key == null ? {} : { sessionId: key }
			)
		const out = new Map<number, (MemberAsRead | null)[]>()
		for (const s of sessions) {
			const memberIds = memberIdsOf.get(s.sessionId)!
			const group = groups.get(groupKeyOf(s.sessionId))
			out.set(
				s.sessionId,
				s.rows.map((_row, i) => {
					const memberId = memberIds[i]
					return memberId == null || !group
						? null
						: (group.reads.get(memberId) ?? null)
				})
			)
		}
		return out
	}
	return new Map(sessions.map((s) => [s.sessionId, s.rows.map(() => null)]))
}

/** The member (`memberId`, a column) has a cast version that can read as something other than its card (`sessionsWithMemberWords`). */
function memberHasWords(memberId: SQLWrapper): SQL {
	const v = schema.characterVersions
	return sql`EXISTS (SELECT 1 FROM ${v} WHERE ${v.castMemberId} = ${memberId} AND (NOT ('name' = ANY(${v.follows})) OR NOT ('nickname' = ANY(${v.follows})) OR NOT ('faceMediaId' = ANY(${v.follows})) OR ${v.branchId} IS NOT NULL OR ${v.year} IS NOT NULL OR ${v.personalPosition} IS NOT NULL OR ${v.sourceSessionId} IS NOT NULL))`
}

/**
 * 🚧 Which of these sessions have a character seat that may read a cast
 * member over its card (s27 S2): the seat's stored member, or the member its
 * card is in the session's attached or own book, has a cast version with an
 * own name, nickname or face (a field not in its `follows`), or any cast
 * version that is not the base (dated, on a line, at a life point or written
 * in play: a dated card or words may be the active one). A superset: every
 * other session's seats read exactly their cards, and the list skips the
 * member read for them. One query.
 */
export async function sessionsWithMemberWords(
	db: Db,
	sessionIds: readonly number[]
): Promise<Set<number>> {
	if (sessionIds.length === 0) return new Set()
	const sc = schema.sessionCharacters
	const b = schema.lorebookBindings
	const ownBook = alias(schema.lorebooks, "own_book")
	const rows = await db
		.selectDistinct({ id: sc.sessionId })
		.from(sc)
		.innerJoin(schema.sessions, eq(schema.sessions.id, sc.sessionId))
		.leftJoin(ownBook, eq(ownBook.sessionId, sc.sessionId))
		.innerJoin(
			b,
			or(
				eq(b.id, sc.castMemberId),
				and(
					eq(b.characterId, sc.characterId),
					or(
						eq(b.lorebookId, schema.sessions.lorebookId),
						eq(b.lorebookId, ownBook.id)
					)
				)
			)
		)
		.where(
			and(
				inArray(sc.sessionId, [...new Set(sessionIds)]),
				isNull(sc.envoySlug),
				or(isNotNull(sc.characterId), isNotNull(sc.castMemberId)),
				memberHasWords(b.id)
			)
		)
	// A live card-less seat is always a candidate: it has no card to read
	// instead of its member. (`castFaces` / `castNames` stay keyed by card id,
	// so a card-less row claims no entry there.)
	const cardlessRows = await db
		.selectDistinct({ id: sc.sessionId })
		.from(sc)
		.where(
			and(
				inArray(sc.sessionId, [...new Set(sessionIds)]),
				isNull(sc.removedAt),
				isNull(sc.envoySlug),
				isNull(sc.characterId),
				isNotNull(sc.castMemberId)
			)
		)
	// 🚧 Player seats read their members too (★pT-1, 2026-11-05): the same
	// test over `session_personas`.
	const sp = schema.sessionPersonas
	const personaBook = alias(schema.lorebooks, "persona_own_book")
	const personaRows = await db
		.selectDistinct({ id: sp.sessionId })
		.from(sp)
		.innerJoin(schema.sessions, eq(schema.sessions.id, sp.sessionId))
		.leftJoin(personaBook, eq(personaBook.sessionId, sp.sessionId))
		.innerJoin(
			b,
			or(
				eq(b.id, sp.castMemberId),
				and(
					eq(b.characterId, sp.personaId),
					or(
						eq(b.lorebookId, schema.sessions.lorebookId),
						eq(b.lorebookId, personaBook.id)
					)
				)
			)
		)
		.where(
			and(
				inArray(sp.sessionId, [...new Set(sessionIds)]),
				isNotNull(sp.personaId),
				memberHasWords(b.id)
			)
		)
	return new Set([...rows, ...personaRows, ...cardlessRows].map((r) => r.id))
}

/** 🚧 What the seats' cast members show over their cards, by seated card id (the `sessions:get` / `sessions:list` fields). */
export interface SeatCastShown {
	/** The member as read's name and nickname (`""` = none) where they differ from the card's. */
	castNames: Record<number, { ownName: string | null; ownNickname: string | null }>
	/** The member as read's face where it is not the card's avatar. */
	castFaces: Record<number, number>
}

/**
 * The payload maps are keyed by the card a seat holds (★pT-1, 2026-11-05:
 * player seats are covered too), and a card can be held by a character seat
 * and a player seat at once. The first seat to claim a card keeps it, in
 * `seatOf`'s order — live before departed, then the caller's order (character
 * seats first, then player seats). Returns the indexes of the seats that
 * claim a card, in that order; a card-less row claims nothing.
 */
function seatsInClaimOrder(rows: readonly SeatShownRow[]): number[] {
	const claimed = new Set<number>()
	const order: number[] = []
	for (const live of [true, false])
		rows.forEach((row, i) => {
			const id = row.character?.id
			if (id == null || (row.removedAt == null) !== live || claimed.has(id)) return
			claimed.add(id)
			order.push(i)
		})
	return order
}

/** A seat row as `seatCastShownFrom` reads it: its member, and the card it holds. */
export interface SeatShownRow {
	castMemberId?: number | null
	/** Set on a departed seat: a live seat of the same card is read first. */
	removedAt?: unknown
	character?: {
		id: number
		name?: string | null
		nickname?: string | null
		avatarMediaId?: number | null
	} | null
}

/**
 * 🚧 PURE: each seat's member as read (`seatMembersAsRead`, one entry per row)
 * turned into the payload's `castNames` / `castFaces`, keyed by the card the
 * seat holds. A seat whose member reads exactly as its card (no own names, the
 * card's face) adds nothing, so today's data sends `{}` as before. Names are
 * layered by `seatCardAsRead` — the one rule the prompt reads by.
 */
export function seatCastShownFrom(
	rows: readonly SeatShownRow[],
	asReads: readonly (MemberAsRead | null)[]
): SeatCastShown {
	const out: SeatCastShown = { castNames: {}, castFaces: {} }
	for (const i of seatsInClaimOrder(rows)) {
		const row = rows[i]
		const card = row.character
		const asRead = asReads[i]
		if (!card || !asRead) continue
		const names = { id: card.id, name: card.name ?? "", nickname: card.nickname ?? null }
		const named = seatCardAsRead(names, asRead)
		if (named !== names)
			out.castNames[card.id] = {
				ownName: named.name || null,
				ownNickname: named.nickname ?? ""
			}
		if (
			asRead.faceMediaId != null &&
			asRead.faceMediaId !== (card.avatarMediaId ?? null)
		)
			out.castFaces[card.id] = asRead.faceMediaId
	}
	return out
}

/**
 * 🚧 `castNames` / `castFaces` for many sessions' seats at once (the
 * `sessions:list` rows): the member read runs only for the sessions
 * `sessionsWithMemberWords` names; every other session gets `{}` — its seats
 * read exactly their cards. Each seat's member is read over its active card,
 * on its session's reading. Keyed by session id; a session absent from the map shows
 * its cards.
 */
export async function seatCastShownForSessions(
	db: Db,
	sessions: readonly { id: number; rows: readonly SeatShownRow[] }[],
	opts?: { withMemberWords?: ReadonlySet<number> }
): Promise<Map<number, SeatCastShown>> {
	const out = new Map<number, SeatCastShown>()
	const carded = sessions.filter((s) => s.rows.some((r) => r.character))
	const candidates = opts?.withMemberWords
		? new Set(
				carded.filter((s) => opts.withMemberWords!.has(s.id)).map((s) => s.id)
			)
		: await sessionsWithMemberWords(
				db,
				carded.map((s) => s.id)
			)
	if (candidates.size === 0) return out
	// The cards' own names, in full: a list row carries a trimmed card.
	const cardIds = sessions
		.filter((s) => candidates.has(s.id))
		.flatMap((s) => s.rows.flatMap((r) => (r.character ? [r.character.id] : [])))
	const cards = await cardsNow(db, cardIds)
	const seated = sessions
		.filter((s) => candidates.has(s.id))
		.map((s) => ({
			sessionId: s.id,
			rows: s.rows.map((r) => ({
				castMemberId: r.castMemberId ?? null,
				removedAt: r.removedAt,
				character: r.character ? (cards.get(r.character.id) ?? null) : null
			}))
		}))
	const asReads = await seatMembersAsReadForSessions(db, seated)
	for (const { sessionId, rows } of seated)
		out.set(sessionId, seatCastShownFrom(rows, asReads.get(sessionId) ?? []))
	return out
}

/** A sprite set as the session payload draws it (the card's `SESSION_SPRITE_SETS` shape, `sockets/sessions.ts`). */
export interface SeatSpriteSet {
	name: string
	isDefault: boolean
	sprites: {
		label: string
		position: number
		file: { uuid: string; rev: number } | null
	}[]
}

/**
 * 🚧 The cast member's own sprite sets by seated card id (s27 S2,
 * `castSpriteSets` on `sessions:get`): for each seat whose member as read
 * draws from its own sets (`spriteSetsFrom === "member"`), those sets with
 * their sprites that have a file, kept only when one set has an image —
 * until then the card's art shows (the `spriteChoicesFor` rule). `asReads`
 * is `seatMembersAsRead(db, sessionId, rows)`, one entry per row.
 */
export async function memberSpriteSetsBySeat(
	db: Db,
	rows: readonly SeatShownRow[],
	asReads: readonly (MemberAsRead | null)[]
): Promise<Record<number, SeatSpriteSet[]>> {
	const out: Record<number, SeatSpriteSet[]> = {}
	const memberOfCard = new Map<number, number>()
	for (const i of seatsInClaimOrder(rows)) {
		const asRead = asReads[i]
		if (rows[i].character && asRead?.spriteSetsFrom === "member")
			memberOfCard.set(rows[i].character!.id, asRead.castMemberId)
	}
	if (memberOfCard.size === 0) return out
	const sets = await db.query.spriteSets.findMany({
		where: (ss, { inArray }) =>
			inArray(ss.castMemberId, [...new Set(memberOfCard.values())]),
		columns: { name: true, isDefault: true, castMemberId: true },
		with: {
			sprites: {
				columns: { label: true, position: true },
				where: (sp, { isNotNull }) => isNotNull(sp.fileId),
				with: { file: { columns: { uuid: true, rev: true } } }
			}
		},
		orderBy: (ss, { asc }) => [asc(ss.position), asc(ss.id)]
	})
	for (const [cardId, memberId] of memberOfCard) {
		const own = sets.filter((set) => set.castMemberId === memberId)
		if (!own.some((set) => set.sprites.length > 0)) continue
		out[cardId] = own.map(({ name, isDefault, sprites }) => ({
			name,
			isDefault,
			sprites: sprites.map((sp) => ({
				label: sp.label,
				position: sp.position,
				file: sp.file ?? null
			}))
		}))
	}
	return out
}
