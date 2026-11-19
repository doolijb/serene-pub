/** Saving a session: `sessions:update`, and the edit form's draft. */

import { sessionEvents } from "@serene-pub/sdk"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { writeGenreFields, writeRigour } from "$lib/server/sessions/settingsWrite"
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import { markCharacterAsPersona } from "$lib/server/utils/markCharacterAsPersona"
import {
	announceSeatChanges,
	handOverSeat,
	moveSeatKind,
	sameMemberRefusal,
	seatCast,
	seatPlayer,
	settleSeats,
	syncMintedSeatMembers,
	unseat,
	type SeatChange
} from "$lib/server/sessions/seats"
import {
	copySharedCard,
	sharedCardRefusal
} from "$lib/server/cast/sharedCardCopy"
import { sessionGenreOf } from "$lib/server/sessions/annexFields"
import {
	guestSeatSwitchesOf,
	guestTakeRefusal,
	resolvePlayerSeatsFor,
	resolveSeatHandovers,
	resolveSeatMoves,
	writeSeatHandovers,
	seatKindAddRefusal,
	writeGuestSeatSwitches
} from "$lib/server/sessions/guestSeats"
import { GUEST_SEAT_SENTENCES } from "$lib/shared/sessions/guestSeats"
import {
	heldMemberIds,
	PLAYER_SEATS_FOR_REFUSALS
} from "$lib/server/sessions/guestSeats"
import { cardsNow } from "$lib/server/cast/seatedCast"
import { inPlay } from "$lib/shared/sessions/inPlay"
import { SESSION_UPDATE_REFUSALS } from "$lib/server/sessions/updateRefusals"
import { appletCallerOf } from "./appletCause"
import type { Handler } from "$lib/shared/events"
import { refusable } from "./refusable"
import { broadcastToSessionUsers } from "./utils/broadcastHelpers"
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import {
	resolveCharacterName,
	resolvePersonaName
} from "$lib/shared/utils/resolveCharacterName"
import {
	checkCharactersOwnership,
	checkPersonasOwnership,
	processSessionTags,
	putCardsNow,
	relistSessions,
	relistWithRow,
	getSessionFromDB,
	broadcastSessionToParticipants,
	runLorebookBindingCheck,
	sessionLinePatch,
	clockFromColumns
} from "./sessions.shared"

/** A seat's card after `putCardsNow` on a read trimmed to ids: its name as the card now has it. */
type SeatCardNames = { id: number; name?: string; nickname?: string | null }

/**
 * 🚧 The guest seat switches and the genre's opt-in, checked before ANY seat
 * is written, so a refusal leaves everything as it was. The owner is never
 * frozen and not held to the card-less rule; the genre's opt-in holds for
 * both, on adds only.
 */
async function seatPreflight(
	params: Sockets.Sessions.Update.Params,
	userId: number,
	isOwner: boolean
): Promise<string | null> {
	const sessionId = params.session.id!
	const none = params.characterIds === undefined &&
		params.personaIds === undefined &&
		params.castMemberIds === undefined &&
		!params.playerSeatChanges?.length &&
		!params.seatHandovers?.length &&
		!params.playerSeatsFor?.length &&
		!params.sharedCardSeats?.length &&
		!params.seatName?.trim()
	if (none) return null
	const d = db as unknown as Db
	const switches = isOwner ? null : await guestSeatSwitchesOf(d, sessionId)

	let characterAdds = 0
	let personaAdds = 0

	if (params.characterIds !== undefined) {
		const seats = await d
			.select({ characterId: schema.sessionCharacters.characterId, cardUserId: schema.characters.userId })
			.from(schema.sessionCharacters)
			.leftJoin(schema.characters, eq(schema.characters.id, schema.sessionCharacters.characterId))
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					isNull(schema.sessionCharacters.removedAt),
					isNotNull(schema.sessionCharacters.characterId)
				)
			)
		const existing = new Set(seats.map((s) => s.characterId))
		const wanted = new Set(params.characterIds)
		const adds = params.characterIds.filter((id) => !existing.has(id))
		characterAdds += adds.length
		if (switches && !switches.bringOwn) {
			const ownRemoved = seats.some((s) => s.cardUserId === userId && !wanted.has(s.characterId!))
			if (adds.length || ownRemoved) return GUEST_SEAT_SENTENCES.bringOwnOff
		}
	}

	if (params.personaIds !== undefined) {
		const seats = await d
			.select({ personaId: schema.sessionPersonas.personaId, cardUserId: schema.characters.userId })
			.from(schema.sessionPersonas)
			.leftJoin(schema.characters, eq(schema.characters.id, schema.sessionPersonas.personaId))
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					isNull(schema.sessionPersonas.removedAt),
					isNotNull(schema.sessionPersonas.personaId)
				)
			)
		const existing = new Set(seats.map((s) => s.personaId))
		const wanted = new Set(params.personaIds)
		const adds = params.personaIds.filter((id) => !existing.has(id))
		personaAdds += adds.length
		if (switches && !switches.bringOwn) {
			const ownRemoved = seats.some((s) => s.cardUserId === userId && !wanted.has(s.personaId!))
			if (adds.length || ownRemoved) return GUEST_SEAT_SENTENCES.bringOwnOff
		}
	}

	if (switches && !switches.bringOwn && params.playerSeatChanges?.some((c) => c.remove))
		return GUEST_SEAT_SENTENCES.bringOwnOff

	// A name that would open a seat (the caller holds none in play) is bringing
	// their own. `writeSeatName` refuses it too, for a run; said here as well so
	// a save that also changes other seats writes none of them.
	if (switches && !switches.bringOwn && params.seatName?.trim() && params.playerSeatId == null) {
		const seats = await d
			.select({
				userId: schema.sessionPersonas.userId,
				cardUserId: schema.characters.userId,
				removedAt: schema.sessionPersonas.removedAt,
				isActive: schema.sessionPersonas.isActive
			})
			.from(schema.sessionPersonas)
			.leftJoin(schema.characters, eq(schema.characters.id, schema.sessionPersonas.personaId))
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					isNull(schema.sessionPersonas.removedAt)
				)
			)
		if (!seats.some((s) => inPlay(s) && (s.userId ?? s.cardUserId) === userId))
			return GUEST_SEAT_SENTENCES.bringOwnOff
	}

	if (params.castMemberIds !== undefined) {
		const seats = await d
			.select({
				castMemberId: schema.sessionCharacters.castMemberId,
				seatedBy: schema.sessionCharacters.seatedByUserId
			})
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					isNull(schema.sessionCharacters.removedAt),
					isNull(schema.sessionCharacters.envoySlug),
					isNull(schema.sessionCharacters.characterId),
					isNotNull(schema.sessionCharacters.castMemberId)
				)
			)
		const held = new Set(seats.map((s) => s.castMemberId))
		const wanted = [...new Set(params.castMemberIds)]
		const adds = wanted.filter((id) => !held.has(id))
		if (switches) {
			const ownRemoved = seats.some((s) => s.seatedBy === userId && !wanted.includes(s.castMemberId!))
			if (!switches.takeCast && (adds.length || ownRemoved)) return GUEST_SEAT_SENTENCES.takeCastOff
			if (switches.takeCast)
				for (const id of adds) {
					const refusal = await guestTakeRefusal(d, sessionId, id)
					if (refusal) return refusal
				}
		}
		if (adds.length) {
			const carded = await d
				.select({ id: schema.lorebookBindings.id })
				.from(schema.lorebookBindings)
				.where(
					and(
						inArray(schema.lorebookBindings.id, adds),
						isNotNull(schema.lorebookBindings.characterId)
					)
				)
			characterAdds += carded.length
		}
	}

	// 🚧 Seats from shared cards: each is a copy made on a card shared with the
	// caller, so it is checked before any write. No watcher check, as an
	// own-card add has none.
	for (const entry of dedupedSharedCardSeats(params)) {
		const refusal = await sharedCardRefusal(d, entry.characterId, userId)
		if (refusal) return refusal
		if (switches && !switches.bringOwn) return GUEST_SEAT_SENTENCES.bringOwnOff
		if (entry.kind === "character") characterAdds++
		else personaAdds++
	}

	// Each seat opened for someone is a persona add.
	personaAdds += params.playerSeatsFor?.length ?? 0

	return seatKindAddRefusal(d, sessionId, { characters: characterAdds, personas: personaAdds })
}

