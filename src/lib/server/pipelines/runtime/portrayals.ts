/**
 * Who portrays X this turn — the resolver (plans/29 R-15 *audience*, R-21
 * (4); ruled 2026-09-15, built 2026-09-16 as U5a; *portrayal* ruled
 * 2026-09-16 — *voice* is the adventure stage and TTS).
 *
 * A participant reference is a name (`character:12`, `user:3`, `owner`,
 * `envoy:mascot` — `@serene-pub/sdk` `participants.ts`); this answers, for a
 * session and the person who started the run, whether a **person** speaks as
 * that participant, the **AI** does, or **nobody** can. It is core's one new
 * primitive for the action model: audiences, the inlet's speaker and the
 * form-addressed pipeline all ask it and none of them re-derive it.
 *
 * ## The rules
 *
 * | Reference        | Portrayal                                                                                                                                                                                                                                                   |
 * | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
 * | `user:<id>`      | `person` (that user) if they are a session member — the owner or a guest (`checkSessionAccess`'s rule); else `none`.                                                                                                                                       |
 * | `owner`          | `person` — the session's owner.                                                                                                                                                                                                                             |
 * | `admin`          | `person` — the run owner, when they are an administrator; else `none`. "Any admin acting" is whoever is acting, and the person acting is the run owner.                                                                                                       |
 * | `participant`    | `person` — the run owner, when they are a member; else `none`.                                                                                                                                                                                             |
 * | `run-owner`      | `person` — the run owner, always.                                                                                                                                                                                                                           |
 * | `character:<id>` | `person` if the character is a member's **own presence** — a live `session_personas` row for it whose `characters.user_id` is a member (the persona ownership rule, `checkPersonaOwnership`); else `ai` if it is in the session's cast (a live `session_characters` row — `is_active` is a rotation property, not a membership, so a benched character is still the AI's) **or is the turn's `speaker`** (a side character speaks through the model for exactly this turn, and joins nothing); else `none`. |
 * | `envoy:<slug>`   | `ai` if the session's genre or an installed action **declares** the slug (`declaredEnvoys`, U5g) — seated or not: an action's envoy speaks the moment its action posts, and a genre's may be named as the speaker before its seat exists; else `none`. An envoy is never a person's. |
 * | `item`           | `none` — the per-message ownership rule is evaluated at the venue, against a message (`messages/permissions.ts` `canActOnMessage`), and a run has no message to evaluate it against.                                                                             |
 *
 * An id that is not a Postgres integer (`character:not-a-row`,
 * `user:99999999999`) is `none` and reaches no query — a malformed id is a
 * reference nobody holds, never a thrown read.
 *
 * Membership is read as it stands when this runs. That is the point of
 * resolving **once, at run start** (R-21 (4)): the answer is pinned on the
 * receipt and nothing later in the run — a member joining, a persona
 * attached mid-turn — changes what this run decided.
 *
 * ## What it does not do
 *
 * It does not check that the run owner may see the session; the trigger did.
 * It does not name anybody's connection. A `person` answer reveals exactly
 * what the session's member list already shows — that this user is here —
 * and nothing more, so a receipt carrying it needs no redaction beyond the
 * one every receipt gets (`withoutConnectionIdentity`).
 */

import * as schema from "$lib/server/db/schema"
import { and, asc, eq, inArray, isNull, isNotNull } from "drizzle-orm"
import { sessionDeclaredEnvoys } from "$lib/server/pipelines/entities/envoys"
import {
	formatParticipantRef,
	parseParticipantRef,
	type ParticipantRef,
	type Portrayal,
	type Portrayals
} from "@serene-pub/sdk"

export type { ParticipantRef, Portrayal, Portrayals }

export interface ResolvePortrayalsRequest {
	sessionId: number
	/** Who started the run. */
	runOwnerUserId: number
	/** The references the run needs answered. Duplicates are answered once. */
	refs: ReadonlyArray<ParticipantRef>
	/**
	 * Whose turn it is — the inlet's `speaker`. A character named here is
	 * the AI's unless a member's presence portrays them, whether or not a
	 * cast row exists: the run was started to have the model speak as them.
	 * Absent or null on a narrator turn and on a run with no speaker.
	 */
	speaker?: ParticipantRef | null
}

const PERSON = (userId: number): Portrayal => ({
	by: "person",
	userId: String(userId)
})
const AI: Portrayal = { by: "ai" }
const NONE: Portrayal = { by: "none" }

