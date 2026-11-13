/**
 * 🚧 **Hand edits** — the one decider for every change a *person's hand* makes to a
 * sheet (owner rulings 2026-11-05, plan `PLAN-sdk-creation-seams` §25 B): a value set
 * (`state:set`), a stat's set-up or lock changed (`state:configure`), and the two sides
 * of an item move (`givePiece`, an offer accepted).
 *
 * **Purpose.** Answer one question in one place, for the write and for the sheet's
 * controls alike: may *this person* put a hand on *this value* of *this owner*, and if
 * not, in what words? A refusal is `{ cause, sentence }`; `null` is allowed.
 *
 * **Why it exists.** Before it the rule was scattered: `changedByRefusal` and
 * `unheardWrite` in `sockets/state.ts`, hand blocks inside `assertSessionOwner`, and a
 * player's sheet waiting on Honour mode in `playerEditsOwnSheet` — three places that
 * could disagree, and none that knew who the person was in the session. Now the sheet's
 * `editable` and per-stat `handLocked` come from the same answer the write gives.
 *
 * **Owns.** Reading who the person is (the session's owner, a player, a watcher), whose
 * the target is seen from them, the four resolved levels (sheet latitude and item moves,
 * one pair per role) and whether each is pinned by the genre or exposed to the session's
 * owner; asking the SDK's judge; and the sentence each cause is refused with (the SDK's
 * defaults, with this app's own where today's words are kept).
 *
 * **Does NOT own.** The judge — `sheetLatitudeAllows`, in the SDK; the levels' storage —
 * the settings cascade (`cascadeSessionFields`); a stat's lock and `changedBy` — read
 * here, written by `configure` and the rulesets; whether an owner is *this session's*
 * (`assertSessionOwner`); the durable layer's writer (`assertBookWriter`); and **runs**: a
 * run (`userId` null) never reaches this module — the latitude limits a person's hand only.
 *
 * Every read goes through the `db` handle passed in (a transaction's `tx` inside
 * `decideOffer`), never the module `db`.
 */
