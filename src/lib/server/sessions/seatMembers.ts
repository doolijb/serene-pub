/**
 * ⏳ The `seat-members` boot pass (plan §27 v2, S1): gives every seat the cast
 * member its card is, and settles a session whose seats resolve to one member
 * twice. Lives as long as the attic does — the attic's ETL writes seats
 * without members, and so does any 0.6 row from before the column — and is
 * deleted with it at the RC1 squash.
 *
 * The work is `settleSeats` (`sessions/seats.ts`, steps 1–3): this module only
 * finds the sessions that need it and runs each in its own transaction. It is
 * the only caller that passes `{ merge: true }` — every live path settles
 * fill-only, so nobody departs outside this pass (owner, ★S1-1, 2026-11-05).
 * Members it mints are named after each session's transaction commits
 * (`syncMintedSeatMembers`).
 *
 * - **Not critical.** One session that throws is counted in `failed`, logged by
 *   id, and the pass goes on; the rest are not rolled back with it. After the
 *   loop a non-zero `failed` throws one error naming the count, so the startup
 *   task (`failsHealth`) reports it.
 * - **A no-op fast path.** Two queries: step 1's (below), then one naming
 *   the sessions with a LIVE character seat or player seat that has a card
 *   and no member **that settling can fill**: the attached book knows the
 *   card; or the own book knows it; or the card is live and the attached book
 *   may mint (the owner's, no genuine `provided` mark) or the own book
 *   exists. Or two live character seats on one member. Neither names
 *   anything: zeros, and nothing else is read. A departed seat never makes a
 *   session a candidate (its card is often in no book, and it would be
 *   re-read on every boot); it is filled, find-only, whenever its session is
 *   settled for another reason.
 * - 🚧 **Seats of a card deleted before the delete-time fill** (★RF-1 at
 *   startup, owner 2026-11-10: "One startup pass fills those seats, and a test
 *   pins that a second start changes nothing. No seat stays empty"). Before
 *   settling, one query names every live seat whose card is soft-deleted, that
 *   has no member and whose card neither the attached book nor the own book
 *   knows. Where the session's books can take a member (the attached book may
 *   mint, or the own book exists) each such card is filled in its own
 *   transaction exactly as at delete time — `fillSeatsBeforeCardDelete(tx,
 *   card, { mintDeleted: true })`, then every member it minted made card-less
 *   with the card's content (`makeMemberCardless`, cause `card-delete`). It
 *   reports nothing: no `SeatChange`, no event. A session whose books can take
 *   no member is left alone and its seats counted `unexplained`; it is never
 *   worked again, so it changes nothing on the next boot.
 * - **Idempotent.** A second boot changes nothing and, with nothing new to
 *   settle, reads two queries. A live seat nothing can give a member (a
 *   deleted card in a session whose books can take none) is left, and counted
 *   `unexplained`.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"
import {
	fillSeatsBeforeCardDelete,
	settleSeats,
	syncMintedSeatMembers
} from "$lib/server/sessions/seats"

export interface SeatMembersReport {
	/** Sessions the pass settled. */
	sessions: number
	filled: number
	minted: number
	/** Live character seats departed into another seat of the same member. */
	merged: number
	unexplained: number
	/** Sessions whose transaction threw and was rolled back. */
	failed: number
}

// SQL parts over a seat row (`seat`.`card`) joined to its session `s`.
/** The book `book` (an SQL predicate on a lorebook id) knows the card: linked, or a dated card. */
const knows = (seat: string, card: string, book: string) => `(
	exists (
		select 1 from lorebook_bindings b
		where b.character_id = ${seat}.${card} and b.lorebook_id ${book}
	)
	or exists (
		select 1 from character_versions cv
			join character_versions pv on pv.id = cv.parent_version_id
		where cv.cast_member_id is not null
			and pv.card_id = ${seat}.${card} and cv.lorebook_id ${book}
	)
)`
const ATTACHED = "= s.lorebook_id"
const OWN = "in (select o.id from lorebooks o where o.session_id = s.id)"
/** The session's books can take a new member: the attached book may mint (the owner's, no genuine `provided` mark) or the own book exists — `resolveSeatMember`'s steps 2 and 4. */
const TAKES_A_MEMBER = `(
	exists (
		select 1 from lorebooks l
		where l.id = s.lorebook_id and l.user_id = s.user_id
			and not coalesce((
				select jsonb_typeof(p) = 'object'
					and jsonb_typeof(p -> 'plugin') = 'string'
					and jsonb_typeof(p -> 'slug') = 'string'
					and jsonb_typeof(p -> 'version') = 'string'
					and p ->> 'uuid' = l.uuid::text
				from (select l.extra_json::jsonb -> 'provided' as p) q
			), false)
	)
	or exists (select 1 from lorebooks o where o.session_id = s.id)
)`

// A live seat is a candidate for settling only when settling can fill it, as
// `resolveSeatMember` does: the attached book knows the card (linked, or a
// dated card); or the own book knows it (even when the attached book may
// mint: a deleted card falls through to the own book's member, ★RF-1,
// 2026-11-09); or the card is live and the attached book may mint or the own
// book exists (★B-5, 2026-11-08). An ancestor's own book is not looked in
// here: that can only miss a seat, never re-select one.
const resolvable = (seat: string, card: string) =>
	sql.raw(`(
		${knows(seat, card, ATTACHED)}
		or ${knows(seat, card, OWN)}
		or (
			${TAKES_A_MEMBER}
			and exists (select 1 from characters c where c.id = ${seat}.${card} and not c.is_deleted)
		)
	)`)

