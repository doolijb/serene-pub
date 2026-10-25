/**
 * Writing a session's numbers onto the world's timeline (R8).
 *
 * ## Two sources of rows, and only one of them survives the session
 *
 * A session-layer row is per change, anchored to a message, and cascades with
 * its session — that is play, and play is meant to be retractable. A **durable**
 * row is the same shape filed against the *world*: owner `cast_member`,
 * `lorebook` or (phase 4) `location`, anchored to a history entry and a scene rather than to a message,
 * with `source_session_id` / `source_message_id` as **plain ints with no keys**
 * so the row outlives the session that produced it. That is what makes "she was
 * at 4 health when the bell drowned" a fact about the story rather than about a
 * chat log somebody might delete.
 *
 * ## Three writers, one function
 *
 * Scene capture (automatic, and reviewable like every other capture), the
 * session-delete safeguard (the last row before the cascade takes everything
 * else), and a manual *record now* mark. Three moments, one write: three
 * implementations of "and then record it" is how the delete safeguard ends up
 * recording a different set of slots from the capture beside it.
 *
 * ## No lorebook: the session's own notes (🚧 PLAN-rulesets §26)
 *
 * Until 2026-10-16 a session with no world recorded nothing. It now has one
 * of its own — its notes (`$lib/server/lorebooks/ownBook.ts`), a hidden
 * lorebook it alone owns — and the world's values land there. The delete
 * safeguard is the exception: the notes go with the session it records.
 *
 * ## Where, and whether (plan A22, ruled 2026-09-30; routed 2026-10-16)
 *
 * A capture or a mark lands in the attached book when the session may write
 * it — the session's owner owns it and their **lore write mode** is Full —
 * on the session's line, dated at the moment the recording names (a
 * capture's scene names its history entry) or else at the latest history
 * entry on that line at or before the session's story now
 * (`writeDatingAt`). Otherwise — no book, Review changes, Off, or someone
 * else's book — the world's values land in the session's notes, on their
 * main line and undated (`loreWriteTargetFor`); Review changes files no
 * proposals from here, the notes being the overlay a review resolves.
 * The delete safeguard keeps the A22 table: Full and Review changes write
 * the book (a proposal would go with its session), Off records nothing.
 *
 * Full writes each value through the book's own door (`validateValue`), as
 * Review's proposals are judged: a value may resolve from the card's layer,
 * which no calendar checks, and a story time the book's calendar cannot
 * place is refused (`refused`) and not recorded (plan A18(a)).
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { slotValueForStorage } from "@serene-pub/sdk"
import type { LoreWriteMode } from "$lib/shared/lorebooks/loreWriteMode"
import { sessionLoreWriteMode } from "$lib/server/state/loreWriteMode"
import { sessionReadingOf, writeDatingAt } from "$lib/server/state/reading"
import {
	configFor,
	sessionLinks,
	valueOf,
	vocabularyFor,
	type SessionLinks
} from "$lib/server/state/resolve"
import {
	newestMessageId,
	StateRefusal,
	validateValue
} from "$lib/server/state/write"
import { lockBookCalendar } from "$lib/server/state/storyTime"
import { MAIN_HEAD, placesOnReading } from "$lib/server/state/entriesOnReading"

/** Why a row is being recorded — the ledger reads it, and it is not a status. */
export type RecordReason = "scene" | "delete" | "mark"

export interface RecordOptions {
	reason: RecordReason
	/** The captured moment, when a capture is what asked. */
	sceneId?: number | null
	/**
	 * The story-clock anchor. Absent: the latest history entry on the
	 * session's line at or before its story clock (`writeDatingAt`); null
	 * when there is none to file under.
	 */
	historyEntryId?: number | null
	/** Ledger narration for the whole recording. */
	note?: string | null
}

