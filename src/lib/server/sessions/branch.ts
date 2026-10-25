/**
 * Branching a session — the write behind `core:outlet/branch-session@1`
 * (R-15, 2026-09-16). Lifted out of `sessions:branch` so the handler keeps
 * only what the venue decides (the owner check) and the write runs as a
 * built-in: receipted, emitting `session-branched`, recorded in the new
 * session's changes.
 *
 * A branch is a new session with the same cast, guests and tags and a copy
 * of the history up to and including the fork message, each copy keeping its
 * channel. One transaction: a crash partway through must not leave a
 * half-copied session visible in the list.
 */

import { and, asc, eq, gte, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	insertLegacyMany,
	NATIVE_ORDINAL_BASE,
	updateLegacyWhere,
	liveMessageWhere
} from "$lib/server/messages/store"
import { ATTACHMENT_PART_TYPES } from "$lib/server/attachments/references"
import { canonicalChannel } from "$lib/server/messages/channels"
import { markCharacterAsPersona } from "$lib/server/utils/markCharacterAsPersona"
import { playerSeatIdOfSpeaker, playerSeatSpeaker } from "$lib/server/sessions/seatName"
import { annexAt, annexWithoutPoints } from "$lib/server/sessions/annexChanges"

export class BranchError extends Error {}

export interface BranchRequest {
	/** The session being forked. */
	sessionId: number
	/** The last message the copy keeps; must belong to `sessionId`. */
	fromMessageId: number
	/** The new session's name. Null keeps the source's. */
	title?: string | null
}

