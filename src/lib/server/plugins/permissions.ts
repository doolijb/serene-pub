/**
 * The permission model — fine-grained, manifest-declared, deny-by-default.
 *
 * A plugin's manifest *declares* what it wants across three axes: system
 * capabilities (storage, network), SP Core resources, and events. Nothing is
 * ambient — a capability the manifest did not declare is simply never derived.
 * On top of the declaration, an **admin can deny any single permission** at the
 * plugin level; the *effective* set is `declared − admin-denied`, and every
 * capability grant the runtime hands out (the storage quota + admin override,
 * the per-host fetch allowlist) is derived from the effective set, never the raw
 * manifest.
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

/** The declared-object form — this app's authoring reference. */
export interface DeclaredPermissions {
	storage?: { quotaBytes?: number }
	network?: { hosts?: string[] }
	resources?: string[]
	events?: string[]
}

export interface PluginManifest {
	/**
	 * Two accepted shapes, one keyed result. The object form above is this app's
	 * authoring reference; the SDK packager instead emits a **compiled flat list**
	 * (`permissions: string[]`, "compiled from usage, never declared") whose keys
	 * are the same taxonomy the audit screen uses — `"storage"`, `"storage:<bytes>"`,
	 * `"network"`, `"network:<host>"`, `"resource:<r>"`, `"event:<e>"`. Both
	 * normalize here so the app can read either without caring which packager
	 * produced the manifest. The two models still diverge on more than this
	 * (transport, hook identity) — see the divergence note in project memory —
	 * but permission-reading is made tolerant of both. An unrecognised key is
	 * *surfaced* as a generic capability, never dropped: the audit screen must
	 * show everything a manifest declared, or a denial cannot target it.
	 */
	permissions?: DeclaredPermissions | string[]
}

const DEFAULT_STORAGE_QUOTA = 5 * 1024 * 1024
/**
 * The band the runtime clamps any declared storage quota into (1 KB … 256 MB),
 * mirroring the author-side compiler's range but enforced *here* rather than
 * trusted from the manifest.
 */
export const MIN_STORAGE_QUOTA = 1024
export const MAX_STORAGE_QUOTA = 256 * 1024 * 1024
/**
 * An *admin* storage-quota override may exceed the author band: unlike the
 * manifest value (an untrusted author declaration), an override is a deliberate,
 * trusted admin act. It is still clamped to a sane admin band [1 KB … 2 GB] so a
 * typo cannot hand one plugin the whole disk.
 */
export const MAX_ADMIN_STORAGE_QUOTA = 2 * 1024 * 1024 * 1024

/**
 * The storage quota the runtime will actually enforce, from whatever a manifest
 * declared. Defense-in-depth, and the single point of truth for *both* accepted
 * manifest shapes: the author-side compiler already rejects an out-of-range
 * quota, but install stores the manifest verbatim and never re-compiles it, so
 * the untrusted value is validated here, where every capability grant is
 * derived. Non-positive / non-finite → the safe default; anything real is
 * clamped into [MIN, MAX] so a manifest can neither break its own storage (a
 * negative quota would reject every write) nor grant itself an unbounded share
 * of the disk (storageHost enforces the number literally).
 */
function normalizeStorageQuota(raw: unknown): number {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)
		return DEFAULT_STORAGE_QUOTA
	return Math.min(
		Math.max(Math.floor(raw), MIN_STORAGE_QUOTA),
		MAX_STORAGE_QUOTA
	)
}

/**
 * An admin's per-plugin storage-quota override, in bytes. A valid positive,
 * finite number is clamped into the admin band and returned; anything else
 * (non-positive, non-finite, non-number, or nullish) yields `undefined`, which
 * the caller reads as "no override — the manifest-derived quota stands".
 */
export function normalizeAdminStorageQuota(raw: unknown): number | undefined {
	if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0)
		return undefined
	return Math.min(
		Math.max(Math.floor(raw), MIN_STORAGE_QUOTA),
		MAX_ADMIN_STORAGE_QUOTA
	)
}

/**
 * Fold either accepted permission shape into the object form plus the keys that
 * matched no known capability (surfaced, not discarded).
 */
