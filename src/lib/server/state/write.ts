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
 * ## Every write is an append, and every write is anchored
 *
 * Nothing here updates a row in place. A change is a new row with a higher
 * `valid_from_message_id`, so the value in force is a question of ordering and
 * the history is not destroyed by the next edit. Anchoring is what makes swipe
 * and regenerate honest without receipts: replacing message 47 retracts what
 * message 47 changed, and the new reply proposes its own
 * (`retractStateAnchoredTo`).
 */

import { and, desc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	checkSlotValue,
	getAttributeSlot,
	slotAppliesTo,
	type SlotConfig,
	type SlotValue
} from "@serene-pub/sdk"
import { configFor } from "$lib/server/state/resolve"
import {
	isOwnerKind,
	ownerFacet,
	type OwnerKind,
	type StateOwner
} from "$lib/server/state/owners"

/** `user` · `run:<id>` · `script:<id>` — free text, and the ledger reads it. */
export type StateWriter = string

/** An attribute change. */
export interface ValueChange {
	owner: StateOwner
	slotId: string
	value: SlotValue
}

/** A possession moving: `delta` is signed, so taking is giving a negative. */
export interface PossessionChange {
	owner: StateOwner
	entryId: number
	delta: number
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
 * Newest rather than "the one being generated", because a user editing a bar
 * mid-turn is changing the world as of what has been said so far — and because
 * a row anchored to a message that does not exist yet could not be retracted
 * with it.
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
 */
export async function validateValue(
	db: Db,
	input: {
		sessionId?: number
		owner: StateOwner
		slotId: string
		value: SlotValue
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
	const config = await configFor(db, {
		sessionId: input.sessionId,
		owner: input.owner,
		slotId: input.slotId
	})
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
		if (!seated.length)
			throw new StateRefusal(
				"that character is not in this session's cast."
			)
	}
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface WriteContext {
	sessionId: number
	updatedBy: StateWriter
	/** The anchor. Resolved to the session's newest message when absent. */
	messageId?: number | null
}

const sessionScoped = (kind: OwnerKind) =>
	kind === "session" || kind === "session_cast"

/**
 * Write one attribute value.
 *
 * An append, always: the row in force is the one with the highest anchor, so a
 * second edit at the same message wins by id and the first is still evidence.
 */
export async function setValue(
	db: Db,
	ctx: WriteContext,
	change: ValueChange
): Promise<number> {
	await assertSessionOwner(db, ctx.sessionId, change.owner)
	await validateValue(db, {
		sessionId: ctx.sessionId,
		owner: change.owner,
		slotId: change.slotId,
		value: change.value
	})
	const anchor =
		ctx.messageId === undefined
			? await newestMessageId(db, ctx.sessionId)
			: ctx.messageId
	const [row] = await db
		.insert(schema.attributeValues)
		.values({
			ownerKind: change.owner.kind,
			ownerId: change.owner.id,
			slotId: change.slotId,
			value: { v: change.value },
			sessionId: sessionScoped(change.owner.kind) ? ctx.sessionId : null,
			validFromMessageId: anchor,
			updatedBy: ctx.updatedBy
		})
		.returning({ id: schema.attributeValues.id })
	return row!.id
}

/**
 * Attach a slot to an owner, or change what attaching decided.
 *
 * Stores the **deviations** — `{ max: 40 }` — and never the resolved whole, so
 * raising a genre's default still reaches every owner who did not override it.
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
	if (!slotAppliesTo(decl, ownerFacet(input.owner.kind)))
		throw new StateRefusal(
			`'${input.slotId}' attaches to ${decl.appliesTo.join(" and ")}, not to ` +
				`${input.owner.kind}.`
		)
	if (sessionScoped(input.owner.kind))
		await assertSessionOwner(db, ctx.sessionId, input.owner)
	const anchor =
		ctx.messageId === undefined
			? await newestMessageId(db, ctx.sessionId)
			: ctx.messageId
	const [row] = await db
		.insert(schema.attributeConfigs)
		.values({
			ownerKind: input.owner.kind,
			ownerId: input.owner.id,
			slotId: input.slotId,
			config: input.config ?? {},
			sessionId: sessionScoped(input.owner.kind) ? ctx.sessionId : null,
			validFromMessageId: sessionScoped(input.owner.kind) ? anchor : null,
			updatedBy: ctx.updatedBy
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
	change: PossessionChange
): Promise<number> {
	if (change.owner.kind !== "session" && change.owner.kind !== "session_cast")
		throw new StateRefusal(
			"an inventory is session state: its owner is a cast member or the session."
		)
	await assertSessionOwner(db, ctx.sessionId, change.owner)
	const anchor =
		ctx.messageId === undefined
			? await newestMessageId(db, ctx.sessionId)
			: ctx.messageId
	const held = await heldQuantity(
		db,
		ctx.sessionId,
		change.owner,
		change.entryId
	)
	const [row] = await db
		.insert(schema.sessionPossessions)
		.values({
			sessionId: ctx.sessionId,
			ownerKind: change.owner.kind,
			ownerId: change.owner.id,
			entryId: change.entryId,
			quantity: Math.max(0, held + Math.trunc(change.delta)),
			validFromMessageId: anchor,
			updatedBy: ctx.updatedBy
		})
		.returning({ id: schema.sessionPossessions.id })
	return row!.id
}

/**
 * Hand an item from one owner to another, as two edges and one anchor.
 *
 * Not a third kind of row: a transfer *is* a take and a give, and giving it its
 * own storage would mean an inventory could be read two ways.
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
	const held = await heldQuantity(
		db,
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
	const anchor =
		ctx.messageId === undefined
			? await newestMessageId(db, ctx.sessionId)
			: ctx.messageId
	const at = { ...ctx, messageId: anchor }
	return {
		from: await movePossession(db, at, {
			owner: input.from,
			entryId: input.entryId,
			delta: -quantity
		}),
		to: await movePossession(db, at, {
			owner: input.to,
			entryId: input.entryId,
			delta: quantity
		})
	}
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
	change: StateChange
): Promise<number> {
	return isValueChange(change)
		? await setValue(db, ctx, change)
		: await movePossession(db, ctx, change)
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
	change: StateChange
): Promise<number> {
	if (isValueChange(change)) {
		await assertSessionOwner(db, ctx.sessionId, change.owner)
		await validateValue(db, {
			sessionId: ctx.sessionId,
			owner: change.owner,
			slotId: change.slotId,
			value: change.value
		})
	}
	const anchor =
		ctx.messageId === undefined
			? await newestMessageId(db, ctx.sessionId)
			: ctx.messageId
	const [row] = await db
		.insert(schema.stateProposals)
		.values({
			sessionId: ctx.sessionId,
			messageId: anchor,
			kind: isValueChange(change) ? "value" : "possession",
			payload: change as unknown as Record<string, unknown>,
			status: "pending",
			proposedBy: ctx.updatedBy
		})
		.returning({ id: schema.stateProposals.id })
	return row!.id
}

/**
 * Accept or reject one held change.
 *
 * Accepting writes it with the **proposer's** provenance, not the deciding
 * user's: the ledger's job is to say where a number came from, and "the model
 * asked and you agreed" is a different sentence from "you set it".
 */
export async function decideProposal(
	db: Db,
	proposalId: number,
	accept: boolean
): Promise<{ status: "accepted" | "rejected"; appliedId?: number }> {
	const [proposal] = await db
		.select()
		.from(schema.stateProposals)
		.where(eq(schema.stateProposals.id, proposalId))
	if (!proposal) throw new StateRefusal("that proposal no longer exists.")
	if (proposal.status !== "pending")
		throw new StateRefusal(`that proposal was already ${proposal.status}.`)

	let appliedId: number | undefined
	if (accept)
		appliedId = await applyChange(
			db,
			{
				sessionId: proposal.sessionId,
				updatedBy: proposal.proposedBy || "user",
				messageId: proposal.messageId
			},
			proposal.payload as unknown as StateChange
		)

	await db
		.update(schema.stateProposals)
		.set({
			status: accept ? "accepted" : "rejected",
			decidedAt: new Date()
		})
		.where(eq(schema.stateProposals.id, proposalId))
	return { status: accept ? "accepted" : "rejected", appliedId }
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