/** The new session's row. */
export async function branchSession(
	db: Db,
	request: BranchRequest
): Promise<typeof schema.sessions.$inferSelect> {
	const { sessionId, fromMessageId } = request
	const original = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		with: {
			sessionCharacters: {
				orderBy: asc(schema.sessionCharacters.position)
			},
			sessionPersonas: {
				orderBy: asc(schema.sessionPersonas.position)
			},
			sessionGuests: true,
			sessionTags: true
		}
	})
	if (!original) throw new BranchError("Original session not found")

	const fork = await db.query.sessionMessages.findFirst({
		where: and(
			eq(schema.sessionMessages.id, fromMessageId),
			eq(schema.sessionMessages.sessionId, sessionId)
		)
	})
	if (!fork) throw new BranchError("Branch message not found")

	const allMessages = await db.query.sessionMessages.findMany({
		// 🚧 The live history (RF fix 5): a branch never copies a row Back
		// took out — its forward stack stays with the session it is in.
		where: and(
			eq(schema.sessionMessages.sessionId, sessionId),
			liveMessageWhere()
		),
		orderBy: asc(schema.sessionMessages.id)
	})
	/**
	 * Up to the fork — and 🚧 each table row anchored to a kept message
	 * (PLAN-rulesets §30): it is written after its anchor, so its own id may
	 * lie past the fork, but it belongs to the line that stays.
	 */
	const anchorOfRow = (m: { metadata?: unknown }): number | null => {
		const v = (m.metadata as { anchorMessageId?: unknown } | null)?.anchorMessageId
		return typeof v === "number" ? v : null
	}
	const messagesToCopy = allMessages.filter((m) => {
		if (m.id <= fromMessageId) return true
		const anchor = anchorOfRow(m)
		return anchor !== null && anchor <= fromMessageId
	})

	return await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(schema.sessions)
			.values({
				name: request.title ?? original.name,
				scenario: original.scenario,
				userId: original.userId,
				isGroup: original.isGroup,
				metadata: original.metadata,
				// 🚧 Which session and line it was branched from: the branch
				// marker (`branchOfSession`), shown by the header and the session panel.
				branchOfSessionId: original.id,
				branchOfMessageId: fromMessageId,
				branchOfName: original.name ?? null,
				lorebookId: original.lorebookId,
				// The same line of the book, its clock where the parent's
				// stands (ruling 15, story-time P3): a branched session plays
				// on from where its parent read — then keeps its own clock.
				// 🚧 Stepped back below to the fork (live scenes §15 G15):
				// the parent's clock NOW less every move made after the fork.
				lorebookBranchId: original.lorebookBranchId,
				storyClockYear: original.storyClockYear,
				storyClockMonth: original.storyClockMonth,
				storyClockDay: original.storyClockDay,
				storyClockHour: original.storyClockHour,
				storyClockMinute: original.storyClockMinute,
				// The same genre, preset and genre fields: the copies keep
				// their channels, and the new session has to have them to
				// keep them on. ⚠ The handler this replaced said as much and
				// copied none of the three, so a branch of an adventure came
				// up as a chat (2026-09-16).
				genreId: original.genreId,
				presetId: original.presetId,
				genreFields: original.genreFields,
				// Which world attributes it reads comes along with what it
				// tracks (its picks, below): a branch tracks what its parent did.
				worldAttributes: original.worldAttributes,
				// The annex and who may see each key come along verbatim
				// (deep-copied, so neither session's later write reaches the
				// other): a branch of a Lair keeps its castellan's
				// scratchpad, a genre's annex-held world stays its world.
				// ⚠ Neither was copied before 2026-10-14.
				// 🚧 …as it stood at the fork (`annexChanges.ts`): what the turns
				// after it wrote stays with the parent.
				annex: annexWithoutPoints(await annexAt(tx as unknown as Db, original.id, fromMessageId)),
				annexAudiences: structuredClone(original.annexAudiences ?? {}),
				// The state version comes along (U5f): the copied value and
				// possession rows keep the versions they landed at, and a
				// branch that restarted at zero would read every one of them
				// as "moved since" the first proposal made on it.
				stateVersion: original.stateVersion,
				// 🚧 The rules it plays by and how it revises come along
				// (PLAN-rulesets §23: a branch keeps its session's pin).
				primaryRuleset: original.primaryRuleset,
				rulesetVersion: original.rulesetVersion,
				rigour: original.rigour,
				onRevision: original.onRevision,
				// 🚧 Whose composer the genre closed, and why, comes along with
				// the lanes it closed them on (Q1-2).
				composerStates: structuredClone(original.composerStates ?? {})
			} satisfies InsertSession)
			.returning()

		// Removed participants aren't copied into the branch at all — a
		// soft-removed row resurrecting as active in the new session would
		// undo the whole point of removing them. Nor is a seat with neither
		// a character nor an envoy: that is a departed character whose row
		// the global delete nulled, kept only for its `removedName`.
		//
		// A seat is a character's OR an envoy's (U5g; the CHECK on the
		// table says so), and the branch keeps both: a guide session's
		// branch with no mascot seated would have no one to answer, and
		// the copy would have silently changed who is in the room (U5g
		// review, C2).
		const sessionCharacters = (original as any).sessionCharacters.filter(
			(cc: any) => !cc.removedAt && (cc.characterId || cc.envoySlug)
		)
		if (sessionCharacters.length > 0)
			await tx.insert(schema.sessionCharacters).values(
				sessionCharacters.map((sc: any) => ({
					sessionId: created.id,
					characterId: sc.characterId ?? null,
					envoySlug: sc.envoySlug ?? null,
					position: sc.position,
					isActive: sc.isActive
				}))
			)

		/**
		 * 🚧 A seat that retired (a new character after a death) comes across
		 * STILL retired (PLAN-dc-after-walk2 Q1-2, the walk's N4): its lines
		 * are in the copy, and with no seat to name them they were drawn as
		 * the Narrator's. Retired it stays — nobody writes as it — so nothing
		 * removed comes back to the table. A row left with neither a card nor
		 * a name is a departed card's leftover, and nobody.
		 */
		const sessionPersonas = (original as any).sessionPersonas.filter(
			(cp: any) => !cp.removedAt || cp.personaId != null || !!cp.seatName?.trim() || !!cp.removedName
		)
		// 🚧 Each seat's new id, by its old one: a `player_seat` stat owner names a
		// `session_personas.id`, which — unlike a `session_cast` owner's
		// character id — is new in the branch (`copyStateRows`). The seat
		// keeps its name and its player, so a card-less player seat comes across
		// as the same player character.
		const seatRemap = new Map<number, number>()
		if (sessionPersonas.length > 0) {
			const seats = await tx
				.insert(schema.sessionPersonas)
				.values(
					sessionPersonas.map((sp: any) => ({
						sessionId: created.id,
						personaId: sp.personaId,
						position: sp.position,
						seatName: sp.seatName ?? null,
						userId: sp.userId ?? null,
						// 🚧 Its portrait, and — retired — when and under what name.
						portraitMediaId: sp.portraitMediaId ?? null,
						removedAt: sp.removedAt ?? null,
						removedName: sp.removedName ?? null
					}))
				)
				.returning({ id: schema.sessionPersonas.id })
			// One INSERT returns its rows in the order given.
			sessionPersonas.forEach((sp: any, i: number) => {
				if (seats[i]) seatRemap.set(sp.id, seats[i].id)
			})
			for (const sp of sessionPersonas)
				if (sp.personaId != null) await markCharacterAsPersona(sp.personaId, tx)
		}

		const sessionGuests = (original as any).sessionGuests
		if (sessionGuests.length > 0)
			await tx.insert(schema.sessionGuests).values(
				sessionGuests.map((g: any) => ({
					sessionId: created.id,
					userId: g.userId,
					// 🚧 Who plays and who watches comes along (Q1-2).
					...(typeof g.isPlayer === "boolean" ? { isPlayer: g.isPlayer } : {})
				}))
			)

		/**
		 * 🚧 Each person's **lane** of a personal channel comes along
		 * (PLAN-dc-after-walk2 Q1-2, owner ruling ★5): the copies keep their
		 * lane strings (`parley:2`), and with no register naming whose lane is
		 * whose, the branch's Planner lanes read empty and a guest added there
		 * re-greeted the owner as if nobody had played.
		 */
		const lanes = await tx
			.select({ slug: schema.channelLanes.slug, lane: schema.channelLanes.lane, userId: schema.channelLanes.userId })
			.from(schema.channelLanes)
			.where(eq(schema.channelLanes.sessionId, sessionId))
		if (lanes.length)
			await tx.insert(schema.channelLanes).values(lanes.map((l) => ({ sessionId: created.id, ...l })))

		/**
		 * 🚧 …and each person's own layout of it — which tab each panel shows
		 * (Q1-2): the branch opens on the tab its maker was on, never the
		 * layout's first.
		 */
		const layouts = await tx
			.select()
			.from(schema.sessionPanelLayouts)
			.where(eq(schema.sessionPanelLayouts.sessionId, sessionId))
		if (layouts.length)
			await tx.insert(schema.sessionPanelLayouts).values(
				layouts.map((l) => ({
					sessionId: created.id,
					userId: l.userId,
					layout: structuredClone(l.layout ?? {}),
					startedFromLayoutPresetId: l.startedFromLayoutPresetId,
					layoutCopiedAt: l.layoutCopiedAt,
					layoutSettings: structuredClone(l.layoutSettings ?? {})
				}))
			)
		/**
		 * 🚧 …and the widget settings each layout is drawn with
		 * (PLAN-dc-after-walk3 R0-1, the walk's NEW-1): a layout row names its
		 * widgets by instance id, and what each shows — a tab's title, the
		 * Planner panel's `channelLane: 'mine'`, the goal panel's key, the
		 * sheet's seats, the clock's format — is a `widget_settings` row per
		 * person. With the layout copied and these left behind, the copy
		 * stopped the first open from copying the genre's layout in, so a
		 * branch drew every panel at its defaults: raw tab names, the Story
		 * in every messages panel, "Pick a key". Nothing in them names a
		 * session-scoped id (a lane is `mine`, kept by the register above).
		 */
		const widgetSettings = await tx
			.select()
			.from(schema.widgetSettings)
			.where(eq(schema.widgetSettings.sessionId, sessionId))
		if (widgetSettings.length)
			await tx.insert(schema.widgetSettings).values(
				widgetSettings.map((w) => ({
					sessionId: created.id,
					userId: w.userId,
					widgetInstanceId: w.widgetInstanceId,
					values: structuredClone(w.values ?? {})
				}))
			)

		const sessionTags = (original as any).sessionTags
		if (sessionTags.length > 0)
			await tx.insert(schema.sessionTags).values(
				sessionTags.map((t: any) => ({
					sessionId: created.id,
					tagId: t.tagId
				}))
			)

		const copied = messagesToCopy.length
			? await insertLegacyMany(
				tx,
				messagesToCopy.map(
					(message) =>
						({
							sessionId: created.id,
							userId: message.userId,
							personaId: message.personaId,
							characterId: message.characterId,
							role: message.role,
							// The branch is the same conversation, so each
							// copy keeps its lane (20 §7). Canonicalised
							// because this is a write — the source row already
							// is one, and a write path that trusts that is a
							// write path that stops being true later.
							channel: canonicalChannel((message as any).channel),
							content: message.content,
							// The copy's text is the original's, so the vector
							// computed over it is the copy's too: carried with
							// its model and source hash, a branch costs no
							// embed. The queue's hash check still re-embeds a
							// copy whose stored text came out different.
							embedding: message.embedding,
							embeddingModel: message.embeddingModel,
							embeddingSourceHash: message.embeddingSourceHash,
							vectorizedAt: message.vectorizedAt,
							isHidden: message.isHidden,
							isNarratorResponse: message.isNarratorResponse,
							// The copy was said when the original was: its
							// story-clock stamp is the original's.
							storyClockYear: (message as any).storyClockYear ?? null,
							storyClockMonth: (message as any).storyClockMonth ?? null,
							storyClockDay: (message as any).storyClockDay ?? null,
							storyClockHour: (message as any).storyClockHour ?? null,
							storyClockMinute: (message as any).storyClockMinute ?? null,
							// Always settled: a copy is never being written.
							isGenerating: false,
							// 🚧 Said when the original was (Q1-2, #47): a copy
							// keeps its time — every copied row read 3:26 PM.
							createdAt: message.createdAt,
							updatedAt: message.updatedAt,
							// The copy names the message it copies — the
							// original, through any copy of a copy — so its
							// place in play is the original's, not its own
							// larger id (`inPlayOrder`).
							// A card-less player seat's line names its seat; the
							// branch has its own seats, so the name follows.
							metadata: {
								...(message.metadata ?? {}),
								...remapPlayerSeatSpeaker(message.metadata, seatRemap),
								copyOf: message.metadata?.copyOf ?? message.id
							}
						}) satisfies InsertSessionMessage
				)
			)
			: []

		// The anchors, remapped (R10). `insertLegacyMany` returns the rows of
		// one INSERT in the order they were given, so zipping is the map — and
		// the map is the whole of why state can be copied at all: every
		// attribute row is anchored to a message id, and an id from the source
		// session means nothing in the branch.
		//
		// ⚠ The branch copied NONE of these before today, so a forked adventure
		// arrived with every bar back at its declaration default and no ledger.
		const remap = new Map<number, number>()
		messagesToCopy.forEach((message, i) => {
			const row = copied[i]
			if (row) remap.set(message.id, row.id)
		})
		await copyAttachmentParts(tx, remap)

		// 🚧 A copied table row names its anchor's copy (§30): the source's
		// id means nothing in the branch, and a delete there must take it.
		// Its anchor is always copied — a row whose anchor is gone went
		// with it (`deleteLegacy`).
		for (const [i, message] of messagesToCopy.entries()) {
			const anchor = anchorOfRow(message)
			const row = copied[i]
			const moved = anchor !== null ? remap.get(anchor) : undefined
			if (!row || moved === undefined) continue
			await updateLegacyWhere(tx, eq(schema.sessionMessages.id, row.id), {
				metadata: {
					...((row.metadata as Record<string, unknown> | null) ?? {}),
					anchorMessageId: moved
				}
			})
		}

		// 🚧 The session's own notes branch with it (PLAN-rulesets §28): a
		// copy as of the fork, anchors remapped (`copyOwnBookToBranch`).
		const { copyOwnBookToBranch } = await import("$lib/server/lorebooks/ownBook")
		const notes = await copyOwnBookToBranch(tx, {
			sessionId,
			created,
			forkMessageId: fromMessageId,
			remap
		})

		await copyStateRows(tx, {
			sessionId,
			created: created.id,
			forkMessageId: fromMessageId,
			remap,
			seatRemap,
			entryRemap: notes.entryRemap
		})

		// 🚧 The clock as of the fork message (live scenes §15 G15): its
		// recorded moves come across under their copied lines, and every move
		// made after the fork comes off the clock the branch was given — a
		// parent that follows its line's present gave it none to step.
		const { copyClockMovesToBranch, stepBranchClockToFork, StoryClockRefusal } =
			await import("$lib/server/state/clockMoves")
		const clockInput = {
			parentSessionId: sessionId,
			branchSessionId: created.id,
			forkMessageId: fromMessageId
		}
		await copyClockMovesToBranch(tx, { ...clockInput, remap })
		try {
			await stepBranchClockToFork(tx, clockInput)
		} catch (e) {
			if (e instanceof StoryClockRefusal)
				throw new BranchError(`The branch's story clock can't be set to the fork: ${e.message}`)
			throw e
		}

		const [settled] = await tx
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.id, created.id))
		return settled ?? created
	})
}

