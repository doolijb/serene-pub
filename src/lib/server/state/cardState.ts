/**
 * 🚧 A character card's own stats — the **dowry**'s values and limits — read
 * and written with no session (plans/DESIGN-card-strokes-and-dowry-2026-10-11
 * §B.4, the form's **Stats** tab).
 *
 * ## The card layer, and nothing under or over it
 *
 * Owner `{ kind: 'card', id: characters.id }`, `session_id` NULL, no anchor,
 * no line, no date: a card belongs to no book and to no run, so its rows are
 * the plain template layer every session seating the character reads beneath
 * its own (`owners.ts resolutionChain`). A read here never reaches a session —
 * asking about a card must not (`owners.ts`) — so what this answers is what
 * the CARD says, which is what a new session inherits.
 *
 * ## What the card carries (its vocabulary)
 *
 * Its sheets (`owner_sheets`, in order), each sheet's slots that a character
 * may carry, and then every **loose** slot the card holds a value or a
 * configuration for — a loose slot on the card is the card's own unnamed
 * sheet (R6). First mention fixes the position, as a session's vocabulary
 * does.
 *
 * ## Written through the gate's own checks
 *
 * `write.ts` is the gate: its `validateValue` judges every value (the
 * declaration, its config, retired, `appliesTo`), and `holdOwner` reads the
 * card again under the write's transaction so a delete landing first refuses
 * the write rather than leaving rows for nobody. Its session writers
 * (`setValue`, `configure`) need a session to anchor to and a card edit has
 * none — authoring is not play, and author-layer edits are not turn-locked
 * (R9) — so the rows are inserted here, as `placeStats.ts` does for a place.
 * A change set is one transaction under the card's own lock: all of it lands,
 * or none.
 *
 * ## Who
 *
 * The card's owner (`characters.user_id`), and nobody else — the rule
 * `characters:update` keeps. Anyone else reads the card as missing.
 */

import { and, eq, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	attributeSheets,
	attributeSlots,
	getAttributeSlot,
	isSlotLoreRef,
	sheetSlotAppliesTo,
	slotAppliesTo,
	slotPickable,
	slotValueForStorage,
	type AttributeSheetDecl,
	type AttributeSlotDecl,
	type SlotConfig,
	type SlotValue
} from "@serene-pub/sdk"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import { configFor, inForce } from "$lib/server/state/resolve"
import { holdOwner, StateRefusal, validateValue } from "$lib/server/state/write"
import { ownerSheets } from "$lib/server/state/declarations"
import type { StateOwner } from "$lib/server/state/owners"

/** One stat of a card holds at most this much — the place editor's limits. */
export const CARD_STAT_MAX_ITEMS = 500
export const CARD_STAT_MAX_CHARS = 20_000

/** A slot the card carries, and the sheet that first named it (absent: loose). */
export interface CardVocabularyEntry {
	decl: AttributeSlotDecl
	sheetId?: string
}

export interface CardState {
	characterId: number
	/** The card's sheets, in order — every id, declared or not. */
	sheets: string[]
	vocabulary: CardVocabularyEntry[]
	/** The card's own value per slot id, present only when set (a cleared value is absent). */
	values: Record<string, SlotValue>
	/** The configuration in force on the card per vocabulary slot: the declaration's, with the card's deviations over it. */
	configs: Record<string, SlotConfig>
	/** The card's own deviations per slot id, present only when it has some. */
	ownConfigs: Record<string, SlotConfig>
	/**
	 * What a read falls back to per vocabulary slot when the card holds no
	 * value: the default of the sheet entry that named the slot, else the
	 * declaration's. Present only when there is one.
	 */
	defaults: Record<string, SlotValue>
}

/**
 * One change to a card's layer. `value` and `config` may come together; at
 * least one must. `value: null` clears the card's value (the read falls back
 * to the default); `config: null` clears the card's deviations.
 */
export interface CardStateChange {
	slotId: string
	value?: SlotValue
	config?: SlotConfig | null
}

const cardOwner = (characterId: number): StateOwner => ({ kind: "card", id: characterId })

/** The sentence every caller who is not the card's owner gets — another user's card reads as missing. */
export const CARD_NOT_FOUND = "Character not found."

/** Refuses anyone but the card's owner, in the words a missing card gets. */
export async function assertCardOwner(
	db: Db,
	characterId: number,
	userId: number | null | undefined
): Promise<void> {
	if (!Number.isInteger(characterId) || userId == null) throw new StateRefusal(CARD_NOT_FOUND)
	const [card] = await db
		.select({ userId: schema.characters.userId })
		.from(schema.characters)
		.where(eq(schema.characters.id, characterId))
		.limit(1)
	if (!card || card.userId !== userId) throw new StateRefusal(CARD_NOT_FOUND)
}

