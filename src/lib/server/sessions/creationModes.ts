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
import { isTimelessAnnexKey } from "$lib/server/sessions/annexChanges"
import { annexImprintKey, fileSessionImprint } from "$lib/server/sessions/sessionImprints"
import { annexScopeOf, declaredAnnexFields, sessionGenreOf } from "$lib/server/sessions/annexFields"
import { ownerVersionOf } from "$lib/server/plugins/annexMigrate"
import { loadSeatMap, memberFormOf, storedSeatRef } from "$lib/server/state/seatRefs"
import { memberFormOn } from "$lib/server/state/memberForm"
import { castOwnerOf, type StateOwner } from "$lib/server/state/owners"
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
	// 🚧 A seat is the same character when it holds the same cast member; the
	// card match below is the fallback (the two sessions' own books hold
	// different members). Two seats on one member: the first in link order.
	const newByMember = new Map<number, number>()
	for (const m of newLinks.cast)
		if (m.seatMemberId != null && !newByMember.has(m.seatMemberId))
			newByMember.set(m.seatMemberId, m.characterId)
	const newSeatMembers = new Set<number>([
		...newByMember.keys(),
		...(newLinks.seatedMembers ?? []).map((m) => m.seatMemberId)
	])
	const newSeatId = await cardlessPlayerSeatOf(db, sessionId, userId)
	const known = { links: fromLinks, vocabulary }
	const changes: StateChange[] = []
	let newSeatMap: Awaited<ReturnType<typeof loadSeatMap>> | undefined
	const carry = async (
		from: StateOwner,
		to: StateOwner,
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
		for (const member of fromLinks.cast) {
			const target =
				(member.seatMemberId != null
					? newByMember.get(member.seatMemberId)
					: undefined) ??
				(newCast.has(member.characterId) ? member.characterId : undefined)
			if (target === undefined) continue
			if (!memberFormOn()) {
				await carry(
					{ kind: "session_cast", id: member.characterId },
					{ kind: "session_cast", id: target },
					decl.id
				)
				continue
			}
			// 🚧 ⏳ Flip on (`memberForm.ts`): the old seat's own owner → the new session's seat for the same card (skipped when none answers).
			newSeatMap ??= await loadSeatMap(db, sessionId)
			const to = memberFormOf(newSeatMap, { kind: "session_cast", id: target })
			if (to) await carry(castOwnerOf(member), to as StateOwner, decl.id)
		}
		// 🚧 ⏳ Flip on: a card-less character seat carries by its member, to the
		// new session's seat on the same member (card or card-less); none, none.
		if (memberFormOn())
			for (const seat of fromLinks.seatedMembers ?? []) {
				if (!newSeatMembers.has(seat.seatMemberId)) continue
				await carry(
					{ kind: "seated_member", id: seat.seatMemberId },
					{ kind: "seated_member", id: seat.seatMemberId },
					decl.id
				)
			}
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
		// 🚧 seat-cast S3: each `seated-member:<memberId>` in a declared audience goes
		// through the door into the card form it is stored in; a member no seat of
		// the new session holds is dropped (never stored raw).
		const seated: string[] = []
		for (const r of f.decl.see) {
			const stored = await storedSeatRef(db, sessionId, r)
			if (stored !== null) seated.push(stored)
		}
		const see = [...new Set(seated.map((r) => canonicalParticipantRef(r)))].sort()
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
			// ST3: one imprint row per key whose value or audience moved.
			for (const k of new Set([
				...Object.keys(previous),
				...Object.keys(next),
				...Object.keys(heldAudiences),
				...Object.keys(nextAudiences)
			])) {
				if (isTimelessAnnexKey(owner, k)) continue
				await fileSessionImprint(
					tx as unknown as Db,
					{ sessionId, messageId: anchor, runId: null },
					{ kind: "annex", key: annexImprintKey(owner, k) },
					previous[k],
					next[k],
					{
						ownerVersion: versions.get(owner) ?? null,
						audienceBefore: heldAudiences[k] ?? null,
						audienceAfter: nextAudiences[k] ?? null
					}
				)
			}
			held[owner] = next
			heldAll[owner] = nextAudiences
		}
	})
}
