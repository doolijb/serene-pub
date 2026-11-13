/**
 * 🚧 **Give to…** (PLAN-dc-after-walk2 Q0-4, owner ruling ★4, 2026-10-19):
 * a piece handed from one sheet to another — or put down at a place — as
 * ONE host decision, never two writes a widget strings together.
 *
 * A give is **two sides**, each judged by the one hand-edit decider
 * (`state/handEdits.ts`, plan §25 D): `take-from` on the giver — skipped
 * when the giver is a place (a pick-up is the receiver's side only) — and
 * `put-on` on the receiver — skipped when the receiver is a place (a drop is
 * the giver's side only).
 *
 * - **Direct** when the giver's hand may take from the giver's sheet and put
 *   on the receiver's (the session's owner by default; a player on their own
 *   characters, or anyone's where their item-move level says so; anybody
 *   putting a thing down at a place of the session): the piece leaves one
 *   list and joins the other in one transaction, merged into the receiver's
 *   own count of the same piece (`countPieces`, by its holding key — the
 *   walk's "holds each piece once… in it twice" is gone).
 * - **Offered** to a player's seat the giver may not put on (the receiver's
 *   side refused as not theirs): a pending change (`state_proposals`, kind
 *   `value`, `payload.offer`) that its player accepts or declines, and the
 *   giver may withdraw (`decideOffer`, through `decideProposal`). Nothing
 *   moves until it is accepted; the giver's part is then written as the
 *   giver — their offer is their consent.
 * - **Refused** in words: more than is held, a side the decider refuses (its
 *   sentence), and — from a player's character — a cast member nobody plays
 *   (a companion keeps no sheet a gift could land on: it is handed things in
 *   the story instead).
 *
 * Each outcome hands back the one line the table hears.
 */
import { and, eq, isNull } from "drizzle-orm"
import { getAttributeSlot, isSlotLoreRef, isSlotPiece, slotListItemText, type SlotListItem } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	applyChange,
	assertSessionOwner,
	assertTracked,
	pieceCount,
	pieceHoldingKey,
	StateRefusal,
	withPieceCount
} from "$lib/server/state/write"
import { qualifiedSlotKey, slotKey, stateFor } from "$lib/server/state/resolve"
import { handEditJudge, handEditRefusal } from "$lib/server/state/handEdits"
import { carryKeyOf } from "$lib/server/state/carries"
import { memberFormOn } from "$lib/server/state/memberForm"
import type { StateOwner } from "$lib/server/state/owners"

type Db = any

/** The owners a piece moves between: a cast member, a player's seat, or a place. */
const GIVE_KINDS: ReadonlySet<string> = new Set(["session_cast", "player_seat", "session_location"])

/** 🚧 ⏳ S4: a `seated_member` (a character seat in member form) is one only once the flip is on (`memberForm.ts`). */
const isGiveKind = (kind: string): boolean => GIVE_KINDS.has(kind) || (kind === "seated_member" && memberFormOn())

/** What an offer holds beside the receiver's change (`state_proposals.payload.offer`). */
export interface PieceOffer {
	from: StateOwner
	/** The piece as stored, with the count offered. */
	item: SlotListItem
	count: number
	/** The giver, as the person who offered it: theirs to withdraw, and whose write the giving is. */
	by: number
	/** Words, as of the offer: the line and the widget read them. */
	fromLabel: string
	toLabel: string
	itemName: string
}

/** Whether a proposal payload is an offer. */
export const isOfferPayload = (payload: unknown): payload is { owner: StateOwner; slotId: string; offer: PieceOffer } =>
	!!payload &&
	typeof payload === "object" &&
	!!(payload as { offer?: unknown }).offer &&
	typeof (payload as { offer?: unknown }).offer === "object"