export interface RecordReport {
	/** False when nothing was written — no world to record to, Off, or everything proposed. */
	recorded: boolean
	/**
	 * 🚧 Where it landed (PLAN-rulesets §26): the attached `book`, or the
	 * session's own notes (`own-book`, with their id in `lorebookId`).
	 */
	route: "book" | "own-book" | null
	/** The book the rows were filed against; null when nothing could be. */
	lorebookId: number | null
	/** The book owner's lore write mode the recording followed. */
	mode: LoreWriteMode
	values: number
	configs: number
	/** Review changes: the values filed as proposals instead of written. */
	proposed: number
	/**
	 * The values not recorded, each in a sentence led by whose value it was
	 * (`Verity · …`, `The world · …`, a place's name): under Review changes
	 * the ones the gate would not hold; under Full the ones the book would
	 * not take (a story time its calendar cannot place, a retired slot). The
	 * callers hand it to the person who caused the recording (plan A18).
	 */
	refused: string[]
	/** Which owners got rows: `lorebook:3`, `cast_member:12`, `location:40`. */
	owners: string[]
	historyEntryId: number | null
	sceneId: number | null
}

/**
 * Record what this session's numbers are now, onto the world's timeline.
 *
 * ⚠ **Values and configurations both**, and that is not belt and braces: a
 * value is only meaningful against the configuration it was written under — a
 * 35 means one thing under a cap of 40 and is impossible under a cap of 20 —
 * and the plan's rule is that a value validates against the config valid at its
 * own anchor. Recording the value alone would put a number on the timeline with
 * no way to ever say what it meant.
 *
 * ⚠ A **derived** slot is never recorded. It has no value to store by
 * construction, and storing one guarantees staleness — the same rule
 * `checkSlotValue` refuses a write with.
 *
 * ⚠ Absent stays absent. A slot nobody has valued gets no row: "we did not
 * record a mood" and "her mood was nothing" are different claims, and only the
 * missing row can say the first.
 */
