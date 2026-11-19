/**
 * Core's side of the executor: the I/O a binding is not allowed to do itself.
 *
 * The executor sequences; the host performs effects. A binding describes what
 * it wants — "read these messages", "write this message" — and this module is
 * what actually touches the database. That split is not ceremony:
 *
 *   · it is the only way a **sidecar** Consumer can ever work, since a separate
 *     process has no database channel (F19). In-process and out-of-process
 *     Consumers obeying the same contract means the review gate sees the same
 *     thing in both cases — a payload, before anything has happened.
 *   · it keeps every effect inside the substrate the review gate, the budget
 *     and the receipt already sit in. A binding that closed over `db` would be
 *     outside all three, and nothing would look wrong until an admin asked why
 *     a run wrote something the receipt does not mention.
 *
 * Scope enforcement lives here too, for the same reason: the host is handed the
 * **node** that asked, so a Query's read is checked against what that spec is
 * allowed to see rather than against the query it happened to send (F30).
 */

import {
	and,
	asc,
	desc,
	eq,
	gte,
	isNotNull,
	isNull,
	sql,
	type SQL,
	getTableColumns
} from "drizzle-orm"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import * as schema from "$lib/server/db/schema"
import {
	WORLD_LORE_TYPE_ID,
	entryInsert,
	nextPosition
} from "$lib/server/utils/lorebookEntries"
import {
	entryDeclarations,
	isDeclaredEntryType
} from "$lib/server/entries/declarations"
import type {
	DeletionAskedPayload,
	MessageBlock,
	NodeRef,
	ParticipantRef
} from "@serene-pub/sdk"
import {
	isBuiltInSpec,
	isParticipantRef,
	parseParticipantRef,
	envoySlugOfRef,
	FORM_ADDRESSED_INLET_ID,
	DELETION_ASKED_INLET_ID,
	assignBlockHead,
	assignBlockIds,
	checkMessageBlocks,
	foldedSectionsOf,
	withFoldedSections,
	foreignBlockActions,
	formBlocksOf,
	formFireOf,
	formAnswerSchema,
	stampBlockActions,
	undeclaredBlockFunctions,
	effectsLineVerdict,
	i18nText,
	opensLiveRow
} from "@serene-pub/sdk"
import { randomUUID } from "node:crypto"
import { CORE_BLOCKS_PART } from "$lib/server/messages/blocks"
import { loreWriteRefusal, libraryWriteRefusal, pluginLibraryRefusal, seatWriteRefusal } from "$lib/server/messages/writes"
import {
	checkLoreSources,
	noteMessagesRead,
	recordLoreSources
} from "$lib/server/pipelines/runtime/loreSources"
import { findLoreMatch, resolveBind } from "$lib/server/pipelines/runtime/loreMatch"
import { announceHistorySettled, settleThrough } from "$lib/server/sessions/settle"
import type { RunArtifact } from "$lib/server/pipelines/runtime/receipts"
import { participantRowId } from "$lib/server/pipelines/runtime/portrayals"
import { noteTurnMessage } from "$lib/server/pipelines/runtime/runTurnMessage"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"
import { speakerRefOf } from "$lib/server/messages/sessionChanges"
import { errorWithoutQueryText } from "$lib/server/db/errors"
import type { LineReading } from "$lib/server/state/reading"
import { hostSeatRefOf } from "$lib/server/pipelines/prompt/seatCards"
import { storedSeatRef } from "$lib/server/state/seatRefs"
import { memberFormOn } from "$lib/server/state/memberForm"
import { maySpeakAsCard, parseSeatRef, seatOf } from "$lib/server/sessions/seats"
import { SHOW_SPRITE_SPEC_ID } from "@serene-pub/core-catalog"
import { attachedOrOwnBookOf, ownBookOf } from "$lib/server/lorebooks/ownBook"
import { RUN_LOCK_SENTENCES, castMemberLockedAgainstRuns, entryLockedAgainstRuns } from "$lib/shared/lorebooks/runLocks"
import { TIMELINE_OFF_SENTENCES, sessionTimelineOf } from "$lib/server/lorebooks/timeline"
import {
	asShownSprite,
	nextSpriteMetadata,
	type ShownSprite
} from "$lib/shared/sprites"
import {
	DEFAULT_CHANNEL,
	DEFAULT_LANE,
	byLaneThenTime,
	canonicalChannel,
	channelPrefixWhere,
	channelRefusal,
	channelsOf,
	channelSpansLanes,
	channelWhere,
	isAllChannels,
	parseChannel,
	resolveChannel,
	sessionChannelShaping,
	stalenessHead
} from "$lib/server/messages/channels"
import {
	type PendingFire,
	type HostScope,
	HostScopeError,
	forPeople,
	notePeopleHalt,
	peopleSentenceOf,
	type ChannelShaping,
	type CoreHostServices
} from "./host.types"
import {
	resolveLoreLinkEnd,
	loreLinkRequests,
	type LoreWriteLine,
	annexWriteBookOf,
	sessionLoreWriteTo,
	notesBesideBook,
	notesRowAnswering,
	historyDateOf,
	refuseYearlessHistoryDate,
	historyDayInNotes,
	forkedLoreLine,
	pendingLineFork,
	writeLoreLink,
	typedFieldsOf,
	exitsLineLinks
} from "./host.loreWrites"
import {
	legacyMessage,
	settledMessage,
	turnStrategyPin,
	scopeActorOwnsSession,
	liveCastRefs,
	annexOwnerOf,
	sameJson,
	narratorNameFor,
	refId,
	messageRefId,
	storedRefsOf,
	cardFormOfStored,
	loreVisibilitySubject,
	assertScoped,
	lorebookInScope,
	replaceSpokenAudio,
	mediaParts,
	foldedSectionsIn,
	withoutDiceNumbers,
	toMessage
} from "./host.helpers"
import {
	readLorebookEntries,
	speakerInCastOf,
	lorebookSpeakerRef
} from "./host.read.lorebookEntries"
import { readSessionCast } from "./host.read.sessionCast"
import { readSummarizeSource, readSummarizeSpan } from "./host.read.summarize"
import {
	readEmbeddingStatus,
	readVectorSearch,
	readEntityAnnotations,
	readRecalledLines,
	readMentionSpans,
	readEntityLink
} from "./host.read.retrieval"
import { hostCall } from "./host.call"
import { castWritesInFlight, castWriteEpoch } from "./sessionCastWrites"
export { narratorNameFor, STEP_TYPES_FOR_TEST } from "./host.helpers"
export {
	type PendingFire,
	type HostScope,
	HostScopeError,
	type CoreHostServices
} from "./host.types"

// db is the global Db — see db/types.d.ts

/** 🚧 ★ The receipt note when an update's date part was ignored because the lorebook keeps no timeline. */
export const DATE_NOT_CHANGED_SENTENCE = "date not changed: this lorebook keeps no timeline"