import { and, eq, inArray, isNotNull, isNull, or } from "drizzle-orm"
import { attributeSlotsOf, sectionsOf } from "$lib/server/rulesets/functionRun"
import {
	getAttributeSlot,
	getRuleset,
	HAND_EDIT_SENTENCES,
	itemMoveLatitudeOf,
	sheetLatitudeAllows,
	sheetLatitudeOf,
	type AttributeChanger,
	type HandEditAct,
	type HandEditCause,
	type HandEditorRole
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { cardsNow } from "$lib/server/cast/seatedCast"
import { membersAsRead, type MemberAsRead } from "$lib/server/cast/memberAsRead"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import {
	cascadeSessionFields,
	getSessionGenre,
	STANDARD_GENRE_ID
} from "$lib/server/pipelines/entities/sessionGenres"
import {
	configFor,
	sessionLinks,
	slotKey,
	type SessionLinks
} from "$lib/server/state/resolve"
import {
	earshotSlots,
	hearingOf,
	valueHeard,
	type Hearing
} from "$lib/server/state/earshot"
import { castOwnerOf, type StateOwner } from "$lib/server/state/owners"
import { castLinkKey } from "$lib/server/state/keys"
import { memberFormOn } from "$lib/server/state/memberForm"
import { LOCKED_REFUSAL, slotLockOf } from "$lib/server/state/write"

type Db = any

/**
 * 🚧 Each seat's cast member as read over its active card on the session's
 * reading (owner ruling 2026-11-05: "Everything in session is cast -> active
 * card"), by member id.
 */
async function seatMembersRead(
	db: Db,
	sessionId: number,
	memberIds: readonly number[]
): Promise<Map<number, MemberAsRead>> {
	return membersAsRead(db, memberIds, { sessionId })
}

/** A refused hand edit: the SDK's cause, and the sentence the person reads. */
export type HandEditRefusal = { cause: HandEditCause; sentence: string }

/** What the judge needs of a character: whose card it is, and its name. */
type CharacterFacts = { userId: number | null; name: string | null }

/** A live player seat: the person who plays it, the card it voices (if any), its name. */
type SeatFacts = {
	id: number
	personaId: number | null
	player: number | null
	name: string | null
}

/** The one thing a refusal sentence is about: the owner and the slot. */
type EditTarget = { owner: StateOwner; slotId: string }

const SHEET_KEYS = {
	owner: "ownerSheetLatitude",
	player: "playerSheetLatitude"
} as const
const MOVE_KEYS = {
	owner: "ownerItemMoves",
	player: "playerItemMoves"
} as const

/** The reading of a stat's name a person sees: its label, else its key (as `changedByRefusal` read it). */
const labelOf = (slotId: string): string => {
	const decl = getAttributeSlot(slotId)
	return (decl && i18nTextIn(decl.label)) ?? slotKey(slotId)
}

/**
 * Load, once, everything a hand-edit judgment reads about one person in one session, and
 * hand back a **synchronous** judge: `describeState` asks it about every slot of every
 * owner, with no per-slot database read.
 *
 * `userId` null is the owner's view (a read with no person), as `describeState` has it.
 * `known` lets a caller that already read the session's links and the person's hearing
 * (`describeState`) pass them rather than read them again.
 */
export async function handEditJudge(
	db: Db,
	sessionId: number,
	userId: number | null,
	known: { links?: SessionLinks; hearing?: Hearing } = {}
) {
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			primaryRuleset: schema.sessions.primaryRuleset,
			genreId: schema.sessions.genreId,
			presetId: schema.sessions.presetId,
			genreFields: schema.sessions.genreFields
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)

	// Who the person is: the owner; a guest who plays; anyone else watches.
	let role: HandEditorRole = "watcher"
	if (userId == null || (session && session.userId === userId)) role = "owner"
	else if (session) {
		const [guest] = await db
			.select({ isPlayer: schema.sessionGuests.isPlayer })
			.from(schema.sessionGuests)
			.where(
				and(
					eq(schema.sessionGuests.sessionId, sessionId),
					eq(schema.sessionGuests.userId, userId)
				)
			)
			.limit(1)
		if (guest) role = guest.isPlayer ? "player" : "watcher"
	}

	// The four resolved levels, and which the genre leaves to the session's owner (declared in
	// `shape.fields`) as against pins silently (absent there).
	const genre = session
		? await getSessionGenre(db, session.genreId ?? STANDARD_GENRE_ID)
		: null
	const fields = session ? await cascadeSessionFields(db, session, genre) : {}
	const declared = ((
		genre?.shape as { fields?: Record<string, unknown> } | undefined
	)?.fields ?? {}) as Record<string, unknown>
	const sideRole = role === "owner" ? "owner" : "player"
	const latitude = sheetLatitudeOf(fields[SHEET_KEYS[sideRole]])
	const itemMoves = itemMoveLatitudeOf(fields[MOVE_KEYS[sideRole]])
	const exposed = {
		sheet: SHEET_KEYS.player in declared,
		moves: MOVE_KEYS.player in declared
	}

	const links = known.links ?? (await sessionLinks(db, sessionId))
	const slots = earshotSlots()
	const hearing: Hearing =
		known.hearing ??
		(userId == null
			? { all: true }
			: await hearingOf(
					db,
					sessionId,
					userId,
					links.cast,
					links.playerSeats,
					links.seatedMembers ?? []
				))
	const castMemberOf = (castMemberId: number): number | undefined =>
		links.cast.find((c) => c.castMemberId === castMemberId)?.characterId

	// The live player seats, with whoever plays each (the seat's own person, else its card's owner).
	const seatRows = await db
		.select({
			id: schema.sessionPersonas.id,
			personaId: schema.sessionPersonas.personaId,
			userId: schema.sessionPersonas.userId,
			seatName: schema.sessionPersonas.seatName,
			castMemberId: schema.sessionPersonas.castMemberId
		})
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt)
			)
		)

	// A seat's card name is its card's current version's (never the ⏳ copy).
	const seatCards = await cardsNow(
		db,
		seatRows.flatMap((r: { personaId: number | null }) => (r.personaId != null ? [r.personaId] : []))
	)

	// 🚧 Who seated each live character seat's card (owner 2026-11-05, "The
	// person who seated it"): a character no one plays is its seater's.
	const seaterOf = new Map<number, number>()
	// A card-less seat has no card to key by: its seater is found by member
	// (⚠ a member id, never read as a card id).
	const seaterOfMember = new Map<number, number>()
	for (const r of await db
		.select({
			characterId: schema.sessionCharacters.characterId,
			castMemberId: schema.sessionCharacters.castMemberId,
			seatedBy: schema.sessionCharacters.seatedByUserId
		})
		.from(schema.sessionCharacters)
		.where(
			and(
				eq(schema.sessionCharacters.sessionId, sessionId),
				isNull(schema.sessionCharacters.removedAt),
				isNull(schema.sessionCharacters.envoySlug),
				or(
					isNotNull(schema.sessionCharacters.characterId),
					isNotNull(schema.sessionCharacters.castMemberId)
				)
			)
		)) {
		if (r.seatedBy == null) continue
		if (r.characterId != null && !seaterOf.has(r.characterId))
			seaterOf.set(r.characterId, r.seatedBy)
		if (r.characterId == null && r.castMemberId != null && !seaterOfMember.has(r.castMemberId))
			seaterOfMember.set(r.castMemberId, r.seatedBy)
	}

	// 🚧 Who each seat is: the seat's cast member as read over its active card
	// (S2), keyed by **seat** (`castLinkKey`; a player-seat row `player_seat:<id>`
	// once the flip is on) so a ★K-2 card's two seats each keep their own member.
	// Off, one link per card: the key is the card id, first seat wins as before. A
	// seat with no member reads its card.
	const rowKey = (r: { id: number; personaId: number }): string =>
		memberFormOn() ? `player_seat:${r.id}` : String(r.personaId)
	const seatMemberOfSeat = new Map<string, number>()
	/** The first seat key of each card, for an owner that names only the card. */
	const keyOfCard = new Map<number, string>()
	for (const c of links.cast) {
		const key = castLinkKey(c)
		if (c.seatMemberId != null && !seatMemberOfSeat.has(key))
			seatMemberOfSeat.set(key, c.seatMemberId)
		if (!keyOfCard.has(c.characterId)) keyOfCard.set(c.characterId, key)
	}
	for (const r of seatRows as any[]) {
		if (r.personaId == null) continue
		const key = rowKey(r)
		if (r.castMemberId != null && !seatMemberOfSeat.has(key))
			seatMemberOfSeat.set(key, r.castMemberId)
		if (!keyOfCard.has(r.personaId)) keyOfCard.set(r.personaId, key)
	}
	const seatMemberIds = [
		...new Set([
			...seatMemberOfSeat.values(),
			...(seatRows as any[]).flatMap((r) =>
				r.castMemberId != null && r.personaId != null
					? [r.castMemberId as number]
					: []
			)
		])
	]
	const memberReads = seatMemberIds.length
		? await seatMembersRead(db, sessionId, seatMemberIds)
		: new Map<number, MemberAsRead>()
	const readOfSeat = (key: string): MemberAsRead | undefined => {
		const memberId = seatMemberOfSeat.get(key)
		return memberId == null ? undefined : memberReads.get(memberId)
	}

	// Whose card each seat in the cast or on a seat row is, by seat key.
	const characters = new Map<string, CharacterFacts>()
	const cardFacts = async (ids: readonly number[]) => {
		// The owner is the library row's; the name is the card's current version's.
		const now = await cardsNow(db, ids)
		return new Map<number, CharacterFacts>(
			[...now.values()].map((r) => [
				r.id,
				{ userId: r.userId ?? null, name: r.name ?? null }
			])
		)
	}
	const learnCharacters = async (
		seatsToLearn: readonly { key: string; cardId: number }[]
	) => {
		const want = seatsToLearn.filter((s) => !characters.has(s.key))
		if (!want.length) return
		// Ownership is the owner of the member's active card (the seat's card when the member is cardless or absent).
		const activeOf = (s: { key: string; cardId: number }) =>
			readOfSeat(s.key)?.activeCardId ?? s.cardId
		const facts = await cardFacts([
			...want.map((s) => s.cardId),
			...want.map(activeOf)
		])
		for (const s of want) {
			const card = facts.get(s.cardId)
			if (!card || characters.has(s.key)) continue
			characters.set(s.key, {
				userId: facts.get(activeOf(s))?.userId ?? null,
				name: readOfSeat(s.key)?.name ?? card.name
			})
		}
	}
	await learnCharacters([
		...links.cast.map((c) => ({ key: castLinkKey(c), cardId: c.characterId })),
		...(seatRows as any[]).flatMap((r) =>
			r.personaId != null
				? [{ key: rowKey(r), cardId: r.personaId as number }]
				: []
		)
	])
	/** Facts of the seat an owner names: a `seated_member` by its own key, any other by its card's first seat. */
	const factsOfOwner = (
		owner: StateOwner,
		cardId: number | null | undefined
	): CharacterFacts | undefined => {
		if (owner.kind === "seated_member") {
			const facts = characters.get(`seated_member:${owner.id}`)
			if (facts) return facts
			// A card-less seat is named by its seat; whose it is, is its seater's (`seaterOfMember`), not a card owner's.
			const seat = links.seatedMembers?.find(
				(s) => s.seatMemberId === owner.id
			)
			return seat ? { userId: null, name: seat.name } : undefined
		}
		if (cardId == null) return undefined
		return characters.get(keyOfCard.get(cardId) ?? String(cardId))
	}
	const seats: SeatFacts[] = (seatRows as any[]).map((r) => {
		const read =
			r.castMemberId != null && r.personaId != null
				? memberReads.get(r.castMemberId)
				: undefined
		return {
			id: r.id,
			personaId: r.personaId ?? null,
			player:
				r.userId ??
				(r.personaId != null
					? (characters.get(rowKey(r))?.userId ?? null)
					: null),
			name:
				(r.personaId == null
					? r.seatName
					: (read?.name ?? seatCards.get(r.personaId)?.name)) ?? null
		}
	})
	/** A cast member's character, where the session's links do not list it (`know`). */
	const memberCharacter = new Map<number, number | null>()

	const ruleset = session?.primaryRuleset
		? getRuleset(session.primaryRuleset)
		: undefined
	const changedByOf = (
		slotId: string
	): readonly AttributeChanger[] | undefined => {
		if (!ruleset) return undefined
		const id = attributeSlotsOf(ruleset).attributeOf.get(slotId)
		return id
			? (sectionsOf(ruleset).attributes ?? []).find((a) => a.id === id)
					?.changedBy
			: undefined
	}

	/** The character an owner is, when it is one (a seated or carded character, a cast member's). */
	const characterOf = (owner: StateOwner): number | null | undefined => {
		if (owner.kind === "session_cast" || owner.kind === "card")
			return owner.id
		// 🚧 ⏳ S4 (flip on): a character seat in member form is its link's card (⚠ `owner.id` is a member id, never a card id).
		if (owner.kind === "seated_member")
			return links.cast.find((c) => {
				const o = castOwnerOf(c)
				return o.kind === "seated_member" && o.id === owner.id
			})?.characterId
		if (owner.kind === "cast_member")
			return memberCharacter.has(owner.id)
				? memberCharacter.get(owner.id)
				: castMemberOf(owner.id)
		return undefined
	}
	const playerSeatOf = (owner: StateOwner): SeatFacts | undefined => {
		if (owner.kind === "player_seat")
			return seats.find((s) => s.id === owner.id)
		// 🚧 ⏳ S4 (flip on): a character seat is nobody's player seat, even when a player seat holds the same card (★K-2).
		if (owner.kind === "seated_member") return undefined
		const characterId = characterOf(owner)
		return characterId == null
			? undefined
			: seats.find((s) => s.personaId === characterId)
	}

	/** Whose the target is, seen from the person's role. */
	const whose = (owner: StateOwner): "own" | "other" => {
		if (role === "watcher") return "other"
		const mine = (id: number | null) => id != null && id === userId
		if (
			owner.kind === "session" ||
			owner.kind === "lorebook" ||
			owner.kind === "location" ||
			owner.kind === "session_location"
		)
			return role === "owner" ? "own" : "other"
		if (owner.kind === "player_seat") {
			const seat = seats.find((s) => s.id === owner.id)
			// A seat nobody is recorded as playing is nobody else's: the session's owner keeps it.
			return mine(seat?.player ?? null) ||
				(role === "owner" && seat?.player == null)
				? "own"
				: "other"
		}
		const characterId = characterOf(owner)
		if (role === "player") {
			// A live seat's character is its player's, whoever owns the card (scope review 2026-11-05: card
			// ownership alone let a card's owner reach another player's seat, and took a player's own seat
			// from them when the card is someone else's). A character no one plays: the seater's
			// (a live character seat), else the card owner's.
			const played = playerSeatOf(owner)
			if (played && played.player != null)
				return mine(played.player) ? "own" : "other"
			// A card-less character seat is its seater's (no card owner to fall back on).
			if (owner.kind === "seated_member" && characterId == null)
				return mine(seaterOfMember.get(owner.id) ?? null) ? "own" : "other"
			return characterId != null &&
				mine(
					seaterOf.get(characterId) ??
						factsOfOwner(owner, characterId)?.userId ??
						null
				)
				? "own"
				: "other"
		}
		// The session's owner: their own cards and everyone nobody plays are theirs; a live seat's player is somebody else.
		const seat = playerSeatOf(owner)
		return seat && seat.player != null && !mine(seat.player)
			? "other"
			: "own"
	}

	/** The words for `not-theirs` from a player's side: a seat or a played character, else the world's. */
	const notTheirs = (target: EditTarget): string => {
		const seat = playerSeatOf(target.owner)
		if (!seat) {
			// 🚧 Copy proposed by the supervisor (plan §25, lane ed brief).
			return "The world, its places and the people nobody plays are the session owner's to change."
		}
		const name = (
			seat.name ??
			(seat.personaId != null
				? characters.get(
						memberFormOn()
							? `player_seat:${seat.id}`
							: String(seat.personaId)
					)?.name
				: undefined) ??
			""
		).trim()
		return `only ${name || "that seat"}'s player or the session's owner can change ${name ? "their" : "its"} sheet.`
	}

	/** Today's `unheardWrite` sentences, moved here: who may change a value not everybody hears. */
	const unheard = ({ owner, slotId }: EditTarget): string => {
		const label = labelOf(slotId)
		const characterId =
			owner.kind === "cast_member"
				? castMemberOf(owner.id)
				: owner.kind === "session_cast" || owner.kind === "card"
					? owner.id
					: owner.kind === "seated_member"
						? characterOf(owner)
						: null
		const name =
			owner.kind === "session_location" || owner.kind === "location"
				? links.locations.find((l) => l.entryId === owner.id)?.name
				: owner.kind === "player_seat"
					? (links.playerSeats?.find(
							(s) => s.playerSeatId === owner.id
						)?.name ??
						// 🚧 ⏳ S4 (flip on): a carded player seat is a cast link of its own.
						links.cast.find((c) => c.playerSeatId === owner.id)?.name)
					: owner.kind === "seated_member" && characterId == null
						? // 🚧 ⏳ S4: a card-less character seat is named by its seat.
							links.seatedMembers?.find(
								(s) => s.seatMemberId === owner.id
							)?.name
						: links.cast.find((c) => c.characterId === characterId)
								?.name
		const whoseLabel = name ? `${name}'s ${label}` : label
		return slots.holder.has(slotId)
			? `Only the session's owner and whoever plays ${name ?? "that character"} can change ${whoseLabel}.`
			: `Only the session's owner can change ${whoseLabel}.`
	}

	/** The sentence a cause is refused with — the SDK's default, unless this app says it its own way. */
	const sentence = (
		cause: HandEditCause,
		target: EditTarget,
		lock: boolean | undefined
	): string => {
		const attribute = labelOf(target.slotId)
		switch (cause) {
			case "unheard":
				return unheard(target)
			case "locked":
				return LOCKED_REFUSAL
			case "changed-by":
				return role === "owner"
					? `${attribute} changes only by the rules — a function or a reply that carries changes — never by hand.`
					: `Only the game master or the rules change ${attribute}.`
			case "not-theirs":
				return role === "player"
					? notTheirs(target)
					: HAND_EDIT_SENTENCES[cause]({ attribute })
			case "no-edits":
				if (role !== "player") break
				return exposed.sheet
					? "Players don't edit sheets by hand in this session. The session owner can change that in the session's settings, under Players."
					: // 🚧 Copy proposed by the supervisor (plan §25, lane ed brief).
						"Players don't edit sheets by hand in this genre."
			case "no-moves":
				if (role !== "player") break
				return exposed.moves
					? // 🚧 Copy proposed by the supervisor (plan §25, lane ed brief).
						"Players don't move items by hand in this session. The session owner can change that in the session's settings, under Players."
					: // 🚧 Copy proposed by the supervisor (plan §25, lane ed brief).
						"Players don't move items by hand in this genre."
			case "owner-locks":
				// 🚧 Copy proposed by the supervisor (plan §25, lane ed brief): a configure that sets no lock.
				return lock === false
					? "Only the session owner changes how a stat is set up."
					: HAND_EDIT_SENTENCES[cause]({ attribute })
		}
		return HAND_EDIT_SENTENCES[cause]({ attribute })
	}

	return {
		/** Who the person is in this session. */
		role,
		/** Whose the owner is, seen from the person: `own` or `other`. */
		whose,
		/**
		 * Read what an owner needs that the session's links do not list: a `card`'s owner, a
		 * `cast_member`'s character. Call before `refusal` / `whose` on such an owner.
		 */
		async know(owner: StateOwner): Promise<void> {
			if (
				owner.kind === "cast_member" &&
				castMemberOf(owner.id) === undefined &&
				!memberCharacter.has(owner.id)
			) {
				const [row] = await db
					.select({
						characterId: schema.lorebookBindings.characterId
					})
					.from(schema.lorebookBindings)
					.where(eq(schema.lorebookBindings.id, owner.id))
					.limit(1)
				memberCharacter.set(owner.id, row?.characterId ?? null)
			}
			const characterId = characterOf(owner)
			if (characterId != null)
				await learnCharacters([
					{
						key:
							owner.kind === "seated_member"
								? `seated_member:${owner.id}`
								: (keyOfCard.get(characterId) ?? String(characterId)),
						cardId: characterId
					}
				])
		},
		/**
		 * The words a cause is refused with, for a caller that judged by its own rule (a decline).
		 */
		says: (cause: HandEditCause, target: EditTarget): string =>
			sentence(cause, target, undefined),
		/**
		 * May the person do `act` to `slotId` of `owner`? `config` is the slot's configuration
		 * as in force there (its `lock`); `lock` is, for a `configure`, whether the new
		 * configuration carries a `lock` key (it picks the sentence). Null: allowed.
		 */
		refusal(q: {
			owner: StateOwner
			slotId: string
			act: HandEditAct
			config?: Readonly<Record<string, unknown>> | null
			lock?: boolean
		}): HandEditRefusal | null {
			const verdict = sheetLatitudeAllows({
				role,
				act: q.act,
				whose: whose(q.owner),
				latitude,
				itemMoves,
				changedBy: changedByOf(q.slotId),
				lock: slotLockOf(q.config),
				heard: valueHeard(
					hearing,
					slots,
					{ owner: q.owner, slotId: q.slotId },
					castMemberOf
				)
			})
			return verdict.ok
				? null
				: {
						cause: verdict.cause,
						sentence: sentence(verdict.cause, q, q.lock)
					}
		}
	}
}

/**
 * Why `userId` may not do `act` to `slotId` of `owner` in the session, or `null` when they
 * may. A person's hand only — a run never asks. `lock` is only for `configure`: whether the
 * new configuration carries a `lock` key. `known` hands the judge a links / hearing the caller already holds (a shown seat joins the hearing).
 */
export async function handEditRefusal(
	db: Db,
	q: {
		sessionId: number
		userId: number
		owner: StateOwner
		slotId: string
		act: HandEditAct
		lock?: boolean
	},
	known: { links?: SessionLinks; hearing?: Hearing } = {}
): Promise<HandEditRefusal | null> {
	const judge = await handEditJudge(db, q.sessionId, q.userId, known)
	await judge.know(q.owner)
	// A configure is judged by who asks alone; every other act reads the slot's lock.
	const config =
		q.act === "configure"
			? null
			: await configFor(db, {
					sessionId: q.sessionId,
					owner: q.owner,
					slotId: q.slotId
				})
	return judge.refusal({
		owner: q.owner,
		slotId: q.slotId,
		act: q.act,
		config,
		lock: q.lock
	})
}
