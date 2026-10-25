/**
 * The three writers, and the one gate.
 *
 * | Writer | Path | Applied |
 * |---|---|---|
 * | User | a widget edit, over `state:*` | immediately, `updated_by = 'user'` |
 * | Script | `core:task/set-state@1` in `apply` mode | immediately, `updated_by = 'run:<id>'` |
 * | Model | a tool call, or the same node in `propose` mode | **held** as a `state_proposals` row until somebody accepts it |
 *
 * A model has no authority of its own and that is deliberate: a model that
 * could set a number silently can rewrite the fiction between two messages with
 * nothing a player can refuse. Accepting a proposal runs the *same* write the
 * script writer makes, which is why `applyChange` is one function and not three.
 *
 * ## One gate, and its phases are fixed
 *
 * Nothing writes a row without passing `applyChangeSet` (R11). A script, a
 * hook, a tool and a frame all hand it `changes`; there is no second door, and
 * a rule that wrote a value itself would be one. The order is not
 * user-reorderable:
 *
 *  1. **Rules** — each slot's own Liquid `when` / `set|add|remove`, evaluated
 *     once per change set against the state *before* it plus the changes
 *     coming in. One pass: a rule never sees another rule's output, because
 *     two rules that could chain have an order nobody wrote down.
 *  2. **Validation and the turn lock** — the declaration's own answer about the
 *     value, and whether the reply it would be filed against is still open.
 *  3. **Apply, or propose** — one row, or one held line.
 *
 * ## Every write is an append, and every write is anchored
 *
 * Nothing here updates a row in place. A change is a new row with a higher
 * `valid_from_message_id`, so the value in force is a question of ordering and
 * the history is not destroyed by the next edit. Anchoring is what makes swipe
 * and regenerate honest without receipts: replacing message 47 retracts what
 * message 47 changed, and the new reply proposes its own
 * (`retractStateAnchoredTo`).
 *
 * 🚧 **What a message changed goes with it** (RF fix 4, 2026-10-23,
 * NOMENCLATURE §24): the same anchor carries everything a run writes — these
 * rows, the zone snapshots (`zone_contents`), and what it wrote on a lorebook
 * (a **lore imprint** each, `lorebooks/imprints.ts`: an entry's field, a
 * tie's words on its row, a cast member's state, the notes' rule-fed
 * overlay, a room or a link it filed). A swipe, a regenerate, a delete and a
 * failed reply take all of it back by one rule; a shared book only while it
 * is still exactly as the run left it.
 *
 * ## The turn lock (R9)
 *
 * A change to a cast member anchors to **that character's latest message** and
 * stays open until that character speaks again, whatever anybody else says in
 * between; the world follows the same rule against the newest message in the
 * session, whoever wrote it. The rule itself is the SDK's (`openAnchorFor`,
 * `isAnchorOpen`) because the client draws sealed ledgers from it and a plugin
 * proposing a change has to know whether it can land — three parties, one
 * answer. `anchorFor` is where this file enforces it, and it is the only place
 * an anchor is resolved: the five inline resolutions that stood here were five
 * chances for one of them to forget.
 *
 * Author-layer edits (`card`, `cast_member`, `lorebook`) are **not** locked.
 * Authoring is not play.
 *
 * ## The state version (plans/29 R-15 *Staleness and order*; 30 §U5f)
 *
 * `sessions.state_version` moves by one for every row `setValue` writes —
 * inside the write's transaction, under
 * `pg_advisory_xact_lock(hashtext('stateVersion'), sessionId)`, the idiom
 * `nextLane` uses — and the new number is stamped on the row. So the version
 * IS turn order: two writers landing together get two numbers, never one.
 *
 * A change made against a state that has since moved is a **delta against a
 * base**: `StateChange.base` names the version the writer read, a proposal
 * keeps it as `base_version`. At the write (`applyChange`) and at the accept
 * (`decideProposal`) the delta is **rebased** — the slot it targets is looked
 * up, and the version its in-force row landed at compared with the base. An
 * untouched slot (landed ≤ base) still holds, and the change applies; a slot
 * that moved is refused with the versions named (`applyChange`) or the
 * proposal is marked `superseded` with nothing applied (`decideProposal`).
 * One rule for "values changed out of order", and the same rule as a form's
 * channel head (`messages/channels.ts` · `fireAction`).
 *
 * ⚠ **The base check, the read of the current value, and the write are one
 * locked transaction.** `setValue` takes the lock first
 * (`lockStateVersion`), then judges the base (`movedSinceBase`), then reads
 * what is there now (`nextValue` — an inventory `remove` of the last key
 * reads what is held under it), then bumps and inserts —
 * `decideProposal` judges, applies and marks under the same lock, with the
 * proposal's status read again under it. A check or a read made ahead
 * of the lock is made by two writers before either lands: two applies with
 * one base both pass, two deltas both read the same "current" and one is
 * lost. The reads that stay outside — the owner, the config, the anchor —
 * are not what the version guards. And `stateFor` reads the version FIRST,
 * before any value: a base older than the state a run saw is refused on the
 * safe side; one newer than it would wave a stale delta through.
 *
 * ## Two sources of rows, not one (R8)
 *
 * A session-layer row is per change, message-anchored, and cascades with its
 * session. A **durable** row is written to the timeline — `history_entry_id`,
 * `scene_id`, and provenance ints with no keys — and outlives the session that
 * produced it. `durable.ts` writes those; this file fills the columns from the
 * `WriteContext` whichever path asked, so a recorded row and a live one are the
 * same insert with different anchors rather than two writers.
 */

