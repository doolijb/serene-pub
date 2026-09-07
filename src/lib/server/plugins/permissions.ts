/**
 * The permission model — fine-grained, manifest-declared, deny-by-default.
 *
 * A plugin's manifest *declares* what it wants across three axes: system
 * permissions (storage, network), SP Core resources, and events. Nothing is
 * ambient — a permission the manifest did not declare is simply never derived.
 * On top of the declaration, an **admin can deny any single permission** at the
 * plugin level; the *effective* set is `declared − admin-denied`, and every
 * permission grant the sandbox hands out (the storage quota + admin override,
 * the per-host fetch allowlist) is derived from the effective set, never the raw
 * manifest.
 *
 * **Nothing is granted until an admin has looked at it.** A declaration is a
 * request, not a grant: the effective set is `declared − admin-denied − *not yet
 * reviewed*`, so a plugin whose permissions no one has reviewed loads and runs
 * with every grant-bearing permission refused — inert, not broken. It keeps the
 * ambient stdlib, `ctx.log`, `ctx.random`, `ctx.now` and `ctx.signal`; it gets
 * no storage, no network, no resources and no events.
 *
 * The review record lives in the same `adminDenied` list, as one reserved
 * `__reviewed:…` entry per permission an admin has decided about — the key plus
 * whatever payload was shown with it, so a raised storage quota is a new request
 * rather than an old approval. Deliberately per-permission rather than a
 * whole-set fingerprint, and deliberately not keyed to the bundle hash: an
 * update that asks for nothing new carries every marker forward and needs no
 * re-consent, while anything the plugin did not ask for before has no marker and
 * is therefore denied until someone looks. (The bundle hash is the
 * *other* gate, in `store.ts`: changed bytes force `enabled=false`, so new code
 * cannot run under the old approval either.) Storing it here rather than in a
 * column of its own is what lets every existing reader — `eventHost`,
 * `frameHost`, `store` — inherit the gate without changing a line: they already
 * pass `adminDenied` to `effectivePermissions`.
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
	 * (the resource and event kinds). System permissions do not.
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
	 * *surfaced* as a generic permission, never dropped: the audit screen must
	 * show everything a manifest declared, or a denial cannot target it.
	 */
	permissions?: DeclaredPermissions | string[]
}

const DEFAULT_STORAGE_QUOTA = 5 * 1024 * 1024
/**
 * The band the sandbox clamps any declared storage quota into (1 KB … 256 MB),
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
 * The storage quota the sandbox will actually enforce, from whatever a manifest
 * declared. Defense-in-depth, and the single point of truth for *both* accepted
 * manifest shapes: the author-side compiler already rejects an out-of-range
 * quota, but install stores the manifest verbatim and never re-compiles it, so
 * the untrusted value is validated here, where every permission grant is
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
 * matched no known permission (surfaced, not discarded).
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
			declared.storage = {
				quotaBytes: Number(raw.slice("storage:".length))
			}
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
		const hosts = (
			Array.isArray(p.network.hosts) ? p.network.hosts : []
		).filter((h): h is string => typeof h === "string" && h.length > 0)
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
	// so an admin sees (and can deny) every declared permission; treated
	// conservatively as a non-account-affecting system permission for display.
	for (const key of unknown)
		out.push({
			key,
			kind: "system",
			label: `Declared permission: ${key}`,
			accountAffecting: false
		})
	return out
}

/* ── consent: the install-time review gate ───────────────────────────────── */

/**
 * The reserved prefix marking one reviewed key inside `adminDenied`. A manifest
 * *can* declare a key in this namespace (the compiled array form passes any
 * string through, and this file surfaces rather than drops what it does not
 * recognise) — which is why `reviewMark` prefixes unconditionally: a declared
 * `__reviewed:x` is marked `__reviewed:__reviewed:x`, never as a review of `x`.
 * The matching guard is on the write side, in the socket handler: a key in this
 * namespace is not togglable, so a denial cannot be spent forging a review.
 */
const REVIEW_PREFIX = "__reviewed:"

/**
 * The stored marker recording that an admin has decided about one declared
 * permission — its key **and the payload they were shown with it**.
 *
 * The payload matters because the key alone is not the whole request: `storage`
 * asks for a number of bytes, and a plugin that consented at 1 MB and returns
 * asking for 256 MB is asking for something new under an old approval. Folding
 * the config in makes that a fresh request, and does it generically, so the same
 * holds for any permission that grows a declaration later. It is a no-op for the
 * ones whose payload is already in the key (`network:<host>`) or absent
 * (resources, events).
 */
export function reviewMark(p: Permission | string): string {
	if (typeof p === "string") return REVIEW_PREFIX + p
	return p.config
		? `${REVIEW_PREFIX}${p.key}#${JSON.stringify(p.config)}`
		: REVIEW_PREFIX + p.key
}

/** True for a stored entry that is a review marker rather than a denial. */
export function isReviewMark(entry: string): boolean {
	return entry.startsWith(REVIEW_PREFIX)
}

/** The markers a full review of `declared` writes — the admin's consent act. */
export function reviewMarks(declared: Permission[]): string[] {
	return declared.map((p) => reviewMark(p))
}

/**
 * Declared permissions no admin has decided about yet. These are refused (see
 * `effectivePermissions`) and are what the admin surface reports as waiting.
 */
export function pendingPermissions(
	declared: Permission[],
	adminDenied: string[] | null | undefined
): Permission[] {
	const marks = new Set(adminDenied ?? [])
	return declared.filter((p) => !marks.has(reviewMark(p)))
}

/**
 * Is this plugin waiting on an admin? True while any declared permission is
 * unreviewed — a fresh install, or an update that asks for something new. A
 * plugin that declares nothing is never waiting: there is nothing to consent to.
 */
export function needsReview(
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined
): boolean {
	const declared = declaredPermissions(manifest)
	return pendingPermissions(declared, adminDenied).length > 0
}

/**
 * The effective set: what the sandbox actually hands out.
 *
 * Two subtractions, not one. An admin **denial** removes a permission they
 * looked at and said no to; the **absence of a review marker** removes one they
 * have not looked at at all. Both are refusals, and the second is the one that
 * makes a declaration a request rather than a grant — a plugin installed and
 * enabled but never reviewed reaches nothing.
 */
export function effectivePermissions(
	declared: Permission[],
	adminDenied: string[] | null | undefined
): Permission[] {
	const entries = new Set(adminDenied ?? [])
	return declared.filter(
		(p) => !entries.has(p.key) && entries.has(reviewMark(p))
	)
}

/**
 * Storage quota (bytes) the sandbox will enforce, or undefined to deny storage.
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
	/** In force right now — reviewed *and* not denied. */
	granted: boolean
	/** Declared, but no admin has decided about it yet. Refused meanwhile. */
	pending: boolean
}

/** The full permission picture for one plugin, for the admin UI. */
export function permissionStates(
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined
): PermissionState[] {
	const entries = new Set(adminDenied ?? [])
	return declaredPermissions(manifest).map((p) => ({
		key: p.key,
		kind: p.kind,
		label: p.label,
		accountAffecting: p.accountAffecting,
		granted: !entries.has(p.key) && entries.has(reviewMark(p)),
		pending: !entries.has(reviewMark(p))
	}))
}
