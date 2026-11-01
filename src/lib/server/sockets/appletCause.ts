/**
 * 🚧 (M2c) Which extension a server-made `sessions:update` call is on behalf of.
 * Keyed by the params OBJECT, set only by server code (`appletApi:updateSession`),
 * so a client cannot claim a cause by posting a field: the ledger's
 * `EventCause.pluginId` is the server's word.
 */
const callers = new WeakMap<object, string>()

export function markAppletCall<T extends object>(params: T, pluginId: string): T {
	callers.set(params, pluginId)
	return params
}

export function appletCallerOf(params: unknown): { pluginId?: string } {
	const id = params && typeof params === "object" ? callers.get(params as object) : undefined
	return id ? { pluginId: id } : {}
}