import { and, asc, desc, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm"
import { liveMessageWhere } from "$lib/server/messages/store"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import {
	applyListOp,
	checkSlotValue,
	getAttributeSlot,
	i18nText,
	isAnchorOpen,
	isSlotLoreRef,
	isSlotPiece,
	openAnchorFor,
	parseStoryTime,
	resolveSlotConfig,
	slotAppliesTo,
	type SlotChangeOp,
	type SlotConfig,
	type SlotRule,
	type SlotListItem,
	type SlotValue,
	slotField,
	slotValueForStorage,
	statConfigRefusals,
	type TurnMessage,
	type TurnOwner
} from "@serene-pub/sdk"
import {
	configFor,
	isSessionScoped,
	qualifiedSlotKey,
	slotKey,
	stateFor,
	stateVersionOf,
	valueOf,
	vocabularyFor,
	sessionLorebookIds,
	nameLoreRefs,
	type CastEntry
} from "$lib/server/state/resolve"
import {
	createExpressionBudget,
	evaluate,
	isRefusal,
	type ExpressionBudget,
	type ExpressionScope
} from "$lib/server/state/expressions"
import {
	isOwnerKind,
	ownerFacet,
	type OwnerKind,
	type StateOwner
} from "$lib/server/state/owners"
import { castMemberKey, locationOwnerKey } from "$lib/server/state/keys"
import { carries } from "$lib/server/state/carries"
import { isCardlessPlayerSeat } from "$lib/server/sessions/seatName"
import { sessionReadingOf, writeDatingAt } from "$lib/server/state/reading"
import {
	advanceSessionStoryClock,
	bookCalendarOf,
	StoryClockRefusal
} from "$lib/server/state/storyTime"
import { dateProblem, type StoryTimeUnit } from "$lib/shared/lorebooks/storyDate"
import { sessionLoreWriteMode } from "$lib/server/state/loreWriteMode"
import { lorebooksReadBy } from "$lib/server/lorebooks/ownBook"
import {
	LORE_WRITES_OFF,
	type LoreWriteMode
} from "$lib/shared/lorebooks/loreWriteMode"
import {
	MAIN_HEAD,
	entryAt,
	entryOnLineSql,
	entryOverlaysFor,
	placesOnReading,
	sessionEntryNamed
} from "$lib/server/state/entriesOnReading"
import { unseenSentence, whyUnseen } from "$lib/shared/lorebooks/placeSight"
import { tieSentence } from "$lib/shared/lorebooks/describingRow"
import { declaresPrivateLore } from "$lib/server/utils/lorebookEntries"

/** `user` · `run:<id>` · `script:<id>` · `session:<id>` — free text, and the ledger reads it. */
export type StateWriter = string

/**
 * An attribute change.
 *
 * `op` defaults to `set`, which is what every caller written before lists
 * existed meant. `add` and `remove` are the two a list needs — an inventory
 * nobody can add one item to without rewriting the line is an inventory that
 * gets rewritten wrongly — and `add` on an **integer** is a signed delta, so
 * "she loses one" is a change that two writers in one turn can both make
 * honestly (R18).
 */
export interface ValueChange {
	owner: StateOwner
	slotId: string
	/** `set`: the new value. `add` on an integer: the signed delta. */
	value?: SlotValue
	op?: SlotChangeOp
	/** `add`/`remove` on a list: the items going in or coming out — words or lore references. */
	items?: readonly SlotListItem[]
	/** Ledger narration / provenance, in a person's words. */
	note?: string
	/**
	 * The **state version** this change is a delta against (U5f) — what the
	 * writer read before it decided. Absent: against whatever is current.
	 * Never stored in a proposal's payload; it lands in `base_version`.
	 */
	base?: number | null
}

/**
 * The shape `core:task/set-state@1` takes on `changes`, that a `state_proposals`
 * payload holds, and that `applyChange` writes. One shape either side of the
 * gate — accepting a proposal must not be a second, differently-validated path.
 *
 * Phase 3b (2026-09-26): one arm. An item moving is an `add` / `remove` on the
 * owner's `inventory` list stat (`inventoryChange`); the possession arm
 * (`{ owner, entryId, delta }`) is retired and its edge table dropped
 * (2026-09-27).
 */
export type StateChange = ValueChange

/** Whether a payload is a change this gate writes — the retired possession arm is not. */
export const isValueChange = (c: unknown): c is ValueChange =>
	!!c && typeof (c as ValueChange).slotId === "string"

/**
 * 🚧 A **clock line** (live scenes §6, ★3; lane F, 2026-10-13): the
 * state-keeper asking to move the session's story clock FORWARD by `by` of
 * `unit` — what `core:query/resolve-state-changes@1` makes of the keeper's
 * `clock` list, and the payload of a `state_proposals` row of kind `clock` (a
 * **clock proposal**, `proposeClockChange`).
 *
 * Not a `StateChange`: it names no owner and no slot, never reaches the gate,
 * and is never applied by `set-state` — Accept advances the clock
 * (`decideProposal`), and a run that trusts the narrator moves it through
 * *Advance story clock*. ⚠ Not the world's *Time of day* stat, which is a
 * value like any other.
 *
 * 🚧 `skipped` (live scenes §15 G16): a well-formed ask the story cannot take
 * — no clock yet, a date the calendar cannot place — with why, in the
 * person's words. Never proposed and never moved: `set-state` writes it to
 * the ledger as a **skipped** clock row (`recordClockMove`), in either mode,
 * so the person reads *not on the clock* under the reply as a skipped
 * *Advance story clock* reads.
 */
export interface ClockChange {
	kind: "clock"
	by: number
	unit: StoryTimeUnit
	skipped?: string
}

/** Whether a change (or a proposal's payload) is a clock line. */
export const isClockChange = (c: unknown): c is ClockChange =>
	!!c && typeof c === "object" && (c as { kind?: unknown }).kind === "clock"

/** Refused for a reason a person can read. Callers turn it into their own refusal. */
export class StateRefusal extends Error {}

// ── Anchors ─────────────────────────────────────────────────────────────────

/**
 * The message a write is anchored to when the caller names none: the newest in
 * the session.
 *
 * ⚠ **Kept for the callers that genuinely mean "the newest message"** — a
 * retraction, a durable row's provenance — and not what a write anchors
 * to. A session-layer write anchors to the OWNER's open anchor, which is a
 * different message the moment two characters are talking; `anchorFor` is the
 * one that answers that.
 */
export async function newestMessageId(
	db: Db,
	sessionId: number
): Promise<number | null> {
	// 🚧 The live history only (RF fix 5): a rewound row is no anchor — a
	// write against it would go with the forward stack it belongs to. The
	// forward stack is on the legacy row (the new model mirrors its id).
	const rows = await db
		.select({ id: schema.messages.id })
		.from(schema.messages)
		.where(and(eq(schema.messages.sessionId, sessionId), liveMessageWhere(schema.messages.rewindOrdinal)))
		.orderBy(desc(schema.messages.id))
		.limit(1)
	return rows[0]?.id ?? null
}

/**
 * The session's messages, in session order, reduced to what the lock reads.
 *
 * ⚠ Ascending, and the SDK says why: `openAnchorFor` reads positions rather
 * than comparing ids, so a reversed list answers confidently and wrongly.
 *
 * Each row carries its **turn** — the run that created it
 * (`pipeline_run_artifacts`, `message` · `created`, never a preview) — so the
 * world's newest turn is open whole (lair pass R8: the Lair's world changes
 * file at its Sanctum beats row, and the party's rows follow it in the same
 * turn). A person's own line, and a row whose run is still in flight (its
 * artifacts are recorded when it ends), carries none.
 *
 * 🚧 A planned turn's row (`metadata.planRowId`, Lair character turns) is
 * its plan row's turn: each delver's line is a run of its own, and the
 * world's changes filed at the plan row stay open while the party speak.
 */
export async function turnMessages(
	db: Db,
	sessionId: number
): Promise<TurnMessage[]> {
	const rows = await db
		.select({
			id: schema.messages.id,
			characterId: schema.messages.characterId,
			personaId: schema.messages.personaId
		})
		.from(schema.messages)
		.where(
			and(
				eq(schema.messages.sessionId, sessionId),
				// 🚧 The live history only (RF fix 5): a rewound row never
				// holds an anchor open, nor seals one.
				liveMessageWhere(schema.messages.rewindOrdinal)
			)
		)
		.orderBy(asc(schema.messages.id))
	const created = rows.length
		? await db
				.select({
					entityId: schema.pipelineRunArtifacts.entityId,
					runId: schema.pipelineRunArtifacts.runId
				})
				.from(schema.pipelineRunArtifacts)
				.innerJoin(
					schema.pipelineRuns,
					eq(schema.pipelineRuns.id, schema.pipelineRunArtifacts.runId)
				)
				.where(
					and(
						eq(schema.pipelineRuns.sessionId, sessionId),
						eq(schema.pipelineRuns.isPreview, false),
						eq(schema.pipelineRunArtifacts.kind, "message"),
						eq(schema.pipelineRunArtifacts.action, "created")
					)
				)
		: []
	const turnOf = new Map(created.map((a) => [a.entityId, a.runId]))
	const planned = rows.length
		? await db
				.select({
					id: schema.sessionMessages.id,
					planRowId: sql<string>`${schema.sessionMessages.metadata}->>'planRowId'`
				})
				.from(schema.sessionMessages)
				.where(
					and(
						eq(schema.sessionMessages.sessionId, sessionId),
						sql`${schema.sessionMessages.metadata}->>'planRowId' is not null`
					)
				)
		: []
	const planOf = new Map(planned.map((p) => [p.id, Number(p.planRowId)]))
	// A persona is a character, so the player's own turns lock on exactly the
	// terms everybody else's do (R9).
	return rows.map((r) => ({
		id: r.id,
		speakerId: r.characterId ?? r.personaId ?? null,
		turn: turnOf.get(planOf.get(r.id) ?? r.id) ?? null
	}))
}

/**
 * The lorebook's own durable layer — its values, its cast members', its
 * places' (plan A22). A session writing one of these is writing the BOOK,
 * which is what the lore write mode governs and what lands on the session's
 * line and dating. ⚠ Not `card`: a card's layer is its owner's, not a book's.
 */
export const isBookLayer = (kind: OwnerKind): boolean =>
	kind === "lorebook" || kind === "cast_member" || kind === "location"

/**
 * Where a session's write to the book lands (plan A22, ruled 2026-09-30):
 * the session's LINE, and the dating `writeDatingAt` gives its reading —
 * the latest history entry on that line at or before its story now (its own
 * clock, else its line's present — `sessionReadingOf`). The caller's own when it carries them
 * (`WriteContext.branchId` set): an accepted proposal lands where it was
 * made, and a recording names its scene's history entry. Nothing for a
 * session-layer owner, which has no line of its own.
 */
async function bookWritePlace(
	db: Db,
	ctx: WriteContext,
	owner: StateOwner
): Promise<{ branchId?: number | null; historyEntryId?: number | null }> {
	if (!isBookLayer(owner.kind)) return {}
	if (ctx.branchId !== undefined)
		return {
			branchId: ctx.branchId,
			historyEntryId: ctx.historyEntryId ?? null
		}
	const reading = await sessionReadingOf(db, ctx.sessionId)
	if (!reading) return { branchId: null, historyEntryId: null }
	return {
		branchId: reading.branchId,
		historyEntryId:
			(await writeDatingAt(db, reading))?.historyEntryId ?? null
	}
}

/**
 * Refuse a write to the book under **Off** (plan A22): the book owner's
 * lore write mode, asked for every session-originated write of a book layer
 * — a person's own edit, an Accept, a run's apply or propose. Review
 * changes is not refused here: what a person does by hand IS the review, and
 * a run's apply is routed to a proposal before it gets this far
 * (`applyAutomatic`).
 */
async function assertBookWritesOn(
	db: Db,
	sessionId: number,
	owner: StateOwner
): Promise<void> {
	if (!isBookLayer(owner.kind)) return
	if ((await sessionLoreWriteMode(db, sessionId)) === "off")
		throw new StateRefusal(LORE_WRITES_OFF)
}

/**
 * Whose turn a write's anchor follows. A place (phase 4) moves on every turn
 * as the world does — nobody speaks for it — so it anchors like the world.
 */
const turnOwnerOf = (owner: StateOwner, sessionId: number): TurnOwner =>
	owner.kind === "session_cast"
		? { kind: "session_cast", id: owner.id }
		: { kind: "session", id: sessionId }

/**
 * The anchor this write gets, or the refusal saying the reply is sealed.
 *
 * The **one** place an anchor is decided. Three cases, and the middle one is
 * the whole of R9:
 *
 *  · The caller named no message → the owner's open anchor, which is that
 *    character's latest reply (or the session's newest message, for the world).
 *    `null` when they have not spoken yet, and `null` is open — a cast member
 *    who has just joined has to be writable or their opening state could never
 *    be set.
 *  · The caller named one and it is still open → that one.
 *  · The caller named one and it is not → refused, by name, with what to do
 *    instead. That is the case a swipe, a late tool call and a re-accepted
 *    proposal all land in.
 *
 * Author layers are never locked: a `card`, a `cast_member` or a `lorebook` row
 * is authoring, and authoring has no turn to be after.
 */
export async function anchorFor(
	db: Db,
	ctx: WriteContext,
	owner: StateOwner,
	messages?: TurnMessage[]
): Promise<number | null> {
	if (!isSessionScoped(owner.kind)) return null
	const tail = messages ?? (await turnMessages(db, ctx.sessionId))
	const turnOwner = turnOwnerOf(owner, ctx.sessionId)
	if (ctx.messageId === undefined) return openAnchorFor(tail, turnOwner)
	if (ctx.ownAnchor && turnOwner.kind === "session" && ctx.messageId !== null)
		return ctx.messageId
	if (isAnchorOpen(tail, turnOwner, ctx.messageId ?? null))
		return ctx.messageId ?? null
	throw new StateRefusal(
		`that reply is sealed: ${await sealerName(db, tail, turnOwner)} has spoken ` +
			`since. Edit their latest reply instead.`
	)
}

/**
 * Whose speaking sealed the anchor — the name the refusal puts in front.
 *
 * For a cast owner it is that character; for the world it is whoever wrote the
 * newest message, because the world moves on every turn and "somebody" is the
 * honest answer when that message had no speaker at all.
 */
async function sealerName(
	db: Db,
	messages: TurnMessage[],
	owner: TurnOwner
): Promise<string> {
	const anchor = openAnchorFor(messages, owner)
	const speakerId =
		owner.kind === "session_cast"
			? owner.id
			: (messages.find((m) => m.id === anchor)?.speakerId ?? null)
	if (typeof speakerId !== "number") return "someone"
	const [row] = await db
		.select({ name: schema.characters.name })
		.from(schema.characters)
		.where(eq(schema.characters.id, speakerId))
		.limit(1)
	return row?.name || "someone"
}

/**
 * Take back everything one message changed — the one retraction rule,
 * **what a message changed goes with it** (RF fix 4, 2026-10-23,
 * NOMENCLATURE §24).
 *
 * ⚠ **Called on REPLACEMENT** (a swipe, a regenerate, a reply that failed
 * empty). A swipe or a regenerate keeps the row and its id and replaces only
 * the text: nothing is deleted, so nothing cascades, and what the old reply
 * wrote would otherwise survive the reply itself. A **delete** takes the
 * same things back by its own road — the `messages.id` cascade for every
 * keyed anchor, and `retractLoreAnchoredTo` (`messages/store.ts`) inside the
 * delete's transaction for the plain-int ones — so the two behave the same.
 *
 * What goes, in one transaction:
 *
 *  · the **values**, **configurations** and **proposals** anchored to it;
 *  · 🚧 **the clock** (live scenes §15 G5, 2026-10-13): the moves this
 *    message carried — the keeper's under Trust the narrator, an accepted
 *    clock proposal, a *Time passes…* filed against it — are taken back by
 *    their steps before their rows go (`revertClockMovesAnchoredTo`). A
 *    reply's **tick** stays, row and move: the re-driven reply never ticks
 *    again. Throws `StoryClockRefusal` with the sentence, and takes nothing
 *    back, when the calendar cannot place a step back;
 *  · 🚧 the **zone snapshots** anchored to it (`zone_contents`), so the row
 *    before shows through, as a delete's cascade does;
 *  · 🚧 what it wrote on a **lorebook** (`retractLoreAnchoredTo`): its lore
 *    imprints by the one rule — the session's notes always revert, a real
 *    book only while the field is still exactly as the run left it, else it
 *    stays and says so (`lorebooks/imprints.ts`) — then the notes' entries
 *    anchored to it (`source_message_id`) that carry no imprint.
 *
 * ⚠ A message **edit** (its prose) calls nothing here: what a reply changed
 * is its own block, kept or undone there, never by rewording the text.
 *
 * `clockMoved`: the session's clock moved back, for the caller to announce.
 * 🚧 `changed` (live scenes §15 G14): anything at all was taken back, so the
 * caller broadcasts `state:changed` once this has committed, as an outlet's
 * write does; a reply that changed nothing announces nothing.
 */
export async function retractStateAnchoredTo(
	db: Db,
	messageId: number,
	/**
	 * 🚧 `ticks: 'take'` (RF fix 5, **Back**): the message leaves the
	 * history, so its reply's tick goes too, row and move, as a delete's
	 * does — and comes back with the rest on **Forward**
	 * (`restoreRetractedState` steps the clock forward by each move taken).
	 * Absent: a replacement's rule above, the tick stands.
	 *
	 * 🚧 `scenes: 'take'` (pr-6 C9, **Back**): the scene boundaries anchored
	 * to the message go too — a scene opened at it, a close at it, its place
	 * in a selection (`takeSceneBoundariesAt`) — and come back on Forward.
	 * Absent: a replacement keeps every boundary where it is.
	 *
	 * 🚧 `annex: 'keep'` (pr-6, a **swipe**): the turn is told again from what
	 * it decided, so what it wrote in the annex stands — a swipe re-tells,
	 * never re-plans (Dungeon Crawler, ruled 2026-10-17). Absent: every annex
	 * delta anchored to the message is taken.
	 */
	opts: { ticks?: "keep" | "take"; scenes?: "keep" | "take"; annex?: "keep" | "take" } = {}
): Promise<{ clockMoved: boolean; changed: boolean; taken: RetractedState }> {
	// 🚧 The settle line (pr-6 B4): nothing at or before it is taken back —
	// throws `SettledRefusal` with the sentence, before anything is written.
	const { assertRetractable } = await import("$lib/server/sessions/settle")
	await assertRetractable(db, messageId)
	const { notATickSql, revertClockMovesAnchoredTo } = await import(
		"$lib/server/state/clockMoves"
	)
	const { retractAnnexDeltasAnchoredTo } = await import("$lib/server/sessions/annexChanges")
	const { takeSceneBoundariesAt } = await import("$lib/server/scenes/liveScenes")
	const takeTicks = opts.ticks === "take"
	return await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const { sessionIds } = await revertClockMovesAnchoredTo(
			t,
			[messageId],
			takeTicks ? {} : { keepTicks: true }
		)
		const values = await t
			.delete(schema.attributeValues)
			.where(eq(schema.attributeValues.validFromMessageId, messageId))
			.returning()
		const configs = await t
			.delete(schema.attributeConfigs)
			.where(eq(schema.attributeConfigs.validFromMessageId, messageId))
			.returning()
		const proposals = await t
			.delete(schema.stateProposals)
			.where(
				takeTicks
					? eq(schema.stateProposals.messageId, messageId)
					: and(eq(schema.stateProposals.messageId, messageId), notATickSql)
			)
			.returning()
		const zones = await t
			.delete(schema.zoneContents)
			.where(eq(schema.zoneContents.validFromMessageId, messageId))
			.returning()
		// 🚧 The annex deltas anchored to it (pr-6 B5), and — on Back — its
		// scene boundaries (pr-6 C9).
		const annexDeltas = opts.annex === "keep" ? [] : await retractAnnexDeltasAnchoredTo(t, messageId)
		const scenes = opts.scenes === "take" ? await takeSceneBoundariesAt(t, messageId) : []
		const [message] = await t
			.select({ sessionId: schema.messages.sessionId })
			.from(schema.messages)
			.where(eq(schema.messages.id, messageId))
			.limit(1)
		const lore = message
			? await retractLoreAnchoredTo(t, message.sessionId, [messageId])
			: { imprints: [], ownBookEntries: [], changed: false }
		const clockMoved = sessionIds.length > 0
		return {
			clockMoved,
			changed:
				clockMoved ||
				values.length > 0 ||
				configs.length > 0 ||
				proposals.length > 0 ||
				zones.length > 0 ||
				annexDeltas.length > 0 ||
				scenes.length > 0 ||
				lore.changed,
			taken: {
				messageId,
				values,
				configs,
				proposals,
				zones,
				imprints: lore.imprints,
				ownBookEntries: lore.ownBookEntries,
				clockSessions: sessionIds,
				annexDeltas,
				scenes
			}
		}
	})
}

/**
 * 🚧 **What a message wrote on a lorebook, taken back** (RF fix 4): its lore
 * imprints by the one rule (`retractImprints`), then the session's notes'
 * entries anchored to it that no imprint covers (`source_message_id`, a
 * plain int — written before imprints were, or by a writer that files
 * none). The plain-int half of a retraction: `retractStateAnchoredTo` calls
 * it on a replacement, the message store's deletes inside their own
 * transaction (the cascade cannot reach a plain int). Hand it the `tx`.
 */
export async function retractLoreAnchoredTo(
	tx: Db,
	sessionId: number,
	messageIds: readonly number[]
): Promise<{
	imprints: import("$lib/server/lorebooks/imprints").TakenImprint[]
	ownBookEntries: (typeof schema.lorebookEntries.$inferSelect)[]
	changed: boolean
}> {
	if (!messageIds.length) return { imprints: [], ownBookEntries: [], changed: false }
	const { retractImprints, imprintsChanged } = await import("$lib/server/lorebooks/imprints")
	const { takeOwnBookEntriesAnchoredTo } = await import("$lib/server/lorebooks/ownBook")
	const imprints = await retractImprints(tx, { messageIds })
	const ownBookEntries = await takeOwnBookEntriesAnchoredTo(tx, sessionId, messageIds)
	return {
		imprints,
		ownBookEntries,
		changed: imprintsChanged(imprints) || ownBookEntries.length > 0
	}
}

