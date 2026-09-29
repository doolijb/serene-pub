/**
 * The **widget instance id** (lair re-plan S1, 2026-09-28): the id a session
 * layout places a widget under. It is the widget id itself (`messages`,
 * `world-state`, `acme:map`), or — for a second copy of a widget in one
 * layout — `<widget id>#<instance name>` (`messages#sanctum`, the Lair's
 * Sanctum panel).
 *
 * Everything a layout keys per PLACED COPY is keyed by it: the zone lists and
 * cells, the per-instance settings (`widget_settings.widget_slug`, a preset's
 * `widgetSettings`), the style pins and the skin scope
 * (`data-widget-instance`). Everything about the WIDGET — its declaration,
 * its style rows, whether it may be seated in a session — is read through
 * {@link widgetOfInstance}. So a copy costs the storage nothing: the id is an
 * opaque string wherever it is stored, and only the readers that need the
 * widget strip the instance name.
 *
 * `#` because it is the separator the action identity already uses
 * (`<spec slug>#<key>`) and no widget id holds one (a plugin's is
 * `<plugin id>:<widget key>`). ⚠ Not the retiring v2 **instance key**, which
 * was a unit field beside the widget id; this is one string, in the live
 * format.
 */

/** The separator between a widget id and an instance name. */
export const INSTANCE_NAME_SEPARATOR = "#"

/** The widget a placed id is a copy of: the id up to its `#`, else the id. */
export function widgetOfInstance(instanceId: string): string {
	const at = instanceId.indexOf(INSTANCE_NAME_SEPARATOR)
	return at > 0 ? instanceId.slice(0, at) : instanceId
}

/** The instance name of a copy (`sanctum` of `messages#sanctum`), or `null` for the widget itself. */
export function instanceNameOf(instanceId: string): string | null {
	const at = instanceId.indexOf(INSTANCE_NAME_SEPARATOR)
	return at > 0 && at < instanceId.length - 1
		? instanceId.slice(at + 1)
		: null
}

/** Is this placed id a copy of `widgetId` — the widget itself or one of its instances? */
export function isInstanceOf(instanceId: string, widgetId: string): boolean {
	return widgetOfInstance(instanceId) === widgetId
}
