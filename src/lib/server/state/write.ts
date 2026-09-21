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
 * `sessions.state_version` moves by one for every row `setValue` and
 * `movePossession` write — inside the write's transaction, under
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
 * locked transaction.** `setValue` and `movePossession` take the lock first
 * (`lockStateVersion`), then judge the base (`movedSinceBase`), then read
 * what is there now (`nextValue` · `heldQuantity`), then bump and insert —
 * `decideProposal` judges, applies and marks under the same lock, with the
 * proposal's status read again under it, and `transferPossession` reads what
 * is held and makes its take and its give under it. A check or a read made ahead
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

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import {
	applyListOp,
	checkSlotValue,
	getAttributeSlot,
	isAnchorOpen,
	openAnchorFor,
	slotAppliesTo,
	type SlotChangeOp,
	type SlotConfig,
	type SlotRule,
	type SlotScalar,
	type SlotValue,
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
	/** `add`/`remove` on a list: the items going in or coming out. */
	items?: readonly SlotScalar[]
	/** Ledger narration / provenance, in a person's words. */
	note?: string
	/**
	 * The **state version** this change is a delta against (U5f) — what the
	 * writer read before it decided. Absent: against whatever is current.
	 * Never stored in a proposal's payload; it lands in `base_version`.
	 */
	base?: number | null
}

/** A possession moving: `delta` is signed, so taking is giving a negative. */
export interface PossessionChange {
	owner: StateOwner
	entryId: number
	delta: number
	/** The state version this change is a delta against (U5f) — see `ValueChange.base`. */
	base?: number | null
}

/**
 * The shape `core:task/set-state@1` takes on `changes`, that a `state_proposals`
 * payload holds, and that `applyChange` writes. One shape either side of the
 * gate — accepting a proposal must not be a second, differently-validated path.
 */
export type StateChange = ValueChange | PossessionChange

export const isValueChange = (c: StateChange): c is ValueChange =>
	typeof (c as ValueChange).slotId === "string"

/** Refused for a reason a person can read. Callers turn it into their own refusal. */
export class StateRefusal extends Error {}

// ── Anchors ─────────────────────────────────────────────────────────────────

