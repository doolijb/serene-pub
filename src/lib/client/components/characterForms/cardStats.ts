/**
 * 🚧 The character form's **Stats** tab, as arithmetic
 * (DESIGN-card-strokes-and-dowry §B.4): what a card carries into every
 * session it joins — its sheets, its starting values and their limits.
 *
 * The drawing reuses the session widgets' own plain-TypeScript half
 * (`@serene-pub/core-catalog/session-state`) for which control a stat's shape
 * is, so a card's stat reads the same here as in the Stats widget. The server
 * decides what the card carries; this file draws what it said and turns the
 * person's edits into ONE `cardState:set` change set.
 */

import { shownValueText, slotKind, type SlotKind } from "@serene-pub/core-catalog/session-state"
import type { AttributeSlotProps, SlotValue } from "@serene-pub/sdk"

type Read = Sockets.CardState.Get.Response

/** One stat the card carries. */
export interface CardStatRow {
	slot: Sockets.State.SlotDescriptor
	kind: SlotKind
	/** The card's own value; undefined when it holds none (the default stands). */
	value: SlotValue | undefined
	/** What a read falls back to; undefined when there is none. */
	fallback: SlotValue | undefined
	/** The limits in force: the declaration's with the card's over them. */
	config: Record<string, unknown>
	/** The card's own deviations; undefined when it has none. */
	ownConfig: Record<string, unknown> | undefined
	/** False for a retired or derived stat: shown, never written. */
	writable: boolean
}

/** The stats of one sheet, or the card's loose ones (`sheetId` null). */
export interface CardStatGroup {
	sheetId: string | null
	label: string
	rows: CardStatRow[]
}

const t = (s: string) => s

/** A value as a person reads it ("" when there is none). */
export const valueText = (slot: Sockets.State.SlotDescriptor, value: unknown): string =>
	value === undefined ? "" : shownValueText(slot, value, t)

/** The card's stats, grouped under the sheet that first named each, loose ones last. */
export function cardStatGroups(read: Read): CardStatGroup[] {
	const sheetLabel = new Map(read.available.sheets.map((s) => [s.id, s.label]))
	const groups = new Map<string | null, CardStatGroup>()
	for (const id of read.sheets)
		groups.set(id, { sheetId: id, label: sheetLabel.get(id) ?? id, rows: [] })
	for (const slot of read.vocabulary) {
		const sheetId = slot.sheetId ?? null
		let group = groups.get(sheetId)
		if (!group) {
			group = {
				sheetId,
				label: sheetId ? (sheetLabel.get(sheetId) ?? sheetId) : "This character's own",
				rows: []
			}
			groups.set(sheetId, group)
		}
		group.rows.push({
			slot,
			kind: slotKind(slot as never),
			value: read.values[slot.slotId],
			fallback: read.defaults?.[slot.slotId],
			config: read.configs[slot.slotId] ?? {},
			ownConfig: read.ownConfigs[slot.slotId],
			writable: slot.type !== "derived" && !slot.retired
		})
	}
	// A loose group always comes last; a sheet with no character stat shows nothing.
	const out = [...groups.values()].filter((g) => g.rows.length)
	return [...out.filter((g) => g.sheetId !== null), ...out.filter((g) => g.sheetId === null)]
}

/** The limit fields a stat's kind takes on a card. */
export function limitKeys(kind: SlotKind): Array<"min" | "max" | "maxItems" | "maxLength"> {
	if (kind === "number") return ["min", "max"]
	if (kind === "list") return ["maxItems", "maxLength"]
	if (kind === "text") return ["maxLength"]
	return []
}

export const LIMIT_LABEL: Record<"min" | "max" | "maxItems" | "maxLength", string> = {
	min: "Lowest",
	max: "Highest",
	maxItems: "Most items",
	maxLength: "Longest text"
}

/**
 * The tab's pending edits as ONE change set. `values[slot]`: the value to
 * set (`null` clears the card's own). `limits[slot]`: the card's own limits
 * (`null` resets them to the declaration's; an empty object is a reset too).
 */
