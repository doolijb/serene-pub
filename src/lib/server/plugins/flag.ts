/**
 * The plugin / extension subsystem gate.
 *
 * The whole subsystem is built and wired on this branch so a proper SDK
 * preview can ship in 0.6.0 with an almost-frozen shape — but it is
 * **disabled by default** so it does not surface in a 0.6.0 *release*.
 * Stability work continues into 0.7.0 behind this flag.
 *
 * Enable for development / preview by setting `SP_PLUGINS_ENABLED=1` (or
 * `true`). Releases leave it unset and the entire surface — runtime, admin
 * routes, hook dispatch — stays inert. This is the single choke point: every
 * entry (a socket handler, a route load, a hook dispatch from the pipeline)
 * checks `pluginsEnabled()` first, so flipping this one value is the whole
 * on/off switch.
 */
export function pluginsEnabled(): boolean {
	const v = process.env.SP_PLUGINS_ENABLED
	return v === "1" || v === "true"
}
