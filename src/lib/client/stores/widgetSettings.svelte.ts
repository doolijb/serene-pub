/**
 * Per-instance widget settings, client side (PLAN 25; ruled 2026-09-10).
 *
 * Module-scoped for the reason the style pins next door are: the two things
 * that need them — a `WidgetHost`'s settings overlay and the panel chrome — sit
 * several layers below anything the page or `SessionLayout` hands down, and
 * prop-drilling either of them would mean threading a value through components
 * that have no use for it.
 *
 * Three things live here and nothing else:
 *
 *   • the STORED deviations, pushed by the page whenever a session's layout
 *     lands (`sessions:panelLayout:get`);
 *   • the DECLARATIONS, pushed by `SessionLayout`, which is the one component
 *     that sees every widget on screen — the panel instances and the two
 *     primaries that are snippets rather than instances;
 *   • the WRITER, registered by the page, which owns the round trip and pushes
 *     the new values back through here — so what is on screen is always what
 *     was last written, on the same terms the style pins are.
 */
import {
	coerceSettingValue,
	pruneWidgetSettings,
	widgetSettingsSchema,
	type WidgetSettingsDecl
} from "$lib/shared/widgets/settings"
import type { SettingsSchema } from "@serene-pub/sdk"
import { presetWidgetSettings } from "$lib/shared/sessionLayout/presets"

type Values = Record<string, unknown>

let values = $state<Record<string, Values>>({})
/**
 * The active layout preset's composed base. A preset that docks a widget
 * usually has an opinion about how that widget is configured, and those pins sit
 * UNDER this user's own values — held as the blob rather than as a copy, so a
 * later edit to the preset still reaches every session on it.
 */
let baseLayout = $state<unknown>(undefined)
let decls = $state<Record<string, WidgetSettingsDecl>>({})
let writer: ((next: Record<string, Values>) => void) | null = null

/** Is this a plain (non-array, non-null) object? */
function isPlainObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === "object" && !Array.isArray(v)
}

/**
 * Replace the stored deviations. Anything that is not an object of objects is
 * read as none at all — the payload is forward-compatible, so a shape from a
 * later version degrades rather than throwing.
 */
export function setWidgetSettingValues(next: unknown): void {
	const out: Record<string, Values> = {}
	if (isPlainObject(next))
		for (const [widgetId, v] of Object.entries(next))
			if (isPlainObject(v) && Object.keys(v).length) out[widgetId] = v
	values = out
}

/** Replace the preset base every widget's values sit on (the composed blob). */
export function setWidgetSettingBase(presetLayout: unknown): void {
	baseLayout = presetLayout
}

/** This widget's settings in force: the preset's pins, this user's over them. */
export function widgetSettingValues(widgetId: string): Values {
	return presetWidgetSettings(baseLayout, values)[widgetId] ?? {}
}

/**
 * The schema a write is measured against: the declaration, with any field the
 * preset pins standing in as that field's default.
 *
 * Storage holds deviations from what the session SHOWS, and a preset pin is
 * part of that. Measured against the declaration alone, a user setting a pinned
 * field back to its declared default stores nothing and the pin reasserts on the
 * next render — the setting would appear to refuse to change.
 */
function writeSchema(
	decl: WidgetSettingsDecl,
	widgetId: string
): SettingsSchema {
	const schema = widgetSettingsSchema(decl)
	const pinned = presetWidgetSettings(baseLayout, {})[widgetId]
	if (!pinned) return schema
	const out: SettingsSchema = {}
	for (const [key, field] of Object.entries(schema))
		out[key] = key in pinned ? { ...field, default: pinned[key] } : field
	return out
}

/** Replace the declarations the settings panel renders from. */
export function setWidgetSettingDecls(
	next: Record<string, WidgetSettingsDecl>
): void {
	decls = { ...next }
}

/** The declaration for one widget, if the layout has pushed one. */
export function widgetSettingDecl(
	widgetId: string
): WidgetSettingsDecl | undefined {
	return decls[widgetId]
}

/**
 * Register (or drop) the thing that persists a settings change. Pass `null` on
 * teardown so a write can never land in a page that has gone.
 */
export function setWidgetSettingsWriter(
	next: ((values: Record<string, Values>) => void) | null
): void {
	writer = next
}

/**
 * Write a patch of fields onto one widget.
 *
 * Every value is read back into the type its field declares, then the whole
 * result is pruned against the widget's schema, so what reaches storage is a
 * set of deviations the declaration admits and nothing else — a field set back
 * to its declared default is removed, a field the widget does not declare is
 * refused, and a widget left with no deviations drops out of the payload
 * entirely. The patch is applied in ONE write so two fields changed together
 * cannot each overwrite the other.
 */
export function patchWidgetSettings(widgetId: string, patch: Values): void {
	const decl = decls[widgetId]
	if (!decl) return
	const schema = writeSchema(decl, widgetId)
	const merged: Values = { ...(values[widgetId] ?? {}) }
	for (const [key, value] of Object.entries(patch)) {
		const field = schema[key]
		if (!field) continue
		merged[key] = coerceSettingValue(field, value)
	}
	const pruned = pruneWidgetSettings(schema, merged).values
	const next: Record<string, Values> = { ...values }
	if (Object.keys(pruned).length) next[widgetId] = pruned
	else delete next[widgetId]
	writer?.(next)
}

/** Clear every deviation on one widget — back to what the widget declares. */
export function resetWidgetSettings(widgetId: string): void {
	if (!values[widgetId]) return
	const next = { ...values }
	delete next[widgetId]
	writer?.(next)
}

/** Has this widget been given any deviation at all? */
export function hasWidgetSettings(widgetId: string): boolean {
	return !!values[widgetId]
}