/** What `retractStateAnchoredTo` took back, row for row — for `restoreRetractedState`. */
export interface RetractedState {
	messageId: number
	values: (typeof schema.attributeValues.$inferSelect)[]
	configs: (typeof schema.attributeConfigs.$inferSelect)[]
	proposals: (typeof schema.stateProposals.$inferSelect)[]
	/** 🚧 The zone snapshots anchored to it. */
	zones: (typeof schema.zoneContents.$inferSelect)[]
	/** 🚧 What became of each lore imprint (reverted, spliced, kept, unmade). */
	imprints: import("$lib/server/lorebooks/imprints").TakenImprint[]
	/** 🚧 The notes' entries anchored to it with no imprint, as they were. */
	ownBookEntries: (typeof schema.lorebookEntries.$inferSelect)[]
	/** The sessions whose own clock was stepped back. */
	clockSessions: number[]
	/** 🚧 The annex deltas anchored to it (pr-6 B5, `sessions/annexChanges.ts`). */
	annexDeltas: import("$lib/server/sessions/annexChanges").AnnexDeltaTaken[]
	/** 🚧 What Back did to the scene boundaries anchored to it, in the order taken (pr-6 C9). */
	scenes: import("$lib/server/scenes/liveScenes").SceneBoundaryTaken[]
}

/**
 * 🚧 What a retraction took, counted (RF fix 5): the deletion outlet's
 * `taken` port — the values, configurations, proposals, zone snapshots,
 * lore writes by what became of each (`reverted` · `spliced` · `kept` ·
 * `unmade` · `dropped`), the notes' entries, and whether the clock moved
 * back. Counts, never the rows: a listener learns what went, a receipt
 * stays small.
 */
export function takenSummaryOf(taken: RetractedState, clockMoved: boolean) {
	const imprints: Record<string, number> = {}
	for (const t of taken.imprints ?? []) imprints[t.act] = (imprints[t.act] ?? 0) + 1
	return {
		values: taken.values.length,
		configs: taken.configs.length,
		proposals: taken.proposals.length,
		zones: (taken.zones ?? []).length,
		imprints,
		notesEntries: (taken.ownBookEntries ?? []).length,
		annexDeltas: (taken.annexDeltas ?? []).length,
		scenes: (taken.scenes ?? []).length,
		clockMoved
	}
}

/**
 * 🚧 A `RetractedState` read back from JSON (RF fix 5: **Back** keeps what
 * it took on the rewound row, `session_messages.rewind_taken`, for
 * **Forward**): every timestamp column of every row it holds a `Date`
 * again, so the restore's inserts take them. Null for anything that is not
 * one. The lore imprints' own rows likewise; a made row's snapshot is
 * revived by its subject's insert (`withDates`).
 */
export function reviveRetractedState(raw: unknown): RetractedState | null {
	if (!raw || typeof raw !== "object") return null
	const r = raw as Record<string, unknown>
	if (typeof r.messageId !== "number") return null
	const list = (v: unknown) => (Array.isArray(v) ? v : [])
	const rows = <T>(table: Parameters<typeof getTableColumns>[0], v: unknown): T[] =>
		list(v).map((row) => reviveDates(table, row)) as T[]
	const imprintRow = (row: unknown) => reviveDates(schema.loreImprints, row)
	return {
		messageId: r.messageId,
		values: rows(schema.attributeValues, r.values),
		configs: rows(schema.attributeConfigs, r.configs),
		proposals: rows(schema.stateProposals, r.proposals),
		zones: rows(schema.zoneContents, r.zones),
		ownBookEntries: rows(schema.lorebookEntries, r.ownBookEntries),
		imprints: list(r.imprints).map((t) => {
			const taken = { ...(t as Record<string, unknown>) }
			taken.imprint = imprintRow(taken.imprint)
			if (Array.isArray(taken.orphans)) taken.orphans = taken.orphans.map(imprintRow)
			return taken
		}) as RetractedState["imprints"],
		clockSessions: list(r.clockSessions).filter((n): n is number => typeof n === "number"),
		// 🚧 pr-6: absent on a record written before them.
		annexDeltas: list(r.annexDeltas).map((d) => {
			const taken = { ...(d as Record<string, unknown>) }
			taken.row = reviveDates(schema.annexDeltas, taken.row)
			return taken
		}) as unknown as RetractedState["annexDeltas"],
		scenes: list(r.scenes).map((d) => {
			const taken = { ...(d as Record<string, unknown>) }
			taken.row = reviveDates(schema.scenes, taken.row)
			return taken
		}) as unknown as RetractedState["scenes"]
	}
}

/** One row read back from JSON: its timestamp columns `Date`s again. */
export function reviveDates(table: Parameters<typeof getTableColumns>[0], row: unknown): Record<string, unknown> {
	if (!row || typeof row !== "object") return {}
	const out = { ...(row as Record<string, unknown>) }
	for (const [key, column] of Object.entries(getTableColumns(table))) {
		const v = out[key]
		if ((column as { dataType?: string }).dataType === "date" && typeof v === "string") out[key] = new Date(v)
	}
	return out
}

/**
 * 🚧 **Put back what a retraction took** (2026-10-16 walk): a swipe takes
 * back the world its reply changed before the run that replaces it — and a
 * run that then fails (halts empty, errors) replaced nothing, so the world
 * goes back as it was before the swipe. Whatever the failed run itself
 * anchored to the message is taken back first (a Dungeon Crawler swipe
 * re-applies its stored plan before the Narrator's call), then the rows the
 * retraction took go back, ids and all — values, configurations,
 * proposals, 🚧 zone snapshots, the notes' entries and every lore imprint
 * as it stood (RF fix 4) — and the clock steps forward again by each move
 * it was stepped back by. Returns whether anything changed.
 */
export async function restoreRetractedState(db: Db, taken: RetractedState): Promise<boolean> {
	const undone = await retractStateAnchoredTo(db, taken.messageId)
	const zones = taken.zones ?? []
	const imprints = taken.imprints ?? []
	const ownBookEntries = taken.ownBookEntries ?? []
	const annexDeltas = taken.annexDeltas ?? []
	const scenes = taken.scenes ?? []
	if (
		!taken.values.length &&
		!taken.configs.length &&
		!taken.proposals.length &&
		!zones.length &&
		!imprints.length &&
		!ownBookEntries.length &&
		!annexDeltas.length &&
		!scenes.length
	)
		return undone.changed
	await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		if (taken.configs.length) await t.insert(schema.attributeConfigs).values(taken.configs as any)
		if (taken.values.length) await t.insert(schema.attributeValues).values(taken.values as any)
		if (taken.proposals.length) await t.insert(schema.stateProposals).values(taken.proposals as any)
		if (zones.length) await t.insert(schema.zoneContents).values(zones as any)
		if (ownBookEntries.length) await t.insert(schema.lorebookEntries).values(ownBookEntries as any)
		if (imprints.length) {
			const { restoreImprints } = await import("$lib/server/lorebooks/imprints")
			await restoreImprints(t, imprints)
		}
		// 🚧 pr-6: the annex deltas (B5), then the scene boundaries (C9).
		if (annexDeltas.length) {
			const { restoreAnnexDeltas } = await import("$lib/server/sessions/annexChanges")
			await restoreAnnexDeltas(t, annexDeltas)
		}
		if (scenes.length) {
			const { restoreSceneBoundaries } = await import("$lib/server/scenes/liveScenes")
			await restoreSceneBoundaries(t, scenes)
		}
	})
	if (!taken.clockSessions.length) return true
	// The clock, forward again by each move it was stepped back by.
	const { advanceSessionStoryClock } = await import("$lib/server/state/storyTime")
	for (const move of taken.proposals) {
		if (move.kind !== "clock" || !taken.clockSessions.includes(move.sessionId)) continue
		if (move.status !== "applied" && move.status !== "accepted") continue
		const step = (move.payload ?? {}) as { by?: unknown; unit?: unknown }
		if (typeof step.by !== "number" || !Number.isInteger(step.by) || step.by === 0) continue
		if (typeof step.unit !== "string") continue
		try {
			await advanceSessionStoryClock(db, move.sessionId, step.by, step.unit as StoryTimeUnit)
		} catch (e) {
			console.warn("[restoreRetractedState] the clock could not be stepped forward again:", e)
		}
	}
	return true
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Whether this owner may carry this slot at all, and whether the value fits.
 *
 * ⚠ The value is checked against the configuration resolved for THIS owner —
 * "this character's Health caps at 20" — and not against the declaration's
 * base. That is what makes attaching a slot mean something.
 *
 * ⚠ When the temporal registry lands, this must read the config valid at the
 * value's own anchor rather than the current one; a value written under a cap
 * of 40 stays legitimate after the cap drops to 20 (plan Part 3). Today there
 * is one clock and the current config is the only one there is.
 *
 * A **retired** slot refuses here, in `checkSlotValue`'s own sentence: nothing
 * new is written to it and everything already written stays (R3).
 */
export async function validateValue(
	db: Db,
	input: {
		sessionId?: number
		owner: StateOwner
		slotId: string
		value: SlotValue
		/** Already resolved by the caller — saved rather than resolved twice. */
		config?: SlotConfig
	}
): Promise<SlotConfig> {
	const decl = getAttributeSlot(input.slotId)
	if (!decl)
		throw new StateRefusal(
			`'${input.slotId}' is not a slot this pub declares. A genre or an ` +
				`extension declares it; without one there is nothing to validate against.`
		)
	if (!slotAppliesTo(decl, ownerFacet(input.owner.kind)))
		throw new StateRefusal(
			`'${input.slotId}' does not apply to ${input.owner.kind}. It attaches to ` +
				`${decl.appliesTo.join(" and ")}.`
		)
	// 🚧 A slot that fits more than one owner is carried where the session's
	// sheet put it (2026-09-26): `location` on the world in Adventure is not
	// a character's to hold there. Asked only when there is a choice to have
	// been made, and only of a slot the session tracks — core's own
	// mechanisms still write slots no genre names.
	if (input.sessionId !== undefined && decl.appliesTo.length > 1) {
		const facet = ownerFacet(input.owner.kind)
		const tracked = (await vocabularyFor(db, input.sessionId)).entryFor(input.slotId)
		if (tracked && !slotAppliesTo(tracked.decl, facet))
			throw new StateRefusal(
				`${i18nText(decl.label) ?? input.slotId} is kept on ` +
					`${tracked.decl.appliesTo.map(facetWords).join(" and ")} in this session, ` +
					`not on ${facetWords(facet)}.`
			)
	}
	// 🚧 Not written for a holder who does not carry it (attribute carries, RF fix 2 item 3).
	if (input.sessionId !== undefined && !(await carries(db, input.sessionId, input.owner, input.slotId)))
		throw new StateRefusal(
			`${i18nText(decl.label) ?? input.slotId} is switched off for ${input.owner.kind === "session" ? "the world" : input.owner.kind === "session_location" ? "that place" : "them"} in this session: it is not carried, so it is not changed.`
		)
	const config =
		input.config ??
		(await configFor(db, {
			sessionId: input.sessionId,
			owner: input.owner,
			slotId: input.slotId
		}))
	const complaint = checkSlotValue(decl, input.value, config)
	if (complaint) throw new StateRefusal(complaint)
	await assertStoryTimeLands(db, input, i18nText(decl.label) ?? input.slotId, slotField(decl)?.format)
	return config
}

/**
 * A story time must land in the calendar of the book its owner is in (plan
 * A18(a)): a story-time stat is a dated row, so it is checked at the write as
 * every dated row is, and the calendar's preflight list (`datedRowsOf`) cannot
 * refill. A session layer is its session's book's. A card's layer belongs to
 * no book — a card is shared between them — and is not checked.
 *
 * Inside the write's transaction when there is one, so a calendar change
 * (`lorebooks:setCalendar`, one transaction of its own) cannot land between
 * this check and the row.
 */
async function assertStoryTimeLands(
	db: Db,
	input: { sessionId?: number; owner: StateOwner; value: SlotValue },
	label: string,
	format: string | undefined
): Promise<void> {
	if (format !== "story-time" || typeof input.value !== "string") return
	const time = parseStoryTime(input.value)
	if (!time) return
	const lorebookId = await bookOfStatOwner(db, input.owner, input.sessionId)
	if (lorebookId == null) return
	const calendar = await bookCalendarOf(db, lorebookId)
	const problem = dateProblem(time, calendar)
	if (problem)
		throw new StateRefusal(
			calendar
				? `${label} does not fit this book's calendar: ${problem}`
				: `${label} can't be saved: ${problem}`
		)
}

/** The book a stat's owner is in: a book layer's own (`bookOfLayer`), a session layer's session's; null for a card. */
async function bookOfStatOwner(
	db: Db,
	owner: StateOwner,
	sessionId: number | undefined
): Promise<number | null> {
	if (owner.kind === "card") return null
	if (isSessionScoped(owner.kind)) {
		const id = sessionId ?? (owner.kind === "session" ? owner.id : null)
		if (id == null) return null
		const [row] = await db
			.select({ lorebookId: schema.sessions.lorebookId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, id))
			.limit(1)
		return row?.lorebookId ?? null
	}
	return bookOfLayer(db, owner)
}

/** An owner facet as a refusal says it. */
const facetWords = (facet: string): string =>
	facet === "world" ? "the world" : facet === "cast" ? "a character" : "a place"

/**
 * An attribute a person or a pipeline writes must be one the session tracks —
 * its vocabulary, which its genre enables (ruled 2026-09-25): a value written
 * to a slot outside it would be stored and never read back. Asked at the
 * doors (`state:set`, `applyChange`, `proposeChange`), not in `setValue`:
 * core's own mechanisms keep slots no genre enables — the session's sprite
 * set — and write them directly. A retired slot is let through to be refused
 * in its own sentence, which says more.
 */
export async function assertTracked(db: Db, sessionId: number, slotId: string): Promise<void> {
	const decl = getAttributeSlot(slotId)
	if (!decl || decl.retired) return
	const vocabulary = await vocabularyFor(db, sessionId)
	if (!vocabulary.entries.some((e) => e.decl.id === slotId))
		throw new StateRefusal(
			`${i18nText(decl.label) ?? slotId} is not tracked in this session: its genre ` +
				`does not enable it, and no sheet the session reads adds it.`
		)
}