/** A slot a character may carry and a person may pick (core's own mechanisms are not offered). */
export const castPickable = (decl: AttributeSlotDecl): boolean =>
	slotAppliesTo(decl, "cast") && slotPickable(decl)

/** A sheet a character may carry: one of its slots lands on a character. */
export const castSheet = (sheet: AttributeSheetDecl): boolean =>
	sheet.slots.some((entry) => {
		const decl = getAttributeSlot(entry.id)
		return !!decl && sheetSlotAppliesTo(entry, decl).includes("cast")
	})

/** The registry a card's Stats tab picks from: sheets and slots a character may carry, retired ones included. */
export function cardAvailable(): { sheets: AttributeSheetDecl[]; slots: AttributeSlotDecl[] } {
	return {
		sheets: attributeSheets().filter(castSheet),
		slots: attributeSlots().filter(castPickable)
	}
}

/** The card's own rows — values or configs — for every slot, newest decided by `inForce`. */
async function cardRows(db: Db, characterId: number) {
	const owner = and(
		isNull(schema.attributeValues.sessionId),
		eq(schema.attributeValues.ownerKind, "card"),
		eq(schema.attributeValues.ownerId, characterId)
	)
	const values = await db.select().from(schema.attributeValues).where(owner)
	const configs = await db
		.select()
		.from(schema.attributeConfigs)
		.where(
			and(
				isNull(schema.attributeConfigs.sessionId),
				eq(schema.attributeConfigs.ownerKind, "card"),
				eq(schema.attributeConfigs.ownerId, characterId)
			)
		)
	return { values, configs }
}

/** A card's stats as the card holds them (see the header). Owner check is the caller's. */
export async function cardStateFor(db: Db, characterId: number): Promise<CardState> {
	const owner = cardOwner(characterId)
	const sheetRows = await ownerSheets(db, owner)
	const vocabulary: CardVocabularyEntry[] = []
	const seen = new Set<string>()
	const defaults: Record<string, SlotValue> = {}
	const take = (decl: AttributeSlotDecl | undefined, sheetId?: string, sheetDefault?: SlotValue) => {
		if (!decl || seen.has(decl.id)) return
		seen.add(decl.id)
		vocabulary.push(sheetId !== undefined ? { decl, sheetId } : { decl })
		const fallback = sheetDefault !== undefined ? sheetDefault : decl.default
		if (fallback !== undefined && fallback !== null) defaults[decl.id] = fallback
	}
	for (const row of sheetRows)
		for (const entry of row.decl?.slots ?? []) {
			const decl = getAttributeSlot(entry.id)
			if (decl && sheetSlotAppliesTo(entry, decl).includes("cast"))
				take(decl, row.sheetId, entry.default)
		}

	const rows = await cardRows(db, characterId)
	const values: Record<string, SlotValue> = {}
	const ownConfigs: Record<string, SlotConfig> = {}
	const looseIds = [...new Set([...rows.values, ...rows.configs].map((r) => r.slotId))].sort()
	for (const slotId of looseIds) {
		const value = inForce(rows.values.filter((r) => r.slotId === slotId))
		const config = inForce(rows.configs.filter((r) => r.slotId === slotId))
		const v = value?.value?.v as SlotValue | undefined
		const hasValue = v !== null && v !== undefined
		const c = (config?.config ?? null) as SlotConfig | null
		const hasConfig = !!c && Object.keys(c).length > 0
		if (hasValue) values[slotId] = v
		if (hasConfig) ownConfigs[slotId] = c
		// A loose slot is one the card holds something for: a cleared value
		// and a cleared config bring nothing.
		if (hasValue || hasConfig) take(getAttributeSlot(slotId))
	}
	// Values the card holds for a slot nothing declares any more cannot be
	// drawn and are not offered; they stay stored, as every retired value does.
	for (const slotId of Object.keys(values)) if (!seen.has(slotId)) delete values[slotId]
	for (const slotId of Object.keys(ownConfigs)) if (!seen.has(slotId)) delete ownConfigs[slotId]

	const configs: Record<string, SlotConfig> = {}
	for (const { decl } of vocabulary) configs[decl.id] = await configFor(db, { owner, slotId: decl.id })

	return {
		characterId,
		sheets: sheetRows.map((r) => r.sheetId),
		vocabulary,
		values,
		configs,
		ownConfigs,
		defaults
	}
}

/** The checks `write.ts configure` makes of a configuration, made of the card's. */
function assertConfigurable(slotId: string, config: SlotConfig | null): AttributeSlotDecl {
	const decl = getAttributeSlot(slotId)
	if (!decl) throw new StateRefusal(`'${slotId}' is not a slot this pub declares.`)
	const label = i18nTextIn(decl.label) ?? decl.id
	if (decl.retired)
		throw new StateRefusal(
			`${label} is retired, so nothing new is attached to it. Everything already stored is kept ` +
				`and still shown — revive the slot to change what it is configured as.`
		)
	if (!slotAppliesTo(decl, "cast"))
		throw new StateRefusal(`${label} attaches to ${decl.appliesTo.join(" and ")}, not to a character.`)
	if (config !== null && (typeof config !== "object" || Array.isArray(config)))
		throw new StateRefusal(`${label}'s limits must be a set of named settings.`)
	const descriptor = (config ?? {}).descriptor
	if (descriptor !== undefined && !String(descriptor ?? "").trim())
		throw new StateRefusal(
			`${label} cannot be described as nothing here. A descriptor is the sentence the model reads ` +
				`about this slot; leave the key out to keep the declaration's own.`
		)
	return decl
}