/**
 * 🚧 A stat value with each `{ entryId }` reference to a copied notes entry
 * moved to its copy (DC walk 6: the branch's Location read "entry 1" — the
 * parent's place, which the branch cannot name). A reference to an entry the
 * map does not hold (the attached book's, shared) stays. Pure; returns the
 * value itself when nothing moved.
 */
export function remapEntryRefs<T>(value: T, entryRemap: ReadonlyMap<number, number>): T {
	if (!entryRemap.size || value === null || typeof value !== "object") return value
	if (Array.isArray(value)) {
		let changed = false
		const next = value.map((v) => {
			const moved = remapEntryRefs(v, entryRemap)
			if (moved !== v) changed = true
			return moved
		})
		return (changed ? next : value) as T
	}
	let changed = false
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
		let moved: unknown = v
		if (k === "entryId" && typeof v === "number") moved = entryRemap.get(v) ?? v
		else moved = remapEntryRefs(v, entryRemap)
		if (moved !== v) changed = true
		out[k] = moved
	}
	return (changed ? out : value) as T
}

/**
 * A copied line's `metadata.speaker`, moved to the branch's seat: a card-less
 * seat's line is stamped `player-seat:<id>`, and that id is the source session's.
 * Returns the override to spread, or nothing when the speaker is not a seat.
 */