/**
 * 🚧 Every lore reference a change brings IN must name an entry the session's
 * story has (attributes phase 3a; plan A27): in the session's own lorebook, on
 * its line, not a character's private lore, and — as the line's amendments
 * leave it at the session's moment — neither archived nor switched Off
 * (`whyUnseen`, the one rule every session reader answers by; an entry of any
 * kind, as a name a model writes is found only among entries the session
 * sees). A reference to another book's entry would resolve — titles are read
 * by id — and put a thing from a world this session is not in into
 * somebody's pack; a missing one names nothing.
 *
 * ⚠ **A refusal names only what the asker may know.** Any player reaches this
 * through `state:set`, a guest included, and a refusal is read by whoever
 * asked. So an entry is named only once it has passed the checks that make it
 * the session's to name — its book, its line, and not private lore; before
 * that it is "lore entry {id}". The name used is the one the session shows
 * (as amended), never the stored title.
 *
 * Asked at the doors, beside `assertTracked` (`state:set`, `applyChange`,
 * `proposeChange`), for what `set` and `add` bring in. `remove` is never
 * refused: an entry since deleted or moved must still be removable from a
 * list that holds it.
 */
export async function assertLoreRefsInSession(
	db: Db,
	sessionId: number,
	change: Pick<ValueChange, "op" | "value" | "items"> & { slotId?: string }
): Promise<void> {
	if (change.op === "remove") return
	const incoming: readonly unknown[] =
		change.items ??
		(Array.isArray(change.value)
			? change.value
			: // 🚧 One reference on its own: a location that is a place entry.
				isSlotLoreRef(change.value)
				? [change.value]
				: [])
	const ids = [...new Set(incoming.filter(isSlotLoreRef).map((ref) => ref.entryId))]
	if (!ids.length) return
	// The entry types a text slot's single reference may point at (a
	// location names `core:entry/location`); a list's items are any entry.
	const decl = change.slotId ? getAttributeSlot(change.slotId) : undefined
	const entryTypes =
		decl && decl.type !== "list" ? (resolveSlotConfig(decl).entryTypes ?? null) : null
	// The books the session reads (PLAN-rulesets §26, "reads are the
	// union"): its attached lorebook and its own notes (its own book), so a
	// place or thing the session wrote only to its notes is one it may hold.
	const readBy = await lorebooksReadBy(db, sessionId)
	const books = new Set(readBy.ids)
	// The session's line: a sibling fork's own entry is not a thing this
	// session's story has, and a shelved one is not one it may hand out.
	// The notes have no line of their own: they are read at their head, as
	// every union reader reads them (`sessionEntriesAsRead`).
	const sessionReading = (await sessionReadingOf(db, sessionId)) ?? MAIN_HEAD
	const readingOf = (lorebookId: number) =>
		lorebookId === readBy.ownBookId ? MAIN_HEAD : sessionReading
	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			lorebookId: schema.lorebookEntries.lorebookId,
			title: schema.lorebookEntries.title,
			typeId: schema.lorebookEntries.typeId,
			enabled: schema.lorebookEntries.enabled,
			archived: schema.lorebookEntries.archived,
			onLine: sql<boolean>`(${entryOnLineSql(sessionReading)})`,
			onHead: sql<boolean>`(${entryOnLineSql(MAIN_HEAD)})`
		})
		.from(schema.lorebookEntries)
		.where(inArray(schema.lorebookEntries.id, ids))
	const byId = new Map(rows.map((r) => [r.id, r]))
	// Each entry as the session's reading has it (plan A27): archived or
	// switched Off by the line's amendments, not only by its stored marks.
	const overlays = new Map<
		number,
		Awaited<ReturnType<typeof entryOverlaysFor>>
	>()
	for (const book of new Set(
		rows.filter((r) => books.has(r.lorebookId)).map((r) => r.lorebookId)
	))
		overlays.set(
			book,
			await entryOverlaysFor(
				db,
				book,
				readingOf(book),
				rows.map((r) => r.id)
			)
		)
	for (const id of ids) {
		const row = byId.get(id)
		if (!row)
			throw new StateRefusal(`lore entry ${id} does not exist, so a list cannot hold it.`)
		if (!books.has(row.lorebookId))
			throw new StateRefusal(
				`lore entry ${id} is not in this session's lorebook, so nothing in this session ` +
					`can hold it.`
			)
		const reading = readingOf(row.lorebookId)
		if (!(row.lorebookId === readBy.ownBookId ? row.onHead : row.onLine))
			throw new StateRefusal(
				`lore entry ${id} was written on another line of this lorebook, so this session's ` +
					`story does not have it.`
			)
		// A session's stats are one state everybody in it reads — every
		// player, every voice — so a character's own knowledge is never one
		// of them (`declaresPrivateLore`).
		if (declaresPrivateLore(row.typeId))
			throw new StateRefusal(
				`lore entry ${id} is private to a character, and everyone in this session sees its ` +
					`stats, so nothing in this session can hold it.`
			)
		const seen = entryAt(
			{
				id: row.id,
				name: row.title ?? "",
				enabled: row.enabled,
				archived: row.archived
			},
			overlays.get(row.lorebookId) ?? new Map(),
			reading
		)
		const named =
			typeof seen.name === "string" && seen.name
				? `'${seen.name}'`
				: `lore entry ${id}`
		const unseen = whyUnseen(row, seen, "session")
		if (unseen) throw new StateRefusal(unseenSentence(named, unseen))
		// Stored types are unversioned (`core:entry/location`); a config may
		// name either spelling.
		if (entryTypes && !entryTypes.some((t) => t.replace(/@\d+$/, "") === row.typeId))
			throw new StateRefusal(
				`${named} is a ${row.typeId} entry, and ${decl!.id} points only at ` +
					`${entryTypes.join(", ")} entries.`
			)
	}
}

/**
 * 🚧 A name a model wrote for a slot that may hold a reference
 * (`config.entryTypes`, 2026-09-26): the entry of one of those types that the
 * session sees and that the name names, as `{ entryId }` — "the crypt" is The
 * Crypt, the place — or the words unchanged when none does. A slot that holds
 * only words, or a value that is not words, is returned as it came.
 *
 * One rule with every other reader of a room's name (plan A27,
 * `sessionEntryNamed`): among the entries the session sees (on its line at
 * its moment, named as amended by then, neither archived nor switched off),
 * the rooms' name rule — the name exactly, then a looser spelling with a
 * leading "the" aside, then a key. Whole names only: "the vault" is never
 * "the sunken vault", because a near-miss put somebody in the wrong room.
 *
 * Refused in a sentence, never guessed and never kept as words: a name two
 * entries answer alike ("the watch" — the Watch Room's key and the
 * Watchtower's), and a name only an entry the session does not see answers
 * (a room switched off, archived) — kept as words, it would put the party in
 * a room that is out of the story.
 */
export async function loreRefNamed(
	db: Db,
	sessionId: number,
	slotId: string,
	written: SlotValue
): Promise<SlotValue> {
	if (typeof written !== "string" || !written.trim()) return written
	const decl = getAttributeSlot(slotId)
	if (!decl || decl.type !== "text") return written
	const types = (resolveSlotConfig(decl).entryTypes ?? []).map((t) => t.replace(/@\d+$/, ""))
	if (!types.length) return written
	const hit = await sessionEntryNamed(db, sessionId, types, written.trim())
	if (hit.kind === "one") return { entryId: hit.entryId }
	if (hit.kind === "tie")
		throw new StateRefusal(tieSentence(written.trim(), hit.names))
	if (hit.kind === "unseen")
		throw new StateRefusal(unseenSentence(`'${hit.name}'`, hit.why))
	return written
}

/**
 * 🚧 The sentence a player's hand edit of their own sheet is refused with
 * while Honour mode is off (owner ruling 2026-10-16). Exported for the tests
 * that pin it.
 */
export const PLAYER_SHEET_REFUSAL =
	"Sheets are the Planner's to change — ask in the Planner panel, or turn on Honour mode."

/** Whether `userId` owns the session. */
async function sessionOwnerIs(db: Db, sessionId: number, userId: number): Promise<boolean> {
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return session?.userId === userId
}

/**
 * 🚧 Whether a player may edit their own seat's sheet by hand in this session
 * (owner ruling 2026-10-16): while Honour mode is on, or where the genre does
 * not declare it. A read that fails says no — the sheet stays the Planner's.
 * The widget's `editable` fact asks the same question.
 */
export async function playerEditsOwnSheet(db: Db, sessionId: number): Promise<boolean> {
	try {
		const { sessionHonourMode } = await import("$lib/server/sessions/settings")
		return (await sessionHonourMode(db, sessionId)) !== false
	} catch (e) {
		console.warn("[state] whether Honour mode is on could not be read:", e)
		return false
	}
}

/** 🚧 The sentence a locked stat refuses a write with (PLAN-sheet §10, 2026-10-17). */
export const LOCKED_REFUSAL = "This stat is locked."

/** 🚧 The locks a slot configuration may carry (`config.lock`, set by `set-stat-config@1`). */
export const SLOT_LOCKS = ["none", "people", "all"] as const
export type SlotLock = (typeof SLOT_LOCKS)[number]

/** A configuration's lock, read defensively: anything but `people` or `all` is none. */
export const slotLockOf = (config: Readonly<Record<string, unknown>> | null | undefined): SlotLock => {
	const lock = config?.lock
	return lock === "people" || lock === "all" ? lock : "none"
}

/**
 * 🚧 May this write land on a slot locked as `lock` (PLAN-sheet §10)?
 *
 *  · `none` — yes;
 *  · `people` — no hand edit by a player; the dice (a run) and the
 *    session's owner still write;
 *  · `all` — nothing writes until unlocked: no run, no hand, and not the
 *    session's owner either.
 *
 * Pure, so the read (`editable`) and the write ask one rule.
 */
export function lockAllows(lock: SlotLock, writer: { hand: boolean; sessionOwner: boolean }): boolean {
	if (lock === "all") return false
	if (lock === "people") return !writer.hand || writer.sessionOwner
	return true
}

/** A hand edit: a person's own write through a `state:*` socket (`updatedBy: 'user'`), not a run's or an accepted proposal's. */
const isHandEdit = (ctx: Pick<WriteContext, "updatedBy" | "userId">): boolean =>
	ctx.updatedBy === "user" && ctx.userId != null

/** Refuse a write the slot's lock forbids, in the one sentence. */
async function assertUnlocked(db: Db, ctx: WriteContext, config: SlotConfig): Promise<void> {
	const lock = slotLockOf(config as Record<string, unknown>)
	if (lock === "none") return
	const hand = isHandEdit(ctx)
	const sessionOwner = hand && lock === "people" ? await sessionOwnerIs(db, ctx.sessionId, ctx.userId!) : false
	if (!lockAllows(lock, { hand, sessionOwner })) throw new StateRefusal(LOCKED_REFUSAL)
}

/**
 * The owner a write through a session may name, checked against the session.
 *
 * **Every kind, the durable ones included** (plan B0, places-graph
 * 2026-09-29). An owner id is a bare row id — a different table per kind, and
 * no foreign key tying it to anybody (`state/owners.ts`) — so before this
 * named the four durable kinds, a user in their own session could file a
 * template-layer value against another user's place, book, cast member or
 * card through `state:set` / `state:configure`.
 *
 * - `session` — the session itself;
 * - `session_cast` — a seated character, or a voiced persona;
 * - 🚧 `player_seat` — a player seat of this session (`session_personas.id`),
 *   card or not, while it is not removed — written by a person only when they
 *   own the session, or when it is their seat and Honour mode is on (or the
 *   genre has none); a run always (2026-10-16);
 * - `lorebook` — the session's own book;
 * - `location` / `session_location` — a live location entry of that book, on
 *   the session's line;
 * - `cast_member` — a member of that book;
 * - `card` — a card the writer owns.
 *
 * **The durable kinds also judge the WRITER** — `userId`, or, when no person
 * is writing (a run), the session's own user (`writerOf`). A guest of the
 * session passes the socket's access check, and a template row (session_id
 * NULL) outlives the session: it resolves in every session on that book or
 * card, sessions the guest cannot open included. So `lorebook`, `location`
 * and `cast_member` are the book owner's to write, and `card` its owner's —
 * the app's rule everywhere else (`sessions:update` keeps a guest off the
 * session's lorebook; `entries:*` is owner-only). The session-layer kinds are
 * play, and any player may write them.
 */