/** A piece's name as a person reads it, its count apart: its own override, else the reading the host filled in. */
const nameOf = (item: SlotListItem): string => {
	if (isSlotPiece(item) && item.kind !== "inline") {
		const own = item.overrides?.name
		const read = item.resolved?.name
		if (typeof own === "string" && own.trim()) return own.trim()
		if (typeof read === "string" && read.trim()) return read.trim()
	}
	const one = isSlotPiece(item) || isSlotLoreRef(item) ? withPieceCount(item, 1) : item
	return slotListItemText(one)
}

/** "Potion of healing", or "Potion of healing ×2". */
const counted = (name: string, n: number) => (n > 1 ? `${name} ×${n}` : name)

/**
 * The owner's list at `slotId` as the session reads it now — pieces with
 * their names read (`withPiecesRead`) — and the owner's name.
 */
async function heldBy(
	db: Db,
	sessionId: number,
	owner: StateOwner,
	slotId: string
): Promise<{ items: SlotListItem[]; label: string } | null> {
	const { withPiecesRead } = await import("$lib/server/rulesets/read")
	const state = await withPiecesRead(db, await stateFor(db, sessionId))
	const index = owner.kind === "session_location" ? state.locations : state.cast
	const key =
		owner.kind === "player_seat"
			? `player_seat:${owner.id}`
			: owner.kind === "seated_member"
				? carryKeyOf(owner)
				: String(owner.id)
	const bag = (index as { byId?: Record<string, Record<string, unknown>> } | undefined)?.byId?.[key]
	if (!bag) return null
	const value = bag[qualifiedSlotKey(slotId)] ?? bag[slotKey(slotId)]
	const items = Array.isArray(value) ? (value as SlotListItem[]) : value == null ? [] : [value as SlotListItem]
	return { items, label: typeof bag.name === "string" && bag.name.trim() ? bag.name.trim() : "someone" }
}

/** A piece as stored again: the host-filled name and reading of a reference dropped. */
function stored(item: SlotListItem): SlotListItem {
	if (!item || typeof item !== "object" || Array.isArray(item)) return item
	const { resolved: _read, ...rest } = item as Record<string, unknown>
	if (isSlotPiece(item) && item.kind !== "inline") delete rest.name
	return rest as SlotListItem
}

/** How many of the piece `item` names the list holds (its holding, by key). */
const holdingOf = (items: readonly SlotListItem[], item: SlotListItem): number => {
	const key = pieceHoldingKey(item)
	if (key === null) return items.some((i) => JSON.stringify(stored(i)) === JSON.stringify(stored(item))) ? 1 : 0
	const held = items.find((i) => pieceHoldingKey(i) === key)
	return held ? pieceCount(held) : 0
}

/** Whether `owner` is a live player's seat here — a card-less seat, or a card played as one. */
async function isPlayersSeat(db: Db, sessionId: number, owner: StateOwner): Promise<boolean> {
	if (owner.kind === "player_seat") return true
	if (owner.kind !== "session_cast") return false
	const [seat] = await db
		.select({ id: schema.sessionPersonas.id })
		.from(schema.sessionPersonas)
		.where(
			and(
				eq(schema.sessionPersonas.sessionId, sessionId),
				eq(schema.sessionPersonas.personaId, owner.id),
				isNull(schema.sessionPersonas.removedAt)
			)
		)
		.limit(1)
	return !!seat
}

/**
 * Give `count` of the piece at `index` of `from`'s `slotId` list to `to`, as
 * `userId`. Throws `StateRefusal` with the sentence; otherwise says how it
 * went and the line the table hears.
 */
