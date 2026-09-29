/**
 * Facts about a connection's address that do not need the network.
 *
 * Client-safe: no Node imports.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

/**
 * Is this address on this machine?
 *
 * Decides whether an Ollama view offers "Download update": the download is
 * for THIS machine, and a host elsewhere has to be updated where it runs
 * (plan 2026-09-24 B4). An address that does not parse is not local — saying
 * "update it here" about a host nobody can locate would be a guess.
 */
export function isLoopbackAddress(address: string | null | undefined): boolean {
	const raw = (address ?? "").trim()
	if (!raw) return false
	let host: string
	try {
		host = new URL(
			/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
		).hostname
	} catch {
		return false
	}
	host = host.toLowerCase()
	return LOOPBACK_HOSTS.has(host) || /^127\.\d+\.\d+\.\d+$/.test(host)
}