export async function assertSessionOwner(
	db: Db,
	sessionId: number,
	owner: StateOwner,
	/** The person writing, when one is. Only the durable kinds read it. */
	userId?: number | null
): Promise<void> {
	if (!isOwnerKind(owner.kind))
		throw new StateRefusal(`'${String(owner.kind)}' is not an owner kind.`)
	if (owner.kind === "lorebook") {
		const books = await sessionLorebookIds(db, sessionId)
		if (!books.includes(owner.id))
			throw new StateRefusal("that lorebook is not this session's lorebook.")
		await assertBookWriter(db, sessionId, owner.id, userId)
		return
	}
	if (owner.kind === "cast_member") {
		const books = await sessionLorebookIds(db, sessionId)
		const [member] = await db
			.select({ lorebookId: schema.lorebookBindings.lorebookId })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, owner.id))
			.limit(1)
		if (!member || !books.includes(member.lorebookId))
			throw new StateRefusal(
				"that is not a cast member of this session's lorebook."
			)
		await assertBookWriter(db, sessionId, member.lorebookId, userId)
		return
	}
	if (owner.kind === "card") {
		const [card] = await db
			.select({ userId: schema.characters.userId })
			.from(schema.characters)
			.where(eq(schema.characters.id, owner.id))
			.limit(1)
		const writer = await writerOf(db, sessionId, userId)
		if (!card || writer == null || card.userId !== writer)
			throw new StateRefusal(
				"that is not a card of yours. A card's own values are changed by whoever owns it."
			)
		return
	}
	if (owner.kind === "session" && owner.id !== sessionId)
		throw new StateRefusal(
			"a session owner is the session itself; the id does not match."
		)
	if (owner.kind === "session_cast") {
		const seated = await db
			.select({ characterId: schema.sessionCharacters.characterId })
			.from(schema.sessionCharacters)
			.where(
				and(
					eq(schema.sessionCharacters.sessionId, sessionId),
					eq(schema.sessionCharacters.characterId, owner.id)
				)
			)
		if (seated.length) return
		// A persona is a character (§23) and holds state on exactly the same
		// terms, so the player's own bars are writable. Checked second rather
		// than in one query because the seat is the common case and this is the
		// one nobody had before.
		const voiced = await db
			.select({
				personaId: schema.sessionPersonas.personaId,
				userId: schema.sessionPersonas.userId,
				removedAt: schema.sessionPersonas.removedAt,
				cardOwner: schema.characters.userId,
				name: schema.characters.name
			})
			.from(schema.sessionPersonas)
			.leftJoin(schema.characters, eq(schema.characters.id, schema.sessionPersonas.personaId))
			.where(
				and(
					eq(schema.sessionPersonas.sessionId, sessionId),
					eq(schema.sessionPersonas.personaId, owner.id)
				)
			)
		if (!voiced.length)
			throw new StateRefusal(
				"that character is not in this session's cast."
			)
		// 🚧 A CARDED player seat is written as its card (W2 follow-up,
		// 2026-10-17): the same hands as a card-less seat's sheet — the
		// session's owner always; its own player only while Honour mode is
		// on; another player never. A run (no `userId`) always.
		const live = voiced.filter((v) => v.removedAt == null)
		if (userId != null && live.length && !(await sessionOwnerIs(db, sessionId, userId))) {
			if (!live.some((v) => (v.userId ?? v.cardOwner) === userId))
				throw new StateRefusal(
					`only ${live[0]!.name?.trim() || "that seat"}'s player or the session's owner can change ${live[0]!.name?.trim() ? "their" : "its"} sheet.`
				)
			if (!(await playerEditsOwnSheet(db, sessionId))) throw new StateRefusal(PLAYER_SHEET_REFUSAL)
		}
	}
	if (owner.kind === "player_seat") {
		// A seat with a card is addressed by its card (`character:<id>`);
		// `player-seat:` names only a live card-less one (`isCardlessPlayerSeat`).
		const [seat] = await db
			.select({
				personaId: schema.sessionPersonas.personaId,
				seatName: schema.sessionPersonas.seatName,
				removedAt: schema.sessionPersonas.removedAt,
				userId: schema.sessionPersonas.userId
			})
			.from(schema.sessionPersonas)
			.where(
				and(
					eq(schema.sessionPersonas.id, owner.id),
					eq(schema.sessionPersonas.sessionId, sessionId)
				)
			)
			.limit(1)
		if (!seat || !isCardlessPlayerSeat(seat))
			throw new StateRefusal(
				"that seat is not a player's seat in this session; a seat with a card is written as its card."
			)
		// 🚧 Who writes a seat's sheet by hand (owner rulings 2026-10-16):
		//  · a run (no `userId`) — the session's own, always;
		//  · the session's owner — any seat, always;
		//  · the seat's own player — only while Honour mode is on, where the
		//    genre declares it (`sessionHonourMode`); off, the sheet is the
		//    Planner's to change. A genre without the field keeps the player's
		//    hand on their own sheet;
		//  · anybody else — never: a guest never edits another player's character.
		if (userId != null && !(await sessionOwnerIs(db, sessionId, userId))) {
			if (seat.userId !== userId)
				throw new StateRefusal(
					`only ${seat.seatName?.trim() || "that seat"}'s player or the session's owner can change ${seat.seatName?.trim() ? "their" : "its"} sheet.`
				)
			if (!(await playerEditsOwnSheet(db, sessionId)))
				throw new StateRefusal(PLAYER_SHEET_REFUSAL)
		}
		return
	}
	if (owner.kind === "session_location" || owner.kind === "location") {
		// 🚧 Phase 4: a place of THIS session's world — one the session sees
		// (plan A27, `seesPlace(…, "session")`), exactly the set `sessionLinks`
		// lists. The durable layer (`location`) is the same place, so the
		// same set.
		const reading = await sessionReadingOf(db, sessionId)
		let book: number | null =
			reading &&
			(await placesOnReading(db, reading.lorebookId, reading, "session", [owner.id])).length
				? reading.lorebookId
				: null
		// 🚧 Or a place the session's own notes hold (PLAN-rulesets §26), at
		// the notes' head — the union `sessionLinks` lists.
		if (book == null) {
			const { ownBookId } = await lorebooksReadBy(db, sessionId)
			if (
				ownBookId != null &&
				(await placesOnReading(db, ownBookId, MAIN_HEAD, "session", [owner.id])).length
			)
				book = ownBookId
		}
		if (book == null)
			throw new StateRefusal(
				"that place is not a location in this session's lorebook."
			)
		// The place's own layer is the book's; this session's is play.
		if (owner.kind === "location") await assertBookWriter(db, sessionId, book, userId)
	}
}

/** The table each owner kind's id is a row of (`owners.ts`). */
const OWNER_ROWS = {
	card: schema.characters,
	session_cast: schema.characters,
	cast_member: schema.lorebookBindings,
	lorebook: schema.lorebooks,
	session: schema.sessions,
	location: schema.lorebookEntries,
	session_location: schema.lorebookEntries,
	player_seat: schema.sessionPersonas
} as const satisfies Record<OwnerKind, unknown>

/** What a write is told when its owner went while it was being made. */
const OWNER_GONE: Record<OwnerKind, string> = {
	card: "that character no longer exists.",
	session_cast: "that character no longer exists.",
	cast_member: "that cast member is no longer in this session's lorebook.",
	lorebook: "that lorebook no longer exists.",
	session: "that session no longer exists.",
	location: "that place is no longer in this session's lorebook.",
	session_location: "that place is no longer in this session's lorebook.",
	player_seat: "that seat is no longer in this session."
}

/**
 * The owner a stat write is about, read again inside the write's own
 * transaction, just before its insert — `FOR KEY SHARE`, so a delete of the
 * owner row waits for the write to finish. An owner id has no foreign key
 * (`owners.ts`): the delete paths remove an owner's stats in the owner's
 * delete transaction (`deleteOwnerStats`), and a write checked only before
 * its transaction (`assertSessionOwner`) could insert after that delete and
 * leave a row naming nobody. Here the delete has either happened — the write
 * refuses — or happens after the insert and takes the row with the rest.
 */
export async function holdOwner(tx: Db, owner: StateOwner): Promise<void> {
	const table = OWNER_ROWS[owner.kind]
	const [row] = await tx
		.select({ id: table.id })
		.from(table)
		.where(eq(table.id, owner.id))
		.for("key share")
	if (!row) throw new StateRefusal(OWNER_GONE[owner.kind])
}

/**
 * Who a write is judged as: the person writing, when one is; else — a run, no
 * hand on it — the session's own user, on whose behalf the session runs.
 */
async function writerOf(
	db: Db,
	sessionId: number,
	userId: number | null | undefined
): Promise<number | null> {
	if (userId != null) return userId
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return session?.userId ?? null
}

/**
 * A book's durable layers — its own values, its places', its members' — are
 * written by the book's owner only. A session's book is its owner's
 * (`sessions:create` / `:update` check it), so this refuses a guest and passes
 * the host and the host's runs.
 */
async function assertBookWriter(
	db: Db,
	sessionId: number,
	lorebookId: number,
	userId: number | null | undefined
): Promise<void> {
	if (!(await ownsBook(db, lorebookId, await writerOf(db, sessionId, userId))))
		throw new StateRefusal(`${NOT_YOUR_BOOK}; change this session's instead.`)
}

/**
 * The same rule with no session in it (plan places-graph L4): a place's
 * stats set in the lorebook before play are the book's durable layer, so
 * the book's owner writes them and nobody else. `state/placeStats.ts` asks
 * it on every write, whoever the caller is.
 */
export async function assertBookOwner(
	db: Db,
	lorebookId: number,
	userId: number | null | undefined
): Promise<void> {
	if (!(await ownsBook(db, lorebookId, userId ?? null)))
		throw new StateRefusal(`${NOT_YOUR_BOOK}.`)
}

const NOT_YOUR_BOOK =
	"that is not your lorebook. A lorebook's own values, its places' and its members' are changed by whoever owns it"

