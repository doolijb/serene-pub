/**
 * Who may act on a message — the **item** audience rule (R-15), in one place.
 *
 * Two callers, and they must agree: the venue's handler asks before it starts
 * a built-in's run (`sockets/sessions.ts`), and the host's commit asks again,
 * against the run's actor, before it writes
 * (`runtime/host.ts`, U5b review C1). The second ask exists because the
 * payload between the two is not the handler's: a review gate may have
 * folded an edit into it, and a document that is not the built-in's own may
 * have placed the outlet. A rule evaluated once on the id the handler saw
 * says nothing about the id the write is about to use.
 *
 * ## The rule
 *
 *  - **Persona messages**: only the owner of that persona — NOT even the
 *    session owner, since a persona is another participant's own
 *    self-representation in the session, not something the owner controls.
 *  - **Character messages**: the session owner (broad control over the shared
 *    "AI" character outputs) OR whoever owns that specific character, so a
 *    guest who brought their own character into the session can edit, swipe
 *    or regenerate its messages too.
 *  - **Narration**: nobody guest-owns "the narrator" — the session owner alone.
 *  - **An envoy's line** (`metadata.speaker = envoy:<slug>`, no character
 *    row behind it): the session owner's, as narration is — an envoy is the
 *    genre's speaker, never a person's (ruled at the U5g review, C1). One
 *    widening, for the **rerun** verbs only (swipe, retry, extend — owner
 *    ruling 2026-10-15): an envoy's line in a **channel lane this person is
 *    the member of** is theirs to rerun too (the Dungeon Crawler's private
 *    Planner lane, `parley:n`). Core stores no lane membership; it is read
 *    off the genre's annex, by shape (`laneMemberOf`). Edit, hide and delete
 *    stay the owner's; `main` is never anyone's lane.
 *  - **A user line with no persona** (a genre whose shape has no persona
 *    system, or a person speaking as themselves): its author's, by
 *    `user_id` — nobody else's, not even the session owner's, on the same
 *    terms as a persona's line (the same ruling).
 *
 * The client's `canControlMessage` (`routes/sessions/[id]/+page.svelte`)
 * mirrors every branch of this; the server refuses regardless.
 *
 * Reads through the `db` it is handed, never the global one, for the reason
 * every host read does: a run against another database must not judge a
 * row by the application's. Absent from the handler's older spelling, which
 * read the global `db` implicitly and was the one copy of this rule until it
 * moved here.
 */

import { and, eq } from "drizzle-orm"
import { DEFAULT_CHANNEL, envoySlugOfRef, parseChannel } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

async function ownsCharacter(
	db: Db,
	characterId: number,
	userId: number
): Promise<boolean> {
	const [row] = await db
		.select({ id: schema.characters.id })
		.from(schema.characters)
		.where(
			and(
				eq(schema.characters.id, characterId),
				eq(schema.characters.userId, userId)
			)
		)
		.limit(1)
	return !!row
}

/** Owner, guest, or neither — for one session and one person. */
export async function sessionAccessFor(
	db: Db,
	sessionId: number,
	userId: number
): Promise<{ isOwner: boolean; isGuest: boolean; hasAccess: boolean }> {
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return { isOwner: false, isGuest: false, hasAccess: false }
	const isOwner = session.userId === userId
	const [guest] = await db
		.select({ userId: schema.sessionGuests.userId })
		.from(schema.sessionGuests)
		.where(
			and(
				eq(schema.sessionGuests.sessionId, sessionId),
				eq(schema.sessionGuests.userId, userId)
			)
		)
		.limit(1)
	const isGuest = !!guest
	return { isOwner, isGuest, hasAccess: isOwner || isGuest }
}

/**
 * What is being done to the row: `change` (edit, hide, delete — and every
 * caller that names no verb) or `rerun` (swipe, retry, extend: a new take
 * on the row, its text not rewritten by hand). They differ on one branch
 * only — an envoy's line in the asker's own channel lane.
 */
export type MessageVerb = "change" | "rerun"

/**
 * 🚧 Is `channel` a lane whose member is this person — by the genre's own
 * map, since core stores no lane membership? The map is found by shape, not
 * by name: an annex field declared for this session's genre, seen by every
 * `participant`, whose declared shape is an object with one `user:<id>`
 * string member (the Dungeon Crawler's `dungeon-crawler-lanes`, `user:<id>`
 * → `parley:<n>`). The stored value for `user:<userId>` must name this very
 * lane, canonically (`parley` ≡ `parley:1`). `main` is never a member's lane.
 */
