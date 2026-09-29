/**
 * What Admin → Sampling says about sampling configs, pure so it is tested
 * (`samplingAdmin.test.ts`): the modality word, the few values a row is
 * recognised by, which capability defaults point at a config, and what a
 * delete takes with it.
 *
 * A sampling config belongs to the instance, not to a user: there is no
 * owner column to show.
 */
import { samplingSchemaFor, type SettingsSchema } from "@serene-pub/sdk"
import { modalityOfShape } from "$lib/shared/constants/ConnectionTypes"
import type { AdminDeletion } from "$lib/client/components/admin/changelist"
import { capabilityWord, modalityWord } from "../connections/connectionsAdmin"

export type SamplingRow = {
	id: number
	name: string
	isImmutable?: boolean | null
	shape?: string | null
	values?: Record<string, unknown> | null
	enabled?: readonly string[] | null
}

type Defaults = Record<string, { samplingConfigId?: number | null } | undefined>

/** "text-gen" / "image-gen" — the filter's value. */
export function samplingModality(shape: string | null | undefined): string {
	return modalityOfShape(shape) || "text-gen"
}

/** "Text" / "Image" — the column's word. */
export function samplingModalityWord(shape: string | null | undefined): string {
	return modalityWord(samplingModality(shape))
}

export const SAMPLING_MODALITY_ORDER = ["text-gen", "image-gen"]

/**
 * The values a person tells two configs apart by, per modality, in this
 * order. Only the switched-on ones are shown: a switched-off parameter is
 * not sent, so its stored number says nothing about the config. A
 * switched-on key with no stored value is sent at its declared default, so
 * that is what shows.
 */
const KEY_VALUES: Record<string, { key: string; short: string }[]> = {
	"text-gen": [
		{ key: "temperature", short: "Temp" },
		{ key: "topP", short: "Top P" },
		{ key: "minP", short: "Min P" },
		{ key: "contextTokens", short: "Context" },
		{ key: "responseTokens", short: "Reply" }
	],
	"image-gen": [
		{ key: "steps", short: "Steps" },
		{ key: "cfg", short: "CFG" }
	]
}

const fmt = (v: unknown): string =>
	typeof v === "number"
		? Number.isInteger(v)
			? v.toLocaleString("en-US")
			: String(Math.round(v * 1000) / 1000)
		: String(v)

/** "Temp 0.7 · Top P 0.9 · Context 8,192", "Steps 30 · CFG 6 · 1024×1024", or "Nothing sent". */
export function samplingKeyValues(
	row: SamplingRow,
	schema: SettingsSchema = samplingSchemaFor(row.shape ?? undefined)
): string {
	const on = new Set(row.enabled ?? [])
	if (!on.size) return "Nothing sent"
	const value = (key: string): unknown =>
		on.has(key) ? (row.values?.[key] ?? schema?.[key]?.default ?? null) : null
	const modality = samplingModality(row.shape)
	const parts = (KEY_VALUES[modality] ?? [])
		.filter((p) => value(p.key) != null)
		.map((p) => `${p.short} ${fmt(value(p.key))}`)
	if (modality === "image-gen") {
		const w = value("width")
		const h = value("height")
		if (w != null || h != null) parts.push(`${w ?? "?"}×${h ?? "?"}`)
	}
	return parts.length ? parts.join(" · ") : "—"
}

/** How many of the shape's parameters are switched on. */
export function samplingEnabledCount(
	row: SamplingRow,
	schema: SettingsSchema = samplingSchemaFor(row.shape ?? undefined)
): { on: number; total: number } {
	const keys = Object.keys(schema ?? {})
	const on = new Set(row.enabled ?? [])
	return { on: keys.filter((k) => on.has(k)).length, total: keys.length }
}

export interface SamplingDefaultUse {
	capability: string
	/** "Chat", "Image". */
	label: string
}