export async function givePiece(
	db: Db,
	p: {
		sessionId: number
		userId: number
		from: StateOwner
		to: StateOwner
		slotId: string
		index: number
		count?: number
		/**
		 * 🚧 What the caller already knows, for the hand-edit judge: the socket
		 * passes the hearing with the hidden stats it shows, so a seater gives
		 * from (or to) a shown seat's holder-only list as they may set it
		 * (★s4-fb-3, owner 2026-11-10).
		 */
		known?: Parameters<typeof handEditRefusal>[2]
	}
): Promise<{ given: "direct" | "offered"; line: string; proposalId?: number }> {
	const n = p.count ?? 1
	if (!Number.isInteger(n) || n < 1) throw new StateRefusal("Give at least one.")
	if (!isGiveKind(p.from.kind) || !isGiveKind(p.to.kind))
		throw new StateRefusal("Things are given between characters and places.")
	if (p.from.kind === p.to.kind && p.from.id === p.to.id) throw new StateRefusal("Give it to somebody else.")
	await assertTracked(db, p.sessionId, p.slotId)
	if (getAttributeSlot(p.slotId)?.type !== "list") throw new StateRefusal("Only a list's things can be given.")
	// The giver's side: what their hand may not take from, they may not give from. A place is the
	// receiver's side only (a pick-up) — it need only be this session's.
	await assertSessionOwner(db, p.sessionId, p.from, p.userId)
	if (p.from.kind !== "session_location") {
		const refused = await handEditRefusal(db, {
			sessionId: p.sessionId,
			userId: p.userId,
			owner: p.from,
			slotId: p.slotId,
			act: "take-from"
		}, p.known)
		if (refused) throw new StateRefusal(refused.sentence)
	}
	const giver = await heldBy(db, p.sessionId, p.from, p.slotId)
	const target = await heldBy(db, p.sessionId, p.to, p.slotId)
	if (!giver || !target) throw new StateRefusal("That is not someone in this session.")
	const item = giver.items[p.index]
	if (item === undefined) throw new StateRefusal(`That is no longer on ${giver.label}'s sheet.`)
	const name = nameOf(item)
	const have = isSlotPiece(item) || isSlotLoreRef(item) ? pieceCount(item) : 1
	if (n > have) throw new StateRefusal(`${giver.label} has only ${have} ${name}.`)
	const one = isSlotPiece(item) || isSlotLoreRef(item) ? withPieceCount(stored(item), n) : stored(item)
	const what = counted(name, n)
	const place = p.to.kind === "session_location"
	// A player's character gives to another player's character, or puts it
	// down: a cast member nobody plays keeps no sheet a gift could land on,
	// and is handed things in the story (★4; `giveTargets` offers the same).
	const toSeat = !place && (await isPlayersSeat(db, p.sessionId, p.to))
	if (!place && !toSeat && (await isPlayersSeat(db, p.sessionId, p.from)))
		throw new StateRefusal(`${target.label} keeps no sheet you can give to: give it in the story instead.`)

	// The receiver's side: judged `put-on` unless it is a place (a drop is the giver's side only).
	// Refused as not theirs, on a player's seat: the seat's player is asked instead (an offer).
	await assertSessionOwner(db, p.sessionId, p.to, p.userId)
	let direct = true
	if (!place) {
		const refused = await handEditRefusal(db, {
			sessionId: p.sessionId,
			userId: p.userId,
			owner: p.to,
			slotId: p.slotId,
			act: "put-on"
		}, p.known)
		if (refused) {
			if (refused.cause !== "not-theirs" || !toSeat) throw new StateRefusal(refused.sentence)
			direct = false
		}
	}
	if (direct) {
		const ctx = { sessionId: p.sessionId, updatedBy: "user" as const, userId: p.userId }
		await db.transaction(async (tx: Db) => {
			await applyChange(tx, ctx, { owner: p.from, slotId: p.slotId, op: "remove", items: [one] })
			await applyChange(tx, ctx, { owner: p.to, slotId: p.slotId, op: "add", items: [one] })
		})
		return {
			given: "direct",
			line: place ? `${giver.label} leaves ${what} at ${target.label}.` : `${giver.label} gives ${what} to ${target.label}.`
		}
	}
	const offer: PieceOffer = {
		from: p.from,
		item: one,
		count: n,
		by: p.userId,
		fromLabel: giver.label,
		toLabel: target.label,
		itemName: name
	}
	const [row] = await db
		.insert(schema.stateProposals)
		.values({
			sessionId: p.sessionId,
			messageId: null,
			kind: "value",
			payload: { owner: p.to, slotId: p.slotId, offer } as unknown as Record<string, unknown>,
			status: "pending",
			proposedBy: `user:${p.userId}`,
			baseVersion: null
		})
		.returning({ id: schema.stateProposals.id })
	return { given: "offered", line: `${giver.label} offers ${what} to ${target.label}.`, proposalId: row!.id }
}