export function cardStatChanges(
	values: Record<string, SlotValue | null>,
	limits: Record<string, Record<string, unknown> | null>
): Sockets.CardState.Change[] {
	const ids = [...new Set([...Object.keys(limits), ...Object.keys(values)])]
	return ids.map((slotId) => {
		const change: Sockets.CardState.Change = { slotId }
		if (slotId in limits) {
			const own = limits[slotId]
			const clean = own
				? Object.fromEntries(Object.entries(own).filter(([, v]) => v !== null && v !== undefined && v !== ""))
				: null
			change.config = clean && Object.keys(clean).length ? clean : null
		}
		if (slotId in values) change.value = values[slotId]
		return change
	})
}

/** A sheet moved one place in the card's order; at either end nothing moves. */
export function sheetsMoved(ids: readonly string[], index: number, by: -1 | 1): string[] {
	const to = index + by
	if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return [...ids]
	const next = [...ids]
	;[next[index], next[to]] = [next[to], next[index]]
	return next
}

/** A sheet's slots as a person reads them: "Nerve, Grit". */
export function sheetSlotLabels(sheet: Sockets.CardState.AvailableSheet, read: Read): string {
	const label = new Map(read.available.slots.map((s) => [s.id, s.label]))
	return sheet.slotIds.map((id) => label.get(id) ?? id).join(", ")
}

// ── New slot ────────────────────────────────────────────────────────────────

export type NewSlotType = "integer" | "enum" | "text" | "boolean" | "list"

/** The New slot dialog's fields, as typed. */
export interface NewSlotForm {
	label: string
	description: string
	type: NewSlotType
	descriptor: string
	/** As typed; read by the type. */
	defaultText: string
	min: number | null
	max: number | null
	/** `enum`: the values, comma separated. */
	values: string
	maxItems: number | null
	maxLength: number | null
	/** `list`: a repeat is one item. */
	unique: boolean
}

export const blankSlotForm = (): NewSlotForm => ({
	label: "",
	description: "",
	type: "integer",
	descriptor: "",
	defaultText: "",
	min: null,
	max: null,
	values: "",
	maxItems: null,
	maxLength: null,
	unique: true
})

const num = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n)

/**
 * The dialog's fields as a declaration — or the sentence saying why not.
 * What only the server can judge (the name already taken, a reserved owner)
 * is its refusal, said under the same button.
 */
export function slotPropsFrom(f: NewSlotForm): { props: AttributeSlotProps; refusal: null } | { props: null; refusal: string } {
	const no = (refusal: string) => ({ props: null, refusal }) as const
	const label = f.label.trim()
	if (!label) return no("Give the slot a label.")
	const descriptor = f.descriptor.trim()
	if (!descriptor) return no("Say what the model is told this is — the descriptor is required.")
	const config: Record<string, unknown> = {}
	let def: SlotValue | undefined
	const typed = f.defaultText.trim()
	if (f.type === "integer") {
		if (num(f.min)) config.min = Math.trunc(f.min)
		if (num(f.max)) config.max = Math.trunc(f.max)
		if (num(f.min) && num(f.max) && f.min > f.max) return no("The lowest value is above the highest.")
		if (typed) {
			const n = Number(typed)
			if (!Number.isInteger(n)) return no("The default is a whole number.")
			def = n
		}
	} else if (f.type === "enum") {
		const of = [...new Set(f.values.split(",").map((v) => v.trim()).filter(Boolean))]
		if (!of.length) return no("List the values it may take, comma separated.")
		config.of = of
		if (typed) {
			if (!of.includes(typed)) return no(`The default is one of: ${of.join(", ")}.`)
			def = typed
		}
	} else if (f.type === "text") {
		if (num(f.maxLength)) config.maxLength = Math.trunc(f.maxLength)
		if (typed) def = typed
	} else if (f.type === "boolean") {
		if (typed === "yes") def = true
		else if (typed === "no") def = false
	} else if (f.type === "list") {
		if (num(f.maxItems)) config.maxItems = Math.trunc(f.maxItems)
		if (num(f.maxLength)) config.maxLength = Math.trunc(f.maxLength)
		if (!f.unique) config.unique = false
		if (typed) def = [...new Set(typed.split(",").map((v) => v.trim()).filter(Boolean))]
	}
	const props: AttributeSlotProps = {
		type: f.type,
		label,
		descriptor,
		appliesTo: ["cast"],
		...(f.description.trim() ? { description: f.description.trim() } : {}),
		...(Object.keys(config).length ? { config: config as AttributeSlotProps["config"] } : {}),
		...(def !== undefined ? { default: def } : {})
	}
	return { props, refusal: null }
}