export async function recordToTimeline(
	db: Db,
	sessionId: number,
	opts: RecordOptions
): Promise<RecordReport> {
	const links = await recordedLinks(db, sessionId, opts.reason)
	const mode = await sessionLoreWriteMode(db, sessionId)
	const report: RecordReport = {
		recorded: false,
		route: null,
		lorebookId: null,
		mode,
		values: 0,
		configs: 0,
		proposed: 0,
		refused: [],
		owners: [],
		historyEntryId: opts.historyEntryId ?? null,
		sceneId: opts.sceneId ?? null
	}
	/**
	 * 🚧 Where it lands (PLAN-rulesets §26, brief P1-A): a capture or a mark
	 * goes to the attached book when the session may write it (its owner's
	 * book, Full), else to the session's own notes — no book, Review
	 * changes, Off or someone else's book. The notes take the WORLD's values
	 * (the session owner); a cast member's or a place's live in the real
	 * book, so they wait for a write the book can take.
	 *
	 * The delete safeguard never routes to the notes — they go with the
	 * session it records — and keeps the A22 table: Full and Review changes
	 * write the book, Off and no book record nothing.
	 */
	let lorebookId: number
	let route: "book" | "own-book"
	if (opts.reason === "delete") {
		if (!links.lorebookId || mode === "off") return report
		lorebookId = links.lorebookId
		route = "book"
	} else {
		const { loreWriteTargetFor } = await import("$lib/server/lorebooks/ownBook")
		const target = await loreWriteTargetFor(db, sessionId)
		lorebookId = target.lorebookId
		route = target.route
	}
	report.route = route
	report.lorebookId = lorebookId
	// Nothing is proposed from here: under Review changes a write waits in
	// the session's notes, as the overlay a review resolves
	// (`report.proposed` stays 0 for the callers that read it).

	const vocabulary = await vocabularyFor(db, sessionId, links)
	const storable = vocabulary.entries
		.map((e) => e.decl)
		.filter((d) => d.type !== "derived")
	if (!storable.length) return report

	const sourceMessageId = await newestMessageId(db, sessionId)
	const updatedBy = `session:${sessionId}`
	// ⚠ The session's LINE: a row filed as main (NULL) is SHARED — it reads
	// on main and on every branch — so a branch session's facts would leak
	// onto every line. The FK on `branch_id` cascades it away with the
	// branch, as the line's amendments and entries go.
	// The notes are never branched as a book, and the book's history is not
	// theirs to file under: main, undated (unless the caller named one).
	const reading =
		route === "own-book" ? null : (links.reading ?? (await sessionReadingOf(db, sessionId)))
	if (opts.historyEntryId === undefined && reading)
		report.historyEntryId = (await writeDatingAt(db, reading))?.historyEntryId ?? null
	if (route === "own-book" && opts.historyEntryId === undefined) report.historyEntryId = null
	const common = {
		branchId: reading?.branchId ?? null,
		historyEntryId: report.historyEntryId,
		sceneId: report.sceneId,
		sourceSessionId: sessionId,
		sourceMessageId,
		updatedBy,
		// A durable row is NOT session-scoped: `session_id` is the column that
		// makes the session layer disappear with its session, and this row is
		// the one that must not.
		sessionId: null,
		validFromMessageId: null,
		note: opts.note ?? null
	}

	/** One owner's whole state, read from the session and filed against the world. */
	const record = async (
		read: { kind: "session" | "session_cast" | "session_location"; id: number },
		write: { kind: "lorebook" | "cast_member" | "location"; id: number },
		facet: "world" | "cast" | "location",
		/** Whose values these are, to lead a refusal's sentence. */
		who: string,
		/** The book the owner is of, and the columns its rows carry. */
		into: { lorebookId: number; common: typeof common } = { lorebookId, common }
	) => {
		let wrote = false
		const refuse = (e: StateRefusal) => report.refused.push(`${who} · ${e.message}`)
		for (const decl of storable) {
			if (!decl.appliesTo.includes(facet)) continue
			const value = await valueOf(
				db,
				{
					sessionId,
					owner: read,
					slotId: decl.id
				},
				{ links, vocabulary }
			)
			if (value === undefined) continue
			// The configuration in force, as the whole resolved thing rather
			// than as this layer's deviations: a timeline row has no layers
			// underneath it to inherit from, so a deviation alone would resolve
			// to something different the day the declaration's own config moves.
			const config = await configFor(db, {
				sessionId,
				owner: read,
				slotId: decl.id
			})
			// Through the book's door (see the header), checked and written
			// under the book's lock (`lockBookCalendar`, A18(d)).
			try {
				await db.transaction(async (tx) => {
					await lockBookCalendar(tx, into.lorebookId)
					await validateValue(tx, {
						owner: write,
						slotId: decl.id,
						value: slotValueForStorage(value),
						config
					})
					await tx.insert(schema.attributeValues).values({
						ownerKind: write.kind,
						ownerId: write.id,
						slotId: decl.id,
						value: { v: value },
						...into.common
					})
					await tx.insert(schema.attributeConfigs).values({
						ownerKind: write.kind,
						ownerId: write.id,
						slotId: decl.id,
						config,
						...into.common
					})
				})
			} catch (e) {
				if (e instanceof StateRefusal) {
					refuse(e)
					continue
				}
				throw e
			}
			report.values++
			report.configs++
			wrote = true
		}
		if (wrote) report.owners.push(`${write.kind}:${write.id}`)
	}

	/**
	 * 🚧 The owners of the session's own notes (PLAN-rulesets §26): a place
	 * the notes hold, and a cast member bound there, file into the notes like
	 * the entries they are — main line, undated, anchored to the message.
	 * Under the book route a seat bound in the book files there instead.
	 */
	const recordOwnBookOwners = async (allCast: boolean) => {
		const { ownBookOf } = await import("$lib/server/lorebooks/ownBook")
		const ownBook = await ownBookOf(db, sessionId)
		if (!ownBook) return
		const into = {
			lorebookId: ownBook.id,
			common: { ...common, branchId: null, historyEntryId: null, sceneId: report.sceneId }
		}
		const { castMemberCards } = await import("$lib/server/utils/castMemberCards")
		const { memberOf } = await castMemberCards(db, ownBook.id)
		for (const member of links.cast) {
			const bound = memberOf.get(member.characterId)
			if (bound == null || (!allCast && member.castMemberId)) continue
			await record(
				{ kind: "session_cast", id: member.characterId },
				{ kind: "cast_member", id: bound },
				"cast",
				member.name,
				into
			)
		}
		for (const place of await placesOnReading(db, ownBook.id, MAIN_HEAD, "session"))
			await record(
				{ kind: "session_location", id: place.entryId },
				{ kind: "location", id: place.entryId },
				"location",
				place.name,
				into
			)
	}

	await record(
		{ kind: "session", id: sessionId },
		{ kind: "lorebook", id: lorebookId },
		"world",
		"The world"
	)
	if (opts.reason !== "delete") await recordOwnBookOwners(route === "own-book")
	if (route === "own-book") {
		report.recorded = report.values > 0 || report.configs > 0
		return report
	}
	for (const member of links.cast) {
		// Only a character bound into this world has a versioned cast member to
		// live beside. One that is not bound has nowhere on the timeline to be,
		// and inventing a binding here would be inventing a cast member the
		// author never put in their world.
		if (!member.castMemberId) continue
		await record(
			{ kind: "session_cast", id: member.characterId },
			{ kind: "cast_member", id: member.castMemberId },
			"cast",
			member.name
		)
	}
	// 🚧 Each place (phase 4), filed against its location entry — the
	// world's own record of what lay where. A location IS a lore entry of
	// this world, so unlike a character there is always somewhere to file it.
	// Which places: see `recordedLinks`.
	// The notes' own places file into the notes (`recordOwnBookOwners`).
	for (const place of links.locations.filter((l) => !l.sessionOnly))
		await record(
			{ kind: "session_location", id: place.entryId },
			{ kind: "location", id: place.entryId },
			"location",
			place.name
		)

	report.recorded = report.values > 0 || report.configs > 0
	return report
}