/**
 * Answer an offer, inside `decideProposal`'s transaction (`tx`, under the
 * session's state-version lock): accepted by whoever may write the
 * receiver's sheet (judged `put-on` by the hand-edit decider, as the one
 * accepting) — the giver's part written as the giver, the receiver's as the
 * one accepting, the piece merged into their count; declined by the session's
 * owner or the receiver's own player, or withdrawn by the giver. An offer whose piece the giver no
 * longer holds is closed, said so, and nothing moves.
 */
export async function decideOffer(
	tx: Db,
	proposal: { id: number; sessionId: number; payload: unknown },
	accept: boolean,
	userId: number | null | undefined,
	mark: (status: "accepted" | "rejected") => Promise<void>
): Promise<{ status: "accepted" | "rejected"; line: string }> {
	if (!isOfferPayload(proposal.payload)) throw new StateRefusal("That is not an offer.")
	const { owner: to, slotId, offer } = proposal.payload
	const what = counted(offer.itemName, offer.count)
	const byGiver = userId != null && userId === offer.by
	if (!accept) {
		if (!byGiver) {
			await assertSessionOwner(tx, proposal.sessionId, to, userId)
			// Turning an offer down is the session's owner's, or the receiver's own player's; a
			// watcher's never (no person at all keeps today's path).
			if (userId != null) {
				const judge = await handEditJudge(tx, proposal.sessionId, userId)
				await judge.know(to)
				if (!(judge.role === "owner" || (judge.role === "player" && judge.whose(to) === "own")))
					throw new StateRefusal(judge.says(judge.role === "watcher" ? "watching" : "not-theirs", { owner: to, slotId }))
			}
		}
		await mark("rejected")
		return {
			status: "rejected",
			line: byGiver
				? `${offer.fromLabel} takes back the offer of ${what}.`
				: `${offer.toLabel} turns down ${what} from ${offer.fromLabel}.`
		}
	}
	await assertSessionOwner(tx, proposal.sessionId, to, userId)
	// The receiver's side, judged as the one accepting (`put-on`); nobody at all keeps today's path.
	if (userId != null) {
		const refused = await handEditRefusal(tx, { sessionId: proposal.sessionId, userId, owner: to, slotId, act: "put-on" })
		if (refused) throw new StateRefusal(refused.sentence)
	}
	// The giver's side, re-judged at accept as the one who offered (`take-from`; scope review 2026-11-05:
	// a level changed while the offer waited must still hold). A place gives freely.
	if (offer.by != null && offer.from.kind !== "location" && offer.from.kind !== "session_location") {
		const giverRefused = await handEditRefusal(tx, { sessionId: proposal.sessionId, userId: offer.by, owner: offer.from, slotId, act: "take-from" })
		if (giverRefused) throw new StateRefusal(giverRefused.sentence)
	}
	const giver = await heldBy(tx, proposal.sessionId, offer.from, slotId)
	if (!giver || holdingOf(giver.items, offer.item) < offer.count) {
		await mark("rejected")
		return { status: "rejected", line: `${offer.fromLabel} no longer has ${what} to give.` }
	}
	await applyChange(
		tx,
		{ sessionId: proposal.sessionId, updatedBy: "user", userId: offer.by },
		{ owner: offer.from, slotId, op: "remove", items: [offer.item] }
	)
	await applyChange(
		tx,
		{ sessionId: proposal.sessionId, updatedBy: "user", userId },
		{ owner: to, slotId, op: "add", items: [offer.item] }
	)
	await mark("accepted")
	return { status: "accepted", line: `${offer.toLabel} accepts ${what} from ${offer.fromLabel}.` }
}
