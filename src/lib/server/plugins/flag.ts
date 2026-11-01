/**
 * The plugin / extension subsystem gate.
 *
 * On by default since the 2026-10-30 ruling. `SP_PLUGINS_ENABLED` forces it
 * either way: `1`/`true`/`yes`/`on` on, `0`/`false`/`no`/`off` off (trimmed,
 * any case); unset, empty or anything else leaves the default, on. This is the
 * single choke point: every entry (a socket handler, a route load, a hook
 * dispatch from the pipeline) checks `pluginsEnabled()` first.
 *
 * Read at every call, but the sandbox loads plugins at boot, so a change needs
 * a restart. There is no admin switch: admin-wide settings are columns on
 * `system_settings` and a new one needs a migration.
 */
const ON = new Set(["1", "true", "yes", "on"])
const OFF = new Set(["0", "false", "no", "off"])

const fromEnv = (): boolean | null => {
	const v = process.env.SP_PLUGINS_ENABLED?.trim().toLowerCase() ?? ""
	if (ON.has(v)) return true
	if (OFF.has(v)) return false
	return null
}

export function pluginsEnabled(): boolean {
	return fromEnv() ?? true
}

/** Whether `SP_PLUGINS_ENABLED` is set to a recognised value, so it decided. */
export function pluginsEnabledByEnv(): boolean {
	return fromEnv() !== null
}