/** The largest id a `serial` column can hold — Postgres `integer`. */
const PG_INTEGER_MAX = 2147483647

/**
 * The row id a reference's opaque id names, or null when it names none.
 *
 * Digits only, and within what an `integer` column can hold: a reference
 * whose id would overflow the column is a reference to no row, answered
 * `none` here rather than surfaced as a driver error from a query it never
 * needed to reach. Leading zeros are refused — serial ids start at 1, so
 * `"07"` names no row and must not parse to the same id as `"7"` — so one
 * row has one key. Shared with the inspector's reader (`portrayalLinesOf`)
 * so the two agree on what an id is.
 */
export const participantRowId = (id: string): number | null => {
	if (!/^[1-9][0-9]*$/.test(id)) return null
	const n = Number(id)
	return Number.isSafeInteger(n) && n <= PG_INTEGER_MAX ? n : null
}

/**
 * Resolve every reference in `refs` for one session and one run owner.
 *
 * The session's facts are read once — the owner, the guest list, the run
 * owner's admin flag, and the cast and persona rows the references name —
 * and every reference is answered from that one read, so the map is
 * internally consistent even if a member joins between two of its rows.
 */
export async function resolvePortrayals(
	db: Db,
	{ sessionId, runOwnerUserId, refs, speaker }: ResolvePortrayalsRequest
): Promise<Portrayals> {
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { userId: true }
	})
	const guests = session
		? await db.query.sessionGuests.findMany({
				where: eq(schema.sessionGuests.sessionId, sessionId),
				columns: { userId: true }
			})
		: []
	const members = new Set<number>(guests.map((g) => g.userId))
	if (session) members.add(session.userId)
	const runOwner = await db.query.users.findFirst({
		where: eq(schema.users.id, runOwnerUserId),
		columns: { isAdmin: true }
	})

	// The character references, answered from two reads rather than one per
	// reference. Only well-formed integer ids reach the database.
	const parsed = refs.map((ref) => parseParticipantRef(ref))
	const characterIds = [
		...new Set(
			parsed
				.map((p) => (p.kind === "character" ? participantRowId(p.id) : null))
				.filter((id): id is number => id !== null)
		)
	]
	const [presences, castRows] = characterIds.length
		? await Promise.all([
				db
					.select({
						characterId: schema.sessionPersonas.personaId,
						ownerId: schema.characters.userId
					})
					.from(schema.sessionPersonas)
					.innerJoin(
						schema.characters,
						eq(schema.characters.id, schema.sessionPersonas.personaId)
					)
					.where(
						and(
							eq(schema.sessionPersonas.sessionId, sessionId),
							inArray(schema.sessionPersonas.personaId, characterIds),
							isNull(schema.sessionPersonas.removedAt)
						)
					),
				db
					.select({ characterId: schema.sessionCharacters.characterId })
					.from(schema.sessionCharacters)
					.where(
						and(
							eq(schema.sessionCharacters.sessionId, sessionId),
							inArray(schema.sessionCharacters.characterId, characterIds),
							isNull(schema.sessionCharacters.removedAt)
						)
					)
			])
		: [[], []]
	// A member's own presence: the persona row's character is owned by a
	// member. A persona row whose owner has since left the session is not a
	// person's portrayal here; it falls through to the cast check like any
	// other character, and is the AI's only if a cast row (or the speaker
	// seat) says so.
	const presenceOwner = new Map<number, number>()
	for (const p of presences)
		if (p.characterId !== null && members.has(p.ownerId))
			presenceOwner.set(p.characterId, p.ownerId)
	const cast = new Set<number>(
		castRows.map((c) => c.characterId).filter((id): id is number => id !== null)
	)
	// The envoy references, answered from one read of what the session's
	// genre and its installed actions declare (U5g). Read only when asked
	// about — a run naming no envoy costs no query here.
	const declaredEnvoySlugs = parsed.some((p) => p.kind === "envoy")
		? new Set((await sessionDeclaredEnvoys(db, sessionId)).map((d) => d.slug))
		: new Set<string>()

	const runOwnerIsMember = members.has(runOwnerUserId)
	// The speaker under its canonical spelling, so `character:12` given as
	// the speaker matches ` character:12 ` asked about.
	const speakerKey = speaker
		? formatParticipantRef(parseParticipantRef(speaker))
		: null
	const portrayals: Portrayals = {}
	for (const p of parsed) {
		// Keyed by the canonical spelling: `parse(format(x))` is `x`, so a
		// reference asked twice is answered once.
		const key = formatParticipantRef(p)
		if (key in portrayals) continue
		let portrayal: Portrayal
		switch (p.kind) {
			case "user": {
				const id = participantRowId(p.id)
				portrayal = id !== null && members.has(id) ? PERSON(id) : NONE
				break
			}
			case "owner":
				portrayal = session ? PERSON(session.userId) : NONE
				break
			case "admin":
				portrayal = runOwner?.isAdmin ? PERSON(runOwnerUserId) : NONE
				break
			case "participant":
				portrayal = runOwnerIsMember ? PERSON(runOwnerUserId) : NONE
				break
			case "run-owner":
				portrayal = PERSON(runOwnerUserId)
				break
			case "character": {
				const id = participantRowId(p.id)
				const owner = id !== null ? presenceOwner.get(id) : undefined
				portrayal =
					owner !== undefined
						? PERSON(owner)
						: id !== null && (cast.has(id) || key === speakerKey)
							? AI
							: NONE
				break
			}
			case "envoy":
				// The AI's, when the slug is one this session's genre or an
				// installed action declares (U5g); a slug nothing declares is
				// a reference nobody holds. Never a person's: an envoy is the
				// genre's speaker, not somebody's presence.
				portrayal = declaredEnvoySlugs.has(p.slug) ? AI : NONE
				break
			case "item":
				// Not resolvable without a message — decided at the venue by
				// the per-message rule (`canActOnMessage`).
				portrayal = NONE
				break
		}
		portrayals[key] = portrayal
	}
	return portrayals
}

