/**
 * Benched seats — the upgrade that follows the migration adding
 * `session_personas.is_active`.
 *
 * Owner 2026-11-10 ("also fold Removed in"): removing a seat becomes benching
 * it, so a seat that was removed before this version becomes a benched one —
 * `is_active = false`, `removed_at = NULL`, `removed_name` kept as it is.
 *
 * Only the rows that would not collide. A removed row stays removed when it is
 * a merge victim (`merged_into` set), an envoy, a character row with neither a
 * card nor a member, a row with no lines in its session (nothing to keep a
 * seat for), or a row whose member a live seat of the session already holds
 * (two live rows on one member is what the seat-members pass merges). The
 * member of a row is its `cast_member_id`, else — for a carded row — the card's
 * member as `resolveSeatMember` finds it without minting: the attached book
 * first, else the session's own book; linked, or drawn by a dated card.
 * Within a session, character rows convert first, then player rows, each
 * newest `id` first, and a converted row's member counts as held, so a second
 * removed row of the same member stays removed (challenge answers 2 and 3).
 *
 * Never deletes a row, never touches a live row. A second run changes nothing:
 * a converted row is benched, not removed, and the skipped ones are skipped again.
 * Raw SQL through `tx` only; no ids written down.
 */
import { sql } from "drizzle-orm"
import { rawRows } from "../rawRows"

/** The card's member in one book (`book` is an SQL predicate on a lorebook id), as `memberOfCard` reads it. */
const memberInBook = (card: string, book: string) => `coalesce(
	(select b.id from lorebook_bindings b
		where b.character_id = ${card} and b.lorebook_id ${book}
		order by b.id limit 1),
	(select cv.cast_member_id from character_versions cv
			join character_versions pv on pv.id = cv.parent_version_id
		where cv.cast_member_id is not null
			and pv.card_id = ${card} and cv.lorebook_id ${book}
		order by cv.cast_member_id limit 1)
)`

/** A row's member: its own, else its card's (attached book first, then the session's own book). */
const resolved = (row: string, card: string) => `coalesce(
	${row}.cast_member_id,
	case when ${card} is null then null else coalesce(
		${memberInBook(card, "= s.lorebook_id")},
		${memberInBook(card, "in (select o.id from lorebooks o where o.session_id = s.id)")}
	) end
)`

/** The one "has lines" rule, over the session's messages. */
const CHARACTER_LINES = `(
	(r.character_id is not null and exists (
		select 1 from session_messages m
		where m.session_id = r.session_id and m.character_id = r.character_id
	))
	or (r.cast_member_id is not null and exists (
		select 1 from session_messages m
		where m.session_id = r.session_id
			and ((m.persona_id is null and m.cast_member_id = r.cast_member_id)
				or m.metadata ->> 'speaker' = 'seated-member:' || r.cast_member_id)
	))
)`
const PLAYER_LINES = `(
	(r.persona_id is not null and exists (
		select 1 from session_messages m
		where m.session_id = r.session_id and m.persona_id = r.persona_id
	))
	or exists (
		select 1 from session_messages m
		where m.session_id = r.session_id
			and m.metadata ->> 'speaker' = 'player-seat:' || r.id
	)
)`

type Candidate = { id: number; session_id: number; member: number | null }

export async function run(tx: MigrationTx): Promise<void> {
	await benchRemovedSeatsWithLines(tx)
}

/**
 * The one conversion rule, for the upgrade and for the attic import of 0.5.3
 * sessions alike: `sessionIds` limits it to those sessions (lines must already
 * exist), none means every session. Returns how many seats it benched.
 */
export async function benchRemovedSeatsWithLines(
	tx: MigrationTx,
	sessionIds?: number[]
): Promise<{ characters: number; players: number }> {
	if (sessionIds && !sessionIds.length) return { characters: 0, players: 0 }
	const only = (alias: string) =>
		sessionIds
			? ` and ${alias}.session_id in (${sessionIds.map(Number).join(",")})`
			: ""
	const sessions = rawRows<{ session_id: number }>(
		await tx.execute(
			sql.raw(`
			select session_id from (
				select session_id from session_characters where removed_at is not null${only("session_characters")}
				union
				select session_id from session_personas where removed_at is not null${only("session_personas")}
			) x order by session_id
		`)
		)
	).map((r) => Number(r.session_id))

	let characters = 0
	let players = 0
	for (const sessionId of sessions) {
		const held = new Set<number>(
			rawRows<{ member: number }>(
				await tx.execute(
					sql.raw(`
					select m.member from (
						select ${resolved("r", "r.character_id")} as member
						from session_characters r
							join sessions s on s.id = r.session_id
						where r.session_id = ${sessionId} and r.removed_at is null
							and r.envoy_slug is null
						union all
						select ${resolved("r", "r.persona_id")} as member
						from session_personas r
							join sessions s on s.id = r.session_id
						where r.session_id = ${sessionId} and r.removed_at is null
					) m where m.member is not null
				`)
				)
			).map((r) => Number(r.member))
		)

		const convert = async (
			table: "session_characters" | "session_personas",
			candidates: Candidate[]
		): Promise<number> => {
			let converted = 0
			for (const row of candidates) {
				const member = row.member == null ? null : Number(row.member)
				if (member != null && held.has(member)) continue
				await tx.execute(
					sql.raw(`
					update ${table} set is_active = false, removed_at = null
					where id = ${Number(row.id)} and removed_at is not null
				`)
				)
				if (member != null) held.add(member)
				converted++
			}
			return converted
		}

		characters += await convert(
			"session_characters",
			rawRows<Candidate>(
				await tx.execute(
					sql.raw(`
					select r.id, r.session_id, ${resolved("r", "r.character_id")} as member
					from session_characters r
						join sessions s on s.id = r.session_id
					where r.session_id = ${sessionId}
						and r.removed_at is not null
						and r.merged_into is null
						and r.envoy_slug is null
						and (r.character_id is not null or r.cast_member_id is not null)
						and ${CHARACTER_LINES}
					order by r.id desc
				`)
				)
			)
		)
		players += await convert(
			"session_personas",
			rawRows<Candidate>(
				await tx.execute(
					sql.raw(`
					select r.id, r.session_id, ${resolved("r", "r.persona_id")} as member
					from session_personas r
						join sessions s on s.id = r.session_id
					where r.session_id = ${sessionId}
						and r.removed_at is not null
						and ${PLAYER_LINES}
					order by r.id desc
				`)
				)
			)
		)
	}

	if (characters || players)
		console.log(
			`[upgrade 0152] benched ${characters} removed character seat(s) and ${players} removed player seat(s)`
		)
	return { characters, players }
}