function toDeclared(
	permissions: DeclaredPermissions | string[] | null | undefined
): { declared: DeclaredPermissions; unknown: string[] } {
	if (!permissions) return { declared: {}, unknown: [] }
	if (!Array.isArray(permissions))
		return { declared: permissions, unknown: [] }

	const declared: DeclaredPermissions = {}
	const resources: string[] = []
	const events: string[] = []
	const hosts: string[] = []
	const unknown: string[] = []
	let storage = false
	let network = false
	for (const raw of permissions) {
		if (typeof raw !== "string" || !raw) continue
		if (raw === "storage") storage = true
		else if (raw.startsWith("storage:")) {
			// The number is not validated here — `normalizeStorageQuota` in
			// `declaredPermissions` is the one gate for both shapes, so a bad
			// value (NaN, negative) folds to the default there rather than
			// diverging between the array and object forms.
			storage = true
			declared.storage = { quotaBytes: Number(raw.slice("storage:".length)) }
		} else if (raw === "network") network = true
		else if (raw.startsWith("network:")) {
			network = true
			const host = raw.slice("network:".length)
			if (host) hosts.push(host)
		} else if (raw.startsWith("resource:"))
			resources.push(raw.slice("resource:".length))
		else if (raw.startsWith("event:"))
			events.push(raw.slice("event:".length))
		else unknown.push(raw)
	}
	if (storage && !declared.storage) declared.storage = {}
	if (network) declared.network = { hosts }
	if (resources.length) declared.resources = resources
	if (events.length) declared.events = events
	return { declared, unknown }
}

/** Normalize a manifest's declared permissions into a flat, keyed list. */
export function declaredPermissions(
	manifest: PluginManifest | null | undefined
): Permission[] {
	const { declared: p, unknown } = toDeclared(manifest?.permissions)
	const out: Permission[] = []
	if (p.storage) {
		const quotaBytes = normalizeStorageQuota(p.storage.quotaBytes)
		out.push({
			key: "storage",
			kind: "system",
			label: `Private file storage (up to ${Math.round(quotaBytes / 1024)} KB)`,
			accountAffecting: false,
			config: { quotaBytes }
		})
	}
	if (p.network) {
		const hosts = (Array.isArray(p.network.hosts) ? p.network.hosts : []).filter(
			(h): h is string => typeof h === "string" && h.length > 0
		)
		if (hosts.length === 0) {
			// A `network` request that names no host reaches nothing; surfaced so an
			// admin still sees (and could deny) the inert declaration.
			out.push({
				key: "network",
				kind: "system",
				label: "Network access (no hosts declared)",
				accountAffecting: false,
				config: { host: null }
			})
		} else {
			// One granular, individually-deniable permission *per host* — an admin
			// can revoke a single host without killing the plugin's whole network
			// grant. A `*` / `*.suffix` wildcard is a host like any other here; the
			// fetch host enforces the match and the internal-IP block at call time.
			for (const host of hosts)
				out.push({
					key: `network:${host}`,
					kind: "system",
					label: `Network access to ${host}`,
					accountAffecting: false,
					config: { host }
				})
		}
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
	// Keys the compiled form declared but this build does not recognise. Shown
	// so an admin sees (and can deny) every declared capability; treated
	// conservatively as a non-account-affecting system capability for display.
	for (const key of unknown)
		out.push({
			key,
			kind: "system",
			label: `Declared capability: ${key}`,
			accountAffecting: false
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

/**
 * Storage quota (bytes) the runtime will enforce, or undefined to deny storage.
 * Storage must be granted (an admin can deny the `storage` key outright); when it
 * is, a valid admin override supersedes the manifest-derived quota, otherwise the
 * manifest value (author-band-clamped) stands.
 */
export function storageGrant(
	effective: Permission[],
	adminOverrideBytes?: number | null
): number | undefined {
	const s = effective.find((p) => p.key === "storage")
	if (!s) return undefined
	if (adminOverrideBytes != null) {
		const o = normalizeAdminStorageQuota(adminOverrideBytes)
		if (o !== undefined) return o
	}
	return s.config?.quotaBytes as number
}

/**
 * Allowed fetch hosts from the effective set, or undefined to deny network.
 * Each surviving `network:<host>` permission contributes one host; a plain
 * `network` (no host) request yields an empty allowlist (network requested but
 * nothing reachable). Denying a single `network:<host>` key drops just that host.
 */
export function networkGrant(effective: Permission[]): string[] | undefined {
	const requested = effective.some(
		(p) => p.key === "network" || p.key.startsWith("network:")
	)
	if (!requested) return undefined
	const hosts: string[] = []
	for (const p of effective)
		if (p.key.startsWith("network:")) {
			const h = p.config?.host
			if (typeof h === "string" && h.length > 0) hosts.push(h)
		}
	return hosts
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
