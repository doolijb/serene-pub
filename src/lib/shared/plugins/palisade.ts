/**
 * The palisade: the plain-words picture of what a plugin can and cannot do on
 * this pub. What it asks for, plus the sandbox's fixed limits and every limit a
 * permission it did not ask for leaves in place. Pure, so Admin › Plugins can
 * draw it for a package before it is uploaded.
 */

export interface PalisadePermission {
	key: string
	label: string
}

export interface Palisade {
	/** What the plugin asked for, in its permissions' own words. */
	can: string[]
	/** What it cannot do: the fixed limits first, then those it did not ask to lift. */
	cannot: string[]
}

/**
 * The limits that hold for every plugin, whatever it asks for. The ONE list;
 * each `rule` names where the limit is enforced.
 */
export const FIXED_CANNOT: ReadonlyArray<{ text: string; rule: string }> = [
	// R53 — `PLUGIN_RULES.connections` (serene-pub-sdk/sdk/src/pluginPermissions.ts):
	// a plugin's code never reads connection data or calls a model; model calls are core's nodes.
	{
		text: "Can't read your connections or API keys, or call a model itself",
		rule: "R53, PLUGIN_RULES.connections in the SDK: a plugin's code never reads connection data or calls a model; model calls are core's nodes."
	},
	// R63 — `PLUGIN_RULES.secrets`: a secret setting reaches plugin code as a handle;
	// `ctx.fetch` fills it in for declared hosts only.
	{
		text: "Can't see the secrets you type into its settings; its code gets a stand-in",
		rule: "R63, PLUGIN_RULES.secrets: a secret setting reaches plugin code as a handle; ctx.fetch fills it in for declared hosts only."
	},
	// The sandbox hands a hook exactly `hookCtxKeysFor(kind)` in a fresh QuickJS context or
	// SES Compartment with no ambient authority; storage is the plugin's own (`storageHost`).
	{
		text: "Can't open files or run programs on this computer, or touch another plugin's files",
		rule: "The sandbox hands a hook exactly hookCtxKeysFor(kind) (random, now, log, signal; storage and fetch by kind) in a fresh QuickJS context or SES Compartment with no ambient authority; storage is the plugin's own (storageHost)."
	},
	// K1 — a plugin's outlet declares `effects: 'emit'` and writes only its own storage; core's
	// outlets write the session; a widget write is core's own verb run as the viewer (Q2).
	{
		text: "Can't change your characters, lorebooks or sessions directly; every change goes through Serene Pub",
		rule: "K1: a plugin's outlet declares effects: 'emit' and writes only its own storage; core's outlets write the session; a widget write is core's own verb run as the viewer (Q2)."
	}
]

/**
 * An entry that names this computer or a local network by literal: `localhost`,
 * a dotted IPv4 or an IPv6. Mirrors `isIpLiteral` in
 * `$lib/server/plugins/fetchHost`, which refuses every internal address unless
 * that literal itself was declared, wildcard included.
 */
function isInternalLiteral(entry: string): boolean {
	let host = entry.toLowerCase()
	const port = /:\d+$/.exec(host)
	if (port && !host.slice(0, port.index).includes(":"))
		host = host.slice(0, port.index)
	host = host.replace(/[[\]]/g, "")
	return (
		host === "localhost" ||
		/^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
		host.includes(":")
	)
}

/**
 * What a plugin can and cannot do, from its permissions: `can` is what it
 * asked for; `cannot` is the fixed limits plus each limit a permission it did
 * not ask for leaves in place.
 */
export function pluginPalisade(
	permissions: readonly PalisadePermission[]
): Palisade {
	const can = [...new Set(permissions.map((p) => p.label))]
	const keys = permissions.map((p) => p.key)
	const cannot = FIXED_CANNOT.map((f) => f.text)

	// A bare `network` key names no host and reaches nothing, so it does not count.
	const hosts = keys
		.filter((k) => k.startsWith("network:"))
		.map((k) => k.slice("network:".length))
	if (hosts.length === 0)
		cannot.push("Can't reach the internet or your local network")
	else {
		if (!hosts.includes("*"))
			cannot.push("Can't reach any site it doesn't list")
		if (!hosts.some(isInternalLiteral))
			cannot.push("Can't reach this computer or your local network")
	}

	const stateWrite = keys.includes("widget:session:state:write")
	const channelWrite = keys.some((k) => /^widget:channel:.+:write$/.test(k))
	if (!stateWrite && !channelWrite)
		cannot.push("Can't send messages or change a session's stats as you")
	else if (channelWrite && !stateWrite)
		cannot.push("Can't change a session's stats or states as you")
	else if (stateWrite && !channelWrite)
		cannot.push("Can't send or draft messages as you")

	if (!keys.some((k) => k.startsWith("event:")))
		cannot.push("Can't hear what happens in sessions that don't use it")
	if (!keys.includes("storage")) cannot.push("Can't keep files of its own")

	return { can, cannot }
}
