/**
 * 🚧 **Creation modes** (M0, F5): how a new session starts — `new`,
 * `new-world`, `branch` or `next-chapter`. The create handler
 * (`sockets/sessions.ts › sessionsCreateHandler`) reads the mode; the parts that
 * are not the handler's own live here:
 *
 * - `creationModeRefusal` — the refusals a mode owes before anything is written;
 * - `branchForCreate` — `branch`, through exactly what `sessions:branch` runs;
 * - `seedNextChapter` — `next-chapter`'s ONE anchored write: only what the
 *   declarations mark `nextChapter: true`. History is never copied.
 *
 * A genre may *propose* a mode (`SessionShape.creationMode`) and the start form
 * shows it; the server never refuses a mode because the genre proposed another.
 */
import { and, eq, isNull, sql } from "drizzle-orm"
import { canonicalParticipantRef, getAttributeSlot, SESSION_CREATION_MODES } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { canViewLorebook } from "$lib/server/utils/ownedBook"
import { verbEnablementRefusal } from "$lib/server/messages/verbs"
import { cardlessPlayerSeatOf, writeSeatName } from "$lib/server/sessions/seatName"
import { lockSessionAnnex } from "$lib/server/sessions/coreAnnex"
import { bumpedAnnexVersionsSql } from "$lib/server/sessions/annexVersions"
import { recordAnnexDelta } from "$lib/server/sessions/annexChanges"
import { annexScopeOf, declaredAnnexFields, sessionGenreOf } from "$lib/server/sessions/annexFields"
import { ownerVersionOf } from "$lib/server/plugins/annexMigrate"
import { applyChangeSet, newestMessageId, type StateChange } from "$lib/server/state/write"
import { sessionLinks, valueOf, vocabularyFor } from "$lib/server/state/resolve"

/** Whether `userId` owns session `sessionId`. */
async function ownsSession(db: Db, sessionId: number, userId: number): Promise<boolean> {
	const [row] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row?.userId === userId
}

/**
 * The refusal a creation mode owes before anything is written, in a sentence
 * the person can act on; null when the mode may go ahead. `new` and
 * `new-world` owe none here (`new-world`'s "Choose the world to copy." needs
 * the draft's book and kit, which the create handler holds).
 */
export async function creationModeRefusal(
	db: Db,
	opts: { mode: string | undefined; from: number | null | undefined; userId: number }
): Promise<string | null> {
	const { from, userId } = opts
	const mode = opts.mode ?? "new"
	if (!(SESSION_CREATION_MODES as readonly string[]).includes(mode))
		return "Choose how the session starts: 'new', 'new-world', 'branch' or 'next-chapter'."
	if (mode === "branch") {
		if (typeof from !== "number") return "Choose the session to branch."
		if (!(await ownsSession(db, from, userId))) return "Only the session's owner can branch it."
	}
	if (mode === "next-chapter") {
		if (typeof from !== "number") return "Choose the session this one follows."
		if (!(await ownsSession(db, from, userId)))
			return "Only the session's owner can start its next chapter."
		const [row] = await db
			.select({ lorebookId: schema.sessions.lorebookId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, from))
			.limit(1)
		// No book attached is no refusal: the session's world is its own
		// book, which the create path shares as a lorebook to follow.
		if (row?.lorebookId != null && !(await canViewLorebook(row.lorebookId, userId, { db })))
			return "You can't read this session's lorebook, so a next chapter can't continue it."
	}
	return null
}

/**
 * `branch`: fork `from` at its newest live message through what
 * `sessions:branch` runs — the verb's enabled-when, then core's `branch`
 * built-in. The ownership check is `creationModeRefusal`'s.
 */