/**
 * The session's links as a recording reads them.
 *
 * ⚠ Which places (plan A27): the ones the session sees, except for the delete
 * safeguard, which records every place the BOOK sees — Off ones too (and so
 * the slots a sheet on one of them adds). A place switched Off, or off for a
 * while, is out of the session's story, so a capture leaves the session's
 * values there in the session, to be recorded by a capture once it is back
 * on; a deleted session has no later capture, and skipping the place would
 * lose them for good.
 */
async function recordedLinks(
	db: Db,
	sessionId: number,
	reason: RecordReason
): Promise<SessionLinks> {
	const links = await sessionLinks(db, sessionId)
	if (reason !== "delete" || !links.lorebookId) return links
	return {
		...links,
		locations: await placesOnReading(db, links.lorebookId, links.reading ?? MAIN_HEAD, "book")
	}
}

/**
 * The history entry a session's own moments hang from, or null.
 *
 * The newest scene the session has captured names one; a session that has never
 * been captured has none, and a null anchor is the honest answer — "this was
 * true at some point in this session" rather than a moment nobody wrote.
 */
export async function newestHistoryEntryOf(
	db: Db,
	sessionId: number
): Promise<{ historyEntryId: number | null; sceneId: number | null }> {
	const rows = await db
		.select({
			id: schema.scenes.id,
			historyEntryId: schema.scenes.historyEntryId
		})
		.from(schema.scenes)
		.where(eq(schema.scenes.sessionId, sessionId))
	let best: { id: number; historyEntryId: number } | undefined
	for (const row of rows) if (!best || row.id > best.id) best = row
	return {
		historyEntryId: best?.historyEntryId ?? null,
		sceneId: best?.id ?? null
	}
}