export async function laneMemberOf(
	db: Db,
	sessionId: number,
	channel: string | null | undefined,
	userId: number
): Promise<boolean> {
	const ref = parseChannel(channel)
	if (ref.slug === DEFAULT_CHANNEL) return false
	const [session] = await db
		.select({ annex: schema.sessions.annex, genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session?.genreId) return false
	const annex = (session.annex ?? {}) as Record<string, unknown>
	const { declaredAnnexFields } = await import("$lib/server/sessions/annexFields")
	for (const { owner, decl } of await declaredAnnexFields(db, session.genreId)) {
		if (!decl.see.includes("participant")) continue
		const shape = decl.shape as {
			type?: unknown
			fields?: Record<string, { type?: unknown } | undefined>
		}
		if (shape?.type !== "object" || shape.fields?.["user:<id>"]?.type !== "string")
			continue
		const doc = annex[owner]
		const map =
			doc && typeof doc === "object"
				? (doc as Record<string, unknown>)[decl.key]
				: undefined
		if (!map || typeof map !== "object" || Array.isArray(map)) continue
		const mine = (map as Record<string, unknown>)[`user:${userId}`]
		if (typeof mine !== "string" || !mine.trim()) continue
		const lane = parseChannel(mine)
		if (lane.warning || lane.slug === DEFAULT_CHANNEL) continue
		if (lane.slug === ref.slug && lane.lane === ref.lane) return true
	}
	return false
}

/**
 * May this person act on this message — `change` it (edit, hide, delete;
 * the default) or `rerun` it (swipe, retry, extend)? False for a message
 * that does not exist.
 */
export async function canActOnMessage(
	db: Db,
	messageId: number,
	userId: number,
	verb: MessageVerb = "change"
): Promise<boolean> {
	const [message] = await db
		.select({
			sessionId: schema.sessionMessages.sessionId,
			channel: schema.sessionMessages.channel,
			characterId: schema.sessionMessages.characterId,
			personaId: schema.sessionMessages.personaId,
			isNarratorResponse: schema.sessionMessages.isNarratorResponse,
			role: schema.sessionMessages.role,
			userId: schema.sessionMessages.userId,
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(eq(schema.sessionMessages.id, messageId))
		.limit(1)
	if (!message) return false

	const access = await sessionAccessFor(db, message.sessionId, userId)
	if (!access.hasAccess) return false

	if (message.personaId)
		return await ownsCharacter(db, message.personaId, userId)

	if (message.characterId) {
		if (access.isOwner) return true
		return await ownsCharacter(db, message.characterId, userId)
	}

	// An envoy's line: its only identity is the reference on the row, and
	// the genre's speaker is the session owner's to act on, as narration is
	// — save a rerun in the asker's own channel lane (ruled 2026-10-15).
	if (envoySlugOfRef((message.metadata as { speaker?: unknown } | null)?.speaker)) {
		if (access.isOwner) return true
		return (
			verb === "rerun" &&
			(await laneMemberOf(db, message.sessionId, message.channel, userId))
		)
	}

	if (message.isNarratorResponse) return access.isOwner

	// A person's own line with no persona voicing it: the author's.
	if (message.role === "user" && message.userId != null)
		return message.userId === userId

	// An orphaned row — the character or persona that voiced it deleted
	// globally (`character_id` / `persona_id` nulled by `onDelete: set null`),
	// or a line whose author is gone (`user_id` nulled the same way). It has
	// no owner left to act on it, so it is the session owner's, as narration
	// is: the session is theirs, and a row nobody may ever delete is a row
	// that renders as "Unknown" forever. A guest's own persona line stays the
	// guest's for as long as the persona exists — this branch is only
	// reached once nothing on the row names anyone.
	return access.isOwner
}

/**
 * The sentence a refused write answers with — the same one at the handler
 * and at the commit, so a person is told the same thing whichever asked.
 */
export const MESSAGE_ACTION_REFUSAL =
	"You don't have permission to change this message — only the session's owner, " +
	"whoever owns the character or persona that voiced it, or the person who wrote it, may."