/** A card belongs to no lorebook, so a value naming a lore entry has nothing to name. */
function assertNoLoreRefs(label: string, value: SlotValue): void {
	const items = Array.isArray(value) ? value : [value]
	if (items.some((item) => isSlotLoreRef(item)))
		throw new StateRefusal(
			`${label} can't hold a lore entry on a card: a card belongs to no lorebook. Name the thing ` +
				`in words, or set it on the character's cast member in a lorebook.`
		)
}

function assertWithinLimits(label: string, value: SlotValue): void {
	const items = Array.isArray(value) ? value.length : 0
	const chars = JSON.stringify(value ?? null).length
	if (items > CARD_STAT_MAX_ITEMS || chars > CARD_STAT_MAX_CHARS)
		throw new StateRefusal(
			`That is too much for ${label}: one stat of a card holds at most ${CARD_STAT_MAX_ITEMS} items ` +
				`and ${CARD_STAT_MAX_CHARS.toLocaleString("en")} characters.`
		)
}

/**
 * Apply a change set to the card's layer — all of it or none (see the
 * header). Each change's config lands before its value, so the value is
 * judged against the limits it is being saved with. Refusals are
 * `StateRefusal`s a person can read.
 */
export async function applyCardChanges(
	db: Db,
	input: { characterId: number; userId: number; changes: readonly CardStateChange[] }
): Promise<void> {
	await assertCardOwner(db, input.characterId, input.userId)
	if (!Array.isArray(input.changes) || !input.changes.length)
		throw new StateRefusal("There is nothing to save.")
	for (const change of input.changes) {
		if (!change || typeof change.slotId !== "string" || !change.slotId)
			throw new StateRefusal("Name the stat to change.")
		if (!("value" in change) && !("config" in change))
			throw new StateRefusal("Say what changes: a value, its limits, or both.")
	}
	const owner = cardOwner(input.characterId)
	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cardState'), ${input.characterId})`)
		await holdOwner(tx, owner)
		for (const change of input.changes) {
			if ("config" in change) {
				const config = (change.config ?? null) as SlotConfig | null
				assertConfigurable(change.slotId, config)
				await tx.insert(schema.attributeConfigs).values({
					ownerKind: owner.kind,
					ownerId: owner.id,
					slotId: change.slotId,
					// Deviations only; an empty set is the card saying "none".
					config: config ?? {},
					sessionId: null,
					validFromMessageId: null,
					updatedBy: "user"
				})
			}
			if ("value" in change) {
				const decl = getAttributeSlot(change.slotId)
				const label = decl ? (i18nTextIn(decl.label) ?? decl.id) : `'${change.slotId}'`
				const value = slotValueForStorage((change.value ?? null) as SlotValue)
				if (value !== null) {
					assertWithinLimits(label, value)
					assertNoLoreRefs(label, value)
				}
				// The gate's own judgement: declared, applies to a character,
				// not retired, and within the config in force (read under the
				// transaction, so a config landing in this same set counts).
				await validateValue(tx, {
					owner,
					slotId: change.slotId,
					value,
					config: decl ? await configFor(tx, { owner, slotId: change.slotId }) : undefined
				})
				await tx.insert(schema.attributeValues).values({
					ownerKind: owner.kind,
					ownerId: owner.id,
					slotId: change.slotId,
					value: { v: value },
					// The template layer: no session, no message — authoring is not play.
					sessionId: null,
					validFromMessageId: null,
					updatedBy: "user"
				})
			}
		}
	})
}

/** Every session seating the character — as a character or as a persona — for a re-read after its card moved. */
export async function sessionsSeating(db: Db, characterId: number): Promise<number[]> {
	const seated = await db
		.select({ id: schema.sessionCharacters.sessionId })
		.from(schema.sessionCharacters)
		.where(
			and(eq(schema.sessionCharacters.characterId, characterId), isNull(schema.sessionCharacters.removedAt))
		)
	const voiced = await db
		.select({ id: schema.sessionPersonas.sessionId })
		.from(schema.sessionPersonas)
		.where(
			and(eq(schema.sessionPersonas.personaId, characterId), isNull(schema.sessionPersonas.removedAt))
		)
	return [...new Set([...seated, ...voiced].map((r) => r.id).filter((id): id is number => typeof id === "number"))]
}

