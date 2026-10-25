/**
 * 🚧 **Attribute carries** (RF fix 2, item 3, 2026-10-23): whether one
 * holder carries one attribute, in one session.
 *
 * A ruleset attribute names the owner KINDS that carry it (`carriedBy`);
 * this is the per-holder switch beside it. A holder who does not carry an
 * attribute has it **not shown** (the sheet, the cast), **not read** (the
 * state every prompt and function reads leaves it out for them) and **not
 * written** (a write to it for them is refused) — and keeps what it held,
 * so carrying it again brings the value back. No row is the default:
 * everyone `carriedBy` names carries it. An attribute the ruleset marks
 * `required` is carried whatever a row says, and cannot be switched off.
 *
 * Who may switch it: whoever plays the holder, and the session's owner (the
 * game master) for anyone; the world and places, the owner alone
 * (`state:setCarry`). Stored in `attribute_carries` (0122), one row per
 * holder and attribute, session-layer owners only.
 *
 * ⚠ Not `session_attribute_picks` (what the whole session tracks) and not
 * `appliesTo` (which owner kinds may hold a slot at all).
 */
import { and, eq } from "drizzle-orm"
import { getAttributeSlot, getRuleset, i18nText, rulesetAttributeSlots, rulesetSections, type SlotAppliesTo } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { castMemberKey } from "$lib/server/state/keys"
import type { StateOwner } from "$lib/server/state/owners"

/** The owner kinds a carry is switched for: the session layer's. */
export const CARRY_OWNER_KINDS = ["session", "session_cast", "player_seat", "session_location"] as const
export type CarryOwnerKind = (typeof CARRY_OWNER_KINDS)[number]

export const isCarryOwner = (owner: { kind: string }): owner is StateOwner & { kind: CarryOwnerKind } =>
	(CARRY_OWNER_KINDS as readonly string[]).includes(owner.kind)

/**
 * The key a holder's carries are filed under, as `state.configs` keys its
 * owners: `world`, a character id, `player_seat:<id>`, `location:<id>`.
 */
export function carryKeyOf(owner: { kind: string; id: number }): string {
	if (owner.kind === "session") return "world"
	if (owner.kind === "player_seat") return castMemberKey({ id: 0, playerSeatId: owner.id })
	if (owner.kind === "session_location") return `location:${owner.id}`
	return String(owner.id)
}

/** One attribute a holder may carry or not: a ruleset attribute the session plays, by its slot. */
export interface CarryableAttribute {
	slotId: string
	rulesetId: string
	attributeId: string
	label: string
	/** The owner kinds that carry it (`carriedBy`; default each character). */
	carriedBy: readonly SlotAppliesTo[]
	/** Every holder carries it: never switched off. */
	required: boolean
}

/** The attributes of the rulesets `plays` names, by slot: what a carry may switch. */
export function carryableAttributes(plays: readonly string[]): Map<string, CarryableAttribute> {
	const out = new Map<string, CarryableAttribute>()
	for (const rulesetId of plays) {
		const ruleset = getRuleset(rulesetId)
		if (!ruleset) continue
		const attributes = rulesetSections(ruleset).attributes ?? []
		if (!attributes.length) continue
		const slots = rulesetAttributeSlots({ id: ruleset.id, attributes })
		for (const a of attributes) {
			const slotId = slots.get(a.id)
			if (!slotId || out.has(slotId)) continue
			out.set(slotId, {
				slotId,
				rulesetId,
				attributeId: a.id,
				label: i18nText(a.name) ?? i18nText(getAttributeSlot(slotId)?.label) ?? a.id,
				carriedBy: a.carriedBy?.length ? a.carriedBy : ["cast"],
				required: a.required === true
			})
		}
	}
	return out
}

/** The slots the rulesets `plays` names require every holder to carry. */
export const requiredCarrySlots = (plays: readonly string[]): Set<string> =>
	new Set([...carryableAttributes(plays).values()].filter((a) => a.required).map((a) => a.slotId))