export async function branchForCreate(
	db: Db,
	opts: { from: number; userId: number; io: unknown }
): Promise<{ sessionId: number } | { error: string }> {
	const { from, userId, io } = opts
	const messageId = await newestMessageId(db, from)
	if (messageId === null) return { error: "Failed to branch session" }
	const refusal = await verbEnablementRefusal(db, from, "branch", { messageId, userId })
	if (refusal) return { error: refusal }
	const { runBuiltIn, writtenId } = await import("$lib/server/pipelines/runtime/builtins")
	const branched = await runBuiltIn(db, {
		kind: "branch",
		sessionId: from,
		actor: userId,
		payload: { fromMessage: messageId, title: null },
		io: io as never
	})
	const sessionId = writtenId(branched.write)
	if (!branched.ok || sessionId === null) return { error: branched.error ?? "Failed to branch session" }
	return { sessionId }
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * `next-chapter`: seed the new session from the one it follows — ONE anchored
 * write, anchored to `anchorMessageId` (the chapter's first message). Only state declared
 * `nextChapter: true` follows the player:
 *
 * - the owner's player seat takes the old seat's name and portrait, when the
 *   draft seated none of theirs;
 * - attribute values of owners `session`, `session_cast` (a character seated in
 *   both) and `player_seat` (old seat → new seat), as the old session reads them
 *   now, in one `applyChangeSet` (a system write: no review gate);
 * - session annex keys the new session's genre declares `nextChapter: true`,
 *   copied under the annex lock with the declaration's `see` as audience.
 *
 * Nothing else: no messages, scenes, history entries or table rows.
 */
export async function seedNextChapter(
	db: Db,
	opts: { fromSessionId: number; sessionId: number; userId: number; anchorMessageId: number }
): Promise<void> {
	const { fromSessionId, sessionId, userId, anchorMessageId: anchor } = opts

	// 1. The owner's seat: name and portrait, when the draft seated none of theirs.
	const seatsOf = (id: number) =>
		db
			.select({
				id: schema.sessionPersonas.id,
				personaId: schema.sessionPersonas.personaId,
				userId: schema.sessionPersonas.userId,
				cardUserId: schema.characters.userId
			})
			.from(schema.sessionPersonas)
			.leftJoin(schema.characters, eq(schema.characters.id, schema.sessionPersonas.personaId))
			.where(and(eq(schema.sessionPersonas.sessionId, id), isNull(schema.sessionPersonas.removedAt)))
	const newSeated = (await seatsOf(sessionId)).some((s) => (s.userId ?? s.cardUserId) === userId)
	const oldSeatId = await cardlessPlayerSeatOf(db, fromSessionId, userId)
	if (!newSeated && oldSeatId !== null) {
		const [old] = await db
			.select({
				seatName: schema.sessionPersonas.seatName,
				portraitMediaId: schema.sessionPersonas.portraitMediaId
			})
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.id, oldSeatId))
			.limit(1)
		if (old?.seatName?.trim()) {
			const seatId = await writeSeatName(db, {
				sessionId,
				userId,
				isOwner: true,
				name: old.seatName
			})
			if (seatId !== null && old.portraitMediaId != null)
				await db
					.update(schema.sessionPersonas)
					.set({ portraitMediaId: old.portraitMediaId })
					.where(eq(schema.sessionPersonas.id, seatId))
		}
	}

	// 2. Attribute values, as the old session reads them now.
	const fromLinks = await sessionLinks(db, fromSessionId)
	const vocabulary = await vocabularyFor(db, fromSessionId, fromLinks)
	const carried = vocabulary.entries
		.map((e) => getAttributeSlot(e.decl.id))
		.filter((d): d is NonNullable<typeof d> => !!d && d.nextChapter === true && d.type !== "derived")
	const newLinks = await sessionLinks(db, sessionId)
	const newCast = new Set(newLinks.cast.map((m) => m.characterId))
	const newSeatId = await cardlessPlayerSeatOf(db, sessionId, userId)
	const known = { links: fromLinks, vocabulary }
	const changes: StateChange[] = []
	const carry = async (
		from: { kind: "session" | "session_cast" | "player_seat"; id: number },
		to: { kind: "session" | "session_cast" | "player_seat"; id: number },
		slotId: string
	) => {
		const value = await valueOf(db, { sessionId: fromSessionId, owner: from, slotId }, known)
		if (value !== undefined) changes.push({ owner: to, slotId, value })
	}
	for (const decl of carried) {
		if (decl.appliesTo.includes("world"))
			await carry(
				{ kind: "session", id: fromSessionId },
				{ kind: "session", id: sessionId },
				decl.id
			)
		if (!decl.appliesTo.includes("cast")) continue
		for (const member of fromLinks.cast)
			if (newCast.has(member.characterId))
				await carry(
					{ kind: "session_cast", id: member.characterId },
					{ kind: "session_cast", id: member.characterId },
					decl.id
				)
		if (oldSeatId !== null && newSeatId !== null)
			await carry(
				{ kind: "player_seat", id: oldSeatId },
				{ kind: "player_seat", id: newSeatId },
				decl.id
			)
	}
	if (changes.length) {
		const outcome = await applyChangeSet(
			db,
			{ sessionId, updatedBy: `session:${fromSessionId}`, userId, messageId: anchor },
			changes,
			{ mode: "apply" }
		)
		for (const r of outcome.refused)
			console.warn(`[sessions] next chapter ${sessionId}: ${r.change.slotId} not carried: ${r.reason}`)
	}

	// 3. Session annex keys the new session's genre declares `nextChapter: true`.
	const genreId = await sessionGenreOf(db, sessionId)
	const fields = (await declaredAnnexFields(db, genreId)).filter(
		(f) => f.decl.nextChapter === true && annexScopeOf(f.decl) === "session"
	)
	if (!fields.length) return
	const [source] = await db
		.select({ annex: schema.sessions.annex })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, fromSessionId))
		.limit(1)
	const fromAnnex = (source?.annex ?? {}) as Record<string, unknown>
	const wanted = new Map<string, Record<string, unknown>>()
	const seeAs = new Map<string, Record<string, string[]>>()
	for (const f of fields) {
		const doc = fromAnnex[f.owner]
		if (!doc || typeof doc !== "object" || Array.isArray(doc)) continue
		const value = (doc as Record<string, unknown>)[f.decl.key]
		if (value === undefined) continue
		const values = wanted.get(f.owner) ?? {}
		values[f.decl.key] = value
		wanted.set(f.owner, values)
		const audiences = seeAs.get(f.owner) ?? {}
		const see = [...new Set(f.decl.see.map((r) => canonicalParticipantRef(r)))].sort()
		if (see.length) audiences[f.decl.key] = see
		seeAs.set(f.owner, audiences)
	}
	if (!wanted.size) return
	const versions = new Map<string, string | null>()
	for (const owner of wanted.keys()) versions.set(owner, await ownerVersionOf(db, owner))
	await db.transaction(async (tx) => {
		await lockSessionAnnex(tx as unknown as Db, sessionId)
		const [current] = await tx
			.select({ annex: schema.sessions.annex, audiences: schema.sessions.annexAudiences })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!current) return
		const held = (current.annex ?? {}) as Record<string, unknown>
		const heldAll = (current.audiences ?? {}) as Record<string, Record<string, string[]>>
		for (const [owner, values] of wanted) {
			const previous =
				held[owner] && typeof held[owner] === "object" && !Array.isArray(held[owner])
					? (held[owner] as Record<string, unknown>)
					: {}
			const heldAudiences = heldAll[owner] ?? {}
			const next = { ...previous, ...values }
			const nextAudiences: Record<string, string[]> = { ...heldAudiences }
			for (const key of Object.keys(values)) {
				const see = seeAs.get(owner)?.[key]
				if (see?.length) nextAudiences[key] = see
				else delete nextAudiences[key]
			}
			if (sameJson(previous, next) && sameJson(heldAudiences, nextAudiences) && Object.hasOwn(held, owner))
				continue
			await tx.execute(sql`
				update ${schema.sessions}
				set ${sql.identifier("annex")} = jsonb_set(
					coalesce(${schema.sessions.annex}, '{}'::jsonb),
					ARRAY[${owner}]::text[],
					${JSON.stringify(next)}::jsonb,
					true
				),
				${sql.identifier("annex_audiences")} = jsonb_set(
					coalesce(${schema.sessions.annexAudiences}, '{}'::jsonb),
					ARRAY[${owner}]::text[],
					${JSON.stringify(nextAudiences)}::jsonb,
					true
				)
				where ${schema.sessions.id} = ${sessionId}
			`)
			// 🚧 The owner's annex document version moves with its document (M2a a8).
			await tx.execute(sql`
				update ${schema.sessions}
				set ${sql.identifier("annex_versions")} = ${bumpedAnnexVersionsSql(schema.sessions.annexVersions, owner)}
				where ${schema.sessions.id} = ${sessionId}
			`)
			await recordAnnexDelta(tx as unknown as Db, {
				sessionId,
				messageId: anchor,
				owner,
				ownerVersion: versions.get(owner) ?? null,
				before: {
					document: Object.hasOwn(held, owner) ? previous : null,
					audiences: Object.hasOwn(heldAll, owner) ? heldAudiences : null
				},
				after: { document: next, audiences: nextAudiences },
				runId: null
			})
			held[owner] = next
			heldAll[owner] = nextAudiences
		}
	})
}
