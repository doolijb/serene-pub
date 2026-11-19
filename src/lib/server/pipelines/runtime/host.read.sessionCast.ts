/**
 * The host's `session_cast` read: the session's cast as a run reads it, with
 * the channel shaping `createHost` reads once per run.
 */

import { withSeatName } from "$lib/server/sessions/seatName"
import {
	and,
	asc,
	count,
	eq,
	inArray,
	isNotNull,
	isNull,
	or,
	sql
} from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	hostSeatRefOf,
	seatCardAsRead,
	cardlessSeatCard,
	seatMembersAsRead
} from "$lib/server/pipelines/prompt/seatCards"
import { membersAsRead } from "$lib/server/cast/memberAsRead"
import { cardsNow, type CardNow } from "$lib/server/cast/seatedCast"
import { attachedOrOwnBookOf } from "$lib/server/lorebooks/ownBook"
import { parseChannel, resolveChannel } from "$lib/server/messages/channels"
import type { ChannelShaping, HostReadArgs } from "./host.types"
import { ownBookDaysCounted } from "./host.loreWrites"
import { assertScoped } from "./host.helpers"

export async function readSessionCast(
	{ db, scope, node, q }: HostReadArgs,
	channelShaping: (sessionId: number) => Promise<ChannelShaping | null>,
	narratorName: (sessionId: number) => Promise<string | null>
): Promise<unknown> {
	/**
	 * Who is in the session, and the prompt config they speak under.
	 *
	 * One read rather than three, because the cast is only useful
	 * assembled: a character row without its `sessionCharacters` join
	 * carries no `enabled`, and `enabled` is what decides whether
	 * that character is named in the prompt and given a turn.
	 * Splitting them would let a spec read the characters and skip
	 * the join, which is a switched-off character in every prompt
	 * and no error anywhere.
	 *
	 * ⚠ **Every seat, switched off or not** (2026-09-27): a seat
	 * the cast list switched off (`session_characters.is_active`,
	 * and a player seat's `session_personas.is_active` since
	 * 2026-11-10) is still a seat, and goes out with `enabled: false` so a
	 * pipeline or a widget can filter on it. Every reader that
	 * must not see one filters on `enabled` itself — the turn
	 * pool, the rotation, the prompt's `characterNames`, the
	 * choice-options node.
	 *
	 * The rows go out raw. Which of them are shown, named, or
	 * trimmed is `promptFields.resolveContextInput`'s decision — the
	 * host retrieves, it does not choose.
	 */
	const sessionId = q.sessionId ?? scope.sessionId
	assertScoped(node, q.sessionId, scope.sessionId)
	if (sessionId === undefined) return null

	const [session] = await db
		.select()
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return null

	// `position` and `removedAt` ride along for the next-speaker
	// strategies (19 §5): the rotation is ordered by position and
	// must not seat a soft-removed participant. Inert to the
	// prompt path — `resolveContextInput` picks fields by name.
	const [characterSeatRows, personaSeatRows] =
		await Promise.all([
			db
				.select({
					// `is_active` in the table, `enabled` on
					// every read a pipeline or widget takes
					// (R5: translated here, at the seam).
					enabled: schema.sessionCharacters.isActive,
					position: schema.sessionCharacters.position,
					removedAt:
						schema.sessionCharacters.removedAt,
					// 🚧 The seat and the member it seats ride
					// along (seat-cast S2): the character is read
					// as that member below.
					castMemberId:
						schema.sessionCharacters.castMemberId,
					seatId: schema.sessionCharacters.id,
					// 🚧 Who seated it (owner 2026-11-05, ★S2b-1
					// "Still theo"): the person acting for a card-less
					// seat, never `characters.user_id`.
					seatedByUserId:
						schema.sessionCharacters.seatedByUserId,
					// The card the seat holds, null for a card-less
					// seat; its row is read below as its current
					// card version.
					cardId: schema.characters.id
				})
				.from(schema.sessionCharacters)
				.leftJoin(
					schema.characters,
					eq(
						schema.sessionCharacters.characterId,
						schema.characters.id
					)
				)
				// The seat filter: not an envoy, and has a member
				// or a card.
				.where(
					and(
						eq(
							schema.sessionCharacters.sessionId,
							sessionId
						),
						isNull(schema.sessionCharacters.envoySlug),
						or(
							isNotNull(
								schema.sessionCharacters.characterId
							),
							isNotNull(
								schema.sessionCharacters.castMemberId
							)
						)
					)
				),
			// 🚧 Left-joined (2026-10-14): a seat need not
			// voice a card. A card-less player seat rides with
			// `persona: null` and its `seatName`; a departed
			// card's leftover row (neither) is dropped below.
			db
				.select({
					cardId: schema.characters.id,
					// `is_active` → `enabled` at this seam, as the
					// character select above (R5): the bench.
					enabled: schema.sessionPersonas.isActive,
					position: schema.sessionPersonas.position,
					removedAt: schema.sessionPersonas.removedAt,
					seatId: schema.sessionPersonas.id,
					castMemberId:
						schema.sessionPersonas.castMemberId,
					seatName: schema.sessionPersonas.seatName,
					seatUserId: schema.sessionPersonas.userId
				})
				.from(schema.sessionPersonas)
				.leftJoin(
					schema.characters,
					eq(
						schema.sessionPersonas.personaId,
						schema.characters.id
					)
				)
				.where(
					eq(
						schema.sessionPersonas.sessionId,
						sessionId
					)
				)
		])

	// 🚧 The held cards as their CURRENT CARD VERSION has them
	// (`cardsNow`, never the ⏳ copies or the frozen columns): the
	// `characters` row shape with the version's profile in its
	// column names. A character seat whose card is gone is dropped
	// (the inner join's meaning); a player seat without a card
	// rides with `persona: null`.
	const heldCards = await cardsNow(db, [
		...characterSeatRows.flatMap((r) =>
			r.cardId != null ? [r.cardId] : []
		),
		...personaSeatRows.flatMap((r) =>
			r.cardId != null ? [r.cardId] : []
		)
	])
	// A card-less seat (no card, a stored member) has no card row
	// here: `character` is null until the member read below fills
	// it, and a card-less seat whose member does not read is dropped
	// after it.
	const seatsHeld = characterSeatRows.flatMap(
		({ cardId, ...row }) => {
			if (cardId == null)
				return [{ ...row, character: null as CardNow | null }]
			const character = heldCards.get(cardId)
			return character ? [{ ...row, character }] : []
		}
	)
	const sessionPersonas = personaSeatRows.map(
		({ cardId, ...row }) => ({
			...row,
			persona:
				(cardId != null ? heldCards.get(cardId) : undefined) ??
				null
		})
	)

	/**
	 * 🚧 Each character seat read as the cast member it seats
	 * (seat-cast S2): the member's own name and nickname and each
	 * retold field, over the member's active card — every seat,
	 * live, departed or switched off, in the session's own book
	 * as in an attached one. A seat whose member is not stored
	 * yet reads the one the seat writer would find, so today's
	 * data reads as it did. Player seats read their member the
	 * same way (★pT-1, 2026-11-05: "Everything in session is cast
	 * -> active card"); a seat name then wins over the member's
	 * name (`withSeatName` below).
	 */
	// One member read per seat set (`seatMembersAsRead`), shared by
	// the card filled from the member and the host-filled `cardId`.
	const seatReads = await seatMembersAsRead(
		db,
		sessionId,
		seatsHeld,
		{ cardless: true }
	)
	// A card-less seat reads its stored member (trusted when it lives
	// in the session's books) as a card-shaped object with no `id`;
	// one whose member does not read is dropped. `sessionCharacters`,
	// `castReads` and `castRows` are all built from this one
	// filtered list, so they stay index-aligned (the output reads
	// them by `i`).
	const keptSeats = seatsHeld.flatMap((row, i) => {
		const asRead = seatReads[i]
		if (row.character) return [{ row, asRead }]
		return asRead
			? [
					{
						row: {
							...row,
							character: cardlessSeatCard(asRead) as unknown as CardNow
						},
						asRead
					}
				]
			: []
	})
	const sessionCharacters = keptSeats.map((k) => k.row)
	const castReads = keptSeats.map((k) => k.asRead)
	const castRows = sessionCharacters.map((row, i) => {
		const asRead = castReads[i]
		if (!asRead || !row.character) return row
		// A card-less seat's card is already its member as read.
		if ((row.character as { cardless?: boolean }).cardless)
			return row
		const character = seatCardAsRead(row.character, asRead)
		return character === row.character ? row : { ...row, character }
	})
	const personaSeats = sessionPersonas.map((cp) => ({
		...cp,
		character: cp.persona
	}))
	const personaReads = await seatMembersAsRead(
		db,
		sessionId,
		personaSeats
	)
	// 🚧 A card-less player seat holds no card for `seatMembersAsRead`
	// to read through, but may store a member: those are read in
	// one batch, for the host-filled `cardId` alone.
	const cardlessReads = await membersAsRead(
		db,
		personaSeats.flatMap((cp) =>
			cp.character == null && cp.castMemberId != null
				? [cp.castMemberId]
				: []
		),
		{ sessionId }
	)
	const personaRows = personaSeats.map((cp, i) => {
		const asRead = personaReads[i]
		const { character, ...rest } = cp
		const filled =
			asRead && character
				? seatCardAsRead(character, asRead)
				: character
		return {
			...rest,
			persona: filled as typeof cp.persona,
			// 🚧 A card-less player seat's description is its
			// member's as read (`SessionPersonaRow.memberDescription`).
			memberDescription:
				character == null && cp.castMemberId != null
					? (cardlessReads.get(cp.castMemberId)?.description ??
						null)
					: null,
			// 🚧 Host-filled identity (seat-cast S3): the seat's
			// ref (`hostSeatRefOf`: `player-seat:<id>` with the
			// member-form switch on, else the card's / a card-less
			// seat's); `cardId` is the member's active card on the
			// timeline.
			ref: hostSeatRefOf({
				kind: "player",
				seatId: cp.seatId,
				castMemberId: cp.castMemberId,
				cardId: character?.id ?? null
			}),
			cardId: asRead
				? asRead.activeCardId
				: cp.castMemberId != null &&
					  cardlessReads.has(cp.castMemberId)
					? cardlessReads.get(cp.castMemberId)!.activeCardId
					: (character?.id ?? null)
		}
	})

	/**
	 * The other half of the alias union, per cast member.
	 *
	 * `characters.aliases` rides on the
	 * rows above already; `lorebook_bindings.absorbedAliases` —
	 * where `narrativeGraph:mergeNode` puts the identity a merge
	 * absorbed — does not, and that column's schema note makes
	 * reading **both** mandatory for any consumer matching on
	 * names. It is kept out of `aliases` on purpose: `aliases`
	 * is a one-directional sync target replaced wholesale on
	 * every entity edit, so an absorbed name written there would
	 * vanish the next time that sync ran.
	 *
	 * Read here rather than at each consumer because this is the
	 * one place that already knows both the session and its
	 * lorebook. Attached per row and inert to the prompt path —
	 * `resolveContextInput` picks fields by name, as it does
	 * with `position` and `removedAt`.
	 */
	// ONE map: a voiced character's binding is a character
	// binding, so the cast and the voices read the same key
	// space. `absorbedByPersona` is an alias of it so both call
	// sites below still say which side they are on.
	const absorbedByCharacter = new Map<number, string[]>()
	const absorbedByPersona = absorbedByCharacter
	/**
	 * The book's whole roster, not just the seated part of it.
	 *
	 * The same rows the alias map above is built from, kept
	 * whole and passed on, because retrieval's gazetteer needs
	 * the names of characters this session never seated — a
	 * lorebook binds a cast far larger than any one scene, and
	 * `annotations/loadVocabulary` has always read all of them.
	 * Retrieval reading only the seated ones is how the two
	 * subsystems came to disagree about what one lorebook is
	 * called.
	 *
	 * Carried on the cast read rather than given a read of its
	 * own purely to avoid a second query: this block already
	 * has the rows, and `loreFor` runs three times a turn with
	 * `lorebook-triggers` behind it. Inert to the prompt path
	 * for the same reason `absorbedAliases` is.
	 */
	let lorebookBindings: Array<{
		/** `lorebook_bindings.id`: the member's own id (a member with no live card is `cast_member:<id>` to retrieval). */
		id: number
		characterId: number | null
		/** The linked card is soft-deleted; null without a card. */
		cardDeleted: boolean | null
		name: string | null
		aliases: string[]
		absorbedAliases: string[]
	}> = []
	if (session.lorebookId) {
		const stored = await db
			.select({
				id: schema.lorebookBindings.id,
				characterId:
					schema.lorebookBindings.characterId,
				cardDeleted: schema.characters.isDeleted,
				name: schema.lorebookBindings.name,
				absorbedAliases:
					schema.lorebookBindings.absorbedAliases
			})
			.from(schema.lorebookBindings)
			.leftJoin(
				schema.characters,
				eq(
					schema.characters.id,
					schema.lorebookBindings.characterId
				)
			)
			.where(
				eq(
					schema.lorebookBindings.lorebookId,
					session.lorebookId
				)
			)
			// Stable, and the same order `loadVocabulary` reads
			// them in: two bindings claiming one name must be
			// settled the same way on both sides.
			.orderBy(asc(schema.lorebookBindings.id))
		/**
		 * Each member as the session's reading sees them
		 * (findings #38/#144): a name or an alias a cast version
		 * set by the session's clock is what the story calls them
		 * now (`membersAsRead`). The card stays the member's
		 * own — it is the key a seat holds.
		 */
		const memberReads = await membersAsRead(
			db,
			stored.map((b) => b.id),
			{ sessionId }
		)
		const bindings = stored.map((b) => {
			const m = memberReads.get(b.id)
			return {
				id: b.id,
				characterId: b.characterId,
				cardDeleted: b.cardDeleted ?? null,
				name: m?.name ?? b.name ?? null,
				aliases: m?.aliases ?? [],
				absorbedAliases: Array.isArray(b.absorbedAliases)
					? b.absorbedAliases
					: []
			}
		})
		lorebookBindings = bindings
		// Every card of a member's carries what they absorbed —
		// the linked one and each a dated change draws them with
		// (plan A25) — so a seat holding either hears it.
		const { castMemberCards } = await import(
			"$lib/server/utils/castMemberCards"
		)
		const { cardsOf } = await castMemberCards(
			db,
			session.lorebookId
		)
		for (const [i, b] of bindings.entries()) {
			const names = Array.isArray(b.absorbedAliases)
				? b.absorbedAliases
				: []
			if (!names.length) continue
			// An unbound background graph node has no card, so
			// it contributes no absorbed identity to anybody.
			for (const id of cardsOf.get(stored[i].id) ?? [])
				absorbedByCharacter.set(id, [
					...(absorbedByCharacter.get(id) ?? []),
					...names
				])
		}
	}

	/**
	 * The seated envoys (plans/29 R-18; U5g): cast rows with
	 * `envoy_slug`, each joined to its declaration — name,
	 * description, image, `speaks` — because an envoy has no
	 * character row for the `innerJoin` above to find. Live
	 * and departed, like the character rows, with `position`
	 * and `removedAt` riding along for the turn strategies;
	 * `speaks` is what tells a strategy whether it may pick
	 * one (`in-turn`) or never may (`on-action`).
	 */
	const { seatedEnvoys, sessionDeclaredEnvoys } = await import(
		"$lib/server/pipelines/entities/envoys"
	)
	const envoys = await seatedEnvoys(db, sessionId)
	/**
	 * What the prompt's transcript names a line under, beside
	 * the seats: an envoy that speaks unseated (an action's
	 * envoy; the genre's fallback), and the narrator name a
	 * line nobody claims falls back to when the genre declares
	 * no fallback envoy (ruled 2026-09-26). Read by
	 * `SessionMessageProcessor`; inert everywhere else. The
	 * declarations are cached per genre, so this is no query.
	 */
	const seatedSlugs = new Set(envoys.map((e) => e.slug))
	const declaredEnvoys = (
		await sessionDeclaredEnvoys(db, sessionId)
	).filter((d) => !seatedSlugs.has(d.slug))
	const sessionNarratorName = await narratorName(sessionId)
	/**
	 * The session's members by user id — the owner and the
	 * guests — under the name the session view gives a line
	 * a person writes as themselves (`getMessageCharacter`):
	 * display name, else username (lair pass B11). A genre
	 * with no persona system has no other name for that
	 * line, and an empty one prompts as `": …"`. Read by
	 * `SessionMessageProcessor` only when a user line has no
	 * other name; inert everywhere else.
	 */
	const memberRows = await db
		.select({
			id: schema.users.id,
			displayName: schema.users.displayName,
			username: schema.users.username
		})
		.from(schema.users)
		.where(
			inArray(schema.users.id, [
				session.userId,
				...(
					await db
						.select({ userId: schema.sessionGuests.userId })
						.from(schema.sessionGuests)
						.where(
							eq(schema.sessionGuests.sessionId, sessionId)
						)
				).map((g) => g.userId)
			])
		)
	const memberNames: Record<number, string> = {}
	for (const m of memberRows) {
		const name = m.displayName?.trim() || m.username?.trim()
		if (name) memberNames[m.id] = name
	}

	/**
	 * Whose name a turn triggered on THIS TURN'S channel seeds
	 * under (R-C, 2026-09-17) — the declared `voice` of
	 * `scope.channel`'s slug, from the shaping this host
	 * already caches.
	 *
	 * It rides the cast read for one reason: it is the only
	 * value `core:task/build-template-context@1` and
	 * `core:task/process-messages@1` are *both* wired to, and
	 * the two halves of the seed decision are one rule
	 * (`prompt/seedLine.ts`). A port of its own would need a
	 * wire on every spec that assembles a prompt, which is a
	 * document change on each of them for a fact none of them
	 * varies.
	 *
	 * ⚠ **Absent unless the trigger NAMED a channel**, and
	 * that is the load-bearing half. A turn that named none
	 * would resolve to `main` here and `main`'s voice would
	 * then *override* the trigger row's — so a writing room,
	 * whose turns are triggered on the manuscript and say so
	 * nowhere yet, would grow back the trailing `Verity:` this
	 * whole rule exists to remove. Silence means "nobody told
	 * me", never "main", and `processMessages` keeps reading
	 * the trigger row until every trigger speaks up.
	 *
	 * ⚠ **And absent unless the genre shapes channels**, on
	 * the same terms as `channelRole` on a row:
	 * `channelShaping` answers `null` for every genre that
	 * lists only bare slugs, so the cast a pre-R-C session
	 * reads is the object it was before this existed — no key,
	 * not a key holding the default.
	 */
	const named =
		typeof scope.channel === "string" &&
		scope.channel.trim()
			? parseChannel(resolveChannel(scope.channel)).slug
			: null
	const turnChannelVoice = named
		? (await channelShaping(sessionId))?.get(named)?.voice
		: undefined

	/**
	 * The session's story time for the prompt's `currentDate`
	 * (DESIGN-story-time §3, P5, P3): the session's own clock
	 * when it has one, else the present on its line (the
	 * line's clock, else its newest history entry), and the
	 * declared calendar to spell it through. Always an object
	 * (`SessionCastV1.storyTime`): the session's own notes are
	 * its book when none is attached, so there is always a book.
	 * `timeline` is the governing lorebook's switch. One rule
	 * (D56): with it off, `now`, `calendar` and `sessionStart`
	 * are all `null`, whatever is stored.
	 */
	const { sessionStoryNowOf, timelessNull } = await import("$lib/server/state/storyTime")
	const { bookTimelineSql, timelineOf } = await import("$lib/server/lorebooks/timeline")
	const { readStoryCalendar } = await import("$lib/shared/lorebooks/storyDate")
	const storyBook =
		session.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
	// Null only when the session row is gone: the same answer as the read's
	// missing-session case above.
	if (storyBook == null) return null
	// 🚧 A session that reads an attached lorebook counts
	// its own notes' history days too (`ownBookDaysCounted`).
	const storyNow = session.lorebookId
		? ((await ownBookDaysCounted(db, sessionId))?.now ??
			(await sessionStoryNowOf(db, sessionId)))
		: await sessionStoryNowOf(db, sessionId)
	// One select of the calendar and the switch: no statement beyond the calendar read.
	const [storyBookRow] = await db
		.select({
			storyCalendar: schema.lorebooks.storyCalendar,
			timelineEnabled: bookTimelineSql(),
			// `storyTime.sessionStart`: the day of the session's first live
			// stamped message ("y-m-d"), folded in as a scalar subquery so the
			// read costs no statement. A Dungeon Crawler counts its days from it.
			sessionStart: sql<string | null>`(select m.story_clock_year || '-' || coalesce(m.story_clock_month, 1) || '-' || coalesce(m.story_clock_day, 1) from session_messages m where m.session_id = ${sessionId} and m.rewind_ordinal is null and m.story_clock_year is not null order by m.id asc limit 1)`
		})
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, storyBook))
		.limit(1)
	const timeline = timelineOf(storyBookRow)
	const timelineOff = !timeline
	const startParts = /^(-?\d+)-(\d+)-(\d+)$/.exec(storyBookRow?.sessionStart ?? "")
	const storyTime = {
		timeline,
		now: timelessNull(timelineOff, storyNow),
		calendar: timelessNull(timelineOff, readStoryCalendar(storyBookRow?.storyCalendar ?? null)),
		sessionStart: timelessNull(
			timelineOff,
			startParts
				? {
						year: Number(startParts[1]),
						month: Number(startParts[2]),
						day: Number(startParts[3])
					}
				: null
		)
	}

	/**
	 * How much of each card a non-speaking character shows
	 * (2026-09-27): the genre field `characterDetail`, off
	 * the same cascade the settings form reads
	 * (`genreFieldsFor` — stored, pinned, declared default).
	 *
	 * On the cast read for `turnChannelVoice`'s reason: it is
	 * the one value `build-template-context` is wired to on
	 * every spec, and a port of its own would be a wire on
	 * each of them for a fact none of them varies. ⚠ Absent —
	 * no key — for a genre that declares no such field, so the
	 * cast those sessions read is the object it was.
	 */
	const { genreFieldsFor, playerLabelFor } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const sessionFields = await genreFieldsFor(db, sessionId)
	const characterDetail = sessionFields.characterDetail
	/**
	 * 🚧 The session's AI replies so far (AN1), for the
	 * author's note's `interval`: the main channel's completed
	 * assistant lines — the reply being written now is still
	 * generating and is not one of them, so a regenerate counts
	 * as the reply it replaces did. On the cast read for
	 * `characterDetail`'s reason. ⚠ Absent — no key, no
	 * query — unless the genre declares the note (an object
	 * value), so every other session's cast is the object it
	 * was.
	 */
	const replyCount =
		sessionFields.authorsNote &&
		typeof sessionFields.authorsNote === "object" &&
		!Array.isArray(sessionFields.authorsNote)
			? Number(
					(
						await db
							.select({ n: count() })
							.from(schema.sessionMessages)
							.where(
								and(
									eq(schema.sessionMessages.sessionId, sessionId),
									eq(schema.sessionMessages.role, "assistant"),
									eq(schema.sessionMessages.channel, "main"),
									eq(schema.sessionMessages.isGenerating, false)
								)
							)
					)[0]?.n ?? 0
				)
			: undefined
	/**
	 * What a person's persona-less line is called (lair
	 * re-plan R4): the session's override, else the genre's
	 * `playerLabel`, resolved here once — read at prompt
	 * time, never stamped on a row. `SessionMessageProcessor`
	 * names those lines by it (before `memberNames`), and
	 * every context builder puts it on the template context
	 * as `{{playerLabel}}`. On the cast read for
	 * `characterDetail`'s reason. ⚠ Absent — no key — for a
	 * genre that declares none, so their cast is the object
	 * it was.
	 */
	const playerLabel = await playerLabelFor(db, sessionId)
	return {
		...(playerLabel ? { playerLabel } : {}),
		...(turnChannelVoice ? { turnChannelVoice } : {}),
		storyTime,
		...(typeof characterDetail === "string"
			? { characterDetail }
			: {}),
		...(replyCount !== undefined ? { replyCount } : {}),
		sessionCharacters: castRows.map((cc, i) => ({
			...cc,
			// 🚧 Host-filled identity (seat-cast S3): `castMemberId`
			// is the seat's own (already on the row); `ref` is the seat's
			// (`hostSeatRefOf`: `seated-member:<id>` with the member-form
			// switch on, ⏳ its card while it stores no member, else the
			// card's); `cardId` is the member's active card on the
			// timeline, else the held card.
			ref: hostSeatRefOf({
				kind: "character",
				seatId: cc.seatId,
				castMemberId: cc.castMemberId,
				cardId: sessionCharacters[i].character?.id ?? null
			}),
			// No card-id fallback for a card-less seat (a member id
			// is never a card id).
			cardId:
				castReads[i]?.activeCardId ??
				sessionCharacters[i].character?.id ??
				null,
			enabled: cc.enabled !== false,
			absorbedAliases:
				(cc.character?.id != null
					? absorbedByCharacter.get(cc.character.id)
					: undefined) ?? []
		})),
		sessionPersonas: personaRows
			.filter((cp) => cp.persona || cp.seatName)
			.map((cp) => ({
			...cp,
			// 🚧 A seat name wins over the card's name; the
			// card still supplies the rest (`promptFields`).
			persona: withSeatName(cp.persona, cp.seatName),
			// 🚧 A player seat carries the bench too (owner
			// 2026-11-10): `enabled: false` is benched. Said, so
			// one filter serves both tables.
			enabled: cp.enabled !== false,
			absorbedAliases:
				(cp.persona && absorbedByPersona.get(cp.persona.id)) ?? []
		})),
		envoys,
		declaredEnvoys,
		...(sessionNarratorName ? { sessionNarratorName } : {}),
		memberNames,
		lorebookBindings,
		sessionScenario: session.scenario ?? null,
		isGroup: Boolean(session.isGroup),
		/**
		 * 🚧 Who triggered this run — with several seats,
		 * `{{user}}` is their own seat (`promptFields`).
		 */
		...(scope.userId != null ? { viewerUserId: scope.userId } : {}),
		/**
		 * Whose session this cast is (B2, 2026-10-03) — the key
		 * the speaker's example dialogue is picked by, so the
		 * pick holds for the whole session instead of being
		 * re-drawn from each run's seed (`build-template-context`).
		 */
		sessionId
	}
}