async function ownsBook(
	db: Db,
	lorebookId: number,
	writer: number | null
): Promise<boolean> {
	const [book] = await db
		.select({ userId: schema.lorebooks.userId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	return !!book && writer != null && book.userId === writer
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface WriteContext {
	sessionId: number
	updatedBy: StateWriter
	/**
	 * The person writing, when one is (the `state:*` sockets, and whoever
	 * accepts a proposal): a durable owner — a card, or the book's own, its
	 * places' or its members' layer — must be theirs (`assertSessionOwner`).
	 * Absent — a run — the session's own user. Authority only: provenance is
	 * `updatedBy`.
	 */
	userId?: number | null
	/**
	 * The anchor. Resolved to the **owner's open anchor** when absent, and
	 * checked against the turn lock when present (`anchorFor`). `null` on a
	 * proposal to change the BOOK holds it under no reply (`proposeChange`).
	 */
	messageId?: number | null
	/**
	 * `messageId` is a row the WRITING run created itself, earlier in the same
	 * run (lair pass R8, 2026-09-28: `set-state`'s declared `worldRow`, whose
	 * port takes only this run's own write results). Open to that run for the
	 * rest of its turn, whatever it wrote after it — the rows after it are
	 * the same turn's. Honoured for world owners only; a cast member's anchor
	 * is theirs.
	 */
	ownAnchor?: boolean
	/**
	 * The line a write to the book lands on (null: main), with
	 * `historyEntryId` its dating. Set, both are taken as given — an accepted
	 * proposal's, a recording's; absent, the session's own line and
	 * `writeDatingAt` (`bookWritePlace`, plan A22). A session-layer row
	 * carries neither.
	 */
	branchId?: number | null
	/** The story-clock anchor a durable row is filed at (R8); read with `branchId`. */
	historyEntryId?: number | null
	/** The captured moment a durable row was recorded at. */
	sceneId?: number | null
	/** Where a durable row came from — plain ints, so the row outlives the session. */
	sourceSessionId?: number | null
	sourceMessageId?: number | null
	/** Ledger narration, when the caller has one for the whole write. */
	note?: string | null
}

// ── The state version ───────────────────────────────────────────────────────

/**
 * Take the session's state-version lock for the rest of this transaction.
 *
 * ⚠ **The first statement of a write's transaction**, ahead of the base check
 * and of the read of the current value — not only ahead of the bump. The
 * lock is released by the previous writer's commit, and under READ COMMITTED
 * every statement after it takes a fresh snapshot, so a check or a read made
 * under it sees that commit; made before it, two writers make the same check
 * or the same read and both land. Re-entrant within one transaction, so
 * `nextStateVersion` taking it again is nothing.
 */
async function lockStateVersion(tx: Db, sessionId: number): Promise<void> {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtext('stateVersion'), ${sessionId})`
	)
}

/**
 * Move the session's state version by one and return the new number.
 *
 * ⚠ **Call this inside the transaction that inserts the row**, exactly as
 * `nextLane` is: the advisory lock is an *xact* lock, released at commit, and
 * the row must land under the number it was handed. Raw SQL rather than the
 * query builder so the session's `updated_at` `$onUpdate` does not fire — a
 * stat moving is not the session being edited. Null when the session row is
 * gone, which the stamp then records as null too.
 */
async function nextStateVersion(
	tx: Db,
	sessionId: number
): Promise<number | null> {
	await lockStateVersion(tx, sessionId)
	const [row] = rawRows<{ state_version: number | string | null }>(
		await tx.execute(sql`
		update ${schema.sessions}
		set state_version = state_version + 1
		where ${schema.sessions.id} = ${sessionId}
		returning state_version
	`)
	)
	return row?.state_version == null ? null : Number(row.state_version)
}

/** What a change targets, for a sentence: the slot's bare key. */
export const changeTargetName = (change: StateChange): string =>
	slotKey(change.slotId)

/**
 * The state version the change's target last **landed** at: the version
 * stamped on the row in force for that owner and slot, by the same "latest anchor, later row on a tie" rule the resolver
 * reads with. Zero when nothing has been written there, or when the row in
 * force predates the counter (null) — both read as "never moved since".
 */
export async function landedVersionOf(
	db: Db,
	sessionId: number,
	change: StateChange
): Promise<number> {
	type Row = {
		id: number
		validFromMessageId: number | null
		stateVersion: number | null
	}
	const rows: Row[] = await db
		.select({
			id: schema.attributeValues.id,
			validFromMessageId: schema.attributeValues.validFromMessageId,
			stateVersion: schema.attributeValues.stateVersion
		})
		.from(schema.attributeValues)
		.where(
			and(
				eq(schema.attributeValues.ownerKind, change.owner.kind),
				eq(schema.attributeValues.ownerId, change.owner.id),
				eq(schema.attributeValues.slotId, change.slotId),
				...(isSessionScoped(change.owner.kind)
					? [eq(schema.attributeValues.sessionId, sessionId)]
					: [])
			)
		)
	let best: Row | undefined
	for (const row of rows) {
		if (!best) {
			best = row
			continue
		}
		const a = row.validFromMessageId ?? -1
		const b = best.validFromMessageId ?? -1
		if (a > b || (a === b && row.id > best.id)) best = row
	}
	return best?.stateVersion ?? 0
}

/**
 * The rebase (R-15 *Staleness and order*): given the version a change was
 * made against, has its target moved since? Null when the change holds — no
 * base, a base at or past the current version, or a target untouched since
 * the base — else the sentence naming what moved and the two versions.
 */
export async function movedSinceBase(
	db: Db,
	sessionId: number,
	change: StateChange,
	base: number | null | undefined
): Promise<string | null> {
	if (base == null) return null
	const now = await stateVersionOf(db, sessionId)
	if (base >= now) return null
	const landed = await landedVersionOf(db, sessionId, change)
	if (landed <= base) return null
	return (
		`${changeTargetName(change)} changed since this run read it ` +
		`(v${base} → v${now}); resolve-state-changes must rebase on the next turn`
	)
}

/** The timeline columns, filled the same way by every path that writes a row. */
const provenance = (ctx: WriteContext) => ({
	branchId: ctx.branchId ?? null,
	historyEntryId: ctx.historyEntryId ?? null,
	sceneId: ctx.sceneId ?? null,
	sourceSessionId: ctx.sourceSessionId ?? null,
	sourceMessageId: ctx.sourceMessageId ?? null
})

/**
 * 🚧 A **piece**'s holding key, or null for any other item (a word, a lore
 * reference): what makes two of them one holding with a count — a
 * compendium piece by its row, a lore piece by its entry, 🚧 an inline piece
 * by its name (2026-10-19, _Give to…_: a potion handed to someone holding one
 * of the same name joins their count, never "is in it twice").
 */
export const pieceHoldingKey = (item: SlotListItem): string | null =>
	isSlotPiece(item)
		? item.kind === "compendium"
			? `compendium:${item.compendiumId}/${item.pieceId}`
			: item.kind === "lore"
				? `entry:${item.entryId}`
				: typeof item.name === "string" && item.name.trim()
					? `piece:${item.name.trim().toLowerCase()}`
					: null
		: null

/** How many of an item a holding is: its count, else one. */
export const pieceCount = (item: SlotListItem): number => {
	const c = (item as { count?: unknown }).count
	return typeof c === "number" && Number.isFinite(c) ? c : 1
}

/** The piece with this count; one is spelled bare, as a lore reference's is. */
export const withPieceCount = (item: SlotListItem, count: number): SlotListItem => {
	const { count: _count, ...rest } = item as Record<string, unknown>
	return (count === 1 ? rest : { ...rest, count }) as SlotListItem
}

/**
 * 🚧 Counted pieces (DC walk 6: a second "gains Potion of healing" left one
 * potion): an `add` of a compendium or lore piece already held raises its
 * count by the piece's own (one when it states none), and a `remove` lowers
 * it, dropping the holding at zero — the same arithmetic `applyListOp` does
 * for a counted lore reference. Every other item goes on to `applyListOp`
 * untouched. Pure; exported for tests.
 *
 * ⚠ App-side until the SDK's `applyListOp` counts pieces itself; then this
 * is a no-op pass-through to delete (the merged list it hands on is an `add`
 * of nothing new, or a `set`).
 */
export function countPieces(
	held: readonly SlotListItem[],
	op: SlotChangeOp,
	items: readonly SlotListItem[]
): { held: readonly SlotListItem[]; op: SlotChangeOp; items: readonly SlotListItem[] } {
	if (op === "set" || !items.some((i) => pieceHoldingKey(i) !== null)) return { held, op, items }
	const out = [...held]
	const rest: SlotListItem[] = []
	for (const item of items) {
		const key = pieceHoldingKey(item)
		if (key === null) {
			rest.push(item)
			continue
		}
		const at = out.findIndex((h) => pieceHoldingKey(h) === key)
		if (op === "add") {
			if (at < 0) out.push(withPieceCount(item, pieceCount(item)))
			else out[at] = withPieceCount(out[at], pieceCount(out[at]) + pieceCount(item))
		} else if (at >= 0) {
			const left = pieceCount(out[at]) - pieceCount(item)
			if (left > 0) out[at] = withPieceCount(out[at], left)
			else out.splice(at, 1)
		}
	}
	return { held: out, op, items: rest }
}

/**
 * What a change leaves the value as, given what is there now.
 *
 * `set` is the value as written. `add`/`remove` are read-modify-write, and the
 * read is the resolved one — not the row — so adding a sword to an inventory
 * the card declared adds to what the character actually has rather than to
 * nothing. The list ops go through the SDK's `applyListOp`, which owns
 * `unique` and refuses an overflow rather than trimming it.
 */
async function nextValue(
	db: Db,
	ctx: WriteContext,
	change: ValueChange,
	config: SlotConfig
): Promise<SlotValue> {
	const op = change.op ?? "set"
	const decl = getAttributeSlot(change.slotId)
	if (op === "set") return change.value ?? null
	if (!decl)
		throw new StateRefusal(
			`'${change.slotId}' is not a slot this pub declares.`
		)
	const current = await valueOf(db, {
		sessionId: ctx.sessionId,
		owner: change.owner,
		slotId: change.slotId
	})
	if (decl.type === "list") {
		const items =
			change.items ??
			(Array.isArray(change.value)
				? (change.value as readonly SlotListItem[])
				: change.value === undefined || change.value === null
					? []
					: [change.value as SlotListItem])
		const held = Array.isArray(current)
			? (current as readonly SlotListItem[])
			: current === undefined || current === null
				? []
				: [current as SlotListItem]
		const counted = countPieces(held, op, items)
		const result = applyListOp(counted.held, counted.op, counted.items, config)
		if (result.refusal)
			throw new StateRefusal(`${change.slotId}: ${result.refusal}`)
		return result.value
	}
	if (decl.type === "integer" && op === "add") {
		const delta = Number(change.value ?? 0)
		if (!Number.isFinite(delta))
			throw new StateRefusal(
				`${change.slotId} changes by a whole number; ` +
					`'${String(change.value)}' is not one.`
			)
		const base = typeof current === "number" ? current : 0
		// A number stat shaped `number` keeps its fraction; every other
		// integer slot is a whole number, as it always was.
		return slotField(decl)?.type === "number" ? base + delta : Math.trunc(base + delta)
	}
	throw new StateRefusal(
		`${change.slotId} is a '${decl.type}' slot, so '${op}' means nothing to it. ` +
			`Only a list has items to add or remove, and only an integer takes a ` +
			`signed delta. Use 'set'.`
	)
}

/**
 * Write one attribute value.
 *
 * An append, always: the row in force is the one with the highest anchor, so a
 * second edit at the same message wins by id and the first is still evidence.
 */
export async function setValue(
	db: Db,
	ctx: WriteContext,
	change: ValueChange,
	messages?: TurnMessage[]
): Promise<number> {
	await assertSessionOwner(db, ctx.sessionId, change.owner, ctx.userId)
	await assertBookWritesOn(db, ctx.sessionId, change.owner)
	const config = await configFor(db, {
		sessionId: ctx.sessionId,
		owner: change.owner,
		slotId: change.slotId
	})
	await assertUnlocked(db, ctx, config)
	const anchor = await anchorFor(db, ctx, change.owner, messages)
	const place = await bookWritePlace(db, ctx, change.owner)
	// The base check, the read of the current value, and the write are ONE
	// locked transaction (U5f review). Judged ahead of the lock, two writers
	// with one base both pass and both land — the second blind over the
	// first, the case the version exists to refuse; read ahead of it, two
	// deltas read the same current value and one is lost. A refusal here
	// rolls the transaction back with nothing bumped.
	return await db.transaction(async (tx) => {
		await lockStateVersion(tx, ctx.sessionId)
		await holdOwner(tx, change.owner)
		const moved = await movedSinceBase(tx, ctx.sessionId, change, change.base)
		if (moved) throw new StateRefusal(moved)
		// Stored as its ids: a lore reference's `name` is what a READ fills in.
		const value = slotValueForStorage(await nextValue(tx, ctx, change, config))
		await validateValue(tx, {
			sessionId: ctx.sessionId,
			owner: change.owner,
			slotId: change.slotId,
			value,
			config
		})
		const stateVersion = await nextStateVersion(tx, ctx.sessionId)
		const [row] = await tx
			.insert(schema.attributeValues)
			.values({
				ownerKind: change.owner.kind,
				ownerId: change.owner.id,
				slotId: change.slotId,
				value: { v: value },
				sessionId: isSessionScoped(change.owner.kind) ? ctx.sessionId : null,
				validFromMessageId: anchor,
				updatedBy: ctx.updatedBy,
				note: change.note ?? ctx.note ?? null,
				stateVersion,
				...provenance(ctx),
				...place
			})
			.returning({ id: schema.attributeValues.id })
		return row!.id
	})
}

/**
 * Attach a slot to an owner, or change what attaching decided.
 *
 * Stores the **deviations** — `{ max: 40 }` — and never the resolved whole, so
 * raising a genre's default still reaches every owner who did not override it.
 *
 * ⚠ `descriptor` is a legitimate deviation key (R5), and it is the reason there
 * is no per-lorebook copy of a declaration: "in THIS world, Tension is how
 * close the hunt is" is a configuration of one slot, not a second slot. It is
 * model-facing prose, so it is checked for being a non-empty line and nothing
 * else.
 */
export async function configure(
	db: Db,
	ctx: WriteContext,
	input: { owner: StateOwner; slotId: string; config: SlotConfig }
): Promise<number> {
	const decl = getAttributeSlot(input.slotId)
	if (!decl)
		throw new StateRefusal(
			`'${input.slotId}' is not a slot this pub declares.`
		)
	if (decl.retired)
		throw new StateRefusal(
			`${decl.id} is retired, so nothing new is attached to it. Everything ` +
				`already stored is kept and still shown — revive the slot to change ` +
				`what it is configured as.`
		)
	if (!slotAppliesTo(decl, ownerFacet(input.owner.kind)))
		throw new StateRefusal(
			`'${input.slotId}' attaches to ${decl.appliesTo.join(" and ")}, not to ` +
				`${input.owner.kind}.`
		)
	// 🚧 Only what the slot's stat shape bounds, as values it can be
	// (`statConfigRefusals`, 2026-10-15) — a `descriptor` among them, which
	// must be a line. A key nothing reads is refused rather than kept.
	// 🚧 `lock` is the one universal key (PLAN-sheet §10, 2026-10-17) — no
	// stat shape bounds it, so it is judged here and the rest by the shape.
	// ⏳ Until the SDK's `statConfigKeys` lists it.
	const { lock, ...shaped } = (input.config ?? {}) as Record<string, unknown>
	if (lock !== undefined && !(SLOT_LOCKS as readonly unknown[]).includes(lock))
		throw new StateRefusal(
			`a stat's lock is ${SLOT_LOCKS.map((l) => `'${l}'`).join(", ")}; '${String(lock)}' is not one.`
		)
	const refusals = lock !== undefined && !Object.keys(shaped).length ? [] : statConfigRefusals(decl, shaped as SlotConfig)
	if (refusals.length) throw new StateRefusal(refusals.join(" "))
	// Every kind, the template layers included: configuring another user's
	// book or card from one's own session is the same hole as writing it.
	await assertSessionOwner(db, ctx.sessionId, input.owner, ctx.userId)
	await assertBookWritesOn(db, ctx.sessionId, input.owner)
	// A floor above the ceiling once merged with what is in force: no value
	// could ever be written, so nothing is stored.
	const merged = {
		...(await configFor(db, { sessionId: ctx.sessionId, owner: input.owner, slotId: input.slotId })),
		...input.config
	}
	if (typeof merged.min === "number" && typeof merged.max === "number" && merged.min > merged.max)
		throw new StateRefusal(
			`${i18nText(decl.label) ?? decl.id} would go from ${merged.min} up to ${merged.max}, ` +
				`which no value fits. Raise the max or lower the min with it.`
		)
	const anchor = await anchorFor(db, ctx, input.owner)
	const place = await bookWritePlace(db, ctx, input.owner)
	return await db.transaction(async (tx) => {
		await holdOwner(tx, input.owner)
		const [row] = await tx
			.insert(schema.attributeConfigs)
			.values({
				ownerKind: input.owner.kind,
				ownerId: input.owner.id,
				slotId: input.slotId,
				config: input.config ?? {},
				sessionId: isSessionScoped(input.owner.kind) ? ctx.sessionId : null,
				validFromMessageId: anchor,
				updatedBy: ctx.updatedBy,
				note: ctx.note ?? null,
				...provenance(ctx),
				...place
			})
			.returning({ id: schema.attributeConfigs.id })
		return row!.id
	})
}

/**
 * 🚧 One owner's **stat configuration**, set (`core:outlet/set-stat-config@1`,
 * owner ruling 2026-10-15): `configure` — every refusal the person's
 * `state:configure` meets — on a slot the session tracks, with the
 * configuration in force before and after it, which is what a ledger line
 * ("Ann · Health max 20 → 26") and the run's receipt say.
 */
export async function setStatConfig(
	db: Db,
	ctx: WriteContext,
	input: { owner: StateOwner; slotId: string; config: SlotConfig }
): Promise<{ configId: number; before: SlotConfig; config: SlotConfig }> {
	if (!getAttributeSlot(input.slotId))
		throw new StateRefusal(`'${input.slotId}' is not a slot this pub declares.`)
	await assertTracked(db, ctx.sessionId, input.slotId)
	const query = { sessionId: ctx.sessionId, owner: input.owner, slotId: input.slotId }
	const before = await configFor(db, query)
	const configId = await configure(db, ctx, input)
	return { configId, before, config: await configFor(db, query) }
}

// ── One change, applied ─────────────────────────────────────────────────────

/**
 * Apply one change.
 *
 * The single function every applying path goes through: the node in `apply`
 * mode, a socket edit, and an accepted proposal. Three implementations of "and
 * then write it" is how a proposal ends up validated more loosely than the edit
 * it imitates.
 */
export async function applyChange(
	db: Db,
	ctx: WriteContext,
	change: StateChange,
	messages?: TurnMessage[]
): Promise<number> {
	// The rebase (U5f): a delta against a base its target has moved past is
	// refused with the versions named, never applied over the newer value.
	// The check lives INSIDE each writer's locked transaction, never here
	// ahead of it — judged before the lock, two writers with one base both
	// pass and both land (U5f review).
	if (!isValueChange(change))
		throw new StateRefusal(
			"that change names no slot. An item moving is an add or remove on the inventory stat."
		)
	await assertTracked(db, ctx.sessionId, change.slotId)
	await assertLoreRefsInSession(db, ctx.sessionId, change)
	return await setValue(db, ctx, change, messages)
}

/**
 * An **automatic** apply — a run's `core:task/set-state@1` in apply mode, the
 * gate's apply — under the book owner's lore write mode (plan A22, ruled
 * 2026-09-30). A change to the session's own layers applies as it always
 * did. A change to the BOOK (`isBookLayer`):
 *
 * - **Full** — applied, on the session's line at its dating;
 * - **Review changes** — held as a proposal instead (`proposeChange`),
 *   carrying that line and dating for its accept;
 * - **Off** — refused with the sentence naming the mode, which the caller
 *   lists on the run's receipt as it lists every refusal.
 *
 * `modeOf` lets a caller applying several changes ask the mode once.
 */
export async function applyAutomatic(
	db: Db,
	ctx: WriteContext,
	change: StateChange,
	messages?: TurnMessage[],
	modeOf?: () => Promise<LoreWriteMode>
): Promise<{ applied: number } | { proposed: number }> {
	if (isValueChange(change) && isBookLayer(change.owner.kind)) {
		const mode = await (modeOf ? modeOf() : sessionLoreWriteMode(db, ctx.sessionId))
		if (mode === "review") return { proposed: await proposeChange(db, ctx, change, messages) }
		if (mode === "off") throw new StateRefusal(`${changeTargetName(change)}: ${LORE_WRITES_OFF}`)
	}
	return { applied: await applyChange(db, ctx, change, messages) }
}

/** Ask the book owner's lore write mode once, for a caller applying several changes. */
export function loreWriteModeOnce(db: Db, sessionId: number): () => Promise<LoreWriteMode> {
	let asked: Promise<LoreWriteMode> | undefined
	return () => (asked ??= sessionLoreWriteMode(db, sessionId))
}

// ── The gate ────────────────────────────────────────────────────────────────

/**
 * Hold a change for review. Returns the proposal's id.
 *
 * ⚠ **Validated on the way IN, not only on the way out.** A change checked only
 * when somebody presses Accept is a change that can be held and drawn with its
 * two buttons while being impossible to apply: a live Rest proposed stamina 90
 * on a slot that stops at 10 and weather "Overcast with Storm Clouds,
 * Threatening Rain and Thunder" on a five-word enum. The gate exists for the
 * writer with no authority; a gate holding a change nothing could accept is a
 * gate reporting nonsense as a decision.
 *
 * The same `validateValue` the write calls, so the two can never disagree about
 * what a slot accepts — and the same `StateRefusal` out of it, which every
 * caller already turns into a sentence on the receipt.
 */
export async function proposeChange(
	db: Db,
	ctx: WriteContext,
	change: StateChange,
	messages?: TurnMessage[]
): Promise<number> {
	if (!isValueChange(change))
		throw new StateRefusal(
			"that change names no slot. An item moving is an add or remove on the inventory stat."
		)
	await assertSessionOwner(db, ctx.sessionId, change.owner, ctx.userId)
	// Under Off a proposal to change the book is one nothing could accept.
	await assertBookWritesOn(db, ctx.sessionId, change.owner)
	await assertTracked(db, ctx.sessionId, change.slotId)
	await assertLoreRefsInSession(db, ctx.sessionId, change)
	const config = await configFor(db, {
		sessionId: ctx.sessionId,
		owner: change.owner,
		slotId: change.slotId
	})
	// A proposal a lock forbids is one nothing could accept.
	await assertUnlocked(db, ctx, config)
	await validateValue(db, {
		sessionId: ctx.sessionId,
		owner: change.owner,
		slotId: change.slotId,
		value: await nextValue(db, ctx, change, config),
		config
	})
	// A change to the book is held under the reply that asked for it, as the
	// world's changes are — listed there, and gone with it on a swipe or a
	// delete. A caller naming NO reply (`messageId: null`) holds it under
	// none: a recording is the capture's, not a turn's, and a regenerate of
	// whichever reply is newest must not take it (it waits in the session's
	// list of held changes instead). The row an accept writes carries no
	// message: authoring has no turn to be after (`anchorFor`).
	const anchor =
		isBookLayer(change.owner.kind) && ctx.messageId === null
			? null
			: await anchorFor(
					db,
					ctx,
					isBookLayer(change.owner.kind) ? { kind: "session", id: ctx.sessionId } : change.owner,
					messages
				)
	// The base rides the row, not the payload (U5f): the caller's when it
	// named one, else the version as it stands now — either way, what the
	// accept will compare against.
	const { base, ...payload } = change
	const baseVersion = base ?? (await stateVersionOf(db, ctx.sessionId))
	// A change to the book keeps where it was proposed — the line, and the
	// dating the write would have had now (plan A22): an accept applies it
	// THERE, whatever the session's clock says by then.
	const place = await bookWritePlace(db, ctx, change.owner)
	return await db.transaction(async (tx) => {
		await holdOwner(tx, change.owner)
		// The same change to the book, asked again while it waits at the same
		// line and dating, IS the one held: a keeper re-asking every turn under
		// Review changes would otherwise file one decision many times.
		if (isBookLayer(change.owner.kind)) {
			const held = await tx
				.select({ id: schema.stateProposals.id, payload: schema.stateProposals.payload })
				.from(schema.stateProposals)
				.where(
					and(
						eq(schema.stateProposals.sessionId, ctx.sessionId),
						eq(schema.stateProposals.status, "pending"),
						place.branchId == null
							? isNull(schema.stateProposals.branchId)
							: eq(schema.stateProposals.branchId, place.branchId),
						place.historyEntryId == null
							? isNull(schema.stateProposals.historyEntryId)
							: eq(schema.stateProposals.historyEntryId, place.historyEntryId)
					)
				)
			const asked = canonicalJson(payload)
			const same = held.find((r) => canonicalJson(r.payload) === asked)
			if (same) return same.id
		}
		const [row] = await tx
			.insert(schema.stateProposals)
			.values({
				sessionId: ctx.sessionId,
				messageId: anchor,
				kind: "value",
				payload: payload as unknown as Record<string, unknown>,
				status: "pending",
				proposedBy: ctx.updatedBy,
				baseVersion,
				branchId: place.branchId ?? null,
				historyEntryId: place.historyEntryId ?? null
			})
			.returning({ id: schema.stateProposals.id })
		return row!.id
	})
}

/** A payload as text with its keys in order — what a stored `jsonb` and a fresh object agree on. */
function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value ?? null)
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

