/**
 * The permission model — fine-grained, manifest-declared, deny-by-default.
 *
 * A plugin's manifest *declares* what it wants across three axes: system
 * capabilities (storage, network), SP Core resources, and events. Nothing is
 * ambient — a capability the manifest did not declare is simply never derived.
 * On top of the declaration, an **admin can deny any single permission** at the
 * plugin level; the *effective* set is `declared − admin-denied`, and every
 * capability grant the runtime hands out (the storage quota, the future fetch
 * allowlist) is derived from the effective set, never the raw manifest.
 *
 * A second layer — **per-user opt-in for account-affecting permissions** (the
 * resource/event kinds) and the session account-visibility view — is marked
 * here (`accountAffecting`) and enforced once the event surface exists; today
 * events are only a consequence of a session, so there is nothing system-wide
 * to opt into yet.
 */

export type PermissionKind = "system" | "resource" | "event"

export interface Permission {
	/** Stable key an admin denial targets, e.g. "storage", "resource:lore:write". */
	key: string
	kind: PermissionKind
	/** Human label for the admin/consent UI. */
	label: string
	/**
	 * Touches the triggering user's own account/data → needs per-user opt-in
	 * (the resource and event kinds). System capabilities do not.
	 */
	accountAffecting: boolean
	/** Declaration payload (storage quota, network hosts, …). */
	config?: Record<string, unknown>
}

export interface PluginManifest {
	permissions?: {
		storage?: { quotaBytes?: number }
		network?: { hosts?: string[] }
		resources?: string[]
		events?: string[]
	}
}

const DEFAULT_STORAGE_QUOTA = 5 * 1024 * 1024

/** Normalize a manifest's declared permissions into a flat, keyed list. */
export function declaredPermissions(
	manifest: PluginManifest | null | undefined
): Permission[] {
	const p = manifest?.permissions ?? {}
	const out: Permission[] = []
	if (p.storage) {
		const quotaBytes = p.storage.quotaBytes ?? DEFAULT_STORAGE_QUOTA
		out.push({
			key: "storage",
			kind: "system",
			label: `Private file storage (up to ${Math.round(quotaBytes / 1024)} KB)`,
			accountAffecting: false,
			config: { quotaBytes }
		})
	}
	if (p.network) {
		const hosts = Array.isArray(p.network.hosts) ? p.network.hosts : []
		out.push({
			key: "network",
			kind: "system",
			label:
				hosts.length > 0
					? `Network access to: ${hosts.join(", ")}`
					: "Network access (no hosts declared)",
			accountAffecting: false,
			config: { hosts }
		})
	}
	for (const r of Array.isArray(p.resources) ? p.resources : [])
		out.push({
			key: `resource:${r}`,
			kind: "resource",
			label: `Account resource: ${r}`,
			accountAffecting: true
		})
	for (const e of Array.isArray(p.events) ? p.events : [])
		out.push({
			key: `event:${e}`,
			kind: "event",
			label: `Event: ${e}`,
			accountAffecting: true
		})
	return out
}

/** The effective set: declared minus what an admin has denied. */
export function effectivePermissions(
	declared: Permission[],
	adminDenied: string[] | null | undefined
): Permission[] {
	const denied = new Set(adminDenied ?? [])
	return declared.filter((p) => !denied.has(p.key))
}

/** Storage quota (bytes) from the effective set, or undefined to deny storage. */
export function storageGrant(effective: Permission[]): number | undefined {
	const s = effective.find((p) => p.key === "storage")
	return s ? (s.config?.quotaBytes as number) : undefined
}

/** Allowed fetch hosts from the effective set, or undefined to deny network. */
export function networkGrant(effective: Permission[]): string[] | undefined {
	const n = effective.find((p) => p.key === "network")
	return n ? ((n.config?.hosts as string[]) ?? []) : undefined
}

/** One row of the admin permissions view: a declared permission + its state. */
export interface PermissionState {
	key: string
	kind: PermissionKind
	label: string
	accountAffecting: boolean
	/** False when an admin has denied it. */
	granted: boolean
}

/** The full permission picture for one plugin, for the admin UI. */
export function permissionStates(
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined
): PermissionState[] {
	const denied = new Set(adminDenied ?? [])
	return declaredPermissions(manifest).map((p) => ({
		key: p.key,
		kind: p.kind,
		label: p.label,
		accountAffecting: p.accountAffecting,
		granted: !denied.has(p.key)
	}))
}
