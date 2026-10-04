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

type Values = Record<string, unknown>

/**
 * This person's values for this session, per widget instance — the ONLY
 * source. Under the copy model a layout's own `widgetSettings` were copied
 * into these rows when the session started from it, so nothing sits under
 * them (brief 3 of `PLAN-layout-one-format-2026-09-28`).
 */
let values = $state<Record<string, Values>>({})
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

/** This widget instance's settings in force: this person's own values. */
export function widgetSettingValues(widgetId: string): Values {
	return values[widgetId] ?? {}
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
	const schema = widgetSettingsSchema(decl)
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

/**
 * Every widget instance id holding stored values in this session — what the
 * layout editor's mint skips, so a new copy never inherits a removed one's
 * leftovers (brief 7b, plan §M.3.2).
 */
export function storedWidgetSettingIds(): string[] {
	return Object.keys(values)
}

/** Every instance's stored values, as held — what a Duplicate copies from. */
export function allWidgetSettingValues(): Readonly<Record<string, Values>> {
	return values
}

/**
 * Clear several instances' stored values in ONE write — the layout editor's
 * Cancel taking back what its Duplicates wrote (brief 7b review). One write,
 * not one per id: each write starts from the values as last held, so a second
 * call made before the first came back would put the first id back.
 */
export function dropWidgetSettings(ids: Iterable<string>): void {
	const out: Record<string, Values> = { ...values }
	let changed = false
	for (const id of ids)
		if (out[id]) {
			delete out[id]
			changed = true
		}
	if (changed) writer?.(out)
}

/**
 * Replace one instance's stored values whole, verbatim — `null` (or an empty
 * object) clears them. For Duplicate (brief 7b, QD): the copy takes the
 * source's values as they are, before its own declaration is registered, so
 * they are not pruned against it here; the next `patchWidgetSettings` prunes
 * as ever.
 */
export function putWidgetSettings(widgetId: string, next: Values | null): void {
	const out: Record<string, Values> = { ...values }
	if (next && Object.keys(next).length) out[widgetId] = { ...next }
	else if (out[widgetId]) delete out[widgetId]
	else return
	writer?.(out)
}