function dedupedSharedCardSeats(params: Sockets.Sessions.Update.Params) {
	const seen = new Set<string>()
	return (params.sharedCardSeats ?? []).filter((entry) => {
		const key = `${entry.kind}:${entry.characterId}`
		if (seen.has(key)) return false
		seen.add(key)
		return true
	})
}

export const sessionsSaveDraftHandler: Handler<
	Sockets.Sessions.SaveDraft.Params,
	Sockets.Sessions.SaveDraft.Response
> = {
	event: "sessions:saveDraft",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const sessionAccess = await checkSessionAccess(params.sessionId, userId)
		if (!sessionAccess.hasAccess) {
			return { success: false }
		}

		// 🚧 pr-6 (ledger A5): ONE statement, no read — the UPDATE's own row
		// lock is the lock, so two people saving at once keep both drafts.
		const key = String(userId)
		if (params.content) {
			await db.execute(sql`
				update sessions
				set drafts = jsonb_set(
					coalesce(drafts, '{}')::jsonb,
					${`{${key}}`}::text[],
					to_jsonb(${params.content}::text),
					true
				)::json
				where id = ${params.sessionId}
			`)
		} else {
			await db.execute(sql`
				update sessions
				set drafts = (coalesce(drafts, '{}')::jsonb - ${key}::text)::json
				where id = ${params.sessionId}
			`)
		}

		return { success: true }
	}
}

export const sessionsUpdateHandler: Handler<
	Sockets.Sessions.Update.Params,
	Sockets.Sessions.Update.Response
