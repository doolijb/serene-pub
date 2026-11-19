/** Creating a session: `sessions:create`. */

import { storedSwapsOf, type StoredSwapContribution } from "$lib/shared/swaps"
import { isNewAttachOfDisabledBook } from "$lib/server/plugins/providedMarks"
import { sessionEvents, getGenre } from "@serene-pub/sdk"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, inArray } from "drizzle-orm"
import { markCharacterAsPersona } from "$lib/server/utils/markCharacterAsPersona"
import {
	SEAT_REFUSALS,
	sameMemberRefusal,
	seatCast,
	seatPlayer,
	settleSeats,
	syncMintedSeatMembers,
	type MintedSeatMember
} from "$lib/server/sessions/seats"
import type { Handler } from "$lib/shared/events"
import { timelineDefaultFor, timelineRequiredFor } from "$lib/server/lorebooks/timeline"
import {
	checkCharactersOwnership,
	checkPersonasOwnership,
	checkLorebookOwnership,
	processSessionTags,
	relistWithRow,
	getSessionFromDB,
	runLorebookBindingCheck,
	sessionLinePatch,
	clockFromColumns
} from "./sessions.shared"

/** At most this many swaps are seeded at create — one per node, and nodes are few (M2 review). */
const MAX_SEEDED_SWAPS = 32

/** The create transaction's refusal (no date to begin on, or a starter copy's cast the genre's shape does not fit). Thrown to roll back, returned as `refuse`. */
class CreateRefusal extends Error {}

export const sessionsCreateHandler: Handler<
	Sockets.Sessions.Create.Params,
	Sockets.Sessions.Create.Response
