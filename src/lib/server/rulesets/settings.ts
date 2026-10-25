/**
 * 🚧 A session's **ruleset settings** (UI: _Rules options_; PLAN-rulesets §8,
 * W3-A 2026-10-16) — where they are stored, how a change is checked, and what
 * the session form is shown.
 *
 * Stored on `sessions.ruleset_settings` (0105) as `{ [rulesetId]: {
 * [settingName]: choiceId } }`: only what the session chose, keyed by ruleset
 * so a session that changes ruleset and back keeps its choices. A setting
 * left unsaid plays its default (`settingValues`, the SDK's
 * `rulesetSettingValues`). A **preset** is one way to fill the values — it is
 * expanded when applied and never stored by name; the form shows the preset
 * whose values the session's are exactly (`presetOf`).
 *
 * Also here, because both read "which rulesets does this session play": the
 * **offer gate** for a slot a ruleset owns (`offerableSlot`) and the
 * degrade of a foreign repertoire (`withoutForeignRepertoire`).
 */

import { eq } from "drizzle-orm"
import {
	getRuleset,
	i18nText,
	parseRepertoireAddress,
	presetsOf,
	settingsOf,
	slotPickableIn,
	slotRulesetOwners,
	type AttributeSlotProps,
	type RulesetDecl,
	type SlotId
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { presetOf, settingValues } from "./conventions"

type Db = any

/** What `sessions.ruleset_settings` holds. */
export type StoredRulesetSettings = Record<string, Record<string, string>>

/** The stored column read defensively: records of string choices only. */
export function storedRulesetSettings(raw: unknown): StoredRulesetSettings {
	const out: StoredRulesetSettings = {}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
	for (const [rulesetId, values] of Object.entries(raw as Record<string, unknown>)) {
		if (!values || typeof values !== "object" || Array.isArray(values)) continue
		const own: Record<string, string> = {}
		for (const [k, v] of Object.entries(values as Record<string, unknown>)) if (typeof v === "string") own[k] = v
		out[rulesetId] = own
	}
	return out
}

/**
 * The rulesets a session plays: its primary, then its add-ons in stacking
 * order. ⏳ Add-ons (§16: `rulesets: { primary, addons }`) are not stored
 * yet, so this is the primary alone until a column holds them.
 */
export function sessionRulesets(row: { primaryRuleset?: string | null } | null | undefined): string[] {
	return row?.primaryRuleset ? [row.primaryRuleset] : []
}

/**
 * 🚧 The one gate on which slots a session is offered (audit A20; PLAN §15 A)
 * — the picker's listing (`state:attributes`) and the vocabulary
 * (`vocabularyFor`) both ask it, so the picker never lists a slot the
 * vocabulary would drop.
 *
 *  · Every slot a ruleset owns (`slotRulesetOwners`: listed under its
 *    `stats` unless `borrowed`, or spelled `rulesetOwned`) is left out where that
 *    ruleset is neither the session's primary nor one of its add-ons — the
 *    genre's own sheets included: a Story session of a Dungeon Crawler never
 *    reads Vis Itineris's abilities.
 *  · `from: 'pick'` (the world's, the session's own, a pick, the addable
 *    list) also leaves out a slot a mechanism keeps (`pickable: false`);
 *    the `'baseline'` (the genre's sheets and loose slots) still brings it.
 *
 * The SDK's `slotPickableIn` asks the pick question of one ruleset.
 */
export function offerableSlot(
	decl: Pick<AttributeSlotProps, "pickable" | "rulesetOwned"> & { id?: SlotId },
	rulesets: readonly string[],
	from: "baseline" | "pick"
): boolean {
	if (from === "pick") return rulesets.length ? rulesets.some((r) => slotPickableIn(decl, r)) : slotPickableIn(decl, null)
	// The baseline brings a mechanism's slot (`pickable: false`) — only the
	// ruleset gate applies: owned (listed under a ruleset's `stats`, or
	// spelled `rulesetOwned`) by a ruleset the session plays, or by none.
	const owners = slotRulesetOwners(decl)
	return !owners.length || owners.some((o) => rulesets.includes(o))
}

/**
 * 🚧 The **ruleset setting** gate (2026-10-18, `whenRulesetSetting` on the
 * slot): whether a session tracks a slot only one way of playing its ruleset
 * uses — Vis Itineris's spell points at a `casting: points` table, a crawl's
 * spell slots at a `casting: slots` one. True when the slot names no
 * setting, when the session does not play the ruleset it names (the
 * ruleset gate, `offerableSlot`, answers that), or when the session's value
 * for the setting — its default when none was chosen — is one of the slot's
 * choices. The vocabulary (`vocabularyFor`) and the picker
 * (`state:attributes`) both ask it, as they ask the seat count (`minSeats`).
 */
export function rulesetSettingAllows(
	decl: object,
	session: { primaryRuleset?: string | null; rulesetSettings?: unknown } | null | undefined
): boolean {
	const when = (decl as { whenRulesetSetting?: { ruleset?: unknown; setting?: unknown; is?: unknown } }).whenRulesetSetting
	if (!when || typeof when.ruleset !== "string" || typeof when.setting !== "string" || !Array.isArray(when.is)) return true
	// 🚧 A session that does not play the ruleset does not track it either
	// (PLAN-dc-after-walk2 Q2-3): the setting is that ruleset's, and a Story
	// sheet showed an empty "Spell slots" row.
	if (!sessionRulesets(session).includes(when.ruleset)) return false
	const ruleset = getRuleset(when.ruleset)
	if (!ruleset) return true
	const stored = storedRulesetSettings(session?.rulesetSettings)[when.ruleset] ?? {}
	const value = settingValues(ruleset, { values: stored })[when.setting]
	// A setting the ruleset does not declare narrows nothing.
	if (value === undefined) return true
	return (when.is as unknown[]).includes(value)
}

/**
 * 🚧 A slot's resolved config as a session playing `rulesets` reads it
 * (PLAN §15 B): a `repertoire` naming a ruleset the session does not play
 * is struck, so the slot **degrades, never drops** — it stays a list of
 * inline pieces (name and description), with no shape and no mechanics,
 * which every widget and the handler already read. Untouched otherwise.
 */
export function withoutForeignRepertoire<C extends Readonly<Record<string, unknown>>>(config: C, rulesets: readonly string[]): C {
	const address = typeof config.repertoire === "string" ? parseRepertoireAddress(config.repertoire) : undefined
	if (!address || rulesets.includes(address.ruleset)) return config
	const { repertoire: _struck, ...rest } = config
	return rest as unknown as C
}

/** The ruleset a session plays and the values it stored, from its row. */
export async function sessionRulesetSettingsOf(
	db: Db,
	sessionId: number
): Promise<{ primaryRuleset: string; stored: StoredRulesetSettings } | null> {
	const [row] = await db
		.select({ primaryRuleset: schema.sessions.primaryRuleset, rulesetSettings: schema.sessions.rulesetSettings })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return null
	return { primaryRuleset: row.primaryRuleset, stored: storedRulesetSettings(row.rulesetSettings) }
}

/** A refusal to store ruleset settings, as a sentence the owner can act on. */
export class RulesetSettingsRefusal extends Error {}

/** A preset named by its id or its label, either case. */
function presetNamed(decl: RulesetDecl, name: string) {
	const want = name.trim().toLowerCase()
	return presetsOf(decl).find((p) => p.id.toLowerCase() === want || (i18nText(p.label) ?? "").toLowerCase() === want)
}

/**
 * Check a change against the ruleset's declared settings and return the
 * values to store: what was stored, a preset's values laid over, then the
 * values sent. Unlike `settingValues` — which lets an unknown name fall
 * through on read — a WRITE naming a setting, choice or preset the ruleset
 * does not declare is refused with the sentence: storing it would be a save
 * that changes nothing.
 */
export function checkedRulesetSettings(
	decl: RulesetDecl,
	before: Readonly<Record<string, string>>,
	change: { preset?: unknown; values?: unknown }
): Record<string, string> {
	const name = i18nText(decl.name) ?? decl.id
	// 🚧 Its options, read through the SDK (a ruleset in sections says them under `options`).
	const settings = settingsOf(decl)
	const presets = presetsOf(decl)
	const out: Record<string, string> = { ...before }
	if (change.preset !== undefined && change.preset !== null) {
		const preset = typeof change.preset === "string" ? presetNamed(decl, change.preset) : undefined
		if (!preset)
			throw new RulesetSettingsRefusal(
				`${name} has no preset called ${JSON.stringify(change.preset)}.` +
					(presets.length ? ` Its presets are ${presets.map((p) => i18nText(p.label) ?? p.id).join(", ")}.` : "")
			)
		Object.assign(out, preset.values)
	}
	if (change.values !== undefined && change.values !== null) {
		if (typeof change.values !== "object" || Array.isArray(change.values))
			throw new RulesetSettingsRefusal("Send the rules options as a record of option name to choice.")
		for (const [k, v] of Object.entries(change.values as Record<string, unknown>)) {
			const setting = settings[k]
			if (!setting) throw new RulesetSettingsRefusal(`${name} has no option called '${k}'.`)
			if (typeof v !== "string" || !setting.choices.some((c) => c.id === v))
				throw new RulesetSettingsRefusal(
					`'${String(v)}' is not a choice for ${i18nText(setting.label) ?? k}; choose ${setting.choices
						.map((c) => i18nText(c.label) ?? c.id)
						.join(" or ")}.`
				)
			out[k] = v
		}
	}
	// What is stored is only what the ruleset declares (a retired name drops).
	for (const k of Object.keys(out)) if (!settings[k]) delete out[k]
	return out
}

/** One option as the session form shows it. */
export interface RulesOptionView {
	id: string
	label: string
	description?: string
	value: string
	default: string
	choices: { id: string; label: string; description?: string }[]
}

/** What the session form's _Rules options_ group draws. */
export interface RulesOptionsView {
	rulesetId: string
	rulesetName: string
	/** Not installed: nothing to choose, the stored values kept. */
	installed: boolean
	options: RulesOptionView[]
	presets: { id: string; label: string; description?: string }[]
	/** The preset the session's values match exactly, if any. */
	preset?: string
	/** The values the session stored (the rest are defaults). */
	stored: Record<string, string>
}

export function rulesOptionsFor(rulesetId: string, stored: Readonly<Record<string, string>>): RulesOptionsView {
	const decl = getRuleset(rulesetId)
	if (!decl) return { rulesetId, rulesetName: rulesetId, installed: false, options: [], presets: [], stored: { ...stored } }
	const values = settingValues(decl, { values: stored })
	const text = (v: Parameters<typeof i18nText>[0]) => i18nText(v) ?? undefined
	const preset = presetOf(decl, values)
	return {
		rulesetId,
		rulesetName: text(decl.name) ?? rulesetId,
		installed: true,
		options: Object.entries(settingsOf(decl)).map(([id, s]) => ({
			id,
			label: text(s.label) ?? id,
			...(text(s.description) ? { description: text(s.description) } : {}),
			value: values[id] ?? s.default,
			default: s.default,
			choices: s.choices.map((c) => ({
				id: c.id,
				label: text(c.label) ?? c.id,
				...(text(c.description) ? { description: text(c.description) } : {})
			}))
		})),
		presets: presetsOf(decl).map((p) => ({
			id: p.id,
			label: text(p.label) ?? p.id,
			...(text(p.description) ? { description: text(p.description) } : {})
		})),
		...(preset ? { preset } : {}),
		stored: { ...stored }
	}
}

/**
 * Store a change to the session's settings for `rulesetId` (its primary when
 * absent): checked, merged over what it stored, the other rulesets' kept.
 * Throws `RulesetSettingsRefusal` with the sentence; returns the form's view.
 */
export async function setSessionRulesetSettings(
	db: Db,
	sessionId: number,
	change: { rulesetId?: unknown; preset?: unknown; values?: unknown }
): Promise<RulesOptionsView> {
	const found = await sessionRulesetSettingsOf(db, sessionId)
	if (!found) throw new RulesetSettingsRefusal("Session not found.")
	const rulesetId = typeof change.rulesetId === "string" && change.rulesetId ? change.rulesetId : found.primaryRuleset
	if (!sessionRulesets(found).includes(rulesetId))
		throw new RulesetSettingsRefusal(`This session does not play ${rulesetId}, so it has no options for it.`)
	const decl = getRuleset(rulesetId)
	if (!decl)
		throw new RulesetSettingsRefusal(`${rulesetId} is not installed, so its options cannot be changed. What the session chose is kept.`)
	const next = checkedRulesetSettings(decl, found.stored[rulesetId] ?? {}, change)
	await db
		.update(schema.sessions)
		.set({ rulesetSettings: { ...found.stored, [rulesetId]: next } })
		.where(eq(schema.sessions.id, sessionId))
	return rulesOptionsFor(rulesetId, next)
}