export function remapPlayerSeatSpeaker(
	metadata: Record<string, unknown> | null | undefined,
	seatRemap: Map<number, number>
): { speaker?: string } {
	const seatId = playerSeatIdOfSpeaker(metadata?.speaker)
	if (seatId == null) return {}
	const moved = seatRemap.get(seatId)
	return moved == null ? {} : { speaker: playerSeatSpeaker(moved) }
}

/**
 * Copy the copied messages' attachments — a person's `core:image` /
 * `core:file` parts and a pipeline's generated images — onto their copies
 * (PLAN-composer-attachments phase 2 lane D).
 *
 * `insertLegacyMany` mirrors only what the legacy row can express (step 0,
 * ordinals below `NATIVE_ORDINAL_BASE`), so without this a branch arrived with
 * every picture gone. Each part keeps its coordinates — step 0, its revision,
 * its native ordinal — so it sits beside the same swipe it sat beside. The
 * FILE is not copied: the part's `assetId` names the same row, and the copy
 * reaching the branch's messages is what makes it viewable there
 * (`canViewMedia`'s part-reference branch). Parts on a native step ≥ 1 stay
 * behind with the rest of that step, which the branch does not carry either.
 */
async function copyAttachmentParts(
	tx: Db,
	remap: Map<number, number>
): Promise<void> {
	if (!remap.size) return
	const parts = await tx
		.select()
		.from(schema.messageParts)
		.where(
			and(
				inArray(schema.messageParts.messageId, [...remap.keys()]),
				inArray(schema.messageParts.type, [...ATTACHMENT_PART_TYPES]),
				eq(schema.messageParts.step, 0),
				gte(schema.messageParts.ordinal, NATIVE_ORDINAL_BASE)
			)
		)
	if (!parts.length) return
	await tx.insert(schema.messageParts).values(
		parts.map((p) => ({
			messageId: remap.get(p.messageId)!,
			step: p.step,
			revision: p.revision,
			ordinal: p.ordinal,
			type: p.type,
			content: p.content,
			data: p.data
		}))
	)
}