/**
 * The message a write is anchored to when the caller names none: the newest in
 * the session.
 *
 * ⚠ **Kept for the callers that genuinely mean "the newest message"** — a
 * retraction, a durable row's provenance — and no longer what a write anchors
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
	// A persona is a character, so the player's own turns lock on exactly the
	// terms everybody else's do (R9).
	return rows.map((r) => ({
		id: r.id,
		speakerId: r.characterId ?? r.personaId ?? null
	}))
}

const sessionScoped = (kind: OwnerKind) =>
	kind === "session" || kind === "session_cast"

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
		.delete(schema.sessionPossessions)
		.where(eq(schema.sessionPossessions.validFromMessageId, messageId))
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
			`'${input.slotId}' is not a slot this install declares. A genre or an ` +
				`extension declares it; without one there is nothing to validate against.`
		)
	if (!slotAppliesTo(decl, ownerFacet(input.owner.kind)))
		throw new StateRefusal(
			`'${input.slotId}' does not apply to ${input.owner.kind}. It attaches to ` +
				`${decl.appliesTo.join(" and ")}.`
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
	return config
}

/** The owner a session-layer write may name, checked against the session. */
export async function assertSessionOwner(
	db: Db,
	sessionId: number,
	owner: StateOwner
): Promise<void> {
	if (!isOwnerKind(owner.kind))
		throw new StateRefusal(`'${String(owner.kind)}' is not an owner kind.`)
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
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface WriteContext {
	sessionId: number
	updatedBy: StateWriter
	/**
	 * The anchor. Resolved to the **owner's open anchor** when absent, and
	 * checked against the turn lock when present (`anchorFor`).
	 */
	messageId?: number | null
	/** The branch of the world's history. Null is the trunk, which is all there is today. */
	branchId?: number | null
	/** The story-clock anchor a durable row is filed at (R8). */
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

/** What a change targets, for a sentence: the slot's bare key, or the item. */
export const changeTargetName = (change: StateChange): string =>
	isValueChange(change)
		? slotKey(change.slotId)
		: `possession of entry ${change.entryId}`

/**
 * The state version the change's target last **landed** at: the version
 * stamped on the row in force for that owner and slot (or that owner and
 * entry), by the same "latest anchor, later row on a tie" rule the resolver
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
	const rows: Row[] = isValueChange(change)
		? await db
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
		: await db
				.select({
					id: schema.sessionPossessions.id,
					validFromMessageId: schema.sessionPossessions.validFromMessageId,
					stateVersion: schema.sessionPossessions.stateVersion
				})
				.from(schema.sessionPossessions)
				.where(
					and(
						eq(schema.sessionPossessions.sessionId, sessionId),
						eq(schema.sessionPossessions.ownerKind, change.owner.kind),
						eq(schema.sessionPossessions.ownerId, change.owner.id),
						eq(schema.sessionPossessions.entryId, change.entryId)
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
			`'${change.slotId}' is not a slot this install declares.`
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
				? (change.value as readonly SlotScalar[])
				: change.value === undefined || change.value === null
					? []
					: [change.value as SlotScalar])
		const held = Array.isArray(current)
			? (current as readonly SlotScalar[])
			: current === undefined || current === null
				? []
				: [current as SlotScalar]
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
		return Math.trunc(base + delta)
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
	await assertSessionOwner(db, ctx.sessionId, change.owner)
	const config = await configFor(db, {
		sessionId: ctx.sessionId,
		owner: change.owner,
		slotId: change.slotId
	})
	const anchor = await anchorFor(db, ctx, change.owner, messages)
	// The base check, the read of the current value, and the write are ONE
	// locked transaction (U5f review). Judged ahead of the lock, two writers
	// with one base both pass and both land — the second blind over the
	// first, the case the version exists to refuse; read ahead of it, two
	// deltas read the same current value and one is lost. A refusal here
	// rolls the transaction back with nothing bumped.
	return await db.transaction(async (tx) => {
		await lockStateVersion(tx, ctx.sessionId)
		const moved = await movedSinceBase(tx, ctx.sessionId, change, change.base)
		if (moved) throw new StateRefusal(moved)
		const value = await nextValue(tx, ctx, change, config)
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
				...provenance(ctx)
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
			`'${input.slotId}' is not a slot this install declares.`
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
	if (sessionScoped(input.owner.kind))
		await assertSessionOwner(db, ctx.sessionId, input.owner)
	const anchor = await anchorFor(db, ctx, input.owner)
	const [row] = await db
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
			...provenance(ctx)
		})
		.returning({ id: schema.attributeConfigs.id })
	return row!.id
}

/**
 * Move possession of an entry by `delta`, from whatever the owner holds now.
 *
 * A signed delta rather than a set: two writers changing an inventory in one
 * turn are both right about what they did, and only a delta can say so. The
 * result is clamped at zero — "Verity has no arrows left" is a real row, which
 * is what lets a swipe take the removal back.
 */
export async function movePossession(
	db: Db,
	ctx: WriteContext,
	change: PossessionChange,
	messages?: TurnMessage[]
): Promise<number> {
	if (change.owner.kind !== "session" && change.owner.kind !== "session_cast")
		throw new StateRefusal(
			"an inventory is session state: its owner is a cast member or the session."
		)
	await assertSessionOwner(db, ctx.sessionId, change.owner)
	const anchor = await anchorFor(db, ctx, change.owner, messages)
	// The base check, the read of what is held, and the write are ONE locked
	// transaction (U5f review) — exactly as `setValue`: two deltas in flight
	// cannot both read the same "held" and lose one, and two writers with one
	// base cannot both pass the check and both land.
	return await db.transaction(async (tx) => {
		await lockStateVersion(tx, ctx.sessionId)
		const moved = await movedSinceBase(tx, ctx.sessionId, change, change.base)
		if (moved) throw new StateRefusal(moved)
		const stateVersion = await nextStateVersion(tx, ctx.sessionId)
		const held = await heldQuantity(
			tx,
			ctx.sessionId,
			change.owner,
			change.entryId
		)
		const [row] = await tx
			.insert(schema.sessionPossessions)
			.values({
				sessionId: ctx.sessionId,
				ownerKind: change.owner.kind,
				ownerId: change.owner.id,
				entryId: change.entryId,
				quantity: Math.max(0, held + Math.trunc(change.delta)),
				validFromMessageId: anchor,
				updatedBy: ctx.updatedBy,
				stateVersion,
				...provenance(ctx)
			})
			.returning({ id: schema.sessionPossessions.id })
		return row!.id
	})
}

/**
 * Hand an item from one owner to another, as two edges and one anchor.
 *
 * Not a third kind of row: a transfer *is* a take and a give, and giving it its
 * own storage would mean an inventory could be read two ways.
 *
 * ⚠ Each side keeps its **own** anchor, which is what the turn lock means for
 * two owners at once: Verity's give is filed against Verity's latest reply and
 * Marrow's take against Marrow's, and a single shared anchor would seal one of
 * them against a reply that was never theirs.
 *
 * ⚠ **The check of what is held, the take and the give are ONE locked
 * transaction** (U5f review ruling). Checked ahead of the lock, two transfers
 * of the last item both pass, the second take clamps at zero and its give
 * still lands — the item duplicated. Under it, the second reads what the
 * first left and is refused by the same sentence. The two edges keep their
 * two version numbers (each `movePossession` is one row, one bump — the
 * version is turn order, one number per row, and nothing here needs a
 * shared stamp) and land together at the commit, so no reader sees the take
 * without the give.
 */
export async function transferPossession(
	db: Db,
	ctx: WriteContext,
	input: {
		from: StateOwner
		to: StateOwner
		entryId: number
		quantity?: number
	}
): Promise<{ from: number; to: number }> {
	const quantity = Math.max(1, Math.trunc(input.quantity ?? 1))
	const messages = await turnMessages(db, ctx.sessionId)
	return await db.transaction(async (tx) => {
		await lockStateVersion(tx, ctx.sessionId)
		const held = await heldQuantity(
			tx,
			ctx.sessionId,
			input.from,
			input.entryId
		)
		if (held < quantity)
			throw new StateRefusal(
				held
					? `that owner is only carrying ${held} of those.`
					: "that owner is not carrying that."
			)
		return {
			from: await movePossession(
				tx,
				ctx,
				{ owner: input.from, entryId: input.entryId, delta: -quantity },
				messages
			),
			to: await movePossession(
				tx,
				ctx,
				{ owner: input.to, entryId: input.entryId, delta: quantity },
				messages
			)
		}
	})
}

/** How many of an entry an owner is carrying, by the edge in force. */
export async function heldQuantity(
	db: Db,
	sessionId: number,
	owner: StateOwner,
	entryId: number
): Promise<number> {
	const rows = await db
		.select({
			quantity: schema.sessionPossessions.quantity,
			validFromMessageId: schema.sessionPossessions.validFromMessageId,
			id: schema.sessionPossessions.id
		})
		.from(schema.sessionPossessions)
		.where(
			and(
				eq(schema.sessionPossessions.sessionId, sessionId),
				eq(schema.sessionPossessions.ownerKind, owner.kind),
				eq(schema.sessionPossessions.ownerId, owner.id),
				eq(schema.sessionPossessions.entryId, entryId)
			)
		)
	let best: (typeof rows)[number] | undefined
	for (const row of rows) {
		if (!best) {
			best = row
			continue
		}
		const a = row.validFromMessageId ?? -1
		const b = best.validFromMessageId ?? -1
		if (a > b || (a === b && row.id > best.id)) best = row
	}
	return best?.quantity ?? 0
}

// ── One change, applied ─────────────────────────────────────────────────────

/**
 * Apply one change, whichever arm it is.
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
	return isValueChange(change)
		? await setValue(db, ctx, change, messages)
		: await movePossession(db, ctx, change, messages)
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
	if (isValueChange(change)) {
		await assertSessionOwner(db, ctx.sessionId, change.owner)
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
	}
	const anchor = await anchorFor(db, ctx, change.owner, messages)
	// The base rides the row, not the payload (U5f): the caller's when it
	// named one, else the version as it stands now — either way, what the
	// accept will compare against.
	const { base, ...payload } = change
	const baseVersion = base ?? (await stateVersionOf(db, ctx.sessionId))
	const [row] = await db
		.insert(schema.stateProposals)
		.values({
			sessionId: ctx.sessionId,
			messageId: anchor,
			kind: isValueChange(change) ? "value" : "possession",
			payload: payload as unknown as Record<string, unknown>,
			status: "pending",
			proposedBy: ctx.updatedBy,
			baseVersion
		})
		.returning({ id: schema.stateProposals.id })
	return row!.id
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
	accept: boolean
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
				messageId: proposal.messageId
			},
			// The base was judged above, under this lock; the write is the
			// rebased delta, and its own (re-entrant) lock and check are moot.
			{ ...change, base: null }
		)
		await mark("accepted")
		return { status: "accepted", appliedId }
	})
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
	for (const change of all) {
		try {
			if (opts.mode === "apply")
				outcome.applied.push(
					await applyChange(db, ctx, change, messages)
				)
			else
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
				: (state.cast.byId[String(owner.id)] as CastEntry | undefined)
		const ownerKey =
			owner.kind === "session" ? "world" : (entry?.key ?? String(owner.id))
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
				possessions: state.possessions[ownerKey] ?? [],
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
									? (value as readonly SlotScalar[])
									: [value as SlotScalar]
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