/** What deciding a proposal came to. */
export interface ProposalDecision {
	status: "accepted" | "rejected" | "superseded"
	appliedId?: number
	/**
	 * 🚧 An accepted **clock proposal**: the session's story clock moved, and
	 * this is where it stands now (`label`, in the book's calendar). The
	 * caller announces it — a moved clock is a time action (live scenes §4).
	 */
	/** The clock move an accepted clock proposal made — 🚧 with where it stood and stands (`story-clock-moved`). */
	clock?: { label: string; from?: unknown; to?: unknown }
	/**
	 * `superseded` only: the targets that moved since the proposal's base —
	 * one entry for a one-change proposal, by name (`changeTargetName`).
	 */
	movedSlots?: string[]
	/**
	 * 🚧 An **offer** answered (_Give to…_, owner ruling ★4): the one line the
	 * table hears — accepted, turned down, withdrawn, or closed because the
	 * piece is gone from the giver's sheet. The caller says it (`sayOnTable`).
	 */
	line?: string
}

/**
 * Accept or reject one held change.
 *
 * Accepting writes it with the **proposer's** provenance, not the deciding
 * user's: the ledger's job is to say where a number came from, and "the model
 * asked and you agreed" is a different sentence from "you set it".
 *
 * **Accept = rebase or supersede** (plans/29 R-15 *Staleness and order*;
 * U5f). The proposal is a delta against `base_version`. When the session's
 * version is still that, or the row carries none (pre-U5f), it applies as it
 * always did. When the version has moved on, the slot the change targets is
 * asked what version its in-force row landed at: untouched since the base
 * (landed ≤ base) and the delta still holds — that IS the rebase, and it
 * applies; moved, and the proposal is marked **`superseded`**, nothing is
 * applied, `decidedAt` is set, and `movedSlots` names what moved. Reject is
 * unchanged.
 *
 * **Judged, applied and marked under ONE lock** (U5f review). The judging,
 * the write and the mark are one transaction under the session's
 * state-version lock: judged ahead of it, two accepts with one base both
 * find the slot untouched and both land. The proposal's status is read again
 * under the lock for the same reason — two decisions racing on one proposal
 * each read `pending` ahead of it, and the second would mark over the
 * first's `accepted` (as `superseded`, since the first's write moved the
 * slot) with the value already applied.
 */
export async function decideProposal(
	db: Db,
	proposalId: number,
	accept: boolean,
	/**
	 * Who decides. An accept is judged as them (`WriteContext.userId`): a
	 * guest's Accept never files a row against the host's book that the
	 * guest could not have written by hand. Absent — the session's own user.
	 */
	userId?: number | null
): Promise<ProposalDecision> {
	const [proposal] = await db
		.select()
		.from(schema.stateProposals)
		.where(eq(schema.stateProposals.id, proposalId))
	if (!proposal) throw new StateRefusal("that proposal no longer exists.")
	if (proposal.status !== "pending")
		throw new StateRefusal(`that proposal was already ${proposal.status}.`)
	if (proposal.kind === "clock") return await decideClockProposal(db, proposal, accept)

	const change = proposal.payload as unknown as StateChange
	return await db.transaction(async (tx) => {
		await lockStateVersion(tx, proposal.sessionId)
		const [held] = await tx
			.select({ status: schema.stateProposals.status })
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.id, proposalId))
		if (!held) throw new StateRefusal("that proposal no longer exists.")
		if (held.status !== "pending")
			throw new StateRefusal(`that proposal was already ${held.status}.`)
		const mark = async (status: ProposalDecision["status"]) => {
			await tx
				.update(schema.stateProposals)
				.set({ status, decidedAt: new Date() })
				.where(eq(schema.stateProposals.id, proposalId))
		}

		// 🚧 An offer (Give to…, ★4): the receiver's to accept or decline, the
		// giver's to withdraw — its own hands and its own two writes (`give.ts`).
		const { isOfferPayload, decideOffer } = await import("$lib/server/state/give")
		if (isOfferPayload(proposal.payload)) {
			const answered = await decideOffer(tx, proposal, accept, userId, mark)
			return { status: answered.status, line: answered.line }
		}
		// 🚧 A held field change (ties on the graph, T2, screen 3's Set…): one
		// field of a held entry, set by the game master — the row on the
		// lorebook follows it on accept, through the one writer.
		const { isHeldFieldPayload, decideHeldField } = await import("$lib/server/rulesets/ties")
		if (isHeldFieldPayload(proposal.payload)) {
			await assertMayDecide(tx, proposal.sessionId, { kind: "session", id: proposal.sessionId } as StateOwner, userId)
			const answered = await decideHeldField(tx, proposal, accept, mark)
			return { status: answered.status, line: answered.line }
		}

		if (!accept) {
			// Rejecting is deciding too (plan A22 review): what a guest takes
			// part in is the session's play, never what the host's book was
			// asked to hold. An accept is judged the same way, by its write.
			await assertMayDecide(tx, proposal.sessionId, change.owner, userId)
			await mark("rejected")
			return { status: "rejected" }
		}
		const moved = await movedSinceBase(
			tx,
			proposal.sessionId,
			change,
			proposal.baseVersion
		)
		if (moved) {
			await mark("superseded")
			return { status: "superseded", movedSlots: [changeTargetName(change)] }
		}
		const appliedId = await applyChange(
			tx,
			{
				sessionId: proposal.sessionId,
				updatedBy: proposal.proposedBy || "user",
				userId,
				messageId: proposal.messageId,
				// Where it was proposed (plan A22): a change to the book lands
				// on that line at that dating. A session-layer change carries
				// neither, and `bookWritePlace` ignores them for it.
				branchId: proposal.branchId ?? null,
				historyEntryId: proposal.historyEntryId ?? null
			},
			// The base was judged above, under this lock; the write is the
			// rebased delta, and its own (re-entrant) lock and check are moot.
			{ ...change, base: null }
		)
		await mark("accepted")
		return { status: "accepted", appliedId }
	})
}

/**
 * 🚧 Decide a **clock proposal** (live scenes §6, ★3). Accept advances the
 * session's story clock by the step, on `tx` and under the state-version lock
 * the value path takes, so two decisions racing on one row cannot both move
 * it; Reject drops it. Anyone the session admits decides one, as a session
 * value: the clock is the session's own, never the book's.
 *
 * Never **superseded**: a step is a delta that holds from wherever the clock
 * stands — the keeper said the scene took three hours, and a person moving
 * the clock since does not make that untrue. A clock that cannot move now (no
 * present to start from, a result that does not land) is refused with the
 * clock's own sentence and the proposal stays pending, for Reject.
 */
async function decideClockProposal(
	db: Db,
	proposal: typeof schema.stateProposals.$inferSelect,
	accept: boolean
): Promise<ProposalDecision> {
	const change = proposal.payload as unknown as Partial<ClockChange>
	return await db.transaction(async (tx) => {
		await lockStateVersion(tx, proposal.sessionId)
		const [held] = await tx
			.select({ status: schema.stateProposals.status })
			.from(schema.stateProposals)
			.where(eq(schema.stateProposals.id, proposal.id))
		if (!held) throw new StateRefusal("that proposal no longer exists.")
		if (held.status !== "pending")
			throw new StateRefusal(`that proposal was already ${held.status}.`)
		const mark = async (status: ProposalDecision["status"]) => {
			await tx
				.update(schema.stateProposals)
				.set({ status, decidedAt: new Date() })
				.where(eq(schema.stateProposals.id, proposal.id))
		}
		if (!accept) {
			await mark("rejected")
			return { status: "rejected" }
		}
		if (typeof change.by !== "number" || typeof change.unit !== "string")
			throw new StateRefusal("that clock proposal does not say how far the clock moves.")
		let moved: Awaited<ReturnType<typeof advanceSessionStoryClock>>
		try {
			moved = await advanceSessionStoryClock(tx, proposal.sessionId, change.by, change.unit)
		} catch (e) {
			if (e instanceof StoryClockRefusal) throw new StateRefusal(e.message)
			throw e
		}
		// 🚧 The accepted row IS the move's record (live scenes §15 G5): where
		// the clock stood and where it now stands, for the ledger's line,
		// and the keeper's cause — what a swipe or a delete of the reply
		// moves the clock back by (`state/clockMoves.ts`).
		await tx
			.update(schema.stateProposals)
			.set({
				status: "accepted",
				decidedAt: new Date(),
				payload: {
					...((proposal.payload ?? {}) as Record<string, unknown>),
					cause: "keeper",
					from: moved.from,
					to: moved.clock
				}
			})
			.where(eq(schema.stateProposals.id, proposal.id))
		return { status: "accepted", clock: { label: moved.label, from: moved.from, to: moved.clock } }
	})
}

/**
 * Who may decide a held change: for the session's own layers, anyone the
 * session admits — that is play; for the book's layers or a card, only whoever
 * could write it (`assertSessionOwner`'s rule): the book's owner, the card's.
 * A book whose target is gone is decided by the owner of the session's book.
 */
