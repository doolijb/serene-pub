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

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import {
	applyListOp,
	checkSlotValue,
	getAttributeSlot,
	i18nText,
	isAnchorOpen,
	isSlotLoreRef,
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
	type TurnMessage,
	type TurnOwner
} from "@serene-pub/sdk"
import {
	configFor,
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
import { locationOwnerKey } from "$lib/server/state/keys"
import { sessionReadingOf, writeDatingAt } from "$lib/server/state/reading"
import { bookCalendarOf } from "$lib/server/state/storyTime"
import { dateProblem } from "$lib/shared/lorebooks/storyDate"
import { sessionLoreWriteMode } from "$lib/server/state/loreWriteMode"
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
	const rows = await db
		.select({ id: schema.messages.id })
		.from(schema.messages)
		.where(eq(schema.messages.sessionId, sessionId))
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
		.where(eq(schema.messages.sessionId, sessionId))
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

const sessionScoped = (kind: OwnerKind) =>
	kind === "session" || kind === "session_cast" || kind === "session_location"

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
	if (!sessionScoped(owner.kind)) return null
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
 * Take back everything one message changed.
 *
 * ⚠ **Called on REPLACEMENT, not on deletion.** A deleted message is handled by
 * the foreign keys — every anchored row cascades off `messages.id`. What the
 * database cannot see is a swipe or a regenerate, which keeps the row and its
 * id and replaces only the text: nothing is deleted, so nothing cascades, and
 * the values the old reply wrote would otherwise survive the reply itself. That
 * is the case this exists for.
 */
export async function retractStateAnchoredTo(
	db: Db,
	messageId: number
): Promise<void> {
	await db
		.delete(schema.attributeValues)
		.where(eq(schema.attributeValues.validFromMessageId, messageId))
	await db
		.delete(schema.attributeConfigs)
		.where(eq(schema.attributeConfigs.validFromMessageId, messageId))
	await db
		.delete(schema.stateProposals)
		.where(eq(schema.stateProposals.messageId, messageId))
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
	if (owner.kind === "session" || owner.kind === "session_cast" || owner.kind === "session_location") {
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
	// `sessions.lorebook_id` — see `sessionLorebookIds`.
	const books = new Set(await sessionLorebookIds(db, sessionId))
	// The session's line: a sibling fork's own entry is not a thing this
	// session's story has, and a shelved one is not one it may hand out.
	const reading = (await sessionReadingOf(db, sessionId)) ?? MAIN_HEAD
	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			lorebookId: schema.lorebookEntries.lorebookId,
			title: schema.lorebookEntries.title,
			typeId: schema.lorebookEntries.typeId,
			enabled: schema.lorebookEntries.enabled,
			archived: schema.lorebookEntries.archived,
			onLine: sql<boolean>`(${entryOnLineSql(reading)})`
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
				reading,
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
		if (!row.onLine)
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
			.select({ personaId: schema.sessionPersonas.personaId })
			.from(schema.sessionPersonas)
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
	}
	if (owner.kind === "session_location" || owner.kind === "location") {
		// 🚧 Phase 4: a place of THIS session's world — one the session sees
		// (plan A27, `seesPlace(…, "session")`), exactly the set `sessionLinks`
		// lists. The durable layer (`location`) is the same place, so the
		// same set.
		const reading = await sessionReadingOf(db, sessionId)
		const seen = reading
			? await placesOnReading(db, reading.lorebookId, reading, "session", [owner.id])
			: []
		if (!reading || !seen.length)
			throw new StateRefusal(
				"that place is not a location in this session's lorebook."
			)
		// The place's own layer is the book's; this session's is play.
		if (owner.kind === "location")
			await assertBookWriter(db, sessionId, reading.lorebookId, userId)
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
	session_location: schema.lorebookEntries
} as const satisfies Record<OwnerKind, unknown>

/** What a write is told when its owner went while it was being made. */
const OWNER_GONE: Record<OwnerKind, string> = {
	card: "that character no longer exists.",
	session_cast: "that character no longer exists.",
	cast_member: "that cast member is no longer in this session's lorebook.",
	lorebook: "that lorebook no longer exists.",
	session: "that session no longer exists.",
	location: "that place is no longer in this session's lorebook.",
	session_location: "that place is no longer in this session's lorebook."
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
				...(sessionScoped(change.owner.kind)
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
		const result = applyListOp(held, op, items, config)
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
				sessionId: sessionScoped(change.owner.kind) ? ctx.sessionId : null,
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
	const descriptor = (input.config ?? {}).descriptor
	if (descriptor !== undefined && !String(descriptor ?? "").trim())
		throw new StateRefusal(
			`${decl.id} cannot be described as nothing here. A descriptor is the ` +
				`sentence the model reads about this slot in this world; leave the key ` +
				`out to keep the declaration's own.`
		)
	// Every kind, the template layers included: configuring another user's
	// book or card from one's own session is the same hole as writing it.
	await assertSessionOwner(db, ctx.sessionId, input.owner, ctx.userId)
	await assertBookWritesOn(db, ctx.sessionId, input.owner)
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
				sessionId: sessionScoped(input.owner.kind) ? ctx.sessionId : null,
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
	 * `superseded` only: the targets that moved since the proposal's base —
	 * one entry for a one-change proposal, by name (`changeTargetName`).
	 */
	movedSlots?: string[]
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
	if (sessionScoped(owner.kind)) return
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
					: (state.cast.byId[String(owner.id)] as
							| CastEntry
							| undefined)
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