> = {
	event: "sessions:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		// 🚧 (M2c) Opened by an extension's launcher: its grant, its genre and its
		// prefilled fields are judged first, in words. Absent: exactly today.
		if (params.fromApplet) {
			const { appletCreateRefusal } = await import("./appletSessions")
			const refusal = await appletCreateRefusal(db as unknown as Db, userId, params)
			if (refusal) {
				emitToUser("sessions:create:error", { error: refusal })
				return { error: refusal }
			}
		}
		// 🚧 Creation mode (M0, F5): how it starts; absent is `new`. The
		// genre may propose one in the form; the server never refuses a mode
		// because another was proposed.
		const creationMode = params.mode ?? "new"
		const creationModes = await import("$lib/server/sessions/creationModes")
		{
			const refusal = await creationModes.creationModeRefusal(db as unknown as Db, {
				mode: creationMode,
				from: params.from,
				userId
			})
			if (refusal) {
				emitToUser("sessions:create:error", { error: refusal })
				return { error: refusal }
			}
		}
		if (creationMode === "branch") {
			// Forked at the newest live message through what `sessions:branch`
			// runs; the draft's other fields are ignored.
			const forked = await creationModes.branchForCreate(db as unknown as Db, {
				from: params.from!,
				userId,
				io: socket.io
			})
			if ("error" in forked) {
				emitToUser("sessions:create:error", { error: forked.error })
				return { error: forked.error }
			}
			const branchedSession = await getSessionFromDB(forked.sessionId, userId)
			if (!branchedSession) throw new Error("Failed to fetch branched session")
			await relistWithRow(socket, emitToUser, forked.sessionId)
			const branchRes: Sockets.Sessions.Create.Response = { session: branchedSession as any }
			emitToUser("sessions:create", branchRes)
			return branchRes
		}
		// The lorebook the followed session reads: a next chapter keeps it, as a branch does.
		let followedLorebookId: number | null = null
		if (creationMode === "next-chapter") {
			// The successor reads the same book and line as the session it follows.
			const [followed] = await db
				.select({
					lorebookId: schema.sessions.lorebookId,
					lorebookBranchId: schema.sessions.lorebookBranchId,
					archivedAt: schema.sessions.archivedAt
				})
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.from!))
				.limit(1)
			// 🚧 A session with no book attached keeps its world in its own
			// book (RF fix 2: every session has a world). Its next chapter
			// follows that world: the notes are shared as a lorebook first —
			// what "Share as a lorebook" does by hand — so the old session
			// reads it and the new one attaches it like any other.
			let lorebookId = followed?.lorebookId ?? null
			followedLorebookId = followed?.lorebookId ?? null
			if (followed && lorebookId == null) {
				const { shareAsLorebook } = await import("$lib/server/lorebooks/ownBook")
				lorebookId = (
					await shareAsLorebook(db as unknown as Db, { sessionId: params.from!, userId })
				).lorebookId
			}
			// The chapter starts where the followed session's story stands
			// (★C2). A session that follows its line is followed by one that
			// follows it too, so only a clock of its own is carried.
			const { sessionStoryNowOf } = await import("$lib/server/state/storyTime")
			const now = followed ? await sessionStoryNowOf(db, params.from!) : null
			const carriedClock =
				now?.from === "session"
					? {
							storyClockYear: now.year,
							storyClockMonth: now.month ?? null,
							storyClockDay: now.day ?? null,
							storyClockHour: now.hour ?? null,
							storyClockMinute: now.minute ?? null
						}
					: {}
			params = {
				...params,
				session: {
					...params.session,
					lorebookId,
					lorebookBranchId: followed?.lorebookBranchId ?? null,
					...carriedClock
				}
			}
		}
		const tags = params.tags || []
		const personaIds = params.personaIds || []
		const characterIds = params.characterIds || []
		// 🚧 Card-less members to seat (plan §34.2), checked against the book below.
		const castMemberIds = [...new Set(params.castMemberIds || [])]
		const characterPositions = params.characterPositions || {}

		// A new session has no existing characters/personas to diff against — every
		// id supplied here must belong to the requesting user.
		if (characterIds.length > 0) {
			const ownedCharacterIds = await checkCharactersOwnership(
				characterIds,
				userId
			)
			if (ownedCharacterIds.size !== characterIds.length) {
				throw new Error(
					"Access denied. You can only add characters you own."
				)
			}
		}
		if (personaIds.length > 0) {
			const ownedPersonaIds = await checkPersonasOwnership(
				personaIds,
				userId
			)
			if (ownedPersonaIds.size !== personaIds.length) {
				throw new Error(
					"Access denied. You can only add personas you own."
				)
			}
		}
		// 🚧 A starter lorebook offered as the lorebook is answered in words below
		// (`kitReadRefusal`), before this access check could say less.
		const { kitReadRefusal, kitRefOf, resolveKit, STARTER_KIT_SENTENCES } =
			await import("$lib/server/lorebooks/starterKits")
		const keepsFollowedBook =
			creationMode === "next-chapter" &&
			followedLorebookId != null &&
			params.session.lorebookId === followedLorebookId
		const kitAsBook =
			params.session.lorebookId != null && !keepsFollowedBook
				? await kitReadRefusal(db as unknown as Db, params.session.lorebookId)
				: null
		if (params.session.lorebookId != null && !kitAsBook && creationMode === "new-world") {
			// A world to copy need only be readable: owner or share recipient.
			const { assertReadableBook, LOREBOOK_NOT_FOUND } = await import("$lib/server/utils/ownedBook")
			await assertReadableBook(db as unknown as Db, userId, params.session.lorebookId, {
				isAdmin: false
			})
			if (await isNewAttachOfDisabledBook(db as unknown as Db, params.session.lorebookId)) throw new Error(LOREBOOK_NOT_FOUND)
		} else if (params.session.lorebookId != null && !kitAsBook) {
			const ownsLorebook = await checkLorebookOwnership(
				params.session.lorebookId,
				userId,
				keepsFollowedBook ? params.from : undefined
			)
			if (!ownsLorebook) {
				throw new Error(
					"Access denied. You can only read a lorebook you own into a session."
				)
			}
		}

		/**
		 * A refusal the person can act on — a preset or genre an
		 * administrator has hidden, the genre's shape not met, a genre this
		 * build does not register. Emitted as this handler's specific error
		 * and returned, never thrown: the catch-all in `sockets/index.ts`
		 * replaces a thrown message with a constant on purpose, and the
		 * sentence is the one thing the start screen has to show. Same form
		 * as the `sessions:fireTurn` refusals below. The ownership
		 * checks above stay throws: those are access denials, not choices.
		 */
		const refuse = (error: string): Sockets.Sessions.Create.Response => {
			emitToUser("sessions:create:error", { error })
			return { error }
		}

		// 🚧 Starting from a starter lorebook (PLAN-lorebook-kinds ruling 8): the
		// kit is found now, and copied into the session's notes once the
		// session row exists. A kit is started from, never read as the book.
		if (kitAsBook) return refuse(kitAsBook)
		// 🚧 A surfaced book is read directly by its owner (owner 2026-11-09, "Own:
		// start on; shared: copy"), its session's branches and next chapters;
		// any other start copies it (★B-3).
		if (params.session.lorebookId != null) {
			const { surfacedBookRefusal } = await import("$lib/server/lorebooks/ownBook")
			const surfaced = await surfacedBookRefusal(db as unknown as Db, {
				lorebookId: params.session.lorebookId,
				creationMode,
				userId
			})
			if (surfaced) return refuse(surfaced)
		}
		if (params.starterKit != null && params.session.lorebookId != null)
			return refuse(STARTER_KIT_SENTENCES.kitAndBook)
		if (creationMode === "new-world" && params.starterKit == null && params.session.lorebookId == null)
			return refuse("Choose the world to copy.")
		let startKit: import("$lib/server/lorebooks/starterKits").ResolvedKit | null = null
		if (params.starterKit != null) {
			try {
				startKit = await resolveKit(db as unknown as Db, kitRefOf(params.starterKit))
			} catch (e) {
				return refuse((e as Error).message)
			}
		}

		// Preset resolution (23 §9): when the client starts from a preset, the
		// preset picks the type — the server derives genreId from it (never
		// trusting a client-supplied pair to agree) and refuses presets or
		// types an admin has hidden. An absent settings row means available:
		// types are visible until someone hides them, same as sessionAdmin.
		/** The preset's pre-seated envoys (`defaults.envoys`, R-18), by slug. */
		/** 🚧 A preset may lower the shape's cast floor (`PresetDecl.cast`, 2026-10-19). */
		let presetCastFloor: { characters?: number; personas?: number } | null = null
		/** 🚧 The preset's pinned settings; `rigour` among them is a column, written here. */
		let presetPins: Record<string, unknown> | null = null
		let presetEnvoys: string[] = []
		/** The preset's seeded swaps (`defaults.swaps`, R40). */
		let presetSwaps: StoredSwapContribution[] = []
		/** 🚧 The preset's `defaults`, for the new notes' Timeline default (`timelineDefaultFor`); null with no preset. */
		let presetDefaults: unknown = null
		{
			const presetId = (params.session as any).presetId ?? null
			if (presetId != null) {
				const [preset] = await db
					.select()
					.from(schema.sessionPresets)
					.where(eq(schema.sessionPresets.id, presetId))
					.limit(1)
				// Withdrawn beside disabled (0119): a preset whose plugin is
				// gone cannot start a new session either. `enabled` does not
				// cover it — that flag is the administrator's decision and
				// survives a withdrawal on purpose — so reading it alone
				// accepts a preset the picker has already dropped. Sessions
				// already on one keep resolving it; only creation refuses.
				if (!preset || !preset.enabled || preset.withdrawnAt != null)
					return refuse("That session preset is not available.")
				presetCastFloor = (preset.castFloor as { characters?: number; personas?: number } | null) ?? null
				// 🚧 A pin's value, read through `SettingValue` (A10).
				presetPins = preset.settings
					? (await import("$lib/server/pipelines/entities/sessionGenres")).presetPinValues(preset.settings)
					: null
				// A disabled plugin's preset starts nothing (R67).
				{
					const { disabledPlugins } = await import(
						"$lib/server/plugins/disabledPlugins"
					)
					if ((await disabledPlugins(db)).owns(preset.ownerPluginId))
						return refuse("That session preset is not available.")
				}
				const [typeSetting] = await db
					.select()
					.from(schema.sessionGenreSettings)
					.where(
						eq(schema.sessionGenreSettings.genreId, preset.genreId)
					)
					.limit(1)
				if (typeSetting && !typeSetting.enabled)
					return refuse("That session type is not available.")
				;(params.session as any).genreId = preset.genreId
				const seats = (preset.defaults as { envoys?: unknown } | null)
					?.envoys
				if (Array.isArray(seats))
					presetEnvoys = seats.filter(
						(v): v is string => typeof v === "string"
					)
				presetSwaps = storedSwapsOf(
					(preset.defaults as { swaps?: unknown } | null)?.swaps
				)
				presetDefaults = preset.defaults
			}
		}

		// Creation validates against the mode's declared shape (19 §6). The
		// default mode is the F29 floor, whose shape states today's behaviour
		// exactly — so every current creation passes trivially, and the seam
		// is live for the day a picker offers a mode with real constraints.
		let declaredFieldKeys: string[] = []
		/** The genre's name, for a refusal below. */
		let genreName: string | null = null
		/**
		 * 🚧 (M3b, owner 2026-11-05 ★M3-4) The genre's `castFromLorebook`
		 * declaration, its floored shape and its declared fields: what the
		 * book-seats-its-cast step below reads. Null when the genre declares none.
		 */
		let castFromLorebook: { field?: string } | null = null
		let flooredShape: Parameters<
			(typeof import("$lib/server/pipelines/entities/sessionGenres"))["shapeViolations"]
		>[0] | null = null
		let declaredShapeFields: Record<string, { default?: unknown }> = {}
		/**
		 * 🚧 What the session is born with through the exposure cascade (R32,
		 * A10): the genre fields the person may set (a locked one is taken
		 * from its layer, whatever was sent) and the rules it plays — its
		 * ruleset and rigour, fixed at start: the person's answer where open
		 * to them, else the cascade's (Rule Based locks rigour at `scripts`).
		 */
		let atStart: Awaited<ReturnType<typeof import("$lib/server/sessions/exposure").resolveAtStart>> | null = null
		{
			const { getSessionGenre, shapeViolations, STANDARD_GENRE_ID } =
				await import("$lib/server/pipelines/entities/sessionGenres")
			const genreId = (params.session as any).genreId ?? STANDARD_GENRE_ID
			const mode = await getSessionGenre(db, genreId)
			// The F29 spirit: the standard mode is the floor, available even
			// when the type registry never synced (a bootstrap conflict
			// disables pipelines, never sessions — DECOMPOSITION §19). Only a
			// *non-standard* mode this build does not register refuses.
			if (!mode && genreId !== STANDARD_GENRE_ID)
				return refuse(
					`'${genreId}' is not a session mode this build registers.`
				)
			// A disabled plugin's genre starts no new session (R67); the
			// sessions already on it keep running.
			if (mode && genreId !== STANDARD_GENRE_ID) {
				const { listOfferedGenres } = await import(
					"$lib/server/pipelines/entities/sessionGenres"
				)
				if (!(await listOfferedGenres(db)).some((g) => g.genreId === genreId))
					return refuse("That session type is not available.")
			}
			if (mode) {
				const floored = presetCastFloor
					? {
						...mode.shape,
						...(mode.shape.characters && presetCastFloor.characters !== undefined
							? { characters: { ...mode.shape.characters, min: Math.min(mode.shape.characters.min, presetCastFloor.characters) } }
						: {}),
						...(mode.shape.personas && presetCastFloor.personas !== undefined
							? { personas: { ...mode.shape.personas, min: Math.min(mode.shape.personas.min, presetCastFloor.personas) } }
						: {})
					}
					: mode.shape
				const violations = shapeViolations(floored, {
					characters: characterIds.length + castMemberIds.length,
					personas: personaIds.length,
					// A starter lorebook gives the session a world of its own (its notes).
					hasLorebook: params.session.lorebookId != null || startKit != null
				})
				if (violations.length)
					return refuse(
						`This session does not fit '${mode.name}': ${violations.join("; ")}.`
					)
				declaredFieldKeys = Object.keys(
					(mode.shape as any)?.fields ?? {}
				)
				genreName = mode.name
				castFromLorebook =
					(mode.shape as { castFromLorebook?: { field?: string } }).castFromLorebook ?? null
				flooredShape = floored
				declaredShapeFields = ((mode.shape as any)?.fields ?? {}) as Record<
					string,
					{ default?: unknown }
				>
			}
			try {
				const { resolveAtStart } = await import("$lib/server/sessions/exposure")
				const sent = params.session as any
				atStart = await resolveAtStart(db, {
					genreId,
					declared: ((mode?.shape as any)?.fields ?? {}) as Record<string, any>,
					pins: mode?.settings,
					presetId: sent.presetId ?? null,
					asked: {
						...((sent.genreFields ?? {}) as Record<string, unknown>),
						...(typeof sent.primaryRuleset === "string" && sent.primaryRuleset.trim()
							? { ruleset: sent.primaryRuleset.trim() }
							: {}),
						...(typeof sent.rigour === "string" && sent.rigour ? { rigour: sent.rigour } : {})
					},
					isAdmin: !!socket.user!.isAdmin
				})
			} catch (err) {
				console.warn("[sessions:create] the start cascade could not be read; taking what was sent:", err)
			}
		}

		// Remove tags from session data as it will be handled separately
		//
		// ⚠ `connectionId` is destructured off and dropped, for EVERYONE (0130).
		// A session names no connection — overrides are by model, and the only
		// connection override is the pipeline configuration's connection slot —
		// so there is nowhere for this field to land, not even for an
		// administrator. An old client may still send it: the insert below is
		// a bare spread of the client's `params.session`.
		//
		// Dropped by name rather than left to drizzle, which ignores a key that
		// is not a column but is not the thing making the promise here. Dropped
		// in silence, too: the field is not a column, so writing it escalates
		// nothing, and a security refusal would name a boundary that has
		// nothing behind it.
		const {
			connectionId: _retiredSessionConnectionId,
			// Retired by R40 (2026-09-23): an old client's one-node strategy
			// field, dropped in silence like the connection above.
			speakerStrategy: _retiredSpeakerStrategy,
			// Not a column: a session's sampling pick is its pipeline panel
			// row (Pipelines card › Sampling), so an old client's field is
			// dropped in silence like the two above.
			samplingConfigId: _retiredSessionSampling,
			// Not a column: the session's rebinds of swappable nodes (R40),
			// written once the row exists (below).
			swaps: requestedSwaps,
			// Where the session reads its book is the server's to start
			// (ruling 15, story-time P3): the book's most recently used line,
			// no clock of its own (it follows that line's present) — or what
			// the create names, checked (`sessionLinePatch`).
			lorebookBranchId: requestedBranchId,
			// Branching off at the start: checked below, written only for an own book.
			lineOnFirstWrite: requestedLineOnFirstWrite,
			storyClockYear: requestedClockYear,
			storyClockMonth: requestedClockMonth,
			storyClockDay: requestedClockDay,
			storyClockHour: requestedClockHour,
			storyClockMinute: requestedClockMinute,
			...sessionDataWithoutTags
		} = params.session as Omit<InsertSession, "userId" | "isGroup"> & {
			connectionId?: number | null
			speakerStrategy?: string
			samplingConfigId?: number | null
			swaps?: unknown
		}
		// 🚧 `lineOnFirstWrite` (branch off at a point): only a start on a book of
		// the asker's own, read directly. The owner is read here, before the transaction.
		let startLineOnFirstWrite = false
		if (requestedLineOnFirstWrite === true) {
			let ownDirectBook = false
			if (
				creationMode === "new" &&
				startKit == null &&
				sessionDataWithoutTags.lorebookId != null
			) {
				const [book] = await db
					.select({ userId: schema.lorebooks.userId })
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, sessionDataWithoutTags.lorebookId))
					.limit(1)
				ownDirectBook = book?.userId === userId
			}
			if (!ownDirectBook)
				return refuse(
					"Only a lorebook of your own can be branched off at the start. Choose one of yours, or start on its latest line."
				)
			startLineOnFirstWrite = true
		}
		// Field values only under names the mode declares (19 §1) — the same
		// filter runTurn applies at supply, applied at write so the row never
		// carries keys nothing declared.
		;(sessionDataWithoutTags as any).genreFields = Object.fromEntries(
			Object.entries(
				(atStart?.fields ?? (params.session as any).genreFields ?? {}) as Record<
					string,
					unknown
				>
			).filter(([k]) => declaredFieldKeys.includes(k))
		)
		// 🚧 (M3b, owner 2026-11-05 ★M3-4) The book seats its cast, genre-declared:
		// only a genre that declares `castFromLorebook` (its switch field true, or
		// no field). The attached book, else the starter copy.
		let castSeatsOn = false
		if (castFromLorebook && flooredShape) {
			const field = castFromLorebook.field
			const stored = field
				? ((sessionDataWithoutTags as any).genreFields as Record<string, unknown>)[field]
				: true
			castSeatsOn = field ? (stored !== undefined ? stored : declaredShapeFields[field]?.default) === true : true
		}
		// The attached book is read here, outside the create transaction.
		let seatedCast: { castMemberId: number; cardId: number | null }[] = []
		if (castSeatsOn && flooredShape && sessionDataWithoutTags.lorebookId != null) {
			const { bookCastToSeat } = await import("$lib/server/sessions/seatBookCast")
			seatedCast = await bookCastToSeat(db as unknown as Db, {
				lorebookId: sessionDataWithoutTags.lorebookId,
				userId,
				isAdmin: !!socket.user!.isAdmin,
				exclude: new Set([...characterIds, ...personaIds]),
				excludeMembers: new Set(castMemberIds)
			})
			if (seatedCast.length) {
				const { shapeViolations } = await import(
					"$lib/server/pipelines/entities/sessionGenres"
				)
				const violations = shapeViolations(flooredShape, {
					characters:
						characterIds.length + castMemberIds.length + seatedCast.length,
					personas: personaIds.length,
					hasLorebook: true
				})
				if (violations.length)
					return refuse(
						`This session does not fit '${genreName}': ${violations.join("; ")}.`
					)
			}
		}
		// 🚧 One cast member is one character seat (owner 2026-11-05): two of the
		// picked cards that are one member of the book the session will read are
		// refused in words, before anything is made.
		const kitBookId = startKit?.source === "book" ? startKit.row.id : null
		{
			const twice = await sameMemberRefusal(db as unknown as Db, {
				lorebookId: kitBookId ?? sessionDataWithoutTags.lorebookId ?? null,
				cardIds: characterIds,
				castMemberIds
			})
			if (twice) return refuse(twice)
		}
		// 🚧 The listed members (plan §34.2) must be members of the book the session
		// will read — not overlay rows. A starter lorebook's members are copied into
		// the notes and mapped there. `new-world` reads a copy of the chosen book,
		// whose members have ids of their own, so none listed here is in it.
		if (castMemberIds.length) {
			const book =
				kitBookId ??
				(creationMode === "new-world"
					? null
					: (sessionDataWithoutTags.lorebookId ?? null))
			const rows = await db
				.select({
					id: schema.lorebookBindings.id,
					lorebookId: schema.lorebookBindings.lorebookId,
					overlayOf: schema.lorebookBindings.overlayOf,
					name: schema.lorebookBindings.name
				})
				.from(schema.lorebookBindings)
				.where(inArray(schema.lorebookBindings.id, castMemberIds))
			const { membersAsRead } = await import("$lib/server/cast/memberAsRead")
			const nameOf = async (id: number, fallback: string) =>
				(await membersAsRead(db as unknown as Db, [id], {})).get(id)?.shownName?.trim() ||
				fallback.trim() ||
				"That person"
			for (const id of castMemberIds) {
				const row = rows.find((r) => r.id === id)
				if (!row) return refuse(SEAT_REFUSALS.memberGone())
				if (row.overlayOf != null)
					return refuse(SEAT_REFUSALS.overlayRow(await nameOf(row.overlayOf, row.name)))
				if (book == null || row.lorebookId !== book)
					return refuse(SEAT_REFUSALS.outsideBooks(await nameOf(row.id, row.name)))
			}
		}
		// 🚧 Speech: the narrator voice is checked at every write, not only
		// through the settings form (lane V finding V-3, 2026-10-28).
		{
			const { SPEECH_FIELD_KEYS } = await import("$lib/shared/sessions/speechSettings")
			const voice = ((sessionDataWithoutTags as any).genreFields as Record<string, unknown>)[
				SPEECH_FIELD_KEYS.narratorVoice
			]
			if (voice !== undefined) {
				const { narratorVoiceRefusal } = await import("$lib/server/speech/narratorVoiceCheck")
				const refusal = await narratorVoiceRefusal(db, voice)
				if (refusal) throw new Error(refusal)
			}
		}

		// 🚧 Rulesets (PLAN-rulesets §4, §13, §21, §28): a session attached to
		// a lorebook at creation ADOPTS its ruleset and version, whatever the client sent — refused, with the reason, when the
		// genre plays only rulesets (`rulesets.only`) the lorebook's is not
		// among. With no lorebook: the client's pick when it is a registered
		// ruleset the genre allows, else the genre's default (only's first,
		// recommended's `default`), else Story. How strict: the client's pick
		// among the genre's rigour options, else the genre's default (absent,
		// `prose`). On revision: a valid value, else the owner's default, else
		// the instance's.
		{
			const data = sessionDataWithoutTags as any
			const { getGenre, getRuleset } = await import("@serene-pub/sdk")
			const { STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			const rulesGenreId: string = (params.session as any).genreId ?? STANDARD_GENRE_ID
			const genre = getGenre(rulesGenreId)
			const declared = genre?.rulesets
			const strict = declared && "only" in declared ? declared.only : null
			const genreDefault = declared
				? "only" in declared
					? declared.only[0]
					: declared.default
				: undefined
			// 🚧 A book's (or a kit's) own rules are adopted; one on Freeform,
			// every book's default, brings none, and the session's own Rules
			// stand below (fix7, 2026-10-23; `adoptedBookRules`).
			const { adoptedBookRules } = await import("$lib/shared/rulesets/rulesOffer")
			const { strictRulesRefusal, rulesetIncompatibleRefusal } = await import(
				"$lib/server/rulesets/bookRules"
			)
			let adopted = false
			if (startKit) {
				// The kit's Rules, held to the genre's as a book's are.
				const { kitRules } = await import("$lib/server/lorebooks/starterKits")
				const rules = kitRules(startKit)
				if (adoptedBookRules(rules.primaryRuleset)) {
					// 🚧 `only`, then Incompatible rules (owner 2026-11-05); a next chapter is never re-judged.
					const kitRefusal = strictRulesRefusal(
						rulesGenreId,
						{ name: startKit.name, primaryRuleset: rules.primaryRuleset },
						{ starter: true, nextChapter: creationMode === "next-chapter" }
					)
					if (kitRefusal) return refuse(kitRefusal)
					data.primaryRuleset = rules.primaryRuleset
					data.rulesetVersion = rules.rulesetVersion
					adopted = true
				}
			} else if (data.lorebookId != null) {
				const [book] = await db
					.select({
						name: schema.lorebooks.name,
						primaryRuleset: schema.lorebooks.primaryRuleset,
						rulesetVersion: schema.lorebooks.rulesetVersion
					})
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, data.lorebookId))
					.limit(1)
				if (book && adoptedBookRules(book.primaryRuleset)) {
					const bookRefusal = strictRulesRefusal(rulesGenreId, book, {
						nextChapter: creationMode === "next-chapter"
					})
					if (bookRefusal) return refuse(bookRefusal)
					data.primaryRuleset = book.primaryRuleset
					data.rulesetVersion = book.rulesetVersion
					adopted = true
				}
			}
			if (!adopted) {
				// 🚧 A preset's ruleset is a default, never a lock (owner 2026-11-05, R32
				// amended for rulesets): the person's pick wins; Incompatible rules are
				// refused (never swapped), except for a next chapter.
				const validRuleset = (id: string) =>
					!!getRuleset(id) && (!strict || strict.includes(id))
				const picked =
					typeof data.primaryRuleset === "string" && validRuleset(data.primaryRuleset.trim())
						? data.primaryRuleset.trim()
						: null
				if (picked && creationMode !== "next-chapter") {
					const incompatible = rulesetIncompatibleRefusal(rulesGenreId, picked)
					if (incompatible) return refuse(incompatible)
				}
				// Nothing valid sent: the cascade's value (the preset's, even one stored with
				// `lock`) unless the genre can't play it, which falls through silently.
				const cascaded =
					typeof atStart?.rules.ruleset === "string" &&
					validRuleset(atStart.rules.ruleset) &&
					!rulesetIncompatibleRefusal(rulesGenreId, atStart.rules.ruleset)
						? atStart.rules.ruleset
						: null
				data.primaryRuleset = picked ?? cascaded ?? genreDefault ?? "core:ruleset/freeform@1"
			}
			// 🚧 Pinned to the version it starts on when nothing adopted pins one (a genre's or preset's pick, or a book
			// that carries none): a pub or package ruleset's published version, so "Update rules" and a conversion work
			// (M0 E-fix). A ruleset declared in code has no version and stays unpinned.
			if (data.rulesetVersion == null && typeof data.primaryRuleset === "string") {
				const { publishedRulesetVersion } = await import("$lib/server/rulesets/pubRulesets")
				data.rulesetVersion = await publishedRulesetVersion(db, data.primaryRuleset)
			}
			const rigourOptions: readonly string[] = genre?.rigour?.options ?? ["prose"]
			// 🚧 R32: rigour is fixed at start, through the cascade — the
			// person's pick where it is open to them, a layer's where one
			// locked it (Rule Based locks `scripts`), else the preset's or the
			// genre's value.
			if (atStart && typeof atStart.rules.rigour === "string") data.rigour = atStart.rules.rigour
			else if (typeof presetPins?.rigour === "string" && (data.rigour == null || data.rigour === "") && rigourOptions.includes(presetPins.rigour))
				data.rigour = presetPins.rigour
			if (!rigourOptions.includes(data.rigour))
				data.rigour = genre?.rigour?.default ?? "prose"
			// 🚧 Rules that decide nothing (Story) play Words only (2026-10-18,
			// the 100-turn walk #26): the form offers nothing else, and a
			// request that names another How strict is answered with it.
			{
				const { rigoursPlayed } = await import("$lib/shared/rulesets/rulesOffer")
				const { rulesetDecides } = await import("$lib/server/rulesets/methods")
				const played = rigoursPlayed(rulesetDecides(getRuleset(String(data.primaryRuleset ?? ""))), rigourOptions)
				if (played && !played.includes(data.rigour)) data.rigour = played[0]!
			}
			const { isOnRevision, onRevisionDefaultFor } = await import(
				"$lib/server/sessions/revision"
			)
			if (!isOnRevision(data.onRevision))
				data.onRevision = await onRevisionDefaultFor(db, userId)
		}

		// The clock is checked and the row written in one transaction, under
		// the book's calendar lock (`sessionLinePatch`).
		let kitCopy: Awaited<
			ReturnType<(typeof import("$lib/server/lorebooks/starterKits"))["bookFromKit"]>
		> | null = null
		const { insertOwnBook } = await import("$lib/server/lorebooks/ownBook")
		// 🚧 `next-chapter`: the session it follows is closed out first, unless
		// archived. Nothing to close out is not a refusal; any other is.
		if (creationMode === "next-chapter") {
			const [followed] = await db
				.select({ archivedAt: schema.sessions.archivedAt })
				.from(schema.sessions)
				.where(eq(schema.sessions.id, params.from!))
				.limit(1)
			if (!followed?.archivedAt) {
				const { closeOutSession } = await import("./sessionArchive")
				const { CLOSE_OUT_REFUSALS } = await import("$lib/shared/sessions/archive")
				const closed = await closeOutSession({ sessionId: params.from!, userId, emitToUser })
				if ("refused" in closed && closed.refused !== CLOSE_OUT_REFUSALS.nothing)
					return refuse(closed.refused)
			}
		}
		// 🚧 `notesTimeline`: the start form's switch for whether the session's own NEW
		// notes keep a timeline. Honoured only when it gets own new notes (no kit, no
		// lorebook); a genre that requires one (or does not resolve) wins silently, as a
		// locked How strict does. With them resolved off, a named clock is dropped: a
		// date is never written with story time off.
		const ownNewNotes = !startKit && params.session.lorebookId == null
		const { STANDARD_GENRE_ID: notesDefaultGenreId } = await import("$lib/server/pipelines/entities/sessionGenres")
		const notesGenre = getGenre(String((params.session as any).genreId ?? notesDefaultGenreId))
		const notesTimeline = !ownNewNotes
			? null
			: timelineRequiredFor(notesGenre)
				? true
				: typeof params.notesTimeline === "boolean"
					? params.notesTimeline
					: timelineDefaultFor(notesGenre, { defaults: presetDefaults })
		const namedClockYear = notesTimeline === false ? undefined : requestedClockYear
		const made = await db.transaction(async (tx) => {
			// 🚧 `new-world`: the session starts on a COPY of the world it chose
			// (named "<source name> (copy)"), never on the source itself. The
			// copy has lines of its own, so the draft's line is not carried.
			let worldId = sessionDataWithoutTags.lorebookId ?? null
			let worldBranchId = requestedBranchId
			if (creationMode === "new-world" && worldId != null) {
				const { duplicateLorebookRows } = await import("$lib/server/utils/lorebookDuplicate")
				const [source] = await tx
					.select({ name: schema.lorebooks.name })
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, worldId))
					.limit(1)
				const copy = await duplicateLorebookRows(tx, worldId, userId, `${source?.name ?? "World"} (copy)`)
				worldId = copy.id
				worldBranchId = undefined
			}
			const sessionData: InsertSession = {
				...sessionDataWithoutTags,
				...(startLineOnFirstWrite ? { lineOnFirstWrite: true } : {}),
				...(worldId !== (sessionDataWithoutTags.lorebookId ?? null) ? { lorebookId: worldId } : {}),
				...(await sessionLinePatch(tx, {
					before: null,
					lorebookId: worldId,
					lorebookBranchId: worldBranchId,
					clock:
						namedClockYear == null
							? undefined
							: clockFromColumns({
									storyClockYear: requestedClockYear,
									storyClockMonth: requestedClockMonth,
									storyClockDay: requestedClockDay,
									storyClockHour: requestedClockHour,
									storyClockMinute: requestedClockMinute
								})
				})),
				userId,
				isGroup: characterIds.length + castMemberIds.length + seatedCast.length > 1
			}
			const [row] = await tx
				.insert(schema.sessions)
				.values(sessionData)
				.returning()
			// 🚧 Every session owns a book from its birth (pr-6, pass 11): the
			// kit copy below when there is a kit, else a fresh one, Gregorian with
			// its clock unset (`insertOwnBook`).
			if (!startKit)
				await insertOwnBook(tx as unknown as Db, {
					sessionId: row.id,
					userId,
					name: row.name,
					overlayOf: row.lorebookId ?? null,
					primaryRuleset: row.primaryRuleset,
					rulesetVersion: row.rulesetVersion ?? null,
					...(row.lorebookId == null ? { timelineEnabled: notesTimeline ?? true } : {})
				})
			// 🚧 The kit, copied into the session's own book (the one
			// `ownBookFor` would make: the session's name, owner and
			// Rules, overlaying nothing) — with the session, or not at all.
			if (startKit) {
				const { bookFromKit } = await import("$lib/server/lorebooks/starterKits")
				kitCopy = await bookFromKit(tx, startKit, {
					userId,
					name: row.name?.trim() || "Untitled session",
					kind: "book",
					sessionId: row.id,
					...(castSeatsOn
						? {
								seatCast: {
									isAdmin: !!socket.user!.isAdmin,
									exclude: new Set([...characterIds, ...personaIds]),
									excludeMembers: new Set(castMemberIds)
								}
							}
						: {})
				})
				await tx
					.update(schema.lorebooks)
					.set({ primaryRuleset: row.primaryRuleset, rulesetVersion: row.rulesetVersion })
					.where(eq(schema.lorebooks.id, kitCopy.lorebookId))
				if (kitCopy.seated.length > 0 && flooredShape) {
					const { shapeViolations } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const seats =
						characterIds.length + castMemberIds.length + kitCopy.seated.length
					const violations = shapeViolations(flooredShape, {
						characters: seats,
						personas: personaIds.length,
						hasLorebook: true
					})
					if (violations.length)
						throw new CreateRefusal(
							`This session does not fit '${genreName}': ${violations.join("; ")}.`
						)
					if (!row.isGroup && seats > 1) {
						await tx
							.update(schema.sessions)
							.set({ isGroup: true })
							.where(eq(schema.sessions.id, row.id))
						row.isGroup = true
					}
				}
			}
			// 🚧 Where the story starts (`storyStartOf`): a create that named no
			// clock starts the SESSION at the line's start. `latest` writes the
			// latest dated row; `today` writes today's date in the owner's time
			// zone; `present` and `undated` write nothing (the session follows its
			// line, ruling 15). `asks` (today does not land on the book's
			// calendar) refuses and the transaction rolls back: nothing is made.
			// The genre's create pipeline runs after this transaction, so its
			// clock writes win.
			if (namedClockYear == null) {
				const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
				const { storyStartOf, clockColumns, lockBookCalendar, ownerTimeZoneOf } = await import(
					"$lib/server/state/storyTime"
				)
				const readBookId = row.lorebookId ?? (await ownBookOf(tx as unknown as Db, row.id))?.id
				if (readBookId != null) {
					const start = await storyStartOf(tx as unknown as Db, {
						lorebookId: readBookId,
						branchId: row.lorebookBranchId ?? null,
						timeZone: await ownerTimeZoneOf(tx as unknown as Db, userId)
					})
					if (start.cause === "latest" || start.cause === "today") {
						await lockBookCalendar(tx as unknown as Db, readBookId)
						await tx
							.update(schema.sessions)
							.set(clockColumns(start.clock))
							.where(eq(schema.sessions.id, row.id))
					} else if (start.cause === "asks") {
						const [book] = await tx
							.select({ name: schema.lorebooks.name })
							.from(schema.lorebooks)
							.where(eq(schema.lorebooks.id, readBookId))
						throw new CreateRefusal(
							`Today's date doesn't fit the calendar of ${book?.name?.trim() || "this lorebook"}. Choose the date the story begins on.`
						)
					}
				}
			}
			return row
		}).catch((err: unknown) => {
			if (err instanceof CreateRefusal) return err
			throw err
		})
		if (made instanceof CreateRefusal) return refuse(made.message)
		const newSession = made
		// The cast to seat from a book: the starter copy's, else the attached book's.
		const copied = kitCopy as Awaited<
			ReturnType<(typeof import("$lib/server/lorebooks/starterKits"))["bookFromKit"]>
		> | null
		const bookSeats: { castMemberId: number; cardId: number | null }[] = copied
			? copied.seated.map((castMemberId) => ({ castMemberId, cardId: null }))
			: seatedCast
		const pickedSeatIds = castMemberIds.map((id) => copied?.members.get(id) ?? id)
		// Assigned inside the transaction's callback, which narrowing cannot see.
		const madeFromKit = kitCopy as import("$lib/server/lorebooks/starterKits").KitCopy | null
		if (madeFromKit) {
			const { afterKitCopy } = await import("$lib/server/lorebooks/starterKits")
			await afterKitCopy(
				madeFromKit,
				userId,
				socket.user?.displayName || socket.user?.username || ""
			)
		}
		// Creating until its create run is over (`sessions/creating.ts`): the
		// window in which the create pipeline's settings still apply to it.
		const { markCreating, markCreated } = await import(
			"$lib/server/sessions/creating"
		)
		markCreating(newSession.id)

		// 🚧 `next-chapter`: the chapter's first message, ahead of whatever the
		// genre's create pipeline writes, is the anchor the carried state is
		// filed against. An ordinary system line: the viewer may Hide it.
		let chapterAnchorId: number | null = null
		if (creationMode === "next-chapter") {
			const { insertLegacy } = await import("$lib/server/messages/store")
			chapterAnchorId = (
				await insertLegacy(db as unknown as Db, {
					userId,
					sessionId: newSession.id,
					personaId: null,
					characterId: null,
					role: "system",
					channel: "main",
					content: "Chapter begins.",
					isGenerating: false
				})
			).id
		}

		// Process tags after session creation
		if (tags.length > 0) {
			await processSessionTags(newSession.id, tags, userId)
		}

		// The seats, through the one seat writer (`sessions/seats.ts`): personas,
		// the picked characters, then the book's seated cast — in one transaction.
		// `settleSeats` (fill-only: it never departs a seat) fills what the
		// pre-check (which saw only the attached book) could not.
		let seatsMinted = false
		const mintedMembers: MintedSeatMember[] = []
		// A seat the writer refuses (a listed member the pre-check above could not
		// see is outside the session's books) aborts the seats in its own words.
		const refusedSeat: { sentence?: string } = {}
		try {
			await db.transaction(async (tx) => {
				const tdb = tx as unknown as Db
				for (const [i, personaId] of personaIds.entries()) {
					const seat = await seatPlayer(tdb, {
						sessionId: newSession.id,
						personaId,
						position: i
					})
					if (seat.minted) seatsMinted = true
					mintedMembers.push(...seat.mintedMembers)
				}
				for (const characterId of characterIds) {
					const seat = await seatCast(tdb, {
						sessionId: newSession.id,
						cardId: characterId,
						position: characterPositions[characterId] || 0,
						secondCard: "allow",
						seatedBy: userId
					})
					if (seat.ok && seat.minted) seatsMinted = true
					if (seat.ok) mintedMembers.push(...seat.mintedMembers)
				}
				// 🚧 The listed card-less members (plan §34.2), after the picked cards.
				const afterCards = characterIds.length
					? Math.max(...characterIds.map((id) => characterPositions[id] || 0)) + 1
					: 0
				for (const [i, castMemberId] of pickedSeatIds.entries()) {
					const seat = await seatCast(tdb, {
						sessionId: newSession.id,
						castMemberId,
						position: afterCards + i,
						secondCard: "allow",
						seatedBy: userId
					})
					if (!seat.ok) {
						refusedSeat.sentence = seat.refusal
						throw new Error(seat.refusal)
					}
					if (seat.minted) seatsMinted = true
					mintedMembers.push(...seat.mintedMembers)
				}
				// 🚧 (M3b) The book's seated cast (computed above from the book, never taken
				// from the request, so no ownership check): after the picked ones, in book
				// order, by member. A starter copy's members are the notes' own, seated by
				// member. `new-world` reads a copy of the attached book whose members have
				// new ids: a carded member is seated by its card there (the copy has the
				// card's member), a card-less one has no id to seat by and is not seated.
				const afterMembers = afterCards + castMemberIds.length
				const seatsByCard = creationMode === "new-world" && !copied
				for (const [i, { castMemberId, cardId }] of bookSeats.entries()) {
					if (seatsByCard && cardId == null) continue
					const seat = await seatCast(
						tdb,
						seatsByCard
							? {
									sessionId: newSession.id,
									cardId,
									position: afterMembers + i,
									secondCard: "allow",
									seatedBy: userId
								}
							: {
									sessionId: newSession.id,
									castMemberId,
									position: afterMembers + i,
									secondCard: "allow",
									seatedBy: userId
								}
					)
					if (!seat.ok) {
						refusedSeat.sentence = seat.refusal
						throw new Error(seat.refusal)
					}
					if (seat.minted) seatsMinted = true
					mintedMembers.push(...seat.mintedMembers)
				}
				const settled = await settleSeats(tdb, newSession.id)
				if (settled.minted > 0) seatsMinted = true
				mintedMembers.push(...settled.mintedMembers)
			})
		} catch (err) {
			if (refusedSeat.sentence === undefined) throw err
			// The session row is already written: take it back with the refusal.
			await db.delete(schema.sessions).where(eq(schema.sessions.id, newSession.id))
			markCreated(newSession.id)
			// The create had committed more than the row: its own book (or kit
			// copy) and, for a new world, the world's copy. Take them back too,
			// each best-effort on its own; the boot sweep is the own book's
			// backstop (the world copy has none).
			try {
				const { purgeOwnBookOf } = await import(
					"$lib/server/lorebooks/ownBook"
				)
				await purgeOwnBookOf(db, newSession.id)
			} catch (e) {
				console.warn(
					"[sessions:create] the refused session's own book was not taken back:",
					e
				)
			}
			const worldCopyId = newSession.lorebookId
			if (creationMode === "new-world" && worldCopyId != null)
				try {
					const { purgeLorebook } = await import(
						"$lib/server/lorebooks/tableRegistry"
					)
					await db.transaction(async (tx) => {
						await purgeLorebook(tx as unknown as Db, worldCopyId)
						await tx
							.delete(schema.lorebooks)
							.where(eq(schema.lorebooks.id, worldCopyId))
					})
				} catch (e) {
					console.warn(
						"[sessions:create] the refused session's world copy was not taken back:",
						e
					)
				}
			return refuse(refusedSeat.sentence)
		}
		// Committed: the names of the members just made come from their cards.
		await syncMintedSeatMembers(db, mintedMembers)
		// Attaching a character as a voice IS the user saying they play
		// it — see markCharacterAsPersona, the one writer of that flag.
		for (const personaId of personaIds) await markCharacterAsPersona(personaId)
		/**
		 * The genre's envoys (plans/29 R-18; U5g): every `default: true`
		 * envoy is seated with no choice, and a preset's `defaults.envoys`
		 * pre-seats the ones it names — cast rows with `envoy_slug`, beside
		 * the characters, before the create pipeline runs for the same
		 * reason the cast arrives before it. A slug nothing declares is
		 * dropped silently here: a preset written against a newer genre
		 * still starts.
		 */
		{
			const { seatDefaultEnvoys } = await import(
				"$lib/server/pipelines/entities/envoys"
			)
			const { STANDARD_GENRE_ID } = await import(
				"$lib/server/pipelines/entities/sessionGenres"
			)
			await seatDefaultEnvoys(
				db,
				newSession.id,
				newSession.genreId ?? STANDARD_GENRE_ID,
				presetEnvoys
			)
		}
		/**
		 * The swaps the form asked for, else the preset's `defaults.swaps`
		 * (R40): each written as the session's rebind of that node. An entry
		 * the node does not offer is refused by the setter with a sentence;
		 * the session still starts on the pin, and the refusal is logged
		 * and named in the reply (`refusedSwaps`) rather than failing the
		 * create.
		 */
		const refusedSwaps: NonNullable<Sockets.Sessions.Create.Response["refusedSwaps"]> = []
		{
			// One entry per node, and a bound (M2 review): each entry costs a
			// handful of queries, and a create is not a place to run
			// thousands. The last entry for a node wins, as a later rebind
			// would.
			const byNode = new Map(
				(requestedSwaps !== undefined ? storedSwapsOf(requestedSwaps) : presetSwaps).map(
					(s) => [`${s.spec}#${s.node}`, s] as const
				)
			)
			const seeded = [...byNode.values()].slice(0, MAX_SEEDED_SWAPS)
			if (seeded.length) {
				const { setSessionNodeRebind } = await import(
					"$lib/server/pipelines/entities/bindings"
				)
				for (const swap of seeded) {
					const { error } = await setSessionNodeRebind(db, {
						sessionId: newSession.id,
						userId,
						spec: swap.spec,
						nodeKey: swap.node,
						definitionId: swap.definition
					})
					if (error) {
						console.warn(
							`[sessions:create] swap ${swap.spec}#${swap.node} → ${swap.definition} not applied to session ${newSession.id}: ${error}`
						)
						refusedSwaps.push({
							spec: swap.spec,
							node: swap.node,
							definition: swap.definition,
							reason: error
						})
					}
				}
			}
		}
		// The cast arrives with the session (ruling 2026-09-12). Before the
		// create pipeline runs, not after: its nodes may already write lore
		// against this book, and lore anchored to a cast member that does not
		// exist yet has nothing to anchor to.
		if (newSession.lorebookId) {
			await runLorebookBindingCheck(
				socket,
				newSession.id,
				newSession.lorebookId,
				emitToUser,
				{ minted: seatsMinted }
			).catch(console.error)
		}

		// 🚧 `next-chapter`: what the old session declared `nextChapter: true`
		// follows the player, in one write anchored to the chapter's first message — before the create
		// pipeline, while that row is still the newest and so still open to a write.
		if (creationMode === "next-chapter")
			await creationModes.seedNextChapter(db as unknown as Db, {
				fromSessionId: params.from!,
				sessionId: newSession.id,
				userId,
				anchorMessageId: chapterAnchorId!
			})

		// Creation as a run (24 §12, T8): the genre's create pipeline answers
		// `session-created` — greeting seeding is its nodes now, receipted
		// like any other run. Dispatch keys on (genre, event); nothing serving
		// is a normal state (a transitional input-type genre has no create
		// pipeline), and the imperative floor below covers it — the F29
		// posture: creation must never fail because pipeline infrastructure
		// did.
		const { getSessionGenre, genreFieldsFor, STANDARD_GENRE_ID } =
			await import("$lib/server/pipelines/entities/sessionGenres")
		const genreId = newSession.genreId ?? STANDARD_GENRE_ID
		let seededByPipeline = false
		try {
			const { dispatchSessionEvent } = await import(
				"$lib/server/pipelines/runtime/sessionEvents"
			)
			const createRequest = {
				genreId,
				presetId: newSession.presetId ?? null,
				characterIds,
				personaIds,
				lorebookId: newSession.lorebookId ?? null
			}
			const dispatched = await dispatchSessionEvent(db, {
				sessionId: newSession.id,
				userId,
				genreId,
				event: sessionEvents.sessionCreated,
				input: {
					main: createRequest,
					sessionScope: { sessionId: newSession.id, userId },
					sessionId: newSession.id,
					request: createRequest,
					// The resolved fields, declared defaults included (B16x) —
					// the same read every later run takes.
					fields: await genreFieldsFor(db, newSession.id)
				}
			})
			seededByPipeline =
				!!dispatched && (dispatched.receipt as any)?.outcome !== "err"
		} catch (err) {
			console.warn(
				"session-created pipeline failed; seeding greetings imperatively:",
				err
			)
		} finally {
			markCreated(newSession.id)
		}

		if (!seededByPipeline) {
			// The floor: the same halves the pipeline's nodes call, invoked
			// directly, honoring the genre shape's greeting declaration.
			const greetingShape = (await getSessionGenre(db, genreId))?.shape
				?.greeting
			if (greetingShape?.enabled !== false) {
				const { collectSessionGreetings, writeSessionGreetings } =
					await import("$lib/server/sessions/greetings")
				const { entries } = await collectSessionGreetings(
					db,
					newSession.id
				)
				await writeSessionGreetings(db, {
					sessionId: newSession.id,
					userId,
					entries,
					channel: greetingShape?.channel ?? "main"
				})
			}
		}

		// Fetch the complete session with messages
		const resSession = await getSessionFromDB(newSession.id, userId)
		if (!resSession) throw new Error("Failed to fetch created session")

		// Refresh session list — awaited, and ahead of the reply that names the
		// new session, so a client resolving the new row out of the list has it
		// in hand by then. See `relistSessions` for why it is lazy. A seeded
		// greeting is the new session's first quoted line; the row push is how
		// a guest's sidebar and the home page's cards hear about it.
		await relistWithRow(socket, emitToUser, newSession.id)
		{
			const { relistSessionNotes } = await import("./lorebooks")
			relistSessionNotes(socket, emitToUser)
		}
		const res: Sockets.Sessions.Create.Response = {
			session: resSession as any,
			...(refusedSwaps.length ? { refusedSwaps } : {})
		}
		emitToUser("sessions:create", res)
		return res
	}
}