/** Every carry row of a session: by holder key, slot → carries. */
export async function carryRowsOf(db: Db, sessionId: number): Promise<Map<string, Map<string, boolean>>> {
	const rows = await db
		.select({
			ownerKind: schema.attributeCarries.ownerKind,
			ownerId: schema.attributeCarries.ownerId,
			slotId: schema.attributeCarries.slotId,
			carries: schema.attributeCarries.carries
		})
		.from(schema.attributeCarries)
		.where(eq(schema.attributeCarries.sessionId, sessionId))
	const out = new Map<string, Map<string, boolean>>()
	for (const r of rows) {
		const key = carryKeyOf({ kind: r.ownerKind, id: r.ownerId })
		let m = out.get(key)
		if (!m) out.set(key, (m = new Map()))
		m.set(r.slotId, r.carries)
	}
	return out
}

/**
 * What each holder does NOT carry, by holder key: the slots switched off for
 * them, less any the session's rulesets require. Empty for a session nobody
 * switched anything in.
 */
export async function notCarriedFor(db: Db, sessionId: number, plays: readonly string[]): Promise<Map<string, Set<string>>> {
	const rows = await carryRowsOf(db, sessionId)
	if (!rows.size) return new Map()
	const required = requiredCarrySlots(plays)
	const out = new Map<string, Set<string>>()
	for (const [key, slots] of rows) {
		const off = new Set([...slots].filter(([slotId, carries]) => !carries && !required.has(slotId)).map(([slotId]) => slotId))
		if (off.size) out.set(key, off)
	}
	return out
}

/**
 * Whether `owner` carries `slotId` in the session: true unless switched off
 * for them, and always for one the rules require. `plays` is read only when
 * a row says no (the session's rulesets, else asked of the session).
 */
export async function carries(db: Db, sessionId: number, owner: StateOwner, slotId: string, plays?: readonly string[]): Promise<boolean> {
	if (!isCarryOwner(owner)) return true
	const [row] = await db
		.select({ carries: schema.attributeCarries.carries })
		.from(schema.attributeCarries)
		.where(
			and(
				eq(schema.attributeCarries.sessionId, sessionId),
				eq(schema.attributeCarries.ownerKind, owner.kind),
				eq(schema.attributeCarries.ownerId, owner.id),
				eq(schema.attributeCarries.slotId, slotId)
			)
		)
		.limit(1)
	if (!row || row.carries) return true
	return requiredCarrySlots(plays ?? (await sessionPlays(db, sessionId))).has(slotId)
}

/** The rulesets a session plays (its primary, then add-ons). */
async function sessionPlays(db: Db, sessionId: number): Promise<string[]> {
	const [session] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const { sessionRulesets } = await import("$lib/server/rulesets/settings")
	return sessionRulesets(session)
}

/** The facet an owner kind carries as (`carriedBy`'s words). */
const facetOf = (kind: CarryOwnerKind): SlotAppliesTo => (kind === "session" ? "world" : kind === "session_location" ? "location" : "cast")

/**
 * Switch whether `owner` carries the attribute filed under `slotId`. Refused
 * (a sentence) for an attribute no ruleset the session plays has, one the
 * owner's kind never carries, or one every holder must carry. The caller
 * checks who may (`state:setCarry`).
 */
export async function setAttributeCarry(
	db: Db,
	input: { sessionId: number; owner: StateOwner; slotId: string; carries: boolean; plays: readonly string[]; by: string }
): Promise<{ refused: string } | { ok: true }> {
	if (!isCarryOwner(input.owner)) return { refused: "Only someone or something in the session carries an attribute here." }
	const attribute = carryableAttributes(input.plays).get(input.slotId)
	if (!attribute) return { refused: "That is not an attribute these rules give anyone to carry." }
	if (!attribute.carriedBy.includes(facetOf(input.owner.kind))) return { refused: `${attribute.label} is never carried there.` }
	if (!input.carries && attribute.required) return { refused: `Everyone carries ${attribute.label}: the rules require it.` }
	await db
		.insert(schema.attributeCarries)
		.values({
			sessionId: input.sessionId,
			ownerKind: input.owner.kind,
			ownerId: input.owner.id,
			slotId: input.slotId,
			carries: input.carries,
			updatedBy: input.by
		})
		.onConflictDoUpdate({
			target: [schema.attributeCarries.sessionId, schema.attributeCarries.ownerKind, schema.attributeCarries.ownerId, schema.attributeCarries.slotId],
			set: { carries: input.carries, updatedBy: input.by, createdAt: new Date() }
		})
	return { ok: true }
}