async function assertMayDecide(
	db: Db,
	sessionId: number,
	owner: StateOwner,
	userId: number | null | undefined
): Promise<void> {
	if (isSessionScoped(owner.kind)) return
	const writer = await writerOf(db, sessionId, userId)
	if (owner.kind === "card") {
		const [card] = await db
			.select({ userId: schema.characters.userId })
			.from(schema.characters)
			.where(eq(schema.characters.id, owner.id))
			.limit(1)
		if (card && writer != null && card.userId === writer) return
		throw new StateRefusal("that change is to a card, and only whoever owns the card decides it.")
	}
	const [session] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const book = (await bookOfLayer(db, owner)) ?? session?.lorebookId ?? null
	if (book != null && (await ownsBook(db, book, writer))) return
	throw new StateRefusal(
		"that change is to the lorebook, and only whoever owns the lorebook decides it."
	)
}

/** The lorebook a book layer belongs to — its own id, its member's, its place's; null when gone. */
async function bookOfLayer(db: Db, owner: StateOwner): Promise<number | null> {
	if (owner.kind === "lorebook") return owner.id
	if (owner.kind === "cast_member") {
		const [row] = await db
			.select({ lorebookId: schema.lorebookBindings.lorebookId })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.id, owner.id))
			.limit(1)
		return row?.lorebookId ?? null
	}
	if (owner.kind === "location") {
		const [row] = await db
			.select({ lorebookId: schema.lorebookEntries.lorebookId })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.id, owner.id))
			.limit(1)
		return row?.lorebookId ?? null
	}
	return null
}

/** This session's pending lines, oldest first — the order they were proposed in. */
export async function pendingProposals(db: Db, sessionId: number) {
	return await db
		.select()
		.from(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, sessionId),
				inArray(schema.stateProposals.status, ["pending"])
			)
		)
		.orderBy(schema.stateProposals.id)
}

/**
 * This session's **superseded** lines (U5f), oldest first — decided, nothing
 * applied, kept under their message so the ledger says why the model's ask
 * never landed. Listed beside the pending ones; retracted with the message
 * like every anchored row.
 */
export async function supersededProposals(db: Db, sessionId: number) {
	return await db
		.select()
		.from(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, sessionId),
				inArray(schema.stateProposals.status, ["superseded"])
			)
		)
		.orderBy(schema.stateProposals.id)
}

/**
 * The lines a surface lists — pending and superseded, oldest first — with
 * every lore reference in a payload given its entry's title (Lair W-GATE D4),
 * as `stateFor` and the ledger name theirs. A proposal stores `{ entryId }`
 * alone, and a line saying "Location → entry 2" names nothing a person wrote.
 * Read-time only: each payload is a copy, and the row keeps the bare id.
 */
export async function listedProposals(db: Db, sessionId: number) {
	const rows = [
		...(await pendingProposals(db, sessionId)),
		...(await supersededProposals(db, sessionId))
	]
		.sort((a, b) => a.id - b.id)
		.map((row) => ({ ...row, payload: { ...((row.payload ?? {}) as Record<string, unknown>) } }))
	await nameLoreRefs(
		db,
		rows.map((r) => r.payload),
		await sessionReadingOf(db, sessionId),
		"session"
	)
	await nameBookOwners(
		db,
		rows.map((r) => r.payload)
	)
	return rows
}

/** What a proposal's line says in front of a change to the book: never the session's words for it. */
const BOOK_OWNER_PREFIX = "Lorebook ·"

/**
 * A change to the BOOK (plan A22) names its owner as the book's — `ownerLabel`
 * on the listed copy, the prefix `describeProposal` puts in front: "Lorebook ·"
 * for the world's own value, "Lorebook · Verity" for a cast member's,
 * "Lorebook · The Crypt" for a place's. A session names only its own layers,
 * and "Weather → storm" under a reply reads as the session's weather when
 * accepting it would change the book every session reads.
 */
async function nameBookOwners(
	db: Db,
	payloads: Record<string, unknown>[]
): Promise<void> {
	const ownerOf = (p: Record<string, unknown>) =>
		p.owner as { kind?: unknown; id?: unknown } | undefined
	const ids = (kind: string) =>
		payloads
			.map(ownerOf)
			.filter((o) => o?.kind === kind && typeof o.id === "number")
			.map((o) => o!.id as number)
	const members = ids("cast_member")
	const places = ids("location")
	const memberNames = new Map(
		members.length
			? (
					await db
						.select({
							id: schema.lorebookBindings.id,
							name: schema.lorebookBindings.name
						})
						.from(schema.lorebookBindings)
						.where(inArray(schema.lorebookBindings.id, members))
				).map((r) => [r.id, r.name] as const)
			: []
	)
	const placeNames = new Map(
		places.length
			? (
					await db
						.select({
							id: schema.lorebookEntries.id,
							title: schema.lorebookEntries.title
						})
						.from(schema.lorebookEntries)
						.where(inArray(schema.lorebookEntries.id, places))
				).map((r) => [r.id, r.title] as const)
			: []
	)
	for (const payload of payloads) {
		const owner = ownerOf(payload)
		if (!owner || typeof owner.id !== "number") continue
		const named =
			owner.kind === "lorebook"
				? ""
				: owner.kind === "cast_member"
					? (memberNames.get(owner.id) ?? "a cast member")
					: owner.kind === "location"
						? (placeNames.get(owner.id) ?? "a place")
						: null
		if (named === null) continue
		payload.ownerLabel = named
			? `${BOOK_OWNER_PREFIX} ${named}`
			: BOOK_OWNER_PREFIX
	}
}

// ── The one gate, with its phases ───────────────────────────────────────────

export interface GateOptions {
	/** Applied immediately, or held for review. */
	mode: "apply" | "propose"
	/**
	 * The run's seed, so a rule's `roll` replays identically. Outside a run the
	 * caller supplies a fresh one and **records it** — an unrecorded seed is a
	 * number nobody can ever explain.
	 */
	seed?: string
	/** Who is speaking, so the rules' `who.speaker` is the right person. */
	speakerId?: number
	/** Share one budget across several gate calls in a turn. */
	budget?: ExpressionBudget
}

/** One rule, and what it did. The receipt reads this. */
export interface RuleFiring {
	slotId: string
	/** The owner whose values it ran against — `world`, or a cast slug. */
	ownerKey: string
	rule: SlotRule
	result: "fired" | "skipped" | "refused"
	/** Why it was skipped or refused — the expression's own sentence. */
	reason?: string
}

export interface GateOutcome {
	applied: number[]
	proposed: number[]
	refused: { change: StateChange; reason: string }[]
	rulesFired: RuleFiring[]
	budget: ExpressionBudget
}

/**
 * The one door into state (R11).
 *
 * Phase order is fixed and is not user-reorderable: **rules**, then
 * **validation and the turn lock**, then **apply or propose**. Extraction
 * scripts run ahead of all three, in the pipeline, and reach here as ordinary
 * `changes` — which is the point of there being one shape either side of the
 * gate.
 *
 * A refusal is a **result**, not a throw. The other changes in the set were
 * still legitimate, and losing a whole turn's state over one bad number is how
 * a keeper's single mistake erases the four things it got right.
 */
export async function applyChangeSet(
	db: Db,
	ctx: WriteContext,
	changes: readonly StateChange[],
	opts: GateOptions
): Promise<GateOutcome> {
	const budget = opts.budget ?? createExpressionBudget()
	const outcome: GateOutcome = {
		applied: [],
		proposed: [],
		refused: [],
		rulesFired: [],
		budget
	}
	if (!changes.length) return outcome

	// ── Phase 1: rules ──────────────────────────────────────────────────
	const all = [
		...changes,
		...(await fireRules(db, ctx, changes, opts, outcome))
	]

	// ── Phase 2 & 3: validate, lock, then apply or propose ──────────────
	//
	// The messages are read once for the whole set. Every write in it is being
	// filed against the same transcript, and re-reading per change would let
	// two changes in one set disagree about whether a reply is sealed.
	const messages = await turnMessages(db, ctx.sessionId)
	const modeOf = loreWriteModeOnce(db, ctx.sessionId)
	for (const change of all) {
		try {
			if (opts.mode === "apply") {
				const done = await applyAutomatic(db, ctx, change, messages, modeOf)
				if ("applied" in done) outcome.applied.push(done.applied)
				else outcome.proposed.push(done.proposed)
			} else
				outcome.proposed.push(
					await proposeChange(db, ctx, change, messages)
				)
		} catch (e) {
			if (e instanceof StateRefusal)
				outcome.refused.push({ change, reason: e.message })
			else throw e
		}
	}
	return outcome
}

/**
 * Phase 1: every rule on every slot the change set touches, once.
 *
 * **Once**, and single-pass: a rule sees the state as it was plus the changes
 * coming in, and never another rule's output. Chaining would need an order
 * nobody wrote down, and the first time two rules fought over one number the
 * answer would depend on declaration order — which is a sheet's business, not a
 * rule's.
 *
 * Rules run for the **owners named in the change set** and no others. A rule
 * that fired on a character nobody touched would be a write appearing from
 * nowhere, which is precisely what the ledger exists to make impossible.
 */
async function fireRules(
	db: Db,
	ctx: WriteContext,
	changes: readonly StateChange[],
	opts: GateOptions,
	outcome: GateOutcome
): Promise<ValueChange[]> {
	const vocabulary = await vocabularyFor(db, ctx.sessionId)
	const withRules = vocabulary.entries.filter((e) => e.decl.rules?.length)
	// The whole state is an expensive read, so it is only paid for when some
	// slot in this session's vocabulary actually has a rule on it.
	if (!withRules.length) return []

	const state = await stateFor(db, ctx.sessionId, {
		speakerId: opts.speakerId,
		seed: opts.seed
	})
	const seed = opts.seed ?? `gate:${ctx.sessionId}`
	const produced: ValueChange[] = []

	// One scope per owner, with the incoming changes laid over the resolved
	// values — a rule reacting to "hp is now 4" has to see 4, not 20.
	const owners = new Map<string, StateOwner>()
	for (const change of changes)
		if (isValueChange(change))
			owners.set(`${change.owner.kind}:${change.owner.id}`, change.owner)

	for (const owner of owners.values()) {
		const facet = ownerFacet(owner.kind)
		const entry =
			owner.kind === "session"
				? undefined
				: owner.kind === "session_location"
					? (state.locations.byId[String(owner.id)] as
							| CastEntry
							| undefined)
					: (state.cast.byId[
							castMemberKey(owner.kind === "player_seat" ? { playerSeatId: owner.id } : owner)
						] as CastEntry | undefined)
		const ownerKey =
			owner.kind === "session"
				? "world"
				: owner.kind === "session_location"
					? entry
						? locationOwnerKey(entry.name)
						: `location:${owner.id}`
					: (entry?.key ?? String(owner.id))
		const base: Record<string, SlotValue> =
			owner.kind === "session"
				? { ...state.world }
				: { ...((entry ?? {}) as Record<string, SlotValue>) }

		const incoming = new Map<string, ValueChange>()
		for (const change of changes)
			if (isValueChange(change) && sameOwner(change.owner, owner)) {
				incoming.set(change.slotId, change)
				const config = await configFor(db, {
					sessionId: ctx.sessionId,
					owner,
					slotId: change.slotId
				})
				try {
					const value = await nextValue(db, ctx, change, config)
					layIn(base, change.slotId, value)
				} catch {
					// A change the write will refuse anyway is not laid in: a
					// rule must react to what will be true, and phase 2 is
					// where the refusal gets its sentence.
				}
			}

		for (const vocab of withRules) {
			if (!vocab.decl.appliesTo.includes(facet)) continue
			const scope: ExpressionScope = {
				state: state as unknown as Record<string, unknown>,
				owner: base,
				who: state.who as unknown as Record<string, unknown>,
				...(incoming.has(vocab.decl.id)
					? {
							change: {
								slotId: vocab.decl.id,
								value: incoming.get(vocab.decl.id)!.value,
								delta: Number(
									incoming.get(vocab.decl.id)!.value ?? 0
								)
							}
						}
					: {})
			}
			for (const [index, rule] of (vocab.decl.rules ?? []).entries()) {
				const firing: RuleFiring = {
					slotId: vocab.decl.id,
					ownerKey,
					rule,
					result: "skipped"
				}
				if (rule.when) {
					const held = evaluate(rule.when, scope, {
						seedLabel: `${seed}:rules:${ownerKey}:${vocab.decl.id}:${index}`,
						budget: outcome.budget
					})
					if (isRefusal(held)) {
						firing.result = "refused"
						firing.reason = held.refusal
						outcome.rulesFired.push(firing)
						continue
					}
					if (!held.value) {
						outcome.rulesFired.push(firing)
						continue
					}
				}
				const op: SlotChangeOp = rule.set
					? "set"
					: rule.add
						? "add"
						: "remove"
				const expr = rule.set ?? rule.add ?? rule.remove ?? ""
				const produced_ = evaluate(expr, scope, {
					seedLabel: `${seed}:rules:${ownerKey}:${vocab.decl.id}:${index}`,
					budget: outcome.budget
				})
				if (isRefusal(produced_)) {
					firing.result = "refused"
					firing.reason = produced_.refusal
					outcome.rulesFired.push(firing)
					continue
				}
				firing.result = "fired"
				outcome.rulesFired.push(firing)
				const value = produced_.value
				produced.push(
					op === "set" || vocab.decl.type !== "list"
						? {
								owner,
								slotId: vocab.decl.id,
								op,
								value: value as SlotValue
							}
						: {
								owner,
								slotId: vocab.decl.id,
								op,
								items: Array.isArray(value)
									? (value as readonly SlotListItem[])
									: [value as SlotListItem]
							}
				)
			}
		}
	}
	return produced
}

const sameOwner = (a: StateOwner, b: StateOwner) =>
	a.kind === b.kind && a.id === b.id

/** One value under both its keys, exactly as the resolver writes them. */
function layIn(
	bag: Record<string, SlotValue>,
	slotId: string,
	value: SlotValue
): void {
	bag[qualifiedSlotKey(slotId)] = value
	bag[slotKey(slotId)] = value
}