/** Every capability default whose sampling half is this config. */
export function samplingDefaultsFor(
	id: number,
	defaults: Defaults | null | undefined
): SamplingDefaultUse[] {
	return Object.entries(defaults ?? {})
		.filter(([, d]) => d?.samplingConfigId === id)
		.map(([capability]) => ({ capability, label: capabilityWord(capability) }))
		.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The changelist facet over `is_immutable`: `immutable` (a built-in, shipped
 * config) or `editable`. Named after the column, not "built-in" (a session
 * write, NOMENCLATURE §9) or "origin" (a layout preset's, §9); the page's
 * prose still says "Built-in" and "Custom".
 */
export const samplingEditability = (row: SamplingRow): "immutable" | "editable" =>
	row.isImmutable ? "immutable" : "editable"

/**
 * The delete confirmation. Built-in configs cannot be deleted (the server
 * refuses them), so they are named as kept rather than listed as going.
 * Defaults pointing at a deleted config go unset
 * (`connection_defaults.sampling_config_id` is ON DELETE SET NULL); a
 * pipeline that picks it is left without that choice.
 */
export function samplingDeletion(
	rows: readonly SamplingRow[],
	defaults: Defaults | null | undefined,
	usedBy: Record<number, readonly string[]> | null | undefined
): AdminDeletion {
	const going = rows.filter((r) => !r.isImmutable)
	const kept = rows.filter((r) => r.isImmutable)
	const n = going.length
	const noun = n === 1 ? "sampling config" : "sampling configs"
	const keptLine = kept.length
		? `Built-in configs cannot be deleted, so ${kept.map((r) => r.name).join(", ")} ${kept.length === 1 ? "stays" : "stay"}. `
		: ""
	if (!n)
		return {
			title: kept.length === 1 ? `${kept[0].name} is built in` : "These are built in",
			summary: `${keptLine}Duplicate one to make a config you can change or delete.`,
			objects: [],
			confirmLabel: ""
		}
	const released = going.flatMap((r) => samplingDefaultsFor(r.id, defaults))
	const pipelines = new Set(going.flatMap((r) => usedBy?.[r.id] ?? []))
	const consequences: string[] = []
	if (released.length)
		consequences.push(
			`${released.length === 1 ? "one default goes" : `${released.length} defaults go`} unset, and the backend's own settings apply there`
		)
	if (pipelines.size)
		consequences.push(
			`${pipelines.size === 1 ? "one pipeline needs" : `${pipelines.size} pipelines need`} another choice`
		)
	return {
		title: n === 1 ? `Delete ${going[0].name}?` : `Delete ${n} ${noun}?`,
		summary:
			keptLine +
			(consequences.length
				? `${consequences.join("; ")}. `.replace(/^./, (c) => c.toUpperCase())
				: "") +
			"This cannot be undone.",
		objects: going.map((r) => {
			const related: { label: string; items: string[] }[] = []
			const held = samplingDefaultsFor(r.id, defaults)
			if (held.length)
				related.push({
					label: "Default released for",
					items: held.map((h) => h.label)
				})
			const used = usedBy?.[r.id] ?? []
			if (used.length)
				related.push({
					label: `Picked by ${used.length === 1 ? "pipeline" : "pipelines"}`,
					items: used.length > 6 ? [...used.slice(0, 6), `and ${used.length - 6} more`] : [...used]
				})
			return { label: r.name, related }
		}),
		confirmLabel: n === 1 ? "Delete sampling config" : `Delete ${n} ${noun}`
	}
}

/**
 * The values as the change form edits them: every parameter the shape
 * declares a default for, filled in where the row stores nothing.
 *
 * A switched-on key with no stored value is sent at its default, and the
 * slider shows that default — so without this, dragging it away and back
 * (or switching a parameter on and off again, which materialises the
 * default) left a key the row never had, and the form claimed unsaved
 * changes nobody made (STYLE-GUIDE §6.14). `samplingValuesToSave` takes the
 * filled-in defaults back out, so saving writes nothing the person did not.
 */
export function samplingValuesForForm(
	schema: SettingsSchema,
	stored: Record<string, unknown> | null | undefined
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, decl] of Object.entries(schema ?? {}))
		if (decl.default !== undefined) out[key] = structuredClone(decl.default)
	return { ...out, ...structuredClone(stored ?? {}) }
}

/**
 * The inverse, for the save payload: drop a key the row did not store whose
 * value is still exactly its declared default. Anything the row stored, and
 * anything changed, is kept.
 */
export function samplingValuesToSave(
	schema: SettingsSchema,
	values: Record<string, unknown>,
	stored: Record<string, unknown> | null | undefined
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [key, v] of Object.entries(values)) {
		const decl = schema?.[key]
		const filledIn =
			!(stored && Object.prototype.hasOwnProperty.call(stored, key)) &&
			decl?.default !== undefined &&
			JSON.stringify(v) === JSON.stringify(decl.default)
		if (!filledIn) out[key] = v
	}
	return out
}