> = refusable(
	"sessions:update",
	async (socket, params: Sockets.Sessions.Update.Params, emitToUser) => {
		try {
			// 🚧 pr-6 (ledger A5): the row's two documents are not this form's.
			for (const key of ["metadata", "drafts"] as const)
				if (Object.prototype.hasOwnProperty.call(params.session ?? {}, key))
					throw new Error(SESSION_UPDATE_REFUSALS.rowDocuments)
			const userId = socket.user!.id

			// Check if user has access to update this session
			const sessionAccess = await checkSessionAccess(
				params.session.id!,
				userId
			)
			if (!sessionAccess.hasAccess) {
				throw new Error(
					"Access denied. Only session owners can update sessions."
				)
			}

			// 🚧 One cast member is one character seat (owner 2026-11-05): a list
			// that seats two cards of one member is refused in words, before
			// anything is written. Answered as every refusal of this handler is
			// (a thrown sentence, sent as `sessions:update:error`).
			if (
				params.characterIds !== undefined ||
				params.castMemberIds !== undefined
			) {
				const twice = await sameMemberRefusal(db as unknown as Db, {
					sessionId: params.session.id!,
					cardIds: params.characterIds ?? [],
					castMemberIds: params.castMemberIds
				})
				if (twice) throw new Error(twice)
			}

			// 🚧 The guest seat switches and the genre's opt-in, before any write.
			const preflight = await seatPreflight(params, userId, sessionAccess.isOwner)
			if (preflight) throw new Error(preflight)

			// 🚧 Seat handovers (owner rulings S1, S2, S4, 2026-11-17): every one
			// checked here, so a refusal leaves the whole save unwritten.
			const handovers = await resolveSeatHandovers(db as unknown as Db, {
				sessionId: params.session.id!,
				callerId: userId,
				isOwner: sessionAccess.isOwner,
				handovers: params.seatHandovers
			})
			if (!handovers.ok) throw new Error(handovers.refusal)

			// 🚧 Seats opened for someone (owner rulings S1, PS1, 2026-11-17), checked
			// here too, so a refusal leaves the whole save unwritten.
			const seatsFor = await resolvePlayerSeatsFor(db as unknown as Db, {
				sessionId: params.session.id!,
				callerId: userId,
				isOwner: sessionAccess.isOwner,
				entries: params.playerSeatsFor
			})
			if (!seatsFor.ok) throw new Error(seatsFor.refusal)

			// 🚧 Seats moved to the AI (owner rulings S2, MV1, MV2, 2026-11-17),
			// checked here too, so a refusal leaves the whole save unwritten.
			const seatMoves = await resolveSeatMoves(db as unknown as Db, {
				sessionId: params.session.id!,
				callerId: userId,
				isOwner: sessionAccess.isOwner,
				moves: params.seatMoves
			})
			if (!seatMoves.ok) throw new Error(seatMoves.refusal)
			/** The cards those seats name: the persona list never seats them as the owner's. */
			const cardsSeatedFor = new Set(
				seatsFor.seats.map((e) => e.cardId).filter((id) => id != null)
			)

			// Guests may manage characters/personas on a session (further
			// ownership-checked below) but never session-level settings — name,
			// scenario, lorebook, connection/sampling/prompt overrides, tags,
			// response mode, etc. Enforced here server-side rather than only
			// hiding those fields client-side, since this event is reachable
			// directly regardless of what the UI shows.
			/** The genre's fields changed — a value a predicate may read (U5e, review W-A5). */
			let fieldsMoved = false
			/** 🚧 A confirmed clock move back under On revision = Branch: the branch's clock, set once everything else is saved. */
			let clockBranchTo: ReturnType<typeof clockFromColumns>
			/** 🚧 The branch that move made. */
			let clockBranchId: number | undefined
			/** 🚧 A guest seat switch was written: every member's page hears it. */
			let switchesWritten = false
			if (sessionAccess.isOwner) {
				const tags = params.tags || []

				// The lorebook is never written from here (the book lock below);
				// everything else here is either owner-only data or a reference
				// to an admin-managed global table (samplingConfigs), which
				// needs no ownership check.
				//
				// ⚠ `connectionId` was on that list, then was refused for
				// non-admins, and is now simply gone (0130): a session names no
				// connection at all. The allowlist below IS the strip — a key
				// nobody destructures is a key nothing writes — so an old
				// client still posting the field changes nothing and is told
				// nothing, because there is no boundary left for it to have
				// crossed.
				// The book lock (★B-5, 2026-11-08): a session keeps the lorebook it
				// started with. Said before the owner-only checks and the write. The
				// same value is accepted (old clients post every field) and the
				// book is never written from here, so a book needing the
				// kit/ownership check can only ever be the one already read.
				if (params.session.lorebookId !== undefined) {
					const [now] = await db
						.select({ lorebookId: schema.sessions.lorebookId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, params.session.id!))
					const { bookChangeRefusal } = await import("$lib/server/sessions/bookLock")
					const locked = bookChangeRefusal(
						{ lorebookId: now?.lorebookId ?? null },
						params.session.lorebookId ?? null
					)
					if (locked) throw new Error(locked)
				}

				// Explicit allowlist, not a spread of the full client payload
				// (Params.session is UpdateSession = Partial<SelectSession>, so a bare
				// spread would also accept id/userId/isGroup/createdAt —
				// isGroup is recomputed separately below when characterIds is
				// provided, never client-settable directly here). Tags are
				// handled separately via Params.tags, not this table.
				const {
					name,
					scenario,
					lorebookId,
					genreFields,
					lorebookBranchId,
					storyClockYear,
					storyClockMonth,
					storyClockDay,
					storyClockHour,
					storyClockMinute,
					onRevision,
					rigour
				} = params.session
				// 🚧 On revision (PLAN-rulesets §28): one of the two modes, or
				// refused in a sentence — never quietly read as overwrite.
				if (onRevision !== undefined) {
					const { isOnRevision } = await import("$lib/server/sessions/revision")
					if (!isOnRevision(onRevision))
						throw new Error("On revision must be Overwrite or Branch.")
				}

				// Mode field values, filtered to the keys the session's mode
				// declares (19 §1) — same write rule as creation. `genreId`
				// itself is deliberately absent from this allowlist: switching
				// a session's mode is a policy question 19 §10 leaves open, not an
				// update field.
				let genreFieldsPatch: Record<string, unknown> | undefined
				if (genreFields !== undefined) {
					const { getSessionGenre } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const mode = await getSessionGenre(
						db,
						await sessionGenreOf(db, params.session.id!)
					)
					const declared = Object.keys(
						(mode?.shape as any)?.fields ?? {}
					)
					genreFieldsPatch = Object.fromEntries(
						Object.entries(
							(genreFields ?? {}) as Record<string, unknown>
						).filter(([k]) => declared.includes(k))
					)
					// 🚧 Speech: narrator voice checked here too (lane V V-3).
					const { SPEECH_FIELD_KEYS } = await import("$lib/shared/sessions/speechSettings")
					if (SPEECH_FIELD_KEYS.narratorVoice in genreFieldsPatch) {
						const { narratorVoiceRefusal } = await import("$lib/server/speech/narratorVoiceCheck")
						const refusal = await narratorVoiceRefusal(db, genreFieldsPatch[SPEECH_FIELD_KEYS.narratorVoice])
						if (refusal) throw new Error(refusal)
					}
				}

				/**
				 * What `session-updated` names as `changed` (PLAN-turn-order
				 * §4.1, A2): the columns whose stored value differs after
				 * the write, by name, in the allowlist's order — read once
				 * before the write and compared after it, so a form that
				 * posts every field unchanged emits nothing. Tags are diffed
				 * as a set of ids.
				 */
				const [before] = await db
					.select()
					.from(schema.sessions)
					.where(eq(schema.sessions.id, params.session.id!))
					.limit(1)
				const tagsBefore = (
					await db
						.select({ tagId: schema.sessionTags.tagId })
						.from(schema.sessionTags)
						.where(eq(schema.sessionTags.sessionId, params.session.id!))
				)
					.map((t) => t.tagId)
					.sort()

				// How strict may change mid-session (PLAN-rulesets §21, kept by
				// the main session's ruling of 2026-10-20 over R32's gloss) —
				// unless a layer above the session locks it (A10: Rule Based
				// locks `scripts`). Sending the value it already has is no change.
				if (rigour !== undefined && before && rigour !== before.rigour) {
					const { genreSettingsOf } = await import("$lib/server/sessions/exposure")
					const { settings } = await genreSettingsOf(db, params.session.id!, !!socket.user!.isAdmin)
					const locked = settings.find((x) => x.key === "rigour")?.lockedAt
					if (locked)
						throw new Error(
							`How strict is set by the session's ${locked === "preset" ? "preset" : "genre"} and cannot be changed here.`
						)
				}
				// 🚧 A10, R1: a genre field locked by the genre's defaults or the
				// preset, or one that reaches administrators only, is not the
				// owner's to change — refused when the form would change it.
				if (genreFieldsPatch && Object.keys(genreFieldsPatch).length) {
					const { genreSettingsOf } = await import("$lib/server/sessions/exposure")
					const { settings, editable } = await genreSettingsOf(db, params.session.id!, !!socket.user!.isAdmin)
					for (const [k, v] of Object.entries(genreFieldsPatch)) {
						if (editable.has(k)) continue
						const s = settings.find((x) => x.key === k)
						if (!s || JSON.stringify(s.value ?? null) === JSON.stringify(v ?? null)) {
							delete genreFieldsPatch[k]
							continue
						}
						const label = (s.decl as { label?: unknown }).label
						const named = typeof label === "string" ? label : ((label as { en?: string } | undefined)?.en ?? k)
						throw new Error(
							s.lockedAt
								? `${named} is set by the session's ${s.lockedAt === "preset" ? "preset" : "genre"} and cannot be changed here.`
								: `${named} is changed by an administrator.`
						)
					}
				}
				// 🚧 How strict (PLAN-rulesets §21): one of the genre's options,
				// or refused in a sentence that names them in the interface's
				// words (§28).
				if (rigour !== undefined) {
					const { getGenre, getRuleset } = await import("@serene-pub/sdk")
					const { STANDARD_GENRE_ID } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const { rigoursPlayed } = await import("$lib/shared/rulesets/rulesOffer")
					const { rulesetDecides } = await import("$lib/server/rulesets/methods")
					const genre = getGenre(before?.genreId ?? STANDARD_GENRE_ID)
					const genreOptions: readonly string[] = genre?.rigour?.options ?? ["prose"]
					// The creation narrowing: a ruleset that decides nothing plays Words only.
					const options: readonly string[] =
						rigoursPlayed(rulesetDecides(getRuleset(String(before?.primaryRuleset ?? ""))), genreOptions) ??
						genreOptions
					if (typeof rigour !== "string" || !options.includes(rigour)) {
						const { rigourLabel } = await import("$lib/shared/rulesets/rigourLabels")
						const named = options.map(rigourLabel)
						throw new Error(
							named.length > 1
								? `How strict must be ${named.slice(0, -1).join(", ")} or ${named[named.length - 1]}.`
								: `This genre plays ${named[0] ?? "Words only"}${named[0]?.endsWith(" only") ? "" : " only"}.`
						)
					}
				}

				// 🚧 Where the session reads its book (ruling 15, story-time
				// P3): its line and its story clock. Attaching or switching a
				// book starts it at that book's most recently used line with no
				// clock of its own (it follows that line's present); a named
				// branch must be one of the book's own, and a clock must land
				// in its calendar.
				// Refused with a sentence, never quietly read as main. The
				// dates it checks (the clock, the stats a new book takes in)
				// are checked and the row written in one transaction, under
				// the book's calendar lock.
				// 🚧 A clock moved back past this session's own dated writes follows
				// its On revision, confirmed first: refused until confirmed, then
				// Overwrite writes it as today and Branch leaves this session's
				// clock and sets the branch's.
				const clockAsked = clockFromColumns({
					storyClockYear,
					storyClockMonth,
					storyClockDay,
					storyClockHour,
					storyClockMinute
				})
				let clockBranches = false
				if (
					clockAsked !== undefined &&
					before &&
					(lorebookBranchId === undefined || lorebookBranchId === before.lorebookBranchId) &&
					JSON.stringify(clockAsked) !== JSON.stringify(clockFromColumns(before))
				) {
					const { clockMoveBackNotice } = await import("$lib/server/sessions/clockMoveBack")
					const notice = await clockMoveBackNotice(
						db,
						before.id,
						clockAsked === null ? { follow: true } : { to: clockAsked }
					)
					if (notice) {
						if (params.confirmClockMoveBack !== true) throw new Error(notice.sentence)
						if (notice.mode === "branch") {
							// Refused before anything is written: a Branch needs a message to fork at.
							const { newestLiveMessage, NO_MESSAGE_TO_BRANCH_AT } = await import("$lib/server/sessions/revision")
							if ((await newestLiveMessage(db, before.id)) == null) throw new Error(NO_MESSAGE_TO_BRANCH_AT)
							// And a clock the calendar cannot hold: the branch is made after
							// the save, so the date is checked here, before either.
							if (clockAsked) {
								const { bookCalendarOf, clockProblem } = await import("$lib/server/state/storyTime")
								const { ownBookOf, OWN_BOOK_CALENDAR } = await import("$lib/server/lorebooks/ownBook")
								const clockBook = before.lorebookId ?? (await ownBookOf(db, before.id))?.id ?? null
								const problem = clockProblem(
									clockAsked,
									clockBook != null ? await bookCalendarOf(db, clockBook) : OWN_BOOK_CALENDAR
								)
								if (problem) throw new Error(`That clock does not fit this lorebook. ${problem}`)
							}
							clockBranches = true
						}
					}
				}
				await db.transaction(async (tx) => {
					const linePatch = await sessionLinePatch(tx, {
						before: before ?? null,
						session: before ? { id: before.id, name: before.name } : undefined,
						lorebookId,
						lorebookBranchId,
						clock: clockBranches ? undefined : clockAsked
					})

					await tx
						.update(schema.sessions)
						.set({
							...linePatch,
							...(name !== undefined ? { name } : {}),
							...(scenario !== undefined ? { scenario } : {}),
							...(onRevision !== undefined ? { onRevision } : {}),
							updatedAt: new Date()
						})
						.where(eq(schema.sessions.id, params.session.id!))

					// Genre fields MERGE over what is stored (2026-10-03): the
					// form sends only the fields the person changed, so a field
					// it never touched — the author's note saved from its widget
					// while the form was open — keeps what was saved. Read
					// inside this transaction, so no write lands between.
					if (genreFieldsPatch !== undefined)
						await writeGenreFields(tx, params.session.id!, (cur) => ({ ...cur, ...genreFieldsPatch }))
					if (rigour !== undefined) await writeRigour(tx, params.session.id!, rigour)
				})
				if (clockBranches) clockBranchTo = clockAsked ?? null
				// The `playerLabel` override (lair re-plan R4): on the row's
				// metadata, written as its own key so nothing else there moves.
				// Only for a genre that declares a label — a rename of nothing
				// is not stored. Before the `after` read below, so a rename is
				// named as `metadata` in `session-updated`.
				if (params.playerLabel !== undefined) {
					const { getSessionGenre, STANDARD_GENRE_ID } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const genre = await getSessionGenre(
						db,
						before?.genreId ?? STANDARD_GENRE_ID
					)
					if (genre?.playerLabel) {
						const { writePlayerLabel } = await import(
							"$lib/server/sessions/playerLabel"
						)
						await writePlayerLabel(
							db,
							params.session.id!,
							params.playerLabel
						)
					}
				}

				// 🚧 The two guest seat switches: their own keys on the row's
				// metadata, the owner's alone (a guest's values are dropped).
				if (
					typeof params.guestsBringOwn === "boolean" ||
					typeof params.guestsTakeCast === "boolean"
				) {
					await writeGuestSeatSwitches(db, params.session.id!, {
						bringOwn: params.guestsBringOwn,
						takeCast: params.guestsTakeCast
					})
					switchesWritten = true
				}

				// 🚧 The scene settings override (live scenes §4–§5): on the
				// row's metadata, as its own key, like the label above. A
				// declaration that does not read is refused with its
				// sentences; null clears it. The session's open pages hear
				// the new settings (and the cues they now offer).
				if (params.sceneSettings !== undefined) {
					const { writeSceneSettings } = await import(
						"$lib/server/sessions/sceneSettings"
					)
					// A session with the *Summarize finished scenes* routine keeps no
					// Summaries value: the routine's mode is its setting.
					let sceneSettings = params.sceneSettings ?? null
					try {
						const [{ sessionRoutineMode }, { SCENE_SUMMARIES_SPEC_ID }] = await Promise.all([
							import("$lib/server/pipelines/routines/sessionRoutines"),
							import("@serene-pub/core-catalog")
						])
						if ((await sessionRoutineMode(db, params.session.id!, SCENE_SUMMARIES_SPEC_ID)) !== null) {
							// A stored Never or On close that was never converted (an
							// import, a routine added to the preset since) becomes the
							// routine's mode BEFORE this save replaces the stored
							// settings: a save, or *Use the genre's settings*, would
							// otherwise wipe it and leave the routine on its preset's mode.
							const { convertSummariesSetting } = await import(
								"$lib/server/sessions/summariesToRoutine"
							)
							await convertSummariesSetting(db, params.session.id!)
							if (sceneSettings && "summary" in sceneSettings) {
								const { summary: _dropped, ...rest } = sceneSettings
								sceneSettings = rest
							}
						}
					} catch (err) {
						console.warn("[sessions:update] the session's routines could not be read; the Summaries value was stored:", err)
					}
					await writeSceneSettings(
						db,
						params.session.id!,
						sceneSettings
					)
					const { pushSceneCues } = await import(
						"$lib/server/scenes/boundaryWatcher"
					)
					await pushSceneCues(socket.io, params.session.id!)
				}

				// Process tags after session update — only when the caller sent a
				// tag list: a partial update (the Author's note Scenario, taking a
				// seat) omits `tags`, and reading that as "no tags" deleted every
				// tag the owner had on the session (lay-C scope review, 2026-11-06).
				if (params.tags !== undefined)
					await processSessionTags(params.session.id!, tags, userId)
				fieldsMoved = genreFieldsPatch !== undefined

				// `session-updated` (§4.1): emitted once, only when a
				// column moved, under the person's `settings` cause — which
				// never fires a turn (§4.6). Best-effort, like the member
				// events below: an emitter failing must not fail the save.
				try {
					const [after] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, params.session.id!))
						.limit(1)
					const tagsAfter = (
						await db
							.select({ tagId: schema.sessionTags.tagId })
							.from(schema.sessionTags)
							.where(
								eq(schema.sessionTags.sessionId, params.session.id!)
							)
					)
						.map((t) => t.tagId)
						.sort()
					const same = (a: unknown, b: unknown) =>
						JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
					const changed: string[] = []
					if (before && after) {
						for (const column of [
							"name",
							"scenario",
							"lorebookId",
							"genreFields",
							"lorebookBranchId"
						] as const)
							if (!same(before[column], after[column]))
								changed.push(column)
						const clockOf = (r: typeof before) => [
							r.storyClockYear,
							r.storyClockMonth,
							r.storyClockDay,
							r.storyClockHour,
							r.storyClockMinute
						]
						if (!same(clockOf(before), clockOf(after))) changed.push("storyClock")
					}
					// The line or the clock moved: what the session inherits
					// did, so every tab reads its state afresh. 🚧 So did a genre
					// field (PLAN-dc-after-walk2 Q1-7): Honour mode decides who
					// may change a sheet by hand, and a guest's piece popover
					// gained its Edit, Give to… and Remove only on a reload.
					if (
						changed.some((c) =>
							c === "lorebookId" || c === "lorebookBranchId" || c === "storyClock" || c === "genreFields"
						)
					)
						await broadcastToSessionUsers(socket.io, params.session.id!, "state:changed", {
							sessionId: params.session.id!
						} satisfies Sockets.State.Changed.Response)
					if (!same(tagsBefore, tagsAfter)) changed.push("tags")
					// The owner's other open forms refresh what they hold of
					// these fields (2026-10-03) — the owner alone edits them.
					if (changed.includes("genreFields") && after)
						emitToUser("sessions:genreFieldsChanged", {
							sessionId: params.session.id!,
							genreFields: (after.genreFields ?? {}) as Record<string, unknown>
						} satisfies Sockets.Sessions.GenreFieldsChanged.Response)
					if (changed.length) {
						const { emitSessionEvent } = await import(
							"$lib/server/pipelines/runtime/sessionEvents"
						)
						await emitSessionEvent(db, {
							sessionId: params.session.id!,
							userId,
							event: sessionEvents.sessionUpdated,
							payload: {
								sessionId: params.session.id!,
								changed,
								cause: { kind: "settings", userId, ...appletCallerOf(params) }
							},
							io: socket.io
						})
						// 🚧 An owner's setting change is an interaction (R11,
						// R21), and a clock they moved is a session moment
						// (PLAN-layering D7, lane 6) — once, from where it stood.
						const { noteInteraction } = await import("$lib/server/pipelines/routines/interaction")
						await noteInteraction(db, params.session.id!, "setting")
						if (changed.includes("storyClock") && before && after) {
							const { clockOf } = await import("$lib/server/state/storyTime")
							const from = clockOf(before as never)
							const to = clockOf(after as never)
							if (from && to) {
								const { noteStoryClockMoved } = await import("$lib/server/pipelines/routines/moments")
								await noteStoryClockMoved(db, {
									sessionId: params.session.id!,
									userId,
									cause: { kind: "settings", userId, ...appletCallerOf(params) },
									from,
									to,
									io: socket.io
								})
							}
						}
					}
				} catch (err) {
					console.warn("session-updated emit failed:", err)
				}
			}

			// Membership changes are the seat writer's to say: each write below
			// (`seatCast`, `seatPlayer`, `settleSeats`, `unseat`, the seat-name
			// writers) hands back what it changed, and `announceSeatChanges`
			// dispatches them as member events (24 §5) once the writes are
			// done. The snapshot is kept only for a reorder (`cast-changed`
			// `position`), which no writer reports.
			const seatChanges: SeatChange[] = []
			const memberSnapshot = async () => {
				const ccs = await db.query.sessionCharacters.findMany({
					where: (cc, { eq }) => eq(cc.sessionId, params.session.id!)
				})
				const cps = await db.query.sessionPersonas.findMany({
					where: (cp, { eq }) => eq(cp.sessionId, params.session.id!)
				})
				// Card-less seats announce like any seat: live is S4's seat
				// rule (not an envoy, a member or a card).
				const liveCcs = ccs.filter(
					(c) =>
						!c.removedAt &&
						c.envoySlug == null &&
						(c.characterId != null || c.castMemberId != null)
				)
				const liveCps = cps.filter(
					(c) => !c.removedAt && c.personaId != null
				)
				const { hostSeatRefOf } = await import(
					"$lib/server/pipelines/prompt/seatCards"
				)
				// A seat's ref: the member form once the flip is on, else
				// the card form (a persona is a character row, 0132).
				const ccRef = (c: (typeof liveCcs)[number]) =>
					hostSeatRefOf({
						kind: "character",
						seatId: c.id,
						castMemberId: c.castMemberId,
						cardId: c.characterId
					})
				const cpRef = (c: (typeof liveCps)[number]) =>
					hostSeatRefOf({
						kind: "player",
						seatId: c.id,
						castMemberId: c.castMemberId,
						cardId: c.personaId
					}) ?? `character:${c.personaId}`
				// A seat with no ref at all is skipped rather than given a bad one.
				const refCcs = liveCcs.filter((c) => ccRef(c) != null)
				return {
					// Seat positions by participant reference, for the
					// `cast-changed` diff (PLAN-turn-order §4.1): a reorder
					// is a cast change, not a membership one. The seat's
					// ref is `hostSeatRefOf`'s: the member form once the
					// flip is on, else the card form (a persona is a
					// character row, 0132).
					positions: new Map<string, number>([
						...refCcs.map(
							(c) => [ccRef(c) as string, c.position ?? 0] as const
						),
						...liveCps.map((c) => [cpRef(c), c.position ?? 0] as const)
					])
				}
			}
			// 🚧 The checked handovers, in one transaction, before the seat lists.
			let handedOver = false
			if (handovers.writes.length)
				handedOver = await db.transaction(async (tx) =>
					writeSeatHandovers(
						tx as unknown as Db,
						params.session.id!,
						handovers.writes
					)
				)
			// A request carrying only `castMemberIds` seats card-less members, so
			// it takes the snapshot too.
			const membersBefore =
				params.characterIds !== undefined ||
				params.personaIds !== undefined ||
				params.castMemberIds !== undefined ||
				params.sharedCardSeats?.length
					? await memberSnapshot()
					: null

			// 🚧 Seats moved between the groups: all in one transaction, each through
			// its one writer, before the persona, character and member diffs, which
			// then see the new seat as it stands. A refusal here (the pre-check above
			// repeats it) rolls back only this block; the pre-check's refusals roll
			// back the whole save, nothing written. Payload rule for a form: send the
			// move in `seatMoves`. To the AI: the moved seat's card stays out of
			// `personaIds`, or stays in it and is ignored (a card a live character
			// seat holds with no live player seat is never re-seated as a persona
			// here); it may be in `characterIds` or absent from it, and its AI seat
			// is kept either way. To a person: the moved card or member may stay in
			// or leave `characterIds` / `castMemberIds` (ignored), and `personaIds`
			// may list the card or not; the new player seat stays either way.
			const movedCardIds = new Set<number>()
			const movedSeatIds = new Set<number>()
			const movedToPersonCardIds = new Set<number>()
			const movedToPersonMemberIds = new Set<number>()
			if (seatMoves.writes.length) {
				const sessionId = params.session.id!
				const minted: Parameters<typeof syncMintedSeatMembers>[1][] = []
				const changes = await db.transaction(async (tx) => {
					const out: SeatChange[] = []
					for (const w of seatMoves.writes) {
						const moved = await moveSeatKind(
							tx as unknown as Db,
							w.to === "character"
								? {
										sessionId,
										playerSeatId: w.playerSeatId,
										seen: w.seen
									}
								: {
										sessionId,
										characterSeatId: w.characterSeatId,
										toUserId: w.toUserId,
										seen: w.seen
									}
						)
						out.push(...moved.changes)
						minted.push(moved.mintedMembers)
						if (moved.to === "character")
							movedSeatIds.add(moved.characterSeatId)
						else if (w.to === "player") {
							if (w.seen.characterId != null)
								movedToPersonCardIds.add(w.seen.characterId)
							movedToPersonMemberIds.add(moved.castMemberId)
						}
					}
					return out
				})
				seatChanges.push(...changes)
				for (const m of minted) await syncMintedSeatMembers(db, m)
				const cs = schema.sessionCharacters
				if (movedSeatIds.size)
					for (const r of await db
						.select({ characterId: cs.characterId })
						.from(cs)
						.where(inArray(cs.id, [...movedSeatIds])))
						if (r.characterId != null) movedCardIds.add(r.characterId)
				const [live] = await db
					.select({ n: sql<number>`count(*)::int` })
					.from(cs)
					.where(
						and(
							eq(cs.sessionId, sessionId),
							isNull(cs.removedAt),
							isNull(cs.envoySlug),
							or(isNotNull(cs.characterId), isNotNull(cs.castMemberId))
						)
					)
				await db
					.update(schema.sessions)
					.set({ isGroup: (live?.n ?? 0) > 1 })
					.where(eq(schema.sessions.id, sessionId))
			}
			/**
			 * Cards a live character seat holds as the persona diff starts: a
			 * `personaIds` entry for one with no live player seat is ignored, never
			 * a revive (a list still naming a moved card cannot undo the move).
			 * A character seat made by this very save's `characterIds` is not in it,
			 * so a card seated both ways in one save still makes the pair.
			 */
			const cardsHeldByAi = new Set<number>()
			if (params.personaIds !== undefined) {
				const cs = schema.sessionCharacters
				for (const r of await db
					.select({ characterId: cs.characterId })
					.from(cs)
					.where(
						and(
							eq(cs.sessionId, params.session.id!),
							isNull(cs.removedAt),
							isNull(cs.envoySlug),
							isNotNull(cs.characterId)
						)
					))
					cardsHeldByAi.add(r.characterId!)
			}

			// Sync sessionCharacters if provided
			if (params.characterIds !== undefined) {
				const existingCCs = await db.query.sessionCharacters.findMany({
					where: (cc, { eq }) => eq(cc.sessionId, params.session.id!),
					// Ids and the owner only; the name a departed seat falls
					// back to is the card now (below), never the row's copy.
					with: { character: { columns: { id: true, userId: true } } }
				})
				await putCardsNow([{ rows: existingCCs, key: "character" }])
				// Diffing/ownership decisions below are all against currently
				// *active* participants — a removed row must not block a
				// re-add, and must not be silently "removed" again.
				const activeCCs = existingCCs.filter((cc) => !cc.removedAt)
				const existingCharacterIds = new Set(
					activeCCs
						.map((cc) => cc.characterId)
						.filter((id): id is number => id !== null)
				)
				// A seat the move made this save is kept, listed or not.
				// A card moved to a person this save is ignored: never added back.
				const newCharacterIds = new Set([
					...params.characterIds.filter((id) => !movedToPersonCardIds.has(id)),
					...movedCardIds
				])

				// Only characters the requesting user owns can be newly added —
				// already-linked characters (eg. added by another participant)
				// are left alone regardless of who owns them.
				const characterIdsToAdd = params.characterIds.filter(
					(id) =>
						!existingCharacterIds.has(id) && !movedToPersonCardIds.has(id)
				)
				if (characterIdsToAdd.length > 0) {
					const ownedCharacterIds = await checkCharactersOwnership(
						characterIdsToAdd,
						userId
					)
					if (ownedCharacterIds.size !== characterIdsToAdd.length) {
						throw new Error(
							"Access denied. You can only add characters you own."
						)
					}
				}

				// Removal is a soft delete, not a hard delete, so past
				// messages can still resolve who spoke them. Guests may only
				// remove characters they themselves own; the session owner may
				// remove anyone's. A row the caller isn't permitted to touch
				// is simply left alone (not removed, no error), matching
				// this handler's existing per-row tolerance.
				// 🚧 (seat-cast S2) The name a departed seat keeps is its
				// member as read, not the card it holds.
				const seatsLeaving = activeCCs.filter(
					(cc) =>
						cc.characterId !== null &&
						!newCharacterIds.has(cc.characterId) &&
						(sessionAccess.isOwner ||
							cc.character?.userId === userId)
				)
				const { seatCardsAsRead } = await import(
					"$lib/server/pipelines/prompt/seatCards"
				)
				const seatsLeavingAsRead = new Map(
					(
						await seatCardsAsRead(
							db as unknown as Db,
							params.session.id!,
							seatsLeaving
						)
					).map((read) => [read.id, read.character])
				)
				for (const cc of activeCCs) {
					if (cc.characterId === null) continue
					if (!newCharacterIds.has(cc.characterId)) {
						const canRemove =
							sessionAccess.isOwner ||
							cc.character?.userId === userId
						if (!canRemove) continue
						seatChanges.push(
							...(await unseat(db, {
								sessionId: params.session.id!,
								kind: "character",
								seatId: cc.id,
								removedName: resolveCharacterName(
									(seatsLeavingAsRead.get(cc.id) ??
										cc.character) as SeatCardNames | null,
									"Unknown"
								)
							}))
						)
					}
				}
				for (let i = 0; i < params.characterIds.length; i++) {
					const characterId = params.characterIds[i]
					if (movedToPersonCardIds.has(characterId)) continue
					const position =
						(params.characterPositions ?? {})[characterId] ?? i
					if (existingCharacterIds.has(characterId)) {
						// Seat order is the owner's: a guest's save never moves a seat.
						if (!sessionAccess.isOwner) continue
						await db
							.update(schema.sessionCharacters)
							.set({ position })
							.where(
								and(
									eq(
										schema.sessionCharacters.sessionId,
										params.session.id!
									),
									eq(
										schema.sessionCharacters.characterId,
										characterId
									)
								)
							)
					} else {
						// Upsert, not insert: the target character may already
						// have a soft-removed row for this session (sessionId +
						// characterId is uniquely indexed), in which case this
						// re-add must revive it rather than violate that index.
						// The seat writer does both and gives the seat its member.
						const seat = await db.transaction(async (tx) =>
							seatCast(tx as unknown as Db, {
								sessionId: params.session.id!,
								cardId: characterId,
								position,
								seatedBy: userId
							})
						)
						if (!seat.ok) throw new Error(seat.refusal)
						seatChanges.push(...seat.changes)
						// Committed: a member just made is named from its card.
						await syncMintedSeatMembers(db, seat.mintedMembers)
					}
				}
				// A group counts its card-less seats too (plan §34.2).
				const [cardless] = await db
					.select({ n: sql<number>`count(*)::int` })
					.from(schema.sessionCharacters)
					.where(
						and(
							eq(schema.sessionCharacters.sessionId, params.session.id!),
							isNull(schema.sessionCharacters.removedAt),
							isNull(schema.sessionCharacters.envoySlug),
							isNull(schema.sessionCharacters.characterId),
							isNotNull(schema.sessionCharacters.castMemberId)
						)
					)
				await db
					.update(schema.sessions)
					.set({ isGroup: newCharacterIds.size + (cardless?.n ?? 0) > 1 })
					.where(eq(schema.sessions.id, params.session.id!))
			}

			// 🚧 Sync the card-less character seats (plan §34.2) if provided: members
			// of the session's books seated without a card. Only these rows are
			// diffed here — a carded row is the `characterIds` diff's.
			if (params.castMemberIds !== undefined) {
				const cs = schema.sessionCharacters
				// A member moved to a person this save is ignored: no `alreadySeated`.
				const wanted = [...new Set(params.castMemberIds)].filter(
					(id) => !movedToPersonMemberIds.has(id)
				)
				const seats = await db
					.select({
						id: cs.id,
						castMemberId: cs.castMemberId,
						seatedBy: cs.seatedByUserId,
						position: cs.position,
						characterId: cs.characterId
					})
					.from(cs)
					.where(
						and(
							eq(cs.sessionId, params.session.id!),
							isNull(cs.removedAt),
							isNull(cs.envoySlug),
							or(isNotNull(cs.characterId), isNotNull(cs.castMemberId))
						)
					)
				const cardless = seats.filter(
					(seat) => seat.characterId === null && seat.castMemberId !== null
				)
				const heldMembers = new Set(cardless.map((seat) => seat.castMemberId))
				let nextPosition =
					Math.max(-1, ...seats.map((seat) => seat.position ?? 0)) + 1
				for (const castMemberId of wanted) {
					if (heldMembers.has(castMemberId)) continue
					// A member a player seat holds has its one seat already.
					if ((await heldMemberIds(db as unknown as Db, params.session.id!)).has(castMemberId)) {
						const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
						const read = (
							await membersAsRead(db as unknown as Db, [castMemberId], {
								sessionId: params.session.id!
							})
						).get(castMemberId)
						throw new Error(
							PLAYER_SEATS_FOR_REFUSALS.alreadySeated(
								resolveCharacterName(read, "That person")
							)
						)
					}
					const seat = await db.transaction(async (tx) =>
						seatCast(tx as unknown as Db, {
							sessionId: params.session.id!,
							castMemberId,
							position: nextPosition++,
							seatedBy: userId
						})
					)
					if (!seat.ok) throw new Error(seat.refusal)
					seatChanges.push(...seat.changes)
				}
				// A seat leaves when the caller is the session's owner or seated it.
				const leaving = cardless.filter(
					(seat) =>
						!wanted.includes(seat.castMemberId!) &&
						!movedSeatIds.has(seat.id) &&
						(sessionAccess.isOwner || seat.seatedBy === userId)
				)
				if (leaving.length) {
					const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
					const asRead = await membersAsRead(
						db as unknown as Db,
						leaving.map((seat) => seat.castMemberId!),
						{ sessionId: params.session.id! }
					)
					for (const seat of leaving)
						seatChanges.push(
							...(await unseat(db, {
								sessionId: params.session.id!,
								kind: "character",
								seatId: seat.id,
								removedName: resolveCharacterName(
									asRead.get(seat.castMemberId!),
									"Unknown"
								)
							}))
						)
				}
				const [live] = await db
					.select({ n: sql<number>`count(*)::int` })
					.from(cs)
					.where(
						and(
							eq(cs.sessionId, params.session.id!),
							isNull(cs.removedAt),
							isNull(cs.envoySlug),
							or(isNotNull(cs.characterId), isNotNull(cs.castMemberId))
						)
					)
				await db
					.update(schema.sessions)
					.set({ isGroup: (live?.n ?? 0) > 1 })
					.where(eq(schema.sessions.id, params.session.id!))
			}

			// Sync sessionPersonas if provided
			if (params.personaIds !== undefined) {
				const existingCPs = await db.query.sessionPersonas.findMany({
					where: (cp, { eq }) => eq(cp.sessionId, params.session.id!),
					with: { persona: { columns: { id: true, userId: true } } }
				})
				await putCardsNow([{ rows: existingCPs, key: "persona" }])
				const activeCPs = existingCPs.filter((cp) => !cp.removedAt)
				const existingPersonaIds = new Set(
					activeCPs
						.map((cp) => cp.personaId)
						.filter((id): id is number => id !== null)
				)
				// A card moved to a person this save keeps its new player seat, listed or not.
				const newPersonaIds = new Set([
					...params.personaIds,
					...movedToPersonCardIds
				])

				// Only personas the requesting user owns can be newly added —
				// already-linked personas (eg. added by another participant)
				// are left alone regardless of who owns them.
				// A card a live character seat holds, with no live player seat,
				// is ignored: the list cannot tell "still names it" from "add it".
				const heldByAi = (id: number) =>
					cardsHeldByAi.has(id) && !existingPersonaIds.has(id)
				const personaIdsToAdd = params.personaIds.filter(
					(id) => !existingPersonaIds.has(id) && !heldByAi(id)
				)
				if (personaIdsToAdd.length > 0) {
					const ownedPersonaIds = await checkPersonasOwnership(
						personaIdsToAdd,
						userId
					)
					if (ownedPersonaIds.size !== personaIdsToAdd.length) {
						throw new Error(
							"Access denied. You can only add personas you own."
						)
					}
				}

				// Soft delete, same rule as characters above: guests may only
				// remove personas they own; the session owner may remove anyone's.
				// 🚧 The name a departed player seat keeps is its member as read
				// (★pT-1, 2026-11-05: "Everything in session is cast -> active
				// card"), a seat name still winning (`withSeatName`).
				const personaSeatsLeaving = activeCPs.filter(
					(cp) =>
						cp.personaId !== null &&
						!newPersonaIds.has(cp.personaId) &&
						(sessionAccess.isOwner ||
							cp.persona?.userId === userId)
				)
				const { seatCardsAsRead: personaSeatsAsRead } = await import(
					"$lib/server/pipelines/prompt/seatCards"
				)
				const { withSeatName: nameOverSeat } = await import(
					"$lib/server/sessions/seatName"
				)
				const personaSeatsLeavingAsRead = new Map(
					(
						await personaSeatsAsRead(
							db as unknown as Db,
							params.session.id!,
							personaSeatsLeaving.map((cp) => ({
								...cp,
								character: cp.persona as SeatCardNames | null
							}))
						)
					).map((read) => [
						read.id,
						nameOverSeat(read.character, read.seatName)
					])
				)
				for (const cp of activeCPs) {
					if (cp.personaId === null) continue
					if (!newPersonaIds.has(cp.personaId)) {
						const canRemove =
							sessionAccess.isOwner ||
							cp.persona?.userId === userId
						if (!canRemove) continue
						seatChanges.push(
							...(await unseat(db, {
								sessionId: params.session.id!,
								kind: "player",
								seatId: cp.id,
								removedName: resolvePersonaName(
									personaSeatsLeavingAsRead.get(cp.id) ??
										(cp.persona as SeatCardNames | null),
									"Unknown"
								)
							}))
						)
					}
				}
				for (let i = 0; i < params.personaIds.length; i++) {
					const personaId = params.personaIds[i]
					if (existingPersonaIds.has(personaId)) {
						// Seat order is the owner's: a guest's save never moves a seat.
						if (!sessionAccess.isOwner) continue
						await db
							.update(schema.sessionPersonas)
							.set({ position: i })
							.where(
								and(
									eq(
										schema.sessionPersonas.sessionId,
										params.session.id!
									),
									eq(
										schema.sessionPersonas.personaId,
										personaId
									)
								)
							)
					} else if (heldByAi(personaId)) {
						continue
					} else if (cardsSeatedFor.has(personaId)) {
						// Seated for its person below.
						continue
					} else if (
						// 🚧 The card's player's card-less player seat takes it,
						// keeping its name and stats (`givePlayerSeatACard`).
						await (
							await import("$lib/server/sessions/seatName")
						).givePlayerSeatACard(db, params.session.id!, personaId)
					) {
						// The seat now has a card: it gets its cast member.
						const settled = await db.transaction(async (tx) =>
							settleSeats(tx as unknown as Db, params.session.id!)
						)
						seatChanges.push(...settled.changes)
						await syncMintedSeatMembers(db, settled.mintedMembers)
						await db
							.update(schema.sessionPersonas)
							.set({ position: i })
							.where(
								and(
									eq(schema.sessionPersonas.sessionId, params.session.id!),
									eq(schema.sessionPersonas.personaId, personaId)
								)
							)
						await markCharacterAsPersona(personaId)
					} else {
						// Upsert: revive a soft-removed row if one exists for
						// this sessionId + personaId rather than violating the
						// unique index on that pair (the seat writer's default).
						// A card its adder owns is seated for that adder, so a row
						// revived from a guest's hold names them again.
						const [addedCard] = await db
							.select({ userId: schema.characters.userId })
							.from(schema.characters)
							.where(eq(schema.characters.id, personaId))
							.limit(1)
						const seat = await db.transaction(async (tx) =>
							seatPlayer(tx as unknown as Db, {
								sessionId: params.session.id!,
								personaId,
								position: i,
								...(addedCard?.userId === userId ? { userId } : {})
							})
						)
						seatChanges.push(...seat.changes)
						await syncMintedSeatMembers(db, seat.mintedMembers)
						await markCharacterAsPersona(personaId)
					}
				}
			}

			// 🚧 A seat name (2026-10-14): the caller's character name in this
			// session, or — the owner only — any seat's by `playerSeatId`. Absent
			// leaves it alone; blank or null clears it. Naming a seat the
			// caller does not have opens a card-less one for them.
			if (params.seatName !== undefined) {
				const { writeSeatName } = await import(
					"$lib/server/sessions/seatName"
				)
				await writeSeatName(db, {
					sessionId: params.session.id!,
					userId,
					isOwner: sessionAccess.isOwner,
					playerSeatId: params.playerSeatId ?? null,
					name: params.seatName,
					changes: seatChanges,
					createdBy: userId
				})
			}

			// 🚧 Card-less player seats renamed or removed in Edit Session
			// (`editCardlessPlayerSeats`). A first remove benches the seat; only
			// an unused benched seat is removed. It reports `unseat`'s change.
			if (params.playerSeatChanges?.length) {
				const { editCardlessPlayerSeats } = await import(
					"$lib/server/sessions/seatName"
				)
				await editCardlessPlayerSeats(db, {
					sessionId: params.session.id!,
					userId,
					isOwner: sessionAccess.isOwner,
					changes: params.playerSeatChanges,
					seatChanges
				})
			}

			// 🚧 Seats opened for someone (S1, PS1): all in one transaction, each
			// appended after the last seat. A revived seat keeps its stored person
			// (`seatPlayer` does not write it), so a person who differs is handed
			// the seat through its one writer.
			const seatedForCards: number[] = []
			if (seatsFor.seats.length) {
				const sessionId = params.session.id!
				const { seatNamed } = await import("$lib/server/sessions/seatName")
				const changes: SeatChange[] = []
				const minted: Parameters<typeof syncMintedSeatMembers>[1][] = []
				await db.transaction(async (tx) => {
					const t = tx as unknown as Db
					const sp = schema.sessionPersonas
					const held = await t
						.select({ position: sp.position })
						.from(sp)
						.where(eq(sp.sessionId, sessionId))
					let position = Math.max(-1, ...held.map((r) => r.position ?? 0)) + 1
					for (const e of seatsFor.seats) {
						if (e.cardId == null && e.castMemberId == null) {
							await seatNamed(t, sessionId, e.toUserId, e.seatName!, position++, changes, userId)
							continue
						}
						// The row this entry opens, as it stands inside the write: a live
						// seat that already has a person was taken since the check.
						const sought =
							e.cardId != null
								? eq(sp.personaId, e.cardId)
								: and(eq(sp.castMemberId, e.castMemberId!), isNull(sp.personaId))
						const [before] = await t
							.select({ removedAt: sp.removedAt, userId: sp.userId })
							.from(sp)
							.where(and(eq(sp.sessionId, sessionId), sought))
							.orderBy(asc(sql`(${sp.removedAt} is not null)`), desc(sp.id))
							.limit(1)
						if (before && before.removedAt == null && before.userId != null)
							throw new Error(
								PLAYER_SEATS_FOR_REFUSALS.alreadySeated(
									e.seatName ??
										resolveCharacterName(
											(await cardsNow(t, [e.cardId!])).get(e.cardId!),
											"That card"
										)
								)
							)
						const seat = await seatPlayer(t, {
							sessionId,
							position: position++,
							userId: e.toUserId,
							...(e.castMemberId != null
								? {
										personaId: null,
										castMemberId: e.castMemberId,
										...(e.cardId == null ? { seatName: e.seatName } : {})
									}
								: { personaId: e.cardId })
						})
						changes.push(...seat.changes)
						minted.push(seat.mintedMembers)
						if (e.cardId != null) seatedForCards.push(e.cardId)
						const [stored] = await t
							.select({ userId: sp.userId })
							.from(sp)
							.where(eq(sp.id, seat.seatId))
							.limit(1)
						if (stored?.userId !== e.toUserId)
							await handOverSeat(t, {
								sessionId,
								kind: "player",
								seatId: seat.seatId,
								fromUserId: before?.userId ?? null,
								toUserId: e.toUserId
							})
					}
				})
				seatChanges.push(...changes)
				for (const m of minted) await syncMintedSeatMembers(db, m)
				for (const cardId of seatedForCards) await markCharacterAsPersona(cardId)
			}

			// 🚧 Seats from shared cards (Q3, G3, C1): one transaction per pick
			// makes the unlinked copy in the session's notes and seats the
			// caller on it by member. After the lists above, so their diffs never
			// see the copy.
			const sharedSeats = dedupedSharedCardSeats(params)
			if (sharedSeats.length) {
				const sessionId = params.session.id!
				for (const entry of sharedSeats) {
					const changes = await db.transaction(async (tx) => {
						const t = tx as unknown as Db
						const copy = await copySharedCard(t, {
							sessionId,
							cardId: entry.characterId,
							userId
						})
						if (entry.kind === "character") {
							const cs = schema.sessionCharacters
							const live = await t
								.select({ position: cs.position })
								.from(cs)
								.where(
									and(
										eq(cs.sessionId, sessionId),
										isNull(cs.removedAt),
										isNull(cs.envoySlug),
										or(isNotNull(cs.characterId), isNotNull(cs.castMemberId))
									)
								)
							const seat = await seatCast(t, {
								sessionId,
								castMemberId: copy.castMemberId,
								position:
									Math.max(-1, ...live.map((r) => r.position ?? 0)) + 1,
								seatedBy: userId
							})
							if (!seat.ok) throw new Error(seat.refusal)
							return seat.changes
						}
						const sp = schema.sessionPersonas
						const held = await t
							.select({ position: sp.position })
							.from(sp)
							.where(eq(sp.sessionId, sessionId))
						const seat = await seatPlayer(t, {
							sessionId,
							personaId: null,
							castMemberId: copy.castMemberId,
							userId,
							seatName: copy.name,
							position:
								Math.max(-1, ...held.map((r) => r.position ?? 0)) + 1
						})
						return seat.changes
					})
					seatChanges.push(...changes)
				}
				if (sharedSeats.some((e) => e.kind === "character")) {
					const cs = schema.sessionCharacters
					const [live] = await db
						.select({ n: sql<number>`count(*)::int` })
						.from(cs)
						.where(
							and(
								eq(cs.sessionId, sessionId),
								isNull(cs.removedAt),
								isNull(cs.envoySlug),
								or(isNotNull(cs.characterId), isNotNull(cs.castMemberId))
							)
						)
					await db
						.update(schema.sessions)
						.set({ isGroup: (live?.n ?? 0) > 1 })
						.where(eq(schema.sessions.id, sessionId))
				}
			}

			// The member events (24 §5), best-effort and after every seat
			// write: a failed dispatch must never fail the update that caused it.
			await announceSeatChanges(
				db,
				socket.io,
				{ sessionId: params.session.id!, userId },
				seatChanges
			)

			// A reorder is not a membership change, so never a member event.
			if (membersBefore) {
				try {
					const after = await memberSnapshot()
					// A seat that MOVED (PLAN-turn-order §4.1): one
					// `cast-changed { change: 'position' }` per member still
					// seated whose position differs — a reorder, not a
					// membership change, so never a member event.
					const moved = [...after.positions].filter(
						([ref, position]) =>
							membersBefore.positions.has(ref) &&
							membersBefore.positions.get(ref) !== position
					)
					if (moved.length) {
						const { emitSessionEvent } = await import(
							"$lib/server/pipelines/runtime/sessionEvents"
						)
						for (const [ref, position] of moved)
							await emitSessionEvent(db, {
								sessionId: params.session.id!,
								userId,
								event: sessionEvents.castChanged,
								payload: {
									sessionId: params.session.id!,
									ref,
									change: "position",
									value: position,
									cause: { kind: "settings", userId }
								},
								io: socket.io
							})
					}
				} catch (err) {
					console.warn("member-event dispatch failed:", err)
				}
			}

			// 🚧 Branched after every write of the save, so the branch carries all of it.
			if (clockBranchTo !== undefined) {
				const { moveClockBackOnBranch } = await import("$lib/server/sessions/clockMoveBack")
				const branched = await moveClockBackOnBranch(db, {
					sessionId: params.session.id!,
					userId,
					to: clockBranchTo,
					io: socket.io
				})
				// The save's other edits are already stored: the refusal says so.
				if (!branched.ok)
					throw new Error(
						`Your other changes were saved, but the story clock was not moved. ${branched.error}`
					)
				clockBranchId = branched.sessionId
			}

			// Fetch updated session
			// No rows: this reply's readers take the session's fields, never its transcript.
			const updatedSession = await getSessionFromDB(
				params.session.id!,
				userId,
				"none"
			)
			if (!updatedSession) {
				throw new Error("Failed to fetch updated session")
			}

			const res: Sockets.Sessions.Update.Response = {
				session: updatedSession as any,
				...(clockBranchId !== undefined ? { branchedTo: clockBranchId } : {})
			}
			emitToUser("sessions:update", res)
			// A seat named, renamed or removed is every member's news, not
			// the caller's alone: the persona list with its `seatName` goes
			// to each member's page, as an added persona's does.
			if (
				params.seatName !== undefined ||
				params.playerSeatChanges?.length ||
				params.sharedCardSeats?.length ||
				params.playerSeatsFor?.length ||
				params.seatMoves?.length ||
				switchesWritten ||
				handedOver
			)
				await broadcastSessionToParticipants(socket, params.session.id!, userId)
			// Refresh session list, behind the reply that carries the session.
			if (clockBranchId !== undefined) await relistWithRow(socket, emitToUser, clockBranchId)
			else await relistSessions(socket, emitToUser)
			// 🚧 A lorebook attached or dropped: each book's "Read by" moved.
			if (params.session.lorebookId !== undefined) {
				const { relistLorebooks } = await import("./lorebooks")
				relistLorebooks(socket, emitToUser)
			}
			// The published values moved (U5e, review W-A5) — a genre field a
			// predicate reads, or the cast whose state `state.cast.<key>`
			// predicates read — so every member's action list follows.
			if (fieldsMoved || membersBefore || handedOver || params.seatMoves?.length) {
				const { pushSessionActions } = await import(
					"$lib/server/sessions/actionsPush"
				)
				await pushSessionActions(socket.io, params.session.id!)
			}

			// Flow 1: the cast this session reads into its book. Awaited, not
			// fired and forgotten: several paths reach this now, and a promise
			// left running past its own request can interleave with the next
			// one. Errors stay non-fatal — a book that cannot be written must
			// not fail the session update that named it.
			const lorebookId = (updatedSession as any).lorebookId
			if (lorebookId) {
				await runLorebookBindingCheck(
					socket,
					params.session.id!,
					lorebookId,
					emitToUser
				).catch(console.error)
			}

			return res
		} catch (error: any) {
			console.error("Error updating session:", error)
			throw error
		}
	},
	"The session could not be saved."
)