/**
 * The character a member speaks THROUGH in this session — their own
 * presence: the first live `session_personas` row, by seat, whose character
 * they own. Null when they have none here. A user who has seated two of
 * their characters speaks through the first by seat position — the row the
 * cast lists first — and never through both. The same rows `resolvePortrayals`
 * reads to answer `person`, asked the other way round: not "who portrays
 * this participant" but "whom does this person speak as" — what a press on
 * a question put to nobody in particular needs, so the answer lands as the
 * presser's persona's line rather than nobody's (2026-09-17).
 */
export async function ownPresence(
	db: Db,
	sessionId: number,
	userId: number
): Promise<number | null> {
	const [row] = await db
		.select({ characterId: schema.sessionPersonas.personaId })
		.from(schema.sessionPersonas)
		.innerJoin(
			schema.characters,
			eq(schema.characters.id, schema.sessionPersonas.personaId)
		)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				isNull(schema.sessionPersonas.removedAt),
				eq(schema.characters.userId, userId)
			)
		)
		.orderBy(
			asc(schema.sessionPersonas.position),
			asc(schema.sessionPersonas.personaId)
		)
		.limit(1)
	return row?.characterId ?? null
}

/**
 * The references a session turn asks about (R-21 (4)): the inlet's speaker,
 * every cast character, every **seated envoy** (a live `session_characters`
 * row with `envoy_slug`, U5g), every member's presence (a live
 * `session_personas` row — a guest's persona is in the session without being
 * in the cast, and "Elara · you" on the inspector's line is unreachable
 * without it), the owner and the run owner. Read once by `runSpec` and
 * handed to `resolvePortrayals`; nothing else composes this list.
 */
export async function turnRefs(
	db: Db,
	sessionId: number,
	speaker: ParticipantRef | null | undefined
): Promise<ParticipantRef[]> {
	const [cast, presences, envoys] = await Promise.all([
		db
			.select({ characterId: schema.sessionCharacters.characterId })
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					isNull(schema.sessionCharacters.removedAt),
					isNotNull(schema.sessionCharacters.characterId)
				)
			),
		db
			.select({ characterId: schema.sessionPersonas.personaId })
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					isNull(schema.sessionPersonas.removedAt)
				)
			),
		db
			.select({ envoySlug: schema.sessionCharacters.envoySlug })
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					isNull(schema.sessionCharacters.removedAt),
					isNotNull(schema.sessionCharacters.envoySlug)
				)
			)
	])
	const refs = new Set<ParticipantRef>(["owner", "run-owner"])
	if (speaker) refs.add(speaker)
	for (const c of [...cast, ...presences])
		if (c.characterId !== null) refs.add(`character:${c.characterId}`)
	for (const e of envoys) if (e.envoySlug) refs.add(`envoy:${e.envoySlug}`)
	return [...refs]
}