// 🚧 A live seat with no member whose card is soft-deleted and known to
// neither the attached book nor the own book: the seats settling cannot fill
// and the deleted-card fill can (★RF-1 at startup, 2026-11-10). `takes` says
// whether the session's books can take a member.
const deletedCardSeats = (seats: string, seat: string, card: string) =>
	sql.raw(`
		select ${seat}.session_id, ${seat}.${card} as card_id, ${TAKES_A_MEMBER} as takes
		from ${seats} ${seat}
			join sessions s on s.id = ${seat}.session_id
			join characters c on c.id = ${seat}.${card} and c.is_deleted
		where ${seat}.removed_at is null and ${seat}.cast_member_id is null
			and not ${knows(seat, card, ATTACHED)}
			and not ${knows(seat, card, OWN)}
	`)

export async function seatMembers(db: Db): Promise<SeatMembersReport> {
	const report: SeatMembersReport = {
		sessions: 0,
		filled: 0,
		minted: 0,
		merged: 0,
		unexplained: 0,
		failed: 0
	}
	const settledSessions = new Set<number>()

	// 1. Seats of cards deleted before the delete-time fill: one transaction
	// per card, as at delete time. Runs first, so settling (below) finds these
	// seats filled and never counts them.
	const deletedSeats = rawRows<{
		session_id: number
		card_id: number
		takes: boolean
	}>(
		await db.execute(sql`
			${deletedCardSeats("session_characters", "sc", "character_id")}
			union all
			${deletedCardSeats("session_personas", "sp", "persona_id")}
		`)
	).map((row) => ({
		sessionId: Number(row.session_id),
		cardId: Number(row.card_id),
		takes: row.takes === true
	}))
	const byCard = new Map<number, Set<number>>()
	for (const o of deletedSeats) {
		if (!o.takes) continue
		const sessions = byCard.get(o.cardId) ?? new Set<number>()
		sessions.add(o.sessionId)
		byCard.set(o.cardId, sessions)
	}
	// "session:card" pairs the fills wrote (a fill visits every session of its card).
	const filledHere = new Set<string>()
	if (byCard.size) {
		const { makeMemberCardless } = await import("$lib/server/cast/cardless")
		for (const cardId of [...byCard.keys()].sort((a, b) => a - b)) {
			const sessions = [...byCard.get(cardId)!].sort((a, b) => a - b)
			try {
				const r = await db.transaction(async (tx) => {
					const t = tx as unknown as Db
					const fill = await fillSeatsBeforeCardDelete(t, cardId, {
						mintDeleted: true
					})
					for (const memberId of fill.mintedMemberIds)
						await makeMemberCardless(t, memberId, {
							cause: "card-delete"
						})
					return fill
				})
				for (const id of r.filledSessions) {
					settledSessions.add(id)
					filledHere.add(`${id}:${cardId}`)
				}
				report.filled += r.filled
				report.minted += r.minted
			} catch (err) {
				report.failed += sessions.length
				console.error(
					`[seat-members] the seats of deleted card ${cardId} in session(s) ${sessions.join(", ")} were left as they were:`,
					err
				)
			}
		}
	}

	// 2. Settling.
	const found = await db.execute(sql`
		select sc.session_id from session_characters sc
			join sessions s on s.id = sc.session_id
			where sc.removed_at is null and sc.character_id is not null and sc.cast_member_id is null
				and ${resolvable("sc", "character_id")}
		union
		select sp.session_id from session_personas sp
			join sessions s on s.id = sp.session_id
			where sp.removed_at is null and sp.persona_id is not null and sp.cast_member_id is null
				and ${resolvable("sp", "persona_id")}
		union
		select session_id from session_characters
			where removed_at is null and character_id is not null and cast_member_id is not null
			group by session_id, cast_member_id having count(*) > 1
	`)
	const ids = rawRows<{ session_id: number }>(found)
		.map((row) => Number(row.session_id))
		.sort((a, b) => a - b)
	for (const id of ids) {
		try {
			const settled = await db.transaction(async (tx) =>
				settleSeats(tx as unknown as Db, id, { merge: true })
			)
			// Committed: the names of the members just made come from their cards.
			await syncMintedSeatMembers(db, settled.mintedMembers)
			settledSessions.add(id)
			report.filled += settled.filled
			report.minted += settled.minted
			report.merged += settled.merged.length
			report.unexplained += settled.unexplained
		} catch (err) {
			report.failed++
			console.error(
				`[seat-members] session ${id} was left as it was:`,
				err
			)
		}
	}
	// A deleted card's seat in a session whose books can take no member is
	// left; settling already counted it if it settled that session.
	const settledIds = new Set(ids)
	for (const o of deletedSeats)
		if (
			!o.takes &&
			!settledIds.has(o.sessionId) &&
			!filledHere.has(`${o.sessionId}:${o.cardId}`)
		)
			report.unexplained++
	report.sessions = settledSessions.size
	if (report.failed > 0)
		throw new Error(
			`${report.failed} session(s) could not be given their cast members; see the log`
		)
	return report
}