export function createHost(db: Db, scope: HostScope = {}): CoreHostServices {
	/**
	 * The live row's channel, once this run has opened it (W1). A run writes
	 * as often as it likes, but a second message on the reply's own channel
	 * is two rows racing for one place. The validator refuses that where the
	 * channel is a literal; a wired channel is known only here, so the host
	 * refuses the rest. One host serves one run, so the fact is the run's.
	 */
	let liveChannel: string | undefined
	/**
	 * The live row itself, so the write that FINISHES it can end the race
	 * (amended 2026-09-27, lair pass B16 — the SDK's F7 says the same): a
	 * settled row holds its place, and a message written after it lands after
	 * it. Before the finish, a second message on the channel still races.
	 */
	let liveRowId: number | undefined
	/**
	 * 🚧 The turn's message: the live row this run opened, kept after it
	 * settles. A row the run writes to the session's own notes anchors here
	 * (PLAN-rulesets §26, §29), so retaking the turn retracts it.
	 */
	let turnMessageId: number | undefined
	/**
	 * 🚧 **Where this run's lorebook writes file their lore imprints** (RF
	 * fix 4, 2026-10-23: what a message changed goes with it): the turn's
	 * message when the run opened one, else the session's newest — where
	 * the notes' rows anchor (`turnAnchorOf`). Null for a person's press —
	 * an action that opened no row (*File as a room*): what a person files
	 * is theirs, never taken back with a message. Read on the outer handle,
	 * before a write's transaction opens.
	 */
	const imprintAnchor = async (
		sessionId: number
	): Promise<import("$lib/server/lorebooks/imprints").ImprintAnchor | null> => {
		// The run's live row: this host's, else the one the run noted (a host
		// made again for the same run — a write resumed after its review).
		const { turnMessageOf } = await import("$lib/server/pipelines/runtime/runTurnMessage")
		const turn = turnMessageId ?? turnMessageOf(scope.runId)
		if (turn === undefined) {
			const { currentRunFamily } = await import("$lib/server/utils/llmQueue")
			if (currentRunFamily() === "action") return null
		}
		const { imprintAnchorFor } = await import("$lib/server/lorebooks/imprints")
		return imprintAnchorFor(db, sessionId, { turnMessageId: turn ?? null, runId: scope.runId ?? null })
	}
	/**
	 * 🚧 The anchor a link the notes took is imprinted with when `imprintAnchor`
	 * gave none (a press-started run, no turn message): the newest message the
	 * write's own rows anchor to, as an entry does. Only on the own-book route of
	 * a session that reads an attached lorebook, and only with a message.
	 */
	const linkAnchorOf = (
		sessionId: number,
		anchor: import("$lib/server/lorebooks/imprints").ImprintAnchor | null,
		target: { line: LoreWriteLine; sourceMessageId: number | null }
	): import("$lib/server/lorebooks/imprints").ImprintAnchor | null =>
		anchor === null && target.line.alsoReads && target.sourceMessageId !== null
			? { sessionId, messageId: target.sourceMessageId, runId: scope.runId ?? null }
			: null
	const racesLiveRow = (nodeKey: string, raw: unknown): string | null => {
		if (liveChannel === undefined) return null
		const channel = canonicalChannel(raw)
		return channel === liveChannel
			? `${nodeKey}: refused — a second message on channel '${channel}', the live row's channel; put it on the live row as blocks, or on another channel`
			: null
	}
	/** The refusal for a change that names an entry's own date, held or dated. */
	const neverAmendedSentence = (nodeKey: string, stored: typeof schema.lorebookEntries.$inferSelect) =>
		// 🚧 Provisional copy: the owner has not seen this sentence.
		`${nodeKey}: '${stored.title ?? `entry ${stored.id}`}' keeps its date in the lorebook, and a session's change cannot move it — change it in the lorebook.`
	/**
	 * 🚧 A session's change to an entry of its attached lorebook, held: one
	 * held amendment in the session's own book (`base` set), the lorebook
	 * untouched — no update, no imprint, no vector delete, no line fork. `data`
	 * is the change in the wire row's words (`name`, `content`, declared fields
	 * flat). Only the keys that differ from what the session reads now are kept,
	 * each with that value as `base` (what the session read when it wrote). Takes
	 * the advisory lock on the own book; `at` is the caller's open transaction.
	 */
	const holdLoreEntryChange = async (
		a: {
			nodeKey: string
			sessionId: number
			stored: typeof schema.lorebookEntries.$inferSelect
			data: Record<string, unknown>
		},
		at?: Db
	): Promise<boolean> => {
		const { nodeKey, sessionId, stored, data } = a
		if (!Object.keys(data).length) return false
		const { ownBookFor, turnAnchorOf } = await import("$lib/server/lorebooks/ownBook")
		const { sessionReadingOf } = await import("$lib/server/state/reading")
		const { entryOverlaysFor, entryAt, MAIN_HEAD } = await import("$lib/server/state/entriesOnReading")
		const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
		const { wrap, sameValue } = await import("$lib/server/lorebooks/imprints")
		const { NEVER_AMENDED } = await import("$lib/shared/lorebooks/amendments")
		const { turnMessageOf } = await import("$lib/server/pipelines/runtime/runTurnMessage")
		const { loreWriteDateOf, undatedLoreWriteRefusal } = await import("$lib/server/state/storyTime")
		const own = await ownBookFor(at ?? db, sessionId)
		const hold = async (tx: Db): Promise<boolean> => {
			await tx.execute(sql`select pg_advisory_xact_lock(${own.id})`)
			// The session's reading carries its own book as holder, so an earlier
			// held amendment of this session is part of what it read.
			const reading = (await sessionReadingOf(tx, sessionId)) ?? {
				...MAIN_HEAD,
				holderBookId: own.id
			}
			const overlays = await entryOverlaysFor(tx, stored.lorebookId, reading, [stored.id])
			const read = entryAt(toEntryRow(stored), overlays, reading) as unknown as Record<string, unknown>
			const kept = Object.keys(data).filter((k) => !sameValue(data[k], read[k]))
			if (!kept.length) return false
			if (kept.some((k) => NEVER_AMENDED.has(k)))
				throw new HostScopeError(neverAmendedSentence(nodeKey, stored))
			const written = await loreWriteDateOf(tx, sessionId)
			const day = written.kind === "dated" ? written.date : null
			const refusal = await undatedLoreWriteRefusal(tx, sessionId, day)
			if (refusal) throw forPeople(new HostScopeError(`${nodeKey}: ${refusal}`), refusal)
			await tx.insert(schema.entryAmendments).values({
				lorebookId: own.id,
				entryId: stored.id,
				branchId: null,
				year: day?.year ?? null,
				month: day?.month ?? null,
				day: day?.day ?? null,
				fields: Object.fromEntries(kept.map((k) => [k, data[k]])),
				base: Object.fromEntries(kept.map((k) => [k, wrap(read[k])])),
				sourceMessageId: await turnAnchorOf(tx, sessionId, turnMessageId ?? turnMessageOf(scope.runId))
			})
			return true
		}
		return at
			? hold(at)
			: db.transaction(async (tx) => hold(tx as unknown as Db))
	}
	/**
	 * Whether a session's change to an entry of the attached lorebook waits in
	 * its notes (`holdLoreEntryChange`) rather than being written: the one
	 * decision `changeLoreEntry` and the two outlets that report it share.
	 * `lorebookId` is the book the session's write lands in (`sessionLoreWriteTo`).
	 * It is written only when that is the entry's own lorebook (the `book` route:
	 * Full on a lorebook the owner owns) — as a dated version at the story's day
	 * when the session's story has a date (`loreWriteDateOf`: `dated`), else in
	 * place. It waits when the entry is on another line than the session's or
	 * that line is still to be forked; when the session holds a change on the
	 * entry already (a second one goes with it); and when the change is dated
	 * before the entry's Beginning.
	 */
	const lorebookChangeHeld = async (
		a: {
			sessionId: number
			lorebookId: number
			line: LoreWriteLine
			stored: typeof schema.lorebookEntries.$inferSelect
		},
		at?: Db
	): Promise<boolean> => {
		const { sessionId, lorebookId, line, stored } = a
		const dbx = at ?? db
		if (stored.lorebookId !== lorebookId) return true
		const { loreWriteDateOf } = await import("$lib/server/state/storyTime")
		const written = await loreWriteDateOf(dbx, sessionId)
		if (written.kind === "dated") {
			const { beginningRefusal } = await import("$lib/server/lorebooks/entryVersions")
			if (await beginningRefusal(dbx, lorebookId, stored.id, written.date)) return true
		}
		if (
			(stored.branchId ?? null) !== (line.branchId ?? null) ||
			(await pendingLineFork(dbx, sessionId, lorebookId))
		)
			return true
		const own = await ownBookOf(dbx, sessionId)
		if (!own) return false
		const [waiting] = await dbx
			.select({ id: schema.entryAmendments.id })
			.from(schema.entryAmendments)
			.where(
				and(
					eq(schema.entryAmendments.lorebookId, own.id),
					eq(schema.entryAmendments.entryId, stored.id),
					isNotNull(schema.entryAmendments.base)
				)
			)
			.limit(1)
		return !!waiting
	}
	/**
	 * Who the Edit history names for a write of this run: a person's press (no
	 * anchor, a `scope.userId`) files what is theirs as a `save`; any other write
	 * is the run's, under the routine's shown name, else the pipeline's (as
	 * `earmarkNotice` names it).
	 */
	const redlineAuthorOf = async (
		tx: Db,
		anchor: import("$lib/server/lorebooks/imprints").ImprintAnchor | null,
		sessionId: number
	) => {
		if (anchor == null && scope.userId != null)
			return { cause: "save" as const, by: { userId: scope.userId, sessionId } }
		const { routineRunOf } = await import("$lib/server/pipelines/routines/runs")
		const runId = anchor?.runId ?? scope.runId ?? null
		let shownAs = routineRunOf(runId)?.shownAs?.name?.trim() || null
		if (!shownAs && scope.specId) {
			const [spec] = await tx
				.select({ name: schema.pipelineSpecs.name })
				.from(schema.pipelineSpecs)
				.where(eq(schema.pipelineSpecs.slug, scope.specId))
				.limit(1)
			shownAs = spec?.name?.trim() || null
		}
		return {
			cause: "routine" as const,
			by: { run: { sessionId, messageId: anchor?.messageId ?? null, runId, shownAs } }
		}
	}
	/**
	 * 🚧 The write `update-lore-entry@1` makes, and `create-lore-entry@1` makes
	 * when its `match` finds the entry (pass 8, R-h): the name, the content
	 * and the typed-field patch onto a stored entry of the session's line,
	 * each changed field imprinted with what it held. `at` is the caller's
	 * open transaction with the book's lock held (the match path); absent,
	 * this opens its own and takes the lock, and only when something changes.
	 * A stored entry that is not in the session's own book is the attached
	 * lorebook's: its change is written under Full on the owner's own
	 * lorebook, and otherwise held (`lorebookChangeHeld`, `holdLoreEntryChange`).
	 * `held` is that decision when the caller already made it. Returns whether
	 * anything changed — the caller records it.
	 */
	const changeLoreEntry = async (
		a: {
			nodeKey: string
			sessionId: number
			lorebookId: number
			line: LoreWriteLine
			stored: typeof schema.lorebookEntries.$inferSelect
			patch: Record<string, unknown>
			name: unknown
			content: unknown
			anchor: import("$lib/server/lorebooks/imprints").ImprintAnchor | null
			/** 🚧 History days are filed through: never held (see `fileOntoHistoryDay`). */
			writeThrough?: true
			/** The caller's `lorebookChangeHeld` answer for a lorebook entry. */
			held?: boolean
			/** The run's receipt notes for this write: a date part ignored with the timeline off adds one. */
			notes?: string[]
		},
		at?: Db
	): Promise<boolean> => {
		const { nodeKey, lorebookId, line, stored, anchor } = a
		let patch = a.patch
		const entryId = stored.id
		const typeId = stored.typeId
		// A locked entry is left as it is, before any held decision or write: the
		// refusal is a note and `false`, never a throw, so the reply goes on.
		if (entryLockedAgainstRuns(stored)) {
			a.notes?.push(RUN_LOCK_SENTENCES.entry(`'${stored.title ?? `entry ${stored.id}`}'`))
			return false
		}
		// 🚧 With the timeline off an update's date parts (a Beginning's year, month
		// and day, or a history entry's date) are ignored, for every type that takes
		// one: stored dates survive a timeless session untouched, and the rest of the
		// change goes through. A part that would have changed the stored date says so
		// on the receipt (`a.notes`); a null part, or the stored one, says nothing.
		if (line.reading.timelineOff === true) {
			const { HISTORY_TYPE_ID } = await import("$lib/shared/entries/types")
			const { takesBeginning } = await import("$lib/server/utils/lorebookEntries")
			if (typeId === HISTORY_TYPE_ID || takesBeginning(typeId)) {
				const keptDate = (stored.fields ?? {}) as Record<string, unknown>
				if (
					(["year", "month", "day"] as const).some(
						(k) => patch[k] != null && patch[k] !== keptDate[k]
					)
				)
					a.notes?.push(DATE_NOT_CHANGED_SENTENCE)
				const { year, month, day, ...rest } = patch
				void year
				void month
				void day
				patch = rest
				if (
					!Object.keys(patch).length &&
					!(typeof a.name === "string" && a.name.trim()) &&
					typeof a.content !== "string"
				)
					return false
			}
		}
		if (!a.writeThrough && stored.lorebookId !== (await ownBookOf(at ?? db, a.sessionId))?.id) {
			const waits =
				a.held ?? (await lorebookChangeHeld({ sessionId: a.sessionId, lorebookId, line, stored }, at))
			if (waits) {
				const held: Record<string, unknown> = { ...patch }
				if (typeof a.name === "string" && a.name.trim()) held.name = a.name.trim()
				if (typeof a.content === "string") held.content = a.content
				return holdLoreEntryChange({ nodeKey, sessionId: a.sessionId, stored, data: held }, at)
			}
		}
		// A notes entry, or a history day filed through, is refused on another
		// line than the session's: a session about to fork its line stands on no
		// line of its own yet, so no stored row is on the line this write would
		// land on — refused here, before anything forks.
		if (
			(stored.branchId ?? null) !== (line.branchId ?? null) ||
			(await pendingLineFork(at ?? db, a.sessionId, lorebookId))
		)
		{
			const sentence = `'${stored.title ?? `entry ${entryId}`}' was written on another line of the book than the one this session plays, and a change to it there is an amendment — change it in the lorebook.`
			throw forPeople(new HostScopeError(`${nodeKey}: ${sentence}`), sentence)
		}
		const data: Record<string, unknown> = { ...patch }
		if (typeof a.name === "string" && a.name.trim()) data.name = a.name.trim()
		if (typeof a.content === "string") data.content = a.content
		// A lorebook entry changed by a session whose story has a date
		// (`loreWriteDateOf`: `dated`) is written as a dated version at that day,
		// never over the stored row.
		const attachedEntry =
			!a.writeThrough && stored.lorebookId !== (await ownBookOf(at ?? db, a.sessionId))?.id
		const { loreWriteDateOf, undatedLoreWriteRefusal } = await import("$lib/server/state/storyTime")
		const writtenDate = attachedEntry ? await loreWriteDateOf(at ?? db, a.sessionId) : null
		if (attachedEntry && writtenDate?.kind === "dated") {
			const { sessionId } = a
			const version = async (tx: Db): Promise<boolean> => {
				await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
				const { sessionReadingOf } = await import("$lib/server/state/reading")
				const { entryOverlaysFor, entryAt, MAIN_HEAD } = await import("$lib/server/state/entriesOnReading")
				const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
				const { sameValue, imprintMade, imprintField } = await import("$lib/server/lorebooks/imprints")
				const { NEVER_AMENDED } = await import("$lib/shared/lorebooks/amendments")
				const { beginningRefusal, writeEntryVersion } = await import("$lib/server/lorebooks/entryVersions")
				const { recordRedline } = await import("$lib/server/lorebooks/redlines")
				const reading = (await sessionReadingOf(tx, sessionId)) ?? { ...MAIN_HEAD }
				const overlays = await entryOverlaysFor(tx, stored.lorebookId, reading, [stored.id])
				const read = entryAt(toEntryRow(stored), overlays, reading) as unknown as Record<string, unknown>
				const kept = Object.keys(data).filter((k) => !sameValue(data[k], read[k]))
				if (!kept.length) return false
				if (kept.some((k) => NEVER_AMENDED.has(k)))
					throw new HostScopeError(neverAmendedSentence(nodeKey, stored))
				const date = writtenDate.date
				if (await beginningRefusal(tx, lorebookId, stored.id, date))
					return holdLoreEntryChange({ nodeKey, sessionId, stored, data }, tx)
				const fields = Object.fromEntries(kept.map((k) => [k, data[k]]))
				const written = await writeEntryVersion(tx, {
					lorebookId,
					entryId: stored.id,
					branchId: line.branchId ?? null,
					date,
					fields
				})
				const before = written.kind === "merged" ? written.before : {}
				if (anchor) {
					const subject = { lorebookId, subject: "version" as const, subjectId: written.id }
					if (written.kind === "made") await imprintMade(tx, anchor, subject)
					else
						for (const key of kept)
							await imprintField(tx, anchor, { ...subject, field: key }, before[key], written.after[key])
				}
				await recordRedline(tx, {
					entryId: stored.id,
					amendmentId: written.id,
					before,
					after: written.after,
					keys: kept,
					...(await redlineAuthorOf(tx, anchor, sessionId))
				})
				return true
			}
			return at
				? version(at)
				: db.transaction(async (tx) => version(tx as unknown as Db))
		}
		if (attachedEntry) {
			// The backstop: an attached lorebook's entry is never written in place by a dated story.
			const refusal = await undatedLoreWriteRefusal(at ?? db, a.sessionId, null)
			if (refusal) throw forPeople(new HostScopeError(`${nodeKey}: ${refusal}`), refusal)
		}
		const { splitUpdate, mergeFields } = await import("$lib/server/utils/lorebookEntries")
		const { columns, fields: fieldPatch } = splitUpdate(typeId, data)
		const set = {
			...columns,
			...(Object.keys(fieldPatch).length ? { fields: mergeFields(fieldPatch) } : {})
		}
		if (!Object.keys(set).length) return false
		// 🚧 RF fix 4: each field it changed, imprinted with what it held.
		const { imprintChanges, entryFieldAddress } = await import("$lib/server/lorebooks/imprints")
		const write = async (tx: Db) => {
			const [was] = await tx
				.select()
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.id, entryId))
				.limit(1)
			const wrote = await tx
				.update(schema.lorebookEntries)
				.set({ ...set, updatedAt: new Date() })
				.where(eq(schema.lorebookEntries.id, entryId))
				.returning()
			if (anchor && was && wrote[0])
				await imprintChanges(
					tx,
					anchor,
					{ lorebookId, subject: "entry", subjectId: entryId },
					was as Record<string, unknown>,
					wrote[0] as Record<string, unknown>,
					[...Object.keys(columns), ...Object.keys(fieldPatch).map(entryFieldAddress)]
				)
			// The Edit history's row for this write (a held change, returned above, records none).
			if (was && wrote[0]) {
				const { recordEntryRedline } = await import("$lib/server/lorebooks/redlines")
				await recordEntryRedline(tx, {
					before: was as Record<string, unknown>,
					after: wrote[0] as Record<string, unknown>,
					named: [...Object.keys(columns), ...Object.keys(fieldPatch).map(entryFieldAddress)],
					...(await redlineAuthorOf(tx, anchor, a.sessionId))
				})
			}
			return wrote
		}
		const [updated] = at
			? await write(at)
			: await db.transaction(async (tx) => {
					await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
					return write(tx as unknown as Db)
				})
		// What the default space embeds moved (`[title, content]`):
		// its vector is stale until the queue embeds it again.
		if (
			updated &&
			((updated.title ?? "") !== (stored.title ?? "") ||
				(updated.content ?? "") !== (stored.content ?? ""))
		) {
			const { DEFAULT_VECTOR_NAME } = await import("$lib/server/utils/lorebookEntries")
			await (at ?? db)
				.delete(schema.lorebookEntryVectors)
				.where(
					and(
						eq(schema.lorebookEntryVectors.entryId, entryId),
						eq(schema.lorebookEntryVectors.vectorName, DEFAULT_VECTOR_NAME)
					)
				)
		}
		return true
	}
	/**
	 * 🚧 The write `create-lore-entry@1` makes for a history entry: history
	 * has one entry per day, so a second write for a date is filed onto the
	 * day's entry (a paragraph after what it holds), never a second row. The
	 * date is the caller's (`historyDateOf`); none is refused (never Year 1 by
	 * default). Inside the caller's
	 * transaction, which holds the book's lock; the content change is
	 * `changeLoreEntry`'s, imprinted, and a day entry this made is imprinted
	 * as made first, so a retake removes it after reverting its content.
	 */
	const fileOntoHistoryDay = async (
		tx: Db,
		a: {
			nodeKey: string
			sessionId: number
			lorebookId: number
			line: LoreWriteLine
			fields: Record<string, unknown>
			/** The day the write files under (`historyDateOf`); null is refused. */
			date: { year: number; month: number | null; day: number | null } | null
			content: string
			sourceMessageId: number | null
			anchor: import("$lib/server/lorebooks/imprints").ImprintAnchor | null
		}
	): Promise<{
		row: typeof schema.lorebookEntries.$inferSelect
		created: boolean
		changed: boolean
		note: string | null
	}> => {
		const { nodeKey, lorebookId, line, fields, anchor, date } = a
		const { assertDateLands, bookCalendarOf } = await import("$lib/server/state/storyTime")
		const { historyEntryOfDate, historyDayOwnerRefusal } = await import(
			"$lib/server/scenes/historyEntryOfDate"
		)
		const { imprintMade } = await import("$lib/server/lorebooks/imprints")
		const { formatDate, dayOnly } = await import("$lib/shared/lorebooks/storyDate")
		const { BranchRefusal } = await import("$lib/server/state/reading")
		// 🚧 On the own-book route of a session that reads an attached lorebook:
		// a date is checked against the lorebook's calendar, never the notes' own.
		const calendarBookId = line.alsoReads?.lorebookId ?? lorebookId
		if (!date)
			// 🚧 Provisional copy: the owner has not seen this sentence.
			throw new HostScopeError(
				`${nodeKey}: history needs a date. Give this write a year in its fields, or give the story a dated history entry first.`
			)
		let day: Awaited<ReturnType<typeof historyEntryOfDate>>
		try {
			await assertDateLands(tx, calendarBookId, date)
			const refusal = await historyDayOwnerRefusal(tx, {
				lorebookId,
				branchId: line.branchId,
				date
			})
			if (refusal) throw new Error(refusal)
			day = await historyEntryOfDate(
				tx,
				{ lorebookId, branchId: line.branchId, date },
				{ create: true, calendarBookId }
			)
		} catch (e) {
			// Only refusals are worded: the asserts throw plain `Error`s, a foreign
			// branch a `BranchRefusal`; a database fault passes through unchanged.
			if (e instanceof Error && (e.constructor === Error || e instanceof BranchRefusal))
				throw new HostScopeError(`${nodeKey}: ${e.message}`, { cause: e })
			throw e
		}
		if (day.created)
			await tx
				.update(schema.lorebookEntries)
				.set({ provenance: "pipeline", sourceMessageId: a.sourceMessageId })
				.where(eq(schema.lorebookEntries.id, day.historyEntryId))
		const [stored] = await tx
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, day.historyEntryId))
			.limit(1)
		if (!stored)
			throw new HostScopeError(`${nodeKey}: entry ${day.historyEntryId} is no longer in this session's lorebook.`)
		if (day.created && anchor)
			await imprintMade(tx, anchor, {
				lorebookId,
				subject: "entry",
				subjectId: stored.id
			})
		const held = stored.content ?? ""
		const content = !a.content.trim()
			? held
			: !held.trim()
				? a.content
				: `${held.trimEnd()}\n\n${a.content}`
		const {
			year: _year,
			month: _month,
			day: _day,
			...patch
		} = fields
		const lockNotes: string[] = []
		const changed = await changeLoreEntry(
			{
				nodeKey,
				sessionId: a.sessionId,
				lorebookId,
				line,
				stored,
				patch,
				name: undefined,
				content,
				anchor,
				// History days stay written through (a later Stage B lane's).
				writeThrough: true,
				notes: lockNotes
			},
			tx
		)
		const [row] = await tx
			.select()
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, stored.id))
			.limit(1)
		const note = entryLockedAgainstRuns(stored)
			? (lockNotes[0] ?? null)
			: day.created
				? null
				: `filed onto ${formatDate(dayOnly(day.date), await bookCalendarOf(tx, calendarBookId))}'s entry`
		return { row: row ?? stored, created: day.created, changed, note }
	}
	/**
	 * 🚧 After a generated lore write's transaction committed: tell the room
	 * the settle line moved (nothing when it did not, or when no person
	 * started the run).
	 */
	const announceSettled = async (
		sessionId: number,
		settled: {
			moved: boolean
			settledMessageId: number | null
			previousSettledMessageId: number | null
		} | null
	): Promise<void> => {
		if (!settled || scope.userId === undefined) return
		await announceHistorySettled(db, {
			sessionId,
			userId: scope.userId,
			moved: settled.moved,
			settledMessageId: settled.settledMessageId,
			previousSettledMessageId: settled.previousSettledMessageId,
			io: scope.io
		})
	}
	/**
	 * The genre's per-channel prompt shaping (R-C), read **once per host**.
	 *
	 * A fact about the genre, and a genre does not change under a run, so a
	 * turn that reads history several times pays for one registry lookup
	 * rather than one per read. `null` — the answer for every genre that
	 * declares only bare slugs — is cached like any other answer, so the
	 * ordinary session pays once and then nothing.
	 */
	const shapingBySession = new Map<
		number,
		Promise<ChannelShaping | null>
	>()
	/** 🚧 Whether a session's prompts read dice rows without numbers (D3) — once per host. */
	const diceHiddenBySession = new Map<number, Promise<boolean>>()
	const diceHiddenFor = (sessionId: number): Promise<boolean> => {
		let cached = diceHiddenBySession.get(sessionId)
		if (!cached) {
			cached = (async () => {
				const { genreFieldsFor } = await import("$lib/server/pipelines/entities/sessionGenres")
				const { diceHidden } = await import("$lib/server/messages/diceWords")
				return diceHidden(await genreFieldsFor(db, sessionId))
			})()
			diceHiddenBySession.set(sessionId, cached)
		}
		return cached
	}
	const channelShaping = (
		sessionId: number
	): Promise<ChannelShaping | null> => {
		let cached = shapingBySession.get(sessionId)
		if (!cached) {
			cached = sessionChannelShaping(db, sessionId)
			shapingBySession.set(sessionId, cached)
		}
		return cached
	}
	/**
	 * The session's current narrator name (`narratorNameFor`: a whole config
	 * world built for the narrate spec), read **once per host (one run)**.
	 *
	 * Nothing inside a run writes its inputs: no host or binding writes the
	 * pipeline config, prompts, presets, registrations or connections, nor
	 * the session's genre or preset (`convert-ruleset` writes only
	 * `sessions.ruleset_version`, which the resolver does not read). The
	 * next run builds a new host, so an edit between runs is always seen;
	 * nothing is cached across runs. A failed read is not remembered: the
	 * entry is dropped and the caller gets the rejection, as before.
	 */
	const narratorNameBySession = new Map<number, Promise<string | null>>()
	const narratorNameOf = (sessionId: number): Promise<string | null> => {
		let cached = narratorNameBySession.get(sessionId)
		if (!cached) {
			cached = narratorNameFor(db, sessionId, undefined)
			narratorNameBySession.set(sessionId, cached)
			cached.catch(() => narratorNameBySession.delete(sessionId))
		}
		return cached
	}
	/**
	 * The `session_cast` read, memoised **once per host (one run)** and keyed by
	 * session id: one reply's retrieval lanes ask for the same cast with the
	 * same arguments and no write between.
	 *
	 * The memo is neither read nor written while a `host.call` or `host.commit`
	 * is in flight on this host, or while a `castWrite` (a write made outside
	 * those two) is in flight: every read then goes to the database. It is
	 * cleared when the in-flight count rises from 0 and when it returns to 0,
	 * and an entry stored before a `castWrite` began or ended is dropped. A
	 * failed read is not remembered. The next run builds a new host; nothing
	 * is cached across runs. A hit is a `structuredClone`, so each caller
	 * still gets a fresh object it may mutate and the memo's copy is never
	 * touched. A write made by anything other than this run's host, binding
	 * or tool doors (another request) is not seen.
	 */
	const sessionCastReads = new Map<number, Promise<unknown>>()
	let sessionCastEpoch = 0
	let hostInFlight = 0
	const enterHostWrite = () => {
		if (hostInFlight++ === 0) sessionCastReads.clear()
	}
	const leaveHostWrite = () => {
		if (--hostInFlight === 0) sessionCastReads.clear()
	}
	/**
	 * The `lorebook_entries` read's per-run memo (plan C4): one book read per
	 * session, book and reading, with its scans inside. See the case. Cleared
	 * by the one lore write this host makes, `core:outlet/create-lore-entry`.
	 */
	const lorebookReads = new Map<string, Promise<any>>()

	/**
	 * A row this run wrote, announced to everyone in the session. The trigger
	 * announces nothing of its own. A no-op with no socket server on the scope
	 * (see `HostScope.io`).
	 */
	const announce = async (row: {
		sessionId: number
		[k: string]: unknown
	}) => {
		if (!scope.io) return
		await broadcastToSessionUsers(
			scope.io,
			row.sessionId,
			"sessionMessage",
			{
				sessionMessage: row
			}
		)
	}

	/**
	 * The same announcement with the row's parts attached — for a row that
	 * just gained a block tree (U5d), so the client renders the buttons off
	 * the frame rather than after a reload. The plain `announce` stays for
	 * every other write: its frame is the legacy row, which is what the live
	 * stream and the parity gate compare.
	 */
	const announceWithParts = async (messageId: number) => {
		if (!scope.io) return
		const row = await legacyMessage(db, messageId)
		if (!row) return
		const { attachParts } = await import("$lib/server/messages/store")
		const [withParts] = await attachParts(db, [row])
		await announce(withParts ?? row)
	}

	/**
	 * The annex write (§4.3), shared by `set-session-annex` and the annex
	 * field's `set-annex-field` (2026-09-26): one owner's document, merged
	 * into what is there unless `merge` is off, under
	 * `pg_advisory_xact_lock(hashtext('annex'), sessionId)` through
	 * `jsonb_set`; the artifact, `annex-changed` and every member's view
	 * re-sent when the value moved.
	 *
	 * The callers have already held the write to the owner's **annex
	 * declaration** (ruling 2026-09-26) and hand over, per key written, the
	 * audience it declares (R57) — stored beside the value, so the stored
	 * audience is always the declaration's. A key the declaration does not
	 * cover (`declared` lacks it) is **legacy**: written before the ruling,
	 * never writable again, kept — `merge` off replaces the declared keys
	 * and leaves those where they are, so no write loses data it could not
	 * itself have written.
	 *
	 * 🚧 `base` (M2a a8) is compare-and-set: the owner's **annex document
	 * version** the writer read (`session-annex`'s `version`). Under the
	 * lock, a `base` that is not the stored version writes nothing — the
	 * result says `stale` and carries the fresh document and its version,
	 * never a silent overwrite. Every write that moves the document bumps
	 * the version (`bumpedAnnexVersionsSql`), with or without a `base`.
	 */
	const writeAnnexDocument = async (
		node: NodeRef,
		sessionId: number,
		owner: string,
		value: Record<string, unknown>,
		merge: boolean,
		audienceOf: Record<string, readonly string[]>,
		declared: ReadonlySet<string>,
		base?: number
	) => {
		const { canonicalParticipantRef } = await import("@serene-pub/sdk")
		// Stored in each reference's one spelling, so every reader's
		// lookup — keyed canonically — finds it.
		const canonical = (refs: readonly string[] | undefined) =>
			[...new Set((refs ?? []).map((r) => canonicalParticipantRef(r)))].sort()
		// 🚧 seat-cast S3: an audience is stored in the card form — each
		// `seated-member:<memberId>` ref goes through the door first, before
		// the transaction opens; a member no seat of this session holds is
		// dropped from the stored audience (never stored raw).
		const seatedAudienceOf: Record<string, readonly string[]> = {}
		for (const key of Object.keys(value))
			seatedAudienceOf[key] = await storedRefsOf(db, sessionId, audienceOf[key])
		// 🚧 pr-6 (A4, B5): the change is anchored to the turn — read before the
		// transaction opens (only `tx` inside it).
		// A person's press that opened no row anchors to the session's newest
		// message, as own-book lore writes do (`turnAnchorOf`) — except the
		// person's own value set through an annex field's action, which stands.
		const { ANNEX_FIELD_SPEC_ID } = await import("@serene-pub/sdk")
		const anchor =
			(await imprintAnchor(sessionId)) ??
			(scope.specId === ANNEX_FIELD_SPEC_ID
				? null
				: await (await import("$lib/server/lorebooks/imprints")).imprintAnchorFor(db, sessionId, {
						turnMessageId: null,
						runId: scope.runId ?? null
					}))
		const { ownerVersionOf } = await import("$lib/server/plugins/annexMigrate")
		const ownerVersion = await ownerVersionOf(db, owner)
		const { isTimelessAnnexKey } = await import("$lib/server/sessions/annexChanges")
		const { fileSessionImprint, annexImprintKey } = await import("$lib/server/sessions/sessionImprints")
		const { annexVersionOf, bumpedAnnexVersionsSql } = await import("$lib/server/sessions/annexVersions")
		const annex = await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(hashtext('annex'), ${sessionId})`
			)
			const [current] = await tx
				.select({
					annex: schema.sessions.annex,
					audiences: schema.sessions.annexAudiences,
					versions: schema.sessions.annexVersions
				})
				.from(schema.sessions)
				.where(eq(schema.sessions.id, sessionId))
				.limit(1)
			if (!current) return null
			const held = (current.annex ?? {}) as Record<string, unknown>
			const previous =
				held[owner] && typeof held[owner] === "object" &&
				!Array.isArray(held[owner])
					? (held[owner] as Record<string, unknown>)
					: {}
			const version = annexVersionOf(current.versions, owner)
			// A write built on a read the document has since moved past.
			if (base !== undefined && base !== version)
				return { previous, next: previous, changed: false, seen: false, stale: true, version }
			const heldAudiences = (
				(current.audiences ?? {}) as Record<string, Record<string, string[]>>
			)[owner] ?? {}
			// Legacy keys (no declaration covers them) survive a replace.
			const legacy = Object.fromEntries(
				Object.entries(previous).filter(([k]) => !declared.has(k))
			)
			const next = merge ? { ...previous, ...value } : { ...legacy, ...value }
			const nextAudiences: Record<string, string[]> = merge
				? { ...heldAudiences }
				: Object.fromEntries(
						Object.entries(heldAudiences).filter(([k]) => !declared.has(k))
					)
			for (const key of Object.keys(value)) {
				const see = canonical(seatedAudienceOf[key])
				if (see.length) nextAudiences[key] = see
				else delete nextAudiences[key]
			}
			if (sameJson(previous, next) && Object.hasOwn(held, owner))
				return { previous, next, changed: false, seen: false, stale: false, version }
			// Whether anybody's view can have moved: a value somebody
			// may see was written, or one they could see was dropped.
			// A pipelines-only write — most of them — pushes nothing.
			const seen =
				Object.keys(value).some((k) => (nextAudiences[k]?.length ?? 0) > 0) ||
				Object.keys(heldAudiences).some((k) => !Object.hasOwn(nextAudiences, k))
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
					{ sessionId, messageId: anchor?.messageId ?? null, runId: scope.runId ?? null },
					{ kind: "annex", key: annexImprintKey(owner, k) },
					previous[k],
					next[k],
					{
						ownerVersion,
						audienceBefore: heldAudiences[k] ?? null,
						audienceAfter: nextAudiences[k] ?? null
					}
				)
			}
			return { previous, next, changed: true, seen, stale: false, version: version + 1 }
		})
		if (annex === null)
			throw new HostScopeError(
				`${node.key}: session ${sessionId} no longer exists`
			)
		// 🚧 Stale (M2a a8): nothing written, nothing emitted — the fresh
		// document and its version go back, for the spec to build on again.
		if (annex.stale)
			return {
				written: false,
				stale: true,
				sessionId,
				owner,
				annex: annex.previous,
				version: annex.version,
				notes: [
					`not written: the annex of '${owner}' moved since this run read it (version ${base}, now ${annex.version}) — the fresh document is on the annex port`
				]
			}
		// An unchanged write wrote nothing: no artifact, no event.
		if (annex.changed) record(node, "session", sessionId, "updated")
		// `annex-changed` (R30/R45): the one event a pipeline's own
		// state causes, after the transaction (the emitter's plugin
		// fan-out must never run inside one) and only when the value
		// moved — so a spec bound to it that rewrites the same value
		// cannot feed itself.
		if (annex.changed)
			await emit(
				"core:event/annex-changed@1",
				{ sessionId, owner },
				{ kind: "run" },
				{ asChild: true }
			)
		// 🚧 *Mark goals reached* (lane 2, 2026-10-19): a goal newly
		// ticked in the Story's goals note — by the sweep or by a person's
		// own edit — is said once on the session and told to every member.
		if (annex.changed && owner === "core") {
			const { noteGoalsReached } = await import("$lib/server/sessions/goalsReached")
			await noteGoalsReached(db, scope.io, sessionId, annex.previous, annex.next).catch((err) =>
				console.warn(`[goals] the goal-reached note for session ${sessionId} failed:`, err)
			)
		}
		// Every member's own view, re-sent (R57): what each may see
		// of the annex, never the annex.
		if (annex.changed && annex.seen && scope.io) {
			const { pushAnnexViews } = await import("$lib/server/sessions/annexViews")
			await pushAnnexViews(db, scope.io, sessionId).catch((err) =>
				console.warn(`[annex] the view push for session ${sessionId} failed:`, err)
			)
		}
		// An unchanged document wrote nothing, and says so: the
		// executor then skips the write's event (M3/W1).
		return {
			written: annex.changed,
			sessionId,
			owner,
			annex: annex.next,
			version: annex.version
		}
	}

	/**
	 * 🚧 One owner's document written into the **lorebook annex** (M0,
	 * SHAPES L9) — `writeAnnexDocument`'s twin at book scope, over the same
	 * declaration-held write. `at` is the host's scope: a session routes like
	 * every lore write (`loreWriteRefusal`, then `sessionLoreWriteTo` — the
	 * attached book when writable, else the session's own book), and its
	 * change is anchored to the turn and filed as an imprint (subject
	 * `annex`), retractable and settled with the stretch. No session but a
	 * lorebook in scope (a book-level run): that book, lasting at once — no
	 * anchor, no imprint.
	 */
	const writeLorebookAnnexDocument = async (
		node: NodeRef,
		at: Pick<HostScope, "sessionId" | "lorebookId">,
		owner: string,
		value: Record<string, unknown>,
		merge: boolean,
		audienceOf: Record<string, readonly string[]>,
		declared: ReadonlySet<string>,
		/** 🚧 (M2b) Compare-and-set on the owner's annex document version on the book (`lorebook-annex`'s `version`). */
		base?: number
	) => {
		const sessionId = at.sessionId
		if (sessionId === undefined && at.lorebookId == null)
			throw new HostScopeError(
				"This step writes a lorebook's annex: run it in a session or on a lorebook."
			)
		let lorebookId: number
		let anchor: import("$lib/server/lorebooks/imprints").ImprintAnchor | null = null
		if (sessionId !== undefined) {
			const noLore = await loreWriteRefusal(db, sessionId)
			if (noLore) throw forPeople(new HostScopeError(`${node.key}: ${noLore}`), noLore)
			lorebookId = await annexWriteBookOf(db, sessionId, turnMessageId)
			anchor = await imprintAnchor(sessionId)
		} else lorebookId = at.lorebookId!
		const { writeLorebookAnnex, pushLorebookAnnexViews } = await import("$lib/server/lorebooks/annex")
		// 🚧 seat-cast S3: in a session, each `seated-member:<memberId>` in an
		// audience goes through the door into the card form it is stored in (a
		// member no seat holds is dropped). A book-level run has no session to
		// seat a member in, so its audience is stored as declared.
		const seatedAudienceOf: Record<string, readonly string[]> = {}
		for (const [key, refs] of Object.entries(audienceOf))
			seatedAudienceOf[key] =
				sessionId !== undefined ? await storedRefsOf(db, sessionId, refs) : refs
		const done = await writeLorebookAnnex(db, {
			lorebookId,
			owner,
			value,
			merge,
			audienceOf: seatedAudienceOf,
			declared,
			anchor,
			...(base !== undefined ? { base } : {})
		})
		// 🚧 (M2b) Stale: nothing written, nothing emitted — the fresh document and its version go back.
		if (done.stale)
			return {
				written: false,
				stale: true,
				lorebookId,
				owner,
				annex: done.annex,
				version: done.version,
				notes: [
					`not written: the lorebook annex of '${owner}' moved since this run read it (version ${base}, now ${done.version}) — the fresh document is on the annex port`
				]
			}
		// An unchanged write wrote nothing: no artifact, no event.
		if (done.changed) {
			if (sessionId !== undefined) record(node, "session", sessionId, "updated")
			// After the transaction (the emitter's plugin fan-out must never run
			// inside one), and only when a value moved.
			if (sessionId !== undefined)
				await emit(
					"core:event/lorebook-annex-changed@1",
					{ sessionId, lorebookId, owner, keys: done.keys },
					{ kind: "run" },
					{ asChild: true }
				)
			else {
				try {
					const { pluginEvents } = await import("$lib/server/plugins/eventHost")
					const { getManager } = await import("$lib/server/plugins")
					const now = Date.now()
					await pluginEvents().notify(
						getManager(),
						"core:event/lorebook-annex-changed@1",
						{
							event: "core:event/lorebook-annex-changed@1",
							lorebookId,
							at: now,
							owner,
							keys: done.keys
						},
						{ nowMs: now }
					)
				} catch (err) {
					console.warn(`[lorebookAnnex] plugin fan-out for lorebook ${lorebookId} failed:`, err)
				}
			}
			// Every member's own view, re-sent: of this session, or of every
			// session that reads this book (attached to it, or its own book).
			if (scope.io) {
				const readers =
					sessionId !== undefined
						? [sessionId]
						: [
								...(
									await db
										.select({ id: schema.sessions.id })
										.from(schema.sessions)
										.where(eq(schema.sessions.lorebookId, lorebookId))
								).map((r) => r.id),
								...(
									await db
										.select({ id: schema.lorebooks.sessionId })
										.from(schema.lorebooks)
										.where(eq(schema.lorebooks.id, lorebookId))
								)
									.map((r) => r.id)
									.filter((id): id is number => id != null)
							]
				for (const id of new Set(readers))
					await pushLorebookAnnexViews(db, scope.io, id).catch((err) =>
						console.warn(`[lorebookAnnex] the view push for session ${id} failed:`, err)
					)
			}
		}
		return { written: done.changed, lorebookId, owner, annex: done.annex, version: done.version }
	}

	/**
	 * Write down a row this run just made.
	 *
	 * Called at the write, by the code that did it — never reconstructed
	 * afterwards from a node's published output. Two reasons it cannot be:
	 * every commit publishes its own shape, and the outputs are redacted for a
	 * non-admin reading their own receipt, so the ids are not reliably there to
	 * read. A no-op when the host has no collector (see `HostScope.artifacts`).
	 */
	const record = (
		node: NodeRef,
		kind: RunArtifact["kind"],
		entityId: unknown,
		action: RunArtifact["action"]
	) => {
		if (!scope.artifacts || typeof entityId !== "number") return
		scope.artifacts.push({ kind, entityId, action, nodeKey: node.key })
	}

	/**
	 * 🚧 (M2c, path B) The three **library** outlets (`create-character`,
	 * `update-character`, `create-lorebook`): the genre must
	 * declare the write (`writes.library`, absent is off), the ACTING PERSON
	 * (`actingPersonFor` — a press or a send by `scope.userId`, a routine by
	 * the session's owner) must be allowed it (`personMay`), and their library
	 * write mode decides whether it lands (Full, an `applied` row), waits for
	 * their Accept (Review, a `pending` row, `main` = `{ proposed }`) or halts
	 * (Off). `library/writes.ts` holds the writers, the undo and the redo.
	 */
	const libraryOutlet = async (
		node: NodeRef,
		op: import("$lib/server/library/writes").LibraryOp,
		p: Record<string, any>
	): Promise<Record<string, unknown>> => {
		const lib = await import("$lib/server/library/writes")
		const sessionId = scope.sessionId
		if (sessionId === undefined)
			throw new HostScopeError(
				`${node.key} has no session to act in — the run was started without a session scope`
			)
		const input: Record<string, unknown> = {}
		if (op === "create-character") input.card = p.card
		else if (op === "update-character") {
			input.characterId = p.characterId
			input.changes = p.changes
		} else input.lorebook = p.lorebook
		const needs: import("$lib/server/messages/writes").LibraryNeed[] =
			op === "create-character" || op === "update-character" ? ["characters"] : ["lorebooks"]
		// 🚧 (ruling b1') a plugin's pipeline, or a plugin genre's session, writes nothing to anyone's library yet
		const pluginNo = await pluginLibraryRefusal(db, sessionId, scope.ownerPluginId)
		if (pluginNo) throw new HostScopeError(`${node.key}: ${pluginNo}`)
		for (const need of needs) {
			const no = await libraryWriteRefusal(db, sessionId, need)
			if (no) throw forPeople(new HostScopeError(`${node.key}: ${no}`), no)
		}
		const { actingPersonFor } = await import("$lib/server/auth/actingPerson")
		const person = await actingPersonFor(
			db,
			scope.userId != null
				? { via: "press", userId: scope.userId }
				: { via: "routine", sessionId }
		)
		if (!person) return { halt: `${node.key}: ${lib.NOBODY_ACTING_SENTENCE}` }
		const mode = await lib.libraryWriteModeFor(db, person.userId)
		const ctx = { sessionId, updatedBy: `run:${scope.runId ?? "unknown"}` }
		const made = (
			applied: import("$lib/server/library/writes").LibraryApplied
		): Record<string, unknown> => ({
			written: true,
			label: applied.label,
			...(applied.result.characterId !== undefined ? { characterId: applied.result.characterId } : {}),
			...(applied.result.lorebookId !== undefined ? { lorebookId: applied.result.lorebookId } : {})
		})
		try {
			// 🚧 Off: nothing is made, and the session says why — a skipped line beside the reply, as a Time passes
			// with no clock writes one. Not a halt: by now the reply has settled, and a halted run's reason reaches
			// nobody but the Runs list (M2c re-proof).
			if (mode === "off") {
				const { label } = await lib.describeLibraryChange(db, person, op, input)
				await lib.fileLibraryChange(
					db,
					ctx,
					{ kind: "library", op, input, by: person.userId, label, skipped: lib.LIBRARY_OFF_SENTENCE },
					"skipped"
				)
				return { written: false, skipped: lib.LIBRARY_OFF_SENTENCE }
			}
			if (mode === "review") {
				const { label } = await lib.describeLibraryChange(db, person, op, input)
				const proposed = await lib.fileLibraryChange(
					db,
					ctx,
					{ kind: "library", op, input, by: person.userId, label },
					"pending"
				)
				return { written: false, proposed }
			}
			const applied = await lib.applyLibraryChange(db, person, op, input)
			await lib.fileLibraryChange(
				db,
				ctx,
				{ kind: "library", op, input, by: person.userId, ...applied },
				"applied"
			)
			const kind: RunArtifact["kind"] =
				op === "create-character" || op === "update-character" ? "character" : "lorebook"
			const id = applied.result.characterId ?? applied.result.lorebookId
			record(node, kind, id, op === "update-character" ? "updated" : "created")
			return made(applied)
		} catch (e) {
			if (e instanceof lib.LibraryWriteRefusal)
				return forPeople({ halt: `${node.key}: ${e.message}` }, peopleSentenceOf(e))
			throw e
		}
	}

	/**
	 * A session event this run's write caused (PLAN-turn-order §4.1, A2),
	 * through the one emitter. `cause` is the run's unless the write is a
	 * person's edit, hide, delete or swipe performed by a built-in's run —
	 * then `{ kind: 'edit', userId, runId }`: the person did it, this run
	 * wrote it. A spec the genre binds to the event runs as this run's
	 * CHILD (`childLineage`), so the cycle caps hold across the event; the
	 * payload's own `lineage` is this run's place in the tree. A host with
	 * no user on its scope (wired by hand) emits nothing: there is nobody
	 * to emit as, and no run to be the child of.
	 */
	const emit = async (
		event: string,
		payload: Record<string, unknown> & { sessionId: number },
		cause: { kind: "run" | "edit" | "user" },
		/**
		 * `asChild`: dispatch as a child of this run, so the lineage caps
		 * apply (01 §8). For an event a spec can re-cause by answering it —
		 * `annex-changed`, where a spec bound to it may write the annex
		 * again — unlike a recompute, which cannot (see below). Such an
		 * event also never carries `auto`: it is raised mid-run, and the
		 * round continues on the reply's `message-completed`, never on a
		 * write made while the reply is still streaming (R34).
		 */
		opts: { asChild?: boolean } = {}
	) => {
		if (scope.userId == null) return
		const { emitSessionEvent } = await import(
			"$lib/server/pipelines/runtime/sessionEvents"
		)
		const { childLineage, listenerLineage } = await import(
			"$lib/server/pipelines/runtime/lineage"
		)
		await emitSessionEvent(db, {
			sessionId: payload.sessionId,
			userId: scope.userId,
			event,
			payload: {
				...payload,
				event,
				cause: {
					kind: cause.kind,
					...(cause.kind === "edit" || cause.kind === "user"
						? { userId: scope.userId }
						: {}),
					...(scope.runId ? { runId: scope.runId } : {}),
					// Whether auto-advance fired this run (§4.6) — the fact
					// `round` continues on. Only ever true on a run's own
					// cause: a person's edit is never automatic.
					...(cause.kind === "run" && scope.auto && !opts.asChild ? { auto: true } : {})
				},
				...(scope.lineage ? { lineage: scope.lineage } : {})
			},
			/**
			 * **Inside this run's tree, on the listener lane** (R65).
			 *
			 * A spec bound to a data event is core's own listener lane (§3's
			 * diagram), not this pipeline's fan-out, so it never spends the
			 * writing run's descendant budget: counting the turn-order
			 * recompute there once made a message carrying nine questions
			 * starve its own answers. But it rides the tree, so a loop — a
			 * spec answering `message-completed` that writes a message — meets
			 * the depth cap and parks for the session owner instead of running
			 * forever (B3 review). `turn-order-changed` does not come through
			 * here: auto-advance answers it under its own cause rule and cap.
			 *
			 * `asChild` is the counted form, for an event a spec re-causes by
			 * answering it mid-run (`annex-changed`, a recording).
			 */
			...(scope.runId
				? {
						...(opts.asChild
							? { lineage: childLineage({ runId: scope.runId, lineage: scope.lineage }) }
							: {
									lineage: listenerLineage({ runId: scope.runId, lineage: scope.lineage }),
									depthOnly: true
								})
					}
				: {}),
			io: scope.io,
			signal: scope.signal
		})
	}

	/**
	 * 🚧 Who a **person's own message** speaks as (`create-message@1`'s
	 * `role: 'user'`; owner ruling 2026-10-15), held to the run's own person:
	 * a persona whose seat they hold, or their own unseated card (the row's
	 * `personaId`; `maySpeakAsCard`), their own card-less seat
	 * (stamped `player-seat:<id>`), or themselves. Every refusal is a
	 * sentence the person reads — the send restores their text.
	 */
	const personLineOf = async (
		node: NodeRef,
		sessionId: number,
		speaker: string | null,
		p: Record<string, unknown>
	): Promise<{ personaId: number | null; seatRef: string | null }> => {
		const refuse = (why: string): never => {
			throw new HostScopeError(`${node.key}: ${why}`)
		}
		// The people in the session read `why` as written (no step key).
		const refuseForPeople = (why: string): never => {
			throw forPeople(new HostScopeError(`${node.key}: ${why}`), why)
		}
		if (scope.userId == null)
			refuse("a person's message needs the person — this run has no user")
		if (scope.lineage)
			refuse(
				"a person's message is written only by the run their own send started, never by a run another run dispatched"
			)
		if (p.generating === true || p.narration === true || p.sideCharacter != null)
			refuse("a person's message is never a placeholder, narration or a side character's line")
		if (p.row != null || refId(p.characterId) != null)
			refuse("a person's message is a new row, spoken through `speaker` — not a claimed row or a cast row")
		if (!speaker) return { personaId: null, seatRef: null }
		// 🚧 A `seated-member:<memberId>` speaker is read as its seat's card
		// form first (seat-cast S3); a member nobody is seated as is refused as
		// a persona the person does not own, as an unknown card is.
		// ⏳ (S4) With the switch on the door answers member form; the checks
		// below read the card (or card-less seat) it names (`cardFormOfStored`).
		const storedSpeaker = await cardFormOfStored(
			db,
			sessionId,
			await storedSeatRef(db, sessionId, speaker)
		)
		if (storedSpeaker === null)
			refuseForPeople("You can only send messages with personas you own.")
		const parsed = parseParticipantRef(storedSpeaker!)
		if (parsed.kind === "user") {
			if (participantRowId(parsed.id) !== scope.userId)
				refuseForPeople(
					"a person's message is written as the person who sent it"
				)
			return { personaId: null, seatRef: null }
		}
		if (parsed.kind === "character") {
			const personaId = participantRowId(parsed.id)
			const own =
				personaId != null &&
				(await maySpeakAsCard(db, {
					sessionId,
					cardId: personaId,
					userId: scope.userId!
				}))
			if (!own)
				refuseForPeople("You can only send messages with personas you own.")
			return { personaId, seatRef: null }
		}
		if (parsed.kind === "player-seat") {
			const { cardlessPlayerSeatOf, playerSeatSpeaker } = await import(
				"$lib/server/sessions/seatName"
			)
			const seat = await cardlessPlayerSeatOf(db, sessionId, scope.userId!)
			if (seat === null || String(seat) !== parsed.id)
				refuseForPeople(
					"a person's message speaks from their own seat, not another's"
				)
			return { personaId: null, seatRef: playerSeatSpeaker(seat!) }
		}
		return refuse(
			`a person's message speaks as their persona, their seat or themselves — not '${speaker}'`
		)
	}

	/**
	 * A built-in write performs only under the built-in's own document
	 * (U5b review W8) — `validate()` refuses the placement at publish, and
	 * this is the same refusal at the write, for a document that reached the
	 * host without passing through it. A host with no document named (wired
	 * by hand) is not judged here: there is no document to judge.
	 *
	 * **Ownership decides before the id does** (D-6). `isBuiltInSpec` matches
	 * five literal core ids, which is a fact about the string; an owned
	 * document is refused whatever its id says, because the owner is a fact
	 * this instance wrote when it installed the package and the id is a claim
	 * the package makes about itself. The two only disagree for a document
	 * naming itself `core:spec/builtin-*` out of a plugin's folder — which
	 * `readPluginPackage` already refuses at install — and this is the same
	 * refusal at the write, for a row that reached the database another way.
	 */
	const assertBuiltInSpec = (node: NodeRef) => {
		if (scope.ownerPluginId !== undefined)
			throw new HostScopeError(
				`${node.key} (${node.definitionId}) is a built-in write and '${scope.specId}' is owned ` +
					`by the plugin '${scope.ownerPluginId}'. Only core's own built-in specs may perform ` +
					`one — the write's permission was judged by the handler that started that spec, ` +
					`and by nothing a package can supply.`
			)
		if (scope.specId === undefined || isBuiltInSpec(scope.specId)) return
		throw new HostScopeError(
			`${node.key} (${node.definitionId}) is a built-in write and '${scope.specId}' is not a ` +
				`built-in's spec. Only core:spec/builtin-* may perform one — the write's permission ` +
				`was judged by the handler that started that spec, and by nothing this document ` +
				`can supply. A manifest permission for a plugin spec to place one is not granted in ` +
				`this release.`
		)
	}

	/**
	 * The item rule, at the write (U5b review C1): may the run's actor act on
	 * THIS row? The handler asked the same question before the run began, on
	 * the id it was given; this asks it on the id the write is about to use,
	 * because the two can differ — a review gate folds an edit into the
	 * payload between them — and ownership is not a property the payload
	 * carries. No actor is no permission: the only default that can be
	 * wrong in one direction is the one that grants.
	 */
	const assertMayAct = async (
		node: NodeRef,
		messageId: number,
		verb: "change" | "rerun" = "change"
	) => {
		const { canActOnMessage, MESSAGE_ACTION_REFUSAL } = await import(
			"$lib/server/messages/permissions"
		)
		if (
			scope.userId != null &&
			(await canActOnMessage(db, messageId, scope.userId, verb))
		)
			return
		throw forPeople(
			new HostScopeError(`${node.key}: ${MESSAGE_ACTION_REFUSAL}`),
			MESSAGE_ACTION_REFUSAL
		)
	}

	/**
	 * 🚧 A reply's media PARTS, written (O5, 2026-10-21) — the `parts` in-port
	 * of `update-message` (a message created whole posts its media through
	 * `create-message`'s `media`): every `{ t: 'media' }` part a
	 * model returned (a spoken reply's audio, a drawn image), in the model's
	 * order, as message parts (`core:audio`, `core:image`, …, `mediaPartFor`).
	 * Text and reasoning parts are not written here — the `text` and
	 * `reasoning` ports carry them. The same ownership rule as `media`
	 * (`mediaParts`). Returns whether anything landed.
	 */
	const writeMediaParts = async (
		node: NodeRef,
		row: { id: number; sessionId: number },
		raw: unknown
	): Promise<boolean> => {
		if (!Array.isArray(raw) || !raw.length) return false
		const refs = (raw as unknown[])
			.filter(
				(part): part is { t: "media"; ref: unknown } =>
					!!part &&
					typeof part === "object" &&
					(part as { t?: unknown }).t === "media"
			)
			.map((part) => part.ref)
		if (!refs.length) return false
		const parts = await mediaParts(db, refs, row.sessionId, scope, node)
		if (!parts.length) return false
		const { appendParts } = await import("$lib/server/messages/store")
		await appendParts(db, row.id, parts)
		for (const part of parts) record(node, "file", part.data.assetId, "attached")
		return true
	}

	/**
	 * Message blocks, written (20 §6; R-15 *Forms*; U5d) — the `blocks`
	 * in-port of `create-message` and `update-message`, one path for both.
	 *
	 * The tree is validated with the SDK's gate; a block naming a key this
	 * document declares no action for is refused with the key named
	 * (nothing would ever hold a press to an audience for it); a block
	 * naming a `world` action is refused — the effects line: an
	 * out-of-fiction effect never rides a message where a character could be
	 * asked to answer it. What passes is stamped with the writing spec's
	 * action identity, a block id and the **channel head** (U5f, R-15
	 * *Staleness and order*: the greatest message id on the row's channel
	 * at this write among rows that are not answers to this row's own
	 * forms — the row itself, for a fresh create — read through
	 * `stalenessHead`, the one definition the fire door compares against; a
	 * head a spec wrote is dropped), and stored as ONE `core:blocks` part.
	 *
	 * Then the forms: for every block with an `addressee`, the run's
	 * **pinned** portrayals answer who portrays them this turn (R-21 (4)) —
	 * `ai` means the form goes on the run's `addressed` list for `runSpec`
	 * to dispatch as `form-addressed` once the receipt is saved; a person,
	 * nobody, or a reference the run never pinned means the block waits for
	 * a click, as a form put to a person does — and goes on the run's
	 * `formsAwaitingPeople`, as does a form with no addressee, for `runSpec`
	 * to raise its `open-form` notification. An addressed form whose
	 * function no action of this document declares was refused above; one
	 * left unstamped — several actions on one function — is refused here,
	 * since a form nobody can be held to is a form nobody can answer.
	 *
	 * Returns what it stored, so a caller's receipt can say so. `replace`
	 * (U5d review, S5) is the update write's: the row's existing `core:blocks`
	 * part is replaced rather than a second appended — a message's block
	 * tree is a value a write sets.
	 */
	const writeBlocks = async (
		node: NodeRef,
		row: { id: number; sessionId: number; channel: string },
		raw: unknown,
		opts: { replace?: boolean } = {}
	): Promise<MessageBlock[] | null> => {
		if (raw === undefined || raw === null) return null
		if (!Array.isArray(raw)) {
			throw new HostScopeError(
				`${node.key}: 'blocks' is not a list — wire a block list (a MessageBlock[]), or leave it unwired`
			)
		}
		if (!raw.length) return null
		const findings = checkMessageBlocks(raw)
		if (findings.length)
			throw new HostScopeError(
				`${node.key}: the blocks do not validate — ` +
					findings.map((f) => `${f.path}: ${f.message} (${f.fix})`).join("; ")
			)
		const spec = { id: scope.specId ?? "", contributes: scope.contributes }
		// 🚧 seat-cast S3: a form's `addressee` given as `seated-member:<memberId>`
		// is stored in its seat's card form, like every addressee (the answer,
		// the portrayal and the press all compare that form). A member no seat of
		// this session holds is refused by name — never stored raw.
		const seatedAddressees = async (list: MessageBlock[]): Promise<MessageBlock[]> => {
			const out: MessageBlock[] = []
			for (const b of list) {
				if (b.kind === "group") {
					out.push({ ...b, blocks: await seatedAddressees(b.blocks) })
				} else if (
					(b.kind === "choices" || b.kind === "form" || b.kind === "roll") &&
					typeof b.addressee === "string"
				) {
					const stored = await storedSeatRef(db, row.sessionId, b.addressee)
					if (stored === null)
						throw new HostScopeError(
							`${node.key}: the form is addressed to ${JSON.stringify(b.addressee)}, who is not seated in this session`
						)
					out.push(stored === b.addressee ? b : { ...b, addressee: stored as typeof b.addressee })
				} else out.push(b)
			}
			return out
		}
		let blocks = await seatedAddressees(raw as MessageBlock[])
		if (scope.specId !== undefined) {
			const undeclared = undeclaredBlockFunctions(blocks, spec)
			if (undeclared.length)
				throw new HostScopeError(
					`${node.key}: the blocks name ${undeclared.map((f) => `'${f}'`).join(", ")}, which ` +
						`'${scope.specId}' declares no action for — a block's press is held to an ` +
						`action's audience, so declare one under contributes.actions[] first`
				)
			/**
			 * The effects line at the write (01 §13: `core:verdict/effects-line`,
			 * heard as a `block`), with its one exception (L1, ruled
			 * 2026-09-17): a block addressed to the **owner** passes, because
			 * the owner is already the whole of a `world` action's `act`
			 * audience and pressing the button is the owner acting. The
			 * refusal is therefore about the blocks that are still questions
			 * somebody in the fiction could be asked.
			 */
			const line = effectsLineVerdict.judge({ kind: "block", blocks, spec })
			if (!line.ok) throw new HostScopeError(`${node.key}: ${i18nText(line.sentence)}`)
			blocks = stampBlockActions(blocks, spec)
			// A block pointing at ANOTHER spec's declaration on purpose (Ask's
			// options fire Answer): held to the installed declaration — it
			// must exist for the session's genre, it may not be `world`, and
			// the option's `fn` must be THAT action's function (U5d review,
			// S2): an identity is which declaration judges the press, and a
			// press whose function disagrees with it would be judged by one
			// declaration and routed by another.
			const foreign = foreignBlockActions(blocks, spec)
			if (foreign.length) {
				const fnsByIdentity = new Map<string, Set<string>>()
				/**
				 * Who each foreign identity was put to (L1): every addressee
				 * of every block naming it, handed to the same verdict this
				 * spec's own declarations were judged by. An identity named
				 * by two blocks is admitted only if BOTH are the owner's —
				 * one question a character could be asked is one too many —
				 * which is the verdict's rule over the list, not this door's.
				 */
				const addresseesByIdentity = new Map<string, unknown[]>()
				for (const form of formBlocksOf(blocks)) {
					const refs = form.kind === "choices" ? form.actions : [form]
					for (const ref of refs) {
						if (ref.action === undefined) continue
						const set = fnsByIdentity.get(ref.action) ?? new Set<string>()
						set.add(ref.fn)
						fnsByIdentity.set(ref.action, set)
						const put = addresseesByIdentity.get(ref.action) ?? []
						put.push(form.addressee)
						addresseesByIdentity.set(ref.action, put)
					}
				}
				const { listGenreActions, STANDARD_GENRE_ID } = await import(
					"$lib/server/pipelines/entities/sessionGenres"
				)
				const { parseActionIdentity } = await import("$lib/shared/actions/identity")
				const [session] = await db
					.select({ genreId: schema.sessions.genreId })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, row.sessionId))
					.limit(1)
				const offered = await listGenreActions(db, session?.genreId ?? STANDARD_GENRE_ID)
				for (const identity of foreign) {
					const parsed = parseActionIdentity(identity)
					const found =
						parsed &&
						offered.find((a) => a.specSlug === parsed.specSlug && a.key === parsed.key)
					if (!found)
						throw new HostScopeError(
							`${node.key}: the blocks name the action '${identity}', which nothing ` +
								`published for this session's genre declares — a block fires a declared ` +
								`action or nothing`
						)
					const crossed = effectsLineVerdict.judge({
						kind: "identity",
						identity,
						effects: found.effects,
						addressees: addresseesByIdentity.get(identity) ?? []
					})
					if (!crossed.ok)
						throw new HostScopeError(`${node.key}: ${i18nText(crossed.sentence)}`)
					const disagreeing = [...(fnsByIdentity.get(identity) ?? [])].filter(
						(fn) => fn !== found.key
					)
					if (disagreeing.length)
						throw new HostScopeError(
							`${node.key}: the blocks name '${identity}' with fn ${disagreeing
								.map((fn) => `'${fn}'`)
								.join(", ")}, but that action's key is '${found.key}' — a block's fn is ` +
								`the named action's key, or the identity is the wrong one`
						)
				}
			}
		}
		blocks = assignBlockIds(blocks, () => randomUUID())
		if (formBlocksOf(blocks).length) {
			// The channel head at issue (U5f): the row is on the channel, so
			// the head is at least the row; a later line on it — one that is
			// not an answer to a form on this row — moves the head and stales
			// every unanswered form issued before.
			const head =
				(await stalenessHead(db, row.sessionId, row.channel, row.id)) ?? row.id
			blocks = assignBlockHead(blocks, head)
		}
		// An addressed form is held to ONE identity per option — every option
		// of a question, not the first (U5d review, W6): the oracle may pick
		// any of them, and the one it picks is what fires. Since V2 a key
		// names at most one action of a spec, so an option left unstamped
		// here is one the spec declares nothing for (a host wired by hand).
		for (const form of formBlocksOf(blocks)) {
			if (!form.addressee) continue
			const refs = form.kind === "choices" ? form.actions : [form]
			const unstamped = refs.filter((ref) => ref.action === undefined)
			if (unstamped.length)
				throw new HostScopeError(
					`${node.key}: the form '${form.id}' is addressed to ${form.addressee} but ` +
						`${unstamped.map((r) => `'${r.fn}'`).join(", ")} names no action of ` +
						`'${scope.specId ?? "this document"}', so no identity could be stamped — a form ` +
						`nobody can be held to is a form nobody can answer; name the action on the block, ` +
						`or declare the key`
				)
		}
		if (opts.replace) {
			const { replaceBlocksPart } = await import("$lib/server/messages/blocks")
			await replaceBlocksPart(db, row.id, blocks)
		} else {
			const { appendParts } = await import("$lib/server/messages/store")
			await appendParts(db, row.id, [
				{ type: CORE_BLOCKS_PART, data: { blocks } }
			])
		}
		for (const form of formBlocksOf(blocks)) {
			if (!form.id) continue
			const who = form.addressee ? scope.portrayals?.[form.addressee] : undefined
			if (who?.by !== "ai" || !form.addressee) {
				// Waits for a click: the person's who portrays the addressee,
				// else the owner's (W4) — raised as `open-form` after the
				// receipt, like the AI's dispatch.
				const userId = who?.by === "person" ? Number(who.userId) : NaN
				scope.formsAwaitingPeople?.push({
					messageId: row.id,
					blockId: form.id,
					userId: Number.isInteger(userId) && userId > 0 ? userId : null
				})
				continue
			}
			// The first option's identity names the declaration on the event;
			// the option the answer picks is what fires (`formFireOf`).
			const action = form.kind === "choices" ? form.actions[0]!.action! : form.action!
			scope.addressed?.push({
				payload: {
					sessionId: row.sessionId,
					messageId: row.id,
					blockId: form.id,
					action,
					addressee: form.addressee
				},
				form
			})
		}
		return blocks
	}

	/**
	 * 🚧 **The filing tools' doors** (lane 2, 2026-10-19; `tools/writeTools.ts`):
	 * a lorebook write, a note taken back and a picture posted — each
	 * through the host's own write (`create-lore-entry`, `create-message`),
	 * recorded on the run under the tool's node, so the run's receipt and
	 * its artifacts say what the tool filed. A lore write obeys the session's
	 * *Remember things* task: Review files into the session's own notes only.
	 */
	const toolDoors = (toolNode: NodeRef, sessionId: number) => {
		const asNode = (definitionId: string, suffix: string): NodeRef => ({
			key: `${toolNode.key}:${suffix}`,
			definitionId,
			definitionVersion: 1,
			kind: "outlet"
		})
		return {
			fileLore: async (entry: { name: string; content: string; entryType?: string }) => {
				// 🚧 *Remember things* on Review (its routine's mode, lane 6):
				// the session's own notes only.
				const { sessionRoutineMode } = await import("$lib/server/pipelines/routines/sessionRoutines")
				const { ASSISTANT_MEMORY_SPEC_ID } = await import("@serene-pub/core-catalog")
				const held = (await sessionRoutineMode(db, sessionId, ASSISTANT_MEMORY_SPEC_ID)) === "review"
				const wrote = (await host.commit!(
					{
						name: entry.name,
						content: entry.content,
						params: { entryType: entry.entryType ?? "core:entry/world-lore" },
						toNotes: held
					},
					asNode("core:outlet/create-lore-entry", "entry")
				)) as { id: number; lorebookId: number; route?: string }
				const notes = wrote.route === "own-book"
				return {
					id: wrote.id,
					lorebookId: wrote.lorebookId,
					held,
					where: notes ? "this session's own notes" : "the lorebook attached to this session"
				}
			},
			forgetLore: async (name: string) => {
				const { forgetNote } = await import("$lib/server/sessions/forgetNote")
				const archived = await forgetNote(db, sessionId, name)
				for (const id of archived) record(asNode("core:outlet/create-lore-entry", "forget"), "lore_entry", id, "updated")
				return { archived }
			},
			makeImage: async (prompt: string) => {
				const { dispatchImage } = await import("$lib/server/pipelines/runtime/dispatchImage")
				const rendered = await dispatchImage(db, {
					prompt,
					connectionId: null,
					samplingId: null,
					sessionId,
					userId: scope.userId ?? null,
					runId: scope.runId,
					artifacts: scope.artifacts,
					nodeKey: toolNode.key
				})
				if (!rendered.media.length) throw new HostScopeError("the image generator drew nothing for that description")
				// The picture speaks as the run's own row does — the Assistant.
				const [own] =
					liveRowId !== undefined
						? await db
								.select({ metadata: schema.sessionMessages.metadata })
								.from(schema.sessionMessages)
								.where(eq(schema.sessionMessages.id, liveRowId))
								.limit(1)
						: []
				const speaker = (own?.metadata as { speaker?: unknown } | undefined)?.speaker
				const posted = (await host.commit!(
					{
						text: rendered.caption || prompt,
						media: rendered.media,
						...(typeof speaker === "string" ? { speaker } : {})
					},
					asNode("core:outlet/create-message", "image")
				)) as { id: number }
				return { messageId: posted.id, caption: rendered.caption || prompt }
			}
		}
	}

	/**
	 * Named rather than returned as a literal, because one branch of `call`
	 * needs a read: a core tool sees the session through the host's own
	 * enumerated seam (see `ToolContext`), and the alternative — a second
	 * copy of those queries beside the switch — is the drift this file's
	 * whole shape exists to prevent.
	 */
	const host: CoreHostServices = {
		// Read-only, and a data property rather than a method because it is a
		// fact about the run and not a service the executor calls. The executor
		// reaches only for the four named methods, so carrying it costs the
		// wire nothing.
		get ownerPluginId() {
			return scope.ownerPluginId
		},
		async read(table, query, node) {
			const q = (query ?? {}) as Record<string, any>

			switch (table) {
				case "session_messages": {
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []

					/**
					 * Channel scoping (20 §7, R6) — in the `where`, not after
					 * the limit.
					 *
					 * An omitted channel is the session's default lane,
					 * `main`, and never a union: see `messages/channels.ts`
					 * for why an unqualified read resolves rather than
					 * refuses. `ALL_CHANNELS` is the union and has to be
					 * asked for by name.
					 *
					 * It was a post-filter over ids fetched from the mirror,
					 * which meant "the last 40 on this lane" was really "how
					 * many of the last 40 in the session happened to be on
					 * it" — silently short, and indistinguishable from a lane
					 * with little history.
					 *
					 * Lanes (ruling 2026-09-09): a **bare slug is the whole
					 * channel** and `slug:n` is one lane of it. The window is
					 * still the newest `limit` rows — a whole-channel read of
					 * five conversations wants the recent traffic across them,
					 * not the opening of the first — and the rows are then put
					 * in lane-then-time order, so the five read as five. On a
					 * channel that has only lane 1, which is every channel that
					 * existed before this shipped, `byLaneThenTime` is exactly
					 * the `reverse()` it replaces.
					 */
					const channel = resolveChannel(q.channel)
					const spansLanes = channelSpansLanes(channel)

					// `isHidden` is the existing convention for a message that should
					// not reach a model. Honoured here rather than left to each
					// binding, so a new Query type cannot forget it.
					/**
					 * ⚠ And `isGenerating`, on the same footing (ruling
					 * 2026-09-08, D-2). **A row that is still being written is
					 * not a stored message**, and this read is the one seam
					 * every message query in the product goes through — the
					 * history window, the keyword scan, the entity and semantic
					 * mechanisms — so the rule is stated once here rather than
					 * four times downstream where one of them would forget it.
					 *
					 * The legacy path always excluded it (`generateResponse.ts`
					 * loads the session with `ne(cm.id, generatingMessage.id)`)
					 * and this path never did, which was two bugs wearing one
					 * omission:
					 *
					 * - an **extend** keeps its partial text on the row, so the
					 *   partial arrived at every retrieval mechanism as though
					 *   somebody had said it — lore keyed on a word the model
					 *   had half-written was retrieved on the strength of the
					 *   model's own unfinished sentence;
					 * - and an ordinary turn's row is blank, so every prompt
					 *   carried an empty `"Alice: "` transcript line immediately
					 *   before the seed line that says the same thing.
					 *
					 * The partial still reaches the model — as
					 * `continuationPrefill` on the seed line, which is the one
					 * place a continuation belongs.
					 */
					/**
					 * **Only the unplayed talk** (lair re-plan R13): a side
					 * channel's rows since the story's newest generated line,
					 * people's lines and the replies fired there — see
					 * `sessions/unplayedTalk.ts`. The binding refuses it on
					 * `main` before it gets here. Same filters, same order,
					 * same cap: the window is the newest `limit` of the talk.
					 */
					/**
					 * **One row, by id** (lair re-plan R11): the message a
					 * press on a message's ⋮ was made on — `session-history@1`'s
					 * `messageId` in-port. This session's only, and hidden or
					 * still-generating reads as nothing, as in any window;
					 * the channel selector, the window and the talk filters do
					 * not apply to a row named outright.
					 */
					const byId =
						typeof q.messageId === "number" && Number.isInteger(q.messageId)
							? q.messageId
							: null
					/**
					 * **Sized by the window** (history window, 2026-10-03):
					 * `readTokens` is `session-history@1`'s wired `budget`,
					 * doubled (`historyReadTokens`). The window is then the
					 * newest rows up to that estimate — every row when they
					 * never reach it, never more than `HISTORY_READ_MAX_ROWS` —
					 * in place of the newest `limit`. Two reads, so a long
					 * session's text beyond the window never leaves the
					 * database: each row's size first (`octet_length`, which
					 * Postgres answers off the stored header), then the rows
					 * from the first one kept. Same filters, same order as the
					 * count window below; not for the talk or a row by id.
					 */
					/**
					 * 🚧 **No table lines** (`session-history@1`'s
					 * `tableLines: false`, 2026-10-15): a row the table wrote
					 * in no voice (`metadata.tableLine` — a roll line) is left
					 * out of the window itself, so it never takes a place the
					 * conversation would have had.
					 */
					const noTableLines =
						q.tableLines === false
							? sql`coalesce((${schema.sessionMessages.metadata} ->> 'tableLine')::boolean, false) = false`
							: undefined
					/**
					 * 🚧 **No failed replies** (2026-10-16 walk), in every
					 * genre: a row whose run failed — an error on it and no
					 * words — is not something anybody said. Read, it reached
					 * the next prompt as a bare `Narrator:` turn. A failed row
					 * that kept a partial still reads: those words were shown.
					 */
					const { notAFailedReplySql: noFailedReplies } = await import("$lib/server/messages/failedReply")
					/**
					 * 🚧 A read over ALL channels leaves out the channels a
					 * genre declares for the people named (`audience:
					 * { participants }`, M0 L6); a read that names one
					 * reads it. Owner-only channels are unchanged (D6).
					 */
					let outsideAudience: SQL | undefined
					if (isAllChannels(channel)) {
						const { participantAudienceSlugsOf, sessionLaneFacts } = await import("$lib/server/channels/lanes")
						const facts = await sessionLaneFacts(db, sessionId)
						const slugs = facts ? participantAudienceSlugsOf(facts.shape) : []
						if (slugs.length)
							outsideAudience = and(
								...slugs.map((slug) => sql`NOT (${channelPrefixWhere(schema.sessionMessages.channel, slug)})`)
							)
					}
					const windowWhere = and(
						eq(schema.sessionMessages.sessionId, sessionId),
						eq(schema.sessionMessages.isHidden, false),
						eq(schema.sessionMessages.isGenerating, false),
						channelWhere(schema.sessionMessages.channel, channel),
						outsideAudience,
						noTableLines,
						noFailedReplies
					)
					const readTokens =
						byId === null &&
						q.unplayedOnly !== true &&
						typeof q.readTokens === "number" &&
						q.readTokens > 0
							? q.readTokens
							: 0
					const sizedFrom = readTokens
						? await (async () => {
								const { historyReadRowCount, HISTORY_READ_MAX_ROWS } =
									await import("$lib/server/pipelines/prompt/transcriptFit")
								const sizes = await db
									.select({
										id: schema.sessionMessages.id,
										bytes: sql<number>`coalesce(octet_length(${schema.sessionMessages.content}), 0)`
									})
									.from(schema.sessionMessages)
									.where(windowWhere)
									.orderBy(desc(schema.sessionMessages.id))
									.limit(HISTORY_READ_MAX_ROWS)
								const n = historyReadRowCount(
									sizes.map((s: { bytes: unknown }) => Number(s.bytes)),
									readTokens
								)
								return n > 0 ? Number(sizes[n - 1].id) : null
							})()
						: undefined
					const read =
						byId !== null
							? await db
									.select()
									.from(schema.sessionMessages)
									.where(
										and(
											eq(schema.sessionMessages.id, byId),
											eq(schema.sessionMessages.sessionId, sessionId),
											eq(schema.sessionMessages.isHidden, false),
											eq(schema.sessionMessages.isGenerating, false)
										)
									)
									.limit(1)
							: q.unplayedOnly === true
							? await (
									await import("$lib/server/sessions/unplayedTalk")
								).unplayedTalkRows(
									db,
									sessionId,
									channel,
									Math.min(q.limit ?? 100, 500)
								)
							: sizedFrom === null
								? []
								: sizedFrom !== undefined
									? (
											await db
												.select()
												.from(schema.sessionMessages)
												.where(
													and(
														windowWhere,
														gte(schema.sessionMessages.id, sizedFrom)
													)
												)
												.orderBy(desc(schema.sessionMessages.id))
										).reverse()
									: // Reversed after a descending limit: "the most recent
										// N, in reading order" is what every caller wants, and
										// doing it here means no binding has to remember which
										// end it got.
										(
											await db
												.select()
												.from(schema.sessionMessages)
												.where(windowWhere)
												.orderBy(desc(schema.sessionMessages.id))
												.limit(Math.min(q.limit ?? 100, 500))
										).reverse()
					/**
					 * **Side channels as talk** (`talkOnly`, lair re-plan R10's
					 * fold-in of the R9 follow-up): every non-`main` row that
					 * is not talk — a greeting a create run wrote, a story
					 * turn's beats row — dropped by its creating run's inlet
					 * channel, the fact the unplayed talk reads. After the
					 * window, so it may hand on fewer than `limit`.
					 */
					const ordered =
						byId === null && q.talkOnly === true && q.unplayedOnly !== true
							? await (
									await import("$lib/server/sessions/unplayedTalk")
								).sideTalkOnly(db, read)
							: read
					/**
					 * The genre's per-channel prompt shaping (R-C), resolved
					 * once per host and `null` for every genre that declares
					 * none. Carried onto the rows here because this is the one
					 * place a message and its session are both in hand — a
					 * task node downstream has the row and no way to ask what
					 * its channel means.
					 */
					const shaping = await channelShaping(sessionId)
					// 🚧 Show dice off (Lair rewrite D3): a dice row reads as
					// its result in words, never its numbers.
					const noNumbers = await diceHiddenFor(sessionId)
					const history = (
						spansLanes ? byLaneThenTime(ordered) : ordered
					).map((r) => toMessage(noNumbers ? withoutDiceNumbers(r) : r, shaping))

					// The uncommitted draft goes last, where the real message
					// would be. `id: -1` marks it as belonging to no row.
					//
					// Only on a read that includes the composer's own lane:
					// the draft is what somebody is typing into the session's
					// main composer, and appending it to a read of `map` would
					// be the mixing this scoping exists to prevent. A
					// per-channel composer is later work; when it arrives the
					// draft grows a channel and this comparison uses it.
					//
					// The composer's lane is `main` lane 1, so a whole-channel
					// read of `main` and a read of `main:1` both include it and
					// a read of `main:2` does not.
					const draftLane = parseChannel(channel)
					if (
						byId === null &&
						scope.draftMessage?.content?.trim() &&
						(isAllChannels(channel) ||
							(draftLane.slug === DEFAULT_CHANNEL &&
								draftLane.lane === DEFAULT_LANE))
					)
						history.push(
							toMessage(
								{
									id: -1,
									sessionId,
									role: "user",
									channel: DEFAULT_CHANNEL,
									content: scope.draftMessage.content,
									personaId:
										scope.draftMessage.personaId ?? null,
									characterId: null,
									isHidden: false
								},
								shaping
							)
						)

					noteMessagesRead(scope, history)
					return history
				}

				case "sessions": {
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []
					// Core's runtime columns never leave the server: read marks
					// are every member's, and a deck's state gives away the
					// next card (the same four `sockets/sessions.ts` leaves out).
					const {
						turnOrder: _turnOrder,
						turnTally: _turnTally,
						laneReads: _laneReads,
						rulesetDecks: _rulesetDecks,
						...sessionColumns
					} = getTableColumns(schema.sessions)
					return await db
						.select(sessionColumns)
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
				}

				case "session_settings": {
					// The settings document (PLAN-turn-order §4.12, way 2):
					// `core:query/session-settings@1` re-reads it after a
					// write that may have moved a value. One resolver behind
					// the declared node — sessions/settings.ts — the same
					// posture as the greetings read below.
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null
					const { resolveSessionSettings } = await import(
						"$lib/server/sessions/settings"
					)
					return await resolveSessionSettings(db, sessionId, { host })
				}

				case "plugin_storage": {
					// 🚧 (M2a) One file of the running plugin's own storage. The
					// owner and the person are the run's, never a port's.
					const { readPluginStorage } = await import("./pluginStorageRead")
					return await readPluginStorage(db, {
						ownerPluginId: scope.ownerPluginId,
						userId: scope.userId,
						scope: q.scope,
						as: q.as,
						path: q.path
					})
				}

				case "session_annex_version":
				case "session_annex": {
					/**
					 * One owner's annex document (PLAN-turn-order §4.3) — or,
					 * read as `session_annex_version` (🚧 M2a a8), that owner's
					 * annex document version (0 for a refused owner), which a
					 * `set-session-annex` takes as its `base`.
					 *
					 * The owner is the running spec's own namespace unless
					 * the node's params name another AND `sharedAnnex` is on
					 * — the default is the whole safety of the field: a spec
					 * reads its own document without saying anything, and
					 * has to say `sharedAnnex` out loud to read anybody
					 * else's. A refusal answers `{}` with a note rather than
					 * halting: the annex is memory, and a read of memory
					 * that is not there is an ordinary state.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null
					if (q.view === "template" && table === "session_annex") {
						/**
						 * The template view (typed templates P6, owner ruling
						 * Q1): every DECLARED key of every owner in scope —
						 * core and the enabled plugins, for this session's
						 * genre — keyed by owner. Not one owner's document, so
						 * `owner` / `sharedAnnex` do not apply; law T2 lets
						 * this read feed only a template's `annex` port, so it
						 * reaches a prompt and nowhere else.
						 */
						const [row] = await db
							.select({ annex: schema.sessions.annex })
							.from(schema.sessions)
							.where(eq(schema.sessions.id, sessionId))
							.limit(1)
						if (!row) return null
						const { templateAnnex, sessionGenreOf } = await import(
							"$lib/server/sessions/annexFields"
						)
						return await templateAnnex(
							db,
							await sessionGenreOf(db, sessionId),
							(row.annex ?? {}) as Record<string, unknown>
						)
					}
					const params = (q.params ?? {}) as {
						owner?: unknown
						sharedAnnex?: unknown
					}
					const own = annexOwnerOf(scope.specId)
					const named =
						typeof params.owner === "string" && params.owner.trim()
							? params.owner.trim()
							: null
					const owner =
						named && named !== own
							? params.sharedAnnex === true
								? named
								: null
							: own
					if (owner === null) return table === "session_annex_version" ? 0 : {}
					const [row] = await db
						.select({
							annex: schema.sessions.annex,
							audiences: schema.sessions.annexAudiences,
							versions: schema.sessions.annexVersions
						})
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!row) return null
					if (table === "session_annex_version") {
						const { annexVersionOf } = await import("$lib/server/sessions/annexVersions")
						return annexVersionOf(row.versions, owner)
					}
					const annex = (row.annex ?? {}) as Record<string, unknown>
					const doc = annex[owner]
					const whole =
						doc && typeof doc === "object" && !Array.isArray(doc)
							? (doc as Record<string, unknown>)
							: {}
					if (q.view !== "ai") return whole
					// The AI's view (R57): only what the model's context may
					// carry — for this speaker, when the prompt has one.
					const { aiHolds, visibleTo } = await import("@serene-pub/sdk")
					const { isParticipantRef, canonicalParticipantRef } = await import("@serene-pub/sdk")
					// 🚧 A `seated-member:<memberId>` speaker is read as its seat's card
					// form first (seat-cast S3): `aiHolds` compares canonical strings,
					// and the audiences hold the card form. A member nobody is seated
					// as holds nothing a named audience carries, as an unknown card.
					const askedSpeaker =
						typeof q.speaker === "string" && isParticipantRef(q.speaker)
							? await storedSeatRef(db, sessionId, q.speaker)
							: null
					const speaker =
						askedSpeaker !== null && isParticipantRef(askedSpeaker)
							? canonicalParticipantRef(askedSpeaker)
							: null
					// Who may see each key is the owner's declaration's to say
					// (ruling 2026-09-26): a key none covers — legacy data a
					// write stored before the ruling — is pipelines only.
					const { declaredAudiences, sessionGenreOf } = await import(
						"$lib/server/sessions/annexFields"
					)
					const declaredBy = await declaredAudiences(db, await sessionGenreOf(db, sessionId))
					// 🚧 A declared audience naming `seated-member:<memberId>` is read in
					// the card form too (seat-cast S3), so it meets the translated speaker.
					const audiences: typeof declaredBy = {}
					for (const [audienceOwner, keys] of Object.entries(declaredBy)) {
						audiences[audienceOwner] = {}
						for (const [key, refs] of Object.entries(keys))
							audiences[audienceOwner][key] = (await storedRefsOf(
								db,
								sessionId,
								refs
							)) as typeof refs
					}
					return (
						visibleTo({ [owner]: whole }, audiences, (refs) =>
							aiHolds(refs, speaker as never)
						)[owner] ?? {}
					)
				}

				case "lorebook_annex_version":
				case "lorebook_annex": {
					/**
					 * 🚧 One owner's document in the **lorebook annex** (M0,
					 * SHAPES L9). The owner resolves exactly as the session
					 * annex's does (own namespace unless the params name another
					 * AND `sharedAnnex`; a refusal answers `{}`). A session reads
					 * the union of the books it reads; a book-level run reads the
					 * book its scope grants.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					const params = ((q.params ?? q) ?? {}) as {
						owner?: unknown
						sharedAnnex?: unknown
					}
					const own = annexOwnerOf(scope.specId)
					const named =
						typeof params.owner === "string" && params.owner.trim()
							? params.owner.trim()
							: null
					const owner =
						named && named !== own
							? params.sharedAnnex === true
								? named
								: null
							: own
					if (owner === null) return table === "lorebook_annex_version" ? 0 : {}
					// 🚧 (M2b) The version on the book a write from this run would land on.
					if (table === "lorebook_annex_version") {
						const { lorebookAnnexVersion } = await import("$lib/server/lorebooks/annex")
						if (sessionId !== undefined) {
							const { loreWriteBookIdOf } = await import("$lib/server/lorebooks/ownBook")
							const id = await loreWriteBookIdOf(db, sessionId)
							return id == null ? 0 : await lorebookAnnexVersion(db, id, owner)
						}
						const { lorebookId } = await lorebookInScope(db, node, scope, q)
						return lorebookId === null ? null : await lorebookAnnexVersion(db, lorebookId, owner)
					}
					if (sessionId !== undefined) {
						const [row] = await db
							.select({ id: schema.sessions.id })
							.from(schema.sessions)
							.where(eq(schema.sessions.id, sessionId))
							.limit(1)
						if (!row) return null
						const { sessionLorebookAnnex } = await import("$lib/server/lorebooks/annex")
						return await sessionLorebookAnnex(db, sessionId, owner)
					}
					const { lorebookId } = await lorebookInScope(db, node, scope, q)
					if (lorebookId === null) return null
					const { bookLorebookAnnex } = await import("$lib/server/lorebooks/annex")
					return await bookLorebookAnnex(db, lorebookId, owner)
				}

				case "history_attachments": {
					// The files a transcript's rows show (PLAN-composer-
					// attachments §3.5) — `core:query/history-attachments@1`.
					// Always the run's own session: a message id of any other
					// session contributes nothing, however it got here.
					const sessionId = scope.sessionId
					if (sessionId === undefined) return {}
					const ids = Array.isArray(q.messageIds)
						? (q.messageIds as unknown[]).filter(
								(id): id is number => typeof id === "number"
							)
						: []
					const { historyAttachmentsFor } = await import(
						"$lib/server/attachments/history"
					)
					const attached = await historyAttachmentsFor(db, {
						sessionId,
						messageIds: ids,
						textFileBytes:
							typeof q.textFileBytes === "number"
								? q.textFileBytes
								: undefined
					})
					noteMessagesRead(
						scope,
						Object.keys(attached).map((id) => ({ id: Number(id) }))
					)
					return attached
				}

				case "session_greetings": {
					// The create pipeline's read (24 §12, T8): the cast's
					// greeting entries, interpolated, position-ordered. The
					// implementation lives in sessions/greetings.ts — one
					// implementation behind the declared node.
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []
					const { collectSessionGreetings } = await import(
						"$lib/server/sessions/greetings"
					)
					const { entries } = await collectSessionGreetings(
						db,
						sessionId
					)
					return entries
				}

				case "envoy_greeting": {
					// The create pipeline's other read (lair re-plan R6): a
					// seated envoy's declared greeting, interpolated — one
					// implementation behind the declared node, in
					// sessions/greetings.ts. Undefined when the envoy is not
					// seated or declares none.
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return undefined
					const { collectEnvoyGreeting } = await import(
						"$lib/server/sessions/greetings"
					)
					return await collectEnvoyGreeting(
						db,
						sessionId,
						typeof q.envoy === "string" ? q.envoy : undefined
					)
				}

				case "summarize_source":
					return readSummarizeSource({ db, scope, host, node, q })

				case "summarize_span":
					return readSummarizeSpan({ db, scope, host, node, q })

				case "lorebook_entries":
					return readLorebookEntries({ db, scope, host, node, q }, lorebookReads)

				case "speaker_in_cast": {
					// 🚧 ★ The earlier-scenes read's own question: the speaker's
					// judgement over the session's scenes, from the same per-run
					// load the lore read uses. The speaker is the one the lore
					// read resolves for an unwired speaker.
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return { kind: "reads-all" }
					return speakerInCastOf(
						db,
						sessionId,
						lorebookSpeakerRef(loreVisibilitySubject(q)),
						lorebookReads
					)
				}


				case "session_cast": {
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					const readCast = () =>
						readSessionCast({ db, scope, host, node, q }, channelShaping, narratorNameOf)
					if (sessionId === undefined) return readCast()
					if (hostInFlight > 0 || castWritesInFlight() > 0) return readCast()
					if (sessionCastEpoch !== castWriteEpoch()) {
						sessionCastReads.clear()
						sessionCastEpoch = castWriteEpoch()
					}
					let pending = sessionCastReads.get(sessionId)
					if (!pending) {
						pending = readCast()
						sessionCastReads.set(sessionId, pending)
						pending.catch(() => sessionCastReads.delete(sessionId))
					}
					// Cast results must stay `structuredClone`-able.
					return structuredClone(await pending)
				}

				case "session_state": {
					/**
					 * The session's resolved stats and states.
					 *
					 * Through the read seam like every other Query, so a
					 * scoping refusal names the node that asked and a spec
					 * cannot reach another session's state by supplying an id.
					 * The resolution itself is `$lib/server/state` — imported
					 * here rather than in the binding, which is what keeps the
					 * binding module free of a database handle.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined)
						return {
							world: {},
							cast: {},
							slots: [],
							version: 0
						}
					const { stateFor } = await import(
						"$lib/server/state/resolve"
					)
					return await stateFor(db, sessionId)
				}

				case "lorebook_state": {
					/**
					 * 🚧 A lorebook's durable stats — its world, cast members
					 * and places — with no session needed (2026-09-27). Scoped
					 * by `lorebookInScope`; an owner of another book is
					 * refused rather than read as empty.
					 */
					const { lorebookId, reading } = await lorebookInScope(db, node, scope, q)
					if (lorebookId === null) return null
					const { lorebookStateFor, lorebookLinks, normalizeOwner, LorebookOwnerRefusal } =
						await import("$lib/server/state/lorebookState")
					// The book's owners as this reading sees them (finding #41).
					const links = await lorebookLinks(db, lorebookId, reading)
					const owner = q.owner == null ? undefined : normalizeOwner(q.owner, links)
					if (owner === null)
						throw new HostScopeError(
							`${node.key} (${node.definitionId}): the owner filter names nobody — use "world", { kind: "cast_member", id } or { kind: "location", id }.`
						)
					try {
						return await lorebookStateFor(
							db,
							{
								lorebookId,
								reading,
								owner,
								slotIds: Array.isArray(q.slotIds) ? q.slotIds : undefined
							},
							{ links }
						)
					} catch (e) {
						if (e instanceof LorebookOwnerRefusal)
							throw new HostScopeError(`${node.key} (${node.definitionId}): ${e.message}`)
						throw e
					}
				}

				case "stat_trail": {
					/**
					 * 🚧 One stat's values over time for one owner
					 * (2026-09-27): the scope session's message-anchored rows,
					 * the book's timeline across sessions, or both.
					 */
					const { lorebookId, sessionId, reading } = await lorebookInScope(db, node, scope, q)
					if (lorebookId === null) return null
					const { statTrailFor } = await import("$lib/server/state/statTrail")
					const { lorebookLinks, normalizeOwner, LorebookOwnerRefusal } = await import(
						"$lib/server/state/lorebookState"
					)
					const links = await lorebookLinks(db, lorebookId, reading)
					const owner = normalizeOwner(q.owner ?? "world", links)
					if (owner === null)
						throw new HostScopeError(
							`${node.key} (${node.definitionId}): the owner names nobody — use "world", { kind: "cast_member", id } or { kind: "location", id }.`
						)
					// A session reading a book that is not its own has no
					// messages in that book to read.
					const [own] =
						sessionId !== undefined
							? await db
									.select({ lorebookId: schema.sessions.lorebookId })
									.from(schema.sessions)
									.where(eq(schema.sessions.id, sessionId))
									.limit(1)
							: []
					try {
						return await statTrailFor(db, {
							lorebookId,
							sessionId: own?.lorebookId === lorebookId ? sessionId : undefined,
							reading,
							owner,
							slotId: typeof q.slotId === "string" ? q.slotId : "",
							mode: q.mode,
							last: typeof q.last === "number" ? q.last : undefined,
							sinceMessageId:
								typeof q.sinceMessageId === "number" ? q.sinceMessageId : undefined,
							sinceDate:
								q.sinceDate && typeof q.sinceDate.year === "number" ? q.sinceDate : undefined
						})
					} catch (e) {
						if (e instanceof LorebookOwnerRefusal)
							throw new HostScopeError(`${node.key} (${node.definitionId}): ${e.message}`)
						throw e
					}
				}

				case "graph_scenes": {
					// Scenes with their messages, in order. The graph builder
					// walks them one at a time and each step reads the same
					// list, which is why this is one read rather than one per
					// step — five identical queries would be five chances for
					// them to disagree about what "this session" contains.
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []
					const handedScenes = await db
						.select()
						.from(schema.scenes)
						.where(eq(schema.scenes.sessionId, sessionId))
						.orderBy(asc(schema.scenes.id))
					// A scene's own `id` is not a message: the messages it
					// holds are what the read handed.
					noteMessagesRead(
						scope,
						handedScenes.flatMap((sc) =>
							(sc.selectedMessageIds ?? []).map((id) => ({ id }))
						)
					)
					return handedScenes
				}

				case "graph_context": {
					/**
					 * The speaker's relationship summary, as structure.
					 *
					 * Returns what `buildGraphContextData` assembles rather
					 * than the rows behind it, deliberately: a second
					 * derivation here would be two readings of one graph that
					 * agree until somebody edits one — the failure the whole
					 * parity effort exists to prevent.
					 *
					 * It returns the *object* and not the finished string. The
					 * rendering belongs to the variable layout, and a value
					 * that arrives pre-stringified is one no layout can change.
					 *
					 * Null whenever the session has no lorebook, or the speaker
					 * has no bound node, or there are no relationships. That is
					 * the common case on an install that never opened the
					 * graph, and it is not an error.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null

					const [session] = await db
						.select({ lorebookId: schema.sessions.lorebookId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session) return null
					// 🚧 pr-6 (§B-3a): no shared book — the session's own book.
					const graphBook = session.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
					if (graphBook == null) return null

					const { buildGraphContextData } = await import(
						"$lib/server/utils/graphContextFormatter"
					)
					return (
						(await buildGraphContextData({
							sessionId,
							lorebookId: graphBook,
							speakerCharacterId: q.currentCharacterId ?? null,
							speakerPersonaId: null,
							// The host's own connection, not the module-scope
							// one — see the note on the parameter.
							db
						})) ?? null
					)
				}

				case "graph_relationships": {
					/**
					 * The same graph, one row per tie, ranked elsewhere.
					 *
					 * ⚠ **One traversal, two projections**, which is the same
					 * rule the case above states: a second walk written for
					 * `core:query/relationship-search@1` would be two readings
					 * of one graph that agree until somebody edits one. `buildGraphRelationshipRows` and
					 * `buildGraphContextData` are two projections of
					 * `collectGraphLayers`, so the visibility rules, the alias
					 * suppression and the participant scope cannot diverge
					 * between what the prompt renders and what the budget
					 * ranks.
					 *
					 * `null` on the same three conditions — no session, no
					 * lorebook, no bound speaker node — and an empty array when
					 * the graph is simply empty. The query reads the difference:
					 * one is "there is no graph here", the other is "there is,
					 * and it has nothing to say about this speaker".
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null

					const [session] = await db
						.select({ lorebookId: schema.sessions.lorebookId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session) return null
					// 🚧 pr-6 (§B-3a): no shared book — the session's own book.
					const graphBook = session.lorebookId ?? (await attachedOrOwnBookOf(db, sessionId))
					if (graphBook == null) return null

					const { buildGraphRelationshipRows, buildCastRelationshipRows } =
						await import("$lib/server/utils/graphContextFormatter")
					/**
					 * ⚠ **Nobody speaking takes the cast-wide read** (genre
					 * plan F6(a)). A null `currentCharacterId` is nobody's
					 * voice — an Adventure turn's planner and narrator — and
					 * the speaker's walk has nowhere to start from, so it
					 * answers every tie a cast member holds that is not their
					 * secret, in their own lane, which the speaker's two
					 * sections never render. Same line, and layer 2's
					 * visibility rule (`CAST_WIDE_VISIBILITY`).
					 *
					 * ⚠ Keyed on the missing speaker, not on a request, so
					 * every null-speaker read gets it — Chat's envoy turns
					 * included, where nothing renders the lane. Withholding
					 * secrets is what makes that safe; at a non-zero share
					 * there it still spends band room on ties no section
					 * shows. An explicit param on `relationship-search@1` would
					 * close it, at a contract move (review 2026-09-29).
					 */
					if (q.currentCharacterId == null)
						return (
							(await buildCastRelationshipRows({
								sessionId,
								lorebookId: graphBook,
								db
							})) ?? null
						)
					return (
						(await buildGraphRelationshipRows({
							sessionId,
							lorebookId: graphBook,
							speakerCharacterId: q.currentCharacterId ?? null,
							speakerPersonaId: null,
							db
						})) ?? null
					)
				}

				case "cast_presences": {
					/**
					 * Who is in the world, and when (plan E-2, R4): the
					 * presences on the session's line and the moment it reads
					 * at. The line is resolved HERE, so no node ever sees
					 * another line's spans (`presencesOnReading`). No session,
					 * or no book: nothing, at the head.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return { rows: [], at: null, placements: [] }
					const { presencesOnReading } = await import(
						"$lib/server/state/presencesOnReading"
					)
					// 🚧 `atHour` (M0, SHAPES L3): a clock target; unwired, the present hour.
					return await presencesOnReading(db, sessionId, q.atHour ?? null)
				}

				case "cast_member": {
					/**
					 * 🚧 One cast member as the session reads it
					 * (`core:query/cast-member@1`); the run's own session.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to read a cast member in — the run was started without a session scope`
						)
					const { readCastMember, CastMemberRefusal } = await import(
						"$lib/server/pipelines/runtime/castMember"
					)
					try {
						return await readCastMember(db, sessionId, q.member)
					} catch (err) {
						if (err instanceof CastMemberRefusal)
							throw new HostScopeError(`${node.key}: ${err.message}`)
						throw err
					}
				}

				case "likeness_images": {
					// 🚧 The Scene action's references (I9): everyone on
					// stage's likeness image, in stage order. Always the run's
					// own session (`illustrateScene.ts`).
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return []
					const { likenessImagesFor } = await import(
						"$lib/server/pipelines/runtime/illustrateScene"
					)
					return await likenessImagesFor(db, sessionId)
				}

				case "message_line": {
					// 🚧 One row as a line to speak (`core:query/message-line@1`,
					// speech ★1): its words, speaker and recorded sprite label.
					// This session's only; hidden or still being written reads
					// as null (`pipelines/speech/messageLine.ts`).
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null
					if (typeof q.messageId !== "number" || !Number.isInteger(q.messageId)) return null
					const { messageLineFor } = await import(
						"$lib/server/pipelines/speech/messageLine"
					)
					return await messageLineFor(db, sessionId, q.messageId)
				}

				case "graph_entry_links": {
					/**
					 * The edges the cast traversal cannot see.
					 *
					 * A separate read rather than more rows on
					 * `graph_relationships`, and the reason is the one stated
					 * on that case: it is a projection of `collectGraphLayers`,
					 * which walks outward from the speaker's node. An edge
					 * between two places has no speaker to walk from, so it is
					 * not a row that traversal left out — it is a different
					 * question, asked once, by the link hop alone.
					 *
					 * `null` on no session and no lorebook, `[]` on a lorebook
					 * whose entries are not linked to anything — which is every
					 * book until somebody draws a road.
					 */
					const sessionId = q.sessionId ?? scope.sessionId
					assertScoped(node, q.sessionId, scope.sessionId)
					if (sessionId === undefined) return null

					const { readGraphEntryLinks } = await import(
						"$lib/server/utils/graphEntryLinks"
					)
					return await readGraphEntryLinks(db, sessionId)
				}

				case "available_tools": {
					/**
					 * What tools this session can call, right now.
					 *
					 * Instance state like `embedding_status` next door, and for
					 * the same reason it is a read rather than config: which
					 * extensions are installed and enabled is a fact about this
					 * moment, and a spec resolved before an admin enabled one
					 * would advertise a list that is already wrong.
					 *
					 * Declarations only — a name, a sentence and a JSON Schema.
					 * Nothing here can run anything; `core:oracle/run-tool@1`
					 * does that, and resolves the same list again through the
					 * same module so the advertisement and the dispatch cannot
					 * disagree.
					 */
					const { toolProviders } = await import(
						"$lib/server/pipelines/runtime/tools/resolve"
					)
					const providers = await toolProviders(db, {
						plugins: q.plugins !== false
					})
					const include: string[] = Array.isArray(q.include)
						? q.include.filter(
								(n: unknown) => typeof n === "string"
							)
						: []
					const { withoutForbiddenWebTools } = await import(
						"$lib/server/pipelines/runtime/tools/webTools"
					)
					// The web tools are offered to the assistant genres alone (ruled 2026-10-19).
					const declared = await withoutForbiddenWebTools(
						db,
						q.sessionId ?? scope.sessionId,
						providers.map((t) => t.declaration)
					)
					// 🚧 The session's tool kinds (Chat's `tools` field): a list narrows
					// the offer to those kinds' tools; absent offers everything.
					const { toolsOfKinds } = await import("$lib/server/pipelines/runtime/tools/assistantTools")
					const byKind = toolsOfKinds(q.kinds)
					// 🚧 The filing tools (lane 2): only where the session switched
					// their kind on, or its memory task is on — never by default.
					const { WRITE_TOOL_NAMES, writeToolsAllowed } = await import(
						"$lib/server/pipelines/runtime/tools/writeTools"
					)
					const writes = await writeToolsAllowed(db, q.sessionId ?? scope.sessionId)
					const offered = declared.filter((d) =>
						WRITE_TOOL_NAMES.has(d.name) ? writes.has(d.name) : !byKind || byKind.has(d.name)
					)
					// The author's order, not the registry's: `include` is a
					// list a spec wrote, and the order tools are advertised in
					// is one of the few things an author can use to steer which
					// one a model reaches for first.
					return include.length
						? include
								.map((n) => offered.find((d) => d.name === n))
								.filter((d): d is NonNullable<typeof d> => !!d)
						: offered
				}

				case "embedding_status":
					return readEmbeddingStatus()

				case "vector_search":
					return readVectorSearch({ db, scope, host, node, q })

				case "entity_annotations":
					return readEntityAnnotations({ db, scope, host, node, q })

				case "recalled_lines":
					return readRecalledLines({ db, scope, host, node, q })

				case "mention_spans":
					return readMentionSpans({ db, scope, host, node, q })

				case "entity_link":
					return readEntityLink({ db, scope, host, node, q })

				default:
					throw new HostScopeError(
						`${node.key} (${node.definitionId}) tried to read '${table}', which no Query type is ` +
							`bound to. Reads are enumerated here on purpose — a table nobody listed is a ` +
							`table nobody reviewed for scope.`
					)
			}
		},

		async call(payload, node, run, handles) {
			return hostCall({ db, scope, host, toolDoors }, payload, node, run, handles)
		},

		async commit(payload, node) {
			const p = (payload ?? {}) as Record<string, any>

			switch (node.definitionId) {
				case "core:outlet/create-message": {
					// The run's own session and user, and only those: payload-
					// borne `sessionId`/`userId` overrides were read here and
					// nothing declared or supplied them (U2 residual,
					// 2026-09-16). A port that let a spec write into another
					// session, or as another user, would be a scope escape
					// wearing a port's clothes — so the reads went rather than
					// the declarations arriving.
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write to — the run was started without a session scope`
						)
					/**
					 * Which lane it lands on (20 §7). Absent is `main`, so a
					 * pipeline that has never heard of channels writes where
					 * it always did.
					 *
					 * A lane the session does not have is refused rather than
					 * coerced: a message on a channel no surface subscribes to
					 * is a message nobody will ever see, which is the shape of
					 * data loss even though the row is right there. Same
					 * posture as `assertScoped` — refused, not filtered.
					 *
					 * The refusal is on the **channel**, not the lane: a genre
					 * declares slugs and its pipelines allocate lanes at
					 * runtime, so `text-messages:6` needs no permission that
					 * `text-messages` did not already have.
					 */
					const refusal = await channelRefusal(
						db,
						sessionId,
						p.channel
					)
					if (refusal)
						throw new HostScopeError(`${node.key}: ${refusal}`)
					const race = racesLiveRow(node.key, p.channel)
					if (race) throw new HostScopeError(race)

					const { insertLegacy, updateLegacyWhere } = await import(
						"$lib/server/messages/store"
					)

					/**
					 * The pipeline owns its row (09-B B4, R-17). What this
					 * node commits is the row the composer shows, the run's
					 * live row and the row Stop finalises — so the two facts
					 * a placeholder needs are on the payload, declared:
					 * `generating`, and who it is for.
					 */
					const generating = p.generating === true
					/**
					 * Narration: not a character's turn. `characterId` stays
					 * **null** even when a real speaker was picked — that is the
					 * whole of "not inserted into the round-robin" surviving
					 * contact with the database. The rotation (`rotationTurns`) drops
					 * `isNarratorResponse` rows before it matches ids, but the
					 * column is also what `computeDueCharacter` reads on every
					 * other path, and a side-character turn is not the
					 * character's turn in any of them. The identity rides on
					 * `metadata.sideCharacter` (the side-character fact), where
					 * the run and the receipt read it.
					 *
					 * The name is resolved at the write, which is where the row
					 * is: the speaker's where one was named, else the session's
					 * narrator config's, else the default — the same three-way
					 * fallback, resolved at the write rather than by the trigger.
					 */
					const narration = p.narration === true
					// The side-character fact, off the `sideCharacter` in-port
					// (was `speaker` until 2026-09-16). Stored under
					// `metadata.sideCharacter` since U5g (migration 0138 moved
					// the rows): `metadata.speaker` is the participant
					// reference now, on the row as on the inlet (R1).
					const sideCharacter =
						p.sideCharacter && typeof p.sideCharacter === "object"
							? (p.sideCharacter as {
									name?: string
									characterId?: number | null
									known?: boolean
								})
							: null
					/**
					 * Who is speaking, as a participant reference (R-18 (3);
					 * U5g) — the `speaker` in-port, `character:<id>` or
					 * `envoy:<slug>`. Stored as `metadata.speaker`. For an
					 * envoy it is the row's ONLY identity: there is no
					 * character row for `characterId` to name, and the client
					 * renders the envoy's name and image from the session view
					 * by this reference. A well-formed reference only; anything
					 * else is not stored rather than stored as noise.
					 */
					// 🚧 A `seated-member:<memberId>` speaker is stored in its seat's
					// card form (`metadata.speaker` stays `character:<cardId>` /
					// `player-seat:<seatId>`; seat-cast S3). A member no seat of
					// this session holds is refused by name — never stored raw,
					// and never quietly handed to the unclaimed-line fallback.
					const askedRef =
						typeof p.speaker === "string" && isParticipantRef(p.speaker)
							? p.speaker
							: null
					const namedRef =
						askedRef === null
							? null
							: await storedSeatRef(db, sessionId, askedRef)
					if (askedRef !== null && namedRef === null)
						throw new HostScopeError(
							`${node.key}: ${JSON.stringify(askedRef)} is not seated in this session — name a seat (player-seat:<id>, seated-member:<id>, character:<id>) or an envoy`
						)
					/**
					 * Everyone has a name (ruled 2026-09-26). An envoy named
					 * here must be one this session declares — refused by
					 * name, since a line under a slug nothing declares renders
					 * under nobody. And a fresh line nobody claims — no
					 * character, persona, speaker, side character or narration
					 * — posts as the running document's action envoy, else the
					 * genre's fallback envoy (`unclaimedLineSpeaker`); with
					 * neither it stays speakerless and readers name it with the
					 * narrator name, then `UNCLAIMED_LINE_NAME`. A claimed row
					 * (regenerate, swipe, extend) keeps the identity it has.
					 */
					/**
					 * 🚧 **A person's own message** (`role: 'user'`; owner
					 * ruling 2026-10-15): the row the composer's Send asks
					 * for, written by the save pipeline the session's preset
					 * binds on `message-offered` — never by the host directly.
					 * Held to the run's OWN person on a ROOT run: a dispatched
					 * child is the system's, and a person's line is written
					 * only as the person who sent it. Who it speaks as is the
					 * `speaker`: their persona (`character:<id>`, a card they
					 * own), their card-less seat (`player-seat:<id>`, stamped
					 * as today), or themselves (`user:<id>` or nothing).
					 * Anything else — an envoy, someone else's persona or
					 * seat, a placeholder, narration, a claimed row — is
					 * refused here, with the sentence the person reads.
					 */
					const personRow = p.role === "user"
					const personLine = personRow
						? await personLineOf(node, sessionId, namedRef, p)
						: null
					if (!personRow && Array.isArray(p.trayItems) && p.trayItems.length)
						throw new HostScopeError(
							`${node.key}: tray items are a person's attachments — only a person's message (role 'user') carries them`
						)
					const {
						unclaimedLineSpeaker,
						undeclaredSpeakerRefusal
					} = await import("$lib/server/pipelines/entities/envoys")
					const namedEnvoy = envoySlugOfRef(namedRef)
					if (namedEnvoy) {
						const undeclared = await undeclaredSpeakerRefusal(
							db,
							sessionId,
							namedEnvoy
						)
						if (undeclared)
							throw new HostScopeError(`${node.key} ${undeclared}`)
					}
					/**
					 * 🚧 **A table row** (PLAN-rulesets §30, 2026-10-16):
					 * `tableLine` naming the message the row belongs to (a
					 * row id, or a write result — the Narrator's placeholder)
					 * rather than `true`. Stored as `metadata.anchorMessageId`
					 * on whatever channel the spec names (the genre's `table`
					 * channel), with no speaker — not the Narrator, not an
					 * envoy: the table speaks in no voice, so it is never an
					 * unclaimed line handed to the fallback envoy. The anchor
					 * must be a row of this session; deleting it takes the
					 * row with it (`messages/store.ts`). ⏳ `true` is the
					 * marker it replaces, still a faceless lane note's.
					 */
					const tableAnchor =
						p.tableLine === true || p.tableLine === false || p.tableLine == null
							? null
							: messageRefId(p.tableLine)
					if (
						p.tableLine !== true &&
						p.tableLine !== false &&
						p.tableLine != null &&
						tableAnchor === null
					)
						throw new HostScopeError(
							`${node.key}: tableLine takes true or the message the table row belongs to — wire the placeholder's messageId`
						)
					if (tableAnchor !== null) {
						const anchorRow = await legacyMessage(db, tableAnchor)
						if (!anchorRow)
							throw new HostScopeError(
								`${node.key}: no message ${tableAnchor} to anchor the table row to`
							)
						assertScoped(node, anchorRow.sessionId, sessionId)
					}
					const unclaimed =
						tableAnchor === null &&
						!namedRef &&
						!narration &&
						!sideCharacter &&
						p.row == null &&
						refId(p.characterId) == null &&
						p.personaId == null &&
						(p.role ?? "assistant") === "assistant"
					const speakerRef =
						namedRef ??
						(unclaimed
							? await unclaimedLineSpeaker(db, sessionId, {
									specId: scope.specId,
									contributes: scope.contributes
								})
							: null)
					/**
					 * A side note an envoy says (`narration` with an envoy
					 * `speaker` — the Dungeon Crawler's reveal, said by the
					 * Planner) is under the envoy's own name, not the
					 * narrator's: the row is narration only so it is no
					 * reply in the turn order (DUNGEON_CRAWLER_DECLARED_RULE).
					 */
					const envoyNarrator =
						narration && namedEnvoy
							? await (async () => {
									const { sessionDeclaredEnvoys } = await import(
										"$lib/server/pipelines/entities/envoys"
									)
									const { i18nText } = await import("@serene-pub/sdk")
									const decl = (
										await sessionDeclaredEnvoys(db, sessionId)
									).find((d) => d.slug === namedEnvoy)
									return decl ? i18nText(decl.name) || null : null
								})()
							: null
					const narratorName = narration
						? sideCharacter?.name ||
							envoyNarrator ||
							(await narratorNameOf(sessionId)) ||
							"Narrator"
						: undefined
					const instructions =
						typeof p.instructions === "string" &&
						p.instructions.trim()
							? p.instructions
							: undefined
					// Folded sections (B4): checked before anything is
					// written, so a malformed list writes nothing at all.
					const sections = foldedSectionsIn(node, p.sections)
					// `answersForm` is the host's fact (U5f): a spec's or a
					// client's copy is dropped, and the run's own — the form
					// `fireAction` was fired for — is stamped in its place.
					// `turnCause` is the host's fact too: a spec's or a client's
					// copy is dropped.
					const { answersForm: _claimed, turnCause: _cause, ...givenMetadata } =
						(p.metadata ?? {}) as Record<string, unknown>
					const metadata: Record<string, unknown> = {
						...givenMetadata,
						...(narratorName ? { narratorName } : {}),
						...(instructions
							? { narratorInstructions: instructions }
							: {}),
						...(sideCharacter ? { sideCharacter } : {}),
						// A person's row carries only a seat's stamp, as the
						// send always wrote it: a persona is the row's
						// `personaId`, and the person as themselves is the row.
						...(personLine
							? personLine.seatRef
								? { speaker: personLine.seatRef }
								: {}
							: speakerRef
								? { speaker: speakerRef }
								: {}),
						...(scope.answersForm
							? {
									answersForm: {
										messageId: scope.answersForm.messageId,
										blockId: scope.answersForm.blockId
									}
								}
							: {}),
						...(scope.planRowId !== undefined
							? { planRowId: scope.planRowId }
							: {})
					}
					if (sections?.length) metadata.sections = sections
					// ★T-1 The narrator's unprompted line says why it spoke. Only
					// this: a side-cast pick shares the `via` but is a character's
					// reply (`currentCharacterId` is set on its turn); a claimed row
					// keeps the stamp it has; and the cause is written only for a
					// setting that is ON — a line that still lands after the owner
					// switched it off, or from a plugin's own turn order, says nothing
					// rather than something false (P1).
					const stampRow =
						typeof p.row === "number" ||
						(typeof p.row === "string" && /^\d+$/.test(p.row))
					if (
						scope.via === "unprompted" &&
						narration &&
						!personLine &&
						!speakerRef &&
						!sideCharacter &&
						scope.currentCharacterId == null &&
						!stampRow
					) {
						const { genreFieldsFor } = await import("$lib/server/pipelines/entities/sessionGenres")
						const { narratorCadenceKey } = await import("$lib/shared/sessions/narratorCadence")
						const key = narratorCadenceKey((await genreFieldsFor(db, sessionId)).narratorInterjections)
						const every =
							key === "every-round" ? 1 : key === "every-2nd-round" ? 2 : key === "every-3rd-round" ? 3 : null
						if (every !== null) metadata.turnCause = { via: "unprompted", every }
					}
					// 🚧 An outcome row's result in words, no number in it (Lair
					// rewrite D3; any check method since 2026-10-22): what a
					// prompt reads while Show outcomes is off.
					{
						const { outcomeWordsOf, DICE_WORDS_KEY } = await import("$lib/server/messages/diceWords")
						const words = await outcomeWordsOf(db, p.blocks, sessionId)
						if (words) metadata[DICE_WORDS_KEY] = words
					}
					// 🚧 A row's kind (2026-10-17): one word, when wired.
					{
						const { messageKindOf } = await import("./messageKind")
						const kind = messageKindOf(p.kind)
						if (kind && typeof kind === "object") throw new HostScopeError(`${node.key}: ${kind.refused}`)
						if (kind) metadata.kind = kind
					}
					// ⏳ A table line (2026-10-15): the table's own line, in
					// no voice — a history that asks for none leaves it out.
					if (p.tableLine === true) metadata.tableLine = true
					// 🚧 A table row (§30): the message it belongs to.
					if (tableAnchor !== null) metadata.anchorMessageId = tableAnchor
					/**
					 * 🚧 The turns a planner's row plans (Lair character
					 * turns): resolved to participant references here, once,
					 * and stored — the history projects it for the turn
					 * order and `turn-plan@1` (`sessions/turnPlan.ts`).
					 */
					if (p.turnPlan != null) {
						const { storedTurnPlan } = await import("$lib/server/sessions/turnPlan")
						const turnPlan = await storedTurnPlan(db, sessionId, p.turnPlan)
						if (turnPlan) metadata.turnPlan = turnPlan
					}

					/**
					 * An existing row, claimed rather than inserted (the
					 * inlet's `messageId` on a regenerate, swipe or extend).
					 * Reset to generating; its text and swipe history stay as
					 * the verb left them — an extend's partial is the prefill
					 * the seed line carries, and the live row joins onto it.
					 * Refused outside this session, like every other reach.
					 */
					const claimId =
						typeof p.row === "number"
							? p.row
							: typeof p.row === "string" && /^\d+$/.test(p.row)
								? Number(p.row)
								: null
					let row: Awaited<ReturnType<typeof insertLegacy>>
					/** The pressing person's own line — see `message-completed` below. */
					let personsOwnLine = false
					/** A person's message posted with tray items — announced with its parts. */
					let personAttached = false
					if (claimId !== null) {
						const existing = await legacyMessage(db, claimId)
						if (!existing)
							throw new HostScopeError(
								`${node.key}: no message ${claimId} to take as the placeholder`
							)
						assertScoped(node, existing.sessionId, scope.sessionId)
						/**
						 * Only a row that is ALREADY generating can be claimed.
						 * The verb's handler set it so before the run started;
						 * that state is what says "this row is waiting for a
						 * run". Without the check `row` was a port through
						 * which an authored spec could take over any settled
						 * message in the session — somebody's finished reply,
						 * the user's own line — reset it to generating and
						 * overwrite it at `save`. Fenced in the write as well,
						 * so a row released between the read and the claim
						 * (a Stop landing exactly then) is refused too rather
						 * than resurrected.
						 */
						if (!existing.isGenerating)
							throw new HostScopeError(
								`${node.key}: message ${claimId} is not generating, so it is not a ` +
									`placeholder this run may claim — only a row a regenerate, swipe ` +
									`or extend has already set generating can be taken over.`
							)
						const [claimed] = await updateLegacyWhere(
							db,
							and(
								eq(schema.sessionMessages.id, claimId),
								eq(schema.sessionMessages.isGenerating, true)
							),
							{
								// A stale status from the run this row last
								// waited on says nothing about this one.
								generationStatus: null,
								queueItemId: null,
								error: null,
								// A re-driven row's outcome is the run's to
								// decide: a stop before this claim is cleared.
								generationOutcome: null,
								// Sections handed to the claim are the shown
								// alternative's (B4) — normally they come
								// with the save instead.
								...(sections
									? {
											metadata: withFoldedSections(
												existing.metadata,
												sections
											)
										}
									: {})
							}
						)
						if (!claimed)
							throw new HostScopeError(
								`${node.key}: message ${claimId} was released before this run could claim it`
							)
						row = claimed
					} else if (personLine) {
						const message = {
							sessionId,
							userId: scope.userId!,
							characterId: null,
							personaId: personLine.personaId,
							role: "user",
							channel: canonicalChannel(p.channel),
							content: String(p.text ?? ""),
							// Only what the send always stored: a seat's stamp.
							...(Object.keys(metadata).length ? { metadata } : {})
						}
						const { normaliseTrayItemIds, commitTraySend } = await import(
							"$lib/server/attachments/send"
						)
						const { TrayRefusal } = await import("$lib/server/attachments/tray")
						try {
							const trayItemIds = normaliseTrayItemIds(p.trayItems)
							if (trayItemIds.length) {
								const { attachmentReaders } = await import(
									"$lib/server/attachments/readers"
								)
								const readers = await attachmentReaders(db, {
									sessionId,
									userId: scope.userId!,
									channel: message.channel
								})
								row = (
									await commitTraySend(db, {
										userId: scope.userId!,
										sessionId,
										trayItemIds,
										message,
										readers
									})
								).message
								personAttached = true
							} else row = await insertLegacy(db, message)
						} catch (error) {
							// The tray's own sentence, for the person to read; the
							// transaction rolled back and the tray is as it was. What the
							// person did and can fix reads as written for every reader,
							// unless the sentence quotes a connection's or model's words.
							if (error instanceof TrayRefusal)
								throw forPeople(
									new HostScopeError(error.message),
									error.namesPlumbing ? undefined : error.message
								)
							throw error
						}
						// The person's send: auto-advance answers it as one (§4.6).
						personsOwnLine = true
					} else {
						/**
						 * Who speaks, as a cast row. Wired, or — when only the
						 * `speaker` reference names a character — that
						 * reference's row: `character:<id>` and a `characterId`
						 * are one fact, so a spec that says who speaks the one
						 * way has said it the other (lair pass B16: a delver's
						 * row carries the reference its context resolved).
						 */
						// ⏳ (S4) `speakerRef` is stored in member form with the switch
						// on; its card row is the card its seat holds.
						const namedRow = speakerRef
							? parseParticipantRef(
									(await cardFormOfStored(db, sessionId, speakerRef)) ??
										speakerRef
								)
							: null
						const speakerRow =
							namedRow?.kind === "character"
								? participantRowId(namedRow.id)
								: null
						const characterId = narration
							? null
							: (refId(p.characterId) ?? speakerRow ?? null)
						/**
						 * A person's own line — through their presence, or as
						 * themselves.
						 *
						 * A character that is the RUN OWNER's presence in this
						 * session — a persona — writes the PERSON's row, not a
						 * character's (personas merged into characters, 0132:
						 * a persona is a character row with `is_persona`, and
						 * the message's role columns keep the `persona_id`
						 * name). The `adventure-answer` road names the pressed
						 * option's addressee as `characterId`; committed as a
						 * character row it resolves against the cast, where a
						 * persona never is, and the line rendered as "Unknown"
						 * (2026-09-17). A `speaker` of `user:<id>` naming the
						 * run owner, with no character at all, is the same
						 * person answering as themselves — a persona-less line
						 * is its author's: `role: user` under their id, no
						 * persona (handover 2026-09-17 §4).
						 *
						 * The presence is decided from the run's PINNED
						 * portrayals (R-21 (4)), the one membership read every
						 * run already pays: `person` for `character:<id>` is
						 * exactly "a live `session_personas` row whose owner
						 * is a member", with the holder's id on it. Three
						 * things keep both readings to the person's OWN press:
						 * the holder — or the `user:` reference — must be the
						 * run owner (a press is admitted only to the presence's
						 * person, `fireAction`); the run must be a ROOT — a
						 * dispatched run is the system's, and the AI's answer
						 * as a character who became a member's presence
						 * mid-answer stays the AI's line (W3); and a generating
						 * placeholder is the model's row, never a person's. A
						 * spec that names `personaId` itself has already said
						 * so and is left alone; a host with no portrayals
						 * (hand-wired, a preview) writes what it was given.
						 */
						const ownPress =
							p.personaId == null &&
							!scope.lineage &&
							!generating &&
							scope.userId != null
						// ⏳ (S4) The pinned portrayals are keyed by the ref as asked
						// (`turnRefs`): switch on, the seat's member form — the stored
						// speaker when it is one, else the seat holding the card.
						const presenceKey =
							ownPress && characterId !== null
								? memberFormOn()
									? parseSeatRef(speakerRef ?? "")?.form === "seated-member" ||
										parseSeatRef(speakerRef ?? "")?.form === "player-seat"
										? speakerRef!
										: ((await storedSeatRef(
												db,
												sessionId,
												`character:${characterId}`
											)) ?? `character:${characterId}`)
									: `character:${characterId}`
								: null
						const presence =
							presenceKey !== null
								? scope.portrayals?.[presenceKey as ParticipantRef]
								: undefined
						const asPersona =
							presence?.by === "person" &&
							presence.userId === String(scope.userId)
						const speakerParsed = speakerRef
							? parseParticipantRef(speakerRef)
							: null
						const asSelf =
							ownPress &&
							characterId === null &&
							speakerParsed?.kind === "user" &&
							participantRowId(speakerParsed.id) === scope.userId
						// Only the owner's answer to a question put to the OWNER
						// (the Lair's knock): out of the fiction, their answer is
						// their steering and the story moves on as from a send.
						// Every other line a run writes as a person — an in-story
						// answer, a question they ask — stays the run's.
						personsOwnLine =
							(asPersona || asSelf) && scope.answersForm?.toOwner === true
						/**
						 * 🚧 **A table line is said once** (2026-10-16 walk): the
						 * same table line, by the same speaker, already the
						 * channel's newest row is that line — a Retry that fires
						 * a halted press again ("Name: Ann.") finds it there and
						 * writes nothing. Only a table line: no model wrote it,
						 * so the second would be the first word for word.
						 */
						if (metadata.tableLine === true && !generating) {
							const { liveMessageWhere } = await import("$lib/server/messages/store")
							const [head] = await db
								.select({
									id: schema.sessionMessages.id,
									content: schema.sessionMessages.content,
									metadata: schema.sessionMessages.metadata
								})
								.from(schema.sessionMessages)
								.where(
									and(
										eq(schema.sessionMessages.sessionId, sessionId),
										eq(schema.sessionMessages.channel, canonicalChannel(p.channel)),
										// 🚧 The live history (RF fix 5): a rewound row is
										// no line already said. The one predicate (pr-6 A5).
										liveMessageWhere()
									)
								)
								.orderBy(desc(schema.sessionMessages.id))
								.limit(1)
							const was = (head?.metadata ?? {}) as Record<string, unknown>
							if (
								head &&
								was.tableLine === true &&
								(head.content ?? "").trim() === String(p.text ?? "").trim() &&
								(was.speaker ?? null) === (metadata.speaker ?? null)
							)
								return { id: head.id, sessionId }
						}
						row = await insertLegacy(db, {
							sessionId,
							userId: scope.userId ?? null,
							characterId: asPersona ? null : characterId,
							personaId: asPersona
								? characterId
								: (p.personaId ?? null),
							role:
								p.role ??
								(asPersona || asSelf ? "user" : "assistant"),
							// Canonical, so `text-messages:1` and `text-messages`
							// cannot land in the column as two lanes.
							channel: canonicalChannel(p.channel),
							content: String(p.text ?? ""),
							metadata,
							isNarratorResponse: narration,
							isGenerating: generating
						})
					}

					record(
						node,
						"message",
						row.id,
						claimId !== null ? "updated" : "created"
					)
					// The composer's placeholder IS this row (R-17): announced
					// from the write, so the client sees it the moment it
					// exists — before a token has been spent on it.
					scope.live?.opened(row)
					if (personAttached) await announceWithParts(row.id)
					else await announce(row)

					// Media posted WITH the message (the `media` in-port).
					//
					// It has to happen here rather than in a following
					// `attach-image`, because a message created inside a run
					// cannot be the target of a later node — `write-result@1` is
					// not assignable to `row-ids@1`, deliberately, since under
					// async review the row may never exist. So the write that
					// creates the message is the write that attaches its images.
					if (Array.isArray(p.media) && p.media.length) {
						const parts = await mediaParts(
							db,
							p.media,
							sessionId,
							scope,
							node
						)
						if (parts.length) {
							const { appendParts } = await import(
								"$lib/server/messages/store"
							)
							await appendParts(db, row.id, parts)
							// The files are the run's output too — the message
							// alone would say a reply happened and lose the
							// images it was actually about.
							for (const part of parts)
								record(
									node,
									"file",
									part.data.assetId,
									"attached"
								)
						}
					}

					// Blocks posted WITH the message (the `blocks` in-port,
					// U5d) — for the reason media is: the write that creates
					// the row is the write that gives it its parts. A form
					// among them addressed to the AI goes on the run's list
					// for `runSpec` to dispatch once the receipt is saved.
					const blocks = await writeBlocks(node, row, p.blocks)
					if (blocks || sections?.length)
						await announceWithParts(row.id)

					// A row that is not generating LANDED (PLAN-turn-order
					// §4.1): a person's own line through an action, a reply
					// written whole. Never for a placeholder — that row
					// completes when `update-message` finishes it.
					//
					// The cause is the PERSON's when the row is the owner's own
					// answer to a question put to the owner, on their own press
					// (lair pass B12, 2026-09-27) — the Lair's "the party go on"
					// once the knock is answered: their steering, so auto-advance
					// treats it as a send (§4.6). Every other row a run lands is
					// the run's.
					if (row.isGenerating !== true)
						await emit(
							"core:event/message-completed@1",
							{ sessionId: row.sessionId, messageId: row.id },
							{ kind: personsOwnLine ? "user" : "run" }
						)

					// A placeholder or a claimed row is the run's live row; a
					// complete message is an ordinary write (F7, W1 — see
					// `racesLiveRow`). A claimed row keeps the channel it
					// already sits on, whatever the payload says.
					if (opensLiveRow(p) && liveChannel === undefined) {
						liveChannel = canonicalChannel(
							claimId !== null
								? (row as { channel?: unknown }).channel
								: p.channel
						)
						liveRowId = row.id
						turnMessageId = row.id
						noteTurnMessage(scope.runId, row.id)
					}
					return { id: row.id, sessionId: row.sessionId }
				}

				case "core:outlet/seed-greetings": {
					// The create pipeline's write (24 §12, T8) — the same
					// implementation the imperative path used, behind the
					// declared node. Empty greetings are an ordinary state.
					// The run's own session and user — see `create-message`.
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write to — the run was started without a session scope`
						)
					const userId = scope.userId
					if (userId === undefined || userId === null)
						throw new HostScopeError(
							`${node.key} has no user to write as — the run was started without a user scope`
						)
					/**
					 * The same refusal `create-message` makes, for the same
					 * reason: a greeting seeded onto a channel the genre never
					 * declared is N messages nothing will ever render. The
					 * genre's own `greeting.channel` counts as declared
					 * (`channelsOf`), so a genre redirecting its own greetings
					 * cannot trip this — only a pipeline wiring in some other
					 * value can.
					 */
					const greetingRefusal = await channelRefusal(
						db,
						sessionId,
						p.channel
					)
					if (greetingRefusal)
						throw new HostScopeError(
							`${node.key}: ${greetingRefusal}`
						)
					// Empty greetings write nothing, so they race nothing.
					const race =
						Array.isArray(p.greetings) && p.greetings.length > 0
							? racesLiveRow(node.key, p.channel)
							: null
					if (race) throw new HostScopeError(race)

					const { writeSessionGreetings } = await import(
						"$lib/server/sessions/greetings"
					)
					const ids = await writeSessionGreetings(db, {
						sessionId,
						userId,
						entries: Array.isArray(p.greetings) ? p.greetings : [],
						// Canonicalised here as well as inside
						// `writeSessionGreetings`: this is a write path, and a
						// write path normalises where it can see the value.
						channel: canonicalChannel(p.channel)
					})
					// ⚠ **N messages, all of them recorded.** This is the case
					// the old single `message_id` column structurally could not
					// hold: `writtenMessageId` read `output.ids.id` off the
					// first committed consumer, this consumer publishes `ids[]`,
					// and so a greeting seed recorded nothing at all.
					for (const id of ids) record(node, "message", id, "created")
					// Each seeded greeting is a row that landed (§4.1): one
					// `message-completed` per row, as the create-message
					// commit emits for the one row it writes.
					for (const id of ids)
						await emit(
							"core:event/message-completed@1",
							{ sessionId, messageId: id },
							{ kind: "run" }
						)
					return { ids, count: ids.length, sessionId }
				}

				case "core:outlet/update-message": {
					/**
					 * The target is a row id from the inlet, or the write
					 * result of an earlier outlet in this run — the reply's
					 * `$.placeholder.messageId`, whose `ids.id` IS a row id by
					 * the time this node runs (09-B B4).
					 */
					const target = p.target
					const id = refId(
						target && typeof target === "object" && "ids" in target
							? (target as { ids?: { id?: unknown } }).ids?.id
							: target
					)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id to update — wire 'target' from the ` +
								`inlet's row id, or from the placeholder outlet that created the row.`
						)
					const { updateLegacyWhere, updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to update`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					const text = String(p.text ?? "")
					// Folded sections (B4), checked before either write.
					const sections = foldedSectionsIn(node, p.sections)

					/**
					 * The row decides which of the two updates this is.
					 *
					 * **Still generating** — the placeholder this run created:
					 * finish it. The text lands joined onto whatever a continue
					 * started from, the reasoning trace and the swipe slot are
					 * written through the one builder that keeps their
					 * invariants, and the flags that end the generation are
					 * cleared. Fenced on the row still generating: a Stop that
					 * released it first wins — and when the released row is
					 * THIS run's own live row, winning means the reply that
					 * arrived after the stop is dropped, not written. Before
					 * that rule was code, a Stop landing between the fence
					 * check and the write fell through to the edit below and
					 * put the whole reply over the partial the person had just
					 * kept, marked as their edit.
					 *
					 * **Settled** — a person's edit, a rewrite from outside the
					 * run: the text replaces, and the row says it was edited.
					 * Never the run's own PLACEHOLDER: the only way that row is
					 * settled while its run is still going is a Stop, so the
					 * reply that arrived after it is dropped here too. A row
					 * this run created complete and now edits is not that —
					 * it was never open — and takes the edit as written.
					 */
					const ownRow =
						scope.live?.id === id && scope.live.placeholder === true
					if (ownRow && !current.isGenerating)
						return { id: current.id, sessionId: current.sessionId }
					if (current.isGenerating) {
						const { buildReasoningMetadata } = await import(
							"$lib/server/messages/reasoningMetadata"
						)
						const { joinContinuation } = await import(
							"$lib/server/messages/continuation"
						)
						// Onto the PREFILL — what the row held when the
						// placeholder claimed it — never onto its current
						// text: the live row has been rewriting that with the
						// stream, already joined, and joining again would
						// write the reply twice. Without a live row nothing
						// streamed, and the row still holds the prefill.
						const content = joinContinuation(
							scope.live?.id === id
								? scope.live.prefill
								: (current.content ?? ""),
							text
						)
						const reasoning =
							typeof p.reasoning === "string" && p.reasoning.length
								? p.reasoning
								: undefined
						// A generation that ended with NO reasoning clears what
						// its live frames showed in the fold — a model asked to
						// reason that never did streamed its reply there until
						// the stream ended (`splitReasoningStream`, `requested`).
						const shown = (
							current.metadata as { reasoning?: unknown } | null
						)?.reasoning
						const stale =
							reasoning === undefined &&
							typeof shown === "string" &&
							shown.length > 0
						const thought = buildReasoningMetadata(
							current.metadata,
							content,
							stale ? null : reasoning,
							true
						)
						/**
						 * The shown alternative's folded sections are the
						 * save's, whole (B4): a regenerate replaces what the
						 * slot held and a save with none clears it, while the
						 * other alternatives keep theirs. A slot that had none
						 * and gets none is left alone, so a row that never
						 * carried sections is written exactly as before.
						 */
						const base = thought ?? current.metadata
						const touchesSections =
							!!sections?.length ||
							foldedSectionsOf(base).length > 0
						const metadata = touchesSections
							? withFoldedSections(base, sections ?? [])
							: thought
						const [finished] = await updateLegacyWhere(
							db,
							and(
								eq(schema.sessionMessages.id, id),
								eq(schema.sessionMessages.isGenerating, true)
							),
							{
								content,
								isGenerating: false,
								generationStatus: null,
								generationOutcome: null,
								queueItemId: null,
								error: null,
								...(metadata !== null ? { metadata } : {})
							}
						)
						if (finished) {
							record(node, "message", finished.id, "updated")
							// The live row is settled: what this run writes
							// on its channel from here on lands after it
							// (F7, "beside, not after" — see `liveRowId`).
							if (finished.id === liveRowId) {
								liveChannel = undefined
								liveRowId = undefined
							}
							// Blocks a reply ends with — a question put to
							// the cast — set once the text has landed (the
							// row's one block tree, S5), and announced with
							// the parts so the buttons show without a reload.
							// 🚧 O5: the reply's media parts — a spoken reply's
							// audio — land with the text, in the model's order.
							const spoke = await writeMediaParts(node, finished, p.parts)
							const blocks = await writeBlocks(node, finished, p.blocks, {
								replace: true
							})
							if (blocks || touchesSections || spoke)
								await announceWithParts(finished.id)
							else await announce(finished)
							// A verb's rewrite is a change to history a
							// pipeline has already seen (R-15): recorded for
							// the next reply's inlet with the verb on it —
							// and, for a regenerate, with what it replaced
							// (`scope.previous`, W3). A fresh turn's finish is
							// the history growing, not moving, and records
							// nothing.
							if (scope.verb)
								await emit(
									"core:event/message-updated@1",
									{
										sessionId: finished.sessionId,
										messageId: finished.id,
										verb: scope.verb,
										...(scope.previous
											? { previous: scope.previous }
											: {})
									},
									{ kind: "run" }
								)
							// The reply LANDED (PLAN-turn-order §4.1): the
							// event the turn-order spec answers, emitted from
							// the finishing write whether the turn was fresh
							// or a verb's — a row that is not generating.
							// 🚧 `liveRow`: a run's live row finished — a reply
							// that was written into its row as it streamed, as
							// against a row a run wrote whole (a greeting, a
							// plan row). What a routine listening for replies
							// alone says it waits for (the Lair's scratchpad).
							await emit(
								"core:event/message-completed@1",
								{
									sessionId: finished.sessionId,
									messageId: finished.id,
									liveRow: true
								},
								{ kind: "run" }
							)
							await settledMessage(
								finished.id,
								finished.sessionId
							)
							return {
								id: finished.id,
								sessionId: finished.sessionId
							}
						}
						// The fence missed on the run's own row: somebody
						// released it between the read above and the write —
						// a Stop, which wins. The row is left exactly as the
						// release left it, holding the partial; nothing is
						// recorded, because nothing was written.
						if (ownRow) {
							const released = (await legacyMessage(db, id))!
							return {
								id: released.id,
								sessionId: released.sessionId,
								notes: [
									"dropped: row released before the write"
								]
							}
						}
					}

					const row = await updateLegacy(db, id, {
						content: text,
						isEdited: true,
						// An edit that hands the row sections means these
						// sections, for the shown alternative (B4); one that
						// hands none leaves them.
						...(sections
							? {
									metadata: withFoldedSections(
										current.metadata,
										sections
									)
								}
							: {})
					})
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to update`
						)
					record(node, "message", row.id, "updated")
					// The row's one block tree, replaced (S5) — an edit that
					// hands the row new blocks means these blocks.
					const spoke = await writeMediaParts(node, row, p.parts)
					const blocks = await writeBlocks(node, row, p.blocks, { replace: true })
					if (blocks || sections || spoke) await announceWithParts(row.id)
					else await announce(row)
					return { id: row.id, sessionId: row.sessionId }
				}

				// ── The built-in writes (R-15, 2026-09-16) ──────────────────
				//
				// Each is the write half of one message verb, reached through
				// its own one-node spec (`core:spec/builtin-*`, `runBuiltIn`).
				// The venue's handler made the permission checks on the id it
				// was asked about; here they are made AGAIN, on the id the
				// write is about to use (U5b review C1) — the two can differ,
				// because a review gate may fold an edit into the payload
				// between them, and the ownership a handler judged is not a
				// property the payload carries. So: the document is the
				// built-in's own (`assertBuiltInSpec`), the target is checked
				// against the run's session like every other reach, the actor
				// may act on THIS row (`assertMayAct`), the row is changed, the
				// artifact is recorded, the row is announced as today, and the
				// change is written for the next reply's inlet with what was
				// lost or replaced. The event itself rides the outlet's
				// `causesEvent` onto the receipt.

				case "core:outlet/set-turn-order": {
					/**
					 * The one write path for the stored turn order (PLAN
					 * §4.2, §4.4) — annex owner `core`'s runtime key
					 * (pr6s2 §G-1), read with `readStoredTurnOrder`.
					 *
					 * Two drops before the write, each a receipt note rather
					 * than a refusal: an entry naming a ref the pool did not
					 * admit (a script or a plugin strategy cannot seat
					 * somebody nobody pooled), and an entry on a channel
					 * this session does not have (a turn nothing would ever
					 * render). Then `writeTurnOrder`, whose staleness rule
					 * is what stands between two recomputes finishing out of
					 * order — and a stale write is a note too, never an
					 * error: a newer order already answers a newer event.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write a turn order for — the run was started without a session scope`
						)
					// 🚧 A `seated-member:<memberId>` ref is accepted (seat-cast S2)
					// and stored in the card form the order is keyed by; a member
					// nobody is seated as stays as written, so it is not admitted.
					const asCardRef = async (ref: unknown): Promise<unknown> =>
						typeof ref === "string"
							? ((await storedSeatRef(db, scope.sessionId!, ref)) ?? ref)
							: ref
					const candidates = Array.isArray(p.candidates)
						? await Promise.all(
								(p.candidates as Array<Record<string, unknown>>).map(
									async (c) =>
										c && typeof c === "object" && "ref" in c
											? { ...c, ref: await asCardRef(c.ref) }
											: c
								)
							)
						: []
					// Candidates as the pool published them, held to the live cast
					// (M4 review): the pool node is swappable and contributable, so
					// its floors — no removed seat, no on-action envoy — are
					// re-checked here, where no swap can reach (§6).
					const live = await liveCastRefs(db, sessionId)
					const admitted = new Set(
						candidates.map((c) => String(c?.ref)).filter((ref) => live.has(ref))
					)
					const [row] = await db
						.select({ genreId: schema.sessions.genreId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					const { getSessionGenre, STANDARD_GENRE_ID } = await import(
						"$lib/server/pipelines/entities/sessionGenres"
					)
					const declared = new Set(
						channelsOf(
							(
								await getSessionGenre(
									db,
									row?.genreId ?? STANDARD_GENRE_ID
								)
							)?.shape
						)
					)
					const notes: string[] = []
					const order: Array<Record<string, unknown>> = []
					for (const raw of Array.isArray(p.order) ? p.order : []) {
						if (!raw || typeof raw !== "object") continue
						const entry = raw as Record<string, unknown>
						if (typeof entry.ref === "string")
							entry.ref = await asCardRef(entry.ref)
						if (entry.ref !== null && !admitted.has(String(entry.ref))) {
							notes.push(
								`dropped ${String(entry.ref)}: not a candidate this recompute pooled`
							)
							continue
						}
						if (typeof entry.channel === "string" && entry.channel) {
							const channel = canonicalChannel(entry.channel)
							if (!declared.has(parseChannel(channel).slug)) {
								notes.push(
									`dropped ${String(entry.ref ?? "the narrator")}: this session has no channel '${entry.channel}'`
								)
								continue
							}
							entry.channel = channel
						}
						order.push(entry)
					}

					const at = Number(p.basedOnAt)
					const next = {
						v: 1 as const,
						order: order as never,
						candidates: candidates as never,
						basedOnAt: Number.isFinite(at) ? at : Date.now(),
						computedAt: Date.now(),
						runId: scope.runId ?? null,
						event:
							typeof p.event === "string" && p.event ? p.event : null,
						// Which strategy produced this order (§4.2's
						// `strategy`): the node the spec ran, read off the
						// running document rather than guessed — the key is
						// `strategy` by the spec's own declaration (§4.5).
						strategy: await turnStrategyPin(db, scope.specId, sessionId, scope.nodes)
					}
					const { writeTurnOrder } = await import(
						"$lib/server/sessions/turnOrder"
					)
					const result = await writeTurnOrder(db, sessionId, next)
					if (!result.written) {
						notes.push(
							result.reason === "stale"
								? "not written: a newer turn order already answers a newer event"
								: "not written: the session no longer exists"
						)
						const { readStoredTurnOrder } = await import("$lib/server/sessions/turnOrder")
						const stored = await readStoredTurnOrder(db, sessionId)
						/**
						 * 🚧 A person's recompute outvoted (PLAN-dc-after-walk3 R3-1,
						 * the walk's NEW-11: a solo line sent while a round settled
						 * sat silent): a run's recompute emitted after it wrote
						 * first, under a cause that never fires. The person's cause
						 * still gets its decision — on the order now stored, which
						 * read the person's line too — unless the listener already
						 * fired on that order (`personOutvoted`).
						 */
						const outvotedCause =
							p.cause && typeof p.cause === "object" ? (p.cause as Record<string, unknown>) : null
						if (result.reason === "stale" && outvotedCause?.kind === "user" && scope.userId != null) {
							const { personOutvoted } = await import("$lib/server/sessions/autoAdvance")
							if (personOutvoted(sessionId, stored)) {
								notes.push("the person's cause was heard on the newer order")
								const { emitSessionEvent } = await import(
									"$lib/server/pipelines/runtime/sessionEvents"
								)
								await emitSessionEvent(db, {
									sessionId,
									userId: scope.userId,
									event: "core:event/turn-order-changed@1",
									payload: {
										sessionId,
										runId: scope.runId ?? null,
										turnOrder: stored,
										cause: outvotedCause,
										...(scope.lineage ? { lineage: scope.lineage } : {})
									},
									io: scope.io,
									signal: scope.signal
								})
							}
						}
						return {
							written: false,
							sessionId,
							notes,
							turnOrder: stored
						}
					}
					record(node, "session", sessionId, "updated")
					/**
					 * `turn-order-changed`, carrying **the inlet's cause**
					 * (PLAN-turn-order §4.4) — not this run's.
					 *
					 * That is the whole of auto-advance's rule: the listener
					 * asks why the order moved, and the answer has to be why
					 * the *event* fired, not that a pipeline wrote a row. A
					 * person's send recomputes and may fire; a person's edit
					 * recomputes and may not. `causesEvent` on the
					 * declaration is what a receipt records; this is the
					 * emission, on the one road every session event takes.
					 */
					if (scope.userId != null) {
						const { emitSessionEvent } = await import(
							"$lib/server/pipelines/runtime/sessionEvents"
						)
						const cause =
							p.cause && typeof p.cause === "object"
								? (p.cause as Record<string, unknown>)
								: { kind: "system" }
						await emitSessionEvent(db, {
							sessionId,
							userId: scope.userId,
							event: "core:event/turn-order-changed@1",
							payload: {
								sessionId,
								runId: scope.runId ?? null,
								turnOrder: next,
								cause,
								...(scope.lineage ? { lineage: scope.lineage } : {})
							},
							io: scope.io,
							signal: scope.signal
						})
					}
					return {
						written: true,
						sessionId,
						...(notes.length ? { notes } : {}),
						turnOrder: next
					}
				}

				case "core:outlet/set-session-annex": {
					/**
					 * The annex write (§4.3): one owner's document, merged
					 * into what is there unless `merge` is off, under
					 * `pg_advisory_xact_lock(hashtext('annex'), sessionId)`
					 * through `jsonb_set` — so two specs writing two owners'
					 * documents at once cannot lose each other's, and
					 * neither can read-modify-write the column.
					 *
					 * Naming another owner needs `sharedAnnex`; without it
					 * the write is refused with a note rather than silently
					 * landing in the spec's own document, which would be the
					 * worse of the two failures.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write an annex for — the run was started without a session scope`
						)
					const params = (p.params ?? {}) as {
						owner?: unknown
						merge?: unknown
						sharedAnnex?: unknown
					}
					const own = annexOwnerOf(scope.specId)
					const named =
						typeof params.owner === "string" && params.owner.trim()
							? params.owner.trim()
							: null
					if (named && named !== own && params.sharedAnnex !== true)
						return {
							written: false,
							sessionId,
							notes: [
								`refused: '${own}' may not write the annex of '${named}' — set 'Write another owner' on this node to allow it`
							]
						}
					const owner = named ?? own
					const value =
						p.value && typeof p.value === "object" && !Array.isArray(p.value)
							? (p.value as Record<string, unknown>)
							: {}
					// One annex declaration per owner (ruling 2026-09-26): the
					// write names only keys the owner declares for this
					// session's genre, and each value fits its declared shape.
					// Judged here at every write,
					// whatever publish saw: a wired value's keys are known
					// only now. The audience stored is the declaration's.
					const { annexWriteRefusals } = await import("@serene-pub/sdk")
					const { annexFieldsOfOwner, sessionGenreOf } = await import(
						"$lib/server/sessions/annexFields"
					)
					const genreId = await sessionGenreOf(db, sessionId)
					const fields = await annexFieldsOfOwner(db, genreId, owner)
					const refusals = annexWriteRefusals(fields, {
						owner,
						keys: Object.keys(value),
						genre: genreId,
						values: value
					})
					if (refusals.length)
						throw new HostScopeError(`${node.key}: refused — ${refusals.join("; ")}`)
					// 🚧 `base` (M2a a8): the annex document version the spec
					// read — compare-and-set; absent writes as before.
					const base = p.base
					if (
						base !== undefined &&
						base !== null &&
						!(typeof base === "number" && Number.isInteger(base) && base >= 0)
					)
						throw new HostScopeError(
							`${node.key}: base is the annex document version a session-annex read gave (a whole number) — ${JSON.stringify(base)} is not one`
						)
					return await writeAnnexDocument(
						node,
						sessionId,
						owner,
						value,
						params.merge !== false,
						Object.fromEntries(fields.map((f) => [f.key, f.see])),
						new Set(fields.map((f) => f.key)),
						typeof base === "number" ? base : undefined
					)
				}

				case "core:outlet/set-composer-state": {
					/**
					 * 🚧 A composer opened or closed by the genre (owner ruling
					 * 2026-10-15): `sessions.composer_states`, through
					 * `writeComposerState` — the one writer. Core opens and
					 * closes nothing on its own; the send door reads it. A
					 * value that names no lane or no person halts with its
					 * sentence.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to open or close a composer in — the run was started without a session scope`
						)
					const { writeComposerState, ComposerStateRefusal } = await import(
						"$lib/server/sessions/composerStates"
					)
					let states: unknown
					try {
						states = await writeComposerState(db, sessionId, {
							channel: p.channel,
							open: p.open,
							reason: p.reason,
							person: p.person
						})
					} catch (e) {
						if (e instanceof ComposerStateRefusal) return { halt: e.message }
						throw e
					}
					record(node, "session", sessionId, "updated")
					// Every member's composer greys or opens now, not on reload.
					if (scope.io) {
						const [row] = await db
							.select({ userId: schema.sessions.userId })
							.from(schema.sessions)
							.where(eq(schema.sessions.id, sessionId))
							.limit(1)
						if (row) {
							const { pushSessionToParticipants } = await import(
								"$lib/server/sockets/sessions"
							)
							await pushSessionToParticipants(scope.io, sessionId, row.userId).catch(
								(err: unknown) =>
									console.warn("[set-composer-state] session push failed:", err)
							)
						}
					}
					return { written: true, sessionId, states }
				}

				case "core:outlet/propose-scene-cue": {
					/**
					 * 🚧 The judged scene check's answer (sprint 2, pass 7, R-i): a
					 * scene cue with trigger `judged` at `at`, its reason the
					 * model's words; the scene mode decides from there (Suggested:
					 * the chip; Automatic: placed, unless `ask`). The commit is
					 * `proposeJudgedSceneCue` (`scenes/boundaryWatcher.ts`); a cue it skips or refuses is a note, never a halt.
					 * With a `trigger` (the scenes routine's), the cue is for that boundary trigger at `at`, not `judged`.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to suggest a scene in — the run was started without a session scope`
						)
					const at = Number(p.at)
					if (!Number.isInteger(at) || at <= 0)
						return { halt: `${node.key}: at names no line — a message id, as the sweep's sort gives it.` }
					const reason = typeof p.reason === "string" ? p.reason.trim() : ""
					if (!reason) return { halt: `${node.key}: a scene cue says why — reason is empty.` }
					const channel = typeof p.channel === "string" && p.channel.trim() ? p.channel.trim() : "main"
					const ask = (p.params as { ask?: unknown } | undefined)?.ask === true
					const trigger = typeof p.trigger === "string" && p.trigger.trim() ? p.trigger.trim() : undefined
					const { proposeJudgedSceneCue } = await import("$lib/server/scenes/boundaryWatcher")
					const cue = await proposeJudgedSceneCue(db, { sessionId, channel, atMessageId: at, reason, ask, trigger, io: scope.io })
					const written = cue.outcome === "suggested" || cue.outcome === "placed"
					if (written) record(node, "session", sessionId, "updated")
					return { written, sessionId, cue }
				}

				case "core:outlet/summarize-finished-scene": {
					/**
					 * 🚧 **Summarize a finished scene** (`core:outlet/summarize-finished-scene@1`):
					 * starts the genre's own summarizer for `scene` through
					 * `startRoutineSceneSummary` (`sockets/scenes.ts`) in the background and
					 * returns at once, never awaiting it. It calls no model itself. The
					 * routine's `mode` (`full` | `review`) decides what the summary becomes;
					 * a run no routine started does nothing. ⚠ Not `scenes:process` (a
					 * person's press) and not *Compile to Entry*.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to summarize a scene in — the run was started without a session scope`
						)
					if (p.scene === undefined || p.scene === null)
						return { written: false, sessionId, note: "no finished scene is due a summary" }
					const sceneId = Number(p.scene)
					if (typeof p.scene !== "number" || !Number.isInteger(sceneId) || sceneId <= 0)
						return {
							halt: `${node.key}: scene names no scene — a scene id, as scene-summary-due@1 names it.`
						}
					const mode = (p.routine as { mode?: unknown } | undefined)?.mode
					if (mode !== "full" && mode !== "review")
						return {
							written: false,
							sessionId,
							note: "a scene's summary is started only by a routine — this run was not started by one"
						}
					const { startRoutineSceneSummary } = await import("$lib/server/sockets/scenes")
					const started = await startRoutineSceneSummary({ sessionId, sceneId, mode, io: scope.io })
					if (!started.started) return { written: false, sessionId, sceneId, note: started.note }
					record(node, "session", sessionId, "updated")
					return { written: true, sessionId, sceneId }
				}

				case "core:outlet/note-scene": {
					/**
					 * 🚧 **Note it in the scene** (`core:outlet/note-scene@1`, ★S4
					 * 2026-11-10): scenes first — the note is appended to `scene`,
					 * else the run's lane's open scene, by `appendSceneNote`
					 * (`scenes/liveScenes.ts`). Never writes history or messages.
					 * Refused (as a `HostScopeError`) when the text is blank, the
					 * genre keeps no scenes, lore writes are Off, the scene is not
					 * there or is another session's, or none is open.
					 * A retake, Back or delete of the message takes the note back
					 * (`takeSceneNotesAt`); Forward restores it.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to note a scene in — the run was started without a session scope`
						)
					const { appendSceneNote, SceneBoundaryRefusal } = await import(
						"$lib/server/scenes/liveScenes"
					)
					const { turnMessageOf } = await import(
						"$lib/server/pipelines/runtime/runTurnMessage"
					)
					const channel =
						typeof scope.channel === "string" && scope.channel.trim() ? scope.channel : "main"
					try {
						const out = await db.transaction(async (tx) =>
							appendSceneNote(tx as unknown as Db, {
								sessionId,
								sceneId: p.scene,
								channel,
								text: typeof p.text === "string" ? p.text : "",
								runId: scope.runId != null ? String(scope.runId) : null,
								messageId: turnMessageId ?? turnMessageOf(scope.runId) ?? null
							})
						)
						// A locked scene is left as it is: said in a note, nothing recorded.
						if (out.lockedNote)
							return { written: false, sessionId, sceneId: out.sceneId, notes: [out.lockedNote] }
						record(node, "session", sessionId, "updated")
						return { written: true, sessionId, sceneId: out.sceneId }
					} catch (err) {
						if (err instanceof SceneBoundaryRefusal)
							throw new HostScopeError(`${node.key}: ${err.message}`)
						throw err
					}
				}

				case "core:outlet/set-seat-name": {
					/**
					 * 🚧 A player seat named by a pipeline (2026-10-15): the
					 * door a person's own seat name takes (`writeSeatName`),
					 * for the person `user` names — their card-less seat first,
					 * else their first seat, else a new card-less seat for a
					 * player. The person is the seat's, so they are its
					 * writer here: the owner may name any seat, a playing
					 * guest their own. A blank name or a refusal halts with
					 * its sentence: this outlet never clears a name.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to name a seat in — the run was started without a session scope`
						)
					const m =
						typeof p.user === "string" ? /^user:(\d+)$/.exec(p.user.trim()) : null
					if (!m) return { halt: `'${String(p.user)}' is not a person (user:<id>), so no seat was named` }
					const name = typeof p.name === "string" ? p.name.trim() : ""
					if (!name) return { halt: "there was no name to give the seat" }
					const userId = Number(m[1])
					const [session] = await db
						.select({ userId: schema.sessions.userId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					const { writeSeatName, SeatNameRefusal } = await import(
						"$lib/server/sessions/seatName"
					)
					/**
					 * 🚧 `retire` (owner ruling 2026-10-18): the seat this name
					 * replaces — a new character after a death is a NEW seat, and
					 * the fallen's keeps its lines' name. By reference: a
					 * card-less seat's own id, or the seat holding a card.
					 */
					let retireSeatId: number | null = null
					if (typeof p.retire === "string" && p.retire.trim()) {
						// 🚧 `seated-member:<memberId>` is accepted (seat-cast S2),
						// read as the card form it is seated under.
						const ref =
							(await storedSeatRef(db, sessionId, p.retire.trim())) ??
							p.retire.trim()
						const seatRef = /^player-seat:(\d+)$/.exec(ref)
						const cardRef = /^character:(\d+)$/.exec(ref)
						// ⏳ (S4) Switch on, the door answers a character seat's member
						// as `seated-member:<id>`: a seat of the AI's, holding no player seat.
						if (memberFormOn() && /^seated-member:\d+$/.test(ref))
							return { halt: `${ref} holds no seat at this table, so no seat was retired` }
						if (seatRef) retireSeatId = Number(seatRef[1])
						else if (cardRef) {
							const [held] = await db
								.select({ id: schema.sessionPersonas.id })
								.from(schema.sessionPersonas)
								.where(
									and(
										eq(schema.sessionPersonas.sessionId, sessionId),
										eq(schema.sessionPersonas.personaId, Number(cardRef[1])),
										isNull(schema.sessionPersonas.removedAt)
									)
								)
								.limit(1)
							if (!held) return { halt: `${ref} holds no seat at this table, so no seat was retired` }
							retireSeatId = held.id
						} else return { halt: `'${ref}' is not a seat (player-seat:<id>, seated-member:<id> or character:<id>), so no seat was retired` }
					}
					let seatId: number | null
					try {
						seatId = await writeSeatName(db, {
							sessionId,
							userId,
							isOwner: session?.userId === userId,
							name,
							...(retireSeatId !== null ? { retireSeatId } : {})
						})
					} catch (e) {
						if (e instanceof SeatNameRefusal)
							return forPeople({ halt: e.message }, peopleSentenceOf(e))
						throw e
					}
					if (seatId === null) return { halt: "no seat was named" }
					record(node, "session", sessionId, "updated")
					// Every member's page learns the seat and its name now, not
					// on their next reload — the push an added persona takes.
					if (scope.io) {
						const { pushSessionToParticipants } = await import(
							"$lib/server/sockets/sessions"
						)
						await pushSessionToParticipants(scope.io, sessionId, userId).catch((err: unknown) =>
							console.warn("[set-seat-name] session push failed:", err)
						)
					}
					const [row] = await db
						.select({
							personaId: schema.sessionPersonas.personaId,
							castMemberId: schema.sessionPersonas.castMemberId
						})
						.from(schema.sessionPersonas)
						.where(eq(schema.sessionPersonas.id, seatId))
						.limit(1)
					// The seat's reference (`hostSeatRefOf`): a seat with a card is its
					// card (`character:<id>`), the seat's own reference names a
					// card-less one; ⏳ (S4) with the member-form switch on, every
					// player seat is `player-seat:<id>`.
					const seat =
						hostSeatRefOf({
							kind: "player",
							seatId,
							castMemberId: row?.castMemberId ?? null,
							cardId: row?.personaId ?? null
						}) ?? `player-seat:${seatId}`
					return { written: true, sessionId, seat }
				}

				case "core:outlet/set-seat-bench": {
					/**
					 * 🚧 A seat benched or brought back by a pipeline (owner ruling
					 * 2026-11-10: "seat to benched is something managed by the
					 * genre/pipelines, not automatically by core"). Opt-in: only a
					 * genre that declares `writes.seats: true` may (absent = off, P1);
					 * core never benches on its own. The write is `setSeatBench`, the
					 * one writer. Tied to the turn: when the run has a turn message the
					 * bench is filed under it (a `seat-bench` session imprint), so Back,
					 * regenerate and delete of that message put the seat back. A
					 * person's later bench or drag wins: the undo is a no-op on a seat
					 * that reads other than what the pipeline set. Announced after the
					 * commit as `cast-changed` `enabled`.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to bench a seat in — the run was started without a session scope`
						)
					if (typeof p.benched !== "boolean")
						return { halt: "there was no benched true or false, so no seat was benched" }
					const refusal = await seatWriteRefusal(db, sessionId)
					if (refusal !== null) return forPeople({ halt: refusal }, refusal)
					const given = typeof p.seat === "string" ? p.seat.trim() : ""
					const benched = p.benched
					const { seatOf, setSeatBench, announceSeatChanges } = await import(
						"$lib/server/sessions/seats"
					)
					const { turnMessageOf } = await import(
						"$lib/server/pipelines/runtime/runTurnMessage"
					)
					const { fileSessionImprint, seatBenchKey } = await import(
						"$lib/server/sessions/sessionImprints"
					)
					const anchor = turnMessageId ?? turnMessageOf(scope.runId)
					const outcome = await db.transaction(async (tx) => {
						const resolved = await seatOf(tx, sessionId, given)
						if (!resolved)
							return {
								halt: `'${given}' is not a seat in this session, so nothing was benched`
							}
						const done = await setSeatBench(tx, {
							sessionId,
							kind: resolved.kind,
							seatId: resolved.seatId,
							benched
						})
						if (!done.ok) return forPeople({ halt: done.refusal }, done.refusal)
						if (done.changes.length > 0)
							await fileSessionImprint(
								tx,
								{ sessionId, messageId: anchor ?? null, runId: scope.runId ?? null },
								{ kind: "seat-bench", key: seatBenchKey(resolved.kind, resolved.seatId) },
								!benched,
								benched
							)
						return { resolved, changes: done.changes }
					})
					if ("halt" in outcome) return forPeople({ halt: outcome.halt }, peopleSentenceOf(outcome))
					const { resolved, changes } = outcome
					record(node, "session", sessionId, "updated")
					if (scope.io && changes.length > 0) {
						let userId = scope.userId
						if (userId === undefined) {
							const [owner] = await db
								.select({ userId: schema.sessions.userId })
								.from(schema.sessions)
								.where(eq(schema.sessions.id, sessionId))
								.limit(1)
							userId = owner?.userId
						}
						if (userId !== undefined)
							await announceSeatChanges(db, scope.io, { sessionId, userId }, changes)
					}
					const seat =
						hostSeatRefOf({
							kind: resolved.kind,
							seatId: resolved.seatId,
							castMemberId: resolved.castMemberId,
							cardId: resolved.cardId
						}) ?? given
					return { written: true, sessionId, seat }
				}

				case "core:outlet/set-stat-config": {
					/**
					 * 🚧 One owner's stat configuration (owner ruling
					 * 2026-10-15): `{ owner, slot, config }` — the document a
					 * card or session editor sends too — through
					 * `setStatConfig`, the writer `state:configure` takes. The
					 * owner is a seat (`player-seat:<id>`, `seated-member:<id>`,
					 * `character:<id>`)
					 * or `world`; `worldRow`, as on `set-state@1`, files a
					 * seat's or the world's row at a message this run wrote,
					 * so a retake or swipe of it takes the row back. A refusal
					 * halts with its sentence.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to configure a stat in — the run was started without a session scope`
						)
					const { castOwnerOfRef } = await import("./bindings.state")
					// 🚧 `seated-member:<memberId>` is accepted (seat-cast S2)
					// through `storedSeatRef`, which gives the seat's stored ref;
					// a member nobody is seated as is not an owner.
					const { storedSeatRef } = await import("$lib/server/state/seatRefs")
					const ref = typeof p.owner === "string" ? p.owner.trim() : ""
					// ⏳ (S4) Switch on, the door answers member form
					// (`seated-member:<id>` / `player-seat:<id>`): the owner is the
					// seat's `seated_member` / `player_seat` (`castOwnerOfRef` reads
					// card forms only).
					const stored = ref === "world" ? "" : ((await storedSeatRef(db, sessionId, ref)) ?? "")
					const memberOwner = memberFormOn() ? /^(seated-member|player-seat):(\d+)$/.exec(stored) : null
					const owner =
						ref === "world"
							? ({ kind: "session", id: sessionId } as const)
							: memberOwner
								? ({
										kind: memberOwner[1] === "seated-member" ? "seated_member" : "player_seat",
										id: Number(memberOwner[2])
									} as unknown as ReturnType<typeof castOwnerOfRef>)
								: castOwnerOfRef(stored)
					if (!owner)
						return {
							halt: `${JSON.stringify(p.owner ?? null)} is not an owner here — name a seat (player-seat:<id>, seated-member:<id>, character:<id>) or world`
						}
					const slotId = typeof p.slot === "string" ? p.slot.trim() : ""
					const row = p.worldRow as { ids?: { id?: unknown }; id?: unknown } | number | null | undefined
					const rawRow =
						row && typeof row === "object" ? (row.ids?.id ?? row.id) : row
					const worldRow =
						typeof rawRow === "number" && Number.isInteger(rawRow) ? rawRow : undefined
					if (p.worldRow != null && worldRow === undefined)
						return { halt: "worldRow takes a message this run wrote, as that write's result" }
					const { setStatConfig, StateRefusal } = await import("$lib/server/state/write")
					try {
						const done = await setStatConfig(
							db,
							{
								sessionId,
								updatedBy: `run:${scope.runId ?? "unknown"}`,
								// ⏳ (S4) a cast owner is a `session_cast`; with the switch
								// on, a `seated_member` / `player_seat` holding a card is one
								// too (it anchors to the card's turn); a card-less seat keeps
								// the world's turn, so it pins the row like the world.
								...(worldRow !== undefined &&
								owner.kind !== "session_cast" &&
								!(
									memberFormOn() &&
									((owner.kind as string) === "seated_member" ||
										(owner.kind as string) === "player_seat") &&
									(await seatOf(db, sessionId, stored))?.cardId != null
								)
									? { messageId: worldRow, ownAnchor: true }
									: {})
							},
							{
								owner,
								slotId,
								config: (p.config ?? {}) as Record<string, unknown>
							}
						)
						return { configId: done.configId, owner: ref, slot: slotId, before: done.before, config: done.config }
					} catch (e) {
						if (e instanceof StateRefusal) return { halt: e.message }
						throw e
					}
				}

				case "core:outlet/set-annex-field": {
					/**
					 * An annex field's write (2026-09-26): `{ field, value }`,
					 * put there by `fireAction` after judging the press. Judged
					 * again here, off the declaration and never off the
					 * payload — an undeclared key, a value its shape refuses
					 * or an audience that is not one halts the run — then
					 * written through the one annex write into
					 * `annex[<owner>][<key>]`, merged, under the declared
					 * audience. The owner is the declaring package, so a field
					 * can write nobody else's document.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write an annex field for — the run was started without a session scope`
						)
					const payload = (p.payload ?? {}) as { field?: unknown; value?: unknown }
					const {
						annexFieldValueRefusal,
						parseAnnexFieldAction
					} = await import("@serene-pub/sdk")
					const target = parseAnnexFieldAction(payload.field)
					if (!target)
						throw new HostScopeError(
							`${node.key}: refused — '${String(payload.field)}' is not an annex field's identity (<owner>:annex#<key>)`
						)
					const [session] = await db
						.select({ genreId: schema.sessions.genreId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					const { annexFieldFor } = await import("$lib/server/sessions/annexFields")
					const field = await annexFieldFor(db, session?.genreId ?? "core:genre/chat", String(payload.field))
					if (!field)
						throw new HostScopeError(
							`${node.key}: refused — '${target.key}' is not an annex field '${target.owner}' declares for this session`
						)
					// Declared but pipeline-written only: no press may set it.
					if (!field.decl.act?.length)
						throw new HostScopeError(
							`${node.key}: refused — '${target.key}' is set by '${target.owner}''s pipelines only`
						)
					const fault = annexFieldValueRefusal(field.decl, payload)
					if (fault) throw new HostScopeError(`${node.key}: refused — ${fault}`)
					const { dataAudienceFindings } = await import("@serene-pub/sdk")
					const audienceFault = dataAudienceFindings(field.decl.see)
					if (audienceFault) throw new HostScopeError(`${node.key}: refused — ${audienceFault}`)
					const { annexFieldsOfOwner, annexScopeOf } = await import("$lib/server/sessions/annexFields")
					// 🚧 A press on a lorebook-scope field writes the lorebook annex (M0).
					const fieldScope = annexScopeOf(field.decl)
					const ownerFields = await annexFieldsOfOwner(
						db,
						session?.genreId ?? "core:genre/chat",
						field.owner,
						fieldScope
					)
					if (fieldScope === "lorebook")
						return await writeLorebookAnnexDocument(
							node,
							scope,
							field.owner,
							{ [field.decl.key]: payload.value },
							true,
							{ [field.decl.key]: field.decl.see },
							new Set(ownerFields.map((f) => f.key))
						)
					return await writeAnnexDocument(
						node,
						sessionId,
						field.owner,
						{ [field.decl.key]: payload.value },
						true,
						{ [field.decl.key]: field.decl.see },
						new Set(ownerFields.map((f) => f.key))
					)
				}

				case "core:outlet/set-lorebook-annex": {
					/**
					 * 🚧 The **lorebook annex** write (M0, SHAPES L9):
					 * `set-session-annex`'s twin at book scope — one owner's
					 * document, held to the owner's declaration of fields
					 * declared `scope: 'lorebook'`, under the declared
					 * audience. From a session it is an anchored, retractable
					 * change routed like every lore write; from a book-level
					 * run it is lasting at once.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined && scope.lorebookId == null)
						throw new HostScopeError(
							"This step writes a lorebook's annex: run it in a session or on a lorebook."
						)
					const params = (p.params ?? {}) as {
						owner?: unknown
						merge?: unknown
						sharedAnnex?: unknown
					}
					const own = annexOwnerOf(scope.specId)
					const named =
						typeof params.owner === "string" && params.owner.trim()
							? params.owner.trim()
							: null
					if (named && named !== own && params.sharedAnnex !== true)
						return {
							written: false,
							...(sessionId !== undefined ? { sessionId } : {}),
							notes: [
								`refused: '${own}' may not write the lorebook annex of '${named}' — set 'Write another owner' on this node to allow it`
							]
						}
					const owner = named ?? own
					const value =
						p.value && typeof p.value === "object" && !Array.isArray(p.value)
							? (p.value as Record<string, unknown>)
							: {}
					const { annexWriteRefusals } = await import("@serene-pub/sdk")
					const { annexFieldsOfOwner, sessionGenreOf } = await import(
						"$lib/server/sessions/annexFields"
					)
					const genreId = sessionId !== undefined ? await sessionGenreOf(db, sessionId) : "core:genre/chat"
					const fields = await annexFieldsOfOwner(db, genreId, owner, "lorebook")
					const refusals = annexWriteRefusals(fields, {
						owner,
						keys: Object.keys(value),
						genre: genreId,
						values: value
					})
					if (refusals.length)
						throw new HostScopeError(`${node.key}: refused — ${refusals.join("; ")}`)
					// 🚧 (M2b) `base`: the annex document version the spec read — compare-and-set; absent writes as before.
					const base = p.base
					if (
						base !== undefined &&
						base !== null &&
						!(typeof base === "number" && Number.isInteger(base) && base >= 0)
					)
						throw new HostScopeError(
							`${node.key}: base is the annex document version a lorebook-annex read gave (a whole number) — ${JSON.stringify(base)} is not one`
						)
					return await writeLorebookAnnexDocument(
						node,
						scope,
						owner,
						value,
						params.merge !== false,
						Object.fromEntries(fields.map((f) => [f.key, f.see])),
						new Set(fields.map((f) => f.key)),
						typeof base === "number" ? base : undefined
					)
				}

				case "core:outlet/set-lorebook-annex-field": {
					/**
					 * 🚧 A lorebook-annex field's write (M0): `{ field,
					 * value }` judged again here off the declaration, as
					 * `set-annex-field` does — for a field declared
					 * `scope: 'lorebook'`. The owner is the declaring package.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined && scope.lorebookId == null)
						throw new HostScopeError(
							"This step writes a lorebook's annex: run it in a session or on a lorebook."
						)
					const payload = (p.payload ?? {}) as { field?: unknown; value?: unknown }
					const { annexFieldValueRefusal, parseAnnexFieldAction, dataAudienceFindings } = await import(
						"@serene-pub/sdk"
					)
					const target = parseAnnexFieldAction(payload.field)
					if (!target)
						throw new HostScopeError(
							`${node.key}: refused — '${String(payload.field)}' is not an annex field's identity (<owner>:annex#<key>)`
						)
					const { annexFieldFor, annexFieldsOfOwner, annexScopeOf, sessionGenreOf } = await import(
						"$lib/server/sessions/annexFields"
					)
					const genreId = sessionId !== undefined ? await sessionGenreOf(db, sessionId) : "core:genre/chat"
					const field = await annexFieldFor(db, genreId, String(payload.field))
					if (!field || annexScopeOf(field.decl) !== "lorebook")
						throw new HostScopeError(
							`${node.key}: refused — '${target.key}' is not a lorebook annex field '${target.owner}' declares for this session`
						)
					if (!field.decl.act?.length)
						throw new HostScopeError(
							`${node.key}: refused — '${target.key}' is set by '${target.owner}''s pipelines only`
						)
					const fault = annexFieldValueRefusal(field.decl, payload)
					if (fault) throw new HostScopeError(`${node.key}: refused — ${fault}`)
					const audienceFault = dataAudienceFindings(field.decl.see)
					if (audienceFault) throw new HostScopeError(`${node.key}: refused — ${audienceFault}`)
					const ownerFields = await annexFieldsOfOwner(db, genreId, field.owner, "lorebook")
					return await writeLorebookAnnexDocument(
						node,
						scope,
						field.owner,
						{ [field.decl.key]: payload.value },
						true,
						{ [field.decl.key]: field.decl.see },
						new Set(ownerFields.map((f) => f.key))
					)
				}

				case "core:outlet/record-event": {
					/**
					 * A package's event, recorded (R45/R47/R52, E1b). The
					 * recording is a write — the ledger row — and the event it
					 * causes is the one it names; bound pipelines run as
					 * children of this run, so the depth cap bounds a chain.
					 *
					 * Refused here, at run time, whatever publish saw: an event
					 * no installed package declares (withdrawn on uninstall),
					 * and a pipeline outside the event's recording scope. Scope
					 * is judged on the subjects this spec serves — its inlet
					 * lock's events, or on the action event its actions.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to record an event in — the run was started without a session scope`
						)
					// A recording is a write on someone's behalf; a run with no
					// user would record for nobody and the listeners could not
					// be run as anyone.
					if (scope.userId === undefined)
						throw new HostScopeError(
							`${node.key} has no user to record an event for — the run was started without one`
						)
					const eventId = typeof p.event === "string" ? p.event : ""
					const { mayRecord, eventScopeOf } = await import("$lib/server/plugins/pluginEvents")
					const { subjectsOf, recordedPayloadFindings } = await import("@serene-pub/sdk")
					const [session] = await db
						.select({ genreId: schema.sessions.genreId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					if (!session) throw new HostScopeError(`${node.key}: session ${sessionId} does not exist`)
					const subjects = subjectsOf({
						id: scope.specId ?? "",
						input: scope.input ?? {},
						contributes: scope.contributes
					} as never)
					const verdict = mayRecord(eventId, session.genreId, subjects)
					if (!verdict.ok)
						throw new HostScopeError(`${node.key}: refused — ${verdict.reason}`)
					// The payload is checked again here, whatever publish saw: a
					// wired value is only known now, and a listener trusts it.
					const payloadProblem = recordedPayloadFindings(
						eventScopeOf(eventId, session.genreId)!.payload,
						p.payload
					)
					if (payloadProblem)
						throw new HostScopeError(`${node.key}: refused — ${payloadProblem}`)
					await emit(
						eventId,
						{ sessionId, payload: p.payload ?? null },
						{ kind: "run" },
						{ asChild: true }
					)
					record(node, "session", sessionId, "updated")
					return { written: true, sessionId, event: eventId }
				}

				case "core:outlet/delete-message": {
					/**
					 * 🚧 Two places may perform it (RF fix 5, owner ruling
					 * 2026-10-23): the built-in's own spec (⏳), which names
					 * its row on `target`, and a **deletion pipeline** — a
					 * document entered through
					 * `core:inlet/message-deletion-asked@1`, a genre's or an
					 * administrator's, whoever owns it — which hands the
					 * delete the deletion its event carried, whole, on
					 * `asked`, and deletes THE message that names: the host
					 * judged the door for that one before it dispatched the
					 * event, and `validate()` holds `asked` to one edge from
					 * the inlet's `main`.
					 */
					const deletionPipeline = scope.inletDefinitionId === DELETION_ASKED_INLET_ID
					if (!deletionPipeline) assertBuiltInSpec(node)
					let id: number | null
					if (deletionPipeline) {
						if (p.target !== undefined && p.target !== null)
							throw new HostScopeError(
								`${node.key} was given 'target' in a deletion pipeline — a deletion pipeline ` +
									`deletes the message its event carried, wired whole onto 'asked' from the inlet's 'main'.`
							)
						const asked = p.asked as Partial<DeletionAskedPayload> | null | undefined
						const askedId = asked && typeof asked === "object" ? asked.messageId : undefined
						id = typeof askedId === "number" && Number.isSafeInteger(askedId) ? askedId : null
						if (id === null)
							throw new HostScopeError(
								`${node.key} was given no deletion to carry out — wire 'asked' from the inlet's 'main'.`
							)
					} else {
						id = refId(p.target)
						if (id === null)
							throw new HostScopeError(
								`${node.key} was given no message id to delete — wire 'target' from the inlet.`
							)
					}
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to delete`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					await assertMayAct(node, id)
					const { deleteLegacy } = await import(
						"$lib/server/messages/store"
					)
					const { StoryClockRefusal } = await import("$lib/server/state/clockMoves")
					const { retractStateAnchoredTo, takenSummaryOf } = await import(
						"$lib/server/state/write"
					)
					// One transaction: everything the message changed goes
					// first by the one retraction rule (RF fix 4) — values,
					// configurations, proposals, every clock move it carried
					// (its round's tick too: the row leaves, "leaves"), scene
					// boundaries, zone snapshots, its lorebook writes, the notes' entries —
					// then both worlds of the row (the store owns the mirror,
					// and the rows anchored to it). `taken` says what went.
					let clockMoved = false
					let taken: ReturnType<typeof takenSummaryOf> | null = null
					const seatChanges: Array<
						Awaited<ReturnType<typeof retractStateAnchoredTo>>["seatChanges"][number]
					> = []
					try {
						const out = await db.transaction(async (tx) => {
							const t = tx as unknown as Db
							const retracted = await retractStateAnchoredTo(t, id, "leaves")
							seatChanges.push(...retracted.seatChanges)
							await deleteLegacy(t, id, { seatChanges })
							return retracted
						})
						clockMoved = out.clockMoved
						taken = takenSummaryOf(out.taken, out.clockMoved)
					} catch (e) {
						// 🚧 pr-6 (A3): below the settle line nothing is taken back.
						const { SettledRefusal } = await import("$lib/server/sessions/settle")
						if (e instanceof StoryClockRefusal || e instanceof SettledRefusal)
							throw forPeople(
								new HostScopeError(`${node.key}: ${e.message}`),
								e instanceof SettledRefusal ? e.message : peopleSentenceOf(e)
							)
						throw e
					}
					record(node, "message", id, "deleted")
					// The seats the turn benched are back; tell the open pages (after commit).
					if (scope.io && seatChanges.length > 0) {
						const { announceSeatChanges } = await import("$lib/server/sessions/seats")
						let userId = scope.userId
						if (userId === undefined) {
							const [owner] = await db
								.select({ userId: schema.sessions.userId })
								.from(schema.sessions)
								.where(eq(schema.sessions.id, current.sessionId))
								.limit(1)
							userId = owner?.userId
						}
						if (userId !== undefined)
							await announceSeatChanges(
								db,
								scope.io,
								{ sessionId: current.sessionId, userId },
								seatChanges
							)
					}
					if (clockMoved && scope.io) {
						const { broadcastSessionRow } = await import(
							"$lib/server/sessions/rowPush"
						)
						broadcastSessionRow(scope.io, current.sessionId)
					}
					const lost = {
						content: current.content,
						role: current.role,
						speaker: speakerRefOf(current),
						channel: current.channel,
						metadata: current.metadata
					}
					await emit(
						"core:event/message-deleted@1",
						{ sessionId: current.sessionId, messageId: id, lost },
						{ kind: "edit" }
					)
					return { id, sessionId: current.sessionId, lost, taken }
				}

				case "core:outlet/advance-story-clock": {
					/**
					 * Move the SESSION's story clock (DESIGN-story-time P3,
					 * §5 `advance(n, unit)`) through its book's calendar —
					 * never the book's present. A wired `by` / `unit` wins
					 * over the parameter. A refusal halts the run with the
					 * sentence and writes nothing — no book, no present to
					 * start from, a step of nothing, a result that does not
					 * land — unless the spec says `onRefusal: 'skip'`.
					 *
					 * 🚧 Every move writes a **clock move** to the session's
					 * state ledger in the same transaction (live scenes §15
					 * G5, `state/clockMoves.ts`), anchored where the world's
					 * changes are, so a delete, swipe or retake of that
					 * message takes it back. Why it moved is the spec's
					 * literal `cause` (G4) — never inferred from the inlet.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session whose clock to advance — the run was started without a session scope`
						)
					const params = (p.params ?? {}) as { by?: unknown; unit?: unknown }
					const hasTo = p.to !== undefined && p.to !== null
					if (hasTo && p.by !== undefined && p.by !== null)
						throw new HostScopeError(
							`${node.key}: say how far to move the clock (by) or the moment to move it to (to), not both.`
						)
					// 🚧 `to` (M0, lane T1): an absolute moment of the
					// day. A malformed target is the spec's mistake and halts
					// even under `onRefusal: 'skip'`; a string is malformed.
					let target: import("@serene-pub/contracts").ClockTargetV1 | null = null
					if (hasTo) {
						const t = p.to as Record<string, unknown> | null
						const ok =
							typeof t === "object" &&
							t !== null &&
							!Array.isArray(t) &&
							Number.isInteger(t.hour) &&
							(t.hour as number) >= 0 &&
							(t.hour as number) <= 23 &&
							(t.minute === undefined ||
								(Number.isInteger(t.minute) &&
									(t.minute as number) >= 0 &&
									(t.minute as number) <= 59)) &&
							(t.day === undefined ||
								t.day === "today" ||
								t.day === "tomorrow" ||
								t.day === "next")
						if (!ok)
							throw new HostScopeError(
								`${node.key}: to takes { hour: 0–23, minute?: 0–59, day?: 'today' | 'tomorrow' | 'next' }.`
							)
						target = t as unknown as import("@serene-pub/contracts").ClockTargetV1
					}
					const by = p.by !== undefined && p.by !== null ? p.by : (params.by ?? 1)
					const unit =
						typeof p.unit === "string" && p.unit.trim()
							? p.unit.trim()
							: (params.unit ?? "hours")
					const {
						clockSkipReason,
						droppedKeeperMoveSentence,
						handMovedThisTurn,
						readClockMoveCause,
						recordClockMove
					} = await import("$lib/server/state/clockMoves")
					const cause = readClockMoveCause(p.cause)
					if (!cause)
						throw new HostScopeError(
							`${node.key}: cause takes 'action', 'keeper' or 'tick', not '${String(p.cause)}'`
						)
					const onRefusal = p.onRefusal ?? "halt"
					if (onRefusal !== "halt" && onRefusal !== "skip")
						throw new HostScopeError(
							`${node.key}: onRefusal takes 'halt' or 'skip', not '${String(p.onRefusal)}'`
						)
					const updatedBy = `run:${scope.runId ?? "unknown"}`
					const { advanceSessionStoryClock, advanceSessionStoryClockTo, StoryClockRefusal, TimelineOffRefusal } = await import(
						"$lib/server/state/storyTime"
					)
					const step = {
						by: by as number,
						unit: unit as import("$lib/shared/lorebooks/storyDate").StoryTimeUnit
					}
					// 🚧 The model's own move after a *Time passes…* press this
					// turn is dropped: no row, no write; the receipt carries it.
					// A malformed step is never "dropped": it falls through to the
					// refusal the normal path raises, so the spec's mistake shows.
					const { clockStepRefusal } = await import("@serene-pub/sdk")
					if (
						cause === "keeper" &&
						(target ? true : clockStepRefusal(step) === null) &&
						(await handMovedThisTurn(db, sessionId))
					)
						return {
							id: sessionId,
							sessionId,
							clock: null,
							label: "",
							skipped: droppedKeeperMoveSentence(target ? null : step),
							moved: 0
						}
					let moved: Awaited<ReturnType<typeof advanceSessionStoryClock>>
					try {
						moved = await db.transaction(async (tx) => {
							const t = tx as unknown as Db
							const done = target
								? await advanceSessionStoryClockTo(t, sessionId, target)
								: await advanceSessionStoryClock(t, sessionId, step.by, step.unit)
							const { clockMoveBackRefusal } = await import("$lib/server/sessions/clockMoveBack")
							const back = await clockMoveBackRefusal(t, sessionId, done.from, done.clock, cause)
							if (back) throw new StoryClockRefusal(back)
							// 🚧 A `to` move that did not move writes no ledger row.
							if (target && (done as unknown as { by: number }).by === 0) return done
							await recordClockMove(t, {
								sessionId,
								...(target
									? { by: (done as unknown as { by: number }).by, unit: "minutes" as const }
									: step),
								cause,
								updatedBy,
								from: done.from,
								to: done.clock
							})
							return done
						})
					} catch (e) {
						if (!(e instanceof StoryClockRefusal)) throw e
						// A book with no timeline never moves: the receipt says so, whatever `onRefusal` is, with no ledger row and no event. A malformed step still halts.
						if (e instanceof TimelineOffRefusal && (target ? true : clockStepRefusal(step) === null))
							return {
								id: sessionId,
								sessionId,
								clock: null,
								label: "",
								skipped: TIMELINE_OFF_SENTENCES.clock,
								moved: 0
							}
						// 🚧 `onRefusal: 'skip'` (§15 G7): a well-formed step the
						// story cannot take — no clock yet, a date the calendar
						// cannot place — moves nothing and says why in the
						// ledger and on the receipt, and the run finishes. A
						// malformed step is the spec's mistake and still halts.
						if (onRefusal !== "skip" || (!target && clockStepRefusal(step) !== null))
							throw forPeople(new HostScopeError(`${node.key}: ${e.message}`), peopleSentenceOf(e))
						const skipped = await clockSkipReason(db, sessionId, e.message)
						// 🚧 A refused `to` under 'skip' moves nothing and leaves no
						// ledger row: it reports `moved: 0` and the sentence.
						if (target) return { id: sessionId, sessionId, clock: null, label: "", skipped, moved: 0 }
						await recordClockMove(db, { sessionId, ...step, cause, updatedBy, skipped })
						record(node, "session", sessionId, "updated")
						if (scope.io)
							await broadcastToSessionUsers(scope.io, sessionId, "state:changed", {
								sessionId
							} satisfies Sockets.State.Changed.Response)
						return { id: sessionId, sessionId, clock: null, label: "", skipped }
					}
					// 🚧 A `to` move that stood where it was: no row, no events.
					if (target && (moved as unknown as { by: number }).by === 0)
						return { id: sessionId, sessionId, clock: moved.clock, label: moved.label, skipped: "", moved: 0 }
					record(node, "session", sessionId, "updated")
					// 🚧 A **time action** (live scenes §4, §15 G4): the clock
					// moved on a person's press or the keeper's trusted move,
					// so the next line of each lane may begin a new scene. A
					// reply's fixed tick never is one — the watcher's rule,
					// read off the cause the spec wrote.
					const { noteTimeAction } = await import(
						"$lib/server/scenes/boundaryWatcher"
					)
					await noteTimeAction(db, { sessionId, cause })
					// What the session inherits is read as of its clock, so
					// every tab reads its state afresh — and the ledger the
					// move's line.
					if (scope.io)
						await broadcastToSessionUsers(scope.io, sessionId, "state:changed", {
							sessionId
						} satisfies Sockets.State.Changed.Response)
					// And the session itself moved: `session-updated` names the
					// clock, as `sessions:update` does for a person's move, so a
					// spec bound to it and an open settings form hear it. A
					// child of this run (`asChild`): a spec answering it may
					// advance the clock again, and the lineage caps that loop.
					await emit(
						"core:event/session-updated@1",
						{ sessionId, changed: ["storyClock"] },
						{ kind: "run" },
						{ asChild: true }
					)
					// 🚧 The session moment (PLAN-layering D7, lane 6): the
					// story clock moved, once, from where it stood to where it
					// stands — what a Timeline Cron counts (R17).
					await emit(
						"core:event/story-clock-moved@1",
						{ sessionId, clock: { from: moved.from, to: moved.clock } },
						{ kind: "run" },
						{ asChild: true }
					)
					if (scope.io) {
						const { broadcastSessionRow } = await import(
							"$lib/server/sessions/rowPush"
						)
						broadcastSessionRow(scope.io, sessionId)
					}
					return {
						id: sessionId,
						sessionId,
						clock: moved.clock,
						label: moved.label,
						skipped: "",
						...(target ? { moved: (moved as unknown as { by: number }).by } : {})
					}
				}

				case "core:outlet/set-backdrop": {
					/**
					 * 🚧 The session's **backdrop** (DESIGN-image-generation
					 * §6.4): `sessions.backdropMediaId` → the FIRST image of
					 * `media`, keyed or not. The file is checked as
					 * `create-message`'s media is — the session's, the run's
					 * user's, or already shown in the session — and a file
					 * that is none of those halts the step. An empty list, or
					 * one with no image in it, writes nothing (`written:
					 * false`, no event): a pipeline replaces a backdrop, a
					 * person clears one.
					 *
					 * Who: the socket's rule — the session's owner or an
					 * admin (`backdropWriterRefusal`). A guest who pressed
					 * Scene is refused HERE without halting, the reason
					 * recorded on the run (`notes`), so the picture still
					 * posts on the message branch.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to set a backdrop for — the run was started without a session scope`
						)
					const {
						BackdropRefusal,
						announceBackdrop,
						backdropFileFor,
						backdropWriterRefusal,
						writeBackdrop
					} = await import("$lib/server/sessions/backdrop")
					const refs = Array.isArray(p.media) ? p.media : p.media ? [p.media] : []
					const who = await backdropWriterRefusal(
						db,
						sessionId,
						scope.userId ?? null
					)
					if (who)
						return {
							written: false,
							sessionId,
							mediaId: null,
							notes: [`refused: ${who}`]
						}
					let file: { id: number } | null = null
					for (const ref of refs) {
						const kind = (ref as { kind?: unknown } | null)?.kind
						if (kind !== undefined && kind !== "image") continue
						try {
							file = await backdropFileFor(db, ref, {
								sessionId,
								userId: scope.userId ?? null,
								castImages: false
							})
						} catch (e) {
							if (e instanceof BackdropRefusal)
								throw forPeople(
									new HostScopeError(`${node.key}: refused — ${e.message}`),
									peopleSentenceOf(e)
								)
							throw e
						}
						if (file) break
					}
					if (!file) return { written: false, sessionId, mediaId: null }
					const write = await writeBackdrop(db, sessionId, file.id)
					if (!write.changed)
						return { written: false, id: sessionId, sessionId, mediaId: file.id }
					record(node, "session", sessionId, "updated")
					await emit(
						"core:event/backdrop-set@1",
						{
							sessionId,
							backdropMediaId: write.next,
							previousBackdropMediaId: write.previous
						},
						{ kind: "run" }
					)
					await announceBackdrop(scope.io, sessionId, write.next)
					return { id: sessionId, sessionId, mediaId: file.id }
				}

				case "core:outlet/offer-media": {
					/**
					 * 🚧 Put each picture in the card's (or cast member's) gallery
					 * (DESIGN-image-generation §6.2; I8) —
					 * `characters/portrait.ts` holds the rule. About a CARD or
					 * a cast member: writes no session row; nothing is chosen
					 * for the person. Refused unless the run's person owns the
					 * card or is an admin — on a member's run (★7), unless they
					 * may edit the member's lorebook.
					 */
					const castMemberId = scope.cardActionCastMemberId ?? null
					const wired = Array.isArray(p.characterId)
						? p.characterId[0]
						: p.characterId
					if (castMemberId != null && wired != null && wired !== "")
						throw new HostScopeError(
							`${node.key} runs on a cast member — leave 'characterId' unwired; the pictures go to the member.`
						)
					const characterId =
						castMemberId != null ? null : Number(wired)
					if (
						characterId !== null &&
						(!Number.isSafeInteger(characterId) || characterId <= 0)
					)
						throw new HostScopeError(
							`${node.key} was given no card — wire 'characterId' from the card action.`
						)
					if (scope.userId == null)
						throw new HostScopeError(
							`${node.key} has nobody to act as — the run was started without a user.`
						)
					// A locked member's art is left as it is: a note, and the run goes on.
					if (castMemberId != null) {
						const [member] = await db
							.select({
								name: schema.lorebookBindings.name,
								castMemberLock: schema.lorebookBindings.castMemberLock
							})
							.from(schema.lorebookBindings)
							.where(eq(schema.lorebookBindings.id, castMemberId))
							.limit(1)
						if (member && castMemberLockedAgainstRuns(member))
							return {
								written: false,
								characterId: null,
								castMemberId,
								offered: [],
								notes: [
									RUN_LOCK_SENTENCES.castMember(
										`'${member.name ?? `cast member ${castMemberId}`}'`
									)
								]
							}
					}
					const { offerMediaToGallery, OfferMediaRefusal } = await import(
						"$lib/server/characters/portrait"
					)
					let result: Awaited<ReturnType<typeof offerMediaToGallery>>
					try {
						result = await offerMediaToGallery(db, {
							...(castMemberId != null
								? { castMemberId }
								: { characterId: characterId as number }),
							media: p.media,
							userId: scope.userId
						})
					} catch (e) {
						if (e instanceof OfferMediaRefusal)
							throw forPeople(
								new HostScopeError(`${node.key}: refused — ${e.message}`),
								peopleSentenceOf(e)
							)
						throw e
					}
					for (const o of result.offered)
						record(node, "file", o.mediaId, "attached")
					// Nothing placed is no write: the executor causes no
					// `media-offered`.
					if (!result.offered.length)
						return { written: false, characterId, castMemberId, offered: [] }
					return {
						id: castMemberId ?? characterId,
						characterId,
						castMemberId,
						offered: result.offered
					}
				}

				case "core:outlet/attach-sprite": {
					/**
					 * 🚧 File each keyed picture as a card's (or, on a member's
					 * run, ★7, the cast member's own) sprite
					 * (DESIGN-image-generation §6.3; I5) — `sprites/attach.ts`
					 * holds the rule. About a CARD or a member: runs with or
					 * without a session, writes no session row, and its event
					 * is recorded on the receipt by the executor (it has no
					 * session to be a session change of). Refused unless the
					 * run's person owns the card or is an admin — for a
					 * member, unless they may edit the member's lorebook.
					 */
					const castMemberId = scope.cardActionCastMemberId ?? null
					const wired = Array.isArray(p.characterId)
						? p.characterId[0]
						: p.characterId
					if (castMemberId != null && wired != null && wired !== "")
						throw new HostScopeError(
							`${node.key} runs on a cast member — leave 'characterId' unwired; the pictures go to the member.`
						)
					const characterId =
						castMemberId != null ? null : Number(wired)
					if (
						characterId !== null &&
						(!Number.isSafeInteger(characterId) || characterId <= 0)
					)
						throw new HostScopeError(
							`${node.key} was given no card — wire 'characterId' from the card action.`
						)
					if (scope.userId == null)
						throw new HostScopeError(
							`${node.key} has nobody to act as — the run was started without a user.`
						)
					// A locked member's art is left as it is: a note, and the run goes on.
					if (castMemberId != null) {
						const [member] = await db
							.select({
								name: schema.lorebookBindings.name,
								castMemberLock: schema.lorebookBindings.castMemberLock
							})
							.from(schema.lorebookBindings)
							.where(eq(schema.lorebookBindings.id, castMemberId))
							.limit(1)
						if (member && castMemberLockedAgainstRuns(member))
							return {
								written: false,
								characterId: null,
								castMemberId,
								setId: null,
								attached: [],
								missing: [],
								notes: [
									RUN_LOCK_SENTENCES.castMember(
										`'${member.name ?? `cast member ${castMemberId}`}'`
									)
								]
							}
					}
					const { attachGeneratedSprites, AttachSpriteRefusal } = await import(
						"$lib/server/sprites/attach"
					)
					let result: Awaited<ReturnType<typeof attachGeneratedSprites>>
					try {
						result = await attachGeneratedSprites(db, {
							...(castMemberId != null
								? { castMemberId }
								: { characterId: characterId as number }),
							setName: typeof p.setName === "string" ? p.setName : null,
							media: p.media,
							series: p.series,
							userId: scope.userId
						})
					} catch (e) {
						if (e instanceof AttachSpriteRefusal)
							throw forPeople(
								new HostScopeError(`${node.key}: refused — ${e.message}`),
								peopleSentenceOf(e)
							)
						throw e
					}
					for (const a of result.attached)
						record(node, "sprite", a.spriteId, "created")
					const attached = result.attached.map(({ label, spriteId }) => ({
						label,
						spriteId
					}))
					// Nothing filed — every picture unkeyed or missing — is no
					// write: the executor causes no `sprites-attached`.
					if (!attached.length)
						return {
							written: false,
							characterId,
							castMemberId,
							setId: result.setId,
							attached,
							missing: result.missing
						}
					return {
						id: result.setId,
						characterId,
						castMemberId,
						setId: result.setId,
						setName: result.setName,
						attached,
						missing: result.missing
					}
				}

				case "core:outlet/show-sprite": {
					/**
					 * Record a line's **shown sprite** (DESIGN-sprites §5.2) on
					 * its ACTIVE swipe — `swipes.spriteHistory[currentIdx]`,
					 * mirrored to `metadata.sprite` exactly as `reasoning` is.
					 *
					 * Who chose it is the node's `source`, a literal the spec
					 * wrote (2026-10-05): `picker` on the reply specs, `person`
					 * in `core:spec/show-sprite`. Stated, not trusted — a
					 * `person` is accepted from core's own sprite action and
					 * no other spec, and the item rule is checked like an
					 * edit's. A picker never overwrites a person's pick, and a
					 * picker's null pick writes nothing.
					 */
					if (p.source !== "picker" && p.source !== "person")
						throw new HostScopeError(
							`${node.key} was given no source — write source: 'picker' or 'person'.`
						)
					const byPerson = p.source === "person"
					const id = messageRefId(p.target)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id — wire 'target' from the saved line.`
						)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to show a sprite on`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					if (byPerson) {
						if (
							scope.ownerPluginId !== undefined ||
							scope.specId !== SHOW_SPRITE_SPEC_ID
						)
							throw new HostScopeError(
								`${node.key}: only core's own sprite action records a person's pick.`
							)
						await assertMayAct(node, id)
					}
					const decided = nextSpriteMetadata(
						current.metadata as Record<string, any>,
						p.pick,
						byPerson
					)
					// Nothing written — a picker's null pick, a person's pick
					// standing, the same sprite again — so `written: false`:
					// the executor causes no `sprite-shown`. The step runs
					// after every reply, faceless or not.
					if (decided.kept) {
						return {
							id: current.id,
							sessionId: current.sessionId,
							sprite: decided.sprite,
							kept: true,
							written: false
						}
					}
					const next = decided.sprite
					const patched = decided.metadata
					const { updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const row = await updateLegacy(db, id, { metadata: patched })
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to show a sprite on`
						)
					record(node, "message", row.id, "updated")
					await announce(row)
					await emit(
						"core:event/sprite-shown@1",
						{
							sessionId: row.sessionId,
							messageId: row.id,
							characterId: row.characterId ?? null,
							sprite: next,
							source: next?.source ?? (byPerson ? "person" : "picker")
						},
						{ kind: byPerson ? "edit" : "run" }
					)
					return {
						id: row.id,
						sessionId: row.sessionId,
						sprite: next,
						kept: false
					}
				}

				case "core:outlet/hide-message": {
					assertBuiltInSpec(node)
					const id = refId(p.target)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id to hide — wire 'target' from the inlet.`
						)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to hide`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					await assertMayAct(node, id)
					const hidden = p.hidden === true
					const { updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const row = await updateLegacy(db, id, { isHidden: hidden })
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to hide`
						)
					record(node, "message", row.id, "hidden")
					await announce(row)
					await emit(
						"core:event/message-hidden@1",
						{ sessionId: row.sessionId, messageId: row.id, hidden },
						{ kind: "edit" }
					)
					return { id: row.id, sessionId: row.sessionId, hidden }
				}

				case "core:outlet/edit-message": {
					assertBuiltInSpec(node)
					const id = refId(p.target)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id to edit — wire 'target' from the inlet.`
						)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to edit`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					await assertMayAct(node, id)
					/**
					 * A floor's write is a person's rewrite of a SETTLED row.
					 * A row still generating belongs to the run filling it,
					 * whose `update-message` finishes it; rewriting under a
					 * live stream would race the frames the live row is
					 * persisting.
					 */
					if (current.isGenerating)
					{
						const sentence = `message ${id} is still being written — stop it first, or wait.`
						throw forPeople(new HostScopeError(`${node.key}: ${sentence}`), sentence)
					}
					const text = String(p.text ?? "")
					const previous = { content: current.content }
					// The selected alternative follows the edit, so a swipe
					// back and forth does not resurrect the old text.
					const metadata = current.metadata as Record<string, any>
					const swipes = metadata?.swipes
					const { committedContent, updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const patch: Partial<
						typeof schema.sessionMessages.$inferInsert
					> = {
						content: text,
						isEdited: true,
						// The vector goes only when the stored words do, so
						// retrieval never matches words the row does not
						// hold. Judged on the text as the store will save it
						// (edge whitespace off), so a save of the same words
						// keeps it. The queue re-embeds on the text hash
						// either way.
						...(committedContent(text) !== current.content
							? {
									embedding: null,
									embeddingModel: null,
									embeddingSourceHash: null
								}
							: {})
					}
					if (swipes && Array.isArray(swipes.history)) {
						const currentIdx = swipes.currentIdx ?? 0
						const history = [...swipes.history]
						if (currentIdx >= 0 && currentIdx < history.length)
							history[currentIdx] = text
						patch.metadata = {
							...metadata,
							swipes: { ...swipes, history }
						}
					}
					const row = await updateLegacy(db, id, patch)
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to edit`
						)
					record(node, "message", row.id, "edited")
					await announce(row)
					await emit(
						"core:event/message-edited@1",
						{ sessionId: row.sessionId, messageId: row.id, previous },
						{ kind: "edit" }
					)
					return { id: row.id, sessionId: row.sessionId, previous }
				}

				case "core:outlet/swipe-message": {
					assertBuiltInSpec(node)
					const id = refId(p.target)
					if (id === null)
						throw new HostScopeError(
							`${node.key} was given no message id to swipe — wire 'target' from the inlet.`
						)
					const current = await legacyMessage(db, id)
					if (!current)
						throw new HostScopeError(
							`${node.key}: no message ${id} to swipe`
						)
					assertScoped(node, current.sessionId, scope.sessionId)
					await assertMayAct(node, id, "rerun")
					if (current.isGenerating)
					{
						const sentence = `message ${id} is still being written — stop it first, or wait.`
						throw forPeople(new HostScopeError(`${node.key}: ${sentence}`), sentence)
					}
					/**
					 * 🚧 A NEW alternative is a rerun: refused on a row no reply
					 * wrote (`questionRowRefusal`, 2026-10-16) here as at the
					 * verb, so no road records an empty swipe on the opening
					 * scene or a question. Selecting one already there is not.
					 */
					if (typeof p.text === "string") {
						const [owning] = await db
							.select({ genreId: schema.sessions.genreId })
							.from(schema.sessions)
							.where(eq(schema.sessions.id, current.sessionId))
							.limit(1)
						if (owning?.genreId) {
							const { questionRowRefusal } = await import("$lib/server/messages/verbs")
							const refused = await questionRowRefusal(db, owning.genreId, id)
							if (refused) throw new HostScopeError(refused)
						}
					}
					const metadata = (current.metadata ?? {}) as Record<
						string,
						any
					>
					/**
					 * The alternatives as the row keeps them: `history` is
					 * every text, `reasoningHistory` the reasoning beside each,
					 * `currentIdx` which is showing (null until a second
					 * alternative exists — the shape the swipe handlers have
					 * always written).
					 */
					const swipes = {
						currentIdx: null as number | null,
						history: [] as string[],
						reasoningHistory: [] as (string | null)[],
						// DESIGN-sprites §3.3: each alternative keeps its own face.
						spriteHistory: [] as (ShownSprite | null)[],
						...(metadata.swipes ?? {})
					}
					const previous = {
						content: current.content,
						swipeIndex: swipes.currentIdx
					}
					let swipeIndex: number
					if (typeof p.text === "string") {
						// Record a new alternative and select it. The first
						// swipe on a row seeds the history with what the row
						// already holds, so nothing showing is lost.
						if (swipes.currentIdx === null) {
							swipes.currentIdx = 0
							swipes.history = [current.content]
							// The face the row already shows belongs to the
							// alternative it already holds.
							swipes.spriteHistory = [
								asShownSprite(metadata.sprite)
							]
						}
						while (
							swipes.reasoningHistory.length < swipes.history.length
						)
							swipes.reasoningHistory.push(null)
						while (
							swipes.spriteHistory.length < swipes.history.length
						)
							swipes.spriteHistory.push(null)
						swipes.history.push(p.text)
						swipes.reasoningHistory.push(null)
						swipes.spriteHistory.push(null)
						swipeIndex = swipes.history.length - 1
					} else {
						const index = Number(p.index)
						if (
							!Number.isInteger(index) ||
							index < 0 ||
							index >= swipes.history.length
						)
							throw new HostScopeError(
								`${node.key}: message ${id} has no alternative ${String(p.index)} to select — ` +
									`it holds ${swipes.history.length}.`
							)
						swipeIndex = index
					}
					swipes.currentIdx = swipeIndex
					const { updateLegacy } = await import(
						"$lib/server/messages/store"
					)
					const row = await updateLegacy(db, id, {
						content: swipes.history[swipeIndex] ?? "",
						metadata: {
							...metadata,
							swipes,
							// The reasoning shown follows the alternative.
							reasoning: swipes.reasoningHistory[swipeIndex] ?? null,
							// And so does the face (DESIGN-sprites §3.3).
							sprite: swipes.spriteHistory?.[swipeIndex] ?? null
						},
						// A stop belongs to the alternative that was streaming
						// (U5b review W2): selecting another one — an existing
						// alternative, or a fresh one being recorded — leaves
						// the mark behind. Staying put keeps it.
						...(swipeIndex !== previous.swipeIndex
							? { generationOutcome: null }
							: {})
					})
					if (!row)
						throw new HostScopeError(
							`${node.key}: no message ${id} to swipe`
						)
					record(node, "message", row.id, "swiped")
					await announce(row)
					await emit(
						"core:event/message-swiped@1",
						{
							sessionId: row.sessionId,
							messageId: row.id,
							previous,
							swipeIndex
						},
						{ kind: "edit" }
					)
					return {
						id: row.id,
						sessionId: row.sessionId,
						swipeIndex,
						previous
					}
				}

				case "core:outlet/branch-session": {
					assertBuiltInSpec(node)
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to branch — the run was started without a session scope`
						)
					const fromMessageId = refId(p.fromMessage)
					if (fromMessageId === null)
						throw new HostScopeError(
							`${node.key} was given no message to branch at — wire 'fromMessage' from the inlet.`
						)
					// Owner-only, re-checked at the write (C1): a branch
					// copies the whole history into a new session, unbounded
					// by any rate limit, and a guest must not grow the owner's
					// storage with sessions the owner never asked for.
					{
						if (!(await scopeActorOwnsSession(db, scope.userId, sessionId)))
							throw forPeople(
								new HostScopeError(`${node.key}: only the session's owner may branch it.`),
								"only the session's owner may branch it."
							)
					}
					const { branchSession } = await import(
						"$lib/server/sessions/branch"
					)
					const created = await branchSession(db, {
						sessionId,
						fromMessageId,
						title:
							typeof p.title === "string" && p.title.trim()
								? p.title
								: null
					})
					record(node, "session", created.id, "created")
					// On the NEW session: its first reply learns it was
					// forked, and from where. The source's history is
					// untouched, so it has nothing to be told.
					// A person's history operation, like an edit: it never
					// fires a turn (§4.6) — the branch's own recompute gives
					// the new session its order (§4.5).
					await emit(
						"core:event/session-branched@1",
						{
							sessionId: created.id,
							fromSessionId: sessionId,
							fromMessageId
						},
						{ kind: "edit" }
					)
					return { id: created.id, sessionId: created.id }
				}

				// 🚧 Move the session's rules to another version of their ruleset
				// (M0, lane T4): built-in, owner-only; a refusal is a halt.
				case "core:outlet/convert-ruleset": {
					assertBuiltInSpec(node)
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to convert — the run was started without a session scope`
						)
					const to = typeof p.to === "string" ? p.to.trim() : ""
					{
						if (!(await scopeActorOwnsSession(db, scope.userId, sessionId)))
							return forPeople(
								{ halt: "Only the session's owner can change its rules." },
								"Only the session's owner can change its rules."
							)
					}
					const { convertSessionRuleset } = await import(
						"$lib/server/sessions/convertRuleset"
					)
					const { StateRefusal } = await import("$lib/server/state/write")
					let converted
					try {
						converted = await convertSessionRuleset(db, {
							sessionId,
							to,
							userId: scope.userId as number
						})
					} catch (e) {
						if (e instanceof StateRefusal) return forPeople({ halt: e.message }, peopleSentenceOf(e))
						throw e
					}
					record(node, "session", sessionId, "updated")
					await emit(
						"core:event/ruleset-converted@1",
						{
							sessionId,
							rulesetId: converted.rulesetId,
							from: converted.from,
							to: converted.to,
							slots: converted.slots
						},
						{ kind: "edit" }
					)
					return { id: sessionId, sessionId }
				}

				// ── The form's answer (R-15 *Forms*; U5d, 2026-09-17) ──────
				//
				// Commits an oracle's answer to a form **exactly as a click
				// would** — by making the click's fire, not by running it. The
				// commit checks the answer against the form, asks the cycle
				// caps, chooses the child's run id and **collects** the fire on
				// the scope (`fires`, W2); `runSpec` dispatches it through
				// `fireAction` — the road `sessions:fireAction` takes — as
				// the addressee, once this run's receipt is saved, outside any
				// node timeout and as this run's child. A grandchild parked at
				// review parks nothing here.
				//
				// Every outcome of the answer is a **halt**, never a throw (W1):
				// an oracle that missed the form, a form that is gone, a cap
				// that refused — each is a legible end of this run with the
				// sentence on its receipt, and a cap's refusal is receipted for
				// the would-be child as well (`refusalReceipt`, written by
				// `dispatchFires` after this run's own row — S-b), so the
				// tree's reader sees where it stopped. Only a wiring fault
				// throws.
				case "core:outlet/answer-form": {
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to answer in — the run was started without a session scope`
						)
					if (scope.userId === undefined || scope.userId === null)
						throw new HostScopeError(
							`${node.key} has no run owner to act under — the run was started without a user scope`
						)
					// Under the form-addressed inlet alone: the form this
					// answers is the one the event carried, and a document
					// entered any other way has none (validate() refuses the
					// placement; this is the same refusal at the write).
					if (
						scope.inletDefinitionId !== undefined &&
						scope.inletDefinitionId !== FORM_ADDRESSED_INLET_ID
					)
						throw new HostScopeError(
							`${node.key} (${node.definitionId}) answers a form as its addressee, and ` +
								`'${scope.specId ?? "this document"}' was entered through ` +
								`${scope.inletDefinitionId}, not ${FORM_ADDRESSED_INLET_ID} — only the ` +
								`pipeline the form-addressed event ran has a form to answer`
						)
					const messageId = refId(p.messageId)
					const blockId = typeof p.blockId === "string" ? p.blockId : null
					// 🚧 A `seated-member:<memberId>` addressee is read as its seat's
					// card form first (seat-cast S3) — the form's addressee is stored
					// in the card form. A member nobody is seated as stays as written,
					// which no stored addressee equals, so the form halts as addressed
					// to somebody else; it is never stored.
					const addressee =
						typeof p.addressee === "string" && isParticipantRef(p.addressee)
							? ((await storedSeatRef(db, sessionId, p.addressee)) ??
								p.addressee)
							: null
					if (messageId === null || !blockId || !addressee)
						throw new HostScopeError(
							`${node.key} was given no form to answer — wire 'messageId', 'blockId' and ` +
								`'addressee' from the form-addressed inlet`
						)
					/** The legible end: this run halts on the sentence, and nothing fires. */
					const halted = (reason: string) => ({
						id: messageId,
						sessionId,
						halt: `${node.key}: ${reason}`
					})
					// The block, off the ROW — never off the port, whose copy
					// a reviewer or a script could have shaped.
					const { loadFormBlock } = await import("$lib/server/messages/blocks")
					const block = await loadFormBlock(db, messageId, blockId)
					if (!block)
						return halted(
							`no form '${blockId}' on message ${messageId} — it was removed before the answer arrived`
						)
					const [subject] = await db
						.select({ sessionId: schema.sessionMessages.sessionId })
						.from(schema.sessionMessages)
						.where(eq(schema.sessionMessages.id, messageId))
						.limit(1)
					assertScoped(node, subject?.sessionId, scope.sessionId)
					// ⏳ (S4) A stored addressee of an older write may still be in card
					// form; the door reads it in the form `addressee` is in.
					const storedAddressee =
						typeof block.addressee === "string"
							? ((await storedSeatRef(db, sessionId, block.addressee)) ??
								block.addressee)
							: block.addressee
					if (storedAddressee !== addressee)
						return halted(
							`the form '${blockId}' is addressed to ${block.addressee ?? "nobody"}, not ${addressee}`
						)
					// Answered once (W7): the row says who already did.
					if (block.answered)
						return halted(
							`the form '${blockId}' was already answered by ${block.answered.by}`
						)
					// The answer against the form's schema (R-15): the oracle's
					// document, checked here before anything fires. A `form`
					// block's values are checked field by field; a `choices`
					// block's answer must name one of its options.
					const fire = formFireOf(block, p.answer)
					if (!fire) {
						const schemaText = JSON.stringify(formAnswerSchema(block))
						return halted(
							`the answer ${JSON.stringify(p.answer)} does not fit the form — its schema is ${schemaText}`
						)
					}
					if (block.kind === "form") {
						const { checkValues } = await import("@serene-pub/sdk")
						const faults = checkValues(block.fields, fire.payload)
						if (faults.length)
							return halted(
								`the answer does not fit the form — ` +
									faults.map((f) => `${f.message} (${f.fix})`).join("; ")
							)
					}
					// Which spec the fire routes to — named on the fire so a
					// refusal can be receipted against it, by the same rule
					// `fireAction` routes with (plans/31 V2): the identity the
					// block stamped, else the genre's sole declarer of its `fn`,
					// and that identity's declarer if it still serves.
					const { resolveSubjectVerdict, listGenreActions, soleDeclarer, STANDARD_GENRE_ID } =
						await import("$lib/server/pipelines/entities/sessionGenres")
					const { parseActionIdentity, actionIdentity } = await import(
						"$lib/shared/actions/identity"
					)
					const [session] = await db
						.select({ genreId: schema.sessions.genreId })
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)
					const genreId = session?.genreId ?? STANDARD_GENRE_ID
					let identity = fire.action ?? null
					if (!identity) {
						const sole = soleDeclarer(await listGenreActions(db, genreId), fire.fn)
						if (!sole)
							return halted(
								`the form's '${fire.fn}' names no single action of this session's genre — ` +
									`a block fires a declared action or nothing`
							)
						identity = actionIdentity(sole)
					}
					const routed = await resolveSubjectVerdict(db, genreId, identity, {
						sessionId,
						spec: parseActionIdentity(identity)?.specSlug ?? null
					})
					if (!routed.spec)
						return halted(`nothing serves '${identity}' for this session's genre`)
					const childRunId = randomUUID()
					const pending: PendingFire = {
						runId: childRunId,
						specId: routed.spec,
						action: identity,
						messageId,
						blockId,
						payload: fire.payload,
						as: addressee as ParticipantRef
					}
					// The cycle caps, asked at the door (01 §8; W1): a refusal
					// halts this run on the cap, and the would-be child's row —
					// lineage filled, the routed spec named — is written by
					// `dispatchFires` after this run's receipt (S-b), so the
					// parent's row lands before the child's. The commit only
					// records the refusal on the fire.
					if (scope.runId) {
						const { childLineage, admitDescendant } = await import(
							"$lib/server/pipelines/runtime/lineage"
						)
						const lineage = childLineage({ runId: scope.runId, lineage: scope.lineage })
						const cap = admitDescendant(lineage)
						if (cap) {
							scope.fires?.push({ ...pending, refused: cap })
							return halted(cap)
						}
					}
					scope.fires?.push(pending)
					return {
						id: messageId,
						sessionId,
						answer: fire.payload,
						firedAction: identity,
						firedRunId: childRunId
					}
				}

				// Attachments (20 §1): bytes into the session's asset store,
				// a typed part onto the message — never bytes in a row, never
				// a foreign URL. Both consumers are gate-eligible (`effects:
				// 'write'`; attach-image even defaults review ON, F14's proof
				// case), so what the reviewer approves is what lands.
				case "core:outlet/attach-image":
				case "core:outlet/attach-audio": {
					const media = (p.image ?? p.audio ?? p) as Record<
						string,
						any
					>
					/**
					 * The row, read as `update-message` reads its own
					 * `target` one case up: a row id from the inlet, or the
					 * write result of an earlier outlet in this run — the
					 * reply's placeholder, whose `ids.id` is a row id by the
					 * time this node runs (R-17). The media reference's own
					 * `messageId` still answers for a caller outside the graph.
					 */
					const targetRef = p.target
					const messageId =
						refId(media.messageId ?? p.messageId) ??
						refId(
							targetRef && typeof targetRef === "object" && "ids" in targetRef
								? (targetRef as { ids?: { id?: unknown } }).ids?.id
								: targetRef
						)
					// 🚧 Speech: an `audio` wired to nothing (the line had nothing to
					// speak, or speaking it failed and the step answered null) writes
					// nothing and is no failure — `written: false`, so no
					// `message-updated` is caused. Image attaches keep their rule.
					if (
						node.definitionId.includes("attach-audio") &&
						(p.audio === null || p.audio === undefined) &&
						typeof p.uuid !== "string" &&
						typeof p.data !== "string"
					)
						return { id: messageId, sessionId: scope.sessionId, written: false }
					if (messageId === null)
						throw new HostScopeError(
							`${node.key} was given no message id to attach to — wire 'target' from the ` +
								`inlet's row id, or from the outlet that created the row.`
						)
					// A REFERENCE first, bytes only as the legacy path.
					//
					// `media.ts` is explicit that media travels as a reference and
					// never as bytes, and everything that produces media in a run
					// now stores it and passes a uuid. A base64 payload is still
					// accepted because a caller outside the graph may genuinely
					// have only bytes — but it is the fallback, not the contract.
					const uuid =
						typeof media.uuid === "string" ? media.uuid : null
					const b64 =
						typeof media.data === "string" ? media.data : null
					if (!uuid && !b64)
						throw new HostScopeError(
							`${node.key} was given neither a media reference ('uuid') nor bytes ('data').`
						)
					const { getMessage, appendParts } = await import(
						"$lib/server/messages/store"
					)
					const target = await getMessage(db, messageId)
					if (!target)
						throw new HostScopeError(
							`${node.key}: no message ${messageId} to attach to`
						)
					assertScoped(node, target.sessionId, scope.sessionId)
					const isImage = node.definitionId.includes("attach-image")

					let asset: { id: number; mime: string }
					if (uuid) {
						const [found] = await mediaParts(
							db,
							[media],
							target.sessionId,
							scope,
							node
						)
						if (!found)
							throw new HostScopeError(
								`${node.key}: no media ${uuid} to attach`
							)
						// 🚧 Re-speaking: the earlier spoken part(s) go first.
						const swapped =
							!isImage && p.params?.replace === true
								? await replaceSpokenAudio(
										db,
										target,
										typeof found.data.assetId === "number"
											? found.data.assetId
											: null
									)
								: 0
						await appendParts(db, messageId, [found as any])
						// The file already existed — this run attached it — and
						// the message it landed on changed.
						record(node, "file", found.data.assetId, "attached")
						record(node, "message", messageId, "updated")
						if (!isImage) {
							// 🚧 S6: the line's `spoken` record, per swipe. No `meta`
							// writes the part alone — except that replacing audio with
							// none clears the record it would otherwise contradict.
							const spokenMeta =
								p.meta && typeof p.meta === "object" && "cueMap" in p.meta
									? (p.meta as import("@serene-pub/sdk").SpokenMeta)
									: null
							if (spokenMeta || swapped) {
								const { nextSpokenMetadata } = await import(
									"$lib/server/pipelines/runtime/dispatchSpeech"
								)
								const { updateLegacy } = await import("$lib/server/messages/store")
								const current = await legacyMessage(db, messageId)
								if (current)
									await updateLegacy(db, messageId, {
										metadata: nextSpokenMetadata(
											current.metadata as Record<string, any> | null,
											spokenMeta
										)
									})
							}
							// Parts joined the row: send it with them, so the player
							// appears without a reload.
							await announceWithParts(messageId)
						}
						// The write-result's `id` is the MESSAGE row on both
						// paths (ruled at the U6 review): it is what a later
						// `target: $.attach.main` chains to. The asset rides
						// under its own key.
						return {
							id: messageId,
							messageId,
							assetId: found.data.assetId,
							sessionId: target.sessionId
						}
					}

					const { createSessionAsset } = await import(
						"$lib/server/messages/assets"
					)
					const stored = await createSessionAsset(db, {
						sessionId: target.sessionId,
						bytes: Buffer.from(b64!, "base64"),
						mime:
							typeof media.mime === "string"
								? media.mime
								: isImage
									? "image/png"
									: "application/octet-stream",
						createdBy: scope.userId ?? null
					})
					// A part addresses the FILE and records the display variant's
					// mime — same rule as `mediaParts` above, and for the same
					// reason: what a part stores must not be a fact about one
					// stored representation, because that representation can be
					// culled or re-pointed under it.
					record(node, "file", stored.file.id, "created")
					record(node, "variant", stored.original.id, "created")
					asset = {
						id: stored.file.id,
						// The projection is always written; the fallback is the
						// row it was projected from, already in hand here.
						mime: stored.file.displayMime ?? stored.original.mime
					}
					// The same part writer as every other path
					// (`attachments/partData`): the stored file's width,
					// height, name and size ride on the part.
					const { mediaPartFor } = await import(
						"$lib/server/attachments/partData"
					)
					await appendParts(db, messageId, [
						mediaPartFor(stored.file, {
							// 🚧 O5: a non-image is filed by what it is — a sound
							// `attach-audio` stored is a `core:audio` part, not a
							// download chip.
							...(isImage ? { as: "image" as const } : {}),
							alt: media.alt ? String(media.alt) : null,
							name: media.name ? String(media.name) : null,
							mime: asset.mime
						}) as any
					])
					record(node, "message", messageId, "updated")
					// The message row as `id` here too — see the reference
					// path above — with the asset it stored under `assetId`.
					return {
						id: messageId,
						messageId,
						assetId: asset.id,
						sessionId: target.sessionId
					}
				}

				case "core:outlet/create-character":
					return await libraryOutlet(node, "create-character", p)
				case "core:outlet/update-character":
					return await libraryOutlet(node, "update-character", p)
				case "core:outlet/create-lorebook":
					return await libraryOutlet(node, "create-lorebook", p)

				case "core:outlet/create-lore-entry": {
					/**
					 * The finished summary, written as a lore entry.
					 *
					 * Which *kind* of entry comes from the pipeline that ran,
					 * and since L3 (2026-09-17) that is finally true: the
					 * `entryType` param says which, and an unknown id is
					 * refused rather than filed as world lore. The four
					 * summarize namespaces still exist so the *press* decides
					 * which pipeline runs; this is that decision reaching the
					 * row.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to write a lore entry for — the run was started without a session scope`
						)

					const [session] = await db
						.select()
						.from(schema.sessions)
						.where(eq(schema.sessions.id, sessionId))
						.limit(1)

					/**
					 * Declared writes (R-B): a genre whose lorebook is a
					 * *reference* writes nothing into it, whatever spec is
					 * bound here. This is the only pipeline outlet that
					 * writes lore, so it is the only place the law needs
					 * stating — and it is stated at the write rather than by
					 * hiding the affordance, because the affordance is not
					 * what a user-attached pipeline goes through.
					 *
					 * Before the lorebook check: "this genre never writes
					 * here" is true whether or not a book is attached, and
					 * telling somebody to attach one would send them to a
					 * screen that cannot help.
					 */
					// Only the genre's declared writes can refuse here. The lore
					// write mode never refuses (🚧 PLAN-rulesets §26): what the
					// session may not write to its book — no book, Review
					// changes, Off, someone else's book — lands in its own notes.
					const noLore = await loreWriteRefusal(db, sessionId)
					if (noLore) throw forPeople(new HostScopeError(`${node.key}: ${noLore}`), noLore)
					if (!session)
						throw new HostScopeError(`${node.key}: session ${sessionId} not found`)
					// 🚧 `sources` present: a generated write (pass 6) — checked
					// before the transaction, committed and settling with it.
					const checked =
						p.sources !== undefined
							? await checkLoreSources(db, scope, node.key, p.sources)
							: null

					const name = String(p.name ?? "").trim() || "Untitled"
					const content = String(p.content ?? "")

					/**
					 * Which kind of entry this pipeline writes (L3).
					 *
					 * Refused and never coerced: a typo that silently files
					 * rooms as world lore is the defect this replaces, and the
					 * refusal names the declared types so the fix is in the
					 * sentence. Absent is world lore, the agnostic shape, so
					 * every spec written before the param keeps doing exactly
					 * what it did.
					 */
					const typeId =
						String(p.params?.entryType ?? "").trim() ||
						WORLD_LORE_TYPE_ID
					const { HISTORY_TYPE_ID } = await import("$lib/shared/entries/types")
					if (!isDeclaredEntryType(typeId))
						throw new HostScopeError(
							`${node.key}: '${typeId}' is not a declared entry type, so there is nothing to file this under. The declared types are ${entryDeclarations().map((d) => d.typeId).join(", ")}.`
						)
					/**
					 * 🚧 **Typed fields** (Lair rewrite D2, 2026-10-21): the
					 * entry type's own fields, checked whole against the type
					 * (`fieldsFindings`) — a misfit is refused with the field
					 * named, never dropped. The same check the review gate
					 * holds an edit to (`reviewGate.ts lorePatchFindings`).
					 */
					if (typeId === HISTORY_TYPE_ID && p.fields && typeof p.fields === "object")
						refuseYearlessHistoryDate(node.key, p.fields as Record<string, unknown>)
					const fields = typedFieldsOf(node.key, typeId, p.fields, { partial: false })
					/**
					 * The Beginning and Decay a new entry starts with: the
					 * step's params (checked, never coerced) over the entry
					 * type's defaults (`entryDefaults`). The date is the
					 * story's day when the session's story has one
					 * (`loreWriteDateOf`), else none.
					 */
					const { entryTypeDefaultsLayer, entryTypeSentenceName, checkStepDefaults, newEntryTime } =
						await import("$lib/server/lorebooks/entryDefaults")
					const { takesBeginning } = await import("$lib/server/utils/lorebookEntries")
					const stepDefaults = checkStepDefaults(p.params, {
						name: entryTypeSentenceName(typeId),
						takesBeginning: takesBeginning(typeId)
					})
					if ("refusal" in stepDefaults)
						throw new HostScopeError(`${node.key}: ${stepDefaults.refusal}`)
					const writeDate = await (await import("$lib/server/state/storyTime")).loreWriteDateOf(db, sessionId)
					const entryTimeLayers = {
						type: entryTypeDefaultsLayer(typeId),
						step: stepDefaults.layer,
						takesBeginning: takesBeginning(typeId)
					}
					const newEntryAt = newEntryTime({
						...entryTimeLayers,
						date: writeDate.kind === "dated" ? writeDate.date : null
					})
					// Whether the new entry's Beginning resolves to *began* (asked of
					// `newEntryTime` itself, with a stand-in date): such an entry stores
					// a date, so the backstop below asks for one.
					const beginsDated = newEntryTime({ ...entryTimeLayers, date: { year: 0 } }).year !== null

					// A book with no timeline keeps no history: nothing is written, the run goes on.
					if (typeId === HISTORY_TYPE_ID && !(await sessionTimelineOf(db, sessionId)))
						return {
							lorebookId: (await attachedOrOwnBookOf(db, sessionId)) ?? null,
							route: "book" as const,
							written: false,
							notes: [...(checked?.notes ?? []), TIMELINE_OFF_SENTENCES.history]
						}

					/**
					 * ⚠ `position` is allocated rather than left at the old
					 * column default of `0`.
					 *
					 * It is unique per `(lorebook_id, type_id)` on the unified
					 * table, so the second summary written into a lorebook
					 * would collide on `0` instead of landing beside the
					 * first. The allocator is the socket handlers' — first free
					 * slot from 1 — under the same advisory lock, so a summary
					 * written while somebody is adding an entry by hand cannot
					 * race it.
					 */
					const target = await sessionLoreWriteTo(db, sessionId, turnMessageId, {
						// 🚧 A filing tool on Review (lane 2): host-internal, never a port.
						notes: (p as { toNotes?: unknown }).toNotes === true
					})
					const lorebookId = target.lorebookId
					// 🚧 On the `book` route, a change waiting in the notes is looked for
					// first: the notes' reading (its main head) and where a row the notes
					// take lands, made before the transaction.
					const notes = await notesBesideBook(db, sessionId, turnMessageId, target)
					// 🚧 `bind`: the cast member the entry is filed under,
					// resolved before the transaction.
					const anchorBindingId =
						p.bind !== undefined
							? await resolveBind(db, { lorebookId, typeId }, p.bind, node.key, target.line.alsoReads)
							: undefined
					/**
					 * The links, in the SAME transaction as the row (L2).
					 *
					 * `core:outlet/link-lore-entries@1` may follow this outlet
					 * (F7 limits only the live row), but that is a second
					 * transaction. Writing them together is the honest shape
					 * when they are one thought: a room whose exits
					 * name an entry that is not there fails **with** the room
					 * rather than leaving half a room behind, because the
					 * refusal is raised inside the transaction.
					 */
					const links = loreLinkRequests(p.links)
					// The session's line is read inside the transaction, after the
					// fork (`forkedLoreLine`): the entry and its links are that
					// line's own, never main's by omission (finding #0).
					// 🚧 RF fix 4: the entry and the links it made, imprinted in the same transaction.
					const anchor = await imprintAnchor(sessionId)
					const linkAnchor = linkAnchorOf(sessionId, anchor, target)
					// 🚧 The anchor of a link written into the notes beside the `book` route.
					const notesAnchor = notes
						? linkAnchorOf(sessionId, anchor, { line: notes.line, sourceMessageId: notes.sourceMessageId })
						: null
					const { imprintMade } = await import("$lib/server/lorebooks/imprints")
					let settled: Awaited<ReturnType<typeof settleThrough>> | null = null
					const written = await db.transaction(
						async (tx) => {
							await tx.execute(
								sql`select pg_advisory_xact_lock(${lorebookId})`
							)
							// 🚧 `match` (R-h): the entry this would duplicate,
							// found under the book's lock, on what the session reads
							// now (`target.line.reading`, before any fork). One → it is
							// changed, by the code `update-lore-entry@1` runs (written in
							// place, as a dated version, or held, `lorebookChangeHeld`); a match forks nothing,
							// so on a line still to be forked it is held; the line forks
							// only for an insert, a history day or links.
							// History is filed onto the day's one entry: the date is
							// the match (`fileOntoHistoryDay`), and `match` is not read.
							// 🚧 A write that carries `shown` and matches `{ name }` is read by
							// `lookLoreMatch`: one entry it was shown is rewritten, one it was
							// not shown gets a paragraph, a key alone is no match, two of the
							// name change nothing. Any other write goes through `findLoreMatch`.
							const loreMatch = await import("$lib/server/pipelines/runtime/loreMatch")
							// The notes first, then the lorebook (the route's own book order).
							const matchAt = notes
								? { lorebookId: notes.lorebookId, typeId, reading: notes.line.reading }
								: { lorebookId, typeId, reading: target.line.reading }
							const matchThen = notes
								? { lorebookId, reading: target.line.reading }
								: target.line.alsoReads
							const shown = loreMatch.shownIdsOf((p as { shown?: unknown }).shown)
							const matchName =
								typeId !== HISTORY_TYPE_ID && p.match !== undefined && shown !== null
									? loreMatch.matchNameOf(p.match)
									: null
							const look =
								matchName !== null
									? await loreMatch.lookLoreMatch(
											tx as unknown as Db,
											matchAt,
											matchName,
											matchThen
										)
									: null
							const shownNotes: string[] = []
							if (look?.by === "name" && look.ids.length > 1)
								return {
									tie: `${look.ids.length} entries answer to '${matchName!.trim()}' — ${look.ids
										.map((h) => `'${h.name}' (entry ${h.id})`)
										.join(", ")}; nothing was written for it.`
								}
							if (look?.by === "key")
								shownNotes.push(
									`'${matchName!.trim()}' met a key of ${look.ids
										.map((h) => `'${h.name}' (entry ${h.id})`)
										.join(", ")}; written as a new entry.`
								)
							const foundId =
								look !== null
									? look.by === "name"
										? look.ids[0]!.id
										: null
									: typeId !== HISTORY_TYPE_ID && p.match !== undefined
										? await findLoreMatch(
												tx as unknown as Db,
												matchAt,
												p.match,
												node.key,
												matchThen
											)
										: null
							// A match that is a row waiting in the notes (`book` route) is changed
							// there: the write, its links and its imprints are the notes'.
							const inNotes =
								notes !== null &&
								foundId !== null &&
								(
									await tx
										.select({ lorebookId: schema.lorebookEntries.lorebookId })
										.from(schema.lorebookEntries)
										.where(eq(schema.lorebookEntries.id, foundId))
										.limit(1)
								)[0]?.lorebookId === notes.lorebookId
							if (inNotes)
								await tx.execute(sql`select pg_advisory_xact_lock(${notes!.lorebookId})`)
							// 🚧 A history day on the `book` route goes to the notes when they hold
							// a day for its date, or rule C would refuse it on the line of a session
							// whose scenes end by themselves: decided before the line forks.
							const historyDate =
								typeId === HISTORY_TYPE_ID
									? await historyDateOf(tx as unknown as Db, {
											nodeKey: node.key,
											sessionId,
											fields,
											countNotes: target.line.alsoReads !== undefined || notes !== null
										})
									: null
							const dayInNotes =
								notes !== null &&
								historyDate !== null &&
								(await historyDayInNotes(tx as unknown as Db, {
									sessionId,
									notesId: notes.lorebookId,
									lorebookId,
									line: target.line,
									scenesEndByThemselves: target.scenesEndByThemselves,
									date: historyDate
								}))
							const toNotes = inNotes || dayInNotes
							// Where the rows this write makes land: the notes for a notes match or day.
							const writeBookId = toNotes ? notes!.lorebookId : lorebookId
							// A link of a row the lorebook holds whose end is a row waiting in the
							// notes is written there; found before the line forks.
							const linkToNotes: (number | null)[] = []
							if (notes && !toNotes)
								for (const link of links)
									linkToNotes.push(await notesRowAnswering(tx as unknown as Db, notes, link.to))
							const linksToLorebook = links.some((_, i) => (linkToNotes[i] ?? null) === null)
							// A write that makes a row or a link in the lorebook forks the line.
							const line: LoreWriteLine = toNotes
								? notes!.line
								: foundId === null || linksToLorebook
									? await forkedLoreLine(tx as unknown as Db, sessionId, target)
									: target.line
							const historyDay =
								typeId === HISTORY_TYPE_ID
									? await fileOntoHistoryDay(tx as unknown as Db, {
											nodeKey: node.key,
											sessionId,
											lorebookId: writeBookId,
											line,
											fields,
											date: historyDate,
											content,
											sourceMessageId: dayInNotes ? notes!.sourceMessageId : target.sourceMessageId,
											anchor
										})
									: null
							const matchedId = historyDay
								? historyDay.created
									? null
									: historyDay.row.id
								: foundId
							let created:
								| typeof schema.lorebookEntries.$inferSelect
								| undefined
							let changed = false
							// The attached lorebook an entry's change was held against (a match).
							let heldIn: number | null = null
							if (historyDay) {
								changed = historyDay.changed
								if (historyDay.created) created = historyDay.row
							} else if (matchedId !== null) {
								const [stored] = await tx
									.select()
									.from(schema.lorebookEntries)
									.where(eq(schema.lorebookEntries.id, matchedId))
									.limit(1)
								if (!stored)
									throw new HostScopeError(`${node.key}: entry ${matchedId} is no longer in this session's lorebook.`)
								// An entry of the lorebook waits or is written (in place, or as a dated version): one decision,
								// shared with `changeLoreEntry` (`lorebookChangeHeld`).
								let held: boolean | undefined
								if (
									!entryLockedAgainstRuns(stored) &&
									stored.lorebookId !== (await ownBookOf(tx as unknown as Db, sessionId))?.id
								) {
									held = await lorebookChangeHeld(
										{ sessionId, lorebookId, line, stored },
										tx as unknown as Db
									)
									if (held) heldIn = stored.lorebookId
								}
								if (look?.by === "name") {
									// What the session reads of it: the attached lorebook's entry on
									// the session's reading of that book, an own-book one on the line's.
									const reads = inNotes
										? notes!.line.reading
										: stored.lorebookId === lorebookId || !target.line.alsoReads
											? target.line.reading
											: target.line.alsoReads.reading
									const read = await loreMatch.contentAsRead(tx as unknown as Db, stored, reads)
									const entryName = look.ids[0]!.name
									const appends = !shown!.includes(stored.id)
									const next = appends
										? loreMatch.appendedContent(read, content)
										: content.trim() === "" || read.trim() === content.trim()
											? null
											: content
									if (next === null)
										shownNotes.push(
											`'${entryName}' (entry ${stored.id}) already says this; nothing was written.`
										)
									else {
										changed = await changeLoreEntry(
											{
												nodeKey: node.key,
												sessionId,
												lorebookId: writeBookId,
												line,
												stored,
												patch: fields,
												name: undefined,
												content: next,
												anchor,
												held,
												notes: shownNotes
											},
											tx as unknown as Db
										)
										if (appends && !entryLockedAgainstRuns(stored))
											shownNotes.push(
												`added to '${entryName}' (entry ${stored.id}) as a new paragraph.`
											)
									}
								} else
									changed = await changeLoreEntry(
										{
											nodeKey: node.key,
											sessionId,
											lorebookId: writeBookId,
											line,
											stored,
											patch: fields,
											name: p.name,
											content: p.content,
											anchor,
											held,
											notes: shownNotes
										},
										tx as unknown as Db
									)
							} else {
								// The backstop: a Beginning that resolves to *began* is never
								// stored Perpetual on a story that has a date.
								if (beginsDated && newEntryAt.year == null) {
									const { undatedLoreWriteRefusal } = await import("$lib/server/state/storyTime")
									const refusal = await undatedLoreWriteRefusal(tx as unknown as Db, sessionId, null)
									if (refusal) throw forPeople(new HostScopeError(`${node.key}: ${refusal}`), refusal)
								}
							[created] = await tx
								.insert(schema.lorebookEntries)
								.values({
									...entryInsert(
										{
											// The typed fields first: the
											// name and body are the ports'.
											...fields,
											...(newEntryAt as Record<string, unknown>),
											typeId,
											lorebookId,
											name,
											content,
											branchId: line.branchId,
											position: await nextPosition(
												tx,
												lorebookId,
												typeId
											),
											...(anchorBindingId !== undefined
												? { lorebookBindingId: anchorBindingId }
												: {})
										},
										// A pipeline wrote it, never a person: the
										// rail's machine-written scope counts it.
										{ provenance: "pipeline" }
									),
									// 🚧 In the session's notes, its anchor on the
									// timeline (§29): a revision retracts it.
									sourceMessageId: target.sourceMessageId
								})
								.returning()
							}
							const entryId = matchedId ?? created!.id
							const ids: number[] = []
							// The rows THIS write made. A link the list states
							// twice is found the second time (`written: false`),
							// and is the run's once, not twice.
							const made: number[] = []
							// The links written into the notes, by the book of their row.
							const madeInNotes = new Set<number>()
							if (linkToNotes.some((n) => n !== null))
								await tx.execute(sql`select pg_advisory_xact_lock(${notes!.lorebookId})`)
							for (const [i, link] of links.entries()) {
								const noteEnd = linkToNotes[i] ?? null
								const wrote =
									noteEnd !== null
										? await writeLoreLink(
												tx,
												notes!.lorebookId,
												entryId,
												{ ...link, to: noteEnd },
												node.key,
												notes!.line
											)
										: await writeLoreLink(tx, writeBookId, entryId, link, node.key, line)
								ids.push(wrote.id)
								if (wrote.written) {
									made.push(wrote.id)
									if (noteEnd !== null) madeInNotes.add(wrote.id)
								}
							}
							/**
							 * 🚧 **The Exits line, linked on save** (Lair
							 * rewrite D10, 2026-10-21; places plan B7's
							 * reading, now at the write): a place a pipeline
							 * files whose body names its ways out
							 * (`Exits: north → The Hall`) gets one link per
							 * way to a place the book holds — in the line's
							 * own words, one way (the far room's own line
							 * says the way back). Only for a write that names
							 * no links of its own (the knock's typed room, a
							 * person's words): a writer that hands `links`
							 * has read its ways out already (the Lair's room
							 * drafts, `core:script/lair-room`). A name no
							 * place or two places answer to, and the place
							 * itself, are left as words. Dated at the
							 * session's reading, as every link this host
							 * writes.
							 */
							if (!links.length && created) for (const id of await exitsLineLinks(tx, {
								lorebookId,
								entryId,
								typeId,
								content,
								reached: ids,
								where: node.key,
								line
							}))
								made.push(id)
							const bookOfLink = (id: number) => (madeInNotes.has(id) ? notes!.lorebookId : writeBookId)
							if (anchor) {
								const t = tx as unknown as Db
								// A matched entry's changes were imprinted as changes.
								if (created && !historyDay)
									await imprintMade(t, anchor, { lorebookId, subject: "entry", subjectId: entryId })
								for (const id of made)
									await imprintMade(t, anchor, { lorebookId: bookOfLink(id), subject: "relationship", subjectId: id })
							} else
								// 🚧 A press-started run with no turn message: a link the notes took
								// is imprinted at the newest message, as an entry anchors there.
								for (const id of made) {
									const at = madeInNotes.has(id) ? notesAnchor : linkAnchor
									if (at)
										await imprintMade(tx as unknown as Db, at, { lorebookId: bookOfLink(id), subject: "relationship", subjectId: id })
								}
							if (checked) {
								const t = tx as unknown as Db
								const base = {
									sessionId,
									runId: scope.runId ?? null,
									lorebookId: heldIn !== null ? lorebookId : writeBookId,
									ids: checked.ids
								}
								if (created || changed)
									await recordLoreSources(t, { ...base, subjectKind: "entry", subjectId: entryId })
								for (const id of made)
									await recordLoreSources(t, {
										...base,
										lorebookId: madeInNotes.has(id) ? notes!.lorebookId : base.lorebookId,
										subjectKind: "relationship",
										subjectId: id
									})
								// 🚧 (sense-b4) A session whose scenes end by themselves does not settle by
								// `sources`: its write is the own book's, kept as provenance only.
								if (!target.scenesEndByThemselves)
									settled = await settleThrough(t, sessionId, Math.max(...checked.ids), {
										runId: scope.runId,
										userId: scope.userId
									})
							}
							return {
								row: created ?? null,
								entryId,
								matched: matchedId !== null,
								changed,
								linkIds: ids,
								madeLinkIds: made,
								dayNote: historyDay?.note ?? null,
								heldIn,
								inNotes,
								dayInNotes,
								writeBookId,
								shownNotes
}
}
)
					if ("tie" in written)
						return {
							lorebookId,
							route: target.route,
							written: false,
							notes: [...(checked?.notes ?? []), written.tie]
						}
					const {
						row,
						entryId,
						matched,
						changed,
						linkIds,
						madeLinkIds,
						dayNote,
						heldIn,
						inNotes,
						dayInNotes,
						writeBookId,
						shownNotes
					} = written
					await announceSettled(sessionId, settled)
					// The run's book read (C4) predates this entry: a later
					// read in the same run must see it.
					lorebookReads.clear()
					// Invisible to the run until now: a summarize pipeline wrote
					// an entry and the run row said it had produced nothing.
					if (row) record(node, "lore_entry", row.id, "created")
					else if (changed) record(node, "lore_entry", entryId, "updated")
					for (const id of madeLinkIds)
						record(node, "lore_link", id, "created")
					const allNotes = [...(checked?.notes ?? []), ...(dayNote ? [dayNote] : []), ...shownNotes]
					const noted = allNotes.length ? { notes: allNotes } : {}
					// `linkIds` is one id per requested link, in order: a
					// repeated link names the row it repeated.
					if (matched)
						return {
							id: entryId,
							entryId,
							lorebookId: heldIn ?? writeBookId,
							route: heldIn !== null || inNotes || dayInNotes ? ("own-book" as const) : target.route,
							matched: true,
							written: false,
							...(linkIds.length ? { linkIds } : {}),
							...noted
						}
					return {
						id: entryId,
						lorebookId: dayInNotes ? writeBookId : lorebookId,
						route: dayInNotes ? ("own-book" as const) : target.route,
						...(linkIds.length ? { linkIds } : {}),
						...noted
					}
				}

				case "core:outlet/update-lore-entry": {
					/**
					 * 🚧 **Change a lore entry** (Lair rewrite D2, 2026-10-21):
					 * its name, its content, its typed fields — the same
					 * session scoping, book and `writes.lore` refusal as the
					 * create beside it. `entry` is resolved inside the
					 * session's book as a link's end is (an id, a write
					 * result, a name — none or two refused). `fields` is a
					 * patch checked against the entry's own type
					 * (`fieldsFindings`, partial: `null` clears a field); the
					 * type never changes. Lands on the session's line: a row
					 * another line owns (main's, read from a branch) is an
					 * amendment's to change, which this write does not make —
					 * refused with the sentence. No event (🚧 the contract's).
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to change a lore entry in — the run was started without a session scope`
						)
					const noLore = await loreWriteRefusal(db, sessionId)
					if (noLore) throw forPeople(new HostScopeError(`${node.key}: ${noLore}`), noLore)
					// 🚧 `sources` present: a generated write (pass 6) — checked
					// before the transaction, committed and settling with it.
					const checked =
						p.sources !== undefined
							? await checkLoreSources(db, scope, node.key, p.sources)
							: null
					const target = await sessionLoreWriteTo(db, sessionId, turnMessageId)
					// 🚧 `entry` is resolved over what the session reads. On the `book` route
					// the session's notes first (a change or an entry waiting there), then the
					// lorebook as the session reads it. On the notes route with a lorebook
					// attached: the lorebook's entries, then the notes' (one name rule over
					// both), or, for a session whose scenes end by themselves, the notes first
					// and then the lorebook (`alsoReads`).
					const { lorebooksReadBy, sessionEntriesAsRead } = await import(
						"$lib/server/lorebooks/ownBook"
					)
					const waitingNotes = target.route === "book" ? await ownBookOf(db, sessionId) : null
					const notesFirst =
						waitingNotes && waitingNotes.id !== target.lorebookId
							? {
									lorebookId: waitingNotes.id,
									reading: {
										lorebookId: waitingNotes.id,
										branchId: null,
										moment: null,
										forkedAt: null,
										line: MAIN_LINE
									} as LineReading
								}
							: null
					const entryId = notesFirst
						? await resolveLoreLinkEnd(
								db,
								notesFirst.lorebookId,
								p.entry,
								node.key,
								notesFirst.reading,
								"change",
								undefined,
								{ lorebookId: target.lorebookId, reading: target.line.reading }
							)
						: await resolveLoreLinkEnd(
								db,
								target.lorebookId,
								p.entry,
								node.key,
								target.line.reading,
								"change",
								target.route !== "book" &&
									!target.scenesEndByThemselves &&
									(await lorebooksReadBy(db, sessionId)).attachedId != null
									? (ids) => sessionEntriesAsRead(db, sessionId, "session", null, ids)
									: undefined,
								// Scenes end by themselves: the own book first, then the lorebook as
								// the session reads it, as the rest of the notes route does.
								target.scenesEndByThemselves ? target.line.alsoReads : undefined
							)
					const [stored] = await db
						.select()
						.from(schema.lorebookEntries)
						.where(eq(schema.lorebookEntries.id, entryId))
						.limit(1)
					if (!stored)
						throw new HostScopeError(`${node.key}: entry ${entryId} is no longer in this session's lorebook.`)
					// A locked entry is left as it is: refused before anything is held, written or
					// settled, and answered as a note so the reply goes on.
					if (entryLockedAgainstRuns(stored))
						return {
							id: entryId,
							entryId,
							lorebookId: stored.lorebookId,
							route: target.route,
							written: false,
							notes: [
								...(checked?.notes ?? []),
								RUN_LOCK_SENTENCES.entry(`'${stored.title ?? `entry ${stored.id}`}'`)
							]
						}
					// 🚧 Where the change lands: an entry of the attached lorebook is written
					// (in place, or as a dated version) on the `book` route and otherwise held as an amendment in the
					// session's own book (`lorebookChangeHeld`; the result names the entry's
					// lorebook and `own-book` where it waits); an entry of the own book is
					// written there, as it always was.
					const ownBook = await ownBookOf(db, sessionId)
					const inLorebook = stored.lorebookId !== ownBook?.id
					const held =
						inLorebook &&
						(await lorebookChangeHeld({
							sessionId,
							lorebookId: target.lorebookId,
							line: target.line,
							stored
						}))
					const landing = held
						? { route: "own-book" as const, lorebookId: stored.lorebookId, line: target.line }
						: inLorebook
							? target
							: target.route === "book"
								? await sessionLoreWriteTo(db, sessionId, turnMessageId, { notes: true })
								: target
					const { lorebookId, line } = landing
					const patch = typedFieldsOf(node.key, stored.typeId, p.fields, { partial: true })
					const dateNotes: string[] = []
					const change = {
						nodeKey: node.key,
						sessionId,
						lorebookId,
						line,
						stored,
						patch,
						name: p.name,
						content: p.content,
						anchor: await imprintAnchor(sessionId),
						held,
						notes: dateNotes
					}
					// 🚧 A history entry moved to another day: the date checks the
					// socket's update runs, in the change's one transaction. A save
					// that resends the stored date runs none (a doubled date stays
					// editable).
					const { HISTORY_TYPE_ID } = await import("$lib/shared/entries/types")
					let moved: import("$lib/shared/lorebooks/storyDate").StoryDate | null = null
					// A lorebook entry written as a dated version names no history day to re-date.
					const datedVersion =
						inLorebook &&
						!held &&
						(await (await import("$lib/server/state/storyTime")).loreWriteDateOf(db, sessionId)).kind === "dated"
					// 🚧 Timeline off: `changeLoreEntry` drops the date parts, so none run.
					if (
						!held &&
						!datedVersion &&
						line.reading.timelineOff !== true &&
						stored.typeId === HISTORY_TYPE_ID &&
						["year", "month", "day"].some((k) => Object.prototype.hasOwnProperty.call(patch, k))
					) {
						const { historyEntryDate } = await import("$lib/server/state/reading")
						const { compareDates, dayOnly } = await import("$lib/shared/lorebooks/storyDate")
						const was = historyEntryDate(stored.fields)
						const pick = (k: "year" | "month" | "day") =>
							Object.prototype.hasOwnProperty.call(patch, k) ? patch[k] : was?.[k]
						const year = pick("year")
						if (typeof year === "number") {
							const to = {
								year,
								month: typeof pick("month") === "number" ? (pick("month") as number) : null,
								day: typeof pick("day") === "number" ? (pick("day") as number) : null
							}
							if (!was || compareDates(dayOnly(was), dayOnly(to)) !== 0) moved = to
						}
					}
					let changed: boolean
					let settled: Awaited<ReturnType<typeof settleThrough>> | null = null
					if (checked || moved) {
						changed = await db.transaction(async (tx) => {
							await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
							if (moved) {
								const { assertDateLands } = await import("$lib/server/state/storyTime")
								const { assertHistoryDateFree } = await import("$lib/server/scenes/historyEntryOfDate")
								const { assertRedateKeepsLines } = await import("$lib/server/utils/forkHistory")
								try {
									await assertDateLands(tx as unknown as Db, lorebookId, moved)
									await assertHistoryDateFree(tx as unknown as Db, {
										lorebookId,
										branchId: stored.branchId ?? null,
										date: moved,
										exceptId: entryId
									})
									await assertRedateKeepsLines(tx as unknown as Db, entryId, moved)
								} catch (e) {
									if (e instanceof HostScopeError || !(e instanceof Error)) throw e
									throw new HostScopeError(`${node.key}: ${e.message}`)
								}
							}
							const did = await changeLoreEntry(change, tx as unknown as Db)
							if (did && checked)
								await recordLoreSources(tx as unknown as Db, {
									sessionId,
									runId: scope.runId ?? null,
									lorebookId,
									subjectKind: "entry",
									subjectId: entryId,
									ids: checked.ids
								})
							// 🚧 (sense-b4) A session whose scenes end by themselves does not settle by `sources`.
							if (checked && !target.scenesEndByThemselves)
								settled = await settleThrough(
									tx as unknown as Db,
									sessionId,
									Math.max(...checked.ids),
									{ runId: scope.runId, userId: scope.userId }
								)
							return did
						})
						await announceSettled(sessionId, settled)
					} else changed = await changeLoreEntry(change)
					if (changed) {
						lorebookReads.clear()
						record(node, "lore_entry", entryId, "updated")
					}
					return {
						id: entryId,
						entryId,
						lorebookId,
						route: landing.route,
						...((checked?.notes.length ?? 0) + dateNotes.length
							? { notes: [...(checked?.notes ?? []), ...dateNotes] }
							: {})
					}
				}

				case "core:outlet/update-cast-member": {
					/**
					 * 🚧 **Change a cast member** (`core:outlet/update-cast-member@1`):
					 * a story write through the one cast-version writer,
					 * gated by `writes.lore` and routed by the lore write
					 * mode; anchored to the turn, so Back takes it. No run
					 * artifact kind is kept for it.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to change a cast member in — the run was started without a session scope`
						)
					const { writeCastMember, CastMemberRefusal } = await import(
						"$lib/server/pipelines/runtime/castMember"
					)
					const { turnMessageOf } = await import(
						"$lib/server/pipelines/runtime/runTurnMessage"
					)
					try {
						const out = await writeCastMember(db, {
							sessionId,
							member: p.member,
							changes: p.changes,
							runId: scope.runId,
							messageId: turnMessageId ?? turnMessageOf(scope.runId)
						})
						lorebookReads.clear()
						return out
					} catch (err) {
						if (err instanceof CastMemberRefusal)
							throw new HostScopeError(`${node.key}: ${err.message}`)
						throw err
					}
				}

				case "core:outlet/link-lore-entries": {
					/**
					 * One link between two entries of this session's lorebook
					 * (L2, 2026-09-17) — a room's exit, who keeps what, what
					 * stands near what.
					 *
					 * The same session scoping, the same lorebook and the same
					 * `writes.lore` refusal as the entry write beside it: a
					 * link is a change to the book, so a genre whose lorebook
					 * is a *reference* writes none, whatever spec is bound
					 * here. Stated at the write rather than by hiding the
					 * affordance, because the affordance is not what a
					 * user-attached pipeline goes through.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to link lore in — the run was started without a session scope`
						)

					// The genre's declared writes refuse; what the session may
					// not write to its book links in its own notes instead
					// (🚧 PLAN-rulesets §26) — both ends found there.
					const noLore = await loreWriteRefusal(db, sessionId)
					if (noLore) throw forPeople(new HostScopeError(`${node.key}: ${noLore}`), noLore)
					// 🚧 `sources` present: a generated write (pass 6).
					const checked =
						p.sources !== undefined
							? await checkLoreSources(db, scope, node.key, p.sources)
							: null
					const noted = checked?.notes.length ? { notes: checked.notes } : {}

					const target = await sessionLoreWriteTo(db, sessionId, turnMessageId)
					const lorebookId = target.lorebookId
					// 🚧 On the `book` route, a row waiting in the notes can be an end.
					const notes = await notesBesideBook(db, sessionId, turnMessageId, target)
					// 🚧 RF fix 4: a link this write made is imprinted with it.
					const turnAnchor = await imprintAnchor(sessionId)
					const anchor = turnAnchor ?? linkAnchorOf(sessionId, null, target)
					const notesAnchor =
						turnAnchor ??
						(notes
							? linkAnchorOf(sessionId, null, { line: notes.line, sourceMessageId: notes.sourceMessageId })
							: null)
					const { imprintMade } = await import("$lib/server/lorebooks/imprints")
					// Both ends under the book's own lock, for the reason the
					// entry write takes it: an end resolved by name must not be
					// renumbered or renamed out from under the insert — and the
					// standing-row lookup must not race a second run's insert.
					let settled: Awaited<ReturnType<typeof settleThrough>> | null = null
					const { fromId, link, bookId } = await db.transaction(
						async (tx) => {
							await tx.execute(
								sql`select pg_advisory_xact_lock(${lorebookId})`
							)
							// 🚧 An end that answers to exactly one seen notes row is the notes':
							// the link is written there, and the line forks nothing.
							const notesFrom = notes ? await notesRowAnswering(tx as unknown as Db, notes, p.from) : null
							const notesTo = notes ? await notesRowAnswering(tx as unknown as Db, notes, p.to) : null
							const inNotes = notes !== null && (notesFrom !== null || notesTo !== null)
							if (inNotes) await tx.execute(sql`select pg_advisory_xact_lock(${notes.lorebookId})`)
							const line = inNotes ? notes.line : await forkedLoreLine(tx as unknown as Db, sessionId, target)
							const bookId = inNotes ? notes.lorebookId : lorebookId
							const endOf = (raw: unknown, known: number | null) =>
								known !== null
									? Promise.resolve(known)
									: resolveLoreLinkEnd(tx, lorebookId, raw, node.key, target.line.reading)
							const from = inNotes
								? await endOf(p.from, notesFrom)
								: await resolveLoreLinkEnd(
										tx,
										lorebookId,
										p.from,
										node.key,
										line.reading,
										"link",
										undefined,
										line.alsoReads
									)
							const to = inNotes ? await endOf(p.to, notesTo) : p.to
							const wrote = await writeLoreLink(
								tx,
								bookId,
								from,
								{
									to,
									linkType: p.params?.linkType,
									reverseLinkType: p.params?.reverseLinkType,
									name: p.name,
									description: p.description
								},
								node.key,
								line
							)
							const madeAnchor = inNotes ? notesAnchor : anchor
							if (madeAnchor && wrote.written)
								await imprintMade(tx as unknown as Db, madeAnchor, {
									lorebookId: bookId,
									subject: "relationship",
									subjectId: wrote.id
								})
							if (checked) {
								if (wrote.written)
									await recordLoreSources(tx as unknown as Db, {
										sessionId,
										runId: scope.runId ?? null,
										lorebookId: bookId,
										subjectKind: "relationship",
										subjectId: wrote.id,
										ids: checked.ids
									})
								// 🚧 (sense-b4) A session whose scenes end by themselves does not settle by `sources`.
								if (!target.scenesEndByThemselves)
									settled = await settleThrough(
										tx as unknown as Db,
										sessionId,
										Math.max(...checked.ids),
										{ runId: scope.runId, userId: scope.userId }
									)
							}
							return { fromId: from, link: wrote, bookId }
						}
					)
					await announceSettled(sessionId, settled)
					/**
					 * Idempotent (places plan B2): a link the session already
					 * reads answers with the standing row's id, and it is not
					 * this run's — no artifact (an undo must never delete it)
					 * and `written: false`, so the executor causes no
					 * `lore-link-created`: nothing was linked. `fromEntryId` is
					 * the row's own: on a mirror, the far end.
					 */
					if (!link.written)
						return {
							id: link.id,
							fromEntryId: link.fromEntryId,
							lorebookId: link.lorebookId ?? bookId,
							written: false,
							...noted
						}
					record(node, "lore_link", link.id, "created")
					return { id: link.id, fromEntryId: fromId, lorebookId: bookId, ...noted }
				}

				case "core:outlet/note-entry-knowledge": {
					/**
					 * 🚧 **Note who knows an entry** (kn-4b): one cast member came
					 * to know one entry in play, or stops knowing it — a knowledge
					 * tie of play's kinds, gated by `writes.lore`, routed like a
					 * link, taken back with its reply. The write is
					 * `noteEntryKnowledgeWrite`'s; no run artifact kind is kept.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to note knowledge in — the run was started without a session scope`
						)
					const kind = p.params?.knowledgeKind ?? "was_told"
					// Play writes only its own two kinds; a hand kind is the lorebook owner's.
					if (kind !== "was_told" && kind !== "has_been_there")
						throw new HostScopeError(
							`${node.key}: a pipeline notes only 'was_told' or 'has_been_there', not '${String(kind)}'.`
						)
					const noLore = await loreWriteRefusal(db, sessionId)
					if (noLore) throw forPeople(new HostScopeError(`${node.key}: ${noLore}`), noLore)
					const target = await sessionLoreWriteTo(db, sessionId, turnMessageId)
					const notes = await notesBesideBook(db, sessionId, turnMessageId, target)
					const turnAnchor = await imprintAnchor(sessionId)
					const anchor = turnAnchor ?? linkAnchorOf(sessionId, null, target)
					const notesAnchor =
						turnAnchor ??
						(notes
							? linkAnchorOf(sessionId, null, { line: notes.line, sourceMessageId: notes.sourceMessageId })
							: anchor)
					const { noteEntryKnowledgeWrite } = await import("./host.loreWrites")
					const out = await noteEntryKnowledgeWrite(db, {
						sessionId,
						nodeKey: node.key,
						member: p.member,
						entry: p.entry,
						kind,
						end: p.params?.end === true,
						target,
						notes,
						anchor,
						notesAnchor
					})
					lorebookReads.clear()
					return out
				}

				case "core:outlet/graph-proposal": {
					/**
					 * A proposal, and deliberately nothing more.
					 *
					 * The build stops here. Applying it is a person's decision on
					 * the Review Proposal screen, and this returning a proposal id
					 * rather than node ids is what makes that structural: nothing
					 * downstream can mistake it for rows that exist.
					 */
					const sessionId = scope.sessionId
					if (sessionId === undefined)
						throw new HostScopeError(
							`${node.key} has no session to propose graph changes for`
						)
					/**
					 * 🚧 A Story sweep's ties (lane 2, 2026-10-19): a list of
					 * `{ from, to, how }`, by name — filed on the lorebook's
					 * Graph review screen, the same review a build's proposal
					 * waits in. What could not be placed is said, never dropped.
					 */
					if (Array.isArray(p.proposal)) {
						const { fileSweptRelationships } = await import(
							"$lib/server/sessions/sweptRelationships"
						)
						const filed = await fileSweptRelationships(db, sessionId, p.proposal)
						return {
							status: filed.filed > 0 ? "proposed" : "skipped",
							sessionId,
							filed: filed.filed,
							...(filed.activityId ? { activityId: filed.activityId } : {}),
							...(filed.skipped.length ? { skipped: filed.skipped } : {})
						}
					}
					// 🚧 `sources` present: checked, and the span said back —
					// nothing is recorded until a person applies the proposal.
					const checked =
						p.sources !== undefined
							? await checkLoreSources(db, scope, node.key, p.sources)
							: null
					return {
						status: "proposed",
						sessionId,
						proposal: p.proposal ?? null,
						...(checked
							? {
									loreSources: {
										fromMessageId: Math.min(...checked.ids),
										throughMessageId: Math.max(...checked.ids)
									},
									...(checked.notes.length ? { notes: checked.notes } : {})
								}
							: {})
					}
				}

				/**
				 * ⚠ `embedding_status` is a **read**, not a commit. It is answered
				 * by the `read` switch above — search for the other
				 * `case "embedding_status"` — and that is the block the four
				 * `ctx.read("embedding_status", …)` sites in `bindings.ts` reach.
				 *
				 * A second copy sat here until it was deleted, and it was
				 * unreachable: this switch is on `node.typeId`, whose labels are
				 * namespaced type ids, and no node definition is named
				 * `embedding_status`. Being unreachable, it was also free to be
				 * wrong, and was — it read a `localModel` column
				 * `vectorization_configs` has never had, which would have called
				 * every local-mode install unconfigured. Do not re-add it: the live
				 * block answers "is a backend loaded and validated *right now*",
				 * and deriving that from configuration instead would report
				 * available on a configured-but-cold install while
				 * `core:oracle/embed-text` still throws.
				 */
				default:
					throw new HostScopeError(
						`${node.key} (${node.definitionId}) has no commit path in core. A Consumer that core ` +
							`cannot perform is one a user could add to a pipeline and watch fail at run time.`
					)
			}
		}
	}

	/**
	 * No failed query's text leaves the host (`db/errors.ts`).
	 *
	 * The executor keeps only a thrown error's `message`, and that message
	 * becomes the node's reason, the run's `haltReason`, the reply row's error
	 * (`LiveRow` → `persistGenerationErrorRow`, shown to every member of the
	 * session), a `reply-failed` notification and a plugin binding's view of
	 * the failure. Since drizzle-orm 0.44 a failed query's message is its SQL
	 * and every value it bound, so a query that fails under `read`, `call` or
	 * `commit` leaves here as the plain sentence (a wrapper's own words kept),
	 * and the whole error goes to the server log. Every other error passes
	 * through as the same object, so no class a caller checks is lost.
	 *
	 * The generate road records the raw error on the live row BEFORE this
	 * (`scope.live?.failedWith`), so the row's error write still reads the
	 * class — `friendlyErrorFromUnknown` answers a failed query itself.
	 */
	const plain = (e: unknown, node: NodeRef): unknown => {
		const safe = errorWithoutQueryText(e)
		if (safe !== e)
			console.error(
				`[pipelines] ${node.key} (${node.definitionId}): a query failed; the run reads the plain sentence. It was:`,
				e
			)
		return safe
	}
	// A halt marked for people (`forPeople`) is recorded under the run before
	// `plain` passes it on, so the run's receipt can carry its sentence
	// (`takePeopleSentence`, `runSpec`); the thrown or returned words are unchanged.
	const notedPlain = (e: unknown, node: NodeRef): unknown => {
		const sentence = peopleSentenceOf(e)
		if (sentence !== undefined && e instanceof Error)
			notePeopleHalt(scope.runId, e.message, sentence)
		return plain(e, node)
	}
	const { read, call, commit } = host
	host.read = async (table, query, node) => {
		try {
			return await read!.call(host, table, query, node)
		} catch (e) {
			throw notedPlain(e, node)
		}
	}
	host.call = async (payload, node, run, handles) => {
		enterHostWrite()
		try {
			// `handles` forwarded: dropping them here would cut every
			// request off from its node's clock (`callTether`).
			return await call!.call(host, payload, node, run, handles)
		} catch (e) {
			throw notedPlain(e, node)
		} finally {
			leaveHostWrite()
		}
	}
	host.commit = async (payload, node) => {
		enterHostWrite()
		try {
			const r = await commit!.call(host, payload, node)
			const sentence = peopleSentenceOf(r)
			const halt = (r as { halt?: unknown } | null)?.halt
			if (sentence !== undefined && typeof halt === "string")
				notePeopleHalt(scope.runId, halt, sentence)
			return r
		} catch (e) {
			throw notedPlain(e, node)
		} finally {
			leaveHostWrite()
		}
	}
	return host
}