/**
 * Copy a session's state rows into its branch, anchors remapped.
 *
 * Values and configurations — the session-layer tables (an inventory is a
 * value since phase 3b; the retired possession edges are not copied) — and
 * the sheets its owners have, which is what the branch *tracks* rather than
 * what it holds. Rows anchored after the fork are left behind: a branch is the
 * conversation up to a point, and carrying a change made three replies later
 * would be carrying a fact from a future the branch never had.
 *
 * A null anchor is "from the beginning" and always comes across.
 *
 * ⚠ **Proposals are never copied, on purpose.** A pending decision belongs to
 * the person who was asked, in the session they were asked in; two sessions
 * each holding the same undecided line is two chances to answer one question,
 * and no way to say which answer was meant. 🚧 A decided **clock move** row
 * (applied, accepted, skipped — live scenes §15 G15) is a record, not a
 * decision: `copyClockMovesToBranch` carries those, beside this.
 */
async function copyStateRows(
	tx: Db,
	input: {
		sessionId: number
		created: number
		forkMessageId: number
		remap: Map<number, number>
		/** Old `session_personas.id` → the branch's copy of that seat. */
		seatRemap: Map<number, number>
		/** Old notes entry id → the branch's copy (`copyOwnBookToBranch`). */
		entryRemap: ReadonlyMap<number, number>
	}
): Promise<void> {
	const { sessionId, created, forkMessageId, remap, seatRemap, entryRemap } = input
	/**
	 * The owner id a copied row gets, or `undefined` when its owner did not
	 * come across. Ids that name a row OF this session move with it — the
	 * `session` owner is the session, a `player_seat` owner one of its seats — while
	 * a `session_cast` / `session_location` owner names a character or entry
	 * the branch shares, and stays.
	 */
	const ownerIdFor = (kind: string, id: number): number | undefined => {
		if (kind === "session") return id === sessionId ? created : id
		if (kind === "player_seat") return seatRemap.get(id)
		// 🚧 A place in the session's own notes is copied with the notes, so
		// it is the copy the branch's row names (DC walk 6: "Ways out → Iron
		// Door" with no place). A place in the attached book is shared.
		if (kind === "session_location") return entryRemap.get(id) ?? id
		return id
	}
	/** The anchor a copied row gets, or `undefined` when the row stays behind. */
	const anchor = (source: number | null): number | null | undefined => {
		if (source === null) return null
		if (source > forkMessageId) return undefined
		return remap.get(source) ?? undefined
	}

	const values = await tx
		.select()
		.from(schema.attributeValues)
		.where(eq(schema.attributeValues.sessionId, sessionId))
	for (const row of values) {
		const at = anchor(row.validFromMessageId)
		if (at === undefined) continue
		const ownerId = ownerIdFor(row.ownerKind, row.ownerId)
		if (ownerId === undefined) continue
		const { id: _id, createdAt: _createdAt, ...rest } = row
		await tx.insert(schema.attributeValues).values({
			...rest,
			value: remapEntryRefs(rest.value, entryRemap) as typeof rest.value,
			ownerId,
			sessionId: created,
			validFromMessageId: at
		})
	}

	const configs = await tx
		.select()
		.from(schema.attributeConfigs)
		.where(eq(schema.attributeConfigs.sessionId, sessionId))
	for (const row of configs) {
		const at = anchor(row.validFromMessageId)
		if (at === undefined) continue
		const ownerId = ownerIdFor(row.ownerKind, row.ownerId)
		if (ownerId === undefined) continue
		const { id: _id, createdAt: _createdAt, ...rest } = row
		await tx.insert(schema.attributeConfigs).values({
			...rest,
			ownerId,
			sessionId: created,
			validFromMessageId: at
		})
	}

	// What the branch TRACKS, as opposed to what it holds: the session's own
	// sheets and its cast's. Both are keyed by `session_id`, so both are found
	// by one predicate and both are remapped the same way — the `session_cast`
	// owner id is a `characters.id` and does not change across a branch, which
	// is why only the `session` and `player_seat` owners' ids move (`ownerIdFor`).
	const sheets = await tx
		.select()
		.from(schema.ownerSheets)
		.where(eq(schema.ownerSheets.sessionId, sessionId))
	for (const row of sheets) {
		const ownerId = ownerIdFor(row.ownerKind, row.ownerId)
		if (ownerId === undefined) continue
		await tx.insert(schema.ownerSheets).values({
			ownerKind: row.ownerKind,
			ownerId,
			sessionId: created,
			sheetId: row.sheetId,
			position: row.position
		})
	}
	// …and its attribute picks, the rest of what it tracks.
	const picks = await tx
		.select()
		.from(schema.sessionAttributePicks)
		.where(eq(schema.sessionAttributePicks.sessionId, sessionId))
	for (const row of picks)
		await tx.insert(schema.sessionAttributePicks).values({
			sessionId: created,
			slotId: row.slotId,
			enabled: row.enabled
		})
	// 🚧 …and who carries what (attribute carries, RF fix 2 item 3): each
	// holder's own switch, its owner remapped as the sheets' are.
	const carries = await tx
		.select()
		.from(schema.attributeCarries)
		.where(eq(schema.attributeCarries.sessionId, sessionId))
	for (const row of carries) {
		const ownerId = ownerIdFor(row.ownerKind, row.ownerId)
		if (ownerId === undefined) continue
		await tx.insert(schema.attributeCarries).values({
			sessionId: created,
			ownerKind: row.ownerKind,
			ownerId,
			slotId: row.slotId,
			carries: row.carries,
			updatedBy: row.updatedBy
		})
	}
}
