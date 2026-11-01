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
 *
 * Reading what a manifest declares lives in `$lib/shared/plugins/declaredPermissions`
 * (pure, so Admin › Plugins can read a package before upload); re-exported here.
 */
import {
	declaredPermissions,
	isServableGlob,
	widgetGrantLabel,
	MIN_STORAGE_QUOTA,
	type Permission,
	type PermissionKind,
	type PluginManifest
} from "$lib/shared/plugins/declaredPermissions"

export {
	isServableGlob,
	WIDGET_SCOPE_LABELS,
	WIDGET_WRITE_LABELS,
	widgetGrantLabel,
	declaredWidgetScopes,
	widgetScopePermissions,
	MIN_STORAGE_QUOTA,
	MAX_STORAGE_QUOTA,
	declaredPermissions,
	isRefusedPermissionKey,
	permissionGroup,
	PER_USER_STORAGE_KEY
} from "$lib/shared/plugins/declaredPermissions"
export type {
	PermissionGroup,
	PermissionKind,
	Permission,
	DeclaredPermissions,
	PluginManifest
} from "$lib/shared/plugins/declaredPermissions"

/**
 * What one panel — or one package widget (R71) — may read: the scopes it
 * asked for that its plugin was granted. It can narrow its plugin's grant,
 * never widen it.
 */
export function panelGrants(
	asked: unknown,
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined
): string[] {
	if (!Array.isArray(asked) || !asked.length) return []
	const granted = new Set(grantedWidgetScopes(manifest, adminDenied))
	return [...new Set(asked.filter((s): s is string => typeof s === "string" && granted.has(s)))]
}

/**
 * The widget scopes an admin has granted this plugin (declared − denied −
 * unreviewed), write grants among them (`session:state:write`) — only those
 * this build knows (`widgetGrantLabel`). A
 * compiled `widget:<x>` this build does not recognise is surfaced for review
 * as an unknown permission, and approving THAT grants no data: nothing here
 * supplies `<x>`, and a scope a later build learns is reviewed again under
 * its own sentence (`reviewMark`).
 */
export function grantedWidgetScopes(
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined
): string[] {
	return effectivePermissions(declaredPermissions(manifest), adminDenied)
		.filter((p) => isWidgetScopePermission(p))
		.map((p) => p.key.slice("widget:".length))
}

/** A recognised widget grant's permission — `widget:<scope>` or `widget:<scope>:write` this build knows. */
function isWidgetScopePermission(p: Permission): boolean {
	return (
		p.kind === "resource" &&
		p.key.startsWith("widget:") &&
		widgetGrantLabel(p.key.slice("widget:".length)) !== null
	)
}

/**
 * An *admin* storage-quota override may exceed the author band: unlike the
 * manifest value (an untrusted author declaration), an override is a deliberate,
 * trusted admin act. It is still clamped to a sane admin band [1 KB … 2 GB] so a
 * typo cannot hand one plugin the whole disk.
 */
export const MAX_ADMIN_STORAGE_QUOTA = 2 * 1024 * 1024 * 1024

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
 *
 * A recognised widget scope's mark also says it was reviewed AS that scope
 * (`#scope`). A `widget:<x>` this build did not know was shown as an unknown
 * permission ("Declared permission: widget:<x>", no data behind it), and its
 * review stored the bare mark; a later build that learns `<x>` must ask
 * again under the sentence that names the data, not carry that review over
 * into a grant. (A consequence, once: a scope reviewed before this rule is
 * asked about again.)
 */
export function reviewMark(p: Permission | string): string {
	if (typeof p === "string") return REVIEW_PREFIX + p
	if (isWidgetScopePermission(p)) return `${REVIEW_PREFIX}${p.key}#scope`
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

/**
 * 🚧 The storage globs the plugin's OWN frames may read at
 * `/plugin-data/<pluginId>/<path>` (M0, SHAPES L12 Seams), from the
 * effective set — each `storage-serve:<glob>` that survived review and
 * denial. Empty unless `storage` itself is granted: nothing is served from
 * storage the plugin may not hold.
 */
export function servedStorageGlobs(effective: Permission[]): string[] {
	if (!effective.some((p) => p.key === "storage")) return []
	const globs: string[] = []
	for (const p of effective)
		if (p.key.startsWith("storage-serve:")) {
			const g = p.config?.glob
			if (isServableGlob(g)) globs.push(g)
		}
	return globs
}

/**
 * 🚧 Each person's own storage quota (bytes), or undefined to deny per-user
 * plugin storage (M2b) — `storage-per-user` declared, reviewed and not denied.
 * Its own key and its own quota, apart from the plugin's pub-wide `storage`.
 */
export function perUserStorageGrant(effective: Permission[]): number | undefined {
	const s = effective.find((p) => p.key === "storage-per-user")
	return s ? (s.config?.quotaBytes as number) : undefined
}

/**
 * 🚧 What the applet group grants (M2b), from the effective set: the library
 * levels (write holds read), the genres whose sessions it reaches, and the user
 * annex. Every grant is still bounded by the person acting; the request
 * handlers that read this land in M2c.
 */
export interface AppletGrant {
	characters?: "read" | "write"
	lorebooks?: "read" | "write"
	sessionGenres: string[]
	userAnnex: boolean
}

export function appletGrant(effective: Permission[]): AppletGrant {
	const out: AppletGrant = { sessionGenres: [], userAnnex: false }
	for (const p of effective) {
		const m = /^applet:(characters|lorebooks):(read|write)$/.exec(p.key)
		if (m) {
			const what = m[1] as "characters" | "lorebooks"
			if (out[what] !== "write") out[what] = m[2] as "read" | "write"
		} else if (p.key.startsWith("applet:sessions:")) {
			const g = p.config?.genre
			if (typeof g === "string" && g) out.sessionGenres.push(g)
		} else if (p.key === "applet:annex:user") out.userAnnex = true
	}
	return out
}

/**
 * 🚧 Whether the plugin's frames may start sound unasked — `media:autoplay`
 * declared, reviewed and not denied (M0, SHAPES L8). The frame document
 * is answered `Permissions-Policy: autoplay=()` otherwise.
 */
export function autoplayGranted(effective: Permission[]): boolean {
	return effective.some((p) => p.key === "media:autoplay")
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
